//! Comprehensive component and integration tests.
//!
//! This file exercises every component type protolab knows about
//! (rename_field, add_field, drop_field, hoist_field, nest_field,
//! coerce_type, apply_expr, compute_field, map_items), both in isolation
//! and composed. It also verifies:
//!
//! - Optic-kind classification (the palette badge) per component type.
//! - Forward evaluation on each component against a matching source schema.
//! - Round-trip `get` → `put` laws for the supported components.
//! - Per-wire intermediate state rendering.
//! - The "stub" components (coerce/apply_expr/compute/map) are currently
//!   no-ops — tests pin that fact so changing them requires updating
//!   the tests too.
//!
//! See also: `end_to_end.rs` for the demo-circuit flow used by the UI.

// Test helpers intentionally use deeply-nested tuples for brevity at the
// call site; extracting type aliases would obscure the test intent.
#![allow(clippy::type_complexity)]

use std::collections::HashMap;

use panproto_gat::Name;
use panproto_lens::asymmetric::{get, put};
use panproto_lens::optic::{OpticKind, classify_transform};
use panproto_schema::{Edge, Protocol, Schema, Vertex};
use protolab_eval::{component_chain, find_root_vertex, wire_data_for_circuit};
use protolab_schema::{CircuitBuilder, Direction, TriggerMode};
use smallvec::SmallVec;

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════

fn make_protocol(schema: &Schema) -> Protocol {
    Protocol {
        name: schema.protocol.clone(),
        schema_theory: "ThWType".into(),
        instance_theory: "ThWType".into(),
        schema_composition: None,
        instance_composition: None,
        edge_rules: vec![],
        obj_kinds: vec![],
        constraint_sorts: vec![],
        has_order: false,
        has_coproducts: false,
        has_recursion: false,
        has_causal: false,
        nominal_identity: false,
        has_defaults: false,
        has_coercions: false,
        has_mergers: false,
        has_policies: false,
    }
}

/// Build a flat object schema `root → f_i` for each given (field_name, kind).
fn flat_schema(root: &str, fields: &[(&str, &str)]) -> Schema {
    let mut vertices: HashMap<Name, Vertex> = HashMap::new();
    let mut edges: HashMap<Edge, Name> = HashMap::new();
    let mut outgoing: HashMap<Name, SmallVec<Edge, 4>> = HashMap::new();
    let mut incoming: HashMap<Name, SmallVec<Edge, 4>> = HashMap::new();
    let mut between: HashMap<(Name, Name), SmallVec<Edge, 2>> = HashMap::new();

    vertices.insert(
        Name::from(root),
        Vertex {
            id: root.into(),
            kind: "object".into(),
            nsid: None,
        },
    );

    for (field, kind) in fields {
        let field_id = format!("{root}.{field}");
        let field_vertex = Name::from(field_id.as_str());
        vertices.insert(
            field_vertex.clone(),
            Vertex {
                id: field_id.clone().into(),
                kind: (*kind).into(),
                nsid: None,
            },
        );
        let edge = Edge {
            src: Name::from(root),
            tgt: field_vertex.clone(),
            kind: "prop".into(),
            name: Some(Name::from(*field)),
        };
        outgoing
            .entry(Name::from(root))
            .or_default()
            .push(edge.clone());
        incoming
            .entry(field_vertex.clone())
            .or_default()
            .push(edge.clone());
        between
            .entry((Name::from(root), field_vertex))
            .or_default()
            .push(edge.clone());
        edges.insert(edge, Name::from("prop"));
    }

    Schema {
        protocol: format!("test-{root}"),
        vertices,
        edges,
        hyper_edges: HashMap::new(),
        constraints: HashMap::new(),
        required: HashMap::new(),
        nsids: HashMap::new(),
        variants: HashMap::new(),
        orderings: HashMap::new(),
        recursion_points: HashMap::new(),
        spans: HashMap::new(),
        usage_modes: HashMap::new(),
        nominal: HashMap::new(),
        coercions: HashMap::new(),
        mergers: HashMap::new(),
        defaults: HashMap::new(),
        policies: HashMap::new(),
        outgoing,
        incoming,
        between,
    }
}

