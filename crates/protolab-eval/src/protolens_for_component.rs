//! Map a circuit schema to a `ProtolensChain` by dispatching on
//! each component's `component_type` constraint.
//!
//! This file does NOT implement any lens logic — it just calls existing
//! `panproto_lens::protolens::combinators` functions.

use std::collections::HashMap;

use panproto_gat::Name;
use panproto_inst::FieldTransform;
use panproto_inst::value::Value;
use panproto_lens::protolens::{ProtolensChain, combinators};
use panproto_schema::Schema;

use protolab_core::topo::topological_sort;

use crate::error::EvalError;

/// Side-channel value-level transforms collected from `add_field`,
/// `rename_field`, and `drop_field` components. The chain combinators
/// in panproto-lens only mutate the schema graph; the WInstance content
/// has to be patched via `FieldTransform`s, which we install onto the
/// compiled migration after `chain.instantiate(...)`.
///
/// Keyed by **source** vertex anchor (the parent vertex of the field).
pub type FieldTransformMap = HashMap<Name, Vec<FieldTransform>>;

/// Convert a circuit schema to a `ProtolensChain` by topologically sorting
/// components and mapping each one to the corresponding panproto combinator.
///
/// Defaults to using `"root"` as the parent vertex name. For schema-aware
/// dispatch, use [`circuit_to_protolens_chain_with_schema`].
pub fn circuit_to_protolens_chain(circuit: &Schema) -> Result<ProtolensChain, EvalError> {
    circuit_to_protolens_chain_with_schema(circuit, None)
}

/// Convert a circuit schema to a `ProtolensChain`, looking up the parent
/// vertex from the source schema if provided.
pub fn circuit_to_protolens_chain_with_schema(
    circuit: &Schema,
    source_schema: Option<&Schema>,
) -> Result<ProtolensChain, EvalError> {
    let (chain, _) = circuit_to_chain_and_transforms(circuit, source_schema)?;
    Ok(chain)
}

/// Convert a circuit schema to both a `ProtolensChain` and a side-channel
/// `FieldTransformMap` of value-level mutations to install on the compiled
/// migration after instantiation. Use this when you need both the schema-
/// level transform AND the WInstance-level effects (which the panproto
/// chain combinators do not produce on their own for `add_field`, etc.).
pub fn circuit_to_chain_and_transforms(
    circuit: &Schema,
    source_schema: Option<&Schema>,
) -> Result<(ProtolensChain, FieldTransformMap), EvalError> {
    let sorted = topological_sort(circuit)?;
    let mut chains = Vec::with_capacity(sorted.len());
    let mut transforms: FieldTransformMap = HashMap::new();

    let parent_vertex = source_schema
        .and_then(find_root_vertex)
        .unwrap_or_else(|| Name::from("root"));

    // Tracks what each field name points at as the chain is built, so a
    // component naming a field an earlier component renamed resolves to the
    // right vertex.
    let mut fields = FieldVertexIndex::from_schema(source_schema, &parent_vertex);

    for comp_id in &sorted {
        let comp_type = find_constraint(circuit, comp_id, "component_type")
            .ok_or_else(|| EvalError::UnknownComponentType(comp_id.to_string()))?;

        let chain = component_to_chain(circuit, comp_id, &comp_type, &parent_vertex, &fields)?;
        fields.apply(circuit, comp_id, &comp_type, &parent_vertex);
        chains.push(chain);

        // Collect value-level effects for this component, keyed by the source
        // schema's parent vertex (so they hit the WInstance root node).
        // Errors here propagate to the user (e.g., expression parse errors).
        if let Some(ts) = component_to_field_transforms_inner(circuit, comp_id, &comp_type)? {
            transforms
                .entry(parent_vertex.clone())
                .or_default()
                .extend(ts);
        }
    }

    Ok((combinators::pipeline(chains), transforms))
}

