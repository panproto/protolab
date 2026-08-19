//! Round-trip and topology integration tests.
//!
//! Companion to `components.rs`. This file fills the round-trip gap for
//! every component type that `components.rs` does not already cover, and
//! exercises non-linear circuit topologies (branching DAGs, multi-source
//! DAGs, feedback wires) plus richer `compute_field` cases.
//!
//! All tests use the public `protolab-eval` API + `panproto_lens::asymmetric`.
//! Helpers are intentionally copied verbatim from `tests/components.rs` so
//! this file is self-contained and can be edited without touching the other.

// The `build_chain` helper takes a slice of `(id, type, params)` tuples where
// `params` is itself a `Vec<(&str, &str)>`. Extracting a type alias for
// readability is fine in production code but obscures the test's intent at
// the use site.
#![allow(clippy::type_complexity)]

use std::collections::HashMap;

use panproto_gat::Name;
use panproto_lens::optic::OpticKind;
use panproto_schema::{Edge, Protocol, Schema, Vertex};
use protolab_core::topo::topological_sort;
use protolab_eval::{
    circuit_to_protolens_chain_with_schema, find_root_vertex, put_view, wire_data_for_circuit,
};
use protolab_schema::{CircuitBuilder, Direction, TriggerMode};
use smallvec::SmallVec;

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers (copied verbatim from tests/components.rs — keep in sync)
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
        entries: vec![Name::from(root)],
        outgoing,
        incoming,
        between,
    }
}

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
        entries: vec![Name::from(root)],
        outgoing,
        incoming,
        between,
    }
}

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

// ═══════════════════════════════════════════════════════════════════════
// Round-trip helper
// ═══════════════════════════════════════════════════════════════════════

/// Run a forward eval, optionally mutate the rendered view JSON, then run
/// `put` and return the restored source rendered as JSON.
///
/// We deliberately operate on JSON for the modify step (rather than poking
/// at `WInstance` internals) so the modification is expressed in the same
/// vocabulary as the rest of the test, and so the test exercises the same
/// `parse_json` round-trip the WASM bridge uses for the backward pass.
fn round_trip(
    circuit: &Schema,
    source_schema: &Schema,
    input_json: &str,
    modify: impl FnOnce(&mut serde_json::Value),
) -> serde_json::Value {
    let protocol = make_protocol(source_schema);
    let root = find_root_vertex(source_schema).unwrap().to_string();
    let input: serde_json::Value = serde_json::from_str(input_json).unwrap();
    let input_instance =
        panproto_inst::parse::parse_json(source_schema, &root, &input).expect("parse input");
    let eval = wire_data_for_circuit(circuit, source_schema, &protocol, &input_instance)
        .expect("forward eval");

    // Render the output, modify it in JSON-land, parse it back into a
    // WInstance against the lens's target schema.
    let mut view_json = panproto_inst::parse::to_json(&eval.output_schema, &eval.output);
    modify(&mut view_json);
    let tgt_root = find_root_vertex(&eval.output_schema)
        .unwrap_or_else(|| Name::from(root.as_str()))
        .to_string();
    let modified_view =
        panproto_inst::parse::parse_json(&eval.output_schema, &tgt_root, &view_json)
            .expect("parse modified view");

    let restored = put_view(&eval, &modified_view).expect("put_view must succeed");
    panproto_inst::parse::to_json(source_schema, &restored)
}

// ═══════════════════════════════════════════════════════════════════════
// Round-trip section: per-component (unmodified view)
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn rename_field_round_trip_unmodified_recovers_input() {
    // NOTE: deliberately a single-field source. Multi-field rename
    // round-trips currently scramble field values across siblings — see
    // `rename_field_round_trip_multi_field_scrambles_siblings` below for
    // the ignored bug-pinning test.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "rename_field",
        &[("old_name", "name"), ("new_name", "displayName")],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice"}"#, |_| {});
    assert_eq!(restored["name"], serde_json::json!("Alice"));
    assert!(restored.get("displayName").is_none());
}

