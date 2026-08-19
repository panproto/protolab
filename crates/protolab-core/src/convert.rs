//! Bidirectional conversion between circuit schemas and lens DSL documents.
//!
//! - [`circuit_to_lens_document`]: extract a linear pipeline from a circuit
//! - [`lens_document_to_circuit`]: build a circuit from a lens document
//! - [`export_as_json`]: serialize circuit schema to JSON
//! - [`export_as_lens_json`]: convert to LensDocument, serialize to JSON
//! - [`export_as_lens_yaml`]: convert to LensDocument, format as YAML
//! - [`export_as_nickel`]: convert to LensDocument, format as Nickel

use panproto_gat::Name;
use panproto_lens_dsl::document::{
    AddFieldSpec, ApplyExprSpec, CoercionKind, ComputeFieldSpec, HoistSpec, LensDocument, NestSpec,
    RenameSpec, ScopedSpec, Step,
};
use panproto_schema::Schema;

use protolab_schema::{CircuitBuilder, CircuitError, Direction, TriggerMode};

use crate::topo;

/// Convert a circuit schema to a lens DSL [`LensDocument`].
///
/// Topologically sorts the components, then maps each component's
/// `component_type` constraint to a corresponding lens DSL [`Step`].
/// Because a `LensDocument` is a linear sequence of steps, the topo order
/// is the only lens-level serialization of the circuit; parallel branches
/// in the DAG become adjacent steps (the sequential composition that
/// respects the data-flow ordering). For non-linear DAGs where two
/// branches operate on disjoint fields, the resulting lens is still
/// correct because the combinator's operations commute on disjoint
/// focal points.
///
/// # Errors
///
/// Returns an error if the circuit has a cycle or an unsupported
/// component type.
pub fn circuit_to_lens_document(
    circuit: &Schema,
    doc_id: &str,
    source: &str,
    target: &str,
) -> Result<LensDocument, CircuitError> {
    let sorted = topo::topological_sort(circuit)?;

    let mut steps = Vec::new();
    for comp_id in &sorted {
        let comp_type = find_constraint(circuit, comp_id, "component_type").ok_or_else(|| {
            CircuitError::Conversion(format!("component {comp_id} has no component_type"))
        })?;

        let step = component_to_step(circuit, comp_id, &comp_type)?;
        steps.push(step);
    }

    Ok(LensDocument {
        id: doc_id.to_owned(),
        description: String::new(),
        source: source.to_owned(),
        target: target.to_owned(),
        steps: Some(steps),
        rules: None,
        compose: None,
        auto: None,
        from_diff: None,
        symmetric: None,
        directed_equations: None,
        passthrough: None,
        invertible: None,
        extensions: Default::default(),
    })
}

/// Convert a lens DSL document back to a circuit schema.
///
/// Each step becomes a component with input/output/parameter ports,
/// wired sequentially.
///
/// # Errors
///
/// Returns an error if a step type is unsupported.
pub fn lens_document_to_circuit(doc: &LensDocument) -> Result<Schema, CircuitError> {
    let steps = doc
        .steps
        .as_ref()
        .ok_or_else(|| CircuitError::Conversion(describe_missing_steps(doc)))?;

    let mut builder = CircuitBuilder::new();
    let mut prev_out_port: Option<String> = None;
    let mut wire_idx = 0;

    for (i, step) in steps.iter().enumerate() {
        let comp_id = format!("step_{i}");
        let (comp_type, optic) = step_metadata(step);

        builder = builder.add_component(&comp_id, comp_type)?;

        let in_port = format!("{comp_id}.in");
        let out_port = format!("{comp_id}.out");
        let param_port = format!("{comp_id}.param");

        builder = builder
            .add_port(&in_port, &comp_id, Direction::Input, TriggerMode::Hot)?
            .add_port(&out_port, &comp_id, Direction::Output, TriggerMode::Hot)?
            .add_port(
                &param_port,
                &comp_id,
                Direction::Parameter,
                TriggerMode::Cold,
            )?;

        // Restore params from the step spec so the round-trip
        // LensDocument ⇄ Circuit preserves all component data.
        for (key, value) in step_params(step) {
            builder = builder.set_param(&comp_id, &key, &value);
        }

        // Wire from previous component's output to this component's input.
        if let Some(ref prev) = prev_out_port {
            let wire_id = format!("w{wire_idx}");
            builder = builder.add_wire(&wire_id, prev, &in_port, Some(optic))?;
            wire_idx += 1;
        }

        prev_out_port = Some(out_port);
    }

    Ok(builder.build())
}

/// Parts of a `LensDocument` the circuit has no representation for.
///
/// The canvas is a pipeline of components, so it carries a `steps` body and
/// nothing else. Everything a document can hold *alongside* its steps —
/// directed equations, the rules-variant metadata, extensions — is dropped
/// on the way in, and exporting the circuit will not reproduce it. Silently
/// losing a modifier on a round-trip is worse than refusing the document,
/// because the user has no way to see it happened; naming what went missing
/// lets them decide whether the round-trip is safe for their lens.
///
/// Each entry is a full sentence naming the part and what its loss means.
#[must_use]
pub fn unrepresentable_parts(doc: &LensDocument) -> Vec<String> {
    let mut out = Vec::new();

    // A step with no component to draw it lands on the canvas as an inert
    // `unknown` node carrying no params, and `step_metadata` hands it the
    // `lens` wire colour, which is a claim about its optic class that
    // nothing checked. It then exports as `# unsupported step`. Naming the
    // steps this happened to is the only signal the user gets that the
    // circuit means less than the document did.
    if let Some(steps) = &doc.steps {
        let unmapped: Vec<String> = steps
            .iter()
            .enumerate()
            .filter(|(_, step)| step_metadata(step).0 == "unknown")
            .map(|(i, step)| format!("{} (step {})", step_kind_name(step), i + 1))
            .collect();
        if !unmapped.is_empty() {
            out.push(format!(
                "Step kind(s) the canvas has no component for: {}. They are \
                 drawn as inert `unknown` nodes, carry none of their \
                 parameters, and will not survive an export.",
                unmapped.join(", ")
            ));
        }
    }
    if let Some(eqs) = &doc.directed_equations {
        if !eqs.is_empty() {
            out.push(format!(
                "{} directed equation(s): oriented rewrites appended to the \
                 chain. The canvas has no component for one, so they are not \
                 shown and will not be exported.",
                eqs.len()
            ));
        }
    }
    if doc.passthrough.is_some() {
        out.push(
            "A `passthrough` policy: behaviour for features no rule matched. \
             It belongs to the rules body and has no effect on a step \
             pipeline, so it is not carried."
                .to_owned(),
        );
    }
    if doc.invertible.is_some() {
        out.push(
            "An `invertible` flag: a rules-variant declaration. The canvas \
             derives invertibility from the components themselves, so the \
             declared value is not carried."
                .to_owned(),
        );
    }
    if !doc.extensions.is_empty() {
        let mut keys: Vec<&str> = doc.extensions.keys().map(String::as_str).collect();
        keys.sort_unstable();
        out.push(format!(
            "Extension key(s) {}: fields outside the lens DSL's own schema. \
             They are not interpreted and will not be exported.",
            keys.join(", ")
        ));
    }
    out
}