/// Build the per-component `ProtolensChain` for a single component, using
/// the source schema's root vertex as the parent. Returns the chain (which
/// may be empty for unsupported component types) so callers can classify
/// it via `panproto_lens::optic::classify_transform` to derive the optic
/// kind without re-implementing per-type step-counting.
pub fn component_chain(
    circuit: &Schema,
    comp_id: &Name,
    source_schema: Option<&Schema>,
) -> Result<ProtolensChain, EvalError> {
    let parent_vertex = source_schema
        .and_then(find_root_vertex)
        .unwrap_or_else(|| Name::from("root"));
    let comp_type = find_constraint(circuit, comp_id, "component_type")
        .ok_or_else(|| EvalError::UnknownComponentType(comp_id.to_string()))?;
    // One component in isolation: the schema as given is the state it runs
    // against, with no earlier component having renamed anything.
    let fields = FieldVertexIndex::from_schema(source_schema, &parent_vertex);
    component_to_chain(circuit, comp_id, &comp_type, &parent_vertex, &fields)
}

/// Compute the **intrinsic optic kind** for a component. This is the
/// classification used by the UI palette badge — it accounts for both the
/// schema-level chain steps (`classify_transform`) AND the value-level
/// `FieldTransform`s (via their `CoercionClass` → `OpticKind` mapping).
///
/// Order of precedence (most specific first):
/// 1. Hardcoded carrier type for traversal-style components (`map_items`).
/// 2. Composition of all chain-step optic kinds via `classify_transform`.
/// 3. Composition with the field-transform coercion classes mapped to
///    `OpticKind`.
///
/// Returns `Iso` for an empty / unknown component (the identity element).
pub fn component_intrinsic_optic_kind(
    circuit: &Schema,
    comp_id: &Name,
    source_schema: Option<&Schema>,
) -> Result<panproto_lens::optic::OpticKind, EvalError> {
    use panproto_gat::CoercionClass;
    use panproto_lens::optic::{OpticKind, classify_transform};

    let comp_type = find_constraint(circuit, comp_id, "component_type").unwrap_or_default();

    // Carrier override: map_items is *always* a Traversal regardless of
    // its (currently empty) inner.
    if comp_type == "map_items" {
        return Ok(OpticKind::Traversal);
    }

    let chain = component_chain(circuit, comp_id, source_schema)?;
    let mut composed = OpticKind::Iso;
    for step in &chain.steps {
        composed = composed.compose(classify_transform(&step.target.transform));
    }

    // Mix in field-transform classes (used by coerce_type / apply_expr /
    // compute_field which have empty chains but non-trivial value effects).
    if let Some(transforms) = component_to_field_transforms_inner(circuit, comp_id, &comp_type)? {
        for ft in transforms {
            let class = ft.coercion_class();
            let kind = match class {
                CoercionClass::Iso => OpticKind::Iso,
                // Retraction / Projection / Opaque all have a left-or-no-
                // inverse character; the optic-laws table classifies them
                // as Lens (single-focus, possibly information-losing).
                _ => OpticKind::Lens,
            };
            composed = composed.compose(kind);
        }
    }

    Ok(composed)
}

/// Public, error-propagating accessor for per-component field transforms.
/// Used by [`crate::wire_data`] to assemble the lens's compiled migration
/// — when an expression-based component has malformed source, the error
/// surfaces all the way up to the UI rather than being silently lost.
pub fn component_to_field_transforms_pub(
    circuit: &Schema,
    comp_id: &Name,
    comp_type: &str,
) -> Result<Option<Vec<FieldTransform>>, EvalError> {
    component_to_field_transforms_inner(circuit, comp_id, comp_type)
}

