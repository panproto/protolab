//! WASM API entry points.
//!
//! All complex data crosses the boundary as MessagePack bytes.
//! Handles (`u32`) reference resources in the thread-local slab.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use protolab_core::{convert, topo};
use protolab_schema::builder::{self, CircuitBuilder};
use protolab_schema::kinds;
use protolab_schema::mutate;

use crate::error::WasmError;
use crate::slab::{self, CircuitState, Resource};

// ── Data types crossing the boundary ────────────────────────────────

/// Component spec sent from JS (MessagePack-encoded).
#[derive(Deserialize)]
struct ComponentSpec {
    id: String,
    component_type: String,
    ports: Vec<PortSpec>,
    #[serde(default)]
    params: Vec<ParamSpec>,
}

#[derive(Deserialize)]
struct PortSpec {
    id: String,
    direction: String,
    #[serde(default = "default_hot")]
    trigger: String,
}

fn default_hot() -> String {
    "hot".into()
}

#[derive(Deserialize)]
struct ParamSpec {
    key: String,
    value: String,
}

/// Wire spec sent from JS (MessagePack-encoded).
#[derive(Deserialize)]
struct WireSpec {
    wire_id: String,
    src_port: String,
    tgt_port: String,
    #[serde(default)]
    optic_kind: Option<String>,
    #[serde(default)]
    is_feedback: bool,
}

/// Graph data returned to JS for React Flow rendering.
#[derive(Serialize)]
struct CircuitGraph {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
}

#[derive(Serialize)]
struct GraphNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    label: String,
    component_type: String,
    optic_kind: String,
    ports: Vec<GraphPort>,
    params: Vec<GraphParam>,
    position: Position,
}

#[derive(Serialize)]
struct GraphPort {
    id: String,
    direction: String,
    trigger: String,
}

#[derive(Serialize)]
struct GraphParam {
    key: String,
    value: String,
}

#[derive(Serialize)]
struct GraphEdge {
    id: String,
    source: String,
    target: String,
    source_handle: String,
    target_handle: String,
    optic_kind: String,
    is_feedback: bool,
    complement_info: String,
}

#[derive(Serialize)]
struct Position {
    x: f64,
    y: f64,
}

// ── WASM entry points ───────────────────────────────────────────────

/// Create an empty circuit and return a handle.
#[wasm_bindgen]
pub fn create_circuit() -> u32 {
    let schema = CircuitBuilder::new().build();
    slab::alloc(Resource::Circuit(CircuitState::new(schema)))
}

/// Free a resource handle.
#[wasm_bindgen]
pub fn free_handle(handle: u32) {
    slab::free(handle);
}

/// Topologically sort the components of a circuit.
///
/// Returns MessagePack-encoded `Vec<String>` of component IDs.
#[wasm_bindgen]
pub fn topological_sort(handle: u32) -> Result<Vec<u8>, JsError> {
    topological_sort_inner(handle).map_err(Into::into)
}

