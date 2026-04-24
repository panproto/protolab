/**
 * Zustand store for circuit state.
 * WASM is authoritative; React Flow state is a derived view.
 */

import { create } from "zustand";
import type { Node, Edge } from "@xyflow/react";
import * as wasm from "../wasm/bridge";
import type { CircuitGraph, GraphNode, GraphEdge } from "../wasm/bridge";

// ── Component catalog ───────────────────────────────────────────────

export interface ParamDef {
  key: string;
  label: string;
  default: string;
  /** Rendering hint for the Inspector: "text" (default), "expression"
   *  (CodeMirror), "enum" (dropdown with `options`), "field_ref"
   *  (a field-name picker — text input for now). */
  kind?: "text" | "expression" | "enum" | "field_ref";
  options?: string[];
  /** Whether this param is required for the component to evaluate. */
  required?: boolean;
}

/**
 * A single port on a component.
 *
 * The `suffix` is appended to the component instance id to form the port
 * id (e.g. component `comp_3` with port suffix `in2` → port `comp_3.in2`).
 * `label` is shown in the Inspector's Ports list.
 */
export interface PortDef {
  suffix: string;
  direction: "input" | "output" | "parameter";
  trigger: "hot" | "cold";
  label?: string;
}

/**
 * Default port set used when a component definition omits `ports`.
 * Matches the historical hardcoded shape: one hot input, one hot output,
 * and one cold parameter port.
 */
const DEFAULT_PORTS: PortDef[] = [
  { suffix: "in", direction: "input", trigger: "hot", label: "in" },
  { suffix: "out", direction: "output", trigger: "hot", label: "out" },
  { suffix: "param", direction: "parameter", trigger: "cold", label: "param" },
];

export interface ComponentDef {
  type: string;
  label: string;
  category: string;
  optic: string;
  color: string;
  params: ParamDef[];
  /** Optional per-component port schema. Falls back to `DEFAULT_PORTS`
   *  (one hot in, one hot out, one cold param) when omitted. */
  ports?: PortDef[];
}

/** Resolve a component definition's port schema, applying the default. */
export function portsForComponent(def: ComponentDef): PortDef[] {
  return def.ports ?? DEFAULT_PORTS;
}

export const COMPONENT_CATALOG: ComponentDef[] = [
  {
    type: "rename_field", label: "RenameField", category: "Structure",
    optic: "iso", color: "#4CAF50",
    params: [{ key: "old_name", label: "Old Name", default: "" }, { key: "new_name", label: "New Name", default: "" }],
  },
  {
    type: "add_field", label: "AddField", category: "Structure",
    optic: "lens", color: "#2196F3",
    params: [{ key: "field_name", label: "Field Name", default: "" }, { key: "field_kind", label: "Kind", default: "string" }, { key: "default", label: "Default", default: "" }],
  },
  {
    type: "drop_field", label: "DropField", category: "Structure",
    optic: "lens", color: "#2196F3",
    params: [{ key: "field_name", label: "Field Name", default: "" }],
  },
  {
    type: "hoist_field", label: "HoistField", category: "Structure",
    optic: "lens", color: "#2196F3",
    params: [{ key: "parent", label: "Parent", default: "" }, { key: "intermediate", label: "Intermediate", default: "" }, { key: "child", label: "Child", default: "" }],
  },
  {
    type: "nest_field", label: "NestField", category: "Structure",
    optic: "lens", color: "#2196F3",
    params: [{ key: "parent", label: "Parent", default: "" }, { key: "child", label: "Child", default: "" }, { key: "wrapper", label: "Wrapper", default: "" }],
  },
  {
    type: "coerce_type", label: "CoerceType", category: "Type Coercion",
    optic: "lens", color: "#2196F3",
    params: [
      { key: "field", label: "Field", default: "", kind: "field_ref", required: true },
      { key: "expr", label: "Forward (panproto-expr)", default: "", kind: "expression", required: true },
      { key: "inverse", label: "Inverse (panproto-expr)", default: "", kind: "expression" },
      {
        key: "coercion", label: "Coercion Class", default: "",
        kind: "enum", options: ["", "iso", "retraction", "projection", "opaque"],
      },
    ],
  },
  {
    type: "map_items", label: "MapItems", category: "Collections",
    optic: "traversal", color: "#F44336",
    params: [{ key: "focus", label: "Array Field", default: "", kind: "field_ref", required: true }],
  },
  {
    type: "apply_expr", label: "ApplyExpr", category: "Expressions",
    optic: "lens", color: "#2196F3",
    params: [
      { key: "field", label: "Field", default: "", kind: "field_ref", required: true },
      { key: "expr", label: "Forward (panproto-expr)", default: "", kind: "expression", required: true },
      { key: "inverse", label: "Inverse (panproto-expr)", default: "", kind: "expression" },
      {
        key: "coercion", label: "Coercion Class", default: "",
        kind: "enum", options: ["", "iso", "retraction", "projection", "opaque"],
      },
    ],
  },
  {
    type: "compute_field", label: "ComputeField", category: "Expressions",
    optic: "lens", color: "#2196F3",
    params: [
      { key: "target", label: "Target Field", default: "", required: true },
      { key: "expr", label: "Forward (panproto-expr)", default: "", kind: "expression", required: true },
      { key: "inverse", label: "Inverse (panproto-expr)", default: "", kind: "expression" },
      {
        key: "coercion", label: "Coercion Class", default: "",
        kind: "enum", options: ["", "iso", "retraction", "projection", "opaque"],
      },
    ],
  },
];