/// The wire tag of a `Step`, for naming one in a message.
///
/// Read off the serialized form rather than matched variant by variant, so
/// a step kind added upstream is named correctly here without this function
/// having to learn about it — which is the case that matters, since the
/// reason to name a step at all is that protolab does not know it.
fn step_kind_name(step: &Step) -> String {
    serde_json::to_value(step)
        .ok()
        .and_then(|v| v.as_object().and_then(|o| o.keys().next().cloned()))
        .unwrap_or_else(|| "unrecognized".to_owned())
}

/// [`unrepresentable_parts`] for a document still in its JSON form.
///
/// Keeps the lens-DSL types out of callers that only need the report, so
/// the WASM crate does not take a dependency on `panproto-lens-dsl` for
/// one struct. A document that does not parse has nothing to report; the
/// import itself will fail with the parse error.
#[must_use]
pub fn unrepresentable_parts_json(json_source: &str) -> Vec<String> {
    serde_json::from_str::<LensDocument>(json_source)
        .map(|doc| unrepresentable_parts(&doc))
        .unwrap_or_default()
}

/// Explain why a document has no canvas representation.
///
/// A `LensDocument` carries exactly one body, and the canvas is a pipeline
/// of components, so `steps` is the only one it can draw. Saying only
/// "no steps body" leaves a user holding a perfectly valid lens with no
/// indication of which body it has or whether protolab could ever open it.
/// Naming the body — and, for the two that are chains under another
/// spelling, saying what would have to happen — is the difference between a
/// dead end and a next step.
fn describe_missing_steps(doc: &LensDocument) -> String {
    let (body, note) = if doc.from_diff.is_some() {
        (
            "from_diff",
            "It derives its chain from the structural difference between the \
             source and target schemas, which needs both schemas to compile. \
             Assign them and use auto-generate, which runs the same derivation \
             and installs the result as editable components.",
        )
    } else if doc.symmetric.is_some() {
        (
            "symmetric",
            "It holds two pipelines meeting at a shared middle. The canvas \
             draws a single forward chain, so there is no arrangement of \
             components that means the same thing.",
        )
    } else if doc.compose.is_some() {
        (
            "compose",
            "It references other lenses by name rather than carrying steps of \
             its own. Import the lenses it names and place them end to end.",
        )
    } else if doc.rules.is_some() {
        (
            "rules",
            "It rewrites by pattern match rather than by a fixed sequence, and \
             the canvas has no component for a rule.",
        )
    } else {
        return "LensDocument has no body: expected one of steps, from_diff, \
                symmetric, compose, or rules."
            .to_owned();
    };
    format!(
        "This lens has a `{body}` body, which the canvas cannot draw — it \
         represents a lens as a pipeline of components, which is the `steps` \
         body. {note}"
    )
}

/// Extract the circuit-component params (as string key/value pairs) from a
/// `Step`. Inverse of the logic in [`component_to_step`].
fn step_params(step: &Step) -> Vec<(String, String)> {
    let coercion_to_str = |c: &CoercionKind| -> &'static str {
        match c {
            CoercionKind::Iso => "iso",
            CoercionKind::Retraction => "retraction",
            CoercionKind::Projection => "projection",
            CoercionKind::Opaque => "opaque",
        }
    };

    match step {
        Step::RenameField { rename_field } => vec![
            ("old_name".into(), rename_field.old.clone()),
            ("new_name".into(), rename_field.new.clone()),
        ],
        Step::AddField { add_field } => {
            let default_str = match &add_field.default {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            vec![
                ("field_name".into(), add_field.name.clone()),
                ("field_kind".into(), add_field.kind.clone()),
                ("default".into(), default_str),
            ]
        }
        Step::RemoveField { remove_field } => {
            vec![("field_name".into(), remove_field.clone())]
        }
        Step::HoistField { hoist_field } => vec![
            ("parent".into(), hoist_field.parent.clone()),
            ("intermediate".into(), hoist_field.intermediate.clone()),
            ("child".into(), hoist_field.child.clone()),
        ],
        Step::NestField { nest_field } => {
            // Prefer `old_edge_name` (the short JSON key before nesting)
            // over the qualified `child` vertex id when populating the
            // protolab-side `child` param. Falling back to `child` keeps
            // round-trips working against pre-0.27.2 LensDocuments that
            // didn't serialize `old_edge_name`.
            let child_short = if !nest_field.old_edge_name.is_empty() {
                nest_field.old_edge_name.clone()
            } else {
                nest_field.child.clone()
            };
            vec![
                ("parent".into(), nest_field.parent.clone()),
                ("child".into(), child_short),
                ("wrapper".into(), nest_field.intermediate.clone()),
            ]
        }
        Step::ApplyExpr { apply_expr } => {
            let mut out = vec![
                ("field".into(), apply_expr.field.clone()),
                ("expr".into(), apply_expr.expr.clone()),
            ];
            if let Some(inv) = &apply_expr.inverse {
                out.push(("inverse".into(), inv.clone()));
            }
            if let Some(c) = &apply_expr.coercion {
                out.push(("coercion".into(), coercion_to_str(c).into()));
            }
            out
        }
        Step::ComputeField { compute_field } => {
            let mut out = vec![
                ("target".into(), compute_field.target.clone()),
                ("expr".into(), compute_field.expr.clone()),
            ];
            if let Some(inv) = &compute_field.inverse {
                out.push(("inverse".into(), inv.clone()));
            }
            if let Some(c) = &compute_field.coercion {
                out.push(("coercion".into(), coercion_to_str(c).into()));
            }
            out
        }
        Step::Scoped { scoped } => vec![("focus".into(), scoped.focus.clone())],
        _ => Vec::new(),
    }
}

