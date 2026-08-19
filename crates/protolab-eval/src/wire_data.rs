//! Per-wire data computation via prefix instantiation.
//!
//! For each prefix of the protolens chain, we instantiate against the
//! source schema and call `panproto_lens::asymmetric::get` on the input.
//! The intermediate `view` IS the data flowing through that wire.

use std::collections::HashMap;

use panproto_gat::Name;
use panproto_inst::{FieldTransform, WInstance};
use panproto_lens::asymmetric::{Complement, get, put};
use panproto_lens::protolens::ProtolensChain;
use panproto_schema::{Protocol, Schema};

use protolab_core::topo::topological_sort;

use crate::error::EvalError;
use crate::expr_ops::{ExprOp, apply_forward_ops, apply_inverse_ops, remap_view_ids_by_anchor};
use crate::protolens_for_component::{circuit_to_chain_and_transforms, find_root_vertex};

/// Result of a forward evaluation pass over a circuit.
pub struct ForwardEvaluation {
    /// Final output instance after all components have been applied.
    pub output: WInstance,
    /// Target schema after the full chain — needed to render `output` to JSON.
    pub output_schema: Schema,
    /// Intermediate instance at each component output (keyed by component ID,
    /// since each component has one outgoing data wire in the linear case).
    pub wire_data: HashMap<String, WInstance>,
    /// Per-wire target schemas, parallel to `wire_data`. Each component's wire
    /// renders against its own prefix-lens's `tgt_schema`.
    pub wire_schemas: HashMap<String, Schema>,
    /// Stored complement from the full chain — used by backward pass.
    pub complement: Complement,
    /// The forward view (output of `get` on the final lens), with
    /// original node IDs. Our per-step evaluation pipeline calls
    /// `get()` at each component, producing complement node IDs that
    /// correspond to the per-step view — NOT to a freshly-parsed view
    /// from `parse_json`. Storing and modifying this view in-place
    /// for `put()` ensures IDs match and v0.34.1's
    /// `propagate_view_edits_through_inverse` fires correctly.
    pub final_view: panproto_inst::WInstance,
    /// Cached lens for backward pass (to avoid re-instantiating).
    pub final_lens: panproto_lens::Lens,
    /// Expression ops applied to the view in forward order, kept so the
    /// backward pass (`put_view`) can re-apply inverses in reverse order.
    pub(crate) expr_ops: Vec<ExprOp>,
}

