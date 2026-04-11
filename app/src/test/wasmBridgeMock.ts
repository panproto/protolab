/**
 * Mock implementation of `src/wasm/bridge.ts` for use in jsdom tests.
 *
 * The real bridge loads a WebAssembly module that cannot run in jsdom.
 * This module provides `vi.fn()` replacements with sensible defaults
 * for every export. Tests may override individual functions via
 * `vi.mocked(fn).mockReturnValue(...)` and reset everything via
 * `resetMockBridge()`.
 */
import { vi } from "vitest";

// ── Type re-exports (must match bridge.ts) ──────────────────────────

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

export interface EvaluationResult {
  output: string;
  wire_data: Record<string, string>;
  success: boolean;
}

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

// ── Default data helpers ────────────────────────────────────────────

function defaultGraph(): CircuitGraph {
  return {
    nodes: [
      {
        id: "rename",
        type: "component",
        label: "rename",
        component_type: "rename",
        optic_kind: "lens",
        ports: [
          { id: "in", direction: "input", trigger: "hot" },
          { id: "out", direction: "output", trigger: "hot" },
        ],
        params: [{ key: "from", value: "name" }, { key: "to", value: "displayName" }],
        position: { x: 0, y: 0 },
      },
      {
        id: "add",
        type: "component",
        label: "add",
        component_type: "add",
        optic_kind: "lens",
        ports: [
          { id: "in", direction: "input", trigger: "hot" },
          { id: "out", direction: "output", trigger: "hot" },
        ],
        params: [],
        position: { x: 150, y: 0 },
      },
      {
        id: "drop",
        type: "component",
        label: "drop",
        component_type: "drop",
        optic_kind: "lens",
        ports: [
          { id: "in", direction: "input", trigger: "hot" },
          { id: "out", direction: "output", trigger: "hot" },
        ],
        params: [],
        position: { x: 300, y: 0 },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "rename",
        target: "add",
        source_handle: "out",
        target_handle: "in",
        optic_kind: "lens",
        is_feedback: false,
        complement_info: "",
      },
      {
        id: "e2",
        source: "add",
        target: "drop",
        source_handle: "out",
        target_handle: "in",
        optic_kind: "lens",
        is_feedback: false,
        complement_info: "",
      },
    ],
  };
}

function defaultProtocolSummary(): ProtocolSummary {
  return {
    name: "mock-protocol",
    schema_theory: "mock-schema",
    instance_theory: "mock-instance",
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
  };
}

// ── Mocked exports ──────────────────────────────────────────────────

export const initWasm = vi.fn(async (): Promise<void> => {
  return Promise.resolve();
});

export const getDemoCircuitWithHandle = vi.fn((): DemoResult => ({
  handle: 0,
  graph: defaultGraph(),
  source_schema_handle: 1,
}));

export const createEmptyCircuit = vi.fn((): number => 0);

export const addComponent = vi.fn(
  (_handle: number, _spec: unknown): CircuitGraph => defaultGraph(),
);

export const addWire = vi.fn(
  (_handle: number, _spec: unknown): CircuitGraph => defaultGraph(),
);

export const removeComponent = vi.fn(
  (_handle: number, _id: string): CircuitGraph => defaultGraph(),
);

export const removeWire = vi.fn(
  (_handle: number, _wireId: string): CircuitGraph => defaultGraph(),
);

export const updateParam = vi.fn(
  (_handle: number, _id: string, _key: string, _value: string): CircuitGraph =>
    defaultGraph(),
);

export const getGraph = vi.fn(
  (_handle: number): CircuitGraph => defaultGraph(),
);

// Alias to match the instructions' naming. The real bridge calls this
// `getGraph`, but downstream tests may expect `getCircuitGraph`.
export const getCircuitGraph = getGraph;

export const exportJson = vi.fn((_handle: number): string => "{}");
export const exportLensJson = vi.fn((_handle: number): string => "{}");
export const exportYaml = vi.fn((_handle: number): string => "");
export const exportNickel = vi.fn((_handle: number): string => "");

export const importLensDoc = vi.fn((_jsonSource: string): number => 42);

export const importSchema = vi.fn(
  (_jsonSource: string): SchemaImportResult => ({
    handle: 1,
    summary: { protocol: "mock-protocol", vertex_count: 2, edge_count: 1 },
  }),
);