// ── Schema/theory info ──────────────────────────────────────────────

export interface SchemaInfo {
  handle: number;
  name: string;
  protocol: string;
  vertexCount: number;
  edgeCount: number;
}

export interface TheoryInfo {
  handle: number;
  name: string;
  sortCount: number;
  opCount: number;
}

/**
 * UI-side view of a registered user protocol. Mirrors the `ProtocolSummary`
 * struct from `protolab-wasm` plus a handle for retrieving the full body.
 */
export interface ProtocolInfo {
  handle: number;
  name: string;
  schemaTheory: string;
  instanceTheory: string;
  objKindCount: number;
  constraintSortCount: number;
  edgeRuleCount: number;
  hasOrder: boolean;
  hasCoproducts: boolean;
  hasRecursion: boolean;
  hasCausal: boolean;
  nominalIdentity: boolean;
  hasDefaults: boolean;
  hasCoercions: boolean;
  hasMergers: boolean;
  hasPolicies: boolean;
}

// ── Presentation mode types ─────────────────────────────────────────

/**
 * UI mode: "edit" shows the full circuit editor (palette + canvas +
 * inspector + data panel), "presentation" shows a curated "front panel"
 * assembled from a separate presentation layer. Inspired by Max/MSP's
 * presentation vs. edit mode split.
 */
export type ViewMode = "edit" | "presentation";

/**
 * Kinds of widgets that can appear in the presentation layer. Each kind
 * has a matching renderer in `presentation/widgets/`.
 */
export type WidgetKind =
  | "heading"
  | "paragraph"
  | "panel"
  | "input_json"
  | "output_json"
  | "run_button"
  | "lexicon_import"
  | "lens_chain"
  | "schema_mapping"
  | "schema_import";

/**
 * A single presentation widget. Widgets live in the presentation layer,
 * NOT in the circuit schema — they're UI chrome, not lens components.
 * `props` carries widget-specific config (heading text, run button
 * label, lexicon NSID, etc.); different widget kinds interpret different
 * keys.
 */
export interface PresentationWidget {
  id: string;
  kind: WidgetKind;
  /** Arbitrary string-keyed config. Each widget reads its own keys. */
  props: Record<string, string>;
}

/**
 * The presentation layer: a sibling of the circuit schema that controls
 * how the circuit is presented to end-users in presentation mode. Stored
 * in Zustand state and (for sharing) base64-encoded alongside the
 * circuit in `?p=` URL params.
 */
export interface PresentationDoc {
  title: string;
  widgets: PresentationWidget[];
}

export function emptyPresentationDoc(): PresentationDoc {
  return { title: "protolab", widgets: [] };
}

// ── Store ───────────────────────────────────────────────────────────

interface CircuitState {
  nodes: Node[];
  edges: Edge[];
  loading: boolean;
  error: string | null;
  circuitHandle: number | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  importedSchemas: SchemaInfo[];
  importedTheories: TheoryInfo[];
  importedProtocols: ProtocolInfo[];

  // Presentation mode
  mode: ViewMode;
  presentationDoc: PresentationDoc;

