//! End-to-end integration tests for the demo circuit.
//!
//! These tests reproduce the exact flow that runs in the browser when the
//! user clicks "Run" on the default demo circuit:
//!
//! 1. Build the user-demo source schema (root vertex `user` + 3 fields).
//! 2. Build the demo circuit (rename name→displayName, add bio, drop legacyId).
//! 3. Parse JSON `{"name": "Alice", "legacyId": 42}` into a WInstance.
//! 4. Run forward evaluation.
//! 5. Render the output WInstance to JSON via panproto_inst::parse::to_json.
//! 6. Assert the JSON has `displayName: "Alice"`, has `bio`, and lacks
//!    `name` and `legacyId`.
//!
//! If any of these fail, the visible app breaks too — these tests are the
//! contract for "the demo works".

use std::collections::HashMap;

use panproto_gat::Name;
use panproto_schema::{Edge, Protocol, Schema, Vertex};
use protolab_eval::{find_root_vertex, wire_data_for_circuit};
use protolab_schema::builder::demo_circuit;
use smallvec::SmallVec;

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

/// Build the same user schema that protolab-wasm's `build_user_schema()`
/// constructs, so the test exercises identical vertex IDs.
fn build_user_schema() -> Schema {
    let mut vertices: HashMap<Name, Vertex> = HashMap::new();
    let mut edges: HashMap<Edge, Name> = HashMap::new();
    let mut outgoing: HashMap<Name, SmallVec<Edge, 4>> = HashMap::new();
    let mut incoming: HashMap<Name, SmallVec<Edge, 4>> = HashMap::new();
    let mut between: HashMap<(Name, Name), SmallVec<Edge, 2>> = HashMap::new();

    vertices.insert(
        Name::from("user"),
        Vertex {
            id: "user".into(),
            kind: "object".into(),
            nsid: None,
        },
    );

    for (field_name, kind) in &[
        ("name", "string"),
        ("legacyId", "integer"),
        ("email", "string"),
    ] {
        let field_id = format!("user.{field_name}");
        let field_vertex_name = Name::from(field_id.as_str());

        vertices.insert(
            field_vertex_name.clone(),
            Vertex {
                id: field_id.clone().into(),
                kind: (*kind).into(),
                nsid: None,
            },
        );

        let edge = Edge {
            src: Name::from("user"),
            tgt: field_vertex_name.clone(),
            kind: "prop".into(),
            name: Some(Name::from(*field_name)),
        };

        outgoing
            .entry(Name::from("user"))
            .or_default()
            .push(edge.clone());
        incoming
            .entry(field_vertex_name.clone())
            .or_default()
            .push(edge.clone());
        between
            .entry((Name::from("user"), field_vertex_name))
            .or_default()
            .push(edge.clone());
        edges.insert(edge, Name::from("prop"));
    }

    Schema {
        protocol: "user-demo".into(),
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
        entries: vec![Name::from("user")],
        outgoing,
        incoming,
        between,
    }
}

#[test]
fn user_schema_root_vertex_is_user() {
    let schema = build_user_schema();
    let root = find_root_vertex(&schema).expect("schema must have a root");
    assert_eq!(
        root.as_ref(),
        "user",
        "find_root_vertex must return `user`, not an arbitrary HashMap entry"
    );
}

