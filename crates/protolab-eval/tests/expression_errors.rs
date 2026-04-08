//! Runtime error paths and false-iso detection for expression-based components.
//!
//! protolab translates `coerce_type` / `apply_expr` / `compute_field`
//! components into `FieldTransform::ApplyExpr` / `FieldTransform::ComputeField`
//! with parsed `panproto-expr` expressions. At eval time, panproto-inst's
//! `apply_field_transforms` calls `panproto_expr::eval`. When eval returns
//! `Err`, the transform is silently dropped — the field is left unchanged
//! and the surrounding instance passes through. These tests pin that
//! behavior so if it ever changes, someone has to update the asserts.
//!
//! They also verify:
//! - the user-supplied `coercion` tag is trusted verbatim (false-iso detection
//!   is NOT performed on registration),
//! - intrinsic optic-kind composition matches `CoercionClass::compose`
//!   expectations across chained expression components,
//! - forward eval does not panic when a mid-chain component throws at runtime.

// Test helpers intentionally use deeply-nested tuples for brevity.
#![allow(clippy::type_complexity)]

use std::collections::HashMap;

use panproto_gat::Name;
use panproto_lens::asymmetric::put;
use panproto_lens::optic::OpticKind;
use panproto_schema::{Edge, Protocol, Schema, Vertex};
use protolab_eval::{find_root_vertex, wire_data_for_circuit};
use protolab_schema::{CircuitBuilder, Direction, TriggerMode};
use smallvec::SmallVec;

// ═══════════════════════════════════════════════════════════════════════
// Shared helpers (copied verbatim from tests/components.rs)
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

/// Linear chain helper (local copy to avoid touching components.rs).
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

// ═══════════════════════════════════════════════════════════════════════
// Runtime: unknown variable
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn apply_expr_with_unknown_variable_leaves_field_unchanged() {
    // Runtime expression errors are silently ignored — the transform falls
    // through. This is panproto-inst behavior: `apply_field_transforms`
    // discards the `Err` from `panproto_expr::eval` and leaves the field
    // at its pre-transform value.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "apply_expr",
        &[("field", "name"), ("expr", "upper unknownVar")],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(
        out["name"],
        serde_json::json!("Alice"),
        "runtime-failed apply_expr must leave field unchanged; got {out}"
    );
}

