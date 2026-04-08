//! Circuit-eval-native handling of expression-based components.
//!
//! Components that carry a `panproto-expr` expression (`apply_expr`,
//! `coerce_type`, `compute_field`) are not well served by installing
//! `FieldTransform::ApplyExpr` / `ComputeField` on the compiled migration.
//! The panproto-lens put path reads the pre-transform extra_fields snapshot
//! from the complement and — if the view has been re-parsed from JSON via
//! `parse_json` — never re-applies the forward/inverse expressions to the
//! CHILD node whose value actually changes.
//!
//! Instead, we apply expressions directly against the view instance in a
//! forward pass and against the modified view in the backward pass. The
//! forward pass writes the transformed value into the child node's
//! `node.value`, so `to_json` renders it naturally. The backward pass walks
//! the recorded ops in reverse and applies each op's `inverse` expression
//! (when provided) back to the same child.
//!
//! For `compute_field`, the target key is written to the root node's
//! `extra_fields`, which is how `to_json` surfaces derived fields alongside
//! arc-walked children.

use std::collections::HashMap;
use std::sync::Arc;

use panproto_expr::{Env, EvalConfig, Expr, Literal};
use panproto_gat::Name;
use panproto_inst::value::FieldPresence;
use panproto_inst::{WInstance, expr_literal_to_value, value_to_expr_literal};
use panproto_schema::Schema;

use crate::error::EvalError;

/// A single expression op, parsed once and applied forward/backward.
///
/// The `expr` fields are retained on both variants even though
/// `ApplyToField::expr` is not currently used by `apply_one_forward`
/// (that path leans on panproto's `FieldTransform::ApplyExpr` for the
/// forward direction). Keeping it here documents the forward semantics
/// and lets future changes adopt a fully manual forward pass without
/// reshaping the type.
#[derive(Debug, Clone)]
pub(crate) enum ExprOp {
    /// Apply `expr` to the child at edge `field` under the view's root.
    /// `inverse` is applied on the backward pass by [`apply_inverse_ops`].
    ApplyToField {
        field: String,
        #[allow(dead_code)]
        expr: Expr,
        inverse: Option<Expr>,
    },
    /// Write `expr(child_env)` into the root's `extra_fields[target]`.
    ComputeField {
        target: String,
        expr: Expr,
        inverse: Option<Expr>,
    },
}

/// Apply a list of ops forward to the view, mutating in place.
///
/// This is a no-op for `ApplyToField` ops — their forward effect is
/// carried by `FieldTransform::ApplyExpr` installed on the compiled lens,
/// which writes the transformed value into the ROOT node's
/// `extra_fields`. Direct `panproto_lens::asymmetric::put` then uses its
/// `original_extra_fields` snapshot to restore the original. The
/// expression layer kicks in on the backward pass via
/// [`apply_inverse_ops`], which consumes the re-parsed view's child
/// value and evaluates the `inverse` expression on it.
///
/// For `ComputeField`, we ALSO rely on the legacy `FieldTransform::
/// ComputeField` for the happy path, but we need to handle the env
/// ordering when `compute_field` follows an upstream `rename_field`:
/// panproto's compiled migration binds variables from the original
/// WInstance's arc names (pre-rename), so a compute_field expression
/// that references the post-rename key comes back as unbound. To fix
/// that we re-evaluate compute_field expressions directly against the
/// view (which has the post-rename arcs) and write the result into
/// `root.extra_fields`, replacing whatever the legacy FieldTransform
/// computed.
pub(crate) fn apply_forward_ops(view: &mut WInstance, ops: &[ExprOp]) -> Result<(), EvalError> {
    for op in ops {
        apply_one_forward(view, op)?;
    }
    Ok(())
}