#[test]
fn parse_json_round_trip_through_user_schema() {
    let schema = build_user_schema();
    let root = find_root_vertex(&schema).unwrap().to_string();
    let json: serde_json::Value =
        serde_json::from_str(r#"{"name": "Alice", "legacyId": 42}"#).unwrap();

    let instance =
        panproto_inst::parse::parse_json(&schema, &root, &json).expect("parse_json must succeed");

    let rendered = panproto_inst::parse::to_json(&schema, &instance);
    let obj = rendered.as_object().expect("rendered must be an object");

    assert_eq!(
        obj.get("name").and_then(|v| v.as_str()),
        Some("Alice"),
        "round-trip must preserve `name`; got {rendered}"
    );
    assert_eq!(
        obj.get("legacyId").and_then(|v| v.as_i64()),
        Some(42),
        "round-trip must preserve `legacyId`; got {rendered}"
    );
}

#[test]
fn demo_circuit_rename_add_drop_full_pipeline() {
    let source_schema = build_user_schema();
    let circuit = demo_circuit();
    let source_protocol = make_protocol(&source_schema);

    let root = find_root_vertex(&source_schema).unwrap().to_string();
    let input_json: serde_json::Value =
        serde_json::from_str(r#"{"name": "Alice", "legacyId": 42}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source_schema, &root, &input_json)
        .expect("parse_json must succeed");

    let eval = wire_data_for_circuit(&circuit, &source_schema, &source_protocol, &input_instance)
        .expect("forward eval must succeed");

    let output_json = panproto_inst::parse::to_json(&eval.output_schema, &eval.output);
    let obj = output_json
        .as_object()
        .unwrap_or_else(|| panic!("output must be an object; got {output_json}"));

    // Rename: name → displayName.
    assert_eq!(
        obj.get("displayName").and_then(|v| v.as_str()),
        Some("Alice"),
        "rename_field should produce `displayName: \"Alice\"`; got {output_json}"
    );
    assert!(
        !obj.contains_key("name"),
        "after rename, `name` key must be gone; got {output_json}"
    );

    // Add: bio should appear (default empty string).
    assert!(
        obj.contains_key("bio"),
        "add_field should add `bio` to the output; got {output_json}"
    );

    // Drop: legacyId should be gone.
    assert!(
        !obj.contains_key("legacyId"),
        "drop_field should remove `legacyId` from the output; got {output_json}"
    );
}

#[test]
fn demo_circuit_per_wire_data_renders_intermediate_state() {
    let source_schema = build_user_schema();
    let circuit = demo_circuit();
    let source_protocol = make_protocol(&source_schema);

    let root = find_root_vertex(&source_schema).unwrap().to_string();
    let input_json: serde_json::Value =
        serde_json::from_str(r#"{"name": "Alice", "legacyId": 42}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source_schema, &root, &input_json)
        .expect("parse_json must succeed");

    let eval = wire_data_for_circuit(&circuit, &source_schema, &source_protocol, &input_instance)
        .expect("forward eval must succeed");

    // After the rename component, `displayName` should exist and `name` shouldn't.
    let rename_inst = eval.wire_data.get("rename").expect("rename wire data");
    let rename_schema = eval.wire_schemas.get("rename").expect("rename wire schema");
    let after_rename = panproto_inst::parse::to_json(rename_schema, rename_inst);
    let after_rename_obj = after_rename.as_object().unwrap();
    assert!(
        after_rename_obj.contains_key("displayName"),
        "rename wire should have displayName; got {after_rename}"
    );
    assert!(
        !after_rename_obj.contains_key("name"),
        "rename wire should NOT have name; got {after_rename}"
    );

    // After the add component, `bio` should exist.
    let add_inst = eval.wire_data.get("add").expect("add wire data");
    let add_schema = eval.wire_schemas.get("add").expect("add wire schema");
    let after_add = panproto_inst::parse::to_json(add_schema, add_inst);
    assert!(
        after_add.as_object().unwrap().contains_key("bio"),
        "add wire should have bio; got {after_add}"
    );

    // After the drop component, `legacyId` should be gone.
    let drop_inst = eval.wire_data.get("drop").expect("drop wire data");
    let drop_schema = eval.wire_schemas.get("drop").expect("drop wire schema");
    let after_drop = panproto_inst::parse::to_json(drop_schema, drop_inst);
    assert!(
        !after_drop.as_object().unwrap().contains_key("legacyId"),
        "drop wire should NOT have legacyId; got {after_drop}"
    );
}