#[test]
// FIXED: the restored instance used to scramble sibling values because
// `parse_json` reassigned node ids when the view was re-parsed from JSON,
// breaking panproto-lens `put`'s (parent_id, child_id)-keyed complement
// lookups. `protolab_eval::put_view` now remaps re-parsed node ids back to
// the original view's ids via parallel anchor-matching before delegating
// to `panproto_lens::asymmetric::put`.
fn rename_field_round_trip_multi_field_scrambles_siblings() {
    let source = flat_schema("user", &[("name", "string"), ("age", "integer")]);
    let circuit = single_component_circuit(
        "rename_field",
        &[("old_name", "name"), ("new_name", "displayName")],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice", "age": 30}"#, |_| {});
    assert_eq!(restored["name"], serde_json::json!("Alice"));
    assert_eq!(restored["age"], serde_json::json!(30));
}

#[test]
fn add_field_round_trip_unmodified_recovers_input() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "add_field",
        &[
            ("field_name", "bio"),
            ("field_kind", "string"),
            ("default", "(none)"),
        ],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice"}"#, |_| {});
    assert_eq!(restored["name"], serde_json::json!("Alice"));
    assert!(
        restored.get("bio").is_none(),
        "added field must not survive in restored source; got {restored}"
    );
}

#[test]
// FIXED: the apparent drop was actually a node-id shuffle in the put
// path. `parse_json` re-assigned u32 ids across the re-parse, so
// panproto-lens's complement (keyed on original ids) ended up attaching
// surviving values to the wrong anchors. `protolab_eval::put_view` now
// remaps re-parsed ids back to the original view's ids by anchor before
// calling `panproto_lens::asymmetric::put`.
fn drop_field_round_trip_unmodified_recovers_input() {
    // Variant of the components.rs test: different dropped field name,
    // plus an extra surviving field that must come back unchanged.
    let source = flat_schema(
        "post",
        &[
            ("title", "string"),
            ("internal_id", "integer"),
            ("body", "string"),
        ],
    );
    let circuit = single_component_circuit("drop_field", &[("field_name", "internal_id")]);
    let restored = round_trip(
        &circuit,
        &source,
        r#"{"title": "Hello", "internal_id": 7, "body": "world"}"#,
        |_| {},
    );
    assert_eq!(restored["title"], serde_json::json!("Hello"));
    assert_eq!(restored["body"], serde_json::json!("world"));
    assert_eq!(
        restored["internal_id"],
        serde_json::json!(7),
        "complement must restore the dropped field"
    );
}

/// Sanity-check variant of the drop_field round-trip that mirrors the
/// existing components.rs test (only one surviving sibling) so we have a
/// passing baseline alongside the ignored multi-sibling case above.
#[test]
fn drop_field_round_trip_one_sibling_recovers_input() {
    let source = flat_schema("post", &[("title", "string"), ("internal_id", "integer")]);
    let circuit = single_component_circuit("drop_field", &[("field_name", "internal_id")]);
    let restored = round_trip(
        &circuit,
        &source,
        r#"{"title": "Hello", "internal_id": 7}"#,
        |_| {},
    );
    assert_eq!(restored["title"], serde_json::json!("Hello"));
    assert_eq!(restored["internal_id"], serde_json::json!(7));
}

#[test]
// FIXED: the forward view was already correct (`{"name": "Alice"}` with
// a `user → name` arc carrying the leaf value). The round-trip failure
// came from `parse_json` reassigning the leaf's u32 id so that the
// complement's `dropped_nodes[profile]` clobbered the re-parsed leaf.
// `protolab_eval::put_view` now remaps re-parsed ids by anchor before
// delegating to `panproto_lens::asymmetric::put`.
fn hoist_field_round_trip_unmodified_recovers_input() {
    let source = nested_schema("user", "profile", "name", "string");
    let circuit = single_component_circuit(
        "hoist_field",
        &[
            ("parent", "user"),
            ("intermediate", "profile"),
            ("child", "name"),
        ],
    );
    let restored = round_trip(
        &circuit,
        &source,
        r#"{"profile": {"name": "Alice"}}"#,
        |_| {},
    );
    assert_eq!(
        restored["profile"]["name"],
        serde_json::json!("Alice"),
        "hoist round-trip must restore nested structure; got {restored}"
    );
}

#[test]
fn hoist_field_chain_construction_succeeds() {
    // Pin the part of `hoist_field` that does work today: chain
    // construction against a nested source schema. Round-trip is in the
    // ignored test above.
    let source = nested_schema("user", "profile", "name", "string");
    let circuit = single_component_circuit(
        "hoist_field",
        &[
            ("parent", "user"),
            ("intermediate", "profile"),
            ("child", "name"),
        ],
    );
    let chain = circuit_to_protolens_chain_with_schema(&circuit, Some(&source))
        .expect("hoist chain construction must succeed");
    assert!(!chain.steps.is_empty());
}

