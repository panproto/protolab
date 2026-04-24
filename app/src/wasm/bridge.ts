/**
 * WASM bridge: loads protolab-wasm and provides typed wrappers.
 * Data crosses the boundary as MessagePack bytes.
 */

import init, {
  create_demo_circuit_with_handle,
  create_circuit,
  add_component_to_circuit,
  add_wire_to_circuit,
  remove_component_from_circuit,
  remove_wire_from_circuit,
  update_component_param,
  get_circuit_graph,
  export_circuit_as_json,
  export_circuit_as_lens_json,
  export_circuit_as_yaml,
  export_circuit_as_nickel,
  import_lens_document,
  import_schema_json,
  import_theory_json,
  import_protocol_json,
  list_user_protocols,
  remove_user_protocol,
  get_user_protocol_json,
  bang_component,
  free_handle,
  set_source_schema,
  get_source_schema,
  set_input_data,
  evaluate_circuit,
  get_wire_data,
  apply_modified_output,
  compile_theory_bundle,
  compose_theories_via_colimit,
  list_builtin_theories,
  get_theory_details,
  parse_expression,
  evaluate_expression,
  list_expr_builtins,
  parse_atproto_lexicon as parse_atproto_lexicon_wasm,
  parse_native_schema as parse_native_schema_wasm,
  list_supported_protocols as list_supported_protocols_wasm,
  evaluate_auto_lens as evaluate_auto_lens_wasm,
  put_auto_lens as put_auto_lens_wasm,
  validate_data_against_schema as validate_data_against_schema_wasm,
  get_schema_details as get_schema_details_wasm,
  export_schema_json as export_schema_json_wasm,
  auto_generate_candidates as auto_generate_candidates_wasm,
  discover_anchors as discover_anchors_wasm,
  install_candidate_components as install_candidate_components_wasm,
  clear_circuit_components as clear_circuit_components_wasm,
  compute_schema_mapping as compute_schema_mapping_wasm,
} from "./pkg/protolab_wasm.js";
import { encode, decode } from "@msgpack/msgpack";

// ── Types ───────────────────────────────────────────────────────────

export interface CircuitGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  component_type: string;
  optic_kind: string;
  ports: GraphPort[];
  params: GraphParam[];
  position: { x: number; y: number };
}

export interface GraphPort {
  id: string;
  direction: "input" | "output" | "parameter";
  trigger: "hot" | "cold";
}

export interface GraphParam {
  key: string;
  value: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  source_handle: string;
  target_handle: string;
  optic_kind: string;
  is_feedback: boolean;
  complement_info: string;
}

export interface DemoResult {
  handle: number;
  graph: CircuitGraph;
  source_schema_handle: number;
}

export interface SchemaImportResult {
  handle: number;
  summary: { protocol: string; vertex_count: number; edge_count: number };
}

export interface TheoryImportResult {
  handle: number;
  name: string;
  sort_count: number;
  op_count: number;
}

/**
 * Summary of a registered user protocol. Matches the Rust
 * `ProtocolSummary` struct serialized via msgpack.
 */
export interface ProtocolSummary {
  name: string;
  schema_theory: string;
  instance_theory: string;
  obj_kind_count: number;
  constraint_sort_count: number;
  edge_rule_count: number;
  has_order: boolean;
  has_coproducts: boolean;
  has_recursion: boolean;
  has_causal: boolean;
  nominal_identity: boolean;
  has_defaults: boolean;
  has_coercions: boolean;
  has_mergers: boolean;
  has_policies: boolean;
}

export interface ProtocolImportResult {
  handle: number;
  summary: ProtocolSummary;
}

// ── Init ────────────────────────────────────────────────────────────

let initialized = false;