/// Map a component type + its params to a lens DSL Step.
///
/// Covers every component type in `COMPONENT_CATALOG`
/// (`app/src/store/circuitStore.ts`):
/// rename_field, add_field, drop_field, hoist_field, nest_field,
/// coerce_type, apply_expr, compute_field, map_items.
fn component_to_step(
    circuit: &Schema,
    comp_id: &Name,
    comp_type: &str,
) -> Result<Step, CircuitError> {
    match comp_type {
        "rename_field" => {
            let old = find_param(circuit, comp_id, "old_name").unwrap_or_default();
            let new = find_param(circuit, comp_id, "new_name").unwrap_or_default();
            Ok(Step::RenameField {
                rename_field: RenameSpec { old, new },
            })
        }
        "add_field" => {
            let name = find_param(circuit, comp_id, "field_name").unwrap_or_default();
            let kind =
                find_param(circuit, comp_id, "field_kind").unwrap_or_else(|| "string".to_owned());
            let default_str = find_param(circuit, comp_id, "default").unwrap_or_default();
            let default = serde_json::Value::String(default_str);
            Ok(Step::AddField {
                add_field: AddFieldSpec {
                    name,
                    kind,
                    default,
                    expr: None,
                },
            })
        }
        "drop_field" => {
            let name = find_param(circuit, comp_id, "field_name").unwrap_or_default();
            Ok(Step::RemoveField { remove_field: name })
        }
        "hoist_field" => {
            let parent = find_param(circuit, comp_id, "parent").unwrap_or_default();
            let intermediate = find_param(circuit, comp_id, "intermediate").unwrap_or_default();
            let child = find_param(circuit, comp_id, "child").unwrap_or_default();
            Ok(Step::HoistField {
                hoist_field: HoistSpec {
                    parent,
                    intermediate,
                    child,
                },
            })
        }
        "nest_field" => {
            let parent = find_param(circuit, comp_id, "parent").unwrap_or_default();
            let child = find_param(circuit, comp_id, "child").unwrap_or_default();
            let wrapper = find_param(circuit, comp_id, "wrapper").unwrap_or_default();
            // protolab's UX uses `child` as the short edge name / JSON key
            // of the pre-nesting `parent → child` edge. Wire that into the
            // 0.27.2+ `NestSpec` fields so the exported LensDocument can
            // be re-imported and re-instantiated with the correct edge
            // labels (the new `parent → wrapper` edge takes the wrapper
            // name; the new `wrapper → child` edge keeps the original
            // child name).
            let child_vertex = if parent.is_empty() {
                child.clone()
            } else {
                format!("{parent}.{child}")
            };
            Ok(Step::NestField {
                nest_field: NestSpec {
                    parent,
                    child: child_vertex,
                    intermediate: wrapper.clone(),
                    intermediate_kind: "object".to_owned(),
                    edge_kind: "prop".to_owned(),
                    old_edge_name: child.clone(),
                    parent_to_intermediate: wrapper,
                    intermediate_to_child: child,
                },
            })
        }
        // coerce_type and apply_expr have identical parameter shapes in
        // protolab; both compile to `ApplyExpr` at the DSL level.
        "coerce_type" | "apply_expr" => {
            let field = find_param(circuit, comp_id, "field").unwrap_or_default();
            let expr = find_param(circuit, comp_id, "expr").unwrap_or_default();
            let inverse = find_param(circuit, comp_id, "inverse").filter(|s| !s.is_empty());
            let coercion =
                find_param(circuit, comp_id, "coercion").and_then(|s| parse_coercion_kind(&s));
            Ok(Step::ApplyExpr {
                apply_expr: ApplyExprSpec {
                    field,
                    expr,
                    inverse,
                    coercion,
                },
            })
        }
        "compute_field" => {
            let target = find_param(circuit, comp_id, "target").unwrap_or_default();
            let expr = find_param(circuit, comp_id, "expr").unwrap_or_default();
            let inverse = find_param(circuit, comp_id, "inverse").filter(|s| !s.is_empty());
            let coercion =
                find_param(circuit, comp_id, "coercion").and_then(|s| parse_coercion_kind(&s));
            Ok(Step::ComputeField {
                compute_field: ComputeFieldSpec {
                    target,
                    expr,
                    inverse,
                    coercion,
                },
            })
        }
        "map_items" => {
            let focus = find_param(circuit, comp_id, "focus").unwrap_or_default();
            // Inner sub-circuit is not yet surfaced in the UI, so we
            // emit an empty scoped traversal — the carrier is Traversal
            // but each element passes through unchanged.
            Ok(Step::Scoped {
                scoped: ScopedSpec {
                    focus,
                    inner: Vec::new(),
                },
            })
        }
        other => Err(CircuitError::Conversion(format!(
            "unsupported component type: {other}"
        ))),
    }
}

fn parse_coercion_kind(raw: &str) -> Option<CoercionKind> {
    match raw.to_ascii_lowercase().as_str() {
        "iso" => Some(CoercionKind::Iso),
        "retraction" => Some(CoercionKind::Retraction),
        "projection" => Some(CoercionKind::Projection),
        "opaque" => Some(CoercionKind::Opaque),
        _ => None,
    }
}

/// Map a lens DSL Step back to (component_type, optic_kind) for the
/// round-trip import path.
fn step_metadata(step: &Step) -> (&'static str, &'static str) {
    match step {
        Step::RenameField { .. } | Step::RenameSort { .. } | Step::RenameOp { .. } => {
            ("rename_field", "iso")
        }
        Step::AddField { .. } | Step::AddSort { .. } | Step::AddOp { .. } => ("add_field", "lens"),
        Step::RemoveField { .. } | Step::DropSort { .. } | Step::DropOp { .. } => {
            ("drop_field", "lens")
        }
        Step::HoistField { .. } => ("hoist_field", "lens"),
        Step::NestField { .. } => ("nest_field", "lens"),
        Step::ApplyExpr { apply_expr } => (
            // Round-trip heuristic: without an inverse we can't tell
            // coerce_type from apply_expr — they have identical shape at
            // the DSL level. Default to apply_expr since it's the more
            // general label.
            "apply_expr",
            if apply_expr.inverse.is_some() {
                "iso"
            } else {
                "lens"
            },
        ),
        Step::ComputeField { .. } => ("compute_field", "lens"),
        Step::Scoped { .. } => ("map_items", "traversal"),
        Step::CoerceSort { .. } => ("coerce_type", "lens"),
        _ => ("unknown", "lens"),
    }
}

/// Find a constraint value on a vertex.
fn find_constraint(circuit: &Schema, vertex: &Name, sort: &str) -> Option<String> {
    circuit
        .constraints
        .get(vertex)?
        .iter()
        .find(|c| c.sort.as_ref() == sort)
        .map(|c| c.value.clone())
}

/// Find a parameter value on a component (stored as `param:<key>` constraint).
fn find_param(circuit: &Schema, comp_id: &Name, key: &str) -> Option<String> {
    find_constraint(circuit, comp_id, &format!("param:{key}"))
}

// ── Export formatters ───────────────────────────────────────────────

/// Export the circuit schema directly as pretty JSON.
pub fn export_as_json(circuit: &Schema) -> Result<String, CircuitError> {
    serde_json::to_string_pretty(circuit).map_err(|e| CircuitError::Conversion(e.to_string()))
}

/// Export as a LensDocument serialized to JSON.
pub fn export_as_lens_json(circuit: &Schema) -> Result<String, CircuitError> {
    let doc = circuit_to_lens_document(circuit, "exported", "source", "target")?;
    serde_json::to_string_pretty(&doc).map_err(|e| CircuitError::Conversion(e.to_string()))
}

/// Export as a LensDocument formatted as YAML.
pub fn export_as_lens_yaml(circuit: &Schema) -> Result<String, CircuitError> {
    let doc = circuit_to_lens_document(circuit, "exported", "source", "target")?;
    let mut out = String::new();
    out.push_str(&format!("id: \"{}\"\n", doc.id));
    out.push_str(&format!("source: \"{}\"\n", doc.source));
    out.push_str(&format!("target: \"{}\"\n", doc.target));
    if let Some(steps) = &doc.steps {
        out.push_str("steps:\n");
        for step in steps {
            out.push_str(&format!("  - {}\n", step_to_yaml(step)));
        }
    }
    Ok(out)
}

/// Export as a LensDocument formatted as Nickel syntax.
pub fn export_as_nickel(circuit: &Schema) -> Result<String, CircuitError> {
    let doc = circuit_to_lens_document(circuit, "exported", "source", "target")?;
    let mut out = String::new();
    out.push_str("let L = import \"panproto/lens.ncl\" in\n");
    out.push_str("{\n");
    out.push_str(&format!("  id = \"{}\",\n", doc.id));
    out.push_str(&format!("  source = \"{}\",\n", doc.source));
    out.push_str(&format!("  target = \"{}\",\n", doc.target));
    if let Some(steps) = &doc.steps {
        out.push_str("  steps = [\n");
        for step in steps {
            out.push_str(&format!("    {},\n", step_to_nickel(step)));
        }
        out.push_str("  ],\n");
    }
    out.push_str("} | L.Lens\n");
    Ok(out)
}