fn topological_sort_inner(handle: u32) -> Result<Vec<u8>, WasmError> {
    let circuit = slab::get_circuit(handle)?;
    let sorted = topo::topological_sort(&circuit)?;
    let names: Vec<String> = sorted.into_iter().map(|n| n.to_string()).collect();
    rmp_serde::to_vec_named(&names).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Get the circuit graph data for React Flow rendering.
///
/// Returns MessagePack-encoded [`CircuitGraph`]. If the circuit has a
/// source schema assigned, the wire optic kinds are computed by
/// instantiating the protolens chain via `panproto_lens` and classifying
/// each step's optic. Otherwise falls back to the hardcoded defaults.
#[wasm_bindgen]
pub fn get_circuit_graph(handle: u32) -> Result<Vec<u8>, JsError> {
    get_circuit_graph_inner(handle).map_err(Into::into)
}

fn get_circuit_graph_inner(handle: u32) -> Result<Vec<u8>, WasmError> {
    let (circuit, source_h) = slab::with_resource(handle, |r| match r {
        Resource::Circuit(state) => (state.schema.clone(), state.source_schema_h),
        _ => (
            panproto_schema::Schema {
                protocol: String::new(),
                vertices: Default::default(),
                edges: Default::default(),
                hyper_edges: Default::default(),
                constraints: Default::default(),
                required: Default::default(),
                nsids: Default::default(),
                variants: Default::default(),
                orderings: Default::default(),
                recursion_points: Default::default(),
                spans: Default::default(),
                usage_modes: Default::default(),
                nominal: Default::default(),
                coercions: Default::default(),
                mergers: Default::default(),
                defaults: Default::default(),
                policies: Default::default(),
                entries: Vec::new(),
                outgoing: Default::default(),
                incoming: Default::default(),
                between: Default::default(),
            },
            None,
        ),
    })?;

    let computed_optics = if let Some(h) = source_h {
        if let Ok(source_schema) = slab::get_schema(h) {
            compute_per_component_optics(&circuit, &source_schema).ok()
        } else {
            None
        }
    } else {
        None
    };

    let graph = schema_to_graph_with_optics(&circuit, computed_optics.as_ref());
    rmp_serde::to_vec_named(&graph).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Compute the optic kind for each component using
/// [`protolab_eval::component_intrinsic_optic_kind`], which combines the
/// per-component protolens chain (`classify_transform`) with the
/// per-component value-level field transforms (their `CoercionClass`
/// → `OpticKind` mapping). New component types added in `protolab-eval`
/// are picked up automatically — no hardcoded tables here.
fn compute_per_component_optics(
    circuit: &panproto_schema::Schema,
    source_schema: &panproto_schema::Schema,
) -> Result<std::collections::HashMap<String, String>, WasmError> {
    use protolab_eval::component_intrinsic_optic_kind;

    let sorted = protolab_core::topo::topological_sort(circuit)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    let mut result: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for comp_id in &sorted {
        let kind = component_intrinsic_optic_kind(circuit, comp_id, Some(source_schema))
            .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;
        result.insert(comp_id.to_string(), optic_kind_name(kind).to_owned());
    }

    Ok(result)
}

fn optic_kind_name(kind: panproto_lens::optic::OpticKind) -> &'static str {
    use panproto_lens::optic::OpticKind;
    match kind {
        OpticKind::Iso => "iso",
        OpticKind::Lens => "lens",
        OpticKind::Prism => "prism",
        OpticKind::Affine => "affine",
        OpticKind::Traversal => "traversal",
    }
}

/// Trigger evaluation of a single component (Max/MSP "bang").
///
/// Runs a full forward evaluation of the circuit, caches the result the
/// same way `evaluate_circuit` does, and returns the JSON-rendered wire
/// data *at this component's output* so the caller can flash a tooltip
/// without dispatching a second round-trip over the bridge.
///
/// Errors if the component id is unknown, no source schema has been
/// assigned, or no input data has been set.
#[wasm_bindgen]
pub fn bang_component(handle: u32, component_id: &str) -> Result<String, JsError> {
    bang_component_inner(handle, component_id).map_err(Into::into)
}

fn bang_component_inner(handle: u32, component_id: &str) -> Result<String, WasmError> {
    use protolab_eval::wire_data_for_circuit;

    let (circuit, source_h, input) = slab::with_resource(handle, |r| match r {
        Resource::Circuit(state) => Ok((
            state.schema.clone(),
            state.source_schema_h,
            state.input_instance.clone(),
        )),
        _ => Err(WasmError::TypeMismatch {
            expected: "Circuit",
            got: "other",
        }),
    })??;

    // Validate the component exists.
    let comp_name = panproto_gat::Name::from(component_id);
    if !circuit.vertices.contains_key(&comp_name) {
        return Err(WasmError::DeserializationFailed(format!(
            "bang_component: unknown component `{component_id}`"
        )));
    }

    let source_h = source_h.ok_or(WasmError::DeserializationFailed(
        "bang_component: no source schema assigned".into(),
    ))?;
    let input = input.ok_or(WasmError::DeserializationFailed(
        "bang_component: no input data set — call set_input_data first".into(),
    ))?;

    let source_schema = slab::get_schema(source_h)?;
    let source_protocol = panproto_protocols_default(&source_schema);

    let eval = wire_data_for_circuit(&circuit, &source_schema, &source_protocol, &input)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    // Pull *this component's* wire data (prefix lens result). If it's not
    // in the map (e.g., user banged a component with no prior eval state),
    // fall back to the final output.
    let (inst, schema) = eval
        .wire_data
        .get(component_id)
        .zip(eval.wire_schemas.get(component_id))
        .unwrap_or((&eval.output, &eval.output_schema));
    let json = panproto_inst::parse::to_json(schema, inst);
    let json_str = serde_json::to_string_pretty(&json).unwrap_or_default();

    // Also refresh the eval cache so a subsequent `put` call sees fresh
    // complement data.
    let wire_data_json: std::collections::HashMap<String, String> = eval
        .wire_data
        .iter()
        .map(|(wid, winst)| {
            let sch = eval.wire_schemas.get(wid).unwrap_or(&source_schema);
            let json = panproto_inst::parse::to_json(sch, winst);
            (
                wid.clone(),
                serde_json::to_string_pretty(&json).unwrap_or_default(),
            )
        })
        .collect();
    let output_json = serde_json::to_string_pretty(&panproto_inst::parse::to_json(
        &eval.output_schema,
        &eval.output,
    ))
    .unwrap_or_default();
    slab::with_resource_mut(handle, |r| {
        if let Resource::Circuit(state) = r {
            state.last_eval = Some(slab::EvalCache {
                final_lens: eval.final_lens,
                final_complement: eval.complement,
                final_view: eval.final_view,
                wire_data_json,
                output_json,
            });
        }
    })?;

    Ok(json_str)
}

/// Create the demo circuit and return its graph data as MessagePack.
///
/// Builds: RenameField("name"→"displayName") → AddField("bio") → DropField("legacyId")
/// with hot data ports and cold parameter ports on each component.
#[wasm_bindgen]
pub fn create_demo_circuit() -> Result<Vec<u8>, JsError> {
    create_demo_circuit_inner().map_err(Into::into)
}

fn create_demo_circuit_inner() -> Result<Vec<u8>, WasmError> {
    let schema = builder::demo_circuit();
    let graph = schema_to_graph(&schema);
    rmp_serde::to_vec_named(&graph).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

// ── Mutation API ────────────────────────────────────────────────────

/// Add a component to a circuit. Returns updated CircuitGraph msgpack.
#[wasm_bindgen]
pub fn add_component_to_circuit(handle: u32, spec_bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    add_component_to_circuit_inner(handle, spec_bytes).map_err(Into::into)
}

fn add_component_to_circuit_inner(handle: u32, spec_bytes: &[u8]) -> Result<Vec<u8>, WasmError> {
    let spec: ComponentSpec = rmp_serde::from_slice(spec_bytes)
        .or_else(|_| serde_json::from_slice(spec_bytes))
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    let ports: Vec<mutate::PortSpec> = spec
        .ports
        .iter()
        .map(|p| mutate::PortSpec {
            id: p.id.clone(),
            direction: parse_direction(&p.direction),
            trigger: parse_trigger(&p.trigger),
        })
        .collect();

    slab::with_resource_mut(handle, |r| {
        if let Resource::Circuit(state) = r {
            let schema = &mut state.schema;
            mutate::add_component(schema, &spec.id, &spec.component_type, &ports).ok();
            for p in &spec.params {
                mutate::update_param(schema, &spec.id, &p.key, &p.value).ok();
            }
        }
    })?;

    get_circuit_graph_inner(handle)
}

/// Remove a component from a circuit. Returns updated CircuitGraph msgpack.
#[wasm_bindgen]
pub fn remove_component_from_circuit(handle: u32, component_id: &str) -> Result<Vec<u8>, JsError> {
    remove_component_from_circuit_inner(handle, component_id).map_err(Into::into)
}

fn remove_component_from_circuit_inner(
    handle: u32,
    component_id: &str,
) -> Result<Vec<u8>, WasmError> {
    slab::with_resource_mut(handle, |r| {
        if let Resource::Circuit(state) = r {
            mutate::remove_component(&mut state.schema, component_id).ok();
        }
    })?;
    get_circuit_graph_inner(handle)
}

/// Add a wire to a circuit. Returns updated CircuitGraph msgpack.
#[wasm_bindgen]
pub fn add_wire_to_circuit(handle: u32, spec_bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    add_wire_to_circuit_inner(handle, spec_bytes).map_err(Into::into)
}

fn add_wire_to_circuit_inner(handle: u32, spec_bytes: &[u8]) -> Result<Vec<u8>, WasmError> {
    let spec: WireSpec = rmp_serde::from_slice(spec_bytes)
        .or_else(|_| serde_json::from_slice(spec_bytes))
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    slab::with_resource_mut(handle, |r| {
        if let Resource::Circuit(state) = r {
            mutate::add_wire(
                &mut state.schema,
                &spec.wire_id,
                &spec.src_port,
                &spec.tgt_port,
                spec.optic_kind.as_deref(),
                spec.is_feedback,
            )
            .ok();
        }
    })?;
    get_circuit_graph_inner(handle)
}

/// Remove a wire from a circuit. Returns updated CircuitGraph msgpack.
#[wasm_bindgen]
pub fn remove_wire_from_circuit(handle: u32, wire_id: &str) -> Result<Vec<u8>, JsError> {
    remove_wire_from_circuit_inner(handle, wire_id).map_err(Into::into)
}

fn remove_wire_from_circuit_inner(handle: u32, wire_id: &str) -> Result<Vec<u8>, WasmError> {
    slab::with_resource_mut(handle, |r| {
        if let Resource::Circuit(state) = r {
            mutate::remove_wire(&mut state.schema, wire_id).ok();
        }
    })?;
    get_circuit_graph_inner(handle)
}

/// Update a parameter on a component. Returns updated CircuitGraph msgpack.
#[wasm_bindgen]
pub fn update_component_param(
    handle: u32,
    component_id: &str,
    key: &str,
    value: &str,
) -> Result<Vec<u8>, JsError> {
    update_component_param_inner(handle, component_id, key, value).map_err(Into::into)
}

fn update_component_param_inner(
    handle: u32,
    component_id: &str,
    key: &str,
    value: &str,
) -> Result<Vec<u8>, WasmError> {
    slab::with_resource_mut(handle, |r| {
        if let Resource::Circuit(state) = r {
            mutate::update_param(&mut state.schema, component_id, key, value).ok();
        }
    })?;
    get_circuit_graph_inner(handle)
}

// ── Export API ──────────────────────────────────────────────────────

/// Export circuit as raw schema JSON.
#[wasm_bindgen]
pub fn export_circuit_as_json(handle: u32) -> Result<String, JsError> {
    export_circuit_as_json_inner(handle).map_err(Into::into)
}

fn export_circuit_as_json_inner(handle: u32) -> Result<String, WasmError> {
    let circuit = slab::get_circuit(handle)?;
    convert::export_as_json(&circuit).map_err(WasmError::Circuit)
}

/// Export circuit as LensDocument JSON.
#[wasm_bindgen]
pub fn export_circuit_as_lens_json(handle: u32) -> Result<String, JsError> {
    export_circuit_as_lens_json_inner(handle).map_err(Into::into)
}

fn export_circuit_as_lens_json_inner(handle: u32) -> Result<String, WasmError> {
    let circuit = slab::get_circuit(handle)?;
    convert::export_as_lens_json(&circuit).map_err(WasmError::Circuit)
}

/// Export circuit as LensDocument YAML.
#[wasm_bindgen]
pub fn export_circuit_as_yaml(handle: u32) -> Result<String, JsError> {
    export_circuit_as_yaml_inner(handle).map_err(Into::into)
}

fn export_circuit_as_yaml_inner(handle: u32) -> Result<String, WasmError> {
    let circuit = slab::get_circuit(handle)?;
    convert::export_as_lens_yaml(&circuit).map_err(WasmError::Circuit)
}

/// Export circuit as LensDocument Nickel syntax.
#[wasm_bindgen]
pub fn export_circuit_as_nickel(handle: u32) -> Result<String, JsError> {
    export_circuit_as_nickel_inner(handle).map_err(Into::into)
}

fn export_circuit_as_nickel_inner(handle: u32) -> Result<String, WasmError> {
    let circuit = slab::get_circuit(handle)?;
    convert::export_as_nickel(&circuit).map_err(WasmError::Circuit)
}

// ── Import API ─────────────────────────────────────────────────────

/// Import a LensDocument from JSON and build a circuit. Returns handle.
#[wasm_bindgen]
pub fn import_lens_document(json_source: &str) -> Result<Vec<u8>, JsError> {
    import_lens_document_inner(json_source).map_err(Into::into)
}

/// Handle plus anything the canvas could not carry across.
#[derive(Serialize)]
struct LensImportResult {
    handle: u32,
    /// Parts of the document the circuit has no representation for. These
    /// are dropped, so exporting the circuit will not reproduce them.
    dropped: Vec<String>,
}

fn import_lens_document_inner(json_source: &str) -> Result<Vec<u8>, WasmError> {
    // Inspect the modifiers before the conversion discards them.
    let dropped = convert::unrepresentable_parts_json(json_source);

    let schema = convert::import_lens_json(json_source).map_err(WasmError::Circuit)?;
    let handle = slab::alloc(Resource::Circuit(CircuitState::new(schema)));

    rmp_serde::to_vec_named(&LensImportResult { handle, dropped })
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Import a panproto schema from JSON. Returns handle + summary msgpack.
#[wasm_bindgen]
pub fn import_schema_json(json_source: &str) -> Result<Vec<u8>, JsError> {
    import_schema_json_inner(json_source).map_err(Into::into)
}

/// Export a previously imported `Schema` back to its JSON
/// representation. Inverse of `import_schema_json` via serde. Useful
/// for tooling that wants to retag a schema under a different
/// protocol or round-trip it through the DSL.
#[wasm_bindgen]
pub fn export_schema_json(schema_handle: u32) -> Result<String, JsError> {
    export_schema_json_inner(schema_handle).map_err(Into::into)
}

fn export_schema_json_inner(schema_handle: u32) -> Result<String, WasmError> {
    let schema = slab::get_schema(schema_handle)?;
    serde_json::to_string(&schema).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// The MessagePack payload for a `dev.panproto.schema.schema` record.
///
/// The full schema, so a consumer can decode the blob straight back into a
/// `Schema`. This is deliberately *not* panproto's canonical encoding —
/// that form drops derived fields and exists only to be hashed. The
/// canonical id travels separately, in [`schema_object_hash`].
#[wasm_bindgen]
pub fn schema_msgpack(schema_handle: u32) -> Result<Vec<u8>, JsError> {
    schema_msgpack_inner(schema_handle).map_err(Into::into)
}

fn schema_msgpack_inner(schema_handle: u32) -> Result<Vec<u8>, WasmError> {
    let schema = slab::get_schema(schema_handle)?;
    rmp_serde::to_vec(&schema).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// panproto's content-addressed object id for a schema, as 64 hex chars.
///
/// `panproto_vcs::hash::hash_schema` — blake3 over the canonical
/// MessagePack form. Publishing panproto's own object id, rather than a
/// digest of whichever bytes we happened to upload, is what lets a record
/// line up with the same schema held in a panproto VCS repo or registry:
/// two peers that serialize differently still agree on the id. A consumer
/// verifies by decoding the blob and re-running `hash_schema`.
#[wasm_bindgen]
pub fn schema_object_hash(schema_handle: u32) -> Result<String, JsError> {
    schema_object_hash_inner(schema_handle).map_err(Into::into)
}

fn schema_object_hash_inner(schema_handle: u32) -> Result<String, WasmError> {
    let schema = slab::get_schema(schema_handle)?;
    panproto_vcs::hash::hash_schema(&schema)
        .map(|id| id.to_string())
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// What two schemas share, measured rather than guessed.
///
/// The candidate search answers "is there a lens worth installing", and
/// when it says no the canvas had nothing further to offer: it asserted
/// that the field names "don't overlap enough for the solver to guess",
/// which is a claim about the schemas that nothing had established. The
/// span search answers a different and always-answerable question — what
/// is the largest part of the source that *does* map — and never refuses:
/// two schemas with nothing in common come back as an empty apex rather
/// than as a failure.
///
/// Reported per pair rather than as a score. `SchemaSpan::quality` is
/// documented as a ranking signal among spans over one source schema with
/// no absolute reading, so showing it as a number a user could compare
/// across schema pairs would be inventing a meaning it does not have.
/// `apex_coverage` is `|apex.vertices| / |src.vertices|`, which does mean
/// what it looks like.
#[wasm_bindgen]
pub fn schema_span(source_handle: u32, target_handle: u32) -> Result<Vec<u8>, JsError> {
    schema_span_inner(source_handle, target_handle).map_err(Into::into)
}

#[derive(Serialize)]
struct SpanPair {
    src: String,
    tgt: String,
}

#[derive(Serialize)]
struct SpanReport {
    /// Vertices of the source the search could place, paired with where.
    pairs: Vec<SpanPair>,
    /// `|apex| / |source|`, in `[0, 1]`.
    apex_coverage: f64,
    apex_vertex_count: usize,
    source_vertex_count: usize,
    /// Whether the apex covers the whole source — the degenerate case
    /// where the span is a total morphism.
    is_total: bool,
    /// Whether the search proved this the optimum rather than running out
    /// of budget. An unproven answer is a lower bound, not a verdict.
    proven_optimal: bool,
}

fn schema_span_inner(source_handle: u32, target_handle: u32) -> Result<Vec<u8>, WasmError> {
    let source = slab::get_schema(source_handle)?;
    let target = slab::get_schema(target_handle)?;
    let protocol = panproto_protocols_default(&source);

    let span = panproto_mig::hom_search::find_span(
        &source,
        &target,
        &protocol,
        &panproto_mig::SearchOptions::default(),
    )
    .map_err(|e| WasmError::DeserializationFailed(format!("span search: {e}")))?;

    // The left leg is an inclusion — apex vertex ids *are* source vertex
    // ids — so the apex's own vertices are the source side of each pair and
    // the right leg says where each one went.
    let mut pairs: Vec<SpanPair> = span
        .apex
        .vertices
        .keys()
        .filter_map(|v| {
            span.right.vertex_map.get(v).map(|tgt| SpanPair {
                src: v.to_string(),
                tgt: tgt.to_string(),
            })
        })
        .collect();
    // `vertices` is a HashMap, so without this the list reorders between
    // runs and the panel it feeds reshuffles on every search.
    pairs.sort_by(|a, b| a.src.cmp(&b.src).then_with(|| a.tgt.cmp(&b.tgt)));

    let report = SpanReport {
        apex_vertex_count: span.apex.vertices.len(),
        source_vertex_count: source.vertices.len(),
        apex_coverage: span.apex_coverage,
        is_total: span.is_total(),
        proven_optimal: span.certificate.proven_optimal,
        pairs,
    };
    rmp_serde::to_vec_named(&report).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// MessagePack payload for a `dev.panproto.schema.lens` record: the
/// circuit's `LensDocument`, the same structure `export_lens_json` emits.
#[wasm_bindgen]
pub fn lens_msgpack(handle: u32, source: &str, target: &str) -> Result<Vec<u8>, JsError> {
    lens_msgpack_inner(handle, source, target).map_err(Into::into)
}

fn lens_msgpack_inner(handle: u32, source: &str, target: &str) -> Result<Vec<u8>, WasmError> {
    let circuit = slab::with_resource(handle, |r| match r {
        Resource::Circuit(state) => Ok(state.schema.clone()),
        _ => Err(WasmError::TypeMismatch {
            expected: "Circuit",
            got: "other",
        }),
    })??;
    let doc = convert::circuit_to_lens_document(&circuit, "lens", source, target)
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))?;
    rmp_serde::to_vec(&doc).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// blake3 object id (64 hex chars) of a byte string, in panproto's hex form.
///
/// A lens record's `objectHash` is this over the record's own blob. Unlike
/// a schema, a `LensDocument` has no canonical form in `panproto-vcs`
/// (`hash_migration` addresses a *compiled* migration between two schema
/// ids, which is a different object), so the lens is addressed by the bytes
/// it actually ships. That keeps the record self-verifying: hash the blob
/// you downloaded and compare.
#[wasm_bindgen]
pub fn blake3_hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

fn import_schema_json_inner(json_source: &str) -> Result<Vec<u8>, WasmError> {
    let schema: panproto_schema::Schema = serde_json::from_str(json_source)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    let summary = SchemaSummary {
        protocol: schema.protocol.clone(),
        vertex_count: schema.vertices.len(),
        edge_count: schema.edges.len(),
    };

    let handle = slab::alloc(Resource::Schema(schema));

    #[derive(Serialize)]
    struct ImportResult {
        handle: u32,
        summary: SchemaSummary,
    }

    let result = ImportResult { handle, summary };
    rmp_serde::to_vec_named(&result).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Parse an atproto lexicon JSON string into a `Schema` and register it
/// in the slab as an importable schema.
///
/// This wraps `panproto_protocols::web_document::atproto::parse_lexicon`,
/// which converts a raw lexicon document (e.g. as served from
/// lexicon.garden) into protolab's schema representation. Returns the
/// same `{handle, summary}` shape as `import_schema_json` so the
/// frontend can reuse its import-result wiring.
#[wasm_bindgen]
pub fn parse_atproto_lexicon(json_source: &str) -> Result<Vec<u8>, JsError> {
    parse_atproto_lexicon_inner(json_source).map_err(Into::into)
}

fn parse_atproto_lexicon_inner(json_source: &str) -> Result<Vec<u8>, WasmError> {
    use panproto_protocols::web_document::atproto;

    let value: serde_json::Value = serde_json::from_str(json_source)
        .map_err(|e| WasmError::DeserializationFailed(format!("lexicon JSON parse: {e}")))?;
    let schema = atproto::parse_lexicon(&value)
        .map_err(|e| WasmError::DeserializationFailed(format!("lexicon: {e}")))?;

    let summary = SchemaSummary {
        protocol: schema.protocol.clone(),
        vertex_count: schema.vertices.len(),
        edge_count: schema.edges.len(),
    };
    let handle = slab::alloc(Resource::Schema(schema));

    #[derive(Serialize)]
    struct ImportResult {
        handle: u32,
        summary: SchemaSummary,
    }
    rmp_serde::to_vec_named(&ImportResult { handle, summary })
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Parse a schema in any supported protocol's native format.
///
/// Takes a protocol name (e.g. "openapi", "mongodb", "avro", "atproto")
/// and the raw input (JSON string for most protocols; plain text for
/// DSL-based protocols like CDDL, ASN.1, FlatBuffers). Dispatches to
/// the protocol's parser in `panproto-protocols` and returns the same
/// `{handle, summary}` shape as `import_schema_json`.
#[wasm_bindgen]
pub fn parse_native_schema(protocol_name: &str, input: &str) -> Result<Vec<u8>, JsError> {
    parse_native_schema_inner(protocol_name, input).map_err(Into::into)
}

fn parse_native_schema_inner(protocol_name: &str, input: &str) -> Result<Vec<u8>, WasmError> {
    use panproto_protocols as pp;

    let key = protocol_name.to_ascii_lowercase();

    // Text-based parsers (input is raw DSL text, not JSON).
    let schema = match key.as_str() {
        "cddl" => pp::data_schema::cddl::parse_cddl(input)
            .map_err(|e| WasmError::DeserializationFailed(format!("{key}: {e}")))?,
        "asn1" | "asn.1" => pp::serialization::asn1::parse_asn1(input)
            .map_err(|e| WasmError::DeserializationFailed(format!("{key}: {e}")))?,
        "bond" => pp::serialization::bond::parse_bond(input)
            .map_err(|e| WasmError::DeserializationFailed(format!("{key}: {e}")))?,
        "flatbuffers" | "fbs" => pp::serialization::flatbuffers::parse_fbs(input)
            .map_err(|e| WasmError::DeserializationFailed(format!("{key}: {e}")))?,
        "conllu" => pp::annotation::conllu::parse_conllu(input)
            .map_err(|e| WasmError::DeserializationFailed(format!("{key}: {e}")))?,
        "cassandra" | "cql" => pp::database::cassandra::parse_cql(input)
            .map_err(|e| WasmError::DeserializationFailed(format!("{key}: {e}")))?,
        "neo4j" | "cypher" => pp::database::neo4j::parse_cypher_schema(input)
            .map_err(|e| WasmError::DeserializationFailed(format!("{key}: {e}")))?,
        "redis" => pp::database::redis::parse_redis_schema(input)
            .map_err(|e| WasmError::DeserializationFailed(format!("{key}: {e}")))?,
        _ => {
            // JSON-based parsers: parse input as serde_json::Value first.
            let value: serde_json::Value = serde_json::from_str(input)
                .map_err(|e| WasmError::DeserializationFailed(format!("{key} JSON: {e}")))?;
            parse_json_protocol(&key, &value)?
        }
    };

    let summary = SchemaSummary {
        protocol: schema.protocol.clone(),
        vertex_count: schema.vertices.len(),
        edge_count: schema.edges.len(),
    };
    let handle = slab::alloc(Resource::Schema(schema));

    #[derive(Serialize)]
    struct ImportResult {
        handle: u32,
        summary: SchemaSummary,
    }
    rmp_serde::to_vec_named(&ImportResult { handle, summary })
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Dispatch JSON input to the appropriate protocol parser.
fn parse_json_protocol(
    key: &str,
    value: &serde_json::Value,
) -> Result<panproto_schema::Schema, WasmError> {
    use panproto_protocols as pp;
    let err = |e: panproto_protocols::ProtocolError| {
        WasmError::DeserializationFailed(format!("{key}: {e}"))
    };
    match key {
        // ATProto
        "atproto" => pp::web_document::atproto::parse_lexicon(value).map_err(err),
        // API
        "openapi" | "swagger" => pp::api::openapi::parse_openapi(value).map_err(err),
        "asyncapi" => pp::api::asyncapi::parse_asyncapi(value).map_err(err),
        "raml" => pp::api::raml::parse_raml_schema(value).map_err(err),
        "jsonapi" | "json:api" => pp::api::jsonapi::parse_jsonapi(value).map_err(err),
        // Serialization
        "avro" => pp::serialization::avro::parse_avsc(value).map_err(err),
        "msgpack" | "msgpack-schema" => {
            pp::serialization::msgpack_schema::parse_msgpack_schema(value).map_err(err)
        }
        // Data Schema
        "bson" => pp::data_schema::bson::parse_bson_schema(value).map_err(err),
        // Database
        "mongodb" | "mongo" => pp::database::mongodb::parse_mongodb_schema(value).map_err(err),
        "dynamodb" | "dynamo" => pp::database::dynamodb::parse_dynamodb(value).map_err(err),
        // Web/Document
        "docx" => pp::web_document::docx::parse_docx_schema(value).map_err(err),
        "odf" => pp::web_document::odf::parse_odf_schema(value).map_err(err),
        // Data Science
        "parquet" => pp::data_science::parquet::parse_parquet_schema(value).map_err(err),
        "arrow" => pp::data_science::arrow::parse_arrow_schema(value).map_err(err),
        "dataframe" => pp::data_science::dataframe::parse_dataframe_schema(value).map_err(err),
        // Domain
        "geojson" => pp::domain::geojson::parse_geojson_schema(value).map_err(err),
        "fhir" => pp::domain::fhir::parse_fhir_schema(value).map_err(err),
        "rss" | "atom" | "rss_atom" => {
            pp::domain::rss_atom::parse_rss_atom_schema(value).map_err(err)
        }
        "vcard" | "ical" | "vcard_ical" => {
            pp::domain::vcard_ical::parse_vcard_ical_schema(value).map_err(err)
        }
        "edi_x12" | "x12" => pp::domain::edi_x12::parse_edi_schema(value).map_err(err),
        "swift_mt" | "swift" => pp::domain::swift_mt::parse_swift_mt_schema(value).map_err(err),
        // Config
        "k8s" | "k8s_crd" | "kubernetes" => {
            pp::config::k8s_crd::parse_k8s_crd_schema(value).map_err(err)
        }
        "cloudformation" => pp::config::cloudformation::parse_cfn_schema(value).map_err(err),
        "ansible" => pp::config::ansible::parse_ansible_schema(value).map_err(err),
        // Annotation
        "fovea" => pp::annotation::fovea::parse_fovea(value).map_err(err),
        "tei" => pp::annotation::tei::parse_tei(value).map_err(err),
        "folia" => pp::annotation::folia::parse_folia(value).map_err(err),
        "amr" => pp::annotation::amr::parse_amr_schema(value).map_err(err),
        "web_annotation" => {
            pp::annotation::web_annotation::parse_web_annotation_schema(value).map_err(err)
        }
        "decomp" => pp::annotation::decomp::parse_decomp(value).map_err(err),
        "elan" => pp::annotation::elan::parse_elan(value).map_err(err),
        "laf_graf" => pp::annotation::laf_graf::parse_laf_graf(value).map_err(err),
        "nif" => pp::annotation::nif::parse_nif_schema(value).map_err(err),
        "timeml" => pp::annotation::timeml::parse_timeml(value).map_err(err),
        "ucca" => pp::annotation::ucca::parse_ucca(value).map_err(err),
        "iso_space" => pp::annotation::iso_space::parse_iso_space(value).map_err(err),
        "naf" => pp::annotation::naf::parse_naf(value).map_err(err),
        "brat" => pp::annotation::brat::parse_brat(value).map_err(err),
        "uima" => pp::annotation::uima::parse_uima_schema(value).map_err(err),
        "concrete" => pp::annotation::concrete::parse_concrete_schema(value).map_err(err),
        "bead" => pp::annotation::bead::parse_bead(value).map_err(err),
        "paula" => pp::annotation::paula::parse_paula_schema(value).map_err(err),
        other => Err(WasmError::DeserializationFailed(format!(
            "unsupported protocol: {other}"
        ))),
    }
}

/// Return metadata for all supported protocols (name, category,
/// input format, description). Used by the UI to populate the protocol
/// selector dropdown.
#[wasm_bindgen]
pub fn list_supported_protocols() -> Result<Vec<u8>, JsError> {
    /// Unified metadata shape: built-in entries are static; user-registered
    /// entries are owned strings. `std::borrow::Cow` keeps both without
    /// duplicating the static strings.
    #[derive(Serialize)]
    struct ProtocolMeta {
        name: std::borrow::Cow<'static, str>,
        category: std::borrow::Cow<'static, str>,
        input_format: std::borrow::Cow<'static, str>,
        description: std::borrow::Cow<'static, str>,
    }
    // Accept &'static str in the builtin table for ergonomics; wrap
    // into Cow at the call site.
    #[derive(Clone, Copy)]
    struct BuiltinMeta {
        name: &'static str,
        category: &'static str,
        input_format: &'static str,
        description: &'static str,
    }

    let builtins: Vec<BuiltinMeta> = vec![
        // Web/Document
        BuiltinMeta {
            name: "atproto",
            category: "Web/Document",
            input_format: "json",
            description: "AT Protocol lexicon schema",
        },
        BuiltinMeta {
            name: "docx",
            category: "Web/Document",
            input_format: "json",
            description: "OOXML document schema",
        },
        BuiltinMeta {
            name: "odf",
            category: "Web/Document",
            input_format: "json",
            description: "OpenDocument format schema",
        },
        // API
        BuiltinMeta {
            name: "openapi",
            category: "API",
            input_format: "json",
            description: "OpenAPI / Swagger specification",
        },
        BuiltinMeta {
            name: "asyncapi",
            category: "API",
            input_format: "json",
            description: "AsyncAPI specification",
        },
        BuiltinMeta {
            name: "raml",
            category: "API",
            input_format: "json",
            description: "RAML API specification",
        },
        BuiltinMeta {
            name: "jsonapi",
            category: "API",
            input_format: "json",
            description: "JSON:API resource schema",
        },
        // Serialization
        BuiltinMeta {
            name: "avro",
            category: "Serialization",
            input_format: "json",
            description: "Apache Avro schema (avsc)",
        },
        BuiltinMeta {
            name: "msgpack",
            category: "Serialization",
            input_format: "json",
            description: "MessagePack schema",
        },
        BuiltinMeta {
            name: "asn1",
            category: "Serialization",
            input_format: "text",
            description: "ASN.1 notation",
        },
        BuiltinMeta {
            name: "bond",
            category: "Serialization",
            input_format: "text",
            description: "Bond schema",
        },
        BuiltinMeta {
            name: "flatbuffers",
            category: "Serialization",
            input_format: "text",
            description: "FlatBuffers schema (.fbs)",
        },
        // Data Schema
        BuiltinMeta {
            name: "cddl",
            category: "Data Schema",
            input_format: "text",
            description: "CDDL schema",
        },
        BuiltinMeta {
            name: "bson",
            category: "Data Schema",
            input_format: "json",
            description: "BSON schema",
        },
        // Database
        BuiltinMeta {
            name: "mongodb",
            category: "Database",
            input_format: "json",
            description: "MongoDB $jsonSchema",
        },
        BuiltinMeta {
            name: "dynamodb",
            category: "Database",
            input_format: "json",
            description: "DynamoDB table schema",
        },
        BuiltinMeta {
            name: "cassandra",
            category: "Database",
            input_format: "text",
            description: "CQL schema (Cassandra)",
        },
        BuiltinMeta {
            name: "neo4j",
            category: "Database",
            input_format: "text",
            description: "Cypher schema (Neo4j)",
        },
        BuiltinMeta {
            name: "redis",
            category: "Database",
            input_format: "text",
            description: "Redis schema",
        },
        // Data Science
        BuiltinMeta {
            name: "parquet",
            category: "Data Science",
            input_format: "json",
            description: "Parquet schema",
        },
        BuiltinMeta {
            name: "arrow",
            category: "Data Science",
            input_format: "json",
            description: "Arrow schema",
        },
        BuiltinMeta {
            name: "dataframe",
            category: "Data Science",
            input_format: "json",
            description: "DataFrame schema",
        },
        // Domain
        BuiltinMeta {
            name: "geojson",
            category: "Domain",
            input_format: "json",
            description: "GeoJSON schema",
        },
        BuiltinMeta {
            name: "fhir",
            category: "Domain",
            input_format: "json",
            description: "FHIR resource schema",
        },
        BuiltinMeta {
            name: "rss_atom",
            category: "Domain",
            input_format: "json",
            description: "RSS / Atom feed schema",
        },
        BuiltinMeta {
            name: "vcard_ical",
            category: "Domain",
            input_format: "json",
            description: "vCard / iCal schema",
        },
        BuiltinMeta {
            name: "edi_x12",
            category: "Domain",
            input_format: "json",
            description: "EDI X12 schema",
        },
        BuiltinMeta {
            name: "swift_mt",
            category: "Domain",
            input_format: "json",
            description: "SWIFT MT schema",
        },
        // Config
        BuiltinMeta {
            name: "k8s_crd",
            category: "Config",
            input_format: "json",
            description: "Kubernetes CRD schema",
        },
        BuiltinMeta {
            name: "cloudformation",
            category: "Config",
            input_format: "json",
            description: "CloudFormation schema",
        },
        BuiltinMeta {
            name: "ansible",
            category: "Config",
            input_format: "json",
            description: "Ansible schema",
        },
    ];

    // Merge user-registered protocols so they're pickable from the
    // SchemaImportWidget. The registry is exposed via slab.
    let user_names = slab::list_user_protocol_names();

    let mut protocols: Vec<ProtocolMeta> = builtins
        .iter()
        .map(|b| ProtocolMeta {
            name: std::borrow::Cow::Borrowed(b.name),
            category: std::borrow::Cow::Borrowed(b.category),
            input_format: std::borrow::Cow::Borrowed(b.input_format),
            description: std::borrow::Cow::Borrowed(b.description),
        })
        .collect();
    for name in user_names {
        protocols.push(ProtocolMeta {
            name: std::borrow::Cow::Owned(name),
            category: std::borrow::Cow::Borrowed("User-defined"),
            input_format: std::borrow::Cow::Borrowed("json"),
            description: std::borrow::Cow::Borrowed(
                "User-registered protocol (paste a schema JSON matching its shape)",
            ),
        });
    }

    rmp_serde::to_vec_named(&protocols)
        .map_err(|e| JsError::new(&format!("serialize protocols: {e}")))
}

/// Auto-generate a lens between source and target schemas, store it in
/// the slab, AND install field-level circuit components derived from the
/// compiled migration so edit mode reflects the auto-generated lens.
///
/// Pipeline:
/// 1. `panproto_check::diff(src, tgt)` → `DiffSpec`
/// 2. `diff_to_protolens(spec, src, tgt)` → `ProtolensChain`
/// Evaluate an auto-generated lens: apply `asymmetric::get` directly.
/// Returns `{output_json, complement_handle}`.
#[wasm_bindgen]
pub fn evaluate_auto_lens(lens_handle: u32, input_json: &str) -> Result<Vec<u8>, JsError> {
    evaluate_auto_lens_inner(lens_handle, input_json).map_err(Into::into)
}

/// Backward eval: apply `asymmetric::put` to restore the source.
/// Returns `{restored_json}`.
#[wasm_bindgen]
pub fn put_auto_lens(
    lens_handle: u32,
    modified_json: &str,
    complement_handle: u32,
) -> Result<Vec<u8>, JsError> {
    put_auto_lens_inner(lens_handle, modified_json, complement_handle).map_err(Into::into)
}

/// Ranked candidate lens generation (v0.33.0). Returns the top N
/// candidates with quality, coverage, per-step explanations, and
/// strategy provenance. The caller picks a candidate to install.
///
/// `opts_json` deserialises as:
/// ```json
/// {
///   "stringency": "balanced",
///   "top_n": 5,
///   "anchors": { "src_vertex": "tgt_vertex" },
///   "excluded_sources": [...],
///   "excluded_targets": [...],
///   "quality_threshold": 0.0
/// }
/// ```
/// All fields optional; defaults: stringency=balanced, top_n=5.
#[wasm_bindgen]
pub fn auto_generate_candidates(
    source_handle: u32,
    target_handle: u32,
    opts_json: &str,
) -> Result<Vec<u8>, JsError> {
    auto_generate_candidates_inner(source_handle, target_handle, opts_json).map_err(Into::into)
}

/// Compute a bare schema mapping between source and target without
/// running the lens compiler. Used by the store's no-mapping-UX
/// path so `autoLensSchemaMapping` is populated with the raw diff
/// ({vertex_remap: same-name pairs, surviving: shared, added:
/// target-only, removed: source-only}) even when the CSP finds no
/// usable lens. Downstream widgets (SchemaMappingWidget,
/// HintEditor, TheoryDiffModal) read from this state whether or not
/// a lens materialized.
#[wasm_bindgen]
pub fn compute_schema_mapping(source_handle: u32, target_handle: u32) -> Result<Vec<u8>, JsError> {
    compute_schema_mapping_inner(source_handle, target_handle).map_err(Into::into)
}

/// Remove every existing `component`-kind vertex from the circuit.
/// Called by the store before each auto-lens regeneration so that if
/// the new search fails, the user doesn't see stale components from
/// a previous target assignment (or the demo initial circuit)
/// hanging around underneath the "no mapping" overlay. Returns the
/// post-clear graph.
#[wasm_bindgen]
pub fn clear_circuit_components(circuit_handle: u32) -> Result<Vec<u8>, JsError> {
    clear_circuit_components_inner(circuit_handle).map_err(Into::into)
}

/// Materialize a selected candidate's protolens chain as editable
/// circuit components on `circuit_handle`, and return the chain-step
/// descriptions + schema mapping + resulting circuit graph. This is
/// what the frontend calls after a candidate is selected, so the
/// canvas matches the lens behind it and existing downstream widgets
/// (LensChain, SchemaMapping, TheoryDiff) have their state.
///
/// Replaces the component-installing side effect of the old
/// `auto_generate_and_store` entry, decoupling that side effect from
/// the candidate-generation search.
#[wasm_bindgen]
pub fn install_candidate_components(
    circuit_handle: u32,
    lens_handle: u32,
    source_handle: u32,
    target_handle: u32,
) -> Result<Vec<u8>, JsError> {
    install_candidate_components_inner(circuit_handle, lens_handle, source_handle, target_handle)
        .map_err(Into::into)
}

/// Run the alignment strategies between `source_handle` and
/// `target_handle` WITHOUT the CSP/morphism search. Returns the raw
/// anchor candidates that the strategies discovered, with each
/// anchor's source vertex, target vertex, confidence score, and the
/// strategy tag that proposed it.
///
/// The motivating use case is the "no morphism found" UX path: when
/// [`auto_generate_candidates`] fails, the user deserves to see what
/// the aligners actually discovered — often two or three high-
/// confidence pairs like `tags ↔ tags` that they can lock as hints
/// to bootstrap a manual mapping. Fetching those pairs requires
/// running the strategies but not the CSP, which is what this
/// entry point does.
///
/// `opts_json` accepts `stringency` and the alias dict shape; all
/// other options (`top_n`, anchors, exclusions) are ignored — this
/// is a pure discovery call, no hints, no search.
///
/// Returns a msgpack-encoded `{ anchors: [{src, tgt, confidence,
/// strategy, explanation}, ...] }` object sorted by descending
/// confidence, then source vertex.
#[wasm_bindgen]
pub fn discover_anchors(
    source_handle: u32,
    target_handle: u32,
    opts_json: &str,
) -> Result<Vec<u8>, JsError> {
    discover_anchors_inner(source_handle, target_handle, opts_json).map_err(Into::into)
}

/// Set-wise schema equality: two schemas are treated as equal when
/// their protocol, vertex set, edge set, and per-vertex constraint
/// set match (independent of HashMap iteration order). `Schema`
/// doesn't derive `PartialEq`, so we compare field by field. Used
/// as the second leg of the identity short-circuit in
/// auto-generation: if the schemas are structurally identical there
/// is nothing for the morphism search to discover, and we can return
/// an identity lens immediately. Byte-equal (rmp_serde::to_vec)
/// would NOT work here — two independent parses of the same lexicon
/// produce semantically identical schemas whose msgpack bytes
/// diverge because HashMap iteration order differs across Rusts.
fn schemas_byte_equal(a: &panproto_schema::Schema, b: &panproto_schema::Schema) -> bool {
    if a.protocol != b.protocol {
        return false;
    }
    if a.vertices.len() != b.vertices.len() {
        return false;
    }
    // Vertices: compare as a key→value map. `Vertex` derives PartialEq.
    for (k, v) in &a.vertices {
        match b.vertices.get(k) {
            Some(bv) if bv == v => {}
            _ => return false,
        }
    }
    if a.edges.len() != b.edges.len() {
        return false;
    }
    for (e, kind) in &a.edges {
        match b.edges.get(e) {
            Some(bk) if bk == kind => {}
            _ => return false,
        }
    }
    // Constraints: compare as a vertex→sorted-vec map. Constraint is
    // Ord so sorting is total and stable.
    if a.constraints.len() != b.constraints.len() {
        return false;
    }
    for (k, cs_a) in &a.constraints {
        let Some(cs_b) = b.constraints.get(k) else {
            return false;
        };
        let mut sa = cs_a.clone();
        let mut sb = cs_b.clone();
        sa.sort();
        sb.sort();
        if sa != sb {
            return false;
        }
    }
    true
}

fn auto_generate_candidates_inner(
    source_handle: u32,
    target_handle: u32,
    opts_json: &str,
) -> Result<Vec<u8>, WasmError> {
    use panproto_lens::Stringency;
    use panproto_lens::auto_lens::auto_generate_candidates;
    use panproto_lens::auto_lens::auto_generate_candidates_with_hints;
    use panproto_lens::hint::{HintParts, resolve_hints};

    let source = slab::get_schema(source_handle)?;
    let target = slab::get_schema(target_handle)?;
    let protocol = panproto_protocols_default(&source);

    #[derive(serde::Deserialize, Default)]
    struct Opts {
        #[serde(default)]
        stringency: Option<String>,
        #[serde(default = "default_top_n")]
        top_n: usize,
        #[serde(default)]
        anchors: std::collections::HashMap<String, String>,
        #[serde(default)]
        excluded_sources: Vec<String>,
        #[serde(default)]
        excluded_targets: Vec<String>,
        #[serde(default)]
        scope_pairs: Vec<(String, String)>,
    }
    fn default_top_n() -> usize {
        5
    }

    let opts: Opts = serde_json::from_str(opts_json)
        .map_err(|e| WasmError::DeserializationFailed(format!("opts: {e}")))?;

    let stringency = match opts.stringency.as_deref() {
        Some("strict") => Stringency::Strict,
        Some("balanced") | None => Stringency::Balanced,
        Some("lenient") => Stringency::Lenient,
        Some("exploratory") => Stringency::Exploratory,
        Some(other) => {
            return Err(WasmError::DeserializationFailed(format!(
                "unknown stringency: {other}"
            )));
        }
    };

    let config = panproto_lens::auto_lens::AutoLensConfig {
        stringency,
        try_overlap: true,
        ..Default::default()
    };
    // Identity short-circuit: build the identity chain via
    // `diff_to_protolens` (seeing an empty diff yields an identity
    // protolens). Applies whenever the two schemas are structurally
    // identical (same handle OR byte-equal) — the CSP can take a
    // real wall-clock minute on large schemas like
    // `app.bsky.feed.post` mapped to itself, so we skip it.
    // Using `diff_to_protolens` instead of `ProtolensChain::new(
    // vec![])` matters because the former's instantiate populates
    // `CompiledMigration.surviving_verts` with every source vertex,
    // so downstream `extract_schema_mapping` reports "0 removed,
    // all surviving" as the test suite demands.
    if source_handle == target_handle || schemas_byte_equal(&source, &target) {
        use panproto_lens::diff_to_protolens::{DiffSpec, diff_to_protolens};
        let schema_diff = panproto_check::diff(&source, &target);
        let diff_spec = DiffSpec {
            added_vertices: schema_diff.added_vertices.clone(),
            removed_vertices: schema_diff.removed_vertices.clone(),
            kind_changes: schema_diff
                .kind_changes
                .iter()
                .map(|kc| panproto_lens::diff_to_protolens::KindChange {
                    vertex_id: kc.vertex_id.clone(),
                    old_kind: kc.old_kind.clone(),
                    new_kind: kc.new_kind.clone(),
                })
                .collect(),
            added_edges: schema_diff.added_edges.clone(),
            removed_edges: schema_diff.removed_edges.clone(),
        };
        let chain = diff_to_protolens(&diff_spec, &source, &target)
            .map_err(|e| WasmError::DeserializationFailed(format!("identity diff: {e}")))?;
        let lens = chain
            .instantiate(&source, &protocol)
            .map_err(|e| WasmError::DeserializationFailed(format!("identity: {e}")))?;
        let candidate = panproto_lens::candidate::LensCandidate {
            chain,
            lens,
            quality: 1.0,
            coverage: 1.0,
            seed_anchors: vec![],
            steps: vec![],
            strategies_used: vec![],
        };

        let desc = candidate_to_desc(&candidate);
        let lens_handle = slab::alloc(Resource::AutoLens {
            lens: candidate.lens,
            chain: candidate.chain,
        });
        #[derive(Serialize)]
        struct CandidatesResponseFull {
            candidates: Vec<CandidateDescWithHandle>,
        }
        #[derive(Serialize)]
        struct CandidateDescWithHandle {
            #[serde(flatten)]
            desc: CandidateDesc,
            lens_handle: u32,
        }
        return rmp_serde::to_vec_named(&CandidatesResponseFull {
            candidates: vec![CandidateDescWithHandle { desc, lens_handle }],
        })
        .map_err(|e| WasmError::SerializationFailed(e.to_string()));
    }

    let has_hints = !opts.anchors.is_empty()
        || !opts.excluded_sources.is_empty()
        || !opts.excluded_targets.is_empty()
        || !opts.scope_pairs.is_empty();

    let mut candidates = if has_hints {
        let parts = HintParts {
            anchors: opts.anchors,
            scope_pairs: opts.scope_pairs,
            excluded_targets: opts.excluded_targets,
            excluded_sources: opts.excluded_sources,
            scoring_weights: None,
        };
        let (anchors, domain_constraints) = resolve_hints(&parts, &source, &target);
        auto_generate_candidates_with_hints(
            &source,
            &target,
            &protocol,
            &config,
            &anchors,
            &domain_constraints,
            opts.top_n,
        )
        .map_err(|e| WasmError::DeserializationFailed(format!("candidates_with_hints: {e}")))?
    } else {
        auto_generate_candidates(&source, &target, &protocol, &config, opts.top_n)
            .map_err(|e| WasmError::DeserializationFailed(format!("candidates: {e}")))?
    };

    // Discard degenerate "drop every source vertex, add every target
    // vertex" chains. These are legal schema morphisms (empty
    // intersection, fill both sides from nothing) but they're
    // useless as lenses — the user sees a hundred-step DropOp/AddOp
    // pile that can't transform any real data. The test is: did the
    // compiled lens actually map any source vertex forward? A
    // pathological drop-all/add-all has an empty `vertex_remap`,
    // whereas a sparse real lens (e.g., `app.bsky.feed.post →
    // app.bsky.feed.like` preserving just `createdAt`) has at least
    // one entry. This avoids the false-negatives a coverage-ratio
    // threshold produced against small shared subsets.
    candidates.retain(|c| {
        // Keep if ANY of the compiled migration's mapping tables
        // has content. Surviving verts covers the identity case
        // (empty chain against a record where nothing needed to
        // change); vertex_remap covers the renamed/preserved case.
        !c.lens.compiled.vertex_remap.is_empty() || !c.lens.compiled.surviving_verts.is_empty()
    });
    if candidates.is_empty() {
        return Err(WasmError::DeserializationFailed(
            "candidates: no morphism found between schemas (every candidate was a drop-only / add-only chain with nothing preserved or renamed)".into(),
        ));
    }

    let descs: Vec<CandidateDesc> = candidates.iter().map(candidate_to_desc).collect();

    // Store all candidate lenses in the slab so the frontend can
    // evaluate any of them by handle. Chain is carried alongside so
    // a later `install_candidate_components` call can materialize
    // the selected candidate as editable circuit components without
    // re-running the alignment search.
    let handles: Vec<u32> = candidates
        .into_iter()
        .map(|c| {
            slab::alloc(Resource::AutoLens {
                lens: c.lens,
                chain: c.chain,
            })
        })
        .collect();

    #[derive(Serialize)]
    struct CandidatesResponseFull {
        candidates: Vec<CandidateDescWithHandle>,
    }
    #[derive(Serialize)]
    struct CandidateDescWithHandle {
        #[serde(flatten)]
        desc: CandidateDesc,
        lens_handle: u32,
    }

    let full: Vec<CandidateDescWithHandle> = descs
        .into_iter()
        .zip(handles)
        .map(|(desc, lens_handle)| CandidateDescWithHandle { desc, lens_handle })
        .collect();

    rmp_serde::to_vec_named(&CandidatesResponseFull { candidates: full })
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

fn compute_schema_mapping_inner(
    source_handle: u32,
    target_handle: u32,
) -> Result<Vec<u8>, WasmError> {
    let source = slab::get_schema(source_handle)?;
    let target = slab::get_schema(target_handle)?;

    // Treat shared vertex ids as "surviving"; everything else as
    // added or removed. This is the pre-lens, pre-CSP shape — just
    // what's obvious from comparing the two schema graphs directly.
    let surviving: Vec<String> = source
        .vertices
        .keys()
        .filter(|v| target.vertices.contains_key(*v))
        .map(|v| v.to_string())
        .collect();
    let removed: Vec<String> = source
        .vertices
        .keys()
        .filter(|v| !target.vertices.contains_key(*v))
        .map(|v| v.to_string())
        .collect();
    let added: Vec<String> = target
        .vertices
        .keys()
        .filter(|v| !source.vertices.contains_key(*v))
        .map(|v| v.to_string())
        .collect();
    let vertex_remap: Vec<(String, String)> =
        surviving.iter().map(|v| (v.clone(), v.clone())).collect();

    let desc = SchemaMappingDesc {
        vertex_remap,
        added_vertices: added,
        removed_vertices: removed,
        surviving_vertices: surviving,
        field_transforms: vec![],
    };
    rmp_serde::to_vec_named(&desc).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

fn clear_circuit_components_inner(circuit_handle: u32) -> Result<Vec<u8>, WasmError> {
    slab::with_resource_mut(circuit_handle, |r| {
        if let Resource::Circuit(state) = r {
            let existing_ids: Vec<panproto_gat::Name> = state
                .schema
                .vertices
                .keys()
                .filter(|v| {
                    state
                        .schema
                        .vertices
                        .get(*v)
                        .is_some_and(|vertex| vertex.kind.as_ref() == "component")
                })
                .cloned()
                .collect();
            for id in existing_ids {
                mutate::remove_component(&mut state.schema, id.as_ref()).ok();
            }
            Ok(())
        } else {
            Err(WasmError::TypeMismatch {
                expected: "Circuit",
                got: "other",
            })
        }
    })??;
    get_circuit_graph_inner(circuit_handle)
}

fn install_candidate_components_inner(
    circuit_handle: u32,
    lens_handle: u32,
    source_handle: u32,
    target_handle: u32,
) -> Result<Vec<u8>, WasmError> {
    let source = slab::get_schema(source_handle)?;
    let target = slab::get_schema(target_handle)?;

    // The slab is a single-`RefCell` `Vec<Option<Resource>>`, so
    // nesting `with_resource(lens_handle, …)` around
    // `install_field_level_components` — which itself takes
    // `with_resource_mut(circuit_handle, …)` — panics on the inner
    // borrow. Instead: take the lens+chain out, install while the
    // slab is otherwise idle, then put them back.
    let taken = slab::take_resource(lens_handle)?;
    let (lens, chain) = match taken {
        Resource::AutoLens { lens, chain } => (lens, chain),
        other => {
            slab::put_resource(lens_handle, other)?;
            return Err(WasmError::TypeMismatch {
                expected: "AutoLens",
                got: "other",
            });
        }
    };

    // Helper: guarantee the lens gets put back into the slab even
    // if any step below bails. The `?` operator plus a taken
    // resource would leak the slot otherwise.
    let run = || -> Result<Vec<u8>, WasmError> {
        // No coverage gate here. A secondary metric computed at this
        // point (a surviving-vertex ratio from `extract_schema_mapping`)
        // would use different arithmetic than panproto's
        // `LensCandidate.coverage` and could reject a legitimate
        // candidate over rounding. The structural gate in
        // `auto_generate_candidates_inner` — did the compiled lens map
        // anything at all — is where a useless candidate is refused.
        // Defend at the generation site, not here.
        //
        // This used to cite a fixed 0.15 coverage floor upstream. There
        // is no such number in panproto 0.71: `auto_generate` now
        // compares the pinned and released searches on the objective
        // (quality first, coverage second) rather than gating either on
        // a threshold.
        let mapping = extract_schema_mapping(&lens, &source, &target);

        install_field_level_components(circuit_handle, &lens, &chain)?;

        let chain_steps: Vec<ChainStepDesc> = chain
            .steps
            .iter()
            .map(|step| ChainStepDesc {
                name: step.name.to_string(),
                source_transform: format!("{:?}", step.source.transform),
                target_transform: format!("{:?}", step.target.transform),
            })
            .collect();

        let graph = get_circuit_graph_inner(circuit_handle)?;

        #[derive(Serialize)]
        struct InstallResponse {
            chain_steps: Vec<ChainStepDesc>,
            schema_mapping: SchemaMappingDesc,
            graph: Vec<u8>,
        }
        rmp_serde::to_vec_named(&InstallResponse {
            chain_steps,
            schema_mapping: mapping,
            graph,
        })
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))
    };

    let result = run();
    // Restore the lens regardless of success so subsequent evaluate/
    // put calls via the same handle still work.
    slab::put_resource(lens_handle, Resource::AutoLens { lens, chain })?;
    result
}

fn discover_anchors_inner(
    source_handle: u32,
    target_handle: u32,
    opts_json: &str,
) -> Result<Vec<u8>, WasmError> {
    use panproto_lens::Stringency;
    use panproto_lens::auto_lens::run_strategies_for_tests;

    let source = slab::get_schema(source_handle)?;
    let target = slab::get_schema(target_handle)?;

    #[derive(serde::Deserialize, Default)]
    struct Opts {
        #[serde(default)]
        stringency: Option<String>,
    }
    let opts: Opts = serde_json::from_str(opts_json)
        .map_err(|e| WasmError::DeserializationFailed(format!("opts: {e}")))?;

    let stringency = match opts.stringency.as_deref() {
        Some("strict") => Stringency::Strict,
        Some("balanced") | None => Stringency::Balanced,
        Some("lenient") => Stringency::Lenient,
        Some("exploratory") => Stringency::Exploratory,
        Some(other) => {
            return Err(WasmError::DeserializationFailed(format!(
                "unknown stringency: {other}"
            )));
        }
    };

    let config = panproto_lens::auto_lens::AutoLensConfig {
        stringency,
        try_overlap: true,
        ..Default::default()
    };

    let (raw_anchors, _coerce_proposals) = run_strategies_for_tests(&source, &target, &config);

    // Collapse the raw pool to one pair per source, then emit the
    // survivors. The same resolution the search seeds on, so the displayed
    // set matches the one the morphism search actually tried.
    //
    // panproto 0.71 replaced the per-source argmax `align::resolve_anchors`
    // with aggregate-then-select: the whole pool reduces to one score per
    // (source, target) — a provenance ceiling, a priority band, a `max`
    // within each of six evidence families, then a fixed-arity mean — and
    // the choice is made off that table. `StrictPriority` + `Strict` +
    // `relative_only` is the combination the search itself uses; the
    // relative tolerance rather than an absolute floor is the decision
    // rule, because a mean over six families never clears the floor on the
    // strength of one family alone.
    use panproto_mig::align::evidence::{AggregationPolicy, Cardinality, RowFilter, aggregate};
    let resolved = aggregate(&raw_anchors, AggregationPolicy::StrictPriority)
        .select(Cardinality::Strict, RowFilter::relative_only())
        .to_map();

    #[derive(Serialize)]
    struct AnchorDesc {
        src: String,
        tgt: String,
        confidence: f64,
        strategy: String,
        explanation: String,
    }
    #[derive(Serialize)]
    struct DiscoverAnchorsResponse {
        anchors: Vec<AnchorDesc>,
    }

    // For each resolved pair, find the best-confidence raw anchor so
    // we can report the strategy that won. The raw pool may have
    // multiple proposals for the same pair; picking the max-confidence
    // one keeps the display stable.
    let mut descs: Vec<AnchorDesc> = resolved
        .into_iter()
        .map(|(src, tgt)| {
            let best = raw_anchors
                .iter()
                .filter(|a| a.src == src && a.tgt == tgt)
                .max_by(|a, b| a.confidence.total_cmp(&b.confidence));
            let (confidence, strategy, explanation) = best.map_or_else(
                || (1.0, String::from("unknown"), String::new()),
                |a| {
                    (
                        a.confidence,
                        format!("{:?}", a.strategy),
                        a.explanation.clone(),
                    )
                },
            );
            AnchorDesc {
                src: src.as_str().to_owned(),
                tgt: tgt.as_str().to_owned(),
                confidence,
                strategy,
                explanation,
            }
        })
        .collect();

    descs.sort_by(|a, b| {
        b.confidence
            .total_cmp(&a.confidence)
            .then_with(|| a.src.cmp(&b.src))
            .then_with(|| a.tgt.cmp(&b.tgt))
    });

    rmp_serde::to_vec_named(&DiscoverAnchorsResponse { anchors: descs })
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

#[derive(Serialize)]
struct CandidateDesc {
    quality: f64,
    coverage: f64,
    strategies_used: Vec<String>,
    steps: Vec<CandidateStepDesc>,
}

#[derive(Serialize)]
struct CandidateStepDesc {
    kind: String,
    explanation: String,
    confidence: f64,
    strategy: Option<String>,
}

/// Convert a `serde_json::Value` to a `panproto_inst::value::Value`.
/// Used when merging user JSON edits into a stored view instance.
fn json_to_inst_value(val: &serde_json::Value) -> panproto_inst::value::Value {
    use panproto_inst::value::Value;
    match val {
        serde_json::Value::Null => Value::Str(String::new()),
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Int(i)
            } else if let Some(f) = n.as_f64() {
                Value::Float(f)
            } else {
                Value::Str(n.to_string())
            }
        }
        serde_json::Value::String(s) => Value::Str(s.clone()),
        serde_json::Value::Array(arr) => Value::List(arr.iter().map(json_to_inst_value).collect()),
        serde_json::Value::Object(map) => Value::Unknown(
            map.iter()
                .map(|(k, v)| (k.clone(), json_to_inst_value(v)))
                .collect(),
        ),
    }
}

fn candidate_to_desc(c: &panproto_lens::candidate::LensCandidate) -> CandidateDesc {
    CandidateDesc {
        quality: c.quality,
        coverage: c.coverage,
        strategies_used: c.strategies_used.iter().map(|s| format!("{s:?}")).collect(),
        steps: c
            .steps
            .iter()
            .map(|s| CandidateStepDesc {
                kind: s.kind.clone(),
                explanation: s.explanation.clone(),
                confidence: s.confidence,
                strategy: s.strategy.as_ref().map(|t| format!("{t:?}")),
            })
            .collect(),
    }
}

fn evaluate_auto_lens_inner(lens_handle: u32, input_json: &str) -> Result<Vec<u8>, WasmError> {
    let value: serde_json::Value = serde_json::from_str(input_json)
        .map_err(|e| WasmError::DeserializationFailed(format!("input JSON: {e}")))?;

    // All lens operations must happen inside with_resource since Lens
    // doesn't implement Clone.
    let (output_json, complement) = slab::with_resource(lens_handle, |r| match r {
        Resource::AutoLens { lens, .. } => {
            let root = protolab_eval::protolens_for_component::find_root_vertex(&lens.src_schema)
                .map(|n| n.to_string())
                .unwrap_or_else(|| "root".into());

            let instance = panproto_inst::parse::parse_json(&lens.src_schema, &root, &value)
                .map_err(|e| WasmError::DeserializationFailed(format!("parse instance: {e}")))?;

            let (view, complement) = panproto_lens::asymmetric::get(lens, &instance)
                .map_err(|e| WasmError::DeserializationFailed(format!("lens get: {e}")))?;

            let output_value = panproto_inst::parse::to_json(&lens.tgt_schema, &view);
            let output_json = serde_json::to_string_pretty(&output_value)
                .map_err(|e| WasmError::SerializationFailed(e.to_string()))?;

            Ok((output_json, complement))
        }
        _ => Err(WasmError::TypeMismatch {
            expected: "AutoLens",
            got: "other",
        }),
    })??;

    let complement_handle = slab::alloc(Resource::LensComplement(complement));

    #[derive(Serialize)]
    struct EvalResult {
        output_json: String,
        complement_handle: u32,
    }

    rmp_serde::to_vec_named(&EvalResult {
        output_json,
        complement_handle,
    })
    .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

fn put_auto_lens_inner(
    lens_handle: u32,
    modified_json: &str,
    complement_handle: u32,
) -> Result<Vec<u8>, WasmError> {
    let value: serde_json::Value = serde_json::from_str(modified_json)
        .map_err(|e| WasmError::DeserializationFailed(format!("modified JSON: {e}")))?;

    // Extract the complement first (it implements Clone).
    let complement = slab::with_resource(complement_handle, |r| match r {
        Resource::LensComplement(c) => Ok(c.clone()),
        _ => Err(WasmError::TypeMismatch {
            expected: "LensComplement",
            got: "other",
        }),
    })??;

    // Do the put inside with_resource since Lens doesn't implement Clone.
    let restored_json = slab::with_resource(lens_handle, |r| match r {
        Resource::AutoLens { lens, .. } => {
            let root = protolab_eval::protolens_for_component::find_root_vertex(&lens.tgt_schema)
                .map(|n| n.to_string())
                .unwrap_or_else(|| "root".into());

            let modified_view =
                panproto_inst::parse::parse_json(&lens.tgt_schema, &root, &value)
                    .map_err(|e| WasmError::DeserializationFailed(format!("parse view: {e}")))?;

            let restored = panproto_lens::asymmetric::put(lens, &modified_view, &complement)
                .map_err(|e| WasmError::DeserializationFailed(format!("lens put: {e}")))?;

            let restored_value = panproto_inst::parse::to_json(&lens.src_schema, &restored);
            serde_json::to_string_pretty(&restored_value)
                .map_err(|e| WasmError::SerializationFailed(e.to_string()))
        }
        _ => Err(WasmError::TypeMismatch {
            expected: "AutoLens",
            got: "other",
        }),
    })??;

    #[derive(Serialize)]
    struct PutResult {
        restored_json: String,
    }

    rmp_serde::to_vec_named(&PutResult { restored_json })
        .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Return a structured view of a schema's vertices, edges, and
/// constraints suitable for rendering in a UI viewer / picker.
/// Vertices include id/kind/nsid; edges include src/tgt/kind/name;
/// constraints group per-vertex.
#[wasm_bindgen]
pub fn get_schema_details(schema_handle: u32) -> Result<Vec<u8>, JsError> {
    get_schema_details_inner(schema_handle).map_err(Into::into)
}

fn get_schema_details_inner(schema_handle: u32) -> Result<Vec<u8>, WasmError> {
    let schema = slab::get_schema(schema_handle)?;

    #[derive(Serialize)]
    struct VertexDetail {
        id: String,
        kind: String,
        nsid: Option<String>,
        constraints: Vec<ConstraintDetail>,
    }
    #[derive(Serialize)]
    struct ConstraintDetail {
        sort: String,
        value: String,
    }
    #[derive(Serialize)]
    struct EdgeDetail {
        src: String,
        tgt: String,
        kind: String,
        name: Option<String>,
    }
    #[derive(Serialize)]
    struct SchemaDetails {
        protocol: String,
        root: Option<String>,
        vertices: Vec<VertexDetail>,
        edges: Vec<EdgeDetail>,
    }

    let mut vertices: Vec<VertexDetail> = schema
        .vertices
        .values()
        .map(|v| {
            let id = v.id.to_string();
            let constraints = schema
                .constraints
                .get(&v.id)
                .map(|cs| {
                    cs.iter()
                        .map(|c| ConstraintDetail {
                            sort: c.sort.to_string(),
                            value: c.value.clone(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            VertexDetail {
                id,
                kind: v.kind.to_string(),
                nsid: v.nsid.as_ref().map(|n| n.to_string()),
                constraints,
            }
        })
        .collect();
    vertices.sort_by(|a, b| a.id.cmp(&b.id));

    let mut edges: Vec<EdgeDetail> = schema
        .edges
        .keys()
        .map(|e| EdgeDetail {
            src: e.src.to_string(),
            tgt: e.tgt.to_string(),
            kind: e.kind.to_string(),
            name: e.name.as_ref().map(|n| n.to_string()),
        })
        .collect();
    edges.sort_by(|a, b| (a.src.as_str(), a.tgt.as_str()).cmp(&(b.src.as_str(), b.tgt.as_str())));

    let root =
        protolab_eval::protolens_for_component::find_root_vertex(&schema).map(|n| n.to_string());

    rmp_serde::to_vec_named(&SchemaDetails {
        protocol: schema.protocol.clone(),
        root,
        vertices,
        edges,
    })
    .map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Validate a JSON data value against a schema (typically the target
/// schema for lens output). Returns a msgpack `{valid: bool, errors:
/// [string]}` payload. Errors are rendered via their `Display` impl so
/// the caller can surface them as human-readable messages in the UI.
#[wasm_bindgen]
pub fn validate_data_against_schema(
    schema_handle: u32,
    data_json: &str,
) -> Result<Vec<u8>, JsError> {
    validate_data_against_schema_inner(schema_handle, data_json).map_err(Into::into)
}

fn validate_data_against_schema_inner(
    schema_handle: u32,
    data_json: &str,
) -> Result<Vec<u8>, WasmError> {
    #[derive(Serialize)]
    struct ValidationResult {
        valid: bool,
        errors: Vec<String>,
    }

    let schema = slab::get_schema(schema_handle)?;

    let value: serde_json::Value = match serde_json::from_str(data_json) {
        Ok(v) => v,
        Err(e) => {
            let result = ValidationResult {
                valid: false,
                errors: vec![format!("invalid JSON: {e}")],
            };
            return rmp_serde::to_vec_named(&result)
                .map_err(|e| WasmError::SerializationFailed(e.to_string()));
        }
    };

    let root = protolab_eval::protolens_for_component::find_root_vertex(&schema)
        .map(|n| n.to_string())
        .unwrap_or_else(|| "root".into());

    let errors = match panproto_inst::parse::parse_json(&schema, &root, &value) {
        Ok(instance) => panproto_inst::validate::validate_wtype(&schema, &instance)
            .into_iter()
            .map(|e| e.to_string())
            .collect::<Vec<_>>(),
        Err(e) => vec![format!("parse: {e}")],
    };

    let result = ValidationResult {
        valid: errors.is_empty(),
        errors,
    };
    rmp_serde::to_vec_named(&result).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

// ── Auto-lens helpers ──────────────────────────────────────────────

#[derive(Serialize)]
struct ChainStepDesc {
    name: String,
    source_transform: String,
    target_transform: String,
}

#[derive(Serialize)]
struct SchemaMappingDesc {
    vertex_remap: Vec<(String, String)>,
    added_vertices: Vec<String>,
    removed_vertices: Vec<String>,
    surviving_vertices: Vec<String>,
    field_transforms: Vec<(String, Vec<String>)>,
}

/// Extract a human-readable schema mapping from the compiled migration.
fn extract_schema_mapping(
    lens: &panproto_lens::Lens,
    source: &panproto_schema::Schema,
    target: &panproto_schema::Schema,
) -> SchemaMappingDesc {
    let cm = &lens.compiled;

    let vertex_remap: Vec<(String, String)> = cm
        .vertex_remap
        .iter()
        .map(|(s, t)| (s.to_string(), t.to_string()))
        .collect();

    let surviving: Vec<String> = cm.surviving_verts.iter().map(|v| v.to_string()).collect();

    let removed: Vec<String> = source
        .vertices
        .keys()
        .filter(|v| !cm.surviving_verts.contains(*v))
        .map(|v| v.to_string())
        .collect();

    let remap_targets: std::collections::HashSet<&panproto_gat::Name> =
        cm.vertex_remap.values().collect();
    let added: Vec<String> = target
        .vertices
        .keys()
        .filter(|v| !remap_targets.contains(*v) && !cm.surviving_verts.contains(*v))
        .map(|v| v.to_string())
        .collect();

    let field_transforms: Vec<(String, Vec<String>)> = cm
        .field_transforms
        .iter()
        .map(|(vertex, transforms)| {
            let descs: Vec<String> = transforms
                .iter()
                .map(|ft| match ft {
                    panproto_inst::FieldTransform::RenameField { old_key, new_key } => {
                        format!("rename: {} → {}", old_key, new_key)
                    }
                    panproto_inst::FieldTransform::DropField { key } => {
                        format!("drop: {}", key)
                    }
                    panproto_inst::FieldTransform::AddField { key, value } => {
                        format!("add: {} = {:?}", key, value)
                    }
                    panproto_inst::FieldTransform::ApplyExpr { key, .. } => {
                        format!("apply_expr: {}", key)
                    }
                    panproto_inst::FieldTransform::ComputeField { target_key, .. } => {
                        format!("compute: {}", target_key)
                    }
                    other => format!("{:?}", other),
                })
                .collect();
            (vertex.to_string(), descs)
        })
        .collect();

    SchemaMappingDesc {
        vertex_remap,
        added_vertices: added,
        removed_vertices: removed,
        surviving_vertices: surviving,
        field_transforms,
    }
}

/// Install field-level circuit components derived from the compiled
/// migration's effects. This bridges auto-lens to edit mode: the
/// theory-level transforms produce a Lens, and the Lens's compiled
/// migration tells us which fields are renamed, added, dropped, or
/// transformed at the value level. We install those as real circuit
/// components so Cmd+E shows them.
fn install_field_level_components(
    circuit_handle: u32,
    lens: &panproto_lens::Lens,
    _chain: &panproto_lens::protolens::ProtolensChain,
) -> Result<(), WasmError> {
    use protolab_schema::mutate::PortSpec;

    slab::with_resource_mut(circuit_handle, |r| {
        if let Resource::Circuit(state) = r {
            // Clear existing components.
            let existing_ids: Vec<panproto_gat::Name> = state
                .schema
                .vertices
                .keys()
                .filter(|v| {
                    state
                        .schema
                        .vertices
                        .get(*v)
                        .is_some_and(|vertex| vertex.kind.as_ref() == "component")
                })
                .cloned()
                .collect();
            for id in existing_ids {
                mutate::remove_component(&mut state.schema, id.as_ref()).ok();
            }

            let cm = &lens.compiled;
            let mut comp_idx = 0u32;
            let mut prev_comp: Option<String> = None;
            let mut wire_idx = 200u32;

            let default_ports = |comp_id: &str| -> Vec<PortSpec> {
                vec![
                    PortSpec {
                        id: format!("{comp_id}.in"),
                        direction: protolab_schema::Direction::Input,
                        trigger: protolab_schema::TriggerMode::Hot,
                    },
                    PortSpec {
                        id: format!("{comp_id}.out"),
                        direction: protolab_schema::Direction::Output,
                        trigger: protolab_schema::TriggerMode::Hot,
                    },
                    PortSpec {
                        id: format!("{comp_id}.param"),
                        direction: protolab_schema::Direction::Parameter,
                        trigger: protolab_schema::TriggerMode::Cold,
                    },
                ]
            };

            // Borrow scope for the field-level pass: `add_comp` captures
            // `comp_idx`/`wire_idx`/`prev_comp` mutably, so we drop it at
            // the end of this block before reading `comp_idx` below to
            // decide whether to fire the chain-step fallback.
            {
                let mut add_comp = |schema: &mut panproto_schema::Schema,
                                    comp_type: &str,
                                    params: &[(&str, &str)]| {
                    let comp_id = format!("auto_{comp_idx}");
                    comp_idx += 1;
                    let ports = default_ports(&comp_id);
                    mutate::add_component(schema, &comp_id, comp_type, &ports).ok();
                    for (k, v) in params {
                        mutate::update_param(schema, &comp_id, k, v).ok();
                    }
                    if let Some(ref prev) = prev_comp {
                        let wid = format!("aw_{wire_idx}");
                        wire_idx += 1;
                        mutate::add_wire(
                            schema,
                            &wid,
                            &format!("{prev}.out"),
                            &format!("{comp_id}.in"),
                            Some("lens"),
                            false,
                        )
                        .ok();
                    }
                    prev_comp = Some(comp_id);
                };

                // Edge renames → rename_field components.
                for (old_edge, new_edge) in &cm.edge_remap {
                    let old_name = old_edge
                        .name
                        .as_ref()
                        .map(|n| n.to_string())
                        .unwrap_or_default();
                    let new_name = new_edge
                        .name
                        .as_ref()
                        .map(|n| n.to_string())
                        .unwrap_or_default();
                    if old_name != new_name && !old_name.is_empty() && !new_name.is_empty() {
                        add_comp(
                            &mut state.schema,
                            "rename_field",
                            &[("old_name", &old_name), ("new_name", &new_name)],
                        );
                    }
                }

                // Field transforms → corresponding component types.
                for transforms in cm.field_transforms.values() {
                    for ft in transforms {
                        match ft {
                            panproto_inst::FieldTransform::RenameField { old_key, new_key } => {
                                add_comp(
                                    &mut state.schema,
                                    "rename_field",
                                    &[("old_name", old_key), ("new_name", new_key)],
                                );
                            }
                            panproto_inst::FieldTransform::DropField { key } => {
                                add_comp(&mut state.schema, "drop_field", &[("field_name", key)]);
                            }
                            panproto_inst::FieldTransform::AddField { key, value } => {
                                let val_str = format!("{value:?}");
                                add_comp(
                                    &mut state.schema,
                                    "add_field",
                                    &[
                                        ("field_name", key),
                                        ("field_kind", "string"),
                                        ("default", &val_str),
                                    ],
                                );
                            }
                            panproto_inst::FieldTransform::ApplyExpr { key, .. } => {
                                add_comp(&mut state.schema, "apply_expr", &[("field", key)]);
                            }
                            panproto_inst::FieldTransform::ComputeField { target_key, .. } => {
                                add_comp(
                                    &mut state.schema,
                                    "compute_field",
                                    &[("target", target_key)],
                                );
                            }
                            _ => {
                                // Other transform types don't have a direct
                                // component equivalent; skip for now.
                            }
                        }
                    }
                }
            } // drop `add_comp` closure → release borrow of comp_idx

            // Intentionally no fallback: when no field-level transforms
            // were derived, the canvas stays empty. The frontend detects
            // this (nodes.length === 0 && autoLensChainSteps.length > 0)
            // and renders `CanvasEmptyState` with clear CTAs for adding
            // hints or viewing the theory-level diff in a modal. Earlier
            // versions (v0.4.0–v0.4.3) populated the canvas with
            // `chain_step` placeholders that ran as the identity at the
            // instance level — which produced a "Run yields input back,
            // plus a red validation badge" UX that was silently confusing.
            //
            // We still hold `comp_idx` / `prev_comp` / `wire_idx` to
            // keep the structure consistent with the field-level pass,
            // and the chain (preserved in `autoLensChainSteps`) is
            // surfaced in the new TheoryDiffModal on the frontend.
            let _ = comp_idx;
        }
    })?;

    Ok(())
}

/// Import a theory definition from JSON. Returns summary msgpack.
#[wasm_bindgen]
pub fn import_theory_json(json_source: &str) -> Result<Vec<u8>, JsError> {
    import_theory_json_inner(json_source).map_err(Into::into)
}

fn import_theory_json_inner(json_source: &str) -> Result<Vec<u8>, WasmError> {
    // Compile via panproto-theory-dsl. If the document is a complete
    // TheoryDocument with `theory` body, this returns a real Theory.
    use panproto_theory_dsl::{compile, eval};

    let doc = eval::eval_json(json_source)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;
    let resolver = panproto_theory_dsl::compile::builtin_resolver();
    let compiled = compile::compile(&doc, &resolver)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    // Take the first theory (most JSON files define exactly one).
    let (name, theory) = compiled
        .theories
        .into_iter()
        .next()
        .ok_or_else(|| WasmError::DeserializationFailed("no theory in document".into()))?;

    let sort_count = theory.sorts.len();
    let op_count = theory.ops.len();
    let handle = slab::alloc(Resource::Theory(theory));

    #[derive(Serialize)]
    struct TheorySummary {
        handle: u32,
        name: String,
        sort_count: usize,
        op_count: usize,
    }

    let summary = TheorySummary {
        handle,
        name: name.clone(),
        sort_count,
        op_count,
    };
    rmp_serde::to_vec_named(&summary).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

// ── User-defined protocol registry ──────────────────────────────────
//
// Users can define new protocols by JSON-encoding a `panproto_schema::
// Protocol` struct and calling `import_protocol_json`. Registered
// protocols take precedence over the hardcoded `lookup_panproto_protocol`
// built-in table in `panproto_protocols_default`, so users can both
// (a) define brand-new protocols for custom formats and (b) override
// built-in protocol definitions with local extensions (e.g., add extra
// obj_kinds or edge_rules to "mongodb").

/// Summary of a registered protocol, returned from registry operations.
#[derive(Serialize)]
struct ProtocolSummary {
    name: String,
    schema_theory: String,
    instance_theory: String,
    obj_kind_count: usize,
    constraint_sort_count: usize,
    edge_rule_count: usize,
    has_order: bool,
    has_coproducts: bool,
    has_recursion: bool,
    has_causal: bool,
    nominal_identity: bool,
    has_defaults: bool,
    has_coercions: bool,
    has_mergers: bool,
    has_policies: bool,
}

impl From<&panproto_schema::Protocol> for ProtocolSummary {
    fn from(p: &panproto_schema::Protocol) -> Self {
        Self {
            name: p.name.clone(),
            schema_theory: p.schema_theory.clone(),
            instance_theory: p.instance_theory.clone(),
            obj_kind_count: p.obj_kinds.len(),
            constraint_sort_count: p.constraint_sorts.len(),
            edge_rule_count: p.edge_rules.len(),
            has_order: p.has_order,
            has_coproducts: p.has_coproducts,
            has_recursion: p.has_recursion,
            has_causal: p.has_causal,
            nominal_identity: p.nominal_identity,
            has_defaults: p.has_defaults,
            has_coercions: p.has_coercions,
            has_mergers: p.has_mergers,
            has_policies: p.has_policies,
        }
    }
}

/// Import a user-defined protocol from JSON and register it in the
/// user-protocol registry. Returns a msgpack-encoded
/// [`ProtocolSummary`].
///
/// The JSON body must deserialize into a `panproto_schema::Protocol` —
/// see the panproto-schema crate for the exact field set. At minimum
/// the `name` field must be non-empty; all other fields have reasonable
/// serde defaults.
///
/// If a protocol with the same name (case-insensitive) already exists
/// it is overwritten.
///
/// # Errors
/// - `DeserializationFailed` if the JSON is malformed or missing required
///   fields.
/// - `DeserializationFailed` with message `"protocol name must be
///   non-empty"` if the parsed protocol has an empty name.
#[wasm_bindgen]
pub fn import_protocol_json(json_source: &str) -> Result<Vec<u8>, JsError> {
    import_protocol_json_inner(json_source).map_err(Into::into)
}

/// Native-friendly implementation of [`import_protocol_json`]. Returns
/// a `WasmError` so unit tests can pattern-match on the error variant
/// without going through `JsError` (which panics off-wasm).
fn import_protocol_json_inner(json_source: &str) -> Result<Vec<u8>, WasmError> {
    let protocol: panproto_schema::Protocol = serde_json::from_str(json_source)
        .map_err(|e| WasmError::DeserializationFailed(format!("protocol JSON: {e}")))?;
    if protocol.name.trim().is_empty() {
        return Err(WasmError::DeserializationFailed(
            "protocol name must be non-empty".into(),
        ));
    }

    // Also allocate a slab handle so the caller can retrieve the full
    // protocol later via `get_protocol_details` without re-parsing JSON.
    let handle = slab::alloc(Resource::Protocol(protocol.clone()));
    let summary = ProtocolSummary::from(&protocol);
    slab::register_user_protocol(protocol);

    #[derive(Serialize)]
    struct ImportResult {
        handle: u32,
        summary: ProtocolSummary,
    }

    let result = ImportResult { handle, summary };
    rmp_serde::to_vec_named(&result).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// List the names of all user-registered protocols, in lexicographic
/// order. Returns a msgpack array of `ProtocolSummary` entries so the
/// UI can render the full metadata without a second round-trip.
#[wasm_bindgen]
pub fn list_user_protocols() -> Result<Vec<u8>, JsError> {
    list_user_protocols_inner().map_err(Into::into)
}

fn list_user_protocols_inner() -> Result<Vec<u8>, WasmError> {
    let names = slab::list_user_protocol_names();
    let summaries: Vec<ProtocolSummary> = names
        .iter()
        .filter_map(|n| slab::find_user_protocol(n))
        .map(|p| ProtocolSummary::from(&p))
        .collect();
    rmp_serde::to_vec_named(&summaries).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Remove a user-registered protocol by name. Returns `true` (msgpack
/// bool) if an entry was removed, `false` if none was found.
#[wasm_bindgen]
pub fn remove_user_protocol(name: &str) -> Result<Vec<u8>, JsError> {
    remove_user_protocol_inner(name).map_err(Into::into)
}

fn remove_user_protocol_inner(name: &str) -> Result<Vec<u8>, WasmError> {
    let removed = slab::unregister_user_protocol(name);
    rmp_serde::to_vec_named(&removed).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Return the full [`Protocol`] (as JSON) for a registered user protocol.
///
/// Useful for exporting or editing a previously-imported protocol.
/// Returns `null` (JSON) if the protocol is not registered.
#[wasm_bindgen]
pub fn get_user_protocol_json(name: &str) -> Result<String, JsError> {
    get_user_protocol_json_inner(name).map_err(Into::into)
}

fn get_user_protocol_json_inner(name: &str) -> Result<String, WasmError> {
    match slab::find_user_protocol(name) {
        Some(p) => serde_json::to_string_pretty(&p)
            .map_err(|e| WasmError::SerializationFailed(e.to_string())),
        None => Ok("null".into()),
    }
}

/// Get the circuit graph for a handle (also used to create a demo with handle).
///
/// Also creates a built-in "user" source schema (matching the demo circuit's
/// expected fields) and auto-assigns it as the circuit's source schema. This
/// makes evaluation work out-of-the-box: type JSON like
/// `{"name": "Alice", "legacyId": 42}` and click Run.
#[wasm_bindgen]
pub fn create_demo_circuit_with_handle() -> Result<Vec<u8>, JsError> {
    create_demo_circuit_with_handle_inner().map_err(Into::into)
}

fn create_demo_circuit_with_handle_inner() -> Result<Vec<u8>, WasmError> {
    let schema = builder::demo_circuit();
    let mut state = CircuitState::new(schema.clone());

    // Build the user schema and allocate it.
    let user_schema = build_user_schema();
    let user_schema_handle = slab::alloc(Resource::Schema(user_schema));
    state.source_schema_h = Some(user_schema_handle);

    let circuit_handle = slab::alloc(Resource::Circuit(state));
    let graph = schema_to_graph(&schema);

    #[derive(Serialize)]
    struct DemoResult {
        handle: u32,
        graph: CircuitGraph,
        source_schema_handle: u32,
    }

    let result = DemoResult {
        handle: circuit_handle,
        graph,
        source_schema_handle: user_schema_handle,
    };
    rmp_serde::to_vec_named(&result).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Build a simple "user" schema with fields matching the demo circuit.
///
/// Vertex IDs use `user.<field>` convention so that the protolab-eval
/// dispatcher's `format!("{parent}.{field}")` lookup works correctly.
fn build_user_schema() -> panproto_schema::Schema {
    use panproto_gat::Name;
    use panproto_schema::{Edge, Schema, Vertex};
    use std::collections::HashMap;

    let mut vertices: HashMap<Name, Vertex> = HashMap::new();
    let mut edges: HashMap<Edge, Name> = HashMap::new();
    let mut outgoing: HashMap<Name, smallvec::SmallVec<Edge, 4>> = HashMap::new();
    let mut incoming: HashMap<Name, smallvec::SmallVec<Edge, 4>> = HashMap::new();
    let mut between: HashMap<(Name, Name), smallvec::SmallVec<Edge, 2>> = HashMap::new();

    // Root: user vertex
    vertices.insert(
        Name::from("user"),
        Vertex {
            id: "user".into(),
            kind: "object".into(),
            nsid: None,
        },
    );

    // Fields: name, legacyId, email
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
        // panproto v0.32.0 pointed-schemas: declare the demo's basepoint
        // explicitly so primary_entry returns "user" instead of falling
        // through to the topology heuristic.
        entries: vec![Name::from("user")],
        outgoing,
        incoming,
        between,
    }
}

// ── Schema assignment for circuits ──────────────────────────────────

/// Assign a source schema to a circuit (for evaluation).
#[wasm_bindgen]
pub fn set_source_schema(circuit_handle: u32, schema_handle: u32) -> Result<(), JsError> {
    set_source_schema_inner(circuit_handle, schema_handle).map_err(Into::into)
}

fn set_source_schema_inner(circuit_handle: u32, schema_handle: u32) -> Result<(), WasmError> {
    slab::with_resource_mut(circuit_handle, |r| {
        if let Resource::Circuit(state) = r {
            state.source_schema_h = Some(schema_handle);
            // Invalidate any cached evaluation.
            state.last_eval = None;
        }
    })?;
    Ok(())
}

/// Get the source schema handle for a circuit (or null/0 if unset).
#[wasm_bindgen]
pub fn get_source_schema(circuit_handle: u32) -> Result<i32, JsError> {
    get_source_schema_inner(circuit_handle).map_err(Into::into)
}

fn get_source_schema_inner(circuit_handle: u32) -> Result<i32, WasmError> {
    slab::with_resource(circuit_handle, |r| match r {
        Resource::Circuit(state) => state.source_schema_h.map(|h| h as i32).unwrap_or(-1),
        _ => -1,
    })
}

// ── Evaluation API ──────────────────────────────────────────────────

/// Set the input data for a circuit (parses JSON to a WInstance).
#[wasm_bindgen]
pub fn set_input_data(circuit_handle: u32, json_str: &str) -> Result<(), JsError> {
    set_input_data_inner(circuit_handle, json_str).map_err(Into::into)
}

fn set_input_data_inner(circuit_handle: u32, json_str: &str) -> Result<(), WasmError> {
    let value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    let source_h = slab::with_resource(circuit_handle, |r| match r {
        Resource::Circuit(state) => state.source_schema_h,
        _ => None,
    })?;

    let source_schema = if let Some(h) = source_h {
        slab::get_schema(h)?
    } else {
        // No source schema set — use the circuit's own schema (won't work for real eval).
        return Err(WasmError::DeserializationFailed(
            "no source schema assigned — call set_source_schema first".into(),
        ));
    };

    // Find the actual root vertex (no incoming edges) — NOT an arbitrary
    // HashMap entry, which would parse a degenerate WInstance and silently
    // produce wrong eval results.
    let root = protolab_eval::find_root_vertex(&source_schema)
        .map(|n| n.to_string())
        .ok_or_else(|| {
            WasmError::DeserializationFailed("source schema has no root vertex".into())
        })?;

    let instance = panproto_inst::parse::parse_json(&source_schema, &root, &value)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    slab::with_resource_mut(circuit_handle, |r| {
        if let Resource::Circuit(state) = r {
            state.input_instance = Some(instance);
            state.last_eval = None;
        }
    })?;

    Ok(())
}

/// Run forward evaluation. Returns msgpack with output JSON and per-wire data.
#[wasm_bindgen]
pub fn evaluate_circuit(circuit_handle: u32) -> Result<Vec<u8>, JsError> {
    evaluate_circuit_inner(circuit_handle).map_err(Into::into)
}

fn evaluate_circuit_inner(circuit_handle: u32) -> Result<Vec<u8>, WasmError> {
    use protolab_eval::wire_data_for_circuit;

    let (protolab_schema, source_h, input) = slab::with_resource(circuit_handle, |r| match r {
        Resource::Circuit(state) => Ok((
            state.schema.clone(),
            state.source_schema_h,
            state.input_instance.clone(),
        )),
        _ => Err(WasmError::TypeMismatch {
            expected: "Circuit",
            got: "other",
        }),
    })??;

    let source_h = source_h.ok_or(WasmError::DeserializationFailed(
        "no source schema assigned".into(),
    ))?;
    let input = input.ok_or(WasmError::DeserializationFailed("no input data set".into()))?;

    let source_schema = slab::get_schema(source_h)?;
    let source_protocol = panproto_protocols_default(&source_schema);

    let eval = wire_data_for_circuit(&protolab_schema, &source_schema, &source_protocol, &input)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    // Convert each wire WInstance to JSON, rendered against THAT wire's
    // target schema (not the source schema — the lens transforms the schema
    // structure too, so source-schema rendering would interpret transformed
    // instances through the wrong vertex set).
    let mut wire_data_json: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for (wire_id, instance) in &eval.wire_data {
        let wire_schema = eval.wire_schemas.get(wire_id).unwrap_or(&source_schema);
        let json = panproto_inst::parse::to_json(wire_schema, instance);
        wire_data_json.insert(
            wire_id.clone(),
            serde_json::to_string_pretty(&json).unwrap_or_default(),
        );
    }
    let output_json_value = panproto_inst::parse::to_json(&eval.output_schema, &eval.output);
    let output_json = serde_json::to_string_pretty(&output_json_value).unwrap_or_default();

    // Cache for backward pass.
    slab::with_resource_mut(circuit_handle, |r| {
        if let Resource::Circuit(state) = r {
            state.last_eval = Some(slab::EvalCache {
                final_lens: eval.final_lens,
                final_complement: eval.complement,
                final_view: eval.final_view,
                wire_data_json: wire_data_json.clone(),
                output_json: output_json.clone(),
            });
        }
    })?;

    #[derive(Serialize)]
    struct EvaluationResult {
        output: String,
        wire_data: std::collections::HashMap<String, String>,
        success: bool,
    }

    let result = EvaluationResult {
        output: output_json,
        wire_data: wire_data_json,
        success: true,
    };
    rmp_serde::to_vec_named(&result).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Get cached wire data JSON for a specific wire (after evaluate_circuit).
#[wasm_bindgen]
pub fn get_wire_data(circuit_handle: u32, wire_id: &str) -> Result<String, JsError> {
    get_wire_data_inner(circuit_handle, wire_id).map_err(Into::into)
}

fn get_wire_data_inner(circuit_handle: u32, wire_id: &str) -> Result<String, WasmError> {
    slab::with_resource(circuit_handle, |r| match r {
        Resource::Circuit(state) => state
            .last_eval
            .as_ref()
            .and_then(|e| e.wire_data_json.get(wire_id).cloned())
            .unwrap_or_default(),
        _ => String::new(),
    })
}

/// Apply a modified output back through the lens chain (backward pass).
/// Returns the resulting input JSON.
#[wasm_bindgen]
pub fn apply_modified_output(circuit_handle: u32, modified_json: &str) -> Result<String, JsError> {
    apply_modified_output_inner(circuit_handle, modified_json).map_err(Into::into)
}

fn apply_modified_output_inner(
    circuit_handle: u32,
    modified_json: &str,
) -> Result<String, WasmError> {
    use panproto_lens::asymmetric::put;

    let value: serde_json::Value = serde_json::from_str(modified_json)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    let source_h = slab::with_resource(circuit_handle, |r| match r {
        Resource::Circuit(state) => state.source_schema_h,
        _ => None,
    })?
    .ok_or(WasmError::DeserializationFailed("no source schema".into()))?;

    let source_schema = slab::get_schema(source_h)?;

    // Borrow the cached lens + complement directly from `last_eval`.
    // Earlier versions serialized both to JSON and re-parsed them on
    // the way back in, but `Complement` contains `HashMap<(u32, u32),
    // Edge>` fields whose tuple keys are not representable as JSON
    // object keys — `serde_json::to_string` errored, the
    // `unwrap_or_default()` call turned the failure into an empty
    // string, and the next `from_str` then failed with "EOF while
    // parsing", silently breaking Apply Back. The values are already
    // owned by the slab, so we just borrow them through one
    // `with_resource_mut` and run the put/to_json pipeline in place.
    let restored_input_json = slab::with_resource_mut(circuit_handle, |r| match r {
        Resource::Circuit(state) => {
            let eval = state.last_eval.as_ref().ok_or_else(|| {
                WasmError::DeserializationFailed(
                    "no evaluation cache — run evaluate_circuit first".into(),
                )
            })?;
            let tgt_schema = &eval.final_lens.tgt_schema;
            // Merge user edits into the stored forward view rather
            // than re-parsing from scratch. Two reasons:
            //
            // 1. Root inference: the target schema has no declared
            //    `entries`, so `primary_entry` falls through to a
            //    topology heuristic that picks the wrong vertex under
            //    panproto v0.33+. Using `src_schema`'s root fixes the
            //    parse root (panproto#40).
            //
            // 2. Node-ID consistency: protolab's per-step evaluation
            //    pipeline calls `get()` at each component, producing
            //    complement node IDs that correspond to the per-step
            //    view. A freshly-parsed view from `parse_json` gets
            //    different IDs, so v0.34.1's
            //    `propagate_view_edits_through_inverse` misses the
            //    complement snapshot and falls into the fallback that
            //    doesn't handle RenameField inversions. Modifying the
            //    stored `final_view` in-place preserves IDs.
            let mut view = eval.final_view.clone();
            let original_json = panproto_inst::parse::to_json(tgt_schema, &view);
            if let (Some(orig_obj), Some(user_obj)) = (original_json.as_object(), value.as_object())
            {
                let root_id = view.root;
                if let Some(root_node) = view.nodes.get_mut(&root_id) {
                    for (key, user_val) in user_obj {
                        if orig_obj.get(key) != Some(user_val) {
                            root_node
                                .extra_fields
                                .insert(key.clone(), json_to_inst_value(user_val));
                        }
                    }
                }
            }
            let restored = put(&eval.final_lens, &view, &eval.final_complement)
                .map_err(|e| WasmError::DeserializationFailed(format!("lens put: {e}")))?;
            let restored_value = panproto_inst::parse::to_json(&source_schema, &restored);
            serde_json::to_string_pretty(&restored_value)
                .map_err(|e| WasmError::SerializationFailed(e.to_string()))
        }
        _ => Err(WasmError::TypeMismatch {
            expected: "Circuit",
            got: "other",
        }),
    })??;

    Ok(restored_input_json)
}

// ── Theory API ──────────────────────────────────────────────────────

/// Compile a theory document from JSON source. Returns msgpack with handles.
#[wasm_bindgen]
pub fn compile_theory_bundle(json_source: &str) -> Result<Vec<u8>, JsError> {
    compile_theory_bundle_inner(json_source).map_err(Into::into)
}

fn compile_theory_bundle_inner(json_source: &str) -> Result<Vec<u8>, WasmError> {
    use panproto_theory_dsl::{compile, eval};

    let doc = eval::eval_json(json_source)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;
    let resolver = panproto_theory_dsl::compile::builtin_resolver();
    let compiled = compile::compile(&doc, &resolver)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    let mut theory_handles: Vec<(String, u32)> = Vec::new();
    for (name, theory) in compiled.theories {
        let h = slab::alloc(Resource::Theory(theory));
        theory_handles.push((name, h));
    }
    let mut protocol_handles: Vec<(String, u32)> = Vec::new();
    for (name, protocol) in compiled.protocols {
        let h = slab::alloc(Resource::Protocol(protocol));
        protocol_handles.push((name, h));
    }
    let mut morphism_handles: Vec<(String, u32)> = Vec::new();
    for (name, morphism) in compiled.morphisms {
        let h = slab::alloc(Resource::Morphism(morphism));
        morphism_handles.push((name, h));
    }

    #[derive(Serialize)]
    struct CompileResult {
        id: String,
        theories: Vec<(String, u32)>,
        protocols: Vec<(String, u32)>,
        morphisms: Vec<(String, u32)>,
    }

    let result = CompileResult {
        id: compiled.id,
        theories: theory_handles,
        protocols: protocol_handles,
        morphisms: morphism_handles,
    };
    rmp_serde::to_vec_named(&result).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Compose two theories via colimit (pushout) over shared sorts.
#[wasm_bindgen]
pub fn compose_theories_via_colimit(
    t1_handle: u32,
    t2_handle: u32,
    shared_sorts_json: &str,
) -> Result<u32, JsError> {
    compose_theories_via_colimit_inner(t1_handle, t2_handle, shared_sorts_json).map_err(Into::into)
}

fn compose_theories_via_colimit_inner(
    t1_handle: u32,
    t2_handle: u32,
    shared_sorts_json: &str,
) -> Result<u32, WasmError> {
    let t1 = slab::get_theory(t1_handle)?;
    let t2 = slab::get_theory(t2_handle)?;

    let shared_sort_names: Vec<String> = serde_json::from_str(shared_sorts_json)
        .map_err(|e| WasmError::DeserializationFailed(e.to_string()))?;

    let shared_sorts: Vec<panproto_gat::Sort> = shared_sort_names
        .iter()
        .map(|n| panproto_gat::Sort::simple(n.as_str()))
        .collect();

    let shared_theory = panproto_gat::Theory::new("shared", shared_sorts, vec![], vec![]);

    let composed = panproto_gat::colimit_by_name(&t1, &t2, &shared_theory)
        .map_err(|e| WasmError::DeserializationFailed(format!("{e:?}")))?;

    Ok(slab::alloc(Resource::Theory(composed)))
}

/// List the names of built-in panproto theories.
#[wasm_bindgen]
pub fn list_builtin_theories() -> Result<Vec<u8>, JsError> {
    list_builtin_theories_inner().map_err(Into::into)
}

fn list_builtin_theories_inner() -> Result<Vec<u8>, WasmError> {
    let names = vec![
        "ThGraph",
        "ThWType",
        "ThConstraint",
        "ThMulti",
        "ThMeta",
        "ThSimpleGraph",
        "ThHypergraph",
        "ThInterface",
        "ThFunctor",
        "ThFlat",
    ];
    rmp_serde::to_vec_named(&names).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Get details (sorts, ops, equations) of a theory by handle.
#[wasm_bindgen]
pub fn get_theory_details(handle: u32) -> Result<Vec<u8>, JsError> {
    get_theory_details_inner(handle).map_err(Into::into)
}

fn get_theory_details_inner(handle: u32) -> Result<Vec<u8>, WasmError> {
    let theory = slab::get_theory(handle)?;

    #[derive(Serialize)]
    struct TheoryDetails {
        name: String,
        sorts: Vec<String>,
        ops: Vec<String>,
        equation_count: usize,
    }

    let details = TheoryDetails {
        name: theory.name.to_string(),
        sorts: theory.sorts.iter().map(|s| s.name.to_string()).collect(),
        ops: theory.ops.iter().map(|o| o.name.to_string()).collect(),
        equation_count: theory.eqs.len(),
    };
    rmp_serde::to_vec_named(&details).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

// ── Expression language API ────────────────────────────────────────

/// Parse a panproto-expr source string. Returns msgpack with structured
/// success or error info (line/column for the editor's linter).
#[wasm_bindgen]
pub fn parse_expression(source: &str) -> Result<Vec<u8>, JsError> {
    parse_expression_inner(source).map_err(Into::into)
}

fn parse_expression_inner(source: &str) -> Result<Vec<u8>, WasmError> {
    use panproto_expr_parser::{parse, tokenize};

    #[derive(Serialize)]
    struct ParseResult {
        ok: bool,
        error: Option<String>,
        line: Option<usize>,
        column: Option<usize>,
    }

    let result = match tokenize(source) {
        Err(e) => ParseResult {
            ok: false,
            error: Some(format!("tokenize: {e:?}")),
            line: None,
            column: None,
        },
        Ok(tokens) => match parse(&tokens) {
            Ok(_expr) => ParseResult {
                ok: true,
                error: None,
                line: None,
                column: None,
            },
            Err(errs) => {
                let msg = errs
                    .iter()
                    .map(|e| format!("{e:?}"))
                    .collect::<Vec<_>>()
                    .join("; ");
                ParseResult {
                    ok: false,
                    error: Some(msg),
                    line: None,
                    column: None,
                }
            }
        },
    };

    rmp_serde::to_vec_named(&result).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Evaluate a panproto-expr source string against a JSON environment.
/// Returns the result as a JSON string.
#[wasm_bindgen]
pub fn evaluate_expression(source: &str, env_json: &str) -> Result<String, JsError> {
    evaluate_expression_inner(source, env_json).map_err(Into::into)
}

fn evaluate_expression_inner(source: &str, env_json: &str) -> Result<String, WasmError> {
    use panproto_expr::{Env, EvalConfig, eval};
    use panproto_expr_parser::{parse, tokenize};

    let tokens = tokenize(source)
        .map_err(|e| WasmError::DeserializationFailed(format!("tokenize: {e:?}")))?;
    let expr = parse(&tokens)
        .map_err(|errs| WasmError::DeserializationFailed(format!("parse: {errs:?}")))?;

    // Parse env_json as a JSON object whose values are converted to Literals.
    let env_value: serde_json::Value = serde_json::from_str(env_json)
        .map_err(|e| WasmError::DeserializationFailed(format!("env: {e}")))?;

    let mut env = Env::new();
    if let serde_json::Value::Object(map) = env_value {
        for (k, v) in map {
            let lit = json_to_literal(&v);
            env = env.extend(std::sync::Arc::from(k.as_str()), lit);
        }
    }

    let config = EvalConfig::default();
    let result = eval(&expr, &env, &config)
        .map_err(|e| WasmError::DeserializationFailed(format!("eval: {e:?}")))?;

    Ok(literal_to_json_string(&result))
}

/// Return the list of builtin function names with categories and arity.
#[wasm_bindgen]
pub fn list_expr_builtins() -> Result<Vec<u8>, JsError> {
    list_expr_builtins_inner().map_err(Into::into)
}

fn list_expr_builtins_inner() -> Result<Vec<u8>, WasmError> {
    #[derive(Serialize)]
    struct Builtin {
        name: &'static str,
        category: &'static str,
        signature: &'static str,
    }

    let builtins: &[Builtin] = &[
        // Arithmetic
        Builtin {
            name: "add",
            category: "arithmetic",
            signature: "add(a, b)",
        },
        Builtin {
            name: "sub",
            category: "arithmetic",
            signature: "sub(a, b)",
        },
        Builtin {
            name: "mul",
            category: "arithmetic",
            signature: "mul(a, b)",
        },
        Builtin {
            name: "div",
            category: "arithmetic",
            signature: "div(a, b)",
        },
        Builtin {
            name: "mod_",
            category: "arithmetic",
            signature: "mod_(a, b)",
        },
        Builtin {
            name: "neg",
            category: "arithmetic",
            signature: "neg(a)",
        },
        Builtin {
            name: "abs",
            category: "arithmetic",
            signature: "abs(a)",
        },
        // Rounding
        Builtin {
            name: "floor",
            category: "rounding",
            signature: "floor(a)",
        },
        Builtin {
            name: "ceil",
            category: "rounding",
            signature: "ceil(a)",
        },
        Builtin {
            name: "round",
            category: "rounding",
            signature: "round(a)",
        },
        // Comparison
        Builtin {
            name: "eq",
            category: "comparison",
            signature: "eq(a, b)",
        },
        Builtin {
            name: "neq",
            category: "comparison",
            signature: "neq(a, b)",
        },
        Builtin {
            name: "lt",
            category: "comparison",
            signature: "lt(a, b)",
        },
        Builtin {
            name: "lte",
            category: "comparison",
            signature: "lte(a, b)",
        },
        Builtin {
            name: "gt",
            category: "comparison",
            signature: "gt(a, b)",
        },
        Builtin {
            name: "gte",
            category: "comparison",
            signature: "gte(a, b)",
        },
        // Boolean
        Builtin {
            name: "and",
            category: "boolean",
            signature: "and(a, b)",
        },
        Builtin {
            name: "or",
            category: "boolean",
            signature: "or(a, b)",
        },
        Builtin {
            name: "not",
            category: "boolean",
            signature: "not(a)",
        },
        // String
        Builtin {
            name: "concat",
            category: "string",
            signature: "concat(a, b)",
        },
        Builtin {
            name: "len",
            category: "string",
            signature: "len(s)",
        },
        Builtin {
            name: "slice",
            category: "string",
            signature: "slice(s, start, end)",
        },
        Builtin {
            name: "upper",
            category: "string",
            signature: "upper(s)",
        },
        Builtin {
            name: "lower",
            category: "string",
            signature: "lower(s)",
        },
        Builtin {
            name: "trim",
            category: "string",
            signature: "trim(s)",
        },
        Builtin {
            name: "split",
            category: "string",
            signature: "split(s, delim)",
        },
        Builtin {
            name: "join",
            category: "string",
            signature: "join(parts, delim)",
        },
        Builtin {
            name: "replace",
            category: "string",
            signature: "replace(s, from, to)",
        },
        Builtin {
            name: "contains",
            category: "string",
            signature: "contains(s, substr)",
        },
        // List
        Builtin {
            name: "map",
            category: "list",
            signature: "map(list, f)",
        },
        Builtin {
            name: "filter",
            category: "list",
            signature: "filter(list, pred)",
        },
        Builtin {
            name: "fold",
            category: "list",
            signature: "fold(list, init, f)",
        },
        Builtin {
            name: "append",
            category: "list",
            signature: "append(list, item)",
        },
        Builtin {
            name: "head",
            category: "list",
            signature: "head(list)",
        },
        Builtin {
            name: "tail",
            category: "list",
            signature: "tail(list)",
        },
        Builtin {
            name: "reverse",
            category: "list",
            signature: "reverse(list)",
        },
        Builtin {
            name: "flat_map",
            category: "list",
            signature: "flat_map(list, f)",
        },
        Builtin {
            name: "length",
            category: "list",
            signature: "length(list)",
        },
        // Record
        Builtin {
            name: "merge",
            category: "record",
            signature: "merge(a, b)",
        },
        Builtin {
            name: "keys",
            category: "record",
            signature: "keys(r)",
        },
        Builtin {
            name: "values",
            category: "record",
            signature: "values(r)",
        },
        Builtin {
            name: "has_field",
            category: "record",
            signature: "has_field(r, name)",
        },
        // Utility
        Builtin {
            name: "default",
            category: "utility",
            signature: "default(x, fallback)",
        },
        Builtin {
            name: "clamp",
            category: "utility",
            signature: "clamp(x, min, max)",
        },
        Builtin {
            name: "truncate_str",
            category: "utility",
            signature: "truncate_str(s, max_len)",
        },
        // Coercion
        Builtin {
            name: "int_to_float",
            category: "coercion",
            signature: "int_to_float(n)",
        },
        Builtin {
            name: "float_to_int",
            category: "coercion",
            signature: "float_to_int(f)",
        },
        Builtin {
            name: "int_to_str",
            category: "coercion",
            signature: "int_to_str(n)",
        },
        Builtin {
            name: "float_to_str",
            category: "coercion",
            signature: "float_to_str(f)",
        },
        Builtin {
            name: "str_to_int",
            category: "coercion",
            signature: "str_to_int(s)",
        },
        Builtin {
            name: "str_to_float",
            category: "coercion",
            signature: "str_to_float(s)",
        },
        // Inspection
        Builtin {
            name: "type_of",
            category: "inspection",
            signature: "type_of(v)",
        },
        Builtin {
            name: "is_null",
            category: "inspection",
            signature: "is_null(v)",
        },
        Builtin {
            name: "is_list",
            category: "inspection",
            signature: "is_list(v)",
        },
        // Graph traversal
        Builtin {
            name: "edge",
            category: "graph",
            signature: "edge(node, edge_kind)",
        },
        Builtin {
            name: "children",
            category: "graph",
            signature: "children(node)",
        },
        Builtin {
            name: "has_edge",
            category: "graph",
            signature: "has_edge(node, edge_kind)",
        },
        Builtin {
            name: "edge_count",
            category: "graph",
            signature: "edge_count(node)",
        },
        Builtin {
            name: "anchor",
            category: "graph",
            signature: "anchor(node)",
        },
    ];

    rmp_serde::to_vec_named(&builtins).map_err(|e| WasmError::SerializationFailed(e.to_string()))
}

/// Convert a serde_json Value to a panproto-expr Literal.
fn json_to_literal(v: &serde_json::Value) -> panproto_expr::Literal {
    use panproto_expr::Literal;
    match v {
        serde_json::Value::Null => Literal::Null,
        serde_json::Value::Bool(b) => Literal::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Literal::Int(i)
            } else if let Some(f) = n.as_f64() {
                Literal::Float(f)
            } else {
                Literal::Null
            }
        }
        serde_json::Value::String(s) => Literal::Str(s.clone()),
        serde_json::Value::Array(arr) => Literal::List(arr.iter().map(json_to_literal).collect()),
        serde_json::Value::Object(map) => {
            let fields: Vec<(std::sync::Arc<str>, Literal)> = map
                .iter()
                .map(|(k, v)| (std::sync::Arc::from(k.as_str()), json_to_literal(v)))
                .collect();
            Literal::Record(fields)
        }
    }
}

/// Convert a panproto-expr Literal to a JSON string.
fn literal_to_json_string(lit: &panproto_expr::Literal) -> String {
    use panproto_expr::Literal;
    match lit {
        Literal::Null => "null".to_owned(),
        Literal::Bool(b) => b.to_string(),
        Literal::Int(i) => i.to_string(),
        Literal::Float(f) => f.to_string(),
        Literal::Str(s) => serde_json::to_string(s).unwrap_or_else(|_| format!("\"{s}\"")),
        Literal::Bytes(_) => "\"<bytes>\"".to_owned(),
        Literal::List(items) => {
            let parts: Vec<String> = items.iter().map(literal_to_json_string).collect();
            format!("[{}]", parts.join(", "))
        }
        Literal::Record(fields) => {
            let parts: Vec<String> = fields
                .iter()
                .map(|(k, v)| format!("\"{}\": {}", k, literal_to_json_string(v)))
                .collect();
            format!("{{{}}}", parts.join(", "))
        }
        Literal::Closure { .. } => "\"<closure>\"".to_owned(),
    }
}

/// Helper: get a default protocol for a schema (uses the schema's own protocol name).
/// Look up a protocol by its canonical name. Walks `panproto_protocols`
/// (panproto v0.27.2 ships ~50 protocol definitions) and returns the
/// matching `Protocol` if one exists, or `None` to signal the caller
/// should fall back to a synthetic default.
///
/// Matching is case-insensitive and also accepts a few historical
/// aliases (e.g. `atproto` ↔ `ATProto`).
fn lookup_panproto_protocol(name: &str) -> Option<panproto_schema::Protocol> {
    use panproto_protocols as pp;
    let key = name.to_ascii_lowercase();
    match key.as_str() {
        // Serialization / IDLs
        "avro" => Some(pp::serialization::avro::protocol()),
        "asn1" | "asn.1" => Some(pp::serialization::asn1::protocol()),
        "bond" => Some(pp::serialization::bond::protocol()),
        "flatbuffers" | "fbs" => Some(pp::serialization::flatbuffers::protocol()),
        "msgpack" | "msgpack-schema" => Some(pp::serialization::msgpack_schema::protocol()),
        // Data schema
        "cddl" => Some(pp::data_schema::cddl::protocol()),
        "bson" => Some(pp::data_schema::bson::protocol()),
        // API
        "openapi" | "swagger" => Some(pp::api::openapi::protocol()),
        "asyncapi" => Some(pp::api::asyncapi::protocol()),
        "raml" => Some(pp::api::raml::protocol()),
        "jsonapi" | "json:api" => Some(pp::api::jsonapi::protocol()),
        // Database
        "mongodb" | "mongo" => Some(pp::database::mongodb::protocol()),
        "cassandra" | "cql" => Some(pp::database::cassandra::protocol()),
        "dynamodb" | "dynamo" => Some(pp::database::dynamodb::protocol()),
        "neo4j" | "cypher" => Some(pp::database::neo4j::protocol()),
        "redis" => Some(pp::database::redis::protocol()),
        // Web / document
        "atproto" => Some(pp::web_document::atproto::protocol()),
        "docx" => Some(pp::web_document::docx::protocol()),
        "odf" => Some(pp::web_document::odf::protocol()),
        // Data science
        "parquet" => Some(pp::data_science::parquet::protocol()),
        "arrow" => Some(pp::data_science::arrow::protocol()),
        "dataframe" => Some(pp::data_science::dataframe::protocol()),
        // Domain
        "geojson" => Some(pp::domain::geojson::protocol()),
        "fhir" => Some(pp::domain::fhir::protocol()),
        "rss" | "atom" | "rss_atom" => Some(pp::domain::rss_atom::protocol()),
        "vcard" | "ical" | "vcard_ical" => Some(pp::domain::vcard_ical::protocol()),
        "edi_x12" | "x12" => Some(pp::domain::edi_x12::protocol()),
        "swift_mt" | "swift" => Some(pp::domain::swift_mt::protocol()),
        // Config
        "k8s" | "k8s_crd" | "kubernetes" => Some(pp::config::k8s_crd::protocol()),
        "cloudformation" => Some(pp::config::cloudformation::protocol()),
        "ansible" => Some(pp::config::ansible::protocol()),
        _ => None,
    }
}

/// Resolve the [`panproto_schema::Protocol`] for a given schema.
///
/// Looks up the schema's `protocol` field in panproto's built-in protocol
/// registry. If no match is found (e.g., synthetic schemas like
/// `user-demo`), returns a minimal default protocol tagged with the
/// schema's own name. This default is sufficient for lens-level
/// operations where the protocol body is never consulted.
fn panproto_protocols_default(schema: &panproto_schema::Schema) -> panproto_schema::Protocol {
    // Lookup order: user-registered protocols take precedence over the
    // hardcoded built-in table so users can both define brand-new
    // protocols and override built-ins for local extensions.
    if let Some(p) = slab::find_user_protocol(&schema.protocol) {
        return p;
    }
    if let Some(p) = lookup_panproto_protocol(&schema.protocol) {
        return p;
    }
    // Synthetic fallback: an empty ThWType-based protocol that carries
    // the schema's own name. Used for user-built demo circuits and
    // imported schemas whose protocol string isn't in the registry.
    panproto_schema::Protocol {
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

// ── Helper types ───────────────────────────────────────────────────

#[derive(Serialize)]
struct SchemaSummary {
    protocol: String,
    vertex_count: usize,
    edge_count: usize,
}

fn parse_direction(s: &str) -> protolab_schema::Direction {
    match s {
        "output" => protolab_schema::Direction::Output,
        "parameter" => protolab_schema::Direction::Parameter,
        _ => protolab_schema::Direction::Input,
    }
}

fn parse_trigger(s: &str) -> protolab_schema::TriggerMode {
    match s {
        "cold" => protolab_schema::TriggerMode::Cold,
        _ => protolab_schema::TriggerMode::Hot,
    }
}

// ── Internal helpers ────────────────────────────────────────────────

/// Convert a circuit Schema to a React Flow-compatible graph structure
/// using the hardcoded fallback optic kinds.
fn schema_to_graph(circuit: &panproto_schema::Schema) -> CircuitGraph {
    schema_to_graph_with_optics(circuit, None)
}

/// Convert a circuit Schema to a React Flow-compatible graph structure,
/// optionally using per-component optic kinds computed from the real
/// protolens chain (instead of hardcoded defaults).
fn schema_to_graph_with_optics(
    circuit: &panproto_schema::Schema,
    computed_optics: Option<&std::collections::HashMap<String, String>>,
) -> CircuitGraph {
    let port_owners = topo::port_owners(circuit);

    // Collect components in topological order so positions are deterministic
    // and respect the actual data flow (sources → sinks left-to-right).
    let sorted_comp_ids = topo::topological_sort(circuit).unwrap_or_default();

    let mut nodes = Vec::new();
    let mut node_index = 0;

    for id in &sorted_comp_ids {
        let Some(vertex) = circuit.vertices.get(id) else {
            continue;
        };
        if vertex.kind.as_ref() != kinds::COMPONENT {
            continue;
        }

        let comp_type =
            find_constraint(circuit, id, "component_type").unwrap_or_else(|| "unknown".into());

        // Prefer computed optic if available, else fall back to hardcoded.
        let optic = computed_optics
            .and_then(|m| m.get(&id.to_string()).cloned())
            .unwrap_or_else(|| component_optic(circuit, id, &port_owners));

        // Collect ports for this component.
        let ports: Vec<GraphPort> = circuit
            .edges
            .keys()
            .filter(|e| {
                e.src == *id && matches!(e.kind.as_ref(), "has_input" | "has_output" | "has_param")
            })
            .map(|e| {
                let dir =
                    find_constraint(circuit, &e.tgt, "direction").unwrap_or_else(|| "input".into());
                let trigger = find_constraint(circuit, &e.tgt, "trigger_mode")
                    .unwrap_or_else(|| "hot".into());
                GraphPort {
                    id: e.tgt.to_string(),
                    direction: dir,
                    trigger,
                }
            })
            .collect();

        // Collect params for this component.
        let params: Vec<GraphParam> = circuit
            .constraints
            .get(id)
            .map(|cs| {
                cs.iter()
                    .filter(|c| c.sort.as_ref().starts_with("param:"))
                    .map(|c| GraphParam {
                        key: c.sort.as_ref().strip_prefix("param:").unwrap_or("").into(),
                        value: c.value.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        nodes.push(GraphNode {
            id: id.to_string(),
            node_type: "component".into(),
            label: comp_type.clone(),
            component_type: comp_type,
            optic_kind: optic,
            ports,
            params,
            position: Position {
                x: node_index as f64 * 320.0 + 50.0,
                y: 120.0,
            },
        });

        node_index += 1;
    }

    // Collect wired_to and feedback edges.
    let mut edges = Vec::new();
    for edge in circuit.edges.keys() {
        if edge.kind.as_ref() != "wired_to" && edge.kind.as_ref() != "feedback" {
            continue;
        }

        let wire_id = edge
            .name
            .as_ref()
            .map(|n| n.to_string())
            .unwrap_or_else(|| format!("{}→{}", edge.src, edge.tgt));

        // Map port IDs to component IDs for React Flow.
        let src_comp = port_owners
            .get(&edge.src)
            .map(|n| n.to_string())
            .unwrap_or_else(|| edge.src.to_string());
        let tgt_comp = port_owners
            .get(&edge.tgt)
            .map(|n| n.to_string())
            .unwrap_or_else(|| edge.tgt.to_string());

        // Wire optic = the source component's computed optic if available,
        // otherwise fall back to the wire vertex's stored constraint.
        let optic = computed_optics
            .and_then(|m| m.get(&src_comp).cloned())
            .or_else(|| {
                edge.name
                    .as_ref()
                    .and_then(|n| find_constraint(circuit, n, "optic_kind"))
            })
            .unwrap_or_else(|| "lens".into());

        let complement_info = compute_complement_info(circuit, &port_owners, &edge.src, &optic);

        edges.push(GraphEdge {
            id: wire_id,
            source: src_comp,
            target: tgt_comp,
            source_handle: edge.src.to_string(),
            target_handle: edge.tgt.to_string(),
            optic_kind: optic,
            is_feedback: edge.kind.as_ref() == "feedback",
            complement_info,
        });
    }

    CircuitGraph { nodes, edges }
}

/// Determine the optic kind for a component based on its outgoing wire.
fn component_optic(
    circuit: &panproto_schema::Schema,
    comp_id: &panproto_gat::Name,
    port_owners: &std::collections::HashMap<panproto_gat::Name, panproto_gat::Name>,
) -> String {
    // Find outgoing wires from this component's output ports.
    for edge in circuit.edges.keys() {
        if edge.kind.as_ref() != "wired_to" {
            continue;
        }
        if let Some(owner) = port_owners.get(&edge.src)
            && owner == comp_id
            && let Some(wire_name) = &edge.name
            && let Some(ok) = find_constraint(circuit, wire_name, "optic_kind")
        {
            return ok;
        }
    }

    // Default based on component type.
    let comp_type = find_constraint(circuit, comp_id, "component_type").unwrap_or_default();
    // These defaults must mirror the palette in app/src/store/circuitStore.ts.
    // If a source schema is available, the UI uses the chain-classified optic
    // from `compute_per_component_optics` instead of this fallback.
    match comp_type.as_str() {
        "rename_field" => "iso".into(),
        "map_items" => "traversal".into(),
        _ => "lens".into(),
    }
}

/// Compute a human-readable description of what the complement captures
/// for a wire coming out of a given source port's component.
fn compute_complement_info(
    circuit: &panproto_schema::Schema,
    port_owners: &std::collections::HashMap<panproto_gat::Name, panproto_gat::Name>,
    src_port: &panproto_gat::Name,
    optic_kind: &str,
) -> String {
    let comp_id = match port_owners.get(src_port) {
        Some(id) => id,
        None => return String::new(),
    };

    let comp_type = find_constraint(circuit, comp_id, "component_type").unwrap_or_default();

    match (comp_type.as_str(), optic_kind) {
        ("rename_field", "iso") => {
            let old = find_param(circuit, comp_id, "old_name").unwrap_or_default();
            let new = find_param(circuit, comp_id, "new_name").unwrap_or_default();
            format!(
                "Isomorphism: renames \"{old}\" → \"{new}\". No data lost. \
                 The backward pass reverses the rename. Complement is empty."
            )
        }
        ("add_field", _) => {
            let name = find_param(circuit, comp_id, "field_name").unwrap_or_default();
            let kind = find_param(circuit, comp_id, "field_kind").unwrap_or("string".into());
            let default = find_param(circuit, comp_id, "default").unwrap_or("\"\"".into());
            format!(
                "Adds field \"{name}\" (type: {kind}, default: {default}). \
                 Complement records that this field was added with a default, \
                 so the backward pass can remove it. The default value itself \
                 is lost in the backward direction."
            )
        }
        ("drop_field", _) => {
            let name = find_param(circuit, comp_id, "field_name").unwrap_or_default();
            format!(
                "Drops field \"{name}\". The complement captures the dropped \
                 field's value so the backward pass can restore it. Without \
                 the complement, the original value of \"{name}\" is lost."
            )
        }
        ("hoist_field", _) => {
            let intermediate = find_param(circuit, comp_id, "intermediate").unwrap_or_default();
            format!(
                "Hoists a nested field up, collapsing \"{intermediate}\". \
                 The complement captures the intermediate vertex and any \
                 sibling fields that were also nested under it."
            )
        }
        ("nest_field", _) => {
            let wrapper = find_param(circuit, comp_id, "wrapper").unwrap_or_default();
            format!(
                "Nests a field under a new wrapper \"{wrapper}\". \
                 The complement records the original direct edge so the \
                 backward pass can unwrap it."
            )
        }
        ("coerce_type", _) => {
            let field = find_param(circuit, comp_id, "field").unwrap_or_default();
            let expr = find_param(circuit, comp_id, "expr").unwrap_or_default();
            format!(
                "Coerces field \"{field}\" via expression: {expr}. \
                 If the coercion is not invertible, the original value \
                 is stored in the complement."
            )
        }
        ("map_items", _) => {
            let focus = find_param(circuit, comp_id, "focus").unwrap_or_default();
            format!(
                "Traversal: applies inner transform to each element of \
                 array \"{focus}\". The complement tracks per-element state — \
                 one complement entry per array element."
            )
        }
        ("apply_expr", _) => {
            let field = find_param(circuit, comp_id, "field").unwrap_or_default();
            let expr = find_param(circuit, comp_id, "expr").unwrap_or_default();
            format!(
                "Applies expression \"{expr}\" to field \"{field}\". \
                 The original value is stored in the complement unless \
                 the expression is invertible."
            )
        }
        ("compute_field", _) => {
            let target = find_param(circuit, comp_id, "target").unwrap_or_default();
            let expr = find_param(circuit, comp_id, "expr").unwrap_or_default();
            format!(
                "Computes new field \"{target}\" from expression: {expr}. \
                 The complement records that this field was computed, so \
                 the backward pass can remove it."
            )
        }
        (_, "iso") => "No data lost. Fully reversible.".into(),
        (_, "lens") => "Complement stores data needed for backward restoration.".into(),
        (_, "prism") => "Conditional — transform may not apply to all inputs.".into(),
        (_, "affine") => "Partial projection — combines lens and prism properties.".into(),
        (_, "traversal") => "Multi-focus — complement tracks per-element state.".into(),
        _ => String::new(),
    }
}

fn find_param(
    circuit: &panproto_schema::Schema,
    comp_id: &panproto_gat::Name,
    key: &str,
) -> Option<String> {
    find_constraint(circuit, comp_id, &format!("param:{key}"))
}

fn find_constraint(
    circuit: &panproto_schema::Schema,
    vertex: &panproto_gat::Name,
    sort: &str,
) -> Option<String> {
    circuit
        .constraints
        .get(vertex)?
        .iter()
        .find(|c| c.sort.as_ref() == sort)
        .map(|c| c.value.clone())
}

// ═══════════════════════════════════════════════════════════════════════
// Tests for private helpers
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
#[allow(clippy::type_complexity)]
mod tests {
    use super::*;
    use protolab_schema::{CircuitBuilder, Direction, TriggerMode};
    use std::collections::HashMap;

    /// Minimal source schema: a `root` vertex with one `tags` array and
    /// one `name` string, so every component type has something to
    /// reference during optic classification.
    fn mini_schema() -> panproto_schema::Schema {
        use panproto_gat::Name;
        use panproto_schema::{Edge, Schema, Vertex};
        use smallvec::SmallVec;

        let mut vertices: HashMap<Name, Vertex> = HashMap::new();
        let mut edges: HashMap<Edge, Name> = HashMap::new();
        let mut outgoing: HashMap<Name, SmallVec<Edge, 4>> = HashMap::new();
        let mut incoming: HashMap<Name, SmallVec<Edge, 4>> = HashMap::new();
        let mut between: HashMap<(Name, Name), SmallVec<Edge, 2>> = HashMap::new();

        vertices.insert(
            Name::from("root"),
            Vertex {
                id: "root".into(),
                kind: "object".into(),
                nsid: None,
            },
        );
        for (f, k) in &[("name", "string"), ("tags", "array")] {
            let id = format!("root.{f}");
            let v = Name::from(id.as_str());
            vertices.insert(
                v.clone(),
                Vertex {
                    id: id.clone().into(),
                    kind: (*k).into(),
                    nsid: None,
                },
            );
            let e = Edge {
                src: Name::from("root"),
                tgt: v.clone(),
                kind: "prop".into(),
                name: Some(Name::from(*f)),
            };
            outgoing
                .entry(Name::from("root"))
                .or_default()
                .push(e.clone());
            incoming.entry(v.clone()).or_default().push(e.clone());
            between
                .entry((Name::from("root"), v))
                .or_default()
                .push(e.clone());
            edges.insert(e, Name::from("prop"));
        }

        Schema {
            protocol: "mini".into(),
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
            entries: vec![Name::from("root")],
            outgoing,
            incoming,
            between,
        }
    }

    fn one_component_circuit(comp_type: &str, params: &[(&str, &str)]) -> panproto_schema::Schema {
        let mut b = CircuitBuilder::new()
            .add_component("c", comp_type)
            .unwrap()
            .add_port("c.in", "c", Direction::Input, TriggerMode::Hot)
            .unwrap()
            .add_port("c.out", "c", Direction::Output, TriggerMode::Hot)
            .unwrap()
            .add_port("c.param", "c", Direction::Parameter, TriggerMode::Cold)
            .unwrap();
        for (k, v) in params {
            b = b.set_param("c", k, v);
        }
        b.build()
    }

    #[test]
    fn compute_per_component_optics_classifies_every_component() {
        // Each entry: (comp_type, params, expected optic label as rendered
        // in the UI palette).
        let cases: &[(&str, Vec<(&str, &str)>, &str)] = &[
            (
                "rename_field",
                vec![("old_name", "name"), ("new_name", "displayName")],
                "iso",
            ),
            (
                "add_field",
                vec![
                    ("field_name", "bio"),
                    ("field_kind", "string"),
                    ("default", ""),
                ],
                "lens",
            ),
            ("drop_field", vec![("field_name", "name")], "lens"),
            (
                // map_items is pinned to traversal in the UI path regardless
                // of the underlying ScopedTransform's default classification.
                "map_items",
                vec![("focus", "tags")],
                "traversal",
            ),
            // Expression components: forward map is information-preserving
            // (Retraction) but not invertible — classified as Lens by the
            // CoercionClass → OpticKind mapping in
            // `component_intrinsic_optic_kind`.
            (
                "coerce_type",
                vec![("field", "name"), ("expr", "upper(x)")],
                "lens",
            ),
            (
                "apply_expr",
                vec![("field", "name"), ("expr", "upper(x)")],
                "lens",
            ),
            // compute_field with no inverse → Projection → Lens.
            (
                "compute_field",
                vec![("target", "slug"), ("expr", "lower(name)")],
                "lens",
            ),
            // Same components with an `inverse` provided → Iso (round-trip
            // succeeds via the explicit inverse expression).
            (
                "apply_expr",
                vec![
                    ("field", "name"),
                    ("expr", "upper(x)"),
                    ("inverse", "lower(x)"),
                ],
                "iso",
            ),
            (
                "coerce_type",
                vec![
                    ("field", "name"),
                    ("expr", "upper(x)"),
                    ("inverse", "lower(x)"),
                ],
                "iso",
            ),
        ];

        let source = mini_schema();
        for (ty, params, expected) in cases {
            let circuit = one_component_circuit(ty, params);
            let optics = compute_per_component_optics(&circuit, &source).unwrap();
            assert_eq!(
                optics.get("c").map(String::as_str),
                Some(*expected),
                "compute_per_component_optics[{ty}] should be {expected}"
            );
        }
    }

    #[test]
    fn component_optic_fallback_labels_match_palette() {
        // The schema-less fallback used when no source schema has been
        // assigned. Pins the subset that the palette hardcodes.
        use panproto_gat::Name;
        let port_owners = HashMap::new();

        let cases: &[(&str, &str)] = &[
            ("rename_field", "iso"),
            ("map_items", "traversal"),
            ("add_field", "lens"),
            ("drop_field", "lens"),
            ("coerce_type", "lens"),
            ("unknown_type", "lens"),
        ];
        for (ty, expected) in cases {
            let circuit = one_component_circuit(ty, &[]);
            let optic = component_optic(&circuit, &Name::from("c"), &port_owners);
            assert_eq!(&optic, expected, "component_optic fallback for {ty}");
        }
    }

    #[test]
    fn lookup_panproto_protocol_finds_registered_protocols() {
        // Every protocol name we hardcoded in `lookup_panproto_protocol`
        // must actually resolve (catches panproto API drift).
        let names = [
            "avro", "cddl", "openapi", "mongodb", "atproto", "parquet", "geojson", "k8s_crd",
        ];
        for name in names {
            assert!(
                lookup_panproto_protocol(name).is_some(),
                "lookup_panproto_protocol({name:?}) should resolve to a built-in"
            );
        }
    }

    #[test]
    fn lookup_panproto_protocol_is_case_insensitive() {
        assert!(lookup_panproto_protocol("MongoDB").is_some());
        assert!(lookup_panproto_protocol("ATProto").is_some());
        assert!(lookup_panproto_protocol("OpenAPI").is_some());
    }

    #[test]
    fn lookup_panproto_protocol_returns_none_for_unknown() {
        assert!(lookup_panproto_protocol("user-demo").is_none());
        assert!(lookup_panproto_protocol("totally-made-up").is_none());
    }

    #[test]
    fn panproto_protocols_default_uses_registry_when_available() {
        // For a schema whose protocol field matches a built-in, the
        // returned Protocol should carry that protocol's name (not a
        // synthetic fallback).
        let mut schema = build_user_schema();
        schema.protocol = "mongodb".into();
        let p = panproto_protocols_default(&schema);
        assert_eq!(&*p.name, "mongodb");
        // MongoDB declares non-empty obj_kinds; the synthetic fallback
        // leaves them empty, so this confirms we got the real protocol.
        assert!(
            !p.obj_kinds.is_empty(),
            "mongodb protocol should carry obj_kinds"
        );
    }

    #[test]
    fn panproto_protocols_default_falls_back_for_user_demo() {
        // The demo schema uses protocol name "user-demo" which isn't in
        // the registry — we should get a synthetic ThWType default.
        slab::clear_user_protocols();
        let schema = build_user_schema();
        let p = panproto_protocols_default(&schema);
        assert_eq!(&*p.name, "user-demo");
        assert_eq!(&*p.schema_theory, "ThWType");
        assert!(p.obj_kinds.is_empty());
    }

    // ── User-protocol registry ──────────────────────────────────────

    fn sample_protocol_json(name: &str, has_recursion: bool) -> String {
        serde_json::to_string(&panproto_schema::Protocol {
            name: name.into(),
            schema_theory: "ThCustom".into(),
            instance_theory: "ThCustom".into(),
            obj_kinds: vec!["widget".into(), "gadget".into()],
            constraint_sorts: vec!["required".into()],
            has_recursion,
            ..panproto_schema::Protocol::default()
        })
        .unwrap()
    }

    #[test]
    fn import_protocol_json_registers_a_new_protocol() {
        slab::clear_user_protocols();
        let bytes = import_protocol_json_inner(&sample_protocol_json("my-corp-api", true)).unwrap();
        // Summary round-trips via msgpack → JSON-ish inspection.
        assert!(!bytes.is_empty());
        // Registry lookup finds it.
        let p = slab::find_user_protocol("my-corp-api").expect("user protocol registered");
        assert_eq!(&*p.name, "my-corp-api");
        assert!(p.has_recursion);
        assert_eq!(p.obj_kinds.len(), 2);
    }

    #[test]
    fn import_protocol_json_rejects_empty_name() {
        slab::clear_user_protocols();
        let bad = serde_json::json!({
            "name": "",
            "schema_theory": "X",
            "instance_theory": "X"
        })
        .to_string();
        let result = import_protocol_json_inner(&bad);
        assert!(result.is_err(), "empty name must be rejected");
    }

    #[test]
    fn import_protocol_json_rejects_malformed_json() {
        slab::clear_user_protocols();
        let result = import_protocol_json_inner("{ not valid json");
        assert!(result.is_err());
    }

    #[test]
    fn user_registry_takes_precedence_over_builtins() {
        // Override the built-in `mongodb` protocol with a user-defined
        // one that has distinctive obj_kinds, then verify
        // `panproto_protocols_default` returns the user version.
        slab::clear_user_protocols();
        let custom_json = serde_json::to_string(&panproto_schema::Protocol {
            name: "mongodb".into(),
            schema_theory: "ThMongoDBSchemaExtended".into(),
            instance_theory: "ThMongoDBInstance".into(),
            obj_kinds: vec!["my-custom-kind".into()],
            ..panproto_schema::Protocol::default()
        })
        .unwrap();
        import_protocol_json_inner(&custom_json).unwrap();

        let mut schema = build_user_schema();
        schema.protocol = "mongodb".into();
        let p = panproto_protocols_default(&schema);
        assert_eq!(&*p.schema_theory, "ThMongoDBSchemaExtended");
        assert_eq!(p.obj_kinds, vec!["my-custom-kind"]);

        // Cleanup so other tests don't see the override.
        slab::clear_user_protocols();
    }

    #[test]
    fn lookup_order_is_user_then_builtin_then_synthetic() {
        slab::clear_user_protocols();

        // 1. Built-in is chosen when no user override exists.
        let mut schema = build_user_schema();
        schema.protocol = "atproto".into();
        let builtin = panproto_protocols_default(&schema);
        assert_eq!(&*builtin.name, "atproto");
        assert!(!builtin.obj_kinds.is_empty());

        // 2. User override is chosen when both exist.
        let custom = serde_json::to_string(&panproto_schema::Protocol {
            name: "atproto".into(),
            schema_theory: "UserOverride".into(),
            instance_theory: "UserOverride".into(),
            ..panproto_schema::Protocol::default()
        })
        .unwrap();
        import_protocol_json_inner(&custom).unwrap();
        let overridden = panproto_protocols_default(&schema);
        assert_eq!(&*overridden.schema_theory, "UserOverride");

        // 3. Synthetic fallback when name is unknown.
        schema.protocol = "totally-made-up-v42".into();
        let synthetic = panproto_protocols_default(&schema);
        assert_eq!(&*synthetic.schema_theory, "ThWType");
        assert!(synthetic.obj_kinds.is_empty());

        slab::clear_user_protocols();
    }

    #[test]
    fn remove_user_protocol_returns_true_when_present() {
        slab::clear_user_protocols();
        import_protocol_json_inner(&sample_protocol_json("disposable", false)).unwrap();
        assert!(slab::find_user_protocol("disposable").is_some());

        let removed = slab::unregister_user_protocol("disposable");
        assert!(removed, "removing a registered protocol must return true");
        assert!(slab::find_user_protocol("disposable").is_none());

        // Removing again returns false.
        assert!(!slab::unregister_user_protocol("disposable"));
    }

    #[test]
    fn list_user_protocol_names_sorted() {
        slab::clear_user_protocols();
        import_protocol_json_inner(&sample_protocol_json("zebra", false)).unwrap();
        import_protocol_json_inner(&sample_protocol_json("alpha", false)).unwrap();
        import_protocol_json_inner(&sample_protocol_json("mike", false)).unwrap();
        let names = slab::list_user_protocol_names();
        assert_eq!(names, vec!["alpha", "mike", "zebra"]);
        slab::clear_user_protocols();
    }

    #[test]
    fn user_protocol_name_lookup_is_case_insensitive() {
        slab::clear_user_protocols();
        import_protocol_json_inner(&sample_protocol_json("MyCorpAPI", false)).unwrap();
        assert!(slab::find_user_protocol("mycorpapi").is_some());
        assert!(slab::find_user_protocol("MYCORPAPI").is_some());
        assert!(slab::find_user_protocol("MyCorpAPI").is_some());
        slab::clear_user_protocols();
    }

    #[test]
    fn get_user_protocol_json_round_trips() {
        slab::clear_user_protocols();
        let original_json = sample_protocol_json("round-trip", true);
        import_protocol_json_inner(&original_json).unwrap();

        let fetched = get_user_protocol_json("round-trip").unwrap();
        assert!(fetched != "null");
        let parsed: panproto_schema::Protocol = serde_json::from_str(&fetched).unwrap();
        assert_eq!(&*parsed.name, "round-trip");
        assert!(parsed.has_recursion);
        assert_eq!(parsed.obj_kinds.len(), 2);

        let missing = get_user_protocol_json("nope").unwrap();
        assert_eq!(missing, "null");

        slab::clear_user_protocols();
    }

    #[test]
    fn build_user_schema_root_is_user_not_an_arbitrary_field() {
        // The historical bug was `vertices.keys().next()` picking a random
        // field from the HashMap. Guard against its re-introduction.
        let schema = build_user_schema();
        let root = protolab_eval::find_root_vertex(&schema).unwrap();
        assert_eq!(
            root.as_ref(),
            "user",
            "build_user_schema root must be `user`"
        );
        // Also assert the schema has all three expected fields.
        assert!(
            schema
                .vertices
                .contains_key(&panproto_gat::Name::from("user.name"))
        );
        assert!(
            schema
                .vertices
                .contains_key(&panproto_gat::Name::from("user.legacyId"))
        );
        assert!(
            schema
                .vertices
                .contains_key(&panproto_gat::Name::from("user.email"))
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // Mutation API
    // ═══════════════════════════════════════════════════════════════════

    /// Helper: msgpack-encode a `ComponentSpec`-shaped value the way the
    /// JS bridge does. We mirror the field names from the (private)
    /// ComponentSpec struct.
    fn make_component_spec_json(
        id: &str,
        ty: &str,
        ports: &[(&str, &str, &str)],
        params: &[(&str, &str)],
    ) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "component_type": ty,
            "ports": ports.iter().map(|(pid, dir, trig)| serde_json::json!({
                "id": pid,
                "direction": dir,
                "trigger": trig,
            })).collect::<Vec<_>>(),
            "params": params.iter().map(|(k, v)| serde_json::json!({
                "key": k,
                "value": v,
            })).collect::<Vec<_>>(),
        })
    }

    fn make_wire_spec_json(wire_id: &str, src: &str, tgt: &str) -> serde_json::Value {
        serde_json::json!({
            "wire_id": wire_id,
            "src_port": src,
            "tgt_port": tgt,
            "optic_kind": "lens",
            "is_feedback": false,
        })
    }

    fn decode_graph(bytes: &[u8]) -> CircuitGraph {
        // Deserialize the wire format we just produced. We mirror the
        // private struct's field set with a local twin so the test stays
        // independent of any future renames.
        #[derive(Deserialize)]
        struct GraphRaw {
            nodes: Vec<NodeRaw>,
            edges: Vec<EdgeRaw>,
        }
        #[derive(Deserialize)]
        struct NodeRaw {
            id: String,
            #[serde(rename = "type")]
            node_type: String,
            label: String,
            component_type: String,
            optic_kind: String,
            ports: Vec<PortRaw>,
            params: Vec<ParamRaw>,
            position: PosRaw,
        }
        #[derive(Deserialize)]
        struct PortRaw {
            id: String,
            direction: String,
            trigger: String,
        }
        #[derive(Deserialize)]
        struct ParamRaw {
            key: String,
            value: String,
        }
        #[derive(Deserialize)]
        struct PosRaw {
            x: f64,
            y: f64,
        }
        #[derive(Deserialize)]
        struct EdgeRaw {
            id: String,
            source: String,
            target: String,
            source_handle: String,
            target_handle: String,
            optic_kind: String,
            is_feedback: bool,
            complement_info: String,
        }
        let raw: GraphRaw = rmp_serde::from_slice(bytes).expect("decode CircuitGraph msgpack");
        CircuitGraph {
            nodes: raw
                .nodes
                .into_iter()
                .map(|n| GraphNode {
                    id: n.id,
                    node_type: n.node_type,
                    label: n.label,
                    component_type: n.component_type,
                    optic_kind: n.optic_kind,
                    ports: n
                        .ports
                        .into_iter()
                        .map(|p| GraphPort {
                            id: p.id,
                            direction: p.direction,
                            trigger: p.trigger,
                        })
                        .collect(),
                    params: n
                        .params
                        .into_iter()
                        .map(|p| GraphParam {
                            key: p.key,
                            value: p.value,
                        })
                        .collect(),
                    position: Position {
                        x: n.position.x,
                        y: n.position.y,
                    },
                })
                .collect(),
            edges: raw
                .edges
                .into_iter()
                .map(|e| GraphEdge {
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    source_handle: e.source_handle,
                    target_handle: e.target_handle,
                    optic_kind: e.optic_kind,
                    is_feedback: e.is_feedback,
                    complement_info: e.complement_info,
                })
                .collect(),
        }
    }

    #[test]
    fn create_circuit_then_add_components_then_serialize_graph() {
        let h = create_circuit();

        // Component 1.
        let spec1 = make_component_spec_json(
            "rename1",
            "rename_field",
            &[
                ("rename1.in", "input", "hot"),
                ("rename1.out", "output", "hot"),
            ],
            &[("old_name", "name"), ("new_name", "displayName")],
        );
        add_component_to_circuit_inner(h, spec1.to_string().as_bytes()).unwrap();

        // Component 2.
        let spec2 = make_component_spec_json(
            "drop1",
            "drop_field",
            &[("drop1.in", "input", "hot"), ("drop1.out", "output", "hot")],
            &[("field_name", "legacyId")],
        );
        add_component_to_circuit_inner(h, spec2.to_string().as_bytes()).unwrap();

        // Wire them.
        let wire = make_wire_spec_json("w1", "rename1.out", "drop1.in");
        add_wire_to_circuit_inner(h, wire.to_string().as_bytes()).unwrap();

        let bytes = get_circuit_graph_inner(h).unwrap();
        let graph = decode_graph(&bytes);
        assert_eq!(graph.nodes.len(), 2, "expected two component nodes");
        assert_eq!(graph.edges.len(), 1, "expected one wire edge");
        assert!(graph.nodes.iter().any(|n| n.id == "rename1"));
        assert!(graph.nodes.iter().any(|n| n.id == "drop1"));

        free_handle(h);
    }

    #[test]
    fn add_component_with_msgpack_spec() {
        let h = create_circuit();
        let spec = make_component_spec_json(
            "c",
            "rename_field",
            &[("c.in", "input", "hot"), ("c.out", "output", "hot")],
            &[("old_name", "x"), ("new_name", "y")],
        );
        // Encode as msgpack rather than JSON to exercise the rmp path.
        let bytes = rmp_serde::to_vec_named(&spec).unwrap();
        add_component_to_circuit_inner(h, &bytes).unwrap();

        let graph_bytes = get_circuit_graph_inner(h).unwrap();
        let graph = decode_graph(&graph_bytes);
        assert!(graph.nodes.iter().any(|n| n.id == "c"));
        free_handle(h);
    }

    #[test]
    fn add_component_with_json_spec() {
        let h = create_circuit();
        let spec = make_component_spec_json(
            "c2",
            "drop_field",
            &[("c2.in", "input", "hot"), ("c2.out", "output", "hot")],
            &[("field_name", "secret")],
        );
        let bytes = spec.to_string().into_bytes();
        add_component_to_circuit_inner(h, &bytes).unwrap();
        let graph = decode_graph(&get_circuit_graph_inner(h).unwrap());
        assert!(graph.nodes.iter().any(|n| n.id == "c2"));
        free_handle(h);
    }

    #[test]
    fn remove_component_clears_wires_too() {
        let h = create_circuit();
        let s1 = make_component_spec_json(
            "a",
            "rename_field",
            &[("a.in", "input", "hot"), ("a.out", "output", "hot")],
            &[("old_name", "n"), ("new_name", "N")],
        );
        let s2 = make_component_spec_json(
            "b",
            "drop_field",
            &[("b.in", "input", "hot"), ("b.out", "output", "hot")],
            &[("field_name", "n")],
        );
        add_component_to_circuit_inner(h, s1.to_string().as_bytes()).unwrap();
        add_component_to_circuit_inner(h, s2.to_string().as_bytes()).unwrap();
        let w = make_wire_spec_json("w", "a.out", "b.in");
        add_wire_to_circuit_inner(h, w.to_string().as_bytes()).unwrap();
        // Verify wire is present.
        let g0 = decode_graph(&get_circuit_graph_inner(h).unwrap());
        assert_eq!(g0.edges.len(), 1);

        remove_component_from_circuit_inner(h, "a").unwrap();
        let g1 = decode_graph(&get_circuit_graph_inner(h).unwrap());
        assert!(
            !g1.nodes.iter().any(|n| n.id == "a"),
            "removed component must not appear"
        );
        assert!(
            g1.edges.iter().all(|e| e.source != "a"),
            "wires touching the removed component must be gone"
        );
        free_handle(h);
    }

    #[test]
    fn add_wire_creates_edge_in_graph() {
        let h = create_circuit();
        let s1 = make_component_spec_json("a", "rename_field", &[("a.out", "output", "hot")], &[]);
        let s2 = make_component_spec_json("b", "drop_field", &[("b.in", "input", "hot")], &[]);
        add_component_to_circuit_inner(h, s1.to_string().as_bytes()).unwrap();
        add_component_to_circuit_inner(h, s2.to_string().as_bytes()).unwrap();
        add_wire_to_circuit_inner(
            h,
            make_wire_spec_json("w", "a.out", "b.in")
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        let g = decode_graph(&get_circuit_graph_inner(h).unwrap());
        assert_eq!(g.edges.len(), 1);
        assert_eq!(g.edges[0].source, "a");
        assert_eq!(g.edges[0].target, "b");
        free_handle(h);
    }

    #[test]
    fn remove_wire_removes_edge_only_not_components() {
        let h = create_circuit();
        let s1 = make_component_spec_json("a", "rename_field", &[("a.out", "output", "hot")], &[]);
        let s2 = make_component_spec_json("b", "drop_field", &[("b.in", "input", "hot")], &[]);
        add_component_to_circuit_inner(h, s1.to_string().as_bytes()).unwrap();
        add_component_to_circuit_inner(h, s2.to_string().as_bytes()).unwrap();
        add_wire_to_circuit_inner(
            h,
            make_wire_spec_json("w", "a.out", "b.in")
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        remove_wire_from_circuit_inner(h, "w").unwrap();
        let g = decode_graph(&get_circuit_graph_inner(h).unwrap());
        assert_eq!(g.edges.len(), 0, "wire should be gone");
        assert_eq!(g.nodes.len(), 2, "components must remain");
        free_handle(h);
    }

    #[test]
    fn update_component_param_persists_in_subsequent_get() {
        let h = create_circuit();
        let s = make_component_spec_json(
            "c",
            "rename_field",
            &[("c.in", "input", "hot"), ("c.out", "output", "hot")],
            &[("old_name", "old"), ("new_name", "new")],
        );
        add_component_to_circuit_inner(h, s.to_string().as_bytes()).unwrap();
        update_component_param_inner(h, "c", "new_name", "freshName").unwrap();
        let g = decode_graph(&get_circuit_graph_inner(h).unwrap());
        let node = g.nodes.iter().find(|n| n.id == "c").unwrap();
        let p = node.params.iter().find(|p| p.key == "new_name").unwrap();
        assert_eq!(p.value, "freshName");
        free_handle(h);
    }

    #[test]
    fn topological_sort_inner_returns_components_in_dependency_order() {
        let h = create_circuit();
        // Build: a → b → c.
        for (id, ty) in &[
            ("a", "rename_field"),
            ("b", "add_field"),
            ("c", "drop_field"),
        ] {
            let spec = make_component_spec_json(
                id,
                ty,
                &[
                    (&format!("{id}.in"), "input", "hot"),
                    (&format!("{id}.out"), "output", "hot"),
                ],
                &[],
            );
            add_component_to_circuit_inner(h, spec.to_string().as_bytes()).unwrap();
        }
        add_wire_to_circuit_inner(
            h,
            make_wire_spec_json("w1", "a.out", "b.in")
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        add_wire_to_circuit_inner(
            h,
            make_wire_spec_json("w2", "b.out", "c.in")
                .to_string()
                .as_bytes(),
        )
        .unwrap();

        let bytes = topological_sort_inner(h).unwrap();
        let names: Vec<String> = rmp_serde::from_slice(&bytes).unwrap();
        let pa = names.iter().position(|n| n == "a").unwrap();
        let pb = names.iter().position(|n| n == "b").unwrap();
        let pc = names.iter().position(|n| n == "c").unwrap();
        assert!(pa < pb && pb < pc, "topo order: {names:?}");
        free_handle(h);
    }

    #[test]
    fn create_demo_circuit_inner_yields_three_components() {
        let bytes = create_demo_circuit_inner().unwrap();
        let g = decode_graph(&bytes);
        assert_eq!(g.nodes.len(), 3, "demo has rename + add + drop");
        let ids: Vec<&str> = g.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(ids.contains(&"rename"));
        assert!(ids.contains(&"add"));
        assert!(ids.contains(&"drop"));
    }

    #[test]
    fn create_demo_circuit_with_handle_inner_assigns_user_source_schema() {
        let bytes = create_demo_circuit_with_handle_inner().unwrap();
        // Decode just the handle + source_schema_handle fields.
        #[derive(Deserialize)]
        struct R {
            handle: u32,
            source_schema_handle: u32,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        // The reported handle for source schema should equal what
        // get_source_schema_inner returns.
        let assigned = get_source_schema_inner(r.handle).unwrap();
        assert_eq!(
            assigned, r.source_schema_handle as i32,
            "source schema must be auto-assigned"
        );
        free_handle(r.handle);
        free_handle(r.source_schema_handle);
    }

    #[test]
    fn add_component_with_unknown_type_does_not_panic() {
        let h = create_circuit();
        let spec = make_component_spec_json(
            "weird",
            "totally_unknown_component_type_xyz",
            &[("weird.in", "input", "hot")],
            &[],
        );
        // Should not panic; behavior is implementation-defined (the
        // mutator may swallow the error). We just need it to return
        // *some* graph and not crash.
        let _ = add_component_to_circuit_inner(h, spec.to_string().as_bytes());
        let _ = get_circuit_graph_inner(h);
        free_handle(h);
    }

    #[test]
    fn add_wire_with_unknown_ports_does_not_panic() {
        let h = create_circuit();
        let _ = add_wire_to_circuit_inner(
            h,
            make_wire_spec_json("ghost", "no.such.src", "no.such.tgt")
                .to_string()
                .as_bytes(),
        );
        let _ = get_circuit_graph_inner(h);
        free_handle(h);
    }

    #[test]
    fn remove_component_with_unknown_id_is_noop() {
        let h = create_circuit();
        let s = make_component_spec_json("a", "rename_field", &[("a.in", "input", "hot")], &[]);
        add_component_to_circuit_inner(h, s.to_string().as_bytes()).unwrap();
        // Removing a non-existent id should not error and should leave
        // 'a' in place.
        remove_component_from_circuit_inner(h, "ghost-id").unwrap();
        let g = decode_graph(&get_circuit_graph_inner(h).unwrap());
        assert!(g.nodes.iter().any(|n| n.id == "a"));
        free_handle(h);
    }

    #[test]
    fn update_param_on_unknown_component_is_noop() {
        let h = create_circuit();
        // No component named "ghost"; should not error.
        update_component_param_inner(h, "ghost", "k", "v").unwrap();
        free_handle(h);
    }

    #[test]
    fn free_handle_then_get_circuit_graph_errors() {
        let h = create_circuit();
        free_handle(h);
        let r = get_circuit_graph_inner(h);
        assert!(r.is_err(), "graph lookup on freed handle must error");
    }

    // ═══════════════════════════════════════════════════════════════════
    // Import / export
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn export_circuit_as_json_round_trips_via_import_lens_document() {
        // Use the demo circuit (which has at least 3 components).
        let bytes = create_demo_circuit_with_handle_inner().unwrap();
        #[derive(Deserialize)]
        struct R {
            handle: u32,
            source_schema_handle: u32,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();

        let json = export_circuit_as_lens_json_inner(r.handle).unwrap();
        #[derive(Deserialize)]
        struct Imported {
            handle: u32,
            dropped: Vec<String>,
        }
        let imported: Imported =
            rmp_serde::from_slice(&import_lens_document_inner(&json).unwrap()).unwrap();
        let g = decode_graph(&get_circuit_graph_inner(imported.handle).unwrap());
        assert_eq!(g.nodes.len(), 3, "round-trip must preserve component count");
        assert!(
            imported.dropped.is_empty(),
            "a document protolab exported carries only what protolab can \
             draw, so re-importing it must drop nothing; got {:?}",
            imported.dropped
        );

        free_handle(r.handle);
        free_handle(r.source_schema_handle);
        free_handle(imported.handle);
    }

    #[test]
    fn export_circuit_as_yaml_inner_contains_all_step_kinds_for_demo() {
        let bytes = create_demo_circuit_with_handle_inner().unwrap();
        #[derive(Deserialize)]
        struct R {
            handle: u32,
            source_schema_handle: u32,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();

        let yaml = export_circuit_as_yaml_inner(r.handle).unwrap();
        // The lens-yaml encoder uses `rename_field`, `add_field`, and
        // `remove_field` (not `drop_field`) for the three demo steps.
        assert!(yaml.contains("rename_field"), "yaml: {yaml}");
        assert!(yaml.contains("add_field"), "yaml: {yaml}");
        assert!(yaml.contains("remove_field"), "yaml: {yaml}");

        free_handle(r.handle);
        free_handle(r.source_schema_handle);
    }

    #[test]
    fn export_circuit_as_nickel_inner_starts_with_let_l() {
        let bytes = create_demo_circuit_with_handle_inner().unwrap();
        #[derive(Deserialize)]
        struct R {
            handle: u32,
            source_schema_handle: u32,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();

        let nickel = export_circuit_as_nickel_inner(r.handle).unwrap();
        // The Nickel encoder emits a `let L = ...` (or similar) preamble.
        let trimmed = nickel.trim_start();
        assert!(
            trimmed.starts_with("let L") || trimmed.starts_with("let l"),
            "nickel output should declare a top-level `let L`/`let l`: {nickel}"
        );

        free_handle(r.handle);
        free_handle(r.source_schema_handle);
    }

    #[test]
    fn import_lens_document_inner_rejects_malformed_json() {
        let r = import_lens_document_inner("{ not valid json");
        assert!(r.is_err());
    }

    #[test]
    fn import_schema_json_inner_round_trip() {
        // Build a schema, serialize it to JSON, re-import it, compare
        // vertex counts.
        let schema = build_user_schema();
        let json = serde_json::to_string(&schema).unwrap();
        let bytes = import_schema_json_inner(&json).unwrap();
        #[derive(Deserialize)]
        struct R {
            handle: u32,
            summary: SummaryMirror,
        }
        #[derive(Deserialize)]
        struct SummaryMirror {
            #[allow(dead_code)]
            protocol: String,
            vertex_count: usize,
            #[allow(dead_code)]
            edge_count: usize,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(r.summary.vertex_count, schema.vertices.len());
        free_handle(r.handle);
    }

    #[test]
    fn import_schema_json_inner_rejects_malformed_json() {
        assert!(import_schema_json_inner("not json at all").is_err());
    }

    /// Minimal theory document the panproto-theory-dsl can compile.
    /// The dsl requires a top-level `description` field.
    const MINIMAL_THEORY_JSON: &str = r#"{
        "id": "test",
        "description": "minimal test theory",
        "theory": "TestTheory",
        "sorts": [{"name": "X", "kind": {"type": "structural"}}],
        "ops": [],
        "equations": [],
        "directed_equations": []
    }"#;

    #[test]
    fn import_theory_json_inner_with_minimal_theory_doc() {
        let bytes = import_theory_json_inner(MINIMAL_THEORY_JSON).unwrap();
        #[derive(Deserialize)]
        struct Summary {
            handle: u32,
            #[allow(dead_code)]
            name: String,
            sort_count: usize,
            #[allow(dead_code)]
            op_count: usize,
        }
        let s: Summary = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(s.sort_count, 1);
        free_handle(s.handle);
    }

    #[test]
    fn import_theory_json_inner_rejects_malformed_json() {
        assert!(import_theory_json_inner("{ broken").is_err());
    }

    // ═══════════════════════════════════════════════════════════════════
    // Schema assignment + eval
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn set_source_schema_then_get_source_schema_returns_handle() {
        let circuit = create_circuit();
        let schema_h = slab::alloc(Resource::Schema(build_user_schema()));
        set_source_schema_inner(circuit, schema_h).unwrap();
        let got = get_source_schema_inner(circuit).unwrap();
        assert_eq!(got, schema_h as i32);
        free_handle(circuit);
        free_handle(schema_h);
    }

    #[test]
    fn get_source_schema_returns_negative_when_unset() {
        let circuit = create_circuit();
        assert_eq!(get_source_schema_inner(circuit).unwrap(), -1);
        free_handle(circuit);
    }

    /// Decoded eval result.
    #[derive(Deserialize)]
    struct EvalResult {
        output: String,
        wire_data: std::collections::HashMap<String, String>,
        #[allow(dead_code)]
        success: bool,
    }

    fn build_demo_with_input(input_json: &str) -> (u32, u32) {
        let bytes = create_demo_circuit_with_handle_inner().unwrap();
        #[derive(Deserialize)]
        struct R {
            handle: u32,
            source_schema_handle: u32,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        set_input_data_inner(r.handle, input_json).unwrap();
        (r.handle, r.source_schema_handle)
    }

    #[test]
    fn set_input_data_then_evaluate_circuit_inner_succeeds() {
        let (h, sh) = build_demo_with_input(r#"{"name":"Alice","legacyId":42}"#);
        let bytes = evaluate_circuit_inner(h).unwrap();
        let r: EvalResult = rmp_serde::from_slice(&bytes).unwrap();
        assert!(
            r.output.contains("displayName"),
            "output should rename name→displayName: {}",
            r.output
        );
        assert!(
            r.output.contains("bio"),
            "output should add bio field: {}",
            r.output
        );
        assert!(
            !r.output.contains("legacyId"),
            "output should drop legacyId: {}",
            r.output
        );
        assert!(
            !r.output.contains("\"name\""),
            "output should not contain raw name field: {}",
            r.output
        );
        free_handle(h);
        free_handle(sh);
    }

    #[test]
    fn evaluate_circuit_inner_errors_when_no_source_schema() {
        let h = create_circuit();
        let r = evaluate_circuit_inner(h);
        assert!(r.is_err());
        free_handle(h);
    }

    #[test]
    fn evaluate_circuit_inner_errors_when_no_input_data() {
        // Build the demo (which auto-assigns source schema) but skip
        // set_input_data.
        let bytes = create_demo_circuit_with_handle_inner().unwrap();
        #[derive(Deserialize)]
        struct R {
            handle: u32,
            source_schema_handle: u32,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        let res = evaluate_circuit_inner(r.handle);
        assert!(res.is_err(), "must error without input data");
        free_handle(r.handle);
        free_handle(r.source_schema_handle);
    }

    #[test]
    fn set_input_data_inner_rejects_malformed_json() {
        let bytes = create_demo_circuit_with_handle_inner().unwrap();
        #[derive(Deserialize)]
        struct R {
            handle: u32,
            source_schema_handle: u32,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        assert!(set_input_data_inner(r.handle, "{ not json").is_err());
        free_handle(r.handle);
        free_handle(r.source_schema_handle);
    }

    #[test]
    fn set_input_data_inner_errors_when_no_source_schema_assigned() {
        let h = create_circuit();
        let r = set_input_data_inner(h, r#"{"x":1}"#);
        assert!(r.is_err());
        free_handle(h);
    }

    #[test]
    fn get_wire_data_inner_returns_each_components_intermediate_state() {
        let (h, sh) = build_demo_with_input(r#"{"name":"Bob","legacyId":7}"#);
        let bytes = evaluate_circuit_inner(h).unwrap();
        let r: EvalResult = rmp_serde::from_slice(&bytes).unwrap();
        // For each known wire id in the eval result, fetch via get_wire_data_inner.
        for wid in r.wire_data.keys() {
            let got = get_wire_data_inner(h, wid).unwrap();
            assert!(!got.is_empty(), "wire {wid} should have data");
        }
        // Unknown wire returns empty string.
        let unknown = get_wire_data_inner(h, "no-such-wire").unwrap();
        assert_eq!(unknown, "");
        free_handle(h);
        free_handle(sh);
    }

    #[test]
    fn apply_modified_output_inner_round_trips_unmodified_output() {
        let (h, sh) = build_demo_with_input(r#"{"name":"Carol","legacyId":99}"#);
        let bytes = evaluate_circuit_inner(h).unwrap();
        let r: EvalResult = rmp_serde::from_slice(&bytes).unwrap();
        // Apply the unmodified output back.
        let restored = apply_modified_output_inner(h, &r.output);
        // The lens chain may or may not produce a clean round-trip
        // depending on the demo's optic kinds. We accept either Ok with
        // a non-panicking string, or an Err — what we test is "no panic"
        // and that *if* it succeeds the JSON is well-formed.
        if let Ok(j) = restored {
            // Either empty (lens couldn't reconstruct) or a JSON object.
            if !j.is_empty() {
                assert!(
                    serde_json::from_str::<serde_json::Value>(&j).is_ok(),
                    "restored input should be valid JSON: {j}"
                );
            }
        }
        free_handle(h);
        free_handle(sh);
    }

    #[test]
    fn apply_modified_output_inner_propagates_a_user_edit() {
        // Use 4-field input (matching the default demo data) so we
        // exercise pass-through fields (email, joinedAt) that revealed
        // the scrambling in panproto#40.
        let (h, sh) = build_demo_with_input(
            r#"{"name":"Dave","legacyId":1,"email":"d@e.com","joinedAt":"2025-01-01"}"#,
        );
        let bytes = evaluate_circuit_inner(h).unwrap();
        let r: EvalResult = rmp_serde::from_slice(&bytes).unwrap();
        // Forward output should have displayName = "Dave" (rename).
        assert!(
            r.output.contains("Dave"),
            "forward output missing Dave: {}",
            r.output,
        );
        // Edit the output: replace "Dave" with "EDITED".
        let edited = r.output.replace("Dave", "EDITED");
        let restored =
            apply_modified_output_inner(h, &edited).expect("apply_modified_output must succeed");
        // The put must propagate the edit: input.name should be
        // "EDITED" (the rename_field step's put reverses displayName
        // → name). If name is something ELSE (email, legacyId),
        // the put scrambled fields — this is the regression in
        // panproto#40.
        assert!(
            restored.contains("EDITED"),
            "put did not propagate the edit to input.name.\n\
             Output sent to put:   {edited}\n\
             Restored source:      {restored}",
        );
        free_handle(h);
        free_handle(sh);
    }

    #[test]
    fn bang_component_inner_returns_per_component_wire_data() {
        let (h, sh) = build_demo_with_input(r#"{"name":"Eve","legacyId":12}"#);
        let json = bang_component_inner(h, "rename").unwrap();
        // After the rename component, the field should be displayName.
        assert!(
            json.contains("displayName"),
            "bang(rename) should contain displayName: {json}"
        );
        free_handle(h);
        free_handle(sh);
    }

    #[test]
    fn bang_component_inner_errors_for_unknown_component() {
        let (h, sh) = build_demo_with_input(r#"{"name":"Eve","legacyId":12}"#);
        let r = bang_component_inner(h, "ghost-component");
        assert!(r.is_err());
        free_handle(h);
        free_handle(sh);
    }

    #[test]
    fn bang_component_inner_errors_when_no_source_schema() {
        let h = create_circuit();
        let r = bang_component_inner(h, "anything");
        assert!(r.is_err());
        free_handle(h);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Theory + expression
    // ═══════════════════════════════════════════════════════════════════

    #[test]
    fn compile_theory_bundle_inner_compiles_minimal_theory() {
        let bytes = compile_theory_bundle_inner(MINIMAL_THEORY_JSON).unwrap();
        #[derive(Deserialize)]
        struct R {
            #[allow(dead_code)]
            id: String,
            theories: Vec<(String, u32)>,
            #[allow(dead_code)]
            protocols: Vec<(String, u32)>,
            #[allow(dead_code)]
            morphisms: Vec<(String, u32)>,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        assert!(!r.theories.is_empty(), "minimal doc must yield ≥1 theory");
        for (_, h) in r.theories {
            free_handle(h);
        }
    }

    #[test]
    fn compile_theory_bundle_inner_rejects_malformed_json() {
        assert!(compile_theory_bundle_inner("{ broken").is_err());
    }

    #[test]
    fn list_builtin_theories_inner_returns_nonempty_list() {
        let bytes = list_builtin_theories_inner().unwrap();
        let names: Vec<String> = rmp_serde::from_slice(&bytes).unwrap();
        assert!(!names.is_empty());
        // The first one is ThGraph in our list — but we just sanity-check
        // that one of the well-known builtins is present.
        assert!(names.iter().any(|n| n == "ThGraph"));
    }

    #[test]
    fn get_theory_details_inner_returns_sort_and_op_counts() {
        let cb = compile_theory_bundle_inner(MINIMAL_THEORY_JSON).unwrap();
        #[derive(Deserialize)]
        struct R {
            theories: Vec<(String, u32)>,
        }
        let r: R = rmp_serde::from_slice(&cb).unwrap();
        let (_, theory_h) = r.theories.into_iter().next().unwrap();
        let bytes = get_theory_details_inner(theory_h).unwrap();
        #[derive(Deserialize)]
        struct D {
            #[allow(dead_code)]
            name: String,
            sorts: Vec<String>,
            ops: Vec<String>,
            #[allow(dead_code)]
            equation_count: usize,
        }
        let d: D = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(d.sorts.len(), 1, "minimal theory has 1 sort");
        assert_eq!(d.ops.len(), 0, "minimal theory has 0 ops");
        free_handle(theory_h);
    }

    #[test]
    fn compose_theories_via_colimit_inner_smoke() {
        // Build two minimal theories that share sort "X".
        let t1_json = r#"{
            "id": "t1",
            "description": "first test theory",
            "theory": "T1",
            "sorts": [{"name": "X", "kind": {"type": "structural"}}],
            "ops": [],
            "equations": [],
            "directed_equations": []
        }"#;
        let t2_json = r#"{
            "id": "t2",
            "description": "second test theory",
            "theory": "T2",
            "sorts": [{"name": "X", "kind": {"type": "structural"}}],
            "ops": [],
            "equations": [],
            "directed_equations": []
        }"#;

        let b1 = compile_theory_bundle_inner(t1_json).unwrap();
        let b2 = compile_theory_bundle_inner(t2_json).unwrap();
        #[derive(Deserialize)]
        struct R {
            theories: Vec<(String, u32)>,
        }
        let r1: R = rmp_serde::from_slice(&b1).unwrap();
        let r2: R = rmp_serde::from_slice(&b2).unwrap();
        let (_, h1) = r1.theories.into_iter().next().unwrap();
        let (_, h2) = r2.theories.into_iter().next().unwrap();

        let composed_h = compose_theories_via_colimit_inner(h1, h2, r#"["X"]"#).unwrap();
        // Composed theory should have at least the shared sort.
        let det = get_theory_details_inner(composed_h).unwrap();
        #[derive(Deserialize)]
        struct D {
            sorts: Vec<String>,
        }
        let d: D = rmp_serde::from_slice(&det).unwrap();
        assert!(!d.sorts.is_empty());

        free_handle(h1);
        free_handle(h2);
        free_handle(composed_h);
    }

    #[test]
    fn parse_expression_inner_succeeds_for_well_formed() {
        let bytes = parse_expression_inner("add 1 2").unwrap();
        #[derive(Deserialize)]
        struct R {
            ok: bool,
            #[allow(dead_code)]
            error: Option<String>,
            #[allow(dead_code)]
            line: Option<usize>,
            #[allow(dead_code)]
            column: Option<usize>,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        assert!(r.ok, "well-formed source should parse: {:?}", r.error);
    }

    #[test]
    fn parse_expression_inner_returns_error_payload_for_malformed() {
        let bytes = parse_expression_inner("(((").unwrap();
        #[derive(Deserialize)]
        struct R {
            ok: bool,
            error: Option<String>,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        assert!(!r.ok, "malformed source must report ok=false");
        assert!(r.error.is_some());
    }

    #[test]
    fn evaluate_expression_inner_evaluates_arithmetic() {
        let result = evaluate_expression_inner("add 1 2", "{}").unwrap();
        assert_eq!(result.trim(), "3");
    }

    #[test]
    fn evaluate_expression_inner_evaluates_with_env() {
        let result = evaluate_expression_inner("upper name", r#"{"name":"alice"}"#).unwrap();
        assert_eq!(result.trim(), "\"ALICE\"");
    }

    #[test]
    fn evaluate_expression_inner_returns_error_for_malformed_source() {
        assert!(evaluate_expression_inner("(((", "{}").is_err());
    }

    #[test]
    fn auto_generate_candidates_with_identical_source_and_target_terminates_quickly() {
        // Regression: assigning target = source previously caused the
        // store-driven UI flow to hang. The identity short-circuit in
        // `auto_generate_candidates_inner` must return in bounded
        // time with a 100%-quality identity candidate.
        let (_h, sh) = build_demo_with_input("{}");
        let opts = r#"{"stringency":"balanced","top_n":3}"#;
        let started = std::time::Instant::now();
        let bytes = auto_generate_candidates_inner(sh, sh, opts)
            .expect("self-mapping should produce the identity candidate");
        let elapsed = started.elapsed();
        assert!(
            elapsed.as_secs() < 5,
            "self-mapping took {elapsed:?} (>5s suggests a hang)"
        );
        #[derive(Deserialize)]
        struct R {
            candidates: Vec<C>,
        }
        #[derive(Deserialize)]
        struct C {
            quality: f64,
        }
        let r: R = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(
            r.candidates.len(),
            1,
            "identity emits exactly one candidate"
        );
        assert_eq!(r.candidates[0].quality, 1.0);
    }

    #[test]
    fn auto_generate_candidates_with_atproto_self_mapping_terminates_quickly() {
        // Exercises the exact path that hung in Playwright: import a
        // real atproto lexicon, then map it to itself via the
        // candidates API.
        use std::time::Instant;
        let post = include_str!("../../../app/e2e/fixtures/lexicons/app.bsky.feed.post.json");
        let envelope: serde_json::Value = serde_json::from_str(post).unwrap();
        let payload = if envelope
            .get("schema")
            .and_then(|s| s.get("lexicon"))
            .is_some()
        {
            envelope["schema"].to_string()
        } else {
            envelope.to_string()
        };

        let import_bytes = parse_atproto_lexicon_inner(&payload).unwrap();
        #[derive(Deserialize)]
        struct Imp {
            handle: u32,
        }
        let imp: Imp = rmp_serde::from_slice(&import_bytes).unwrap();
        let opts = r#"{"stringency":"balanced","top_n":3}"#;
        let started = Instant::now();
        let result = auto_generate_candidates_inner(imp.handle, imp.handle, opts);
        let elapsed = started.elapsed();
        assert!(
            elapsed.as_secs() < 5,
            "atproto self-mapping took {elapsed:?} (>5s suggests a hang)"
        );
        result.expect("self-mapping must succeed");
    }

    #[test]
    fn auto_generate_candidates_with_hint_anchors_terminates_quickly() {
        // Hinted variant of the self-mapping terminator. The anchor
        // map lives on the opts JSON now (candidates API), replacing
        // the old `auto_generate_with_hints_and_store`.
        let (_h, sh) = build_demo_with_input("{}");
        let opts = r#"{"stringency":"balanced","top_n":3,"anchors":{"root":"root"}}"#;
        let started = std::time::Instant::now();
        let result = auto_generate_candidates_inner(sh, sh, opts);
        let elapsed = started.elapsed();
        assert!(
            elapsed.as_secs() < 5,
            "hinted self-mapping took {elapsed:?} (>5s suggests a hang)"
        );
        // Result may be Err if the anchor doesn't match an actual
        // vertex name in the demo's source — that's OK; the contract
        // here is "doesn't hang", not "always succeeds".
        let _ = result;
    }

    #[test]
    fn list_expr_builtins_inner_returns_at_least_thirty_builtins() {
        let bytes = list_expr_builtins_inner().unwrap();
        #[derive(Deserialize)]
        struct B {
            #[allow(dead_code)]
            name: String,
            #[allow(dead_code)]
            category: String,
            #[allow(dead_code)]
            signature: String,
        }
        let b: Vec<B> = rmp_serde::from_slice(&bytes).unwrap();
        assert!(b.len() >= 30, "expected ≥30 builtins, got {}", b.len());
    }

    // ── Span search ─────────────────────────────────────────────────

    fn alloc_schema(schema: &panproto_schema::Schema) -> u32 {
        let json = serde_json::to_string(schema).unwrap();
        #[derive(Deserialize)]
        struct R {
            handle: u32,
        }
        let bytes = import_schema_json_inner(&json).unwrap();
        rmp_serde::from_slice::<R>(&bytes).unwrap().handle
    }

    fn span_of(src: &panproto_schema::Schema, tgt: &panproto_schema::Schema) -> SpanReportMirror {
        let (a, b) = (alloc_schema(src), alloc_schema(tgt));
        let bytes = schema_span_inner(a, b).unwrap();
        free_handle(a);
        free_handle(b);
        rmp_serde::from_slice(&bytes).unwrap()
    }

    #[derive(Deserialize)]
    struct SpanPairMirror {
        src: String,
        tgt: String,
    }

    #[derive(Deserialize)]
    struct SpanReportMirror {
        pairs: Vec<SpanPairMirror>,
        apex_coverage: f64,
        apex_vertex_count: usize,
        source_vertex_count: usize,
        is_total: bool,
        #[allow(dead_code)]
        proven_optimal: bool,
    }

    #[test]
    fn a_schema_against_itself_spans_totally() {
        // The identity is the degenerate span. Getting anything less here
        // would mean the search cannot see an exact correspondence.
        let s = build_user_schema();
        let report = span_of(&s, &s);
        assert!(report.is_total, "a schema must span itself totally");
        assert!(
            (report.apex_coverage - 1.0).abs() < 1e-9,
            "coverage must be 1; got {}",
            report.apex_coverage
        );
        assert_eq!(report.apex_vertex_count, report.source_vertex_count);
        assert!(!report.pairs.is_empty());
    }

    #[test]
    fn every_reported_pair_names_a_source_and_a_target() {
        let s = build_user_schema();
        let report = span_of(&s, &s);
        for p in &report.pairs {
            assert!(
                !p.src.is_empty() && !p.tgt.is_empty(),
                "empty side in a pair"
            );
        }
    }

    #[test]
    fn pairs_come_back_in_a_stable_order() {
        // `apex.vertices` is a HashMap, so without an explicit sort the
        // panel these feed would reshuffle on every search.
        let s = build_user_schema();
        let first = span_of(&s, &s);
        let second = span_of(&s, &s);
        let key = |r: &SpanReportMirror| {
            r.pairs
                .iter()
                .map(|p| format!("{}>{}", p.src, p.tgt))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            key(&first),
            key(&second),
            "pair order must be deterministic"
        );
        // Field-wise by (src, tgt) — not by the formatted `src>tgt` string,
        // whose separator sorts differently from a field boundary.
        let ordered: Vec<(&str, &str)> = first
            .pairs
            .iter()
            .map(|p| (p.src.as_str(), p.tgt.as_str()))
            .collect();
        let mut expected = ordered.clone();
        expected.sort_unstable();
        assert_eq!(ordered, expected, "pairs must be sorted by (src, tgt)");
    }

    #[test]
    fn span_reports_rather_than_refuses_when_nothing_matches() {
        // The whole reason to run a span where the candidate search gave
        // up: it never refuses, so "they share nothing" is an answer with
        // a number attached rather than an error.
        let src = build_user_schema();
        let tgt = {
            use panproto_gat::Name;
            use panproto_schema::Vertex;
            // Start from a valid schema of the same protocol and replace its
            // contents, so every one of `Schema`'s fields is populated the
            // way the protocol expects rather than defaulted.
            let mut t = build_user_schema();
            t.vertices.clear();
            t.edges.clear();
            t.outgoing.clear();
            t.incoming.clear();
            t.between.clear();
            t.vertices.insert(
                Name::from("zzz_unrelated"),
                Vertex {
                    id: "zzz_unrelated".into(),
                    kind: "object".into(),
                    nsid: None,
                },
            );
            t.entries = vec![Name::from("zzz_unrelated")];
            t
        };
        let report = span_of(&src, &tgt);
        assert!(!report.is_total, "an unrelated target cannot span totally");
        assert!(
            report.apex_coverage < 1.0,
            "coverage must be below one; got {}",
            report.apex_coverage
        );
        assert!(report.source_vertex_count > 0);
    }
}