  // Evaluation state
  sourceSchemaHandle: number | null;
  targetSchemaHandle: number | null;
  autoLensHandle: number | null;
  autoLensComplementHandle: number | null;
  autoLensStatus: "idle" | "success" | "failed";
  autoLensError: string | null;
  autoLensChainSteps: Array<{ name: string; sourceTransform: string; targetTransform: string }>;
  autoLensSchemaMapping: {
    vertexRemap: Array<[string, string]>;
    addedVertices: string[];
    removedVertices: string[];
    survivingVertices: string[];
    fieldTransforms: Array<[string, string[]]>;
  } | null;
  /** Most recently applied hint spec. Empty if generation was unguided. */
  autoLensHints: wasm.HintSpec;
  /** Current stringency level for auto-generation. */
  stringency: wasm.Stringency;
  /** Ranked lens candidates from the latest auto_generate_candidates run. */
  autoLensCandidates: wasm.LensCandidateDesc[];
  /** Index of the currently selected candidate, or null if none. */
  selectedCandidateIdx: number | null;
  /**
   * Anchors the alignment strategies discovered, populated even when
   * the CSP search failed to find a morphism. Drives the "no mapping"
   * UX: the user can promote a subset to hints and retry.
   */
  discoveredAnchors: wasm.AnchorProposal[];
  /** Schema currently open in the viewer modal, or null when closed. */
  schemaViewerHandle: number | null;
  /** True when the hint editor modal is open. */
  hintEditorOpen: boolean;
  /** True when the theory-level diff modal is open. */
  theoryDiffOpen: boolean;
  inputDataJson: string;
  outputDataJson: string;
  wireDataMap: Record<string, string>;
  evaluationError: string | null;
  selectedWireId: string | null;

  /**
   * Result of validating `outputDataJson` against the target schema.
   * Null when no validation has run (no target, no output). Refreshed
   * on every `runEvaluation`.
   */
  outputValidation: { valid: boolean; errors: string[] } | null;

  // Init
  initDemo(): Promise<void>;

  // Selection
  selectNode(id: string | null): void;
  selectEdge(id: string | null): void;
  selectWire(id: string | null): void;

  // Mutation
  addComponent(type: string, x: number, y: number): void;
  removeComponent(id: string): void;
  connectPorts(srcPort: string, tgtPort: string): void;
  removeWire(id: string): void;
  updateParam(componentId: string, key: string, value: string): void;

  // Presentation mode
  setMode(mode: ViewMode): void;
  setPresentationDoc(doc: PresentationDoc): void;
  setPresentationTitle(title: string): void;
  addPresentationWidget(widget: PresentationWidget): void;
  updatePresentationWidget(id: string, patch: Partial<PresentationWidget>): void;
  removePresentationWidget(id: string): void;

  // Import
  importLensDocument(json: string): void;
  importSchema(json: string): void;
  importTheory(json: string): void;
  importProtocol(json: string): void;
  removeProtocol(name: string): void;
  refreshProtocols(): void;
  getProtocolJson(name: string): string | null;

  // Schema assignment + evaluation
  assignSourceSchema(schemaHandle: number): void;
  assignTargetSchema(schemaHandle: number | null): void;
  /** Re-run auto-generation guided by the supplied hint spec. */
  regenerateWithHints(hints: wasm.HintSpec): void;
  setHints(hints: wasm.HintSpec): void;
  /** Change stringency and re-run candidate generation. */
  setStringency(stringency: wasm.Stringency): void;
  /** Generate ranked candidates at the current stringency + hints. */
  generateCandidates(): void;
  /** Select a specific candidate by index and install its lens. */
  selectCandidate(idx: number): void;
  /**
   * Promote one of the discovered anchors to a persistent hint and
   * re-run candidate generation so the CSP gets the pinning it needs.
   */
  promoteAnchorToHint(src: string, tgt: string): void;
  /**
   * Remove a previously-pinned anchor hint for `src` and re-run
   * candidate generation. Symmetric with `promoteAnchorToHint`.
   */
  removeAnchorHint(src: string): void;
  setInputData(json: string): void;
  runEvaluation(): void;
  applyModifiedOutput(json: string): void;

  // Schema viewer modal
  openSchemaViewer(handle: number): void;
  closeSchemaViewer(): void;
  // Hint editor modal
  openHintEditor(): void;
  closeHintEditor(): void;
  // Theory-level diff modal
  openTheoryDiff(): void;
  closeTheoryDiff(): void;

  // Theories
  buildTheoryFromJson(json: string): void;
  composeTheories(t1: number, t2: number, sharedSorts: string[]): void;

  // Internal
  applyGraph(graph: CircuitGraph): void;
  setError(error: string | null): void;
}

let nextComponentId = 0;
let nextWireId = 100;

/**
 * True when the store has a real instance-level lens ready to run.
 * False when auto-generation succeeded but produced only theory-level
 * steps with no corresponding circuit components (the old chain_step
 * placeholders would have made Run silently return the input). The
 * flag lets the DataPanel + RunButtonWidget disable Run cleanly.
 *
 * Readers pass it a fresh store state via `useCircuitStore((s) =>
 * hasDataLevelMapping(s))` for reactive subscription.
 */
export function hasDataLevelMapping(s: CircuitState): boolean {
  if (s.sourceSchemaHandle === null || s.targetSchemaHandle === null) {
    // No target assigned — source-only manual path, Run still makes
    // sense against a user-built or demo circuit.
    return s.nodes.length > 0;
  }
  if (s.autoLensStatus === "success" && s.nodes.length === 0) {
    // Auto-gen succeeded but installed no components. If the chain
    // is empty too, that's the identity case (source ≡ target) and
    // Run legitimately returns input-as-output. Anything else means
    // panproto produced a theory-level-only chain that would run as
    // a confusing no-op on instance data.
    return s.autoLensChainSteps.length === 0;
  }
  return s.nodes.length > 0;
}