/// Run forward evaluation: compute final output and per-wire intermediates.
///
/// This is a thin wrapper:
/// 1. Convert circuit → ProtolensChain (existing function)
/// 2. For each prefix length 1..=N:
///    a. Build a sub-chain of the first i steps
///    b. Instantiate against the source schema (existing panproto call)
///    c. Call `get(lens, input)` (existing panproto call)
///    d. Store the resulting view as the wire data after component i
/// 3. The final iteration's view = the circuit's output
pub fn wire_data_for_circuit(
    circuit: &Schema,
    source_schema: &Schema,
    source_protocol: &Protocol,
    input: &WInstance,
) -> Result<ForwardEvaluation, EvalError> {
    let (chain, _final_transforms) = circuit_to_chain_and_transforms(circuit, Some(source_schema))?;
    let sorted_components = topological_sort(circuit)?;

    let parent_vertex = find_root_vertex(source_schema)
        .ok_or_else(|| EvalError::Lens("source schema has no root vertex".into()))?;

    // Split per-component work into structural field_transforms (installed
    // on the compiled lens) and expression ops (applied manually to the
    // view after `get`). See `expr_ops.rs` for why expression-based
    // components are handled outside of the field_transforms mechanism.
    let per_component_transforms = build_per_component_transforms(circuit, &sorted_components)?;
    let per_component_ops = build_per_component_ops(circuit, &sorted_components)?;

    let mut wire_data: HashMap<String, WInstance> = HashMap::new();
    let mut wire_schemas: HashMap<String, Schema> = HashMap::new();

    if chain.steps.is_empty() {
        // Empty chain: either a fully empty circuit, or one containing only
        // expression-based components. Build an identity lens and apply any
        // accumulated expression ops manually to the view.
        let flat_transforms: Vec<FieldTransform> =
            per_component_transforms.iter().flatten().cloned().collect();
        let mut lens = chain
            .instantiate(source_schema, source_protocol)
            .map_err(|e| EvalError::Lens(e.to_string()))?;
        install_field_transforms(&mut lens, &parent_vertex, &flat_transforms);
        let (mut view, complement) =
            get(&lens, input).map_err(|e| EvalError::Lens(e.to_string()))?;
        let output_schema = lens.tgt_schema.clone();

        let flat_ops: Vec<ExprOp> = per_component_ops.iter().flatten().cloned().collect();
        apply_forward_ops(&mut view, &flat_ops)?;

        // Accumulated prefix ops for per-wire intermediates.
        let mut acc_ops: Vec<ExprOp> = Vec::new();
        let mut acc_transforms: Vec<FieldTransform> = Vec::new();
        for ((comp_id, comp_transforms), comp_ops) in sorted_components
            .iter()
            .zip(per_component_transforms.iter())
            .zip(per_component_ops.iter())
        {
            if comp_transforms.is_empty() && comp_ops.is_empty() {
                continue;
            }
            acc_transforms.extend(comp_transforms.iter().cloned());
            acc_ops.extend(comp_ops.iter().cloned());
            let mut prefix_lens = chain
                .instantiate(source_schema, source_protocol)
                .map_err(|e| EvalError::Lens(e.to_string()))?;
            install_field_transforms(&mut prefix_lens, &parent_vertex, &acc_transforms);
            let (mut pview, _) =
                get(&prefix_lens, input).map_err(|e| EvalError::Lens(e.to_string()))?;
            apply_forward_ops(&mut pview, &acc_ops)?;
            wire_schemas.insert(comp_id.to_string(), prefix_lens.tgt_schema.clone());
            wire_data.insert(comp_id.to_string(), pview);
        }

        let final_view = view.clone();
        return Ok(ForwardEvaluation {
            output: view,
            output_schema,
            wire_data,
            wire_schemas,
            complement,
            final_view,
            final_lens: lens,
            expr_ops: flat_ops,
        });
    }

    // Non-empty chain path: interleave chain prefixes with expression ops.
    let steps_per_component = compute_steps_per_component(circuit, &sorted_components, &chain)?;

    let mut step_idx = 0usize;
    let mut accumulated_transforms: Vec<FieldTransform> = Vec::new();
    let mut accumulated_ops: Vec<ExprOp> = Vec::new();
    let mut last_view: Option<WInstance> = None;
    let mut last_complement: Option<Complement> = None;

    for (((comp_id, n_steps), comp_transforms), comp_ops) in sorted_components
        .iter()
        .zip(steps_per_component.iter())
        .zip(per_component_transforms.iter())
        .zip(per_component_ops.iter())
    {
        step_idx += n_steps;
        accumulated_transforms.extend(comp_transforms.iter().cloned());
        accumulated_ops.extend(comp_ops.iter().cloned());
        if step_idx == 0 && comp_transforms.is_empty() && comp_ops.is_empty() {
            continue;
        }
        let prefix_steps: Vec<_> = chain.steps.iter().take(step_idx).cloned().collect();
        let prefix = ProtolensChain::new(prefix_steps);
        let mut lens = prefix
            .instantiate(source_schema, source_protocol)
            .map_err(|e| EvalError::Lens(e.to_string()))?;
        install_field_transforms(&mut lens, &parent_vertex, &accumulated_transforms);
        let (mut view, complement) =
            get(&lens, input).map_err(|e| EvalError::Lens(e.to_string()))?;
        apply_forward_ops(&mut view, &accumulated_ops)?;
        wire_schemas.insert(comp_id.to_string(), lens.tgt_schema.clone());
        wire_data.insert(comp_id.to_string(), view.clone());
        last_view = Some(view);
        last_complement = Some(complement);
    }

    // Final lens for backward pass = the full chain with all transforms.
    let mut final_lens = chain
        .instantiate(source_schema, source_protocol)
        .map_err(|e| EvalError::Lens(e.to_string()))?;
    install_field_transforms(&mut final_lens, &parent_vertex, &accumulated_transforms);
    let output_schema = final_lens.tgt_schema.clone();

    let final_view = {
        let (view, _) = get(&final_lens, input).map_err(|e| EvalError::Lens(e.to_string()))?;
        view
    };

    Ok(ForwardEvaluation {
        output: last_view.unwrap_or_else(|| input.clone()),
        output_schema,
        wire_data,
        wire_schemas,
        complement: last_complement.unwrap_or_else(Complement::empty),
        final_view,
        final_lens,
        expr_ops: accumulated_ops,
    })
}