/// Build a single-component circuit with the given params.
fn single_component_circuit(comp_type: &str, params: &[(&str, &str)]) -> Schema {
    let mut builder = CircuitBuilder::new()
        .add_component("c", comp_type)
        .unwrap()
        .add_port("c.in", "c", Direction::Input, TriggerMode::Hot)
        .unwrap()
        .add_port("c.out", "c", Direction::Output, TriggerMode::Hot)
        .unwrap()
        .add_port("c.param", "c", Direction::Parameter, TriggerMode::Cold)
        .unwrap();
    for (k, v) in params {
        builder = builder.set_param("c", k, v);
    }
    builder.build()
}

/// Run the full forward evaluation and return the rendered JSON.
fn run_forward(circuit: &Schema, source_schema: &Schema, input_json: &str) -> serde_json::Value {
    let protocol = make_protocol(source_schema);
    let root = find_root_vertex(source_schema).unwrap().to_string();
    let input: serde_json::Value = serde_json::from_str(input_json).unwrap();
    let input_instance =
        panproto_inst::parse::parse_json(source_schema, &root, &input).expect("parse_json");
    let eval = wire_data_for_circuit(circuit, source_schema, &protocol, &input_instance)
        .expect("wire_data_for_circuit");
    panproto_inst::parse::to_json(&eval.output_schema, &eval.output)
}

/// Classify a single component's optic kind using the per-component
/// chain + `panproto_lens::classify_transform` — exactly the code path
/// that `compute_per_component_optics` in protolab-wasm uses.
fn classify_component(circuit: &Schema, comp_id: &str, source: &Schema) -> OpticKind {
    let chain = component_chain(circuit, &Name::from(comp_id), Some(source)).unwrap();
    let mut composed = OpticKind::Iso;
    for step in &chain.steps {
        composed = composed.compose(classify_transform(&step.target.transform));
    }
    composed
}

// ═══════════════════════════════════════════════════════════════════════
// rename_field
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn rename_field_produces_iso() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "rename_field",
        &[("old_name", "name"), ("new_name", "displayName")],
    );
    assert_eq!(classify_component(&circuit, "c", &source), OpticKind::Iso);
}

#[test]
fn rename_field_renames_json_key() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "rename_field",
        &[("old_name", "name"), ("new_name", "displayName")],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["displayName"], serde_json::json!("Alice"));
    assert!(out.get("name").is_none(), "old key must be removed");
}

#[test]
fn rename_field_preserves_other_fields() {
    let source = flat_schema("user", &[("name", "string"), ("age", "integer")]);
    let circuit = single_component_circuit(
        "rename_field",
        &[("old_name", "name"), ("new_name", "displayName")],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice", "age": 30}"#);
    assert_eq!(out["displayName"], serde_json::json!("Alice"));
    assert_eq!(out["age"], serde_json::json!(30));
}

// ═══════════════════════════════════════════════════════════════════════
// add_field
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn add_field_produces_lens() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "add_field",
        &[
            ("field_name", "bio"),
            ("field_kind", "string"),
            ("default", ""),
        ],
    );
    assert_eq!(
        classify_component(&circuit, "c", &source),
        OpticKind::Lens,
        "add_field is a Lens (complement records the default)"
    );
}

#[test]
fn add_field_string_default() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "add_field",
        &[
            ("field_name", "bio"),
            ("field_kind", "string"),
            ("default", "hello"),
        ],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["bio"], serde_json::json!("hello"));
    assert_eq!(out["name"], serde_json::json!("Alice"));
}