/**
 * Run target-schema validation on the latest output JSON. Returns null
 * when there's no target assigned (nothing to validate against) or the
 * output is empty. Caught errors are converted to a non-valid result
 * rather than thrown so Run always leaves the UI in a consistent state.
 */
function validateOutput(
  targetHandle: number | null,
  outputJson: string,
): { valid: boolean; errors: string[] } | null {
  if (targetHandle === null) return null;
  if (!outputJson || outputJson.trim() === "") return null;
  try {
    return wasm.validateDataAgainstSchema(targetHandle, outputJson);
  } catch (err) {
    return { valid: false, errors: [String(err)] };
  }
}

function graphToReactFlow(graph: CircuitGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n: GraphNode) => {
    // Prefer the catalog's CamelCase display label so node titles match
    // the palette ("MapItems") instead of showing the snake_case type id
    // ("map_items") that the backend stores as the canonical name.
    const def = COMPONENT_CATALOG.find((c) => c.type === n.component_type);
    return {
      id: n.id,
      type: "component",
      position: n.position,
      data: {
        label: def?.label ?? n.label,
        componentType: n.component_type,
        opticKind: n.optic_kind,
        ports: n.ports,
        params: n.params,
      },
    };
  });

  const edges: Edge[] = graph.edges.map((e: GraphEdge) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.source_handle,
    targetHandle: e.target_handle,
    type: "wire",
    data: { opticKind: e.optic_kind, isFeedback: e.is_feedback, complementInfo: e.complement_info },
  }));

  return { nodes, edges };
}

function initialModeFromUrl(): ViewMode {
  if (typeof window === "undefined") return "edit";
  const p = new URLSearchParams(window.location.search);
  return p.get("mode") === "presentation" ? "presentation" : "edit";
}

