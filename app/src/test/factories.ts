/**
 * Test data factories. Each factory returns a sensible default and
 * accepts `overrides?: Partial<T>` so tests can customize shapes.
 */
import type {
  CircuitGraph,
  GraphNode,
  GraphEdge,
  ProtocolSummary,
  ProtocolImportResult,
  SchemaImportResult,
  TheoryImportResult,
} from "../wasm/bridge";

export function makeGraphNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "node-1",
    type: "component",
    label: "Component",
    component_type: "rename",
    optic_kind: "lens",
    ports: [
      { id: "in", direction: "input", trigger: "hot" },
      { id: "out", direction: "output", trigger: "hot" },
    ],
    params: [],
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

export function makeGraphEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: "edge-1",
    source: "node-1",
    target: "node-2",
    source_handle: "out",
    target_handle: "in",
    optic_kind: "lens",
    is_feedback: false,
    complement_info: "",
    ...overrides,
  };
}

export function makeCircuitGraph(
  overrides: Partial<CircuitGraph> = {},
): CircuitGraph {
  return {
    nodes: [
      makeGraphNode({ id: "rename", label: "rename", component_type: "rename" }),
      makeGraphNode({ id: "add", label: "add", component_type: "add" }),
      makeGraphNode({ id: "drop", label: "drop", component_type: "drop" }),
    ],
    edges: [
      makeGraphEdge({ id: "e1", source: "rename", target: "add" }),
      makeGraphEdge({ id: "e2", source: "add", target: "drop" }),
    ],
    ...overrides,
  };
}

export function makeProtocolSummary(
  overrides: Partial<ProtocolSummary> = {},
): ProtocolSummary {
  return {
    name: "test-protocol",
    schema_theory: "test-schema",
    instance_theory: "test-instance",
    obj_kind_count: 1,
    constraint_sort_count: 0,
    edge_rule_count: 0,
    has_order: false,
    has_coproducts: false,
    has_recursion: false,
    has_causal: false,
    nominal_identity: false,
    has_defaults: false,
    has_coercions: false,
    has_mergers: false,
    has_policies: false,
    ...overrides,
  };
}

export function makeSchemaImportResult(
  overrides: Partial<SchemaImportResult> = {},
): SchemaImportResult {
  return {
    handle: 1,
    summary: { protocol: "test-protocol", vertex_count: 2, edge_count: 1 },
    ...overrides,
  };
}

export function makeTheoryImportResult(
  overrides: Partial<TheoryImportResult> = {},
): TheoryImportResult {
  return {
    handle: 1,
    name: "test-theory",
    sort_count: 1,
    op_count: 1,
    ...overrides,
  };
}

export function makeProtocolImportResult(
  overrides: Partial<ProtocolImportResult> = {},
): ProtocolImportResult {
  return {
    handle: 1,
    summary: makeProtocolSummary(),
    ...overrides,
  };
}