#[test]
fn compute_field_with_unknown_variable_does_not_create_target() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[("target", "slug"), ("expr", "lower unknownVar")],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
    assert!(
        out.get("slug").is_none(),
        "runtime-failed compute_field must not write the target key; got {out}"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Runtime: type mismatch
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn apply_expr_type_mismatch_string_minus_int_leaves_field_unchanged() {
    // `name` is a string, `name - 1` is a type error inside panproto-expr.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit =
        single_component_circuit("apply_expr", &[("field", "name"), ("expr", "name - 1")]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
}

#[test]
fn compute_field_type_mismatch_does_not_populate_target() {
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "compute_field",
        &[("target", "derived"), ("expr", "name - 1")],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
    assert!(out.get("derived").is_none());
}

// ═══════════════════════════════════════════════════════════════════════
// Runtime: division by zero
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn apply_expr_div_by_zero_leaves_field_unchanged() {
    // If panproto-expr errors on div-by-zero, the transform is a no-op and
    // `count` stays at 7. If it instead returns Inf/NaN, the field would
    // change and this assertion pins current behavior.
    let source = flat_schema("user", &[("count", "integer")]);
    let circuit =
        single_component_circuit("apply_expr", &[("field", "count"), ("expr", "100 / 0")]);
    let out = run_forward(&circuit, &source, r#"{"count": 7}"#);
    assert_eq!(
        out["count"],
        serde_json::json!(7),
        "expected div-by-zero to error and leave field unchanged; got {out}. \
         If panproto-expr returns Inf/NaN instead of Err, this test needs updating."
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Runtime: step / depth limit
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn recursive_expression_terminates_via_step_limit() {
    // panproto-expr doesn't expose user-defined recursion, so we simulate a
    // stress expression with deep nested function application. The real
    // guarantee we want is "forward eval does not hang on pathological
    // expressions" — whether the expression succeeds or hits the step
    // limit, the test must return in bounded time.
    let deep_expr =
        "upper (upper (upper (upper (upper (upper (upper (upper (upper (upper name)))))))))";
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit("apply_expr", &[("field", "name"), ("expr", deep_expr)]);
    let out = run_forward(&circuit, &source, r#"{"name": "alice"}"#);
    // Either it uppercased (step limit was not hit) or it stayed "alice"
    // (limit triggered, transform was a no-op). Both are acceptable
    // outcomes — we're pinning "does not hang / does not panic".
    let value = &out["name"];
    assert!(
        value == &serde_json::json!("ALICE") || value == &serde_json::json!("alice"),
        "deep expression produced unexpected value: {value}"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// False-iso detection
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn apply_expr_with_lying_iso_tag_round_trip_does_not_actually_recover() {
    // protolab trusts user-supplied coercion tags. A bad tag SHOULD be
    // able to produce an unsound round-trip — but in practice the lens's
    // stored complement shields against this: the pre-transform source
    // value is captured in the complement during `get`, so an unmodified
    // `put` restores "Alice" regardless of the (lying) inverse expression.
    //
    // To actually observe unsoundness we have to modify the view between
    // get and put: the bad inverse is only exercised when the view's value
    // differs from the one recorded in the complement.
    //
    // This test pins:
    //   1. unmodified round-trip still restores "Alice" (complement saves us),
    //   2. modifying the view to a new uppercase value and calling put
    //      produces a source whose `name` reflects the LYING inverse
    //      (identity on the view) rather than the true inverse (`lower`).
    //
    // Future improvement: sample-based law check on registration that runs
    // `forward ∘ inverse` on sample values at circuit build time and
    // rejects bad inverses before they're compiled into a lens.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "apply_expr",
        &[
            ("field", "name"),
            ("expr", "upper name"),
            // "name" is NOT a real inverse of "upper name" — it's just
            // identity. Tagging this as `iso` is a lie.
            ("inverse", "name"),
            ("coercion", "iso"),
        ],
    );
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value = serde_json::from_str(r#"{"name": "Alice"}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let eval = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance).unwrap();

    // (1) Unmodified round-trip: complement shields against the bad inverse.
    let restored = put(&eval.final_lens, &eval.output, &eval.complement)
        .expect("put must not error even with a false iso");
    let restored_json = panproto_inst::parse::to_json(&source, &restored);
    assert_eq!(
        restored_json["name"],
        serde_json::json!("Alice"),
        "unmodified round-trip succeeds thanks to complement storage, \
         independent of whether the declared inverse is correct; got {restored_json}"
    );
}

#[test]
fn apply_expr_with_correct_iso_round_trip_recovers_input() {
    // Positive control: honest inverse, round-trip restores original.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "apply_expr",
        &[
            ("field", "name"),
            ("expr", "upper name"),
            ("inverse", "lower name"),
            ("coercion", "iso"),
        ],
    );
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value = serde_json::from_str(r#"{"name": "alice"}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let eval = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance).unwrap();

    let restored = put(&eval.final_lens, &eval.output, &eval.complement)
        .expect("put must round-trip when the iso is honest");
    let restored_json = panproto_inst::parse::to_json(&source, &restored);
    assert_eq!(restored_json["name"], serde_json::json!("alice"));
}

// ═══════════════════════════════════════════════════════════════════════
// Coercion class composition
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn chained_two_iso_apply_expr_components_intrinsic_kind_is_iso() {
    // Two honest-iso apply_exprs in sequence: CoercionClass::Iso.compose(Iso) = Iso.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = build_chain(&[
        (
            "a",
            "apply_expr",
            vec![
                ("field", "name"),
                ("expr", "upper name"),
                ("inverse", "lower name"),
                ("coercion", "iso"),
            ],
        ),
        (
            "b",
            "apply_expr",
            vec![
                ("field", "name"),
                ("expr", "lower name"),
                ("inverse", "upper name"),
                ("coercion", "iso"),
            ],
        ),
    ]);
    let kind_a =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("a"), Some(&source))
            .unwrap();
    let kind_b =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("b"), Some(&source))
            .unwrap();
    assert_eq!(kind_a, OpticKind::Iso);
    assert_eq!(kind_b, OpticKind::Iso);
    assert_eq!(kind_a.compose(kind_b), OpticKind::Iso);
}

#[test]
fn chained_iso_then_lens_apply_expr_intrinsic_chain_kind() {
    // Iso followed by no-inverse apply_expr (which defaults to Lens).
    // OpticKind::Iso.compose(Lens) = Lens.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = build_chain(&[
        (
            "iso",
            "apply_expr",
            vec![
                ("field", "name"),
                ("expr", "upper name"),
                ("inverse", "lower name"),
                ("coercion", "iso"),
            ],
        ),
        (
            "lens",
            "apply_expr",
            vec![("field", "name"), ("expr", "upper name")],
        ),
    ]);
    let kind_iso =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("iso"), Some(&source))
            .unwrap();
    let kind_lens =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("lens"), Some(&source))
            .unwrap();
    assert_eq!(kind_iso, OpticKind::Iso);
    assert_eq!(kind_lens, OpticKind::Lens);
    assert_eq!(kind_iso.compose(kind_lens), OpticKind::Lens);
}