/// Import a LensDocument from JSON source and build a circuit.
pub fn import_lens_json(json_source: &str) -> Result<Schema, CircuitError> {
    let doc: LensDocument =
        serde_json::from_str(json_source).map_err(|e| CircuitError::Conversion(e.to_string()))?;
    lens_document_to_circuit(&doc)
}

fn step_to_yaml(step: &Step) -> String {
    match step {
        Step::RenameField { rename_field } => {
            format!(
                "rename_field: {{ old: \"{}\", new: \"{}\" }}",
                rename_field.old, rename_field.new
            )
        }
        Step::AddField { add_field } => {
            format!(
                "add_field: {{ name: \"{}\", kind: \"{}\", default: {} }}",
                add_field.name,
                add_field.kind,
                serde_json::to_string(&add_field.default).unwrap_or_default()
            )
        }
        Step::RemoveField { remove_field } => {
            format!("remove_field: \"{}\"", remove_field)
        }
        Step::HoistField { hoist_field } => format!(
            "hoist_field: {{ parent: \"{}\", intermediate: \"{}\", child: \"{}\" }}",
            hoist_field.parent, hoist_field.intermediate, hoist_field.child
        ),
        Step::NestField { nest_field } => format!(
            "nest_field: {{ parent: \"{}\", child: \"{}\", intermediate: \"{}\" }}",
            nest_field.parent, nest_field.child, nest_field.intermediate
        ),
        Step::ApplyExpr { apply_expr } => format!(
            "apply_expr: {{ field: \"{}\", expr: {}, inverse: {} }}",
            apply_expr.field,
            serde_json::to_string(&apply_expr.expr).unwrap_or_default(),
            apply_expr
                .inverse
                .as_ref()
                .map(|s| serde_json::to_string(s).unwrap_or_default())
                .unwrap_or_else(|| "null".into())
        ),
        Step::ComputeField { compute_field } => format!(
            "compute_field: {{ target: \"{}\", expr: {} }}",
            compute_field.target,
            serde_json::to_string(&compute_field.expr).unwrap_or_default()
        ),
        Step::Scoped { scoped } => format!("scoped: {{ focus: \"{}\" }}", scoped.focus),
        _ => "unknown_step: {}".into(),
    }
}

fn step_to_nickel(step: &Step) -> String {
    match step {
        Step::RenameField { rename_field } => {
            format!("L.rename \"{}\" \"{}\"", rename_field.old, rename_field.new)
        }
        Step::AddField { add_field } => {
            let default_str = match &add_field.default {
                serde_json::Value::String(s) => format!("\"{}\"", s),
                other => serde_json::to_string(other).unwrap_or_default(),
            };
            format!(
                "L.add \"{}\" \"{}\" {}",
                add_field.name, add_field.kind, default_str
            )
        }
        Step::RemoveField { remove_field } => {
            format!("L.drop \"{}\"", remove_field)
        }
        Step::HoistField { hoist_field } => format!(
            "L.hoist \"{}\" \"{}\" \"{}\"",
            hoist_field.parent, hoist_field.intermediate, hoist_field.child
        ),
        Step::NestField { nest_field } => format!(
            "L.nest \"{}\" \"{}\" \"{}\"",
            nest_field.parent, nest_field.child, nest_field.intermediate
        ),
        Step::ApplyExpr { apply_expr } => format!(
            "L.applyExpr \"{}\" \"{}\"",
            apply_expr.field, apply_expr.expr
        ),
        Step::ComputeField { compute_field } => format!(
            "L.computeField \"{}\" \"{}\"",
            compute_field.target, compute_field.expr
        ),
        Step::Scoped { scoped } => format!("L.mapItems \"{}\"", scoped.focus),
        _ => "# unsupported step".into(),
    }
}

#[cfg(test)]
mod tests {
    use protolab_schema::builder::demo_circuit;

    use super::*;

    #[test]
    fn demo_circuit_to_lens_document() {
        let circuit = demo_circuit();
        let doc = circuit_to_lens_document(&circuit, "test", "v1", "v2").unwrap();

        assert_eq!(doc.id, "test");
        let steps = doc.steps.unwrap();
        assert_eq!(steps.len(), 3);

        // First step should be RenameField.
        assert!(matches!(steps[0], Step::RenameField { .. }));
        // Second should be AddField.
        assert!(matches!(steps[1], Step::AddField { .. }));
        // Third should be RemoveField (drop).
        assert!(matches!(steps[2], Step::RemoveField { .. }));
    }

    #[test]
    fn lens_document_round_trip() {
        let circuit = demo_circuit();
        let doc = circuit_to_lens_document(&circuit, "test", "v1", "v2").unwrap();
        let rebuilt = lens_document_to_circuit(&doc).unwrap();

        // Should have 3 components.
        let components: Vec<_> = rebuilt
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == "component")
            .collect();
        assert_eq!(components.len(), 3);