fn apply_one_forward(view: &mut WInstance, op: &ExprOp) -> Result<(), EvalError> {
    let root = view.root;
    match op {
        ExprOp::ApplyToField { .. } => {
            // No-op: the legacy `FieldTransform::ApplyExpr` on the
            // compiled lens has already written the transformed value
            // into `root.extra_fields[field]`, which `to_json` renders
            // in preference to the child's arc-walked value. Keeping the
            // child untouched preserves direct-put round-trips (via the
            // `original_extra_fields` complement snapshot).
        }
        ExprOp::ComputeField { target, expr, .. } => {
            // Re-evaluate against the POST-chain view so that a
            // compute_field downstream of a rename_field sees the
            // renamed variable (the legacy FieldTransform would have
            // seen the pre-rename arc names).
            let env = build_root_child_env(view);
            let Ok(result) = try_eval(expr, &env) else {
                return Ok(());
            };
            if let Some(root_node) = view.nodes.get_mut(&root) {
                root_node
                    .extra_fields
                    .insert(target.clone(), expr_literal_to_value(&result));
            }
        }
    }
    Ok(())
}

/// Apply a list of ops backward (reverse order, invoking inverses when
/// present). Ops without an inverse are best-effort: `ApplyToField` becomes
/// a no-op (the view's value is kept as-is — the user cannot modify an
/// uninvertible forward), and `ComputeField` drops the derived key so it
/// does not leak back into the source.
pub(crate) fn apply_inverse_ops(view: &mut WInstance, ops: &[ExprOp]) -> Result<(), EvalError> {
    for op in ops.iter().rev() {
        apply_one_inverse(view, op)?;
    }
    Ok(())
}

fn apply_one_inverse(view: &mut WInstance, op: &ExprOp) -> Result<(), EvalError> {
    let root = view.root;
    match op {
        ExprOp::ApplyToField {
            field,
            inverse: Some(inv),
            ..
        } => {
            let child_id = find_child_by_edge_name(view, root, field);
            let Some(child_id) = child_id else {
                return Ok(());
            };
            let env = build_root_child_env(view);
            let Ok(result) = try_eval(inv, &env) else {
                return Ok(());
            };
            if let Some(child) = view.nodes.get_mut(&child_id) {
                child.value = Some(FieldPresence::Present(expr_literal_to_value(&result)));
            }
        }
        ExprOp::ApplyToField { inverse: None, .. } => {
            // Non-invertible: keep the view value. panproto_lens::put will
            // see the (possibly transformed) child value and pass it through.
        }
        ExprOp::ComputeField {
            target,
            inverse: Some(inv),
            ..
        } => {
            let env = build_root_child_env(view);
            let Ok(result) = try_eval(inv, &env) else {
                return Ok(());
            };
            if let Some(root_node) = view.nodes.get_mut(&root) {
                root_node
                    .extra_fields
                    .insert(target.clone(), expr_literal_to_value(&result));
            }
        }
        ExprOp::ComputeField {
            target,
            inverse: None,
            ..
        } => {
            // Projection: discard any user tamper with the derived key.
            if let Some(root_node) = view.nodes.get_mut(&root) {
                root_node.extra_fields.remove(target);
            }
        }
    }
    Ok(())
}

/// Build an env binding every direct child of the view's root by the arc's
/// edge name, so that e.g. `lower(name)` resolves `name` to the child's
/// current value. Also binds `extra_fields` entries of the root (for
/// `compute_field` chained after a prior `compute_field`).
fn build_root_child_env(view: &WInstance) -> Env {
    let mut env = Env::new();
    let root = view.root;
    // Bind arc-walked children by edge name.
    for (parent_id, child_id, edge) in &view.arcs {
        if *parent_id != root {
            continue;
        }
        let Some(edge_name) = edge.name.as_ref() else {
            continue;
        };
        let child_node = match view.nodes.get(child_id) {
            Some(n) => n,
            None => continue,
        };
        if let Some(FieldPresence::Present(val)) = &child_node.value {
            let lit = value_to_expr_literal(val);
            env = env.extend(Arc::from(edge_name.as_ref()), lit);
        }
    }
    // Bind root extra_fields as vars too.
    if let Some(root_node) = view.nodes.get(&root) {
        for (key, val) in &root_node.extra_fields {
            let lit = value_to_expr_literal(val);
            env = env.extend(Arc::from(key.as_str()), lit);
        }
    }
    env
}