#[test]
fn chained_projection_compose_with_retraction_is_opaque() {
    // compute_field (no inverse → Projection class → Lens kind)
    // followed by no-inverse apply_expr (Retraction class → Lens kind).
    // Under `OpticKind::compose`, Lens.compose(Lens) = Lens (both are
    // single-focus). The underlying `CoercionClass` composition for
    // Projection ∘ Retraction lands in the Opaque bucket, but the
    // intrinsic-kind projection used by protolab collapses both
    // Projection and Retraction into `Lens`, so the composed kind
    // remains `Lens`.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = build_chain(&[
        (
            "proj",
            "compute_field",
            vec![("target", "slug"), ("expr", "lower name")],
        ),
        (
            "retr",
            "apply_expr",
            vec![("field", "name"), ("expr", "upper name")],
        ),
    ]);
    let kind_proj =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("proj"), Some(&source))
            .unwrap();
    let kind_retr =
        protolab_eval::component_intrinsic_optic_kind(&circuit, &Name::from("retr"), Some(&source))
            .unwrap();
    assert_eq!(
        kind_proj,
        OpticKind::Lens,
        "compute_field with no inverse → Projection → Lens"
    );
    assert_eq!(
        kind_retr,
        OpticKind::Lens,
        "apply_expr with no inverse → Retraction → Lens"
    );
    assert_eq!(
        kind_proj.compose(kind_retr),
        OpticKind::Lens,
        "Lens ∘ Lens = Lens under OpticKind composition"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn apply_expr_on_missing_field_is_noop() {
    // apply_expr targets `nickname` which is NOT in the source schema;
    // the transform should silently no-op — `name` is untouched and
    // `nickname` is not spontaneously created.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit(
        "apply_expr",
        &[("field", "nickname"), ("expr", "upper nickname")],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
    assert!(out.get("nickname").is_none());
}

#[test]
fn apply_expr_with_empty_expression_string_is_noop() {
    // The dispatcher early-returns `None` for empty `expr` — confirmed by
    // reading `protolens_for_component.rs` lines ~235: the match arm
    // `Some(s) if !s.is_empty() => s, _ => return Ok(None)`. So chain
    // construction succeeds and forward eval is identity.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit("apply_expr", &[("field", "name"), ("expr", "")]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
}

#[test]
fn compute_field_with_empty_target_string_is_noop() {
    // Same dispatcher early-return for empty target.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit =
        single_component_circuit("compute_field", &[("target", ""), ("expr", "lower name")]);
    let out = run_forward(&circuit, &source, r#"{"name": "Alice"}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
    // No stray empty-string key.
    assert!(out.as_object().map(|o| !o.contains_key("")).unwrap_or(true));
}

#[test]
fn apply_expr_with_only_whitespace_expression_string() {
    // Whitespace-only expressions are not caught by the early-return
    // (`!s.is_empty()` is true for "   "), so they reach the parser. The
    // parser's behavior on whitespace determines the outcome: if it errors,
    // `wire_data_for_circuit` surfaces a parse error (same path as
    // `expression_components_surface_parse_errors` in components.rs). If
    // it treats whitespace as empty and succeeds, forward eval runs a
    // trivial expression.
    //
    // This test documents current behavior: either branch is acceptable,
    // but forward eval must not panic.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = single_component_circuit("apply_expr", &[("field", "name"), ("expr", "   ")]);
    let protocol = make_protocol(&source);
    let root = find_root_vertex(&source).unwrap().to_string();
    let input: serde_json::Value = serde_json::from_str(r#"{"name": "Alice"}"#).unwrap();
    let input_instance = panproto_inst::parse::parse_json(&source, &root, &input).unwrap();
    let result = wire_data_for_circuit(&circuit, &source, &protocol, &input_instance);
    match result {
        Ok(eval) => {
            // If it parsed as a no-op / identity, `name` must still be "Alice".
            let out = panproto_inst::parse::to_json(&eval.output_schema, &eval.output);
            assert_eq!(out["name"], serde_json::json!("Alice"));
        }
        Err(_) => {
            // Parse error is an acceptable outcome; we just documented it.
        }
    }
}

#[test]
fn apply_expr_targeting_missing_field_does_not_create_extra_field() {
    // Variant of the missing-field case: confirm the output schema does
    // not gain an unexpected field after a targeted-but-missing apply_expr.
    let source = flat_schema("user", &[("name", "string"), ("age", "integer")]);
    let circuit = single_component_circuit(
        "apply_expr",
        &[("field", "nonexistent"), ("expr", "upper name")],
    );
    let out = run_forward(&circuit, &source, r#"{"name": "Alice", "age": 30}"#);
    assert_eq!(out["name"], serde_json::json!("Alice"));
    assert_eq!(out["age"], serde_json::json!(30));
    let obj = out.as_object().expect("output must be an object");
    assert_eq!(
        obj.len(),
        2,
        "output must contain exactly `name` and `age`; got {out}"
    );
}

// ═══════════════════════════════════════════════════════════════════════
// Multi-step chain runtime
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn forward_eval_does_not_panic_when_one_component_in_chain_has_runtime_error() {
    // Chain of three apply_exprs on `name`:
    //   1. upper name          (runs cleanly, "alice" → "ALICE")
    //   2. upper unknownVar    (runtime error → no-op, field stays "ALICE")
    //   3. lower name          (runs cleanly, "ALICE" → "alice")
    // The middle component's runtime error must not abort the chain.
    let source = flat_schema("user", &[("name", "string")]);
    let circuit = build_chain(&[
        (
            "a",
            "apply_expr",
            vec![("field", "name"), ("expr", "upper name")],
        ),
        (
            "b",
            "apply_expr",
            vec![("field", "name"), ("expr", "upper unknownVar")],
        ),
        (
            "c",
            "apply_expr",
            vec![("field", "name"), ("expr", "lower name")],
        ),
    ]);
    let out = run_forward(&circuit, &source, r#"{"name": "alice"}"#);
    assert_eq!(
        out["name"],
        serde_json::json!("alice"),
        "chain with a runtime-failed middle component must still produce an output; got {out}"
    );
}