/// Compute the value-level `FieldTransform`s for a single component.
///
/// Returns `Ok(None)` for components that have no value-level effect
/// (the chain alone suffices), `Ok(Some(_))` for components that need
/// additional field transforms, and `Err(_)` if expression parsing
/// fails for the expression-based components.
///
/// Mapping:
/// - `add_field` → `AddField { key, default }` so the new field appears
///   in the parent's `extra_fields`.
/// - `drop_field` → `DropField { key }` so any `extra_fields` copy is
///   removed alongside the schema-level vertex drop.
/// - `rename_field` → `RenameField { old, new }` so an `extra_fields`
///   entry (e.g., produced by an upstream `add_field`) is renamed too;
///   schema-edge renames already happen via `RenameEdgeName`.
/// - `coerce_type` and `apply_expr` → `ApplyExpr` on the named field with
///   the parsed `panproto-expr` expression. The default coercion class is
///   `Iso` when an `inverse` expression is present, otherwise the user's
///   `coercion` param wins (default `Retraction` — the forward map is
///   information-preserving but the inverse is not the structural
///   inverse of the forward).
/// - `compute_field` → `ComputeField` writing the parsed expression's
///   result into the target key. Default coercion class is `Projection`
///   (deterministic derivation, no inverse) unless an `inverse` is
///   provided, in which case it's `Iso`.
fn component_to_field_transforms_inner(
    circuit: &Schema,
    comp_id: &Name,
    comp_type: &str,
) -> Result<Option<Vec<FieldTransform>>, EvalError> {
    use panproto_gat::CoercionClass;

    match comp_type {
        "add_field" => {
            let Some(name) = optional_param(circuit, comp_id, "field_name") else {
                return Ok(None);
            };
            let kind = optional_param(circuit, comp_id, "field_kind")
                .unwrap_or_else(|| "string".to_owned());
            let default_str = optional_param(circuit, comp_id, "default").unwrap_or_default();
            let value = parse_default_value(&default_str, &kind);
            Ok(Some(vec![FieldTransform::AddField { key: name, value }]))
        }
        "drop_field" => {
            let Some(name) = optional_param(circuit, comp_id, "field_name") else {
                return Ok(None);
            };
            Ok(Some(vec![FieldTransform::DropField { key: name }]))
        }
        "rename_field" => {
            let (Some(old), Some(new)) = (
                optional_param(circuit, comp_id, "old_name"),
                optional_param(circuit, comp_id, "new_name"),
            ) else {
                return Ok(None);
            };
            Ok(Some(vec![FieldTransform::RenameField {
                old_key: old,
                new_key: new,
            }]))
        }
        "coerce_type" | "apply_expr" => {
            let field = match optional_param(circuit, comp_id, "field") {
                Some(f) if !f.is_empty() => f,
                _ => return Ok(None), // No field configured → no-op
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
            // Default class: Iso if invertible (round-trips perfectly),
            // Retraction otherwise (forward is injective, no structural
            // inverse). The user can override via the `coercion` param.
            let default_class = if inverse.is_some() {
                CoercionClass::Iso
            } else {
                CoercionClass::Retraction
            };
            let coercion_class = parse_coercion_class(
                optional_param(circuit, comp_id, "coercion").as_deref(),
                default_class,
            );
            Ok(Some(vec![FieldTransform::ApplyExpr {
                key: field,
                expr,
                inverse,
                coercion_class,
            }]))
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
            let default_class = if inverse.is_some() {
                CoercionClass::Iso
            } else {
                CoercionClass::Projection
            };
            let coercion_class = parse_coercion_class(
                optional_param(circuit, comp_id, "coercion").as_deref(),
                default_class,
            );
            Ok(Some(vec![FieldTransform::ComputeField {
                target_key: target,
                expr,
                inverse,
                coercion_class,
            }]))
        }
        _ => Ok(None),
    }
}

/// Find the root vertex of a schema. Delegates to
/// [`panproto_schema::primary_entry`] (added in panproto v0.32.0),
/// which canonicalises the basepoint via the schema's declared
/// `entries` family and falls back to a topology-based heuristic
/// only when entries weren't supplied. This replaces our own
/// "no-incoming-edges, prefer object kind" heuristic that
/// deterministically picked the wrong vertex on schemas like
/// `app.bsky.feed.post` (it landed on `#replyRef` because it had no
/// inbound arrow before the upstream parser fix in panproto#35).
///
/// Atproto-lexicon adjustment: the lexicon parser wraps every record
/// with an intermediate `:body` vertex reached by a single anonymous
/// `record-schema` edge. Input JSON (`{"text":"hi",...}`) corresponds
/// to the body's properties, not to the record wrapper's single
/// child, so feeding the wrapper vertex to `parse_json` makes the
/// round-trip collapse — `is_list_vertex` treats the unnamed edge as
/// a list slot and `to_json` emits `[]`. When the entry is a record
/// wrapper we therefore step through to the body; callers that want
/// the wrapper can use `panproto_schema::primary_entry` directly.
pub fn find_root_vertex(schema: &Schema) -> Option<Name> {
    let primary = panproto_schema::primary_entry(schema).cloned()?;
    Some(descend_record_wrapper(schema, primary))
}

/// If `vertex` has exactly one outgoing edge and that edge's kind is
/// `"record-schema"`, return the edge's target; otherwise return
/// `vertex` unchanged. This unwraps the atproto-lexicon record
/// wrapper so JSON round-trips hit the body vertex.
fn descend_record_wrapper(schema: &Schema, vertex: Name) -> Name {
    let edges = schema.outgoing_edges(vertex.as_str());
    if edges.len() == 1 && edges[0].kind.as_str() == "record-schema" {
        return edges[0].tgt.clone();
    }
    vertex
}

/// Which vertex each field name at the parent currently points at.
///
/// Component params name *fields*, but the combinators take the *vertex* a
/// field's edge points at. Those were previously assumed to line up as
/// `{parent}.{field}`, which holds for a freshly parsed schema and stops
/// holding the moment a chain renames anything: `RenameEdgeName` changes
/// the edge's name and leaves the vertex id alone. A second component
/// naming the field by its new name then computed a vertex that does not
/// exist, and the combinator silently did nothing — `a → b` followed by
/// `b → c` produced `b`, with no error. A swap could not be expressed at
/// all.
///
/// Reading the mapping off the schema and re-keying it as the chain is
/// built fixes that, and also stops the convention from being load-bearing
/// for schemas whose vertex ids do not follow it.
#[derive(Default)]
struct FieldVertexIndex {
    by_field: HashMap<String, Name>,
}

impl FieldVertexIndex {
    /// Read the fields reachable from `parent` in `schema`.
    fn from_schema(schema: Option<&Schema>, parent: &Name) -> Self {
        let mut by_field = HashMap::new();
        if let Some(schema) = schema {
            if let Some(edges) = schema.outgoing.get(parent) {
                for edge in edges {
                    if let Some(name) = &edge.name {
                        by_field.insert(name.to_string(), edge.tgt.clone());
                    }
                }
            }
        }
        Self { by_field }
    }

    /// The vertex `field` names, falling back to the `{parent}.{field}`
    /// convention when the schema does not say — which covers a circuit
    /// built with no source schema assigned, and a field an earlier
    /// component introduced.
    fn vertex_for(&self, field: &str, parent: &Name) -> Name {
        self.by_field
            .get(field)
            .cloned()
            .unwrap_or_else(|| Name::from(format!("{parent}.{field}").as_str()))
    }

    /// Fold a component's effect on the field-to-vertex mapping, so the
    /// next component sees the names the schema will actually carry by the
    /// time its step runs.
    fn apply(&mut self, circuit: &Schema, comp_id: &Name, comp_type: &str, parent: &Name) {
        match comp_type {
            "rename_field" => {
                let (Some(old), Some(new)) = (
                    optional_param(circuit, comp_id, "old_name"),
                    optional_param(circuit, comp_id, "new_name"),
                ) else {
                    return;
                };
                // The vertex is unchanged; only the name reaching it moves.
                let vertex = self.vertex_for(&old, parent);
                self.by_field.remove(&old);
                self.by_field.insert(new, vertex);
            }
            "add_field" => {
                if let Some(name) = optional_param(circuit, comp_id, "field_name") {
                    let vertex = Name::from(format!("{parent}.{name}").as_str());
                    self.by_field.insert(name, vertex);
                }
            }
            "drop_field" => {
                if let Some(name) = optional_param(circuit, comp_id, "field_name") {
                    self.by_field.remove(&name);
                }
            }
            _ => {}
        }
    }
}

/// Map a single component to a `ProtolensChain` based on its type and params.
fn component_to_chain(
    circuit: &Schema,
    comp_id: &Name,
    comp_type: &str,
    parent: &Name,
    fields: &FieldVertexIndex,
) -> Result<ProtolensChain, EvalError> {
    match comp_type {
        "rename_field" => {
            let old = require_param(comp_id, circuit, "old_name")?;
            let new = require_param(comp_id, circuit, "new_name")?;
            let field_vertex = fields.vertex_for(&old, parent);
            Ok(combinators::rename_field(
                parent.clone(),
                field_vertex,
                Name::from(old.as_str()),
                Name::from(new.as_str()),
            ))
        }
        "add_field" => {
            let name = require_param(comp_id, circuit, "field_name")?;
            let kind = optional_param(circuit, comp_id, "field_kind")
                .unwrap_or_else(|| "string".to_owned());
            let default_str = optional_param(circuit, comp_id, "default").unwrap_or_default();
            let default_value = parse_default_value(&default_str, &kind);

            // Use a unique vertex ID for the new field.
            let field_vertex = Name::from(format!("{parent}.{name}").as_str());
            Ok(combinators::add_field(
                parent.clone(),
                field_vertex,
                Name::from(kind.as_str()),
                default_value,
            ))
        }
        "drop_field" => {
            let name = require_param(comp_id, circuit, "field_name")?;
            let field_vertex = fields.vertex_for(&name, parent);
            Ok(combinators::remove_field(field_vertex))
        }
        "hoist_field" => {
            let parent_p =
                optional_param(circuit, comp_id, "parent").unwrap_or_else(|| parent.to_string());
            let intermediate = require_param(comp_id, circuit, "intermediate")?;
            let child = require_param(comp_id, circuit, "child")?;
            Ok(combinators::hoist_field(
                Name::from(parent_p.as_str()),
                Name::from(intermediate.as_str()),
                Name::from(child.as_str()),
            ))
        }
        "nest_field" => {
            // The `child` param is the short edge name (e.g., "name"),
            // matching the UX convention of other structural components.
            // Real vertex ids in source schemas are usually qualified —
            // `SchemaBuilder::add_prop`-style schemas name a field's
            // vertex `parent.child`. We build that qualified id here.
            //
            // panproto ≥ 0.27.2's `combinators::nest_field` takes the
            // original edge name (the user-facing JSON key = `child`)
            // AND the two new intermediate edge names independently
            // from the vertex ids. Before 0.27.2 this combinator
            // conflated child vertex id with edge label and silently
            // produced an invalid chain for qualified-id schemas; see
            // panproto/panproto#23.
            let parent_p =
                optional_param(circuit, comp_id, "parent").unwrap_or_else(|| parent.to_string());
            let child = require_param(comp_id, circuit, "child")?;
            let wrapper = require_param(comp_id, circuit, "wrapper")?;
            let child_vertex = Name::from(format!("{parent_p}.{child}").as_str());
            Ok(combinators::nest_field(
                Name::from(parent_p.as_str()),
                child_vertex,
                Name::from(wrapper.as_str()),
                Name::from("object"),
                Name::from("prop"),
                // The original edge carries `child` as its JSON label.
                Some(Name::from(child.as_str())),
                // parent -> wrapper edge gets the wrapper name as its
                // JSON key (so nesting `name` under `profile` produces
                // `{"profile": {"name": "..."}}`).
                Name::from(wrapper.as_str()),
                // wrapper -> child edge keeps the original field name.
                Name::from(child.as_str()),
            ))
        }
        // Expression-based components: their *schema* is unchanged so the
        // chain is empty. Their value-level effect is installed via
        // `component_to_field_transforms` (parsed `panproto-expr`
        // expressions become `FieldTransform::ApplyExpr` /
        // `FieldTransform::ComputeField`).
        "coerce_type" | "apply_expr" | "compute_field" => Ok(ProtolensChain::new(vec![])),
        // Collection traversal: scoped over each element of the focus
        // array vertex. With no inner sub-circuit (protolab doesn't
        // surface inner protolenses through the UI yet), the chain is
        // empty and the carrier optic is reported as `Traversal` by
        // `compute_per_component_optics` directly. Once a sub-circuit
        // affordance lands, the inner protolens will be wrapped via
        // `combinators::map_items(focus, inner)`.
        "map_items" => {
            // Validate that the focus param is present so misconfigured
            // circuits surface an error rather than silently doing nothing.
            require_param(comp_id, circuit, "focus")?;
            Ok(ProtolensChain::new(vec![]))
        }
        other => Err(EvalError::UnknownComponentType(other.to_owned())),
    }
}

/// Parse a `panproto-expr` source string into an `Expr`, attaching the
/// component id + field name to any error so users can locate the issue.
fn parse_expr_field(
    component: &Name,
    field: &str,
    src: &str,
) -> Result<panproto_expr::Expr, EvalError> {
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

/// Parse the optional `coercion` param into a [`panproto_gat::CoercionClass`].
///
/// Recognized values (case-insensitive): `iso`, `retraction`, `projection`,
/// `opaque`. Unknown / missing → `default_class`.
fn parse_coercion_class(
    raw: Option<&str>,
    default_class: panproto_gat::CoercionClass,
) -> panproto_gat::CoercionClass {
    use panproto_gat::CoercionClass;
    match raw.map(str::to_ascii_lowercase).as_deref() {
        Some("iso") => CoercionClass::Iso,
        Some("retraction") => CoercionClass::Retraction,
        Some("projection") => CoercionClass::Projection,
        Some("opaque") => CoercionClass::Opaque,
        _ => default_class,
    }
}

fn parse_default_value(s: &str, kind: &str) -> Value {
    if s.is_empty() {
        return match kind {
            "string" => Value::Str(String::new()),
            "integer" | "int" => Value::Int(0),
            "boolean" | "bool" => Value::Bool(false),
            _ => Value::Null,
        };
    }
    match kind {
        "integer" | "int" => s.parse::<i64>().map(Value::Int).unwrap_or(Value::Null),
        "boolean" | "bool" => s.parse::<bool>().map(Value::Bool).unwrap_or(Value::Null),
        "float" | "number" => s.parse::<f64>().map(Value::Float).unwrap_or(Value::Null),
        _ => Value::Str(s.to_owned()),
    }
}

fn find_constraint(circuit: &Schema, vertex: &Name, sort: &str) -> Option<String> {
    circuit
        .constraints
        .get(vertex)?
        .iter()
        .find(|c| c.sort.as_ref() == sort)
        .map(|c| c.value.clone())
}

fn optional_param(circuit: &Schema, comp_id: &Name, key: &str) -> Option<String> {
    find_constraint(circuit, comp_id, &format!("param:{key}"))
}

fn require_param(comp_id: &Name, circuit: &Schema, key: &str) -> Result<String, EvalError> {
    optional_param(circuit, comp_id, key)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| EvalError::MissingParam {
            component: comp_id.to_string(),
            key: key.to_owned(),
        })
}

#[cfg(test)]
mod tests {
    use protolab_schema::builder::demo_circuit;

    use super::*;

    #[test]
    fn demo_circuit_produces_chain() {
        let circuit = demo_circuit();
        let chain = circuit_to_protolens_chain(&circuit).unwrap();
        assert!(chain.steps.len() >= 3);
    }

    #[test]
    fn empty_circuit_produces_empty_chain() {
        let circuit = protolab_schema::CircuitBuilder::new().build();
        let chain = circuit_to_protolens_chain(&circuit).unwrap();
        assert_eq!(chain.steps.len(), 0);
    }

    #[test]
    fn find_root_vertex_descends_atproto_record_wrapper() {
        // Minimal atproto-lexicon-shaped schema: a record vertex with a
        // single anonymous `record-schema` edge to a `:body` object
        // vertex, which in turn has named prop edges. Before the
        // descent fix, `find_root_vertex` returned the record wrapper
        // and callers fed it to `parse_json`/`to_json`, which treated
        // the unnamed record-schema edge as a list slot and collapsed
        // every round-trip to `[]`.
        let bsky_lexicon = r#"{
            "id": "app.bsky.feed.post",
            "defs": {
                "main": {
                    "type": "record",
                    "key": "tid",
                    "record": {
                        "type": "object",
                        "required": ["text"],
                        "properties": {
                            "text": { "type": "string" }
                        }
                    }
                }
            }
        }"#;
        let lexicon: serde_json::Value = serde_json::from_str(bsky_lexicon).unwrap();
        let schema = panproto_protocols::web_document::atproto::parse_lexicon(&lexicon).unwrap();
        let root = find_root_vertex(&schema).expect("root");
        assert_eq!(
            root.as_str(),
            "app.bsky.feed.post:body",
            "find_root_vertex must step past the record wrapper; landed on {root}",
        );
    }
}