#[test]
// FIXED: panproto 0.27.3 (panproto/panproto#24) added wtype_restrict
// support for synthesizing intermediate WInstance nodes during nest_field
// forward eval. Combined with the 0.27.2 schema-level fix (panproto#23)
// and the protolab-eval `component_to_chain` wiring that passes qualified
// child vertex ids, the full round-trip now works.
fn nest_field_round_trip_unmodified_recovers_input() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "nest_field",
        &[
            ("parent", "user"),
            ("child", "name"),
            ("wrapper", "profile"),
        ],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice"}"#, |_| {});
    assert_eq!(
        restored["name"],
        serde_json::json!("Alice"),
        "nest round-trip must restore the flat field; got {restored}"
    );
}

#[test]
fn nest_field_chain_construction_succeeds() {
    // Pin the part of `nest_field` that does work today: schema-only
    // chain construction. Full eval is in the ignored test above.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "nest_field",
        &[
            ("parent", "user"),
            ("child", "name"),
            ("wrapper", "profile"),
        ],
    );
    let chain = circuit_to_protolens_chain_with_schema(&circuit, Some(&source))
        .expect("nest chain construction must succeed");
    assert!(!chain.steps.is_empty());
}

#[test]
// FIXED: protolab-eval no longer installs `FieldTransform::ApplyExpr` for
// `coerce_type`/`apply_expr`. It applies the forward expression directly
// to the view's child node via `protolab_eval::expr_ops`, and
// `protolab_eval::put_view` re-applies the `inverse` expression in reverse
// order on the backward pass. See `expr_ops.rs` for rationale.
fn coerce_type_round_trip_unmodified_recovers_input() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "coerce_type",
        &[
            ("field", "name"),
            ("expr", "upper(name)"),
            ("inverse", "lower(name)"),
        ],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice"}"#, |_| {});
    assert_eq!(
        restored["name"],
        serde_json::json!("alice"),
        "iso round-trip should yield lower(upper(name)) = 'alice'; got {restored}"
    );
}

#[test]
// FIXED: same resolution as `coerce_type_round_trip_unmodified_recovers_input`.
fn apply_expr_round_trip_unmodified_recovers_input() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "apply_expr",
        &[
            ("field", "name"),
            ("expr", "upper(name)"),
            ("inverse", "lower(name)"),
        ],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice"}"#, |_| {});
    assert_eq!(
        restored["name"],
        serde_json::json!("alice"),
        "iso round-trip = lower(upper('Alice')) = 'alice'; got {restored}"
    );
}

#[test]
fn compute_field_round_trip_unmodified_recovers_input() {
    // No inverse → Projection. The derived `slug` is recomputed in the
    // view but the original `name` must survive untouched.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[("target", "slug"), ("expr", "lower(name)")],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice"}"#, |_| {});
    assert_eq!(restored["name"], serde_json::json!("Alice"));
    assert!(
        restored.get("slug").is_none(),
        "derived field must not appear in restored source; got {restored}"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Round-trip section: modified-view path
// ═══════════════════════════════════════════════════════════════════════

#[test]
// FIXED: `protolab_eval::put_view` now evaluates the `apply_expr`
// component's `inverse` expression against the (possibly modified)
// child value on the backward pass.
fn apply_expr_round_trip_modified_view_propagates_back_with_inverse() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "apply_expr",
        &[
            ("field", "name"),
            ("expr", "upper(name)"),
            ("inverse", "lower(name)"),
        ],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice"}"#, |view| {
        view["name"] = serde_json::json!("ALICE!");
    });
    // Modified view "ALICE!" → put applies inverse `lower(name)` → "alice!".
    assert_eq!(
        restored["name"],
        serde_json::json!("alice!"),
        "modified view should round-trip via inverse to lowercased value; got {restored}"
    );
}