export const useCircuitStore = create<CircuitState>((set, get) => ({
  nodes: [],
  edges: [],
  loading: true,
  error: null,
  circuitHandle: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  importedSchemas: [],
  importedTheories: [],
  importedProtocols: [],

  // Presentation mode
  mode: initialModeFromUrl(),
  presentationDoc: emptyPresentationDoc(),

  // Evaluation state
  sourceSchemaHandle: null,
  targetSchemaHandle: null,
  autoLensHandle: null,
  autoLensComplementHandle: null,
  autoLensStatus: "idle" as const,
  autoLensError: null,
  autoLensChainSteps: [],
  autoLensSchemaMapping: null,
  autoLensHints: {},
  stringency: "balanced" as wasm.Stringency,
  autoLensCandidates: [],
  selectedCandidateIdx: null,
  discoveredAnchors: [],
  schemaViewerHandle: null,
  hintEditorOpen: false,
  theoryDiffOpen: false,
  inputDataJson: "",
  outputDataJson: "",
  wireDataMap: {},
  evaluationError: null,
  selectedWireId: null,
  outputValidation: null,

  async initDemo() {
    try {
      await wasm.initWasm();
      const { handle, graph, source_schema_handle } = wasm.getDemoCircuitWithHandle();
      nextComponentId = 10;
      set({
        circuitHandle: handle,
        sourceSchemaHandle: source_schema_handle,
        loading: false,
        inputDataJson: '{\n  "name": "Alice Chen",\n  "legacyId": 7042,\n  "email": "alice@example.com",\n  "joinedAt": "2023-06-15"\n}',
        importedSchemas: [
          {
            handle: source_schema_handle,
            name: "user (demo, auto-assigned)",
            protocol: "user-demo",
            vertexCount: 4,
            edgeCount: 3,
          },
        ],
      });
      get().applyGraph(graph);
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  selectNode(id) {
    set({ selectedNodeId: id, selectedEdgeId: null });
  },
  selectEdge(id) {
    set({ selectedEdgeId: id, selectedNodeId: null });
  },
  selectWire(id) {
    set({ selectedWireId: id });
  },

  addComponent(type, x, y) {
    const handle = get().circuitHandle;
    if (!handle && handle !== 0) return;
    const def = COMPONENT_CATALOG.find((c) => c.type === type);
    if (!def) return;

    const id = `comp_${nextComponentId++}`;
    const ports = portsForComponent(def).map((p) => ({
      id: `${id}.${p.suffix}`,
      direction: p.direction,
      trigger: p.trigger,
    }));
    const graph = wasm.addComponent(handle, {
      id,
      component_type: type,
      ports,
      params: def.params.map((p) => ({ key: p.key, value: p.default })),
    });

    // Override position since WASM assigns default.
    const { nodes, edges } = graphToReactFlow(graph);
    const node = nodes.find((n) => n.id === id);
    if (node) node.position = { x, y };
    set({ nodes, edges });
  },

  removeComponent(id) {
    const handle = get().circuitHandle;
    if (!handle && handle !== 0) return;
    const graph = wasm.removeComponent(handle, id);
    get().applyGraph(graph);
  },

  connectPorts(srcPort, tgtPort) {
    const handle = get().circuitHandle;
    if (!handle && handle !== 0) return;
    const wireId = `w_${nextWireId++}`;
    const graph = wasm.addWire(handle, {
      wire_id: wireId,
      src_port: srcPort,
      tgt_port: tgtPort,
      optic_kind: "lens",
      is_feedback: false,
    });
    get().applyGraph(graph);
  },

  removeWire(id) {
    const handle = get().circuitHandle;
    if (!handle && handle !== 0) return;
    const graph = wasm.removeWire(handle, id);
    get().applyGraph(graph);
  },

  updateParam(componentId, key, value) {
    const handle = get().circuitHandle;
    if (!handle && handle !== 0) return;
    const graph = wasm.updateParam(handle, componentId, key, value);
    get().applyGraph(graph);
  },

  // ── Presentation mode actions ────────────────────────────────────

  setMode(mode) {
    set({ mode });
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (mode === "presentation") p.set("mode", "presentation");
      else p.delete("mode");
      const q = p.toString();
      const url = q ? `${window.location.pathname}?${q}` : window.location.pathname;
      window.history.replaceState(null, "", url);
    }
  },

  setPresentationDoc(doc) {
    set({ presentationDoc: doc });
  },

  setPresentationTitle(title) {
    set((s) => ({ presentationDoc: { ...s.presentationDoc, title } }));
  },

  addPresentationWidget(widget) {
    set((s) => ({
      presentationDoc: {
        ...s.presentationDoc,
        widgets: [...s.presentationDoc.widgets, widget],
      },
    }));
  },

  updatePresentationWidget(id, patch) {
    set((s) => ({
      presentationDoc: {
        ...s.presentationDoc,
        widgets: s.presentationDoc.widgets.map((w) =>
          w.id === id ? { ...w, ...patch, props: { ...w.props, ...(patch.props ?? {}) } } : w,
        ),
      },
    }));
  },

  removePresentationWidget(id) {
    set((s) => ({
      presentationDoc: {
        ...s.presentationDoc,
        widgets: s.presentationDoc.widgets.filter((w) => w.id !== id),
      },
    }));
  },

  importLensDocument(json) {
    try {
      const newHandle = wasm.importLensDoc(json);
      const graph = wasm.getGraph(newHandle);
      const oldHandle = get().circuitHandle;
      if (oldHandle !== null) wasm.free_handle(oldHandle);
      set({ circuitHandle: newHandle });
      get().applyGraph(graph);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  importSchema(json) {
    try {
      const result = wasm.importSchema(json);
      set((s) => ({
        importedSchemas: [
          ...s.importedSchemas,
          {
            handle: result.handle,
            name: result.summary.protocol + ` (${result.summary.vertex_count}V)`,
            protocol: result.summary.protocol,
            vertexCount: result.summary.vertex_count,
            edgeCount: result.summary.edge_count,
          },
        ],
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  importTheory(json) {
    try {
      const result = wasm.importTheory(json);
      set((s) => ({
        importedTheories: [
          ...s.importedTheories,
          {
            handle: result.handle,
            name: result.name,
            sortCount: result.sort_count,
            opCount: result.op_count,
          },
        ],
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  // ── User-defined protocols ───────────────────────────────────────

  importProtocol(json) {
    try {
      const result = wasm.importProtocolJson(json);
      const s = result.summary;
      const entry: ProtocolInfo = {
        handle: result.handle,
        name: s.name,
        schemaTheory: s.schema_theory,
        instanceTheory: s.instance_theory,
        objKindCount: s.obj_kind_count,
        constraintSortCount: s.constraint_sort_count,
        edgeRuleCount: s.edge_rule_count,
        hasOrder: s.has_order,
        hasCoproducts: s.has_coproducts,
        hasRecursion: s.has_recursion,
        hasCausal: s.has_causal,
        nominalIdentity: s.nominal_identity,
        hasDefaults: s.has_defaults,
        hasCoercions: s.has_coercions,
        hasMergers: s.has_mergers,
        hasPolicies: s.has_policies,
      };
      set((state) => {
        // Replace any existing entry with the same name (overwrite on re-import).
        const others = state.importedProtocols.filter(
          (p) => p.name.toLowerCase() !== entry.name.toLowerCase(),
        );
        return { importedProtocols: [...others, entry], error: null };
      });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  removeProtocol(name) {
    try {
      const removed = wasm.removeUserProtocol(name);
      if (removed) {
        set((state) => ({
          importedProtocols: state.importedProtocols.filter(
            (p) => p.name.toLowerCase() !== name.toLowerCase(),
          ),
        }));
      }
    } catch (err) {
      set({ error: String(err) });
    }
  },

  refreshProtocols() {
    try {
      const summaries = wasm.listUserProtocols();
      const protocols: ProtocolInfo[] = summaries.map((s) => ({
        // listUserProtocols doesn't return handles — use -1 to indicate
        // "not individually addressable", callers that need the full
        // body should use getProtocolJson by name instead.
        handle: -1,
        name: s.name,
        schemaTheory: s.schema_theory,
        instanceTheory: s.instance_theory,
        objKindCount: s.obj_kind_count,
        constraintSortCount: s.constraint_sort_count,
        edgeRuleCount: s.edge_rule_count,
        hasOrder: s.has_order,
        hasCoproducts: s.has_coproducts,
        hasRecursion: s.has_recursion,
        hasCausal: s.has_causal,
        nominalIdentity: s.nominal_identity,
        hasDefaults: s.has_defaults,
        hasCoercions: s.has_coercions,
        hasMergers: s.has_mergers,
        hasPolicies: s.has_policies,
      }));
      set({ importedProtocols: protocols });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  getProtocolJson(name) {
    try {
      return wasm.getUserProtocolJson(name);
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  // ── Schema assignment + evaluation ───────────────────────────────

  assignSourceSchema(schemaHandle) {
    const handle = get().circuitHandle;
    if (handle === null) return;
    try {
      wasm.setSourceSchema(handle, schemaHandle);
      // Refresh the graph so the per-component optic classifications
      // (which depend on the source schema's root vertex) get picked
      // up. Without this, every component shows as "lens" because
      // `compute_per_component_optics` falls back when no source is
      // assigned.
      const graph = wasm.getGraph(handle);
      set({ sourceSchemaHandle: schemaHandle, evaluationError: null });
      get().applyGraph(graph);
    } catch (err) {
      set({ evaluationError: String(err) });
    }
  },

  assignTargetSchema(schemaHandle) {
    set({ targetSchemaHandle: schemaHandle });
    // Single path: run the candidates API; auto-select the top
    // candidate via selectCandidate(0), which also materializes its
    // chain as editable circuit components and populates the
    // chain-step / schema-mapping state downstream widgets read.
    // The old dual-path setup (`generateCandidates` + legacy
    // `autoGenerateLens`) double-ran the CSP and silently bypassed
    // the coverage filter in the legacy path, letting a 123-step
    // DropOp pile onto the canvas even when the candidates surface
    // said "no mapping inferred".
    if (schemaHandle !== null) {
      get().generateCandidates();
    }
  },

  /**
   * Hint-guided regeneration. Stores the spec on `autoLensHints` and
   * re-runs the candidates API; `selectCandidate(0)` handles the
   * component install + downstream state population. Replaces the
   * old `autoGenerateWithHintsAndStore` wasm call.
   */
  regenerateWithHints(hints) {
    set({ autoLensHints: hints });
    get().generateCandidates();
  },

  setHints(hints) {
    set({ autoLensHints: hints });
  },

  setStringency(stringency) {
    set({ stringency });
    get().generateCandidates();
  },

  generateCandidates() {
    const src = get().sourceSchemaHandle;
    const tgt = get().targetSchemaHandle;
    if (src === null || tgt === null) return;
    const circuitHandle = get().circuitHandle;

    // Wipe any existing components before running the search. Two
    // reasons: (1) if the search fails, the canvas shouldn't keep
    // stale components from a previous target assignment or from
    // the demo initial circuit — the "no mapping" empty-state
    // overlay gates on `nodes.length === 0`. (2) if it succeeds,
    // `install_candidate_components` does its own clear pass, so
    // doing one here is at worst idempotent.
    if (circuitHandle !== null) {
      try {
        const cleared = wasm.clearCircuitComponents(circuitHandle);
        get().applyGraph(cleared);
      } catch (err) {
        console.warn("clearCircuitComponents failed:", err);
      }
    }

    try {
      const result = wasm.autoGenerateCandidates(src, tgt, {
        stringency: get().stringency,
        top_n: 5,
        ...get().autoLensHints,
      });
      set({
        autoLensCandidates: result.candidates,
        selectedCandidateIdx: result.candidates.length > 0 ? 0 : null,
        autoLensError: null,
        discoveredAnchors: [],
      });
      if (result.candidates.length > 0) {
        // selectCandidate sets autoLensStatus = "success" + installs
        // the chain's components via installCandidateComponents.
        get().selectCandidate(0);
      } else {
        // wasm returned an empty list without throwing — treat as
        // no-mapping so downstream gating (`autoLensError !== null`)
        // still lights up the empty-state overlay.
        set({
          autoLensStatus: "failed",
          autoLensError: "no candidates returned",
          autoLensHandle: null,
          autoLensChainSteps: [],
          autoLensSchemaMapping: null,
        });
      }
    } catch (err) {
      // No morphism (or another upstream error). Pull the anchors
      // the aligners found so the user can see partial progress and
      // lock a hint to guide the retry. Also compute a bare schema
      // mapping from the source/target graphs directly so the
      // SchemaMapping / TheoryDiff / HintEditor widgets have
      // populated state to render against — the mapping view is
      // informative even when no lens compiled.
      const message = err instanceof Error ? err.message : String(err);
      let discovered: wasm.AnchorProposal[] = [];
      try {
        const anchors = wasm.discoverAnchors(src, tgt, {
          stringency: get().stringency,
        });
        discovered = anchors.anchors;
      } catch (discoverErr) {
        console.warn("discoverAnchors failed:", discoverErr);
      }
      let fallbackMapping: wasm.SchemaMappingDesc | null = null;
      try {
        fallbackMapping = wasm.computeSchemaMapping(src, tgt);
      } catch (mapErr) {
        console.warn("computeSchemaMapping failed:", mapErr);
      }
      // Synthesize a theory-level chain from the bare mapping so
      // TheoryDiffModal has steps to render. One step per added or
      // removed vertex is the coarse but honest summary ("this
      // vertex would need to be added / this one dropped"). No
      // data-level side effects, because no lens compiled.
      const syntheticChainSteps: typeof get extends never
        ? never
        : ReturnType<typeof get>["autoLensChainSteps"] = fallbackMapping
        ? [
            ...fallbackMapping.added_vertices.map((v) => ({
              name: `add_sort(${v})`,
              sourceTransform: "Identity",
              targetTransform: `AddSort(${v})`,
            })),
            ...fallbackMapping.removed_vertices.map((v) => ({
              name: `drop_sort(${v})`,
              sourceTransform: `DropSort(${v})`,
              targetTransform: "Identity",
            })),
          ]
        : [];
      set({
        autoLensStatus: "failed",
        autoLensError: message,
        autoLensCandidates: [],
        selectedCandidateIdx: null,
        autoLensHandle: null,
        autoLensChainSteps: syntheticChainSteps,
        autoLensSchemaMapping: fallbackMapping
          ? {
              vertexRemap: fallbackMapping.vertex_remap,
              addedVertices: fallbackMapping.added_vertices,
              removedVertices: fallbackMapping.removed_vertices,
              survivingVertices: fallbackMapping.surviving_vertices,
              fieldTransforms: fallbackMapping.field_transforms,
            }
          : null,
        discoveredAnchors: discovered,
      });
    }
  },

  selectCandidate(idx) {
    const candidates = get().autoLensCandidates;
    if (idx < 0 || idx >= candidates.length) return;
    const candidate = candidates[idx];
    const circuitHandle = get().circuitHandle;
    const src = get().sourceSchemaHandle;
    const tgt = get().targetSchemaHandle;

    set({
      selectedCandidateIdx: idx,
      autoLensHandle: candidate.lens_handle,
      autoLensComplementHandle: null,
      autoLensStatus: "success",
      autoLensError: null,
    });

    // Install the candidate's chain as editable circuit components
    // so edit mode reflects the selected lens and the downstream
    // widgets (LensChain, SchemaMapping, TheoryDiff) have their
    // state. The wasm entry re-applies the coverage gate defensively
    // — if the candidate somehow slipped past the generation-time
    // filter, install throws and we fall through to the no-mapping
    // UX rather than dumping a DropOp pile on the canvas.
    if (circuitHandle === null || src === null || tgt === null) return;
    try {
      const result = wasm.installCandidateComponents(
        circuitHandle,
        candidate.lens_handle,
        src,
        tgt,
      );
      set({
        autoLensChainSteps: result.chainSteps.map((s) => ({
          name: s.name,
          sourceTransform: s.source_transform,
          targetTransform: s.target_transform,
        })),
        autoLensSchemaMapping: {
          vertexRemap: result.schemaMapping.vertex_remap,
          addedVertices: result.schemaMapping.added_vertices,
          removedVertices: result.schemaMapping.removed_vertices,
          survivingVertices: result.schemaMapping.surviving_vertices,
          fieldTransforms: result.schemaMapping.field_transforms,
        },
      });
      get().applyGraph(result.graph);
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/i, "");
      set({
        autoLensHandle: null,
        autoLensStatus: "failed",
        autoLensError: msg,
        autoLensChainSteps: [],
        autoLensSchemaMapping: null,
      });
    }
  },

  promoteAnchorToHint(src, tgt) {
    const current = get().autoLensHints;
    const nextAnchors = { ...(current.anchors ?? {}), [src]: tgt };
    set({ autoLensHints: { ...current, anchors: nextAnchors } });
    get().generateCandidates();
  },

  removeAnchorHint(src) {
    const current = get().autoLensHints;
    const existingAnchors = current.anchors ?? {};
    if (!(src in existingAnchors)) return;
    const nextAnchors: Record<string, string> = {};
    for (const [k, v] of Object.entries(existingAnchors)) {
      if (k !== src) nextAnchors[k] = v;
    }
    set({ autoLensHints: { ...current, anchors: nextAnchors } });
    get().generateCandidates();
  },

  openSchemaViewer(handle) {
    set({ schemaViewerHandle: handle });
  },
  closeSchemaViewer() {
    set({ schemaViewerHandle: null });
  },
  openHintEditor() {
    set({ hintEditorOpen: true });
  },
  closeHintEditor() {
    set({ hintEditorOpen: false });
  },
  openTheoryDiff() {
    set({ theoryDiffOpen: true });
  },
  closeTheoryDiff() {
    set({ theoryDiffOpen: false });
  },

  setInputData(json) {
    set({ inputDataJson: json });
  },

  runEvaluation() {
    const json = get().inputDataJson;

    // Auto-lens path: use the native Lens via asymmetric::get.
    const autoHandle = get().autoLensHandle;
    if (autoHandle !== null) {
      try {
        const result = wasm.evaluateAutoLens(autoHandle, json);
        set({
          outputDataJson: result.outputJson,
          autoLensComplementHandle: result.complementHandle,
          wireDataMap: {},
          evaluationError: null,
          outputValidation: validateOutput(get().targetSchemaHandle, result.outputJson),
        });
      } catch (err) {
        set({ evaluationError: String(err), outputValidation: null });
      }
      return;
    }

    // Manual circuit path (existing).
    const handle = get().circuitHandle;
    if (handle === null) {
      set({ evaluationError: "no circuit loaded" });
      return;
    }
    if (get().sourceSchemaHandle === null) {
      set({ evaluationError: "no source schema assigned; import a schema and assign it as source" });
      return;
    }
    try {
      wasm.setInputData(handle, json);
      const result = wasm.evaluateCircuit(handle);
      set({
        outputDataJson: result.output,
        wireDataMap: result.wire_data,
        evaluationError: null,
        outputValidation: validateOutput(get().targetSchemaHandle, result.output),
      });
    } catch (err) {
      set({ evaluationError: String(err), outputValidation: null });
    }
  },

  applyModifiedOutput(json) {
    const handle = get().circuitHandle;
    if (handle === null) return;
    try {
      const restoredInput = wasm.applyModifiedOutput(handle, json);
      set({ inputDataJson: restoredInput, outputDataJson: json, evaluationError: null });
    } catch (err) {
      set({ evaluationError: String(err) });
    }
  },

  // ── Theories ─────────────────────────────────────────────────────

  buildTheoryFromJson(json) {
    try {
      const result = wasm.compileTheoryBundle(json);
      const detailedTheories: TheoryInfo[] = result.theories.map(([name, handle]) => {
        try {
          const d = wasm.getTheoryDetails(handle);
          return {
            handle,
            name: d.name || name,
            sortCount: d.sorts.length,
            opCount: d.ops.length,
          };
        } catch {
          return { handle, name, sortCount: 0, opCount: 0 };
        }
      });
      set((s) => ({
        importedTheories: [...s.importedTheories, ...detailedTheories],
        error: null,
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  composeTheories(t1, t2, sharedSorts) {
    try {
      const newHandle = wasm.composeTheoriesViaColimit(t1, t2, sharedSorts);
      const d = wasm.getTheoryDetails(newHandle);
      set((s) => ({
        importedTheories: [
          ...s.importedTheories,
          {
            handle: newHandle,
            name: d.name || "composed",
            sortCount: d.sorts.length,
            opCount: d.ops.length,
          },
        ],
        error: null,
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  applyGraph(graph) {
    const { nodes, edges } = graphToReactFlow(graph);
    set({ nodes, edges });
  },

  setError(error) {
    set({ error });
  },
}));

// Expose the store on `window` for Playwright e2e tests so they can
// drive the circuit without simulating fragile drag/drop sequences.
if (typeof window !== "undefined") {
  (window as unknown as { __protolabStore?: typeof useCircuitStore }).__protolabStore =
    useCircuitStore;
}