export const autoGenerateAndStore = vi.fn(
  (_circuitHandle: number, _sourceHandle: number, _targetHandle: number) => ({
    lensHandle: 99,
    quality: 0.85,
    chainSteps: [{ name: "rename_sort", source_transform: "Identity", target_transform: "RenameSort" }],
    schemaMapping: {
      vertex_remap: [["old_v", "new_v"]],
      added_vertices: ["added_v"],
      removed_vertices: ["removed_v"],
      surviving_vertices: ["surviving_v"],
      field_transforms: [],
    },
    graph: defaultGraph(),
  }),
);

export const evaluateAutoLens = vi.fn(
  (_lensHandle: number, _inputJson: string) => ({
    outputJson: '{"transformed": true}',
    complementHandle: 100,
  }),
);

export const putAutoLens = vi.fn(
  (_lensHandle: number, _modifiedJson: string, _complementHandle: number) => '{"restored": true}',
);

export const parseAtprotoLexicon = vi.fn(
  (_jsonSource: string): SchemaImportResult => ({
    handle: 7,
    summary: { protocol: "atproto", vertex_count: 5, edge_count: 4 },
  }),
);

export const importTheory = vi.fn(
  (_jsonSource: string): TheoryImportResult => ({
    handle: 1,
    name: "mock-theory",
    sort_count: 1,
    op_count: 1,
  }),
);

export const importProtocolJson = vi.fn(
  (_jsonSource: string): ProtocolImportResult => ({
    handle: 1,
    summary: defaultProtocolSummary(),
  }),
);

export const listUserProtocols = vi.fn((): ProtocolSummary[] => []);

export const removeUserProtocol = vi.fn((_name: string): boolean => true);

export const getUserProtocolJson = vi.fn(
  (_name: string): string | null => null,
);

export const setSourceSchema = vi.fn(
  (_circuit: number, _schema: number): void => {
    /* no-op */
  },
);

export const getSourceSchema = vi.fn(
  (_circuit: number): number | null => 1,
);

export const setInputData = vi.fn(
  (_circuit: number, _json: string): void => {
    /* no-op */
  },
);

export const evaluateCircuit = vi.fn(
  (_circuit: number): EvaluationResult => ({
    output: '{"displayName":"Alice"}',
    wire_data: {},
    success: true,
  }),
);

export const getWireData = vi.fn(
  (_circuit: number, _wireId: string): string => "{}",
);

export const applyModifiedOutput = vi.fn(
  (_circuit: number, _modifiedJson: string): string => {
    /* no-op */
    return "{}";
  },
);

export const bangComponent = vi.fn(
  (_handle: number, _componentId: string): string =>
    '{"displayName":"Alice"}',
);

export const compileTheoryBundle = vi.fn(
  (_jsonSource: string): CompiledTheoryBundle => ({
    id: "mock-bundle",
    theories: [["mock-theory", 1]],
    protocols: [],
    morphisms: [],
  }),
);

export const composeTheoriesViaColimit = vi.fn(
  (_t1: number, _t2: number, _sharedSorts: string[]): number => 2,
);

// Alias matching the instructions' naming.
export const composeTheories = composeTheoriesViaColimit;

export const listBuiltinTheories = vi.fn((): string[] => [
  "set",
  "monoid",
  "group",
]);

export const getTheoryDetails = vi.fn(
  (_handle: number): TheoryDetails => ({
    name: "mock-theory",
    sorts: ["A"],
    ops: ["id : A -> A"],
    equation_count: 0,
  }),
);

export const parseExpression = vi.fn(
  (_source: string): ExprParseResult => ({
    ok: true,
    error: null,
    line: null,
    column: null,
  }),
);

export const evaluateExpression = vi.fn(
  (_source: string, _envJson: string): string => "42",
);

export const listExprBuiltins = vi.fn((): ExprBuiltin[] => [
  { name: "len", category: "list", signature: "len(xs) -> int" },
  { name: "map", category: "list", signature: "map(f, xs) -> list" },
  { name: "filter", category: "list", signature: "filter(p, xs) -> list" },
  { name: "concat", category: "string", signature: "concat(a, b) -> string" },
]);

export const free_handle = vi.fn((_handle: number): void => {
  /* no-op */
});

