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
  auto_generate_lens as auto_generate_lens_wasm,
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

export interface AutoLensResult {
  alignment_quality: number;
  graph: Uint8Array;
}

/**
 * Auto-generate a lens between source and target schemas.
 *
 * Uses panproto's `auto_lens::auto_generate` pipeline: morphism
 * alignment → endofunctor factorization → protolens chain → circuit
 * components. The circuit is cleared and rebuilt with the auto-generated
 * components. Returns the alignment quality score (0.0 to 1.0).
 *
 * If `targetHandle` is null, the source schema is used as the target
 * (identity lens).
 */
export function autoGenerateLens(
  circuitHandle: number,
  sourceHandle: number,
  targetHandle: number,
): { alignmentQuality: number; graph: CircuitGraph } {
  const result = auto_generate_lens_wasm(circuitHandle, sourceHandle, targetHandle);
  const parsed = decode(result) as AutoLensResult;
  const graph = decode(parsed.graph) as CircuitGraph;
  return { alignmentQuality: parsed.alignment_quality, graph };
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