#[test]
fn compute_field_round_trip_modified_view_drops_derived_changes() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[("target", "slug"), ("expr", "lower(name)")],
    );
    let restored = round_trip(&circuit, &source, r#"{"name": "Alice"}"#, |view| {
        // Tamper with the derived field. Projection coercion class
        // means the source's `name` should still come back unchanged
        // and there should be no `slug` in the source.
        view["slug"] = serde_json::json!("hacked");
    });
    assert_eq!(
        restored["name"],
        serde_json::json!("Alice"),
        "projection class must ignore changes to the derived field; got {restored}"
    );
    assert!(
        restored.get("slug").is_none(),
        "source schema has no slug; got {restored}"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Multi-step chain round-trips
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn chain_rename_then_drop_round_trip_recovers_dropped_field() {
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = build_chain(&[
        (
            "rename",
            "rename_field",
            vec![("old_name", "name"), ("new_name", "displayName")],
        ),
        ("drop", "drop_field", vec![("field_name", "legacyId")]),
    ]);
    let restored = round_trip(
        &circuit,
        &source,
        r#"{"name": "Alice", "legacyId": 42}"#,
        |_| {},
    );
    assert_eq!(restored["name"], serde_json::json!("Alice"));
    assert_eq!(
        restored["legacyId"],
        serde_json::json!(42),
        "dropped field must come back from the complement; got {restored}"
    );
    assert!(restored.get("displayName").is_none());
}

#[test]
fn chain_add_then_drop_round_trip_with_unmodified_view() {
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
    let restored = round_trip(
        &circuit,
        &source,
        r#"{"name": "Alice", "legacyId": 42}"#,
        |_| {},
    );
    assert_eq!(restored["name"], serde_json::json!("Alice"));
    assert_eq!(restored["legacyId"], serde_json::json!(42));
    assert!(
        restored.get("bio").is_none(),
        "added field must not appear in restored source; got {restored}"
    );
}

#[test]
fn chain_full_demo_round_trip() {
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
    let restored = round_trip(
        &circuit,
        &source,
        r#"{"name": "Alice", "legacyId": 42}"#,
        |_| {},
    );
    assert_eq!(restored["name"], serde_json::json!("Alice"));
    assert_eq!(restored["legacyId"], serde_json::json!(42));
    assert!(restored.get("displayName").is_none());
    assert!(restored.get("bio").is_none());
}

// ═══════════════════════════════════════════════════════════════════════
// Branching DAG topologies
// ═══════════════════════════════════════════════════════════════════════

/// Build a branching circuit:
///
///   rename ──┬─→ add
///            └─→ drop
///
/// The single `rename.out` port has two outgoing wires.
fn branching_dag_circuit() -> Schema {
    let mut b = CircuitBuilder::new();
    for (id, ty) in [
        ("rename", "rename_field"),
        ("add", "add_field"),
        ("drop", "drop_field"),
    ] {
        b = b.add_component(id, ty).unwrap();
        b = b
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
    // Two wires fan out from rename.out.
    b = b
        .add_wire("w_rename_add", "rename.out", "add.in", Some("lens"))
        .unwrap()
        .add_wire("w_rename_drop", "rename.out", "drop.in", Some("lens"))
        .unwrap();
    b = b
        .set_param("rename", "old_name", "name")
        .set_param("rename", "new_name", "displayName")
        .set_param("add", "field_name", "bio")
        .set_param("add", "field_kind", "string")
        .set_param("add", "default", "")
        .set_param("drop", "field_name", "legacyId");
    b.build()
}

#[test]
fn branching_dag_two_consumers_from_one_source() {
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = branching_dag_circuit();
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value =
        serde_json::from_str(r#"{"name": "Alice", "legacyId": 42}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let eval = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance)
        .expect("branching DAG must evaluate");

    // Both downstream branches must be present in the wire data map.
    assert!(
        eval.wire_data.contains_key("rename"),
        "rename wire missing; got keys {:?}",
        eval.wire_data.keys().collect::<Vec<_>>()
    );
    assert!(
        eval.wire_data.contains_key("add"),
        "add branch missing; got keys {:?}",
        eval.wire_data.keys().collect::<Vec<_>>()
    );
    assert!(
        eval.wire_data.contains_key("drop"),
        "drop branch missing; got keys {:?}",
        eval.wire_data.keys().collect::<Vec<_>>()
    );
}

#[test]
fn branching_dag_topo_order_is_total() {
    let circuit = branching_dag_circuit();
    let sorted = topological_sort(&circuit).expect("topo sort");
    let pos = |id: &str| sorted.iter().position(|n| n.as_ref() == id).unwrap();
    // rename has no incoming wires, so it must come first.
    assert!(pos("rename") < pos("add"));
    assert!(pos("rename") < pos("drop"));
    // add and drop are siblings — order between them is unspecified, but
    // total order must include all three components exactly once.
    assert_eq!(sorted.len(), 3);
}

#[test]
fn multi_source_dag_two_independent_chains() {
    // Two completely independent chains in one circuit:
    //   ren_a → drop_a
    //   ren_b → drop_b
    let source = flat_schema(
        "user",
        &[
            ("name", "string"),
            ("legacyId", "integer"),
            ("nickname", "string"),
        ],
    );
    let mut b = CircuitBuilder::new();
    for (id, ty) in [
        ("ren_a", "rename_field"),
        ("drop_a", "drop_field"),
        ("ren_b", "rename_field"),
        ("drop_b", "drop_field"),
    ] {
        b = b.add_component(id, ty).unwrap();
        b = b
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
    b = b
        .add_wire("w_a", "ren_a.out", "drop_a.in", Some("lens"))
        .unwrap()
        .add_wire("w_b", "ren_b.out", "drop_b.in", Some("lens"))
        .unwrap();
    b = b
        .set_param("ren_a", "old_name", "name")
        .set_param("ren_a", "new_name", "displayName")
        .set_param("drop_a", "field_name", "legacyId")
        .set_param("ren_b", "old_name", "nickname")
        .set_param("ren_b", "new_name", "handle")
        .set_param("drop_b", "field_name", "legacyId");
    let circuit = b.build();

    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value =
        serde_json::from_str(r#"{"name": "Alice", "legacyId": 42, "nickname": "ali"}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let eval = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance)
        .expect("multi-source DAG must evaluate");

    // Each chain produces its own wire data.
    for id in ["ren_a", "drop_a", "ren_b", "drop_b"] {
        assert!(
            eval.wire_data.contains_key(id),
            "{id} missing from wire data; got keys {:?}",
            eval.wire_data.keys().collect::<Vec<_>>()
        );
    }
}

#[test]
fn branching_optic_classification_uses_carrier() {
    // The intrinsic optic kind for each branch component should still be
    // its individual kind: rename = Iso, add = Lens, drop = Lens.
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let circuit = branching_dag_circuit();
    assert_eq!(
        protolab_eval::component_intrinsic_optic_kind(
            &circuit,
            &Name::from("rename"),
            Some(&source),
        )
        .unwrap(),
        OpticKind::Iso
    );
    assert_eq!(
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("add"), Some(&source),)
            .unwrap(),
        OpticKind::Lens
    );
    assert_eq!(
        protolab_eval::component_intrinsic_optic_kind(
            &circuit,
            &Name::from("drop"),
            Some(&source),
        )
        .unwrap(),
        OpticKind::Lens
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Feedback wires
// ═══════════════════════════════════════════════════════════════════════

/// Build a 2-component chain with an extra feedback wire from the
/// downstream component's output back to the upstream component's input.
fn chain_with_feedback() -> Schema {
    let mut b = CircuitBuilder::new();
    for (id, ty) in [("a", "rename_field"), ("b", "drop_field")] {
        b = b.add_component(id, ty).unwrap();
        b = b
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
    b = b
        .add_wire("w_ab", "a.out", "b.in", Some("lens"))
        .unwrap()
        .add_feedback_wire("fb", "b.out", "a.in")
        .unwrap();
    b = b
        .set_param("a", "old_name", "name")
        .set_param("a", "new_name", "displayName")
        .set_param("b", "field_name", "legacyId");
    b.build()
}

#[test]
fn feedback_wire_is_excluded_from_topological_sort() {
    let circuit = chain_with_feedback();
    let sorted = topological_sort(&circuit).expect("feedback edges must be excluded");
    let pos = |id: &str| sorted.iter().position(|n| n.as_ref() == id).unwrap();
    assert_eq!(sorted.len(), 2);
    assert!(
        pos("a") < pos("b"),
        "feedback edge must not flip topological order"
    );
}

#[test]
fn feedback_wire_passes_chain_construction() {
    let circuit = chain_with_feedback();
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let chain = circuit_to_protolens_chain_with_schema(&circuit, Some(&source))
        .expect("chain construction must succeed despite feedback edge");
    // The chain should contain steps for `a` (rename, 1 step) + `b` (drop, 1 step).
    assert!(
        !chain.steps.is_empty(),
        "chain must have steps for the non-feedback components"
    );
}

#[test]
fn feedback_wire_does_not_loop_during_evaluation() {
    // The current eval engine treats feedback edges as no-ops (fixpoint
    // iteration is not yet implemented). This test pins that fact: a
    // circuit with one feedback edge must terminate and produce the same
    // output as the underlying acyclic chain.
    let circuit = chain_with_feedback();
    let source = flat_schema("user", &[("name", "string"), ("legacyId", "integer")]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice", "legacyId": 42}"#);
    assert_eq!(out["displayName"], serde_json::json!("Alice"));
    assert!(out.get("legacyId").is_none());
    assert!(out.get("name").is_none());
}

// ═══════════════════════════════════════════════════════════════════════
// compute_field richer tests
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn compute_field_reads_multiple_child_scalars() {
    let source = flat_schema("user", &[("firstName", "string"), ("lastName", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[
            ("target", "fullName"),
            ("expr", r#"concat firstName (concat " " lastName)"#),
        ],
    );
    let out = run_forward(
        &circuit,
        &source,
        r#"{"firstName": "Ada", "lastName": "Lovelace"}"#,
    );
    assert_eq!(
        out["fullName"],
        serde_json::json!("Ada Lovelace"),
        "compute_field should concatenate two child scalars; got {out}"
    );
    assert_eq!(out["firstName"], serde_json::json!("Ada"));
    assert_eq!(out["lastName"], serde_json::json!("Lovelace"));
}

#[test]
fn compute_field_with_missing_child_uses_null() {
    // Schema declares both firstName and lastName, but the input only
    // populates firstName. We pin whatever panproto_expr does for the
    // unbound child reference: either a clean error or a null/empty
    // value in the output. Document the observed behavior so a future
    // change is a tripwire.
    let source = flat_schema("user", &[("firstName", "string"), ("lastName", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[
            ("target", "fullName"),
            ("expr", r#"concat firstName (concat " " lastName)"#),
        ],
    );
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value = serde_json::from_str(r#"{"firstName": "Ada"}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let result = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance);

    // Either path is acceptable; assert one of them holds and document.
    match result {
        Ok(eval) => {
            let out = panproto_inst::parse::to_json(&eval.output_schema, &eval.output);
            // If eval succeeds, the missing child must surface somehow:
            // either as an empty/null fullName, or with the prefix only.
            // We just assert the firstName survives — the precise shape
            // of fullName under a missing var is observed-behavior.
            assert_eq!(out["firstName"], serde_json::json!("Ada"));
        }
        Err(e) => {
            // Unbound variable: panproto_expr should report it.
            let s = format!("{e:?}");
            assert!(
                s.to_lowercase().contains("expr")
                    || s.to_lowercase().contains("unbound")
                    || s.to_lowercase().contains("lastname")
                    || s.to_lowercase().contains("missing"),
                "missing-child error should mention expr/unbound/missing; got {s}"
            );
        }
    }
}

#[test]
// `compute_field` expressions are evaluated manually against the view
// AFTER the chain (including any upstream `rename_field` steps) has been
// applied by `panproto_lens::asymmetric::get`. The expression env is built
// from the view's current arcs — which carry the renamed edge names — so
// `lower(displayName)` resolves to the new key.
//
// The copy of the transform installed on the compiled lens (a complement
// side-channel for direct `put`) is evaluated by panproto against the
// source fiber instead, where `displayName` does not exist. Before
// panproto 0.57 that copy failed silently; it now reports, so
// `wire_data::rewrite_into_source_frame` rewrites its free variables back
// into the source frame. See panproto#245 for the upstream composition
// bug that makes the rewrite necessary.
fn compute_field_after_rename_uses_renamed_key() {
    // rename(name → displayName) → compute_field(target=slug, expr=lower(displayName))
    // The compute_field expression must resolve `displayName` (the new
    // key produced by the upstream rename), not the original `name`.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = build_chain(&[
        (
            "rename",
            "rename_field",
            vec![("old_name", "name"), ("new_name", "displayName")],
        ),
        (
            "compute",
            "compute_field",
            vec![("target", "slug"), ("expr", "lower(displayName)")],
        ),
    ]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["displayName"], serde_json::json!("Alice"));
    assert_eq!(
        out["slug"],
        serde_json::json!("alice"),
        "compute_field must read the renamed key; got {out}"
    );
}

#[test]
fn compute_field_with_inverse_is_iso() {
    // With an inverse provided, compute_field is classified as Iso, and
    // a full round-trip should hold (modulo expression evaluation).
    let source = flat_schema("user", &[("name", "string"), ("slug", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[
            ("target", "slug"),
            ("expr", "lower(name)"),
            ("inverse", "upper(slug)"),
        ],
    );
    let kind =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("c"), Some(&source))
            .unwrap();
    assert_eq!(
        kind,
        OpticKind::Iso,
        "compute_field with inverse should be Iso"
    );
}

// ── Chained renames ─────────────────────────────────────────────────

// A component names a *field*; the combinator takes the *vertex* that
// field's edge points at. Those were assumed to line up as
// `{parent}.{field}`, which stops holding as soon as a chain renames
// anything: `RenameEdgeName` moves the edge's name and leaves the vertex
// id alone. A second component naming the field by its new name computed a
// vertex that does not exist, and the combinator silently did nothing.

#[test]
fn chained_renames_of_one_field_all_apply() {
    // a → b → c. The second rename used to be a no-op, yielding `b`.
    let source = flat_schema("user", &[("a", "string")]);
    let circuit = build_chain(&[
        ("r1", "rename_field", vec![("old_name", "a"), ("new_name", "b")]),
        ("r2", "rename_field", vec![("old_name", "b"), ("new_name", "c")]),
    ]);
    let out = run_forward(&circuit, &source, r#"{"a": "X"}"#);
    assert_eq!(
        out["c"],
        serde_json::json!("X"),
        "both renames must apply, leaving the value under `c`; got {out}"
    );
    assert!(out.get("a").is_none(), "`a` must not survive; got {out}");
    assert!(
        out.get("b").is_none(),
        "`b` is an intermediate name and must not survive; got {out}"
    );
}

#[test]
fn a_field_swap_via_a_temporary_exchanges_both_values() {
    // first → tmp, last → first, tmp → last. Expressible only because a
    // rename now resolves its vertex from the schema as of that step.
    let source = flat_schema("user", &[("first", "string"), ("last", "string")]);
    let circuit = build_chain(&[
        ("r1", "rename_field", vec![("old_name", "first"), ("new_name", "tmp")]),
        ("r2", "rename_field", vec![("old_name", "last"), ("new_name", "first")]),
        ("r3", "rename_field", vec![("old_name", "tmp"), ("new_name", "last")]),
    ]);
    let out = run_forward(&circuit, &source, r#"{"first": "Ada", "last": "Lovelace"}"#);
    assert_eq!(out["first"], serde_json::json!("Lovelace"), "got {out}");
    assert_eq!(out["last"], serde_json::json!("Ada"), "got {out}");
    assert!(out.get("tmp").is_none(), "the temporary must not survive; got {out}");
}

#[test]
fn compute_field_after_a_swap_reads_the_post_swap_name() {
    // The conjugation that walks an expression back into the source frame
    // has to apply the renames simultaneously: one at a time, `first`
    // rewrites to `last` and that `last` is then re-captured, collapsing
    // the swap and computing over the wrong field.
    let source = flat_schema("user", &[("first", "string"), ("last", "string")]);
    let circuit = build_chain(&[
        ("r1", "rename_field", vec![("old_name", "first"), ("new_name", "tmp")]),
        ("r2", "rename_field", vec![("old_name", "last"), ("new_name", "first")]),
        ("r3", "rename_field", vec![("old_name", "tmp"), ("new_name", "last")]),
        (
            "compute",
            "compute_field",
            vec![("target", "tag"), ("expr", "lower(first)")],
        ),
    ]);
    let out = run_forward(&circuit, &source, r#"{"first": "Ada", "last": "Lovelace"}"#);
    assert_eq!(
        out["tag"],
        serde_json::json!("lovelace"),
        "compute_field must read the post-swap `first` (= original `last`); got {out}"
    );
}

#[test]
fn dropping_a_renamed_field_removes_it() {
    // `drop_field` resolved its vertex by the same convention, so dropping
    // a field an earlier component renamed silently kept it.
    let source = flat_schema("user", &[("a", "string"), ("keep", "string")]);
    let circuit = build_chain(&[
        ("r1", "rename_field", vec![("old_name", "a"), ("new_name", "b")]),
        ("d1", "drop_field", vec![("field_name", "b")]),
    ]);
    let out = run_forward(&circuit, &source, r#"{"a": "X", "keep": "Y"}"#);
    assert!(out.get("b").is_none(), "renamed field must be dropped; got {out}");
    assert!(out.get("a").is_none(), "original name must not reappear; got {out}");
    assert_eq!(out["keep"], serde_json::json!("Y"), "got {out}");
}