/// Backward pass for a circuit evaluation.
///
/// Takes a (possibly modified) view that the caller has re-parsed via
/// `panproto_inst::parse::parse_json`, remaps its node ids to align with
/// the forward view's ids (so `panproto_lens::asymmetric::put` can match
/// anchors via the complement's stored `arc_edges` / `original_parent`),
/// applies any recorded expression ops in reverse order with their
/// inverses, and finally delegates to `panproto_lens::asymmetric::put`.
///
/// Use this instead of calling `panproto_lens::asymmetric::put` directly
/// whenever the circuit contains expression-based components or the view
/// has been round-tripped through JSON (which reassigns node ids).
pub fn put_view(
    eval: &ForwardEvaluation,
    reparsed_view: &WInstance,
) -> Result<WInstance, EvalError> {
    let mut remapped = remap_view_ids_by_anchor(reparsed_view, &eval.output);
    apply_inverse_ops(&mut remapped, &eval.expr_ops)?;
    put(&eval.final_lens, &remapped, &eval.complement).map_err(|e| EvalError::Lens(e.to_string()))
}

/// Per-component value-level transforms in topo order.
///
/// Expression-based components (`apply_expr`, `coerce_type`,
/// `compute_field`) are intentionally EXCLUDED here — they are handled via
/// [`crate::expr_ops`] against the view after `get`, rather than via
/// `FieldTransform` on the compiled lens. See `expr_ops.rs` for rationale.
fn build_per_component_transforms(
    circuit: &Schema,
    sorted: &[Name],
) -> Result<Vec<Vec<FieldTransform>>, EvalError> {
    let mut out = Vec::with_capacity(sorted.len());
    // Accumulated field renames from upstream `rename_field` components,
    // mapping a post-rename name back to the name it carries in the source
    // frame. See `rewrite_into_source_frame`.
    let mut to_source_frame: HashMap<String, String> = HashMap::new();
    for comp_id in sorted {
        let comp_type = component_type(circuit, comp_id);
        if matches!(
            comp_type.as_str(),
            "apply_expr" | "coerce_type" | "compute_field"
        ) {
            // Still run the parser to surface ExprParse errors early, then
            // drop the result — the ops list is what we actually use.
            let _ = crate::expr_ops::component_to_expr_op(circuit, comp_id, &comp_type)?;
            // Also install the legacy `FieldTransform::ApplyExpr` /
            // `ComputeField` on the compiled lens so that
            // `panproto_lens::asymmetric::put` called directly (i.e.
            // without going through `protolab_eval::put_view`) still
            // recovers the original value via the complement's
            // `original_extra_fields` snapshot. `expr_ops.rs` takes care
            // of writing the value into the CHILD node and handling the
            // re-parsed-view backward pass.
            let transforms = crate::protolens_for_component::component_to_field_transforms_pub(
                circuit, comp_id, &comp_type,
            )?
            .unwrap_or_default();
            out.push(
                transforms
                    .into_iter()
                    .map(|t| rewrite_into_source_frame(t, &to_source_frame))
                    .collect(),
            );
            continue;
        }
        let transforms = crate::protolens_for_component::component_to_field_transforms_pub(
            circuit, comp_id, &comp_type,
        )?
        .unwrap_or_default();
        if comp_type == "rename_field" {
            record_rename(circuit, comp_id, &mut to_source_frame);
        }
        out.push(transforms);
    }
    Ok(out)
}