// ── Reset helper ────────────────────────────────────────────────────

/**
 * Clears all mock call history and restores every function to its
 * default implementation. Call this in `beforeEach` for isolation.
 */
export function resetMockBridge(): void {
  vi.clearAllMocks();

  initWasm.mockImplementation(async () => Promise.resolve());
  getDemoCircuitWithHandle.mockImplementation(() => ({
    handle: 0,
    graph: defaultGraph(),
    source_schema_handle: 1,
  }));
  createEmptyCircuit.mockImplementation(() => 0);
  addComponent.mockImplementation(() => defaultGraph());
  addWire.mockImplementation(() => defaultGraph());
  removeComponent.mockImplementation(() => defaultGraph());
  removeWire.mockImplementation(() => defaultGraph());
  updateParam.mockImplementation(() => defaultGraph());
  getGraph.mockImplementation(() => defaultGraph());
  exportJson.mockImplementation(() => "{}");
  exportLensJson.mockImplementation(() => "{}");
  exportYaml.mockImplementation(() => "");
  exportNickel.mockImplementation(() => "");
  importLensDoc.mockImplementation(() => 42);
  importSchema.mockImplementation(() => ({
    handle: 1,
    summary: { protocol: "mock-protocol", vertex_count: 2, edge_count: 1 },
  }));
  autoGenerateAndStore.mockImplementation(() => ({
    lensHandle: 99,
    quality: 0.85,
    chainSteps: [{ name: "rename_sort", source_transform: "Identity", target_transform: "RenameSort" }],
    schemaMapping: {
      vertex_remap: [["old_v", "new_v"]],
      added_vertices: ["added_v"],
      removed_vertices: ["removed_v"],
      surviving_vertices: ["surviving_v"],
      field_transforms: [],
    },
    graph: defaultGraph(),
  }));
  evaluateAutoLens.mockImplementation(() => ({
    outputJson: '{"transformed": true}',
    complementHandle: 100,
  }));
  putAutoLens.mockImplementation(() => '{"restored": true}');
  parseAtprotoLexicon.mockImplementation(() => ({
    handle: 7,
    summary: { protocol: "atproto", vertex_count: 5, edge_count: 4 },
  }));
  importTheory.mockImplementation(() => ({
    handle: 1,
    name: "mock-theory",
    sort_count: 1,
    op_count: 1,
  }));
  importProtocolJson.mockImplementation(() => ({
    handle: 1,
    summary: defaultProtocolSummary(),
  }));
  listUserProtocols.mockImplementation(() => []);
  removeUserProtocol.mockImplementation(() => true);
  getUserProtocolJson.mockImplementation(() => null);
  setSourceSchema.mockImplementation(() => undefined);
  getSourceSchema.mockImplementation(() => 1);
  setInputData.mockImplementation(() => undefined);
  evaluateCircuit.mockImplementation(() => ({
    output: '{"displayName":"Alice"}',
    wire_data: {},
    success: true,
  }));
  getWireData.mockImplementation(() => "{}");
  applyModifiedOutput.mockImplementation(() => "{}");
  bangComponent.mockImplementation(() => '{"displayName":"Alice"}');
  compileTheoryBundle.mockImplementation(() => ({
    id: "mock-bundle",
    theories: [["mock-theory", 1]],
    protocols: [],
    morphisms: [],
  }));
  composeTheoriesViaColimit.mockImplementation(() => 2);
  listBuiltinTheories.mockImplementation(() => ["set", "monoid", "group"]);
  getTheoryDetails.mockImplementation(() => ({
    name: "mock-theory",
    sorts: ["A"],
    ops: ["id : A -> A"],
    equation_count: 0,
  }));
  parseExpression.mockImplementation(() => ({
    ok: true,
    error: null,
    line: null,
    column: null,
  }));
  evaluateExpression.mockImplementation(() => "42");
  listExprBuiltins.mockImplementation(() => [
    { name: "len", category: "list", signature: "len(xs) -> int" },
    { name: "map", category: "list", signature: "map(f, xs) -> list" },
    { name: "filter", category: "list", signature: "filter(p, xs) -> list" },
    { name: "concat", category: "string", signature: "concat(a, b) -> string" },
  ]);
  free_handle.mockImplementation(() => undefined);
}