        // Should have 2 wires.
        let wires: Vec<_> = rebuilt
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == "wire")
            .collect();
        assert_eq!(wires.len(), 2);
    }

    #[test]
    fn export_json_works() {
        let circuit = demo_circuit();
        let json = export_as_json(&circuit).unwrap();
        assert!(json.contains("\"protocol\": \"circuit\""));
    }

    #[test]
    fn export_lens_json_has_steps() {
        let circuit = demo_circuit();
        let json = export_as_lens_json(&circuit).unwrap();
        assert!(json.contains("\"rename_field\"") || json.contains("rename_field"));
        // Verify it parses back.
        let _: LensDocument = serde_json::from_str(&json).unwrap();
    }

    #[test]
    fn export_nickel_has_combinators() {
        let circuit = demo_circuit();
        let ncl = export_as_nickel(&circuit).unwrap();
        assert!(ncl.contains("L.rename"));
        assert!(ncl.contains("L.add"));
        assert!(ncl.contains("L.drop"));
        assert!(ncl.contains("| L.Lens"));
    }

    #[test]
    fn export_yaml_has_steps() {
        let circuit = demo_circuit();
        let yaml = export_as_lens_yaml(&circuit).unwrap();
        assert!(yaml.contains("steps:"));
        assert!(yaml.contains("rename_field"));
    }

    #[test]
    fn import_lens_json_round_trip() {
        let circuit = demo_circuit();
        let json = export_as_lens_json(&circuit).unwrap();
        let imported = import_lens_json(&json).unwrap();

        let components: Vec<_> = imported
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == "component")
            .collect();
        assert_eq!(components.len(), 3);
    }

    /// Build a circuit that uses every component type protolab
    /// currently supports, so the export→import round-trip is exercised
    /// for all of them.
    fn kitchen_sink_circuit() -> Schema {
        CircuitBuilder::new()
            .add_component("rf", "rename_field")
            .unwrap()
            .add_port("rf.in", "rf", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("rf.out", "rf", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("rf.param", "rf", Direction::Parameter, TriggerMode::Cold)
            .unwrap()
            .set_param("rf", "old_name", "name")
            .set_param("rf", "new_name", "displayName")
            .add_component("af", "add_field")
            .unwrap()
            .add_port("af.in", "af", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("af.out", "af", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("af.param", "af", Direction::Parameter, TriggerMode::Cold)
            .unwrap()
            .set_param("af", "field_name", "bio")
            .set_param("af", "field_kind", "string")
            .set_param("af", "default", "")
            .add_component("df", "drop_field")
            .unwrap()
            .add_port("df.in", "df", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("df.out", "df", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("df.param", "df", Direction::Parameter, TriggerMode::Cold)
            .unwrap()
            .set_param("df", "field_name", "legacyId")
            .add_component("hf", "hoist_field")
            .unwrap()
            .add_port("hf.in", "hf", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("hf.out", "hf", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("hf.param", "hf", Direction::Parameter, TriggerMode::Cold)
            .unwrap()
            .set_param("hf", "parent", "user")
            .set_param("hf", "intermediate", "profile")
            .set_param("hf", "child", "name")
            .add_component("nf", "nest_field")
            .unwrap()
            .add_port("nf.in", "nf", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("nf.out", "nf", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("nf.param", "nf", Direction::Parameter, TriggerMode::Cold)
            .unwrap()
            .set_param("nf", "parent", "user")
            .set_param("nf", "child", "name")
            .set_param("nf", "wrapper", "profile")
            .add_component("ae", "apply_expr")
            .unwrap()
            .add_port("ae.in", "ae", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("ae.out", "ae", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("ae.param", "ae", Direction::Parameter, TriggerMode::Cold)
            .unwrap()
            .set_param("ae", "field", "name")
            .set_param("ae", "expr", "upper(name)")
            .set_param("ae", "inverse", "lower(name)")
            .set_param("ae", "coercion", "iso")
            .add_component("cf", "compute_field")
            .unwrap()
            .add_port("cf.in", "cf", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("cf.out", "cf", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("cf.param", "cf", Direction::Parameter, TriggerMode::Cold)
            .unwrap()
            .set_param("cf", "target", "slug")
            .set_param("cf", "expr", "lower(name)")
            .add_component("mi", "map_items")
            .unwrap()
            .add_port("mi.in", "mi", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("mi.out", "mi", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("mi.param", "mi", Direction::Parameter, TriggerMode::Cold)
            .unwrap()
            .set_param("mi", "focus", "tags")
            .build()
    }

    #[test]
    fn every_component_type_exports_to_lens_document() {
        let circuit = kitchen_sink_circuit();
        let doc = circuit_to_lens_document(&circuit, "test", "v1", "v2").unwrap();
        let steps = doc.steps.unwrap();
        assert_eq!(steps.len(), 8, "one DSL step per component");
        // Components are unconnected, so topo order is insertion-order
        // dependent. Test *presence* of every variant rather than their
        // positions.
        let has = |pred: fn(&Step) -> bool| steps.iter().any(pred);
        assert!(has(|s| matches!(s, Step::RenameField { .. })));
        assert!(has(|s| matches!(s, Step::AddField { .. })));
        assert!(has(|s| matches!(s, Step::RemoveField { .. })));
        assert!(has(|s| matches!(s, Step::HoistField { .. })));
        assert!(has(|s| matches!(s, Step::NestField { .. })));
        assert!(has(|s| matches!(s, Step::ApplyExpr { .. })));
        assert!(has(|s| matches!(s, Step::ComputeField { .. })));
        assert!(has(|s| matches!(s, Step::Scoped { .. })));
    }

    #[test]
    fn kitchen_sink_circuit_round_trip_preserves_params() {
        let circuit = kitchen_sink_circuit();
        let json = export_as_lens_json(&circuit).unwrap();
        let imported = import_lens_json(&json).unwrap();

        // Same number of components survives round-trip.
        let components: Vec<_> = imported
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == "component")
            .collect();
        assert_eq!(components.len(), 8);

        // Spot-check that apply_expr's expression was preserved.
        let has_upper = imported
            .constraints
            .values()
            .flat_map(|cs| cs.iter())
            .any(|c| c.sort.as_ref() == "param:expr" && c.value.contains("upper"));
        assert!(
            has_upper,
            "apply_expr's expression should survive round-trip"
        );
    }

    #[test]
    fn export_yaml_includes_all_step_types() {
        let circuit = kitchen_sink_circuit();
        let yaml = export_as_lens_yaml(&circuit).unwrap();
        for expected in &[
            "rename_field",
            "add_field",
            "remove_field",
            "hoist_field",
            "nest_field",
            "apply_expr",
            "compute_field",
            "scoped",
        ] {
            assert!(
                yaml.contains(expected),
                "YAML export should mention {expected}; got:\n{yaml}"
            );
        }
    }

    // ─── Helpers for per-step round-trip tests ─────────────────────────

    /// Build a single-component circuit with standard in/out/param ports.
    fn single_component_circuit(id: &str, comp_type: &str, params: &[(&str, &str)]) -> Schema {
        let mut b = CircuitBuilder::new()
            .add_component(id, comp_type)
            .unwrap()
            .add_port(&format!("{id}.in"), id, Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port(
                &format!("{id}.out"),
                id,
                Direction::Output,
                TriggerMode::Hot,
            )
            .unwrap()
            .add_port(
                &format!("{id}.param"),
                id,
                Direction::Parameter,
                TriggerMode::Cold,
            )
            .unwrap();
        for (k, v) in params {
            b = b.set_param(id, k, v);
        }
        b.build()
    }

    /// Round-trip a single-component circuit and return the sole
    /// imported component's `param:*` constraint map as (sort, value)
    /// pairs (sort already stripped of `param:` prefix).
    fn round_trip_params(circuit: &Schema) -> Vec<(String, String)> {
        let json = export_as_lens_json(circuit).unwrap();
        let imported = import_lens_json(&json).unwrap();
        let comp = imported
            .vertices
            .values()
            .find(|v| v.kind.as_ref() == "component")
            .expect("imported circuit should contain one component");
        let comp_name = Name::from(comp.id.as_ref());
        imported
            .constraints
            .get(&comp_name)
            .map(|cs| {
                cs.iter()
                    .filter_map(|c| {
                        c.sort
                            .as_ref()
                            .strip_prefix("param:")
                            .map(|k| (k.to_owned(), c.value.clone()))
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn get_param(params: &[(String, String)], key: &str) -> Option<String> {
        params
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
    }

    // ─── Per-step round-trip param fidelity ────────────────────────────

    #[test]
    fn rename_field_export_import_preserves_old_and_new_names() {
        let circuit = single_component_circuit(
            "rf",
            "rename_field",
            &[("old_name", "firstName"), ("new_name", "givenName")],
        );
        let p = round_trip_params(&circuit);
        assert_eq!(get_param(&p, "old_name").as_deref(), Some("firstName"));
        assert_eq!(get_param(&p, "new_name").as_deref(), Some("givenName"));
    }

    #[test]
    fn add_field_export_import_preserves_name_kind_and_default() {
        let circuit = single_component_circuit(
            "af",
            "add_field",
            &[
                ("field_name", "bio"),
                ("field_kind", "string"),
                ("default", "hello world"),
            ],
        );
        let p = round_trip_params(&circuit);
        assert_eq!(get_param(&p, "field_name").as_deref(), Some("bio"));
        assert_eq!(get_param(&p, "field_kind").as_deref(), Some("string"));
        assert_eq!(get_param(&p, "default").as_deref(), Some("hello world"));
    }

    #[test]
    fn drop_field_export_import_preserves_field_name() {
        let circuit = single_component_circuit("df", "drop_field", &[("field_name", "legacyId")]);
        let p = round_trip_params(&circuit);
        assert_eq!(get_param(&p, "field_name").as_deref(), Some("legacyId"));
    }

    #[test]
    fn hoist_field_export_import_preserves_parent_intermediate_child() {
        let circuit = single_component_circuit(
            "hf",
            "hoist_field",
            &[
                ("parent", "user"),
                ("intermediate", "profile"),
                ("child", "nickname"),
            ],
        );
        let p = round_trip_params(&circuit);
        assert_eq!(get_param(&p, "parent").as_deref(), Some("user"));
        assert_eq!(get_param(&p, "intermediate").as_deref(), Some("profile"));
        assert_eq!(get_param(&p, "child").as_deref(), Some("nickname"));
    }

    #[test]
    fn nest_field_export_import_preserves_parent_child_wrapper() {
        let circuit = single_component_circuit(
            "nf",
            "nest_field",
            &[
                ("parent", "user"),
                ("child", "nickname"),
                ("wrapper", "profile"),
            ],
        );
        let p = round_trip_params(&circuit);
        assert_eq!(get_param(&p, "parent").as_deref(), Some("user"));
        assert_eq!(get_param(&p, "child").as_deref(), Some("nickname"));
        assert_eq!(get_param(&p, "wrapper").as_deref(), Some("profile"));
    }

    #[test]
    fn apply_expr_export_import_preserves_field_expr_inverse_coercion() {
        let circuit = single_component_circuit(
            "ae",
            "apply_expr",
            &[
                ("field", "name"),
                ("expr", "upper(name)"),
                ("inverse", "lower(name)"),
                ("coercion", "iso"),
            ],
        );
        let p = round_trip_params(&circuit);
        assert_eq!(get_param(&p, "field").as_deref(), Some("name"));
        assert_eq!(get_param(&p, "expr").as_deref(), Some("upper(name)"));
        assert_eq!(get_param(&p, "inverse").as_deref(), Some("lower(name)"));
        assert_eq!(get_param(&p, "coercion").as_deref(), Some("iso"));
    }

    #[test]
    fn compute_field_export_import_preserves_target_expr_inverse_coercion() {
        let circuit = single_component_circuit(
            "cf",
            "compute_field",
            &[
                ("target", "slug"),
                ("expr", "lower(name)"),
                ("inverse", "identity"),
                ("coercion", "retraction"),
            ],
        );
        let p = round_trip_params(&circuit);
        assert_eq!(get_param(&p, "target").as_deref(), Some("slug"));
        assert_eq!(get_param(&p, "expr").as_deref(), Some("lower(name)"));
        assert_eq!(get_param(&p, "inverse").as_deref(), Some("identity"));
        assert_eq!(get_param(&p, "coercion").as_deref(), Some("retraction"));
    }

    #[test]
    fn map_items_export_import_preserves_focus() {
        let circuit = single_component_circuit("mi", "map_items", &[("focus", "tags")]);
        let p = round_trip_params(&circuit);
        assert_eq!(get_param(&p, "focus").as_deref(), Some("tags"));
    }

    #[test]
    fn coerce_type_round_trip_lands_in_apply_expr_step() {
        // coerce_type and apply_expr share the same param shape; both
        // compile to Step::ApplyExpr, and step_metadata labels
        // ApplyExpr back to "apply_expr" on import. Document the loss.
        let circuit = single_component_circuit(
            "ct",
            "coerce_type",
            &[("field", "age"), ("expr", "toInt(age)")],
        );
        let doc = circuit_to_lens_document(&circuit, "x", "a", "b").unwrap();
        let steps = doc.steps.as_ref().unwrap();
        assert_eq!(steps.len(), 1);
        assert!(matches!(steps[0], Step::ApplyExpr { .. }));

        let json = export_as_lens_json(&circuit).unwrap();
        let imported = import_lens_json(&json).unwrap();
        let ct = imported
            .vertices
            .values()
            .find(|v| v.kind.as_ref() == "component")
            .unwrap();
        let comp_name = Name::from(ct.id.as_ref());
        let comp_type = find_constraint(&imported, &comp_name, "component_type").unwrap();
        // The label is rewritten to apply_expr on round-trip.
        assert_eq!(comp_type, "apply_expr");
    }

    // ─── Negative paths ────────────────────────────────────────────────

    #[test]
    fn import_lens_json_rejects_malformed_json() {
        let err = import_lens_json("{ not valid");
        assert!(err.is_err(), "malformed JSON should error");
    }

    #[test]
    fn import_lens_json_rejects_missing_steps_body() {
        // Valid JSON, valid LensDocument fields, but no body at all.
        let src = r#"{"id":"x","source":"a","target":"b"}"#;
        let err = import_lens_json(src);
        match err {
            Err(CircuitError::Conversion(msg)) => {
                assert!(
                    msg.contains("no body") && msg.contains("steps"),
                    "expected the error to say the document has no body and \
                     name the ones it could have; got: {msg}"
                );
            }
            Err(other) => panic!("expected Conversion error; got {other:?}"),
            Ok(_) => panic!("expected Err, got Ok"),
        }
    }

    #[test]
    fn circuit_to_lens_document_errors_on_unknown_component_type() {
        let circuit = CircuitBuilder::new()
            .add_component("c", "totally_made_up")
            .unwrap()
            .add_port("c.in", "c", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("c.out", "c", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .build();
        let err = circuit_to_lens_document(&circuit, "x", "a", "b");
        match err {
            Err(CircuitError::Conversion(msg)) => {
                assert!(
                    msg.contains("unsupported component type"),
                    "expected 'unsupported component type' in: {msg}"
                );
            }
            other => panic!("expected Conversion error; got {other:?}"),
        }
    }

    #[test]
    fn circuit_to_lens_document_errors_on_missing_component_type_constraint() {
        let mut circuit = CircuitBuilder::new()
            .add_component("c", "rename_field")
            .unwrap()
            .add_port("c.in", "c", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("c.out", "c", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .build();
        // Strip the component_type constraint the builder installed.
        let comp_name = Name::from("c");
        if let Some(cs) = circuit.constraints.get_mut(&comp_name) {
            cs.retain(|c| c.sort.as_ref() != "component_type");
        }
        let err = circuit_to_lens_document(&circuit, "x", "a", "b");
        match err {
            Err(CircuitError::Conversion(msg)) => {
                assert!(
                    msg.contains("has no component_type"),
                    "expected 'has no component_type' in: {msg}"
                );
            }
            other => panic!("expected Conversion error; got {other:?}"),
        }
    }

    // ─── parse_coercion_kind ───────────────────────────────────────────

    #[test]
    fn parse_coercion_kind_iso_retraction_projection_opaque() {
        assert_eq!(parse_coercion_kind("iso"), Some(CoercionKind::Iso));
        assert_eq!(
            parse_coercion_kind("retraction"),
            Some(CoercionKind::Retraction)
        );
        assert_eq!(
            parse_coercion_kind("projection"),
            Some(CoercionKind::Projection)
        );
        assert_eq!(parse_coercion_kind("opaque"), Some(CoercionKind::Opaque));
    }

    #[test]
    fn parse_coercion_kind_is_case_insensitive() {
        assert_eq!(parse_coercion_kind("ISO"), Some(CoercionKind::Iso));
        assert_eq!(parse_coercion_kind("Iso"), Some(CoercionKind::Iso));
        assert_eq!(parse_coercion_kind("iso"), Some(CoercionKind::Iso));
    }

    #[test]
    fn parse_coercion_kind_unknown_returns_none() {
        assert_eq!(parse_coercion_kind("nonsense"), None);
    }

    #[test]
    fn parse_coercion_kind_empty_returns_none() {
        assert_eq!(parse_coercion_kind(""), None);
    }

    // ─── Empty / edge-case circuits ────────────────────────────────────

    #[test]
    fn empty_circuit_exports_to_empty_steps_array() {
        let circuit = CircuitBuilder::new().build();
        let doc = circuit_to_lens_document(&circuit, "x", "a", "b").unwrap();
        let steps = doc.steps.expect("steps should be Some (possibly empty)");
        assert!(steps.is_empty());
    }

    #[test]
    fn single_component_no_wires_round_trips() {
        let circuit = single_component_circuit(
            "rf",
            "rename_field",
            &[("old_name", "a"), ("new_name", "b")],
        );
        let json = export_as_lens_json(&circuit).unwrap();
        let imported = import_lens_json(&json).unwrap();
        let components: Vec<_> = imported
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == "component")
            .collect();
        assert_eq!(components.len(), 1);
        let wires: Vec<_> = imported
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == "wire")
            .collect();
        assert!(wires.is_empty());
    }

    #[test]
    fn circuit_with_extra_constraint_sorts_ignored_during_export() {
        // Add an extraneous non-`param:` constraint to the component
        // and verify the export path ignores it gracefully.
        let mut circuit = single_component_circuit(
            "rf",
            "rename_field",
            &[("old_name", "a"), ("new_name", "b")],
        );
        let comp_name = Name::from("rf");
        circuit
            .constraints
            .get_mut(&comp_name)
            .unwrap()
            .push(panproto_schema::Constraint {
                sort: Name::from("noise"),
                value: "should_be_ignored".to_owned(),
            });
        let doc = circuit_to_lens_document(&circuit, "x", "a", "b").unwrap();
        let steps = doc.steps.unwrap();
        assert_eq!(steps.len(), 1);
        match &steps[0] {
            Step::RenameField { rename_field } => {
                assert_eq!(rename_field.old, "a");
                assert_eq!(rename_field.new, "b");
            }
            other => panic!("expected RenameField; got {other:?}"),
        }
    }

    // ─── YAML / Nickel emitter coverage ────────────────────────────────

    #[test]
    fn yaml_export_quotes_string_values_correctly() {
        let circuit = single_component_circuit(
            "rf",
            "rename_field",
            &[("old_name", "name"), ("new_name", "displayName")],
        );
        let yaml = export_as_lens_yaml(&circuit).unwrap();
        assert!(
            yaml.contains("old: \"name\""),
            "expected quoted `old: \"name\"`; got:\n{yaml}"
        );
        assert!(
            yaml.contains("new: \"displayName\""),
            "expected quoted `new: \"displayName\"`; got:\n{yaml}"
        );
    }

    #[test]
    fn yaml_export_handles_apply_expr_with_inverse() {
        let circuit = single_component_circuit(
            "ae",
            "apply_expr",
            &[
                ("field", "name"),
                ("expr", "upper(name)"),
                ("inverse", "lower(name)"),
            ],
        );
        let yaml = export_as_lens_yaml(&circuit).unwrap();
        assert!(
            yaml.contains("expr"),
            "yaml should mention expr; got:\n{yaml}"
        );
        assert!(
            yaml.contains("inverse"),
            "yaml should mention inverse; got:\n{yaml}"
        );
    }

    #[test]
    fn nickel_export_emits_l_combinator_per_step_type() {
        let circuit = kitchen_sink_circuit();
        let ncl = export_as_nickel(&circuit).unwrap();
        for expected in &[
            "L.rename",
            "L.add",
            "L.drop",
            "L.hoist",
            "L.nest",
            "L.applyExpr",
            "L.computeField",
            "L.mapItems",
        ] {
            assert!(
                ncl.contains(expected),
                "Nickel export should contain {expected}; got:\n{ncl}"
            );
        }
    }

    #[test]
    fn nickel_export_pipe_lens_marker_present() {
        let circuit = kitchen_sink_circuit();
        let ncl = export_as_nickel(&circuit).unwrap();
        assert!(
            ncl.trim_end().ends_with("| L.Lens"),
            "Nickel export should end with `| L.Lens`; got:\n{ncl}"
        );
    }

    // ─── step_metadata ─────────────────────────────────────────────────

    #[test]
    fn step_metadata_apply_expr_with_inverse_is_iso() {
        let step = Step::ApplyExpr {
            apply_expr: ApplyExprSpec {
                field: "f".into(),
                expr: "e".into(),
                inverse: Some("i".into()),
                coercion: None,
            },
        };
        assert_eq!(step_metadata(&step), ("apply_expr", "iso"));
    }

    #[test]
    fn step_metadata_apply_expr_without_inverse_is_lens() {
        let step = Step::ApplyExpr {
            apply_expr: ApplyExprSpec {
                field: "f".into(),
                expr: "e".into(),
                inverse: None,
                coercion: None,
            },
        };
        assert_eq!(step_metadata(&step), ("apply_expr", "lens"));
    }

    #[test]
    fn step_metadata_compute_field_is_lens() {
        let step = Step::ComputeField {
            compute_field: ComputeFieldSpec {
                target: "t".into(),
                expr: "e".into(),
                inverse: None,
                coercion: None,
            },
        };
        assert_eq!(step_metadata(&step), ("compute_field", "lens"));
    }

    #[test]
    fn step_metadata_scoped_is_traversal() {
        let step = Step::Scoped {
            scoped: ScopedSpec {
                focus: "items".into(),
                inner: Vec::new(),
            },
        };
        assert_eq!(step_metadata(&step), ("map_items", "traversal"));
    }

    #[test]
    fn step_metadata_unknown_variant_falls_back_to_unknown_lens() {
        use panproto_lens_dsl::document::EquationSpec;
        let step = Step::AddEquation {
            add_equation: EquationSpec {
                name: "eq".into(),
                lhs: "a".into(),
                rhs: "b".into(),
            },
        };
        assert_eq!(step_metadata(&step), ("unknown", "lens"));
    }

    // ─── step_params symmetry ──────────────────────────────────────────

    #[test]
    fn step_params_apply_expr_omits_optional_inverse_when_none() {
        let step = Step::ApplyExpr {
            apply_expr: ApplyExprSpec {
                field: "f".into(),
                expr: "e".into(),
                inverse: None,
                coercion: None,
            },
        };
        let params = step_params(&step);
        assert!(params.iter().any(|(k, _)| k == "field"));
        assert!(params.iter().any(|(k, _)| k == "expr"));
        assert!(
            !params.iter().any(|(k, _)| k == "inverse"),
            "inverse should be omitted when None; got {params:?}"
        );
        assert!(
            !params.iter().any(|(k, _)| k == "coercion"),
            "coercion should be omitted when None; got {params:?}"
        );
    }

    #[test]
    fn step_params_apply_expr_includes_inverse_when_some() {
        let step = Step::ApplyExpr {
            apply_expr: ApplyExprSpec {
                field: "f".into(),
                expr: "e".into(),
                inverse: Some("inv".into()),
                coercion: Some(CoercionKind::Iso),
            },
        };
        let params = step_params(&step);
        assert_eq!(
            params
                .iter()
                .find(|(k, _)| k == "inverse")
                .map(|(_, v)| v.as_str()),
            Some("inv")
        );
        assert_eq!(
            params
                .iter()
                .find(|(k, _)| k == "coercion")
                .map(|(_, v)| v.as_str()),
            Some("iso")
        );
    }

    #[test]
    fn step_params_compute_field_includes_coercion_when_some() {
        let step = Step::ComputeField {
            compute_field: ComputeFieldSpec {
                target: "t".into(),
                expr: "e".into(),
                inverse: None,
                coercion: Some(CoercionKind::Projection),
            },
        };
        let params = step_params(&step);
        assert_eq!(
            params
                .iter()
                .find(|(k, _)| k == "coercion")
                .map(|(_, v)| v.as_str()),
            Some("projection")
        );
    }

    #[test]
    fn step_params_add_field_serializes_string_default_verbatim() {
        let step = Step::AddField {
            add_field: AddFieldSpec {
                name: "greeting".into(),
                kind: "string".into(),
                default: serde_json::Value::String("hello".into()),
                expr: None,
            },
        };
        let params = step_params(&step);
        let default = params
            .iter()
            .find(|(k, _)| k == "default")
            .map(|(_, v)| v.clone())
            .unwrap();
        // Verbatim, NOT JSON-encoded as "\"hello\"".
        assert_eq!(default, "hello");
    }

    #[test]
    fn step_params_add_field_serializes_integer_default_via_to_string() {
        let step = Step::AddField {
            add_field: AddFieldSpec {
                name: "count".into(),
                kind: "integer".into(),
                default: serde_json::Value::from(42i64),
                expr: None,
            },
        };
        let params = step_params(&step);
        let default = params
            .iter()
            .find(|(k, _)| k == "default")
            .map(|(_, v)| v.clone())
            .unwrap();
        assert_eq!(default, "42");
    }
}

#[cfg(test)]
mod body_reporting_tests {
    use super::*;

    fn err_for(src: &str) -> String {
        match import_lens_json(src) {
            Err(CircuitError::Conversion(msg)) => msg,
            other => panic!("expected a conversion error; got {other:?}"),
        }
    }

    // A user holding a valid lens deserves to know which body it has and
    // whether the canvas could ever open it, not just that `steps` is absent.
    #[test]
    fn a_symmetric_body_is_named_and_explained() {
        let msg = err_for(
            r#"{"id":"x","source":"a","target":"b",
                "symmetric":{"left":[],"right":[]}}"#,
        );
        assert!(msg.contains("symmetric"), "must name the body; got {msg}");
        assert!(
            msg.contains("two pipelines"),
            "must say why a single forward chain cannot mean the same thing; got {msg}"
        );
    }

    #[test]
    fn a_from_diff_body_points_at_auto_generate() {
        let msg = err_for(
            r#"{"id":"x","source":"a","target":"b","from_diff":{}}"#,
        );
        assert!(msg.contains("from_diff"), "must name the body; got {msg}");
        assert!(
            msg.contains("auto-generate"),
            "from_diff is the derivation auto-generate runs, so the error \
             should send the user there; got {msg}"
        );
    }

    #[test]
    fn a_compose_body_says_to_import_what_it_names() {
        let msg = err_for(
            r#"{"id":"x","source":"a","target":"b",
                "compose":{"mode":"vertical","lenses":[{"ref":"p"},{"ref":"q"}]}}"#,
        );
        assert!(msg.contains("compose"), "must name the body; got {msg}");
        assert!(msg.contains("Import"), "must say what to do; got {msg}");
    }

    // Losing a modifier on a round-trip is worse than refusing the document,
    // because nothing tells the user it happened.
    #[test]
    fn directed_equations_are_reported_as_dropped() {
        let dropped = unrepresentable_parts_json(
            r#"{"id":"x","source":"a","target":"b","steps":[],
                "directed_equations":[
                  {"name":"e","lhs":"f","rhs":"g","impl":"x"}
                ]}"#,
        );
        assert_eq!(dropped.len(), 1, "got {dropped:?}");
        assert!(
            dropped[0].contains("directed equation"),
            "must name what was lost; got {dropped:?}"
        );
        assert!(
            dropped[0].contains("not be exported"),
            "must say the loss survives an export; got {dropped:?}"
        );
    }

    #[test]
    fn extensions_are_reported_with_their_keys() {
        let dropped = unrepresentable_parts_json(
            r#"{"id":"x","source":"a","target":"b","steps":[],
                "extensions":{"zeta":1,"alpha":2}}"#,
        );
        assert_eq!(dropped.len(), 1, "got {dropped:?}");
        // Sorted, so the message is the same on every run.
        assert!(
            dropped[0].contains("alpha, zeta"),
            "must name the keys in a stable order; got {dropped:?}"
        );
    }

    #[test]
    fn a_plain_steps_document_drops_nothing() {
        let dropped = unrepresentable_parts_json(
            r#"{"id":"x","source":"a","target":"b","steps":[]}"#,
        );
        assert!(dropped.is_empty(), "got {dropped:?}");
    }

    #[test]
    fn an_empty_directed_equations_list_is_not_reported() {
        // Present but empty means nothing was lost; reporting it would be
        // a warning the user cannot act on.
        let dropped = unrepresentable_parts_json(
            r#"{"id":"x","source":"a","target":"b","steps":[],
                "directed_equations":[]}"#,
        );
        assert!(dropped.is_empty(), "got {dropped:?}");
    }

    #[test]
    fn a_malformed_document_reports_nothing() {
        // The import itself fails with the parse error; a second, vaguer
        // complaint here would only obscure it.
        assert!(unrepresentable_parts_json("{ not valid").is_empty());
    }
}

#[cfg(test)]
mod unmapped_step_tests {
    use super::*;

    // `Pullback`, `MergeSorts` and `DropEquation` have no component. They
    // used to import as inert `unknown` nodes wearing the `lens` wire
    // colour — a claim about their optic class that nothing established —
    // and export as `# unsupported step`, with nothing said either way.
    #[test]
    fn an_unmapped_step_kind_is_named() {
        let dropped = unrepresentable_parts_json(
            r#"{"id":"x","source":"a","target":"b","steps":[
                 {"merge_sorts":{"sort_a":"p","sort_b":"q","merged":"r","expr":"e"}}
               ]}"#,
        );
        assert_eq!(dropped.len(), 1, "got {dropped:?}");
        assert!(
            dropped[0].contains("merge_sorts"),
            "must name the step kind as the document spells it; got {dropped:?}"
        );
        assert!(
            dropped[0].contains("step 1"),
            "must say which step, so it can be found in a long document; got {dropped:?}"
        );
        assert!(
            dropped[0].contains("not survive an export"),
            "must say the loss persists through a round-trip; got {dropped:?}"
        );
    }

    #[test]
    fn mapped_steps_are_not_reported() {
        let dropped = unrepresentable_parts_json(
            r#"{"id":"x","source":"a","target":"b","steps":[
                 {"rename_field":{"old":"a","new":"b"}}
               ]}"#,
        );
        assert!(dropped.is_empty(), "got {dropped:?}");
    }

    #[test]
    fn each_unmapped_step_is_listed_with_its_position() {
        let dropped = unrepresentable_parts_json(
            r#"{"id":"x","source":"a","target":"b","steps":[
                 {"rename_field":{"old":"a","new":"b"}},
                 {"merge_sorts":{"sort_a":"p","sort_b":"q","merged":"r","expr":"e"}}
               ]}"#,
        );
        assert_eq!(dropped.len(), 1, "got {dropped:?}");
        assert!(
            dropped[0].contains("step 2"),
            "position must count the mapped step ahead of it; got {dropped:?}"
        );
    }
}