/// Record a `rename_field` component's mapping, composing through any
/// earlier rename of the same field so the map always lands on the name
/// the field carries in the *source* schema.
fn record_rename(circuit: &Schema, comp_id: &Name, to_source_frame: &mut HashMap<String, String>) {
    let (Some(old), Some(new)) = (
        find_param(circuit, comp_id, "old_name"),
        find_param(circuit, comp_id, "new_name"),
    ) else {
        return;
    };
    // `a → b` then `b → c` must resolve `c` to `a`, not to `b`.
    let origin = to_source_frame.get(&old).cloned().unwrap_or(old);
    to_source_frame.insert(new, origin);
}

fn find_param(circuit: &Schema, comp_id: &Name, key: &str) -> Option<String> {
    circuit
        .constraints
        .get(comp_id)?
        .iter()
        .find(|c| c.sort.as_ref() == format!("param:{key}"))
        .map(|c| c.value.clone())
        .filter(|v| !v.is_empty())
}

/// Rewrite an expression transform's free variables into the source frame.
///
/// The authoritative evaluation of an expression component happens in
/// [`crate::expr_ops`], against the view produced by `get` — where an
/// upstream `rename_field` has already landed, so the user's expression
/// correctly names the renamed field. The copy installed on the compiled
/// lens exists only so a direct `panproto_lens::asymmetric::put` can
/// recover the original value from the complement, and panproto evaluates
/// it against the *source* fiber, where the renamed name does not exist.
///
/// Up to panproto 0.38 that mismatch was invisible: `apply_field_transforms`
/// discarded an unevaluable expression and returned success, so the
/// installed copy quietly no-op'd and `expr_ops` supplied the real value.
/// panproto 0.57 reports the failure instead (`FieldTransformFailed`),
/// which aborts `get` before `expr_ops` ever runs. Substituting each
/// upstream-renamed variable back to its source name makes the installed
/// copy evaluate in the frame it is actually given. The substitution is
/// value-preserving because a rename moves a value without changing it.
///
/// This is *not* the upstream composition bug (panproto#245/#251), which
/// is fixed as of 0.68: `compose` now conjugates the field coordinate
/// through `m1`'s `edge_remap`, and a `ProtolensChain::instantiate`d lens
/// records that map. Verified against 0.68 — composing two lenses is
/// functorial, and naming a field the first one took away is rejected at
/// compose time with `ComposeUnboundField`.
///
/// The conjugation survives because protolab never composes. A circuit is
/// flattened into a single `ProtolensChain`, instantiated once, and every
/// component's value transforms are installed onto that one migration by
/// `install_field_transforms`. Within a single migration all transforms
/// are, by construction, in its source frame — there is no second frame
/// for `compose_field_transforms` to conjugate between, so the upstream
/// repair cannot fire here. Dropping this would require protolab to build
/// a migration per component and compose them, which is a real
/// restructuring of the evaluation pipeline rather than a deletion.
fn rewrite_into_source_frame(
    transform: FieldTransform,
    to_source_frame: &HashMap<String, String>,
) -> FieldTransform {
    if to_source_frame.is_empty() {
        return transform;
    }
    let rewrite = |e: panproto_expr::Expr| -> panproto_expr::Expr {
        // Collected first, then applied, so a swap `{a → b, b → a}` does
        // not collapse the way sequential substitution would.
        let subs: Vec<(std::sync::Arc<str>, &String)> = panproto_expr::free_vars(&e)
            .iter()
            .filter_map(|v| to_source_frame.get(&**v).map(|origin| (v.clone(), origin)))
            .collect();
        let mut acc = e;
        let mut staged: Vec<(std::sync::Arc<str>, std::sync::Arc<str>)> = Vec::new();
        for (i, (var, origin)) in subs.iter().enumerate() {
            // Park each rewrite on a fresh name first, so an earlier
            // substitution cannot be re-captured by a later one.
            let tmp: std::sync::Arc<str> =
                std::sync::Arc::from(format!("__protolab_swap_{i}__").as_str());
            acc = panproto_expr::substitute(
                &acc,
                var,
                &panproto_expr::Expr::Var(std::sync::Arc::clone(&tmp)),
            );
            staged.push((tmp, std::sync::Arc::from(origin.as_str())));
        }
        for (tmp, origin) in staged {
            acc = panproto_expr::substitute(&acc, &tmp, &panproto_expr::Expr::Var(origin));
        }
        acc
    };
    match transform {
        FieldTransform::ApplyExpr {
            key,
            expr,
            inverse,
            coercion_class,
        } => FieldTransform::ApplyExpr {
            // `key` names the field being edited, which for an
            // `apply_expr` downstream of a rename is the renamed one.
            key: to_source_frame.get(&key).cloned().unwrap_or(key),
            expr: rewrite(expr),
            inverse: inverse.map(rewrite),
            coercion_class,
        },
        FieldTransform::ComputeField {
            target_key,
            expr,
            inverse,
            coercion_class,
        } => FieldTransform::ComputeField {
            // The target is a *new* key, not one the rename touched, so it
            // is left alone; only the expression reads source-frame names.
            target_key,
            expr: rewrite(expr),
            inverse: inverse.map(rewrite),
            coercion_class,
        },
        other => other,
    }
}