export async function initWasm(): Promise<void> {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

// ── Demo ────────────────────────────────────────────────────────────

export function getDemoCircuitWithHandle(): DemoResult {
  const bytes = create_demo_circuit_with_handle();
  return decode(bytes) as DemoResult;
}

// ── Mutation ────────────────────────────────────────────────────────

export function createEmptyCircuit(): number {
  return create_circuit();
}

export function addComponent(
  handle: number,
  spec: {
    id: string;
    component_type: string;
    ports: { id: string; direction: string; trigger: string }[];
    params: { key: string; value: string }[];
  },
): CircuitGraph {
  const bytes = encode(spec);
  const result = add_component_to_circuit(handle, new Uint8Array(bytes));
  return decode(result) as CircuitGraph;
}

export function addWire(
  handle: number,
  spec: {
    wire_id: string;
    src_port: string;
    tgt_port: string;
    optic_kind?: string;
    is_feedback: boolean;
  },
): CircuitGraph {
  const bytes = encode(spec);
  const result = add_wire_to_circuit(handle, new Uint8Array(bytes));
  return decode(result) as CircuitGraph;
}

export function removeComponent(
  handle: number,
  componentId: string,
): CircuitGraph {
  const result = remove_component_from_circuit(handle, componentId);
  return decode(result) as CircuitGraph;
}

export function removeWire(handle: number, wireId: string): CircuitGraph {
  const result = remove_wire_from_circuit(handle, wireId);
  return decode(result) as CircuitGraph;
}

export function updateParam(
  handle: number,
  componentId: string,
  key: string,
  value: string,
): CircuitGraph {
  const result = update_component_param(handle, componentId, key, value);
  return decode(result) as CircuitGraph;
}

export function getGraph(handle: number): CircuitGraph {
  const result = get_circuit_graph(handle);
  return decode(result) as CircuitGraph;
}

// ── Export ───────────────────────────────────────────────────────────

export function exportJson(handle: number): string {
  return export_circuit_as_json(handle);
}

export function exportLensJson(handle: number): string {
  return export_circuit_as_lens_json(handle);
}

export function exportYaml(handle: number): string {
  return export_circuit_as_yaml(handle);
}

export function exportNickel(handle: number): string {
  return export_circuit_as_nickel(handle);
}

// ── Import ──────────────────────────────────────────────────────────

export function importLensDoc(jsonSource: string): number {
  return import_lens_document(jsonSource);
}

export function importSchema(jsonSource: string): SchemaImportResult {
  const result = import_schema_json(jsonSource);
  return decode(result) as SchemaImportResult;
}

/**
 * Parse a raw atproto lexicon document (as JSON text) into a schema and
 * register it in the WASM slab. Returns the same shape as `importSchema`,
 * so the caller can treat the result as an imported schema and assign
 * it as the source schema of a circuit.
 */
export function parseAtprotoLexicon(jsonSource: string): SchemaImportResult {
  const result = parse_atproto_lexicon_wasm(jsonSource);
  return decode(result) as SchemaImportResult;
}

/**
 * Parse a schema in any supported protocol's native format. The
 * protocol name determines which parser is used; input is either JSON
 * text (most protocols) or DSL text (CDDL, ASN.1, FBS, etc.).
 */
export function parseNativeSchema(protocolName: string, input: string): SchemaImportResult {
  const result = parse_native_schema_wasm(protocolName, input);
  return decode(result) as SchemaImportResult;
}

export interface ProtocolMeta {
  name: string;
  category: string;
  input_format: "json" | "text";
  description: string;
}

/**
 * List all supported protocols with metadata for the UI dropdown.
 */
export function listSupportedProtocols(): ProtocolMeta[] {
  const result = list_supported_protocols_wasm();
  return decode(result) as ProtocolMeta[];
}

// ── Auto-lens (native panproto pipeline) ──────────────────────────

export interface ChainStepDesc {
  name: string;
  source_transform: string;
  target_transform: string;
}

export interface SchemaMappingDesc {
  vertex_remap: Array<[string, string]>;
  added_vertices: string[];
  removed_vertices: string[];
  surviving_vertices: string[];
  field_transforms: Array<[string, string[]]>;
}

/**
 * JSON-serialisable mirror of `panproto_lens::hint::HintParts`.
 * All fields optional; an empty value degrades to plain auto-generation.
 * Used by the candidates API's opts payload (via `CandidateOpts`).
 */
export interface HintSpec {
  /** Source vertex id → target vertex id anchors. */
  anchors?: Record<string, string>;
  /** Pairs of `[source_root, target_root]` for scope restrictions. */
  scope_pairs?: Array<[string, string]>;
  /** Target vertex names to exclude from all morphism domains. */
  excluded_targets?: string[];
  /** Source vertex names to exclude from the search. */
  excluded_sources?: string[];
  /** Override quality scoring component weights. */
  scoring_weights?: [number, number, number, number];
  /** Minimum name similarity for domain pruning. */
  name_similarity_threshold?: number;
  /** Optional minimum alignment quality. Defaults to 0.0. */
  quality_threshold?: number;
}

export interface SchemaVertexDetail {
  id: string;
  kind: string;
  nsid: string | null;
  constraints: Array<{ sort: string; value: string }>;
}

export interface SchemaEdgeDetail {
  src: string;
  tgt: string;
  kind: string;
  name: string | null;
}

export interface SchemaDetails {
  protocol: string;
  root: string | null;
  vertices: SchemaVertexDetail[];
  edges: SchemaEdgeDetail[];
}

/**
 * Inspect a stored schema: returns its protocol, root vertex (if
 * derivable), vertices (with kind/nsid/constraints), and edges
 * (src/tgt/kind/name). Used by the schema viewer modal and the
 * hint editor's anchor pickers.
 */
export function getSchemaDetails(schemaHandle: number): SchemaDetails {
  const result = get_schema_details_wasm(schemaHandle);
  return decode(result) as SchemaDetails;
}

/**
 * Export a previously imported Schema as its raw JSON (serde form).
 * Inverse of `importSchema` — lets tooling retag a schema under a
 * different protocol or round-trip it through a DSL.
 */
export function exportSchemaJson(schemaHandle: number): string {
  return export_schema_json_wasm(schemaHandle);
}

// ── Candidate API (v0.33.0) ──────────────────────────────────────────

export type Stringency = "strict" | "balanced" | "lenient" | "exploratory";

export interface CandidateOpts {
  stringency?: Stringency;
  top_n?: number;
  anchors?: Record<string, string>;
  excluded_sources?: string[];
  excluded_targets?: string[];
  scope_pairs?: Array<[string, string]>;
}

export interface CandidateStepDesc {
  kind: string;
  explanation: string;
  confidence: number;
  strategy: string | null;
}

export interface LensCandidateDesc {
  quality: number;
  coverage: number;
  strategies_used: string[];
  steps: CandidateStepDesc[];
  lens_handle: number;
}

export interface CandidatesResponse {
  candidates: LensCandidateDesc[];
}

/**
 * Generate ranked lens candidates between source and target schemas
 * at the given stringency. Each candidate carries quality, coverage,
 * per-step explanations, and a `lens_handle` for evaluation.
 */
export function autoGenerateCandidates(
  sourceHandle: number,
  targetHandle: number,
  opts: CandidateOpts = {},
): CandidatesResponse {
  const result = auto_generate_candidates_wasm(
    sourceHandle,
    targetHandle,
    JSON.stringify(opts),
  );
  return decode(result) as CandidatesResponse;
}

export interface AnchorProposal {
  src: string;
  tgt: string;
  confidence: number;
  strategy: string;
  explanation: string;
}

export interface DiscoveredAnchors {
  anchors: AnchorProposal[];
}

/**
 * Run the alignment strategies between two schemas WITHOUT invoking
 * the CSP/morphism search. Returns the anchors the strategies found,
 * sorted by descending confidence. Used by the "no morphism found"
 * UX path to show the user which correspondences were discovered so
 * they can lock them as hints and retry.
 */
export function discoverAnchors(
  sourceHandle: number,
  targetHandle: number,
  opts: { stringency?: Stringency } = {},
): DiscoveredAnchors {
  const result = discover_anchors_wasm(
    sourceHandle,
    targetHandle,
    JSON.stringify(opts),
  );
  return decode(result) as DiscoveredAnchors;
}

export interface InstallCandidateResult {
  chainSteps: ChainStepDesc[];
  schemaMapping: SchemaMappingDesc;
  graph: CircuitGraph;
}

interface InstallCandidateRaw {
  chain_steps: ChainStepDesc[];
  schema_mapping: SchemaMappingDesc;
  graph: Uint8Array | number[];
}

/**
 * Materialize the given candidate (by `lens_handle`) as editable
 * circuit components on `circuitHandle`. Returns the new graph
 * plus the chain-step descriptions and schema mapping that the
 * LensChainWidget / SchemaMappingWidget / TheoryDiffModal consume.
 *
 * Called by the store's `selectCandidate` — installing components
 * is deferred until the user actually picks a candidate, instead
 * of running on every `assignTargetSchema`.
 */
/**
 * Compute a bare schema mapping between source and target directly
 * from the schema graphs, without running the lens compiler. Used
 * by the store's no-mapping-UX path so downstream widgets
 * (SchemaMappingWidget, HintEditor, TheoryDiffModal) still have
 * populated mapping state when the CSP finds no usable lens.
 */
export function computeSchemaMapping(
  sourceHandle: number,
  targetHandle: number,
): SchemaMappingDesc {
  const result = compute_schema_mapping_wasm(sourceHandle, targetHandle);
  return decode(result) as SchemaMappingDesc;
}

/**
 * Remove every `component`-kind vertex from the circuit. Called by
 * the store before regeneration so that if the new candidate search
 * fails, the canvas isn't left with stale components from a
 * previous target or from the initial demo circuit.
 */
export function clearCircuitComponents(circuitHandle: number): CircuitGraph {
  const result = clear_circuit_components_wasm(circuitHandle);
  return decode(result) as CircuitGraph;
}

export function installCandidateComponents(
  circuitHandle: number,
  lensHandle: number,
  sourceHandle: number,
  targetHandle: number,
): InstallCandidateResult {
  const result = install_candidate_components_wasm(
    circuitHandle,
    lensHandle,
    sourceHandle,
    targetHandle,
  );
  const decoded = decode(result) as InstallCandidateRaw;
  return {
    chainSteps: decoded.chain_steps,
    schemaMapping: decoded.schema_mapping,
    graph: decode(
      decoded.graph instanceof Uint8Array
        ? decoded.graph
        : new Uint8Array(decoded.graph),
    ) as CircuitGraph,
  };
}

export interface AutoLensEvalResult {
  output_json: string;
  complement_handle: number;
}

/**
 * Evaluate an auto-generated lens: forward direction (get).
 * Applies `asymmetric::get(lens, instance)` directly.
 */
export function evaluateAutoLens(
  lensHandle: number,
  inputJson: string,
): { outputJson: string; complementHandle: number } {
  const result = evaluate_auto_lens_wasm(lensHandle, inputJson);
  const parsed = decode(result) as AutoLensEvalResult;
  return { outputJson: parsed.output_json, complementHandle: parsed.complement_handle };
}

export interface AutoLensPutResult {
  restored_json: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a JSON data value against a schema. Returns `{valid, errors}`
 * where `errors` is a list of human-readable strings (empty when valid).
 * Used to check that lens output conforms to the target schema.
 */
export function validateDataAgainstSchema(
  schemaHandle: number,
  dataJson: string,
): ValidationResult {
  const result = validate_data_against_schema_wasm(schemaHandle, dataJson);
  return decode(result) as ValidationResult;
}

/**
 * Put an auto-generated lens: backward direction.
 * Applies `asymmetric::put(lens, modified_view, complement)`.
 */
export function putAutoLens(
  lensHandle: number,
  modifiedJson: string,
  complementHandle: number,
): string {
  const result = put_auto_lens_wasm(lensHandle, modifiedJson, complementHandle);
  const parsed = decode(result) as AutoLensPutResult;
  return parsed.restored_json;
}

export function importTheory(jsonSource: string): TheoryImportResult {
  const result = import_theory_json(jsonSource);
  return decode(result) as TheoryImportResult;
}

// ── User-defined protocols ─────────────────────────────────────────

/**
 * Register a user-defined protocol from a JSON source string. The JSON
 * body must deserialize into a `panproto_schema::Protocol`. Throws if
 * the JSON is malformed or the protocol name is empty.
 */
export function importProtocolJson(jsonSource: string): ProtocolImportResult {
  const bytes = import_protocol_json(jsonSource);
  return decode(bytes) as ProtocolImportResult;
}

/** List all currently-registered user protocols, sorted by name. */
export function listUserProtocols(): ProtocolSummary[] {
  const bytes = list_user_protocols();
  return decode(bytes) as ProtocolSummary[];
}

/** Remove a user protocol by name. Returns `true` if one was removed. */
export function removeUserProtocol(name: string): boolean {
  const bytes = remove_user_protocol(name);
  return decode(bytes) as boolean;
}

/**
 * Fetch the full JSON body for a registered user protocol (useful for
 * editing or exporting). Returns `null` if no protocol with that name
 * is registered.
 */
export function getUserProtocolJson(name: string): string | null {
  const raw = get_user_protocol_json(name);
  return raw === "null" ? null : raw;
}

// ── Schema assignment ───────────────────────────────────────────────

export function setSourceSchema(circuit: number, schema: number): void {
  set_source_schema(circuit, schema);
}

export function getSourceSchema(circuit: number): number | null {
  const h = get_source_schema(circuit);
  return h < 0 ? null : h;
}

// ── Evaluation ──────────────────────────────────────────────────────

export interface EvaluationResult {
  output: string;
  wire_data: Record<string, string>;
  success: boolean;
}

export function setInputData(circuit: number, json: string): void {
  set_input_data(circuit, json);
}

export function evaluateCircuit(circuit: number): EvaluationResult {
  const bytes = evaluate_circuit(circuit);
  return decode(bytes) as EvaluationResult;
}

export function getWireData(circuit: number, wireId: string): string {
  return get_wire_data(circuit, wireId);
}

export function applyModifiedOutput(circuit: number, modifiedJson: string): string {
  return apply_modified_output(circuit, modifiedJson);
}

// ── Theories ────────────────────────────────────────────────────────

export interface CompiledTheoryBundle {
  id: string;
  theories: Array<[string, number]>;
  protocols: Array<[string, number]>;
  morphisms: Array<[string, number]>;
}

export interface TheoryDetails {
  name: string;
  sorts: string[];
  ops: string[];
  equation_count: number;
}

export function compileTheoryBundle(jsonSource: string): CompiledTheoryBundle {
  const bytes = compile_theory_bundle(jsonSource);
  return decode(bytes) as CompiledTheoryBundle;
}

export function composeTheoriesViaColimit(
  t1: number,
  t2: number,
  sharedSorts: string[],
): number {
  return compose_theories_via_colimit(t1, t2, JSON.stringify(sharedSorts));
}

export function listBuiltinTheories(): string[] {
  const bytes = list_builtin_theories();
  return decode(bytes) as string[];
}

export function getTheoryDetails(handle: number): TheoryDetails {
  const bytes = get_theory_details(handle);
  return decode(bytes) as TheoryDetails;
}

// ── Expression language ─────────────────────────────────────────────

export interface ExprParseResult {
  ok: boolean;
  error: string | null;
  line: number | null;
  column: number | null;
}

export interface ExprBuiltin {
  name: string;
  category: string;
  signature: string;
}

export function parseExpression(source: string): ExprParseResult {
  const bytes = parse_expression(source);
  return decode(bytes) as ExprParseResult;
}

export function evaluateExpression(source: string, envJson: string): string {
  return evaluate_expression(source, envJson);
}

export function listExprBuiltins(): ExprBuiltin[] {
  const bytes = list_expr_builtins();
  return decode(bytes) as ExprBuiltin[];
}

// ── Re-exports ──────────────────────────────────────────────────────

export { free_handle };

/**
 * Trigger a re-evaluation of the circuit and return the JSON-rendered
 * wire data at `componentId`'s output. Throws if no source schema is
 * assigned or no input data is set.
 */
export function bangComponent(handle: number, componentId: string): string {
  return bang_component(handle, componentId);
}