fn find_child_by_edge_name(view: &WInstance, parent: u32, edge_name: &str) -> Option<u32> {
    for (p, c, edge) in &view.arcs {
        if *p != parent {
            continue;
        }
        if let Some(name) = edge.name.as_ref()
            && name.as_ref() == edge_name
        {
            return Some(*c);
        }
    }
    None
}

/// Best-effort eval: returns `Err(())` on any runtime failure so callers
/// can leave the target field unchanged. Runtime errors here must not be
/// fatal — they are tested by `tests/expression_errors.rs` which asserts
/// that e.g. `upper(x - 1)` where `x` is a string leaves the field alone.
fn try_eval(expr: &Expr, env: &Env) -> Result<Literal, ()> {
    let config = EvalConfig::default();
    panproto_expr::eval(expr, env, &config).map_err(|_| ())
}

/// Build an `ExprOp` from a single component's parameters. Returns `None`
/// if the component is not expression-based or its params are unset.
/// Expression parse errors are propagated verbatim.
pub(crate) fn component_to_expr_op(
    circuit: &Schema,
    comp_id: &Name,
    comp_type: &str,
) -> Result<Option<ExprOp>, EvalError> {
    match comp_type {
        "apply_expr" | "coerce_type" => {
            let field = match optional_param(circuit, comp_id, "field") {
                Some(f) if !f.is_empty() => f,
                _ => return Ok(None),
            };
            let expr_src = match optional_param(circuit, comp_id, "expr") {
                Some(s) if !s.is_empty() => s,
                _ => return Ok(None),
            };
            let expr = parse_expr_field(comp_id, "expr", &expr_src)?;
            let inverse = match optional_param(circuit, comp_id, "inverse") {
                Some(s) if !s.is_empty() => Some(parse_expr_field(comp_id, "inverse", &s)?),
                _ => None,
            };
            Ok(Some(ExprOp::ApplyToField {
                field,
                expr,
                inverse,
            }))
        }
        "compute_field" => {
            let target = match optional_param(circuit, comp_id, "target") {
                Some(t) if !t.is_empty() => t,
                _ => return Ok(None),
            };
            let expr_src = match optional_param(circuit, comp_id, "expr") {
                Some(s) if !s.is_empty() => s,
                _ => return Ok(None),
            };
            let expr = parse_expr_field(comp_id, "expr", &expr_src)?;
            let inverse = match optional_param(circuit, comp_id, "inverse") {
                Some(s) if !s.is_empty() => Some(parse_expr_field(comp_id, "inverse", &s)?),
                _ => None,
            };
            Ok(Some(ExprOp::ComputeField {
                target,
                expr,
                inverse,
            }))
        }
        _ => Ok(None),
    }
}

fn parse_expr_field(component: &Name, field: &str, src: &str) -> Result<Expr, EvalError> {
    let tokens = panproto_expr_parser::tokenize(src).map_err(|e| EvalError::ExprParse {
        component: component.to_string(),
        field: field.to_owned(),
        message: format!("tokenization failed: {e}"),
    })?;
    panproto_expr_parser::parse(&tokens).map_err(|errors| EvalError::ExprParse {
        component: component.to_string(),
        field: field.to_owned(),
        message: errors
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("; "),
    })
}

fn optional_param(circuit: &Schema, comp_id: &Name, key: &str) -> Option<String> {
    circuit
        .constraints
        .get(comp_id)?
        .iter()
        .find(|c| c.sort.as_ref() == format!("param:{key}"))
        .map(|c| c.value.clone())
}