/// Per-component expression ops in topo order. Non-expression components
/// contribute an empty list.
fn build_per_component_ops(
    circuit: &Schema,
    sorted: &[Name],
) -> Result<Vec<Vec<ExprOp>>, EvalError> {
    let mut out = Vec::with_capacity(sorted.len());
    for comp_id in sorted {
        let comp_type = component_type(circuit, comp_id);
        let op = crate::expr_ops::component_to_expr_op(circuit, comp_id, &comp_type)?;
        out.push(op.into_iter().collect());
    }
    Ok(out)
}

fn component_type(circuit: &Schema, comp_id: &Name) -> String {
    circuit
        .constraints
        .get(comp_id)
        .and_then(|cs| cs.iter().find(|c| c.sort.as_ref() == "component_type"))
        .map(|c| c.value.clone())
        .unwrap_or_default()
}

/// Merge the given transforms into the lens's compiled migration, keyed by
/// the source-schema parent vertex anchor (so they fire on the root node
/// during `wtype_restrict`).
fn install_field_transforms(
    lens: &mut panproto_lens::Lens,
    parent_vertex: &Name,
    transforms: &[FieldTransform],
) {
    if transforms.is_empty() {
        return;
    }
    lens.compiled
        .field_transforms
        .entry(parent_vertex.clone())
        .or_default()
        .extend(transforms.iter().cloned());
}

/// For each component in topo order, count how many protolens steps it
/// contributes to the chain. This lets us map step indices back to components.
fn compute_steps_per_component(
    circuit: &Schema,
    sorted: &[panproto_gat::Name],
    _chain: &ProtolensChain,
) -> Result<Vec<usize>, EvalError> {
    let mut counts = Vec::with_capacity(sorted.len());
    for comp_id in sorted {
        let comp_type = circuit
            .constraints
            .get(comp_id)
            .and_then(|cs| cs.iter().find(|c| c.sort.as_ref() == "component_type"))
            .map(|c| c.value.as_str())
            .unwrap_or("");
        let n = match comp_type {
            "rename_field" => 1,
            "add_field" => 2,
            "drop_field" => 1,
            "hoist_field" => 2,
            "nest_field" => 4,
            _ => 0,
        };
        counts.push(n);
    }
    Ok(counts)
}

#[cfg(test)]
mod tests {
    use crate::circuit_to_protolens_chain;

    #[test]
    fn empty_protolab_evaluates() {
        let circuit = protolab_schema::CircuitBuilder::new().build();
        let chain = circuit_to_protolens_chain(&circuit).unwrap();
        assert_eq!(chain.steps.len(), 0);
    }
}