#[test]
fn add_field_integer_default() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "add_field",
        &[
            ("field_name", "age"),
            ("field_kind", "integer"),
            ("default", "42"),
        ],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["age"], serde_json::json!(42));
}

#[test]
fn add_field_boolean_default() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "add_field",
        &[
            ("field_name", "active"),
            ("field_kind", "boolean"),
            ("default", "true"),
        ],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["active"], serde_json::json!(true));
}

#[test]
fn add_field_float_default() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "add_field",
        &[
            ("field_name", "score"),
            ("field_kind", "float"),
            // Not `3.14` — clippy flags anything close to std::f64::consts::PI
            // as a potential approximation bug. Pick a value that's clearly
            // not meant to be π.
            ("default", "2.5"),
        ],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["score"], serde_json::json!(2.5));
}

#[test]
fn add_field_empty_default_uses_kind_zero() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "add_field",
        &[
            ("field_name", "count"),
            ("field_kind", "integer"),
            ("default", ""),
        ],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["count"], serde_json::json!(0));
}

// ═══════════════════════════════════════════════════════════════════════
// drop_field
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn drop_field_produces_lens() {
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = single_component_circuit("drop_field", &[("field_name", "legacyId")]);
    assert_eq!(classify_component(&circuit, "c", &source), OpticKind::Lens);
}

#[test]
fn drop_field_removes_key() {
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = single_component_circuit("drop_field", &[("field_name", "legacyId")]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice", "legacyId": 42}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
    assert!(
        out.get("legacyId").is_none(),
        "dropped key must be gone; got {out}"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Expression-based components (real implementations as of v0.1.x)
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn coerce_type_uppercases_field() {
    // coerce_type compiles to FieldTransform::ApplyExpr on the named field.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit =
        single_component_circuit("coerce_type", &[("field", "name"), ("expr", "upper(name)")]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("ALICE"));
}

#[test]
fn coerce_type_with_inverse_is_iso() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "coerce_type",
        &[
            ("field", "name"),
            ("expr", "upper(name)"),
            ("inverse", "lower(name)"),
        ],
    );
    // Intrinsic optic kind = Iso when inverse is provided.
    let kind =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("c"), Some(&source))
            .unwrap();
    assert_eq!(kind, OpticKind::Iso);
}

#[test]
fn coerce_type_default_is_lens_without_inverse() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit =
        single_component_circuit("coerce_type", &[("field", "name"), ("expr", "upper(name)")]);
    let kind =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("c"), Some(&source))
            .unwrap();
    assert_eq!(kind, OpticKind::Lens);
}

#[test]
fn apply_expr_transforms_field_in_place() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit =
        single_component_circuit("apply_expr", &[("field", "name"), ("expr", "upper(name)")]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("ALICE"));
}

#[test]
fn apply_expr_string_concatenation() {
    // panproto-expr uses Haskell-style function application: `concat x y`,
    // not `concat(x, y)`.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "apply_expr",
        &[("field", "name"), ("expr", r#"concat name "!""#)],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice!"));
}

#[test]
fn compute_field_writes_target_key() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[("target", "slug"), ("expr", "lower(name)")],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(
        out["slug"],
        serde_json::json!("alice"),
        "compute_field should write the lowercased name to slug; got {out}"
    );
    // Original field is preserved.
    assert_eq!(out["name"], serde_json::json!("Alice"));
}

#[test]
fn compute_field_default_is_lens_projection() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[("target", "slug"), ("expr", "lower(name)")],
    );
    let kind =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("c"), Some(&source))
            .unwrap();
    assert_eq!(kind, OpticKind::Lens);
}

#[test]
fn expression_components_surface_parse_errors() {
    // A malformed expression should error out, not silently no-op.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit("apply_expr", &[("field", "name"), ("expr", "upper(")]);
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value = serde_json::from_str(r#"{"name": "Alice"}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let result = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance);
    let Err(err) = result else {
        panic!("wire_data_for_circuit must surface expression parse errors");
    };
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("ExprParse") || err_str.to_lowercase().contains("expr"),
        "error should mention expression parsing; got {err_str}"
    );
}