/// Remap node ids in `reparsed` so they match `original`'s ids by anchor,
/// using parallel BFS traversal keyed on edge name. Any nodes in `reparsed`
/// that cannot be matched (e.g., newly-added by a modification) are left
/// with fresh ids beyond the original's max id.
///
/// Returns a new `WInstance` whose nodes/arcs/root mirror `reparsed`'s
/// content but with stable ids compatible with `original` and the
/// complement that was captured alongside it.
pub(crate) fn remap_view_ids_by_anchor(reparsed: &WInstance, original: &WInstance) -> WInstance {
    let mut remap: HashMap<u32, u32> = HashMap::new();
    remap.insert(reparsed.root, original.root);

    // BFS matched pairs: (orig_id, reparsed_id)
    let mut stack: Vec<(u32, u32)> = vec![(original.root, reparsed.root)];
    let max_orig = original.nodes.keys().max().copied().unwrap_or(0);
    let mut next_fresh: u32 = max_orig.wrapping_add(1);

    while let Some((orig_id, rep_id)) = stack.pop() {
        // Collect original children of orig_id as list of (edge_name, child_id).
        let orig_children: Vec<(&str, u32)> = original
            .arcs
            .iter()
            .filter_map(|(p, c, e)| {
                if *p != orig_id {
                    return None;
                }
                e.name.as_ref().map(|n| (n.as_ref(), *c))
            })
            .collect();
        let rep_children: Vec<(&str, u32)> = reparsed
            .arcs
            .iter()
            .filter_map(|(p, c, e)| {
                if *p != rep_id {
                    return None;
                }
                e.name.as_ref().map(|n| (n.as_ref(), *c))
            })
            .collect();

        // For each reparsed child, find matching original by edge name.
        for (rep_name, rep_child) in &rep_children {
            if let Some((_, orig_child)) = orig_children.iter().find(|(on, _)| on == rep_name) {
                remap.entry(*rep_child).or_insert(*orig_child);
                stack.push((*orig_child, *rep_child));
            } else {
                // No match: assign a fresh id beyond original's max.
                remap.entry(*rep_child).or_insert_with(|| {
                    let id = next_fresh;
                    next_fresh = next_fresh.wrapping_add(1);
                    id
                });
            }
        }
    }

    // Any reparsed nodes still unmapped (e.g., disconnected) get fresh ids.
    for id in reparsed.nodes.keys() {
        remap.entry(*id).or_insert_with(|| {
            let fresh = next_fresh;
            next_fresh = next_fresh.wrapping_add(1);
            fresh
        });
    }

    // Build remapped nodes: clone each node, update its id field.
    let mut new_nodes = HashMap::new();
    for (old_id, node) in &reparsed.nodes {
        let new_id = *remap.get(old_id).expect("remap covers all nodes");
        let mut new_node = node.clone();
        new_node.id = new_id;
        new_nodes.insert(new_id, new_node);
    }

    let new_arcs: Vec<_> = reparsed
        .arcs
        .iter()
        .map(|(p, c, e)| {
            (
                *remap.get(p).unwrap_or(p),
                *remap.get(c).unwrap_or(c),
                e.clone(),
            )
        })
        .collect();

    // Fans: remap parent and child ids by the same map.
    let new_fans: Vec<_> = reparsed
        .fans
        .iter()
        .map(|fan| {
            let mut f = fan.clone();
            if let Some(&new_parent) = remap.get(&f.parent) {
                f.parent = new_parent;
            }
            let mut new_children = HashMap::new();
            for (k, v) in &f.children {
                new_children.insert(k.clone(), *remap.get(v).unwrap_or(v));
            }
            f.children = new_children;
            f
        })
        .collect();

    let new_root = *remap.get(&reparsed.root).unwrap_or(&reparsed.root);

    WInstance::new(
        new_nodes,
        new_arcs,
        new_fans,
        new_root,
        reparsed.schema_root.clone(),
    )
}