#[test]
fn map_items_classifies_as_traversal() {
    // map_items is a Traversal carrier; even with no inner sub-circuit
    // (chain is empty), the intrinsic optic kind is pinned to Traversal.
    let source = flat_schema("user", &[("name", "string"), ("tags", "array")]);
    let circuit = single_component_circuit("map_items", &[("focus", "tags")]);
    let kind =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("c"), Some(&source))
            .unwrap();
    assert_eq!(kind, OpticKind::Traversal);
}

#[test]
fn map_items_forward_is_identity_for_now() {
    // No inner sub-circuit means each element passes through unchanged.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit("map_items", &[("focus", "tags")]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
}

#[test]
fn map_items_requires_focus_param() {
    // Misconfigured map_items (no focus) should error during chain build.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit("map_items", &[]);
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value = serde_json::from_str(r#"{"name": "Alice"}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let result = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance);
    assert!(result.is_err(), "map_items without focus should error");
}

// ═══════════════════════════════════════════════════════════════════════
// Integration: composed pipelines
// ═══════════════════════════════════════════════════════════════════════

/// Linear chain helper: wire comp_a.out → comp_b.in etc.
fn build_chain(comp_specs: &[(&str, &str, Vec<(&str, &str)>)]) -> Schema {
    let mut builder = CircuitBuilder::new();
    for (id, ty, _) in comp_specs {
        builder = builder.add_component(id, ty).unwrap();
        builder = builder
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
    }
    for window in comp_specs.windows(2) {
        let src = &window[0].0;
        let tgt = &window[1].0;
        let wire_id = format!("w_{src}_{tgt}");
        builder = builder
            .add_wire(
                &wire_id,
                &format!("{src}.out"),
                &format!("{tgt}.in"),
                Some("lens"),
            )
            .unwrap();
    }
    for (id, _, params) in comp_specs {
        for (k, v) in params {
            builder = builder.set_param(id, k, v);
        }
    }
    builder.build()
}

#[test]
fn chain_rename_then_drop() {
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = build_chain(&[
        (
            "rename",
            "rename_field",
            vec![("old_name", "name"), ("new_name", "displayName")],
        ),
        ("drop", "drop_field", vec![("field_name", "legacyId")]),
    ]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice", "legacyId": 42}"#);
    assert_eq!(out["displayName"], serde_json::json!("Alice"));
    assert!(out.get("name").is_none());
    assert!(out.get("legacyId").is_none());
}

#[test]
fn chain_add_then_drop_different_fields() {
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = build_chain(&[
        (
            "add",
            "add_field",
            vec![
                ("field_name", "bio"),
                ("field_kind", "string"),
                ("default", "(none)"),
            ],
        ),
        ("drop", "drop_field", vec![("field_name", "legacyId")]),
    ]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice", "legacyId": 42}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
    assert_eq!(out["bio"], serde_json::json!("(none)"));
    assert!(out.get("legacyId").is_none());
}

#[test]
fn chain_all_three_structural_components() {
    // The canonical demo pipeline: rename → add → drop.
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = build_chain(&[
        (
            "rename",
            "rename_field",
            vec![("old_name", "name"), ("new_name", "displayName")],
        ),
        (
            "add",
            "add_field",
            vec![
                ("field_name", "bio"),
                ("field_kind", "string"),
                ("default", ""),
            ],
        ),
        ("drop", "drop_field", vec![("field_name", "legacyId")]),
    ]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice", "legacyId": 42}"#);
    assert_eq!(out["displayName"], serde_json::json!("Alice"));
    assert_eq!(out["bio"], serde_json::json!(""));
    assert!(out.get("name").is_none());
    assert!(out.get("legacyId").is_none());
}

#[test]
fn empty_circuit_is_identity() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = CircuitBuilder::new().build();
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
}

// ═══════════════════════════════════════════════════════════════════════
// Per-wire intermediate data
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn per_wire_data_captures_each_intermediate_state() {
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = build_chain(&[
        (
            "rename",
            "rename_field",
            vec![("old_name", "name"), ("new_name", "displayName")],
        ),
        (
            "add",
            "add_field",
            vec![
                ("field_name", "bio"),
                ("field_kind", "string"),
                ("default", ""),
            ],
        ),
        ("drop", "drop_field", vec![("field_name", "legacyId")]),
    ]);
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value =
        serde_json::from_str(r#"{"name": "Alice", "legacyId": 42}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let eval = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance).unwrap();

    let render = |id: &str| -> serde_json::Value {
        let inst = eval
            .wire_data
            .get(id)
            .unwrap_or_else(|| panic!("no wire data for {id}"));
        let sch = eval
            .wire_schemas
            .get(id)
            .unwrap_or_else(|| panic!("no schema for {id}"));
        panproto_inst::parse::to_json(sch, inst)
    };

    // After rename only.
    let after_rename = render("rename");
    assert_eq!(after_rename["displayName"], serde_json::json!("Alice"));
    assert!(after_rename.get("name").is_none());
    assert!(after_rename.get("bio").is_none());
    assert_eq!(after_rename["legacyId"], serde_json::json!(42));

    // After rename + add.
    let after_add = render("add");
    assert_eq!(after_add["displayName"], serde_json::json!("Alice"));
    assert_eq!(after_add["bio"], serde_json::json!(""));
    assert_eq!(after_add["legacyId"], serde_json::json!(42));

    // After rename + add + drop.
    let after_drop = render("drop");
    assert_eq!(after_drop["displayName"], serde_json::json!("Alice"));
    assert_eq!(after_drop["bio"], serde_json::json!(""));
    assert!(after_drop.get("legacyId").is_none());
}

// ═══════════════════════════════════════════════════════════════════════
// Round-trip `get` → `put`
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn round_trip_rename_field_unmodified_view_restores_source() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "rename_field",
        &[("old_name", "name"), ("new_name", "displayName")],
    );
    let protocol = make_protocol(&source);
    let input: serde_json::Value = serde_json::from_str(r#"{"name": "Alice"}"#).unwrap();
    let root = find_root_vertex(&source).unwrap().to_string();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();

    let eval = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance).unwrap();
    let restored = put(&eval.final_lens, &eval.output, &eval.complement)
        .expect("put must round-trip when view is unmodified");

    // Render the restored instance against the source schema — should
    // match the original input.
    let restored_json = panproto_inst::parse::to_json(&source, &restored);
    assert_eq!(restored_json["name"], serde_json::json!("Alice"));
}

#[test]
fn round_trip_drop_field_recovers_dropped_value() {
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = single_component_circuit("drop_field", &[("field_name", "legacyId")]);
    let protocol = make_protocol(&source);
    let input: serde_json::Value =
        serde_json::from_str(r#"{"name": "Alice", "legacyId": 42}"#).unwrap();
    let root = find_root_vertex(&source).unwrap().to_string();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();

    let eval = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance).unwrap();
    let restored = put(&eval.final_lens, &eval.output, &eval.complement)
        .expect("put must restore dropped field from complement");
    let restored_json = panproto_inst::parse::to_json(&source, &restored);

    assert_eq!(restored_json["name"], serde_json::json!("Alice"));
    assert_eq!(
        restored_json["legacyId"],
        serde_json::json!(42),
        "dropped value must come back from the complement"
    );
}

#[test]
fn get_returns_nonempty_complement_for_drop() {
    // Smoke test: a drop_field complement should have at least one dropped
    // node so `put` has something to restore.
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = single_component_circuit("drop_field", &[("field_name", "legacyId")]);
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value =
        serde_json::from_str(r#"{"name": "Alice", "legacyId": 42}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();

    let eval = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance).unwrap();
    let (_view, complement) = get(&eval.final_lens, &input_instance).unwrap();
    assert!(
        !complement.dropped_nodes.is_empty(),
        "drop_field must capture dropped nodes in the complement"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Optic-kind classification coverage
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn intrinsic_optic_kinds_for_every_supported_component() {
    // Pins the optic-kind classification used by the UI palette. Tests
    // the *intrinsic* kind via component_intrinsic_optic_kind, which is
    // what `compute_per_component_optics` in protolab-wasm reports to the
    // frontend (combining both chain steps and field-transform classes).
    let source = flat_schema(
        "user",
        &[
            ("name", "string"),
            ("legacyId", "integer"),
            ("tags", "array"),
        ],
    );

    let cases: &[(&str, Vec<(&str, &str)>, OpticKind)] = &[
        (
            "rename_field",
            vec![("old_name", "name"), ("new_name", "displayName")],
            OpticKind::Iso,
        ),
        (
            "add_field",
            vec![
                ("field_name", "bio"),
                ("field_kind", "string"),
                ("default", ""),
            ],
            OpticKind::Lens,
        ),
        (
            "drop_field",
            vec![("field_name", "legacyId")],
            OpticKind::Lens,
        ),
        // Expression components: Lens by default (Retraction / Projection
        // class), Iso when an inverse is provided.
        (
            "coerce_type",
            vec![("field", "name"), ("expr", "upper(name)")],
            OpticKind::Lens,
        ),
        (
            "coerce_type",
            vec![
                ("field", "name"),
                ("expr", "upper(name)"),
                ("inverse", "lower(name)"),
            ],
            OpticKind::Iso,
        ),
        (
            "apply_expr",
            vec![("field", "name"), ("expr", "upper(name)")],
            OpticKind::Lens,
        ),
        (
            "apply_expr",
            vec![
                ("field", "name"),
                ("expr", "upper(name)"),
                ("inverse", "lower(name)"),
            ],
            OpticKind::Iso,
        ),
        (
            "compute_field",
            vec![("target", "slug"), ("expr", "lower(name)")],
            OpticKind::Lens,
        ),
        // map_items: Traversal carrier regardless of inner.
        ("map_items", vec![("focus", "tags")], OpticKind::Traversal),
    ];

    for (ty, params, expected) in cases {
        let circuit = single_component_circuit(ty, params);
        let actual = protolab_eval::component_intrinsic_optic_kind(
            &circuit,
            &Name::from("c"),
            Some(&source),
        )
        .unwrap();
        assert_eq!(
            actual, *expected,
            "intrinsic optic for {ty}{params:?} should be {expected:?}"
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════
// hoist_field / nest_field (nested-schema tests)
// ═══════════════════════════════════════════════════════════════════════

/// Build a 2-level schema: `root → intermediate → leaf`.
///
/// This is the minimum shape needed to exercise `hoist_field` (which
/// collapses `intermediate` and links `root → leaf` directly) and
/// `nest_field` (which is the inverse: given `root → leaf`, inserts a new
/// intermediate vertex).
fn nested_schema(root: &str, intermediate: &str, leaf: &str, leaf_kind: &str) -> Schema {
    let mut vertices: HashMap<Name, Vertex> = HashMap::new();
    let mut edges: HashMap<Edge, Name> = HashMap::new();
    let mut outgoing: HashMap<Name, SmallVec<Edge, 4>> = HashMap::new();
    let mut incoming: HashMap<Name, SmallVec<Edge, 4>> = HashMap::new();
    let mut between: HashMap<(Name, Name), SmallVec<Edge, 2>> = HashMap::new();

    for (id, kind) in [
        (root, "object"),
        (intermediate, "object"),
        (leaf, leaf_kind),
    ] {
        vertices.insert(
            Name::from(id),
            Vertex {
                id: id.into(),
                kind: kind.into(),
                nsid: None,
            },
        );
    }

    let mut add_edge = |src: &str, tgt: &str, name: &str| {
        let e = Edge {
            src: Name::from(src),
            tgt: Name::from(tgt),
            kind: "prop".into(),
            name: Some(Name::from(name)),
        };
        outgoing.entry(Name::from(src)).or_default().push(e.clone());
        incoming.entry(Name::from(tgt)).or_default().push(e.clone());
        between
            .entry((Name::from(src), Name::from(tgt)))
            .or_default()
            .push(e.clone());
        edges.insert(e, Name::from("prop"));
    };
    add_edge(root, intermediate, intermediate);
    add_edge(intermediate, leaf, leaf);

    Schema {
        protocol: format!("test-{root}"),
        vertices,
        edges,
        hyper_edges: HashMap::new(),
        constraints: HashMap::new(),
        required: HashMap::new(),
        nsids: HashMap::new(),
        variants: HashMap::new(),
        orderings: HashMap::new(),
        recursion_points: HashMap::new(),
        spans: HashMap::new(),
        usage_modes: HashMap::new(),
        nominal: HashMap::new(),
        coercions: HashMap::new(),
        mergers: HashMap::new(),
        defaults: HashMap::new(),
        policies: HashMap::new(),
        outgoing,
        incoming,
        between,
    }
}

#[test]
fn hoist_field_classifies_as_lens() {
    let source = nested_schema("user", "profile", "name", "string");
    let circuit = single_component_circuit(
        "hoist_field",
        &[
            ("parent", "user"),
            ("intermediate", "profile"),
            ("child", "name"),
        ],
    );
    let kind =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("c"), Some(&source))
            .unwrap();
    assert_eq!(kind, OpticKind::Lens);
}

#[test]
fn nest_field_classifies_as_lens() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "nest_field",
        &[
            ("parent", "user"),
            ("child", "name"),
            ("wrapper", "profile"),
        ],
    );
    let kind =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("c"), Some(&source))
            .unwrap();
    assert_eq!(kind, OpticKind::Lens);
}

#[test]
fn hoist_field_builds_chain_without_error() {
    // Exercises the dispatch path — chain construction must succeed for
    // `hoist_field` on a schema where the intermediate vertex exists.
    let source = nested_schema("user", "profile", "name", "string");
    let circuit = single_component_circuit(
        "hoist_field",
        &[
            ("parent", "user"),
            ("intermediate", "profile"),
            ("child", "name"),
        ],
    );
    let chain = protolab_eval::component_chain(&circuit, &Name::from("c"), Some(&source))
        .expect("hoist_field should build a valid chain");
    assert!(
        !chain.steps.is_empty(),
        "hoist_field must produce at least one protolens step"
    );
}

#[test]
fn nest_field_builds_chain_without_error() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "nest_field",
        &[
            ("parent", "user"),
            ("child", "name"),
            ("wrapper", "profile"),
        ],
    );
    let chain = protolab_eval::component_chain(&circuit, &Name::from("c"), Some(&source))
        .expect("nest_field should build a valid chain");
    assert!(
        !chain.steps.is_empty(),
        "nest_field must produce multiple protolens steps"
    );
}

#[test]
fn hoist_field_missing_params_errors() {
    let source = nested_schema("user", "profile", "name", "string");
    let circuit = single_component_circuit("hoist_field", &[("parent", "user")]);
    let result = protolab_eval::component_chain(&circuit, &Name::from("c"), Some(&source));
    assert!(
        result.is_err(),
        "hoist_field without `intermediate` and `child` must error"
    );
}

#[test]
fn nest_field_missing_params_errors() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit("nest_field", &[("parent", "user")]);
    let result = protolab_eval::component_chain(&circuit, &Name::from("c"), Some(&source));
    assert!(
        result.is_err(),
        "nest_field without child/wrapper must error"
    );
}
