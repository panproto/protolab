/**
 * Comprehensive tests for the Zustand circuit store.
 *
 * The store imports `../wasm/bridge` which vitest's `resolve.alias` swaps
 * for `src/test/wasmBridgeMock.ts`. We import the mock module directly so
 * we can manipulate `vi.fn()` instances and assert call arguments.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useCircuitStore,
  COMPONENT_CATALOG,
  portsForComponent,
  type ComponentDef,
} from "../circuitStore";
import * as wasm from "../../test/wasmBridgeMock";
import {
  makeCircuitGraph,
  makeGraphNode,
  makeGraphEdge,
  makeProtocolSummary,
  makeSchemaImportResult,
  makeTheoryImportResult,
  makeProtocolImportResult,
} from "../../test/factories";

// ── Helpers ─────────────────────────────────────────────────────────

/** Snapshot of the store's initial state, captured once before any test
 *  mutates the singleton. Used by `beforeEach` to restore a clean slate. */
const INITIAL_STATE = { ...useCircuitStore.getState() };

function resetStore(): void {
  useCircuitStore.setState({ ...INITIAL_STATE }, true);
}

/** Seed the store with a circuit handle so mutation actions are not no-ops. */
function seedWithHandle(handle = 0): void {
  useCircuitStore.setState({ circuitHandle: handle });
}

beforeEach(() => {
  wasm.resetMockBridge();
  resetStore();
});

// ── COMPONENT_CATALOG + helpers ─────────────────────────────────────

describe("COMPONENT_CATALOG + helpers", () => {
  const expectedTypes = [
    "rename_field",
    "add_field",
    "drop_field",
    "hoist_field",
    "nest_field",
    "coerce_type",
    "apply_expr",
    "compute_field",
    "map_items",
  ];

  it("catalog contains every expected component type", () => {
    const types = COMPONENT_CATALOG.map((c) => c.type);
    for (const t of expectedTypes) {
      expect(types).toContain(t);
    }
  });

  it("every catalog entry has a non-empty label", () => {
    for (const def of COMPONENT_CATALOG) {
      expect(def.label).toBeTruthy();
      expect(def.label.length).toBeGreaterThan(0);
    }
  });

  it("every catalog entry's params have unique keys", () => {
    for (const def of COMPONENT_CATALOG) {
      const keys = def.params.map((p) => p.key);
      const unique = new Set(keys);
      expect(unique.size).toBe(keys.length);
    }
  });

  it("portsForComponent returns default ports when ports omitted", () => {
    const def: ComponentDef = {
      type: "t",
      label: "T",
      category: "c",
      optic: "lens",
      color: "#fff",
      params: [],
    };
    const ports = portsForComponent(def);
    expect(ports).toHaveLength(3);
    expect(ports.map((p) => p.suffix)).toEqual(["in", "out", "param"]);
    expect(ports.map((p) => p.direction)).toEqual([
      "input",
      "output",
      "parameter",
    ]);
  });

  it("portsForComponent returns custom ports when specified", () => {
    const def: ComponentDef = {
      type: "t",
      label: "T",
      category: "c",
      optic: "lens",
      color: "#fff",
      params: [],
      ports: [
        { suffix: "a", direction: "input", trigger: "hot" },
        { suffix: "b", direction: "output", trigger: "cold" },
      ],
    };
    const ports = portsForComponent(def);
    expect(ports).toHaveLength(2);
    expect(ports[0].suffix).toBe("a");
    expect(ports[1].trigger).toBe("cold");
  });
});

// ── initDemo ────────────────────────────────────────────────────────

describe("initDemo", () => {
  it("calls initWasm and getDemoCircuitWithHandle", async () => {
    await useCircuitStore.getState().initDemo();
    expect(wasm.initWasm).toHaveBeenCalledTimes(1);
    expect(wasm.getDemoCircuitWithHandle).toHaveBeenCalledTimes(1);
  });

  it("populates circuitHandle, sourceSchemaHandle, importedSchemas on success", async () => {
    vi.mocked(wasm.getDemoCircuitWithHandle).mockReturnValueOnce({
      handle: 7,
      graph: makeCircuitGraph(),
      source_schema_handle: 11,
    });
    await useCircuitStore.getState().initDemo();
    const state = useCircuitStore.getState();
    expect(state.circuitHandle).toBe(7);
    expect(state.sourceSchemaHandle).toBe(11);
    expect(state.loading).toBe(false);
    expect(state.importedSchemas).toHaveLength(1);
    expect(state.importedSchemas[0].handle).toBe(11);
  });

  it("sets error and leaves loading=false on failure", async () => {
    vi.mocked(wasm.initWasm).mockRejectedValueOnce(new Error("boom"));
    await useCircuitStore.getState().initDemo();
    const state = useCircuitStore.getState();
    expect(state.error).toContain("boom");
    expect(state.loading).toBe(false);
  });
});

// ── Selection actions ───────────────────────────────────────────────

describe("selection actions", () => {
  it("selectNode updates selectedNodeId and clears selectedEdgeId", () => {
    useCircuitStore.setState({ selectedEdgeId: "e1" });
    useCircuitStore.getState().selectNode("n1");
    const s = useCircuitStore.getState();
    expect(s.selectedNodeId).toBe("n1");
    expect(s.selectedEdgeId).toBeNull();
  });

  it("selectEdge updates selectedEdgeId and clears selectedNodeId", () => {
    useCircuitStore.setState({ selectedNodeId: "n1" });
    useCircuitStore.getState().selectEdge("e1");
    const s = useCircuitStore.getState();
    expect(s.selectedEdgeId).toBe("e1");
    expect(s.selectedNodeId).toBeNull();
  });

  it("selectWire updates selectedWireId independently", () => {
    useCircuitStore.setState({ selectedNodeId: "n1", selectedEdgeId: "e1" });
    useCircuitStore.getState().selectWire("w1");
    const s = useCircuitStore.getState();
    expect(s.selectedWireId).toBe("w1");
    expect(s.selectedNodeId).toBe("n1");
    expect(s.selectedEdgeId).toBe("e1");
  });
});

// ── addComponent ────────────────────────────────────────────────────

describe("addComponent", () => {
  beforeEach(() => seedWithHandle(3));

  it("calls wasm.addComponent with catalog ports and params", () => {
    useCircuitStore.getState().addComponent("rename_field", 10, 20);
    expect(wasm.addComponent).toHaveBeenCalledTimes(1);
    const [handle, spec] = vi.mocked(wasm.addComponent).mock.calls[0];
    expect(handle).toBe(3);
    const specObj = spec as {
      id: string;
      component_type: string;
      ports: Array<{ id: string; direction: string; trigger: string }>;
      params: Array<{ key: string; value: string }>;
    };
    expect(specObj.component_type).toBe("rename_field");
    expect(specObj.ports).toHaveLength(3);
    expect(specObj.params.map((p) => p.key)).toEqual(["old_name", "new_name"]);
  });

  it("assigns a sequential id", () => {
    const idsSeen: string[] = [];
    vi.mocked(wasm.addComponent).mockImplementation((_h, spec) => {
      idsSeen.push((spec as { id: string }).id);
      return makeCircuitGraph();
    });
    useCircuitStore.getState().addComponent("rename_field", 0, 0);
    useCircuitStore.getState().addComponent("rename_field", 0, 0);
    expect(idsSeen).toHaveLength(2);
    expect(idsSeen[0]).not.toBe(idsSeen[1]);
    // Both should match the comp_N pattern and have increasing N.
    const n0 = parseInt(idsSeen[0].replace("comp_", ""), 10);
    const n1 = parseInt(idsSeen[1].replace("comp_", ""), 10);
    expect(n1).toBe(n0 + 1);
  });

  it("does nothing when circuitHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: null });
    useCircuitStore.getState().addComponent("rename_field", 0, 0);
    expect(wasm.addComponent).not.toHaveBeenCalled();
  });

  it("does nothing for unknown component types", () => {
    useCircuitStore.getState().addComponent("not_a_real_type", 0, 0);
    expect(wasm.addComponent).not.toHaveBeenCalled();
  });

  it("passes catalog-derived ports (default 3)", () => {
    useCircuitStore.getState().addComponent("add_field", 0, 0);
    const [, spec] = vi.mocked(wasm.addComponent).mock.calls[0];
    const ports = (spec as { ports: Array<{ id: string; direction: string }> })
      .ports;
    expect(ports).toHaveLength(3);
    expect(ports.map((p) => p.direction)).toEqual([
      "input",
      "output",
      "parameter",
    ]);
    // Port ids are prefixed with the component instance id.
    expect(ports[0].id).toMatch(/^comp_\d+\.in$/);
    expect(ports[1].id).toMatch(/^comp_\d+\.out$/);
    expect(ports[2].id).toMatch(/^comp_\d+\.param$/);
  });

  it("override position is applied to the added node", () => {
    // The store finds the node by id in the returned graph and rewrites
    // its position. Make the mock return a graph containing a node whose
    // id matches the one the store is about to generate.
    vi.mocked(wasm.addComponent).mockImplementation((_h, spec) => {
      const s = spec as { id: string; component_type: string };
      return {
        nodes: [
          makeGraphNode({
            id: s.id,
            component_type: s.component_type,
            label: s.component_type,
          }),
        ],
        edges: [],
      };
    });
    useCircuitStore.getState().addComponent("rename_field", 123, 456);
    const { nodes } = useCircuitStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].position).toEqual({ x: 123, y: 456 });
  });
});

// ── removeComponent ─────────────────────────────────────────────────

describe("removeComponent", () => {
  it("calls wasm.removeComponent and applies the new graph", () => {
    seedWithHandle(5);
    const graph = makeCircuitGraph({
      nodes: [makeGraphNode({ id: "only" })],
      edges: [],
    });
    vi.mocked(wasm.removeComponent).mockReturnValueOnce(graph);
    useCircuitStore.getState().removeComponent("rename");
    expect(wasm.removeComponent).toHaveBeenCalledWith(5, "rename");
    expect(useCircuitStore.getState().nodes).toHaveLength(1);
    expect(useCircuitStore.getState().nodes[0].id).toBe("only");
  });

  it("does nothing when circuitHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: null });
    useCircuitStore.getState().removeComponent("x");
    expect(wasm.removeComponent).not.toHaveBeenCalled();
  });
});

// ── connectPorts ────────────────────────────────────────────────────

describe("connectPorts", () => {
  beforeEach(() => seedWithHandle(2));

  it("generates a fresh wire id on each call", () => {
    useCircuitStore.getState().connectPorts("a.out", "b.in");
    useCircuitStore.getState().connectPorts("b.out", "c.in");
    const calls = vi.mocked(wasm.addWire).mock.calls;
    expect(calls).toHaveLength(2);
    const id0 = (calls[0][1] as { wire_id: string }).wire_id;
    const id1 = (calls[1][1] as { wire_id: string }).wire_id;
    expect(id0).not.toBe(id1);
    expect(id0).toMatch(/^w_\d+$/);
    expect(id1).toMatch(/^w_\d+$/);
  });

  it("passes lens as the optic_kind", () => {
    useCircuitStore.getState().connectPorts("a.out", "b.in");
    const spec = vi.mocked(wasm.addWire).mock.calls[0][1] as {
      optic_kind: string;
      is_feedback: boolean;
      src_port: string;
      tgt_port: string;
    };
    expect(spec.optic_kind).toBe("lens");
    expect(spec.is_feedback).toBe(false);
    expect(spec.src_port).toBe("a.out");
    expect(spec.tgt_port).toBe("b.in");
  });

  it("skips wasm call when circuitHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: null });
    useCircuitStore.getState().connectPorts("a.out", "b.in");
    expect(wasm.addWire).not.toHaveBeenCalled();
  });
});

// ── removeWire ──────────────────────────────────────────────────────

describe("removeWire", () => {
  it("calls wasm.removeWire", () => {
    seedWithHandle(4);
    useCircuitStore.getState().removeWire("w_100");
    expect(wasm.removeWire).toHaveBeenCalledWith(4, "w_100");
  });

  it("does nothing when circuitHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: null });
    useCircuitStore.getState().removeWire("w_100");
    expect(wasm.removeWire).not.toHaveBeenCalled();
  });
});

// ── updateParam ─────────────────────────────────────────────────────

describe("updateParam", () => {
  it("calls wasm.updateParam with componentId/key/value", () => {
    seedWithHandle(1);
    useCircuitStore.getState().updateParam("comp_3", "new_name", "foo");
    expect(wasm.updateParam).toHaveBeenCalledWith(1, "comp_3", "new_name", "foo");
  });

  it("does nothing when circuitHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: null });
    useCircuitStore.getState().updateParam("comp_3", "new_name", "foo");
    expect(wasm.updateParam).not.toHaveBeenCalled();
  });
});

// ── importLensDocument ──────────────────────────────────────────────

describe("importLensDocument", () => {
  it("sets a new circuitHandle from importLensDoc and applies the graph", () => {
    vi.mocked(wasm.importLensDoc).mockReturnValueOnce({ handle: 99, dropped: [] });
    vi.mocked(wasm.getGraph).mockReturnValueOnce(
      makeCircuitGraph({
        nodes: [makeGraphNode({ id: "only" })],
        edges: [],
      }),
    );
    useCircuitStore.getState().importLensDocument('{"x":1}');
    const state = useCircuitStore.getState();
    expect(state.circuitHandle).toBe(99);
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe("only");
    expect(wasm.importLensDoc).toHaveBeenCalledWith('{"x":1}');
  });

  // The canvas draws a `steps` body and nothing else, so a document
  // carrying directed equations, rules metadata, or extensions opens as a
  // strictly smaller thing than it is — and exporting it will not put them
  // back. Import still succeeds; what must not happen is it succeeding
  // quietly.
  it("reports the parts of a lens the canvas could not carry", () => {
    vi.mocked(wasm.importLensDoc).mockReturnValueOnce({
      handle: 5,
      dropped: ["2 directed equation(s): they will not be exported."],
    });
    vi.mocked(wasm.getGraph).mockReturnValueOnce(makeCircuitGraph({ nodes: [], edges: [] }));
    useCircuitStore.getState().importLensDocument('{"x":1}');
    const state = useCircuitStore.getState();
    expect(state.circuitHandle).toBe(5);
    expect(state.error).toContain("cannot carry every part");
    expect(state.error).toContain("directed equation");
  });

  it("clears a previous error when nothing was dropped", () => {
    useCircuitStore.setState({ error: "stale complaint from an earlier import" });
    vi.mocked(wasm.importLensDoc).mockReturnValueOnce({ handle: 6, dropped: [] });
    vi.mocked(wasm.getGraph).mockReturnValueOnce(makeCircuitGraph({ nodes: [], edges: [] }));
    useCircuitStore.getState().importLensDocument('{"x":1}');
    expect(useCircuitStore.getState().error).toBeNull();
  });

  // "No lens worth installing" says nothing about what the two schemas
  // share, and the empty state used to fill that gap by asserting the
  // names "don't overlap enough" — which nothing had measured. The span
  // search does answer it, and never refuses.
  it("records what the schemas share when no candidate is found", () => {
    vi.mocked(wasm.autoGenerateCandidates).mockImplementationOnce(() => {
      throw new Error("no morphism found between schemas");
    });
    vi.mocked(wasm.schemaSpan).mockReturnValueOnce({
      pairs: [{ src: "user.tags", tgt: "post.tags" }],
      apex_coverage: 0.25,
      apex_vertex_count: 1,
      source_vertex_count: 4,
      is_total: false,
      proven_optimal: true,
    });
    useCircuitStore.setState({ sourceSchemaHandle: 1, targetSchemaHandle: 2 });
    useCircuitStore.getState().generateCandidates();
    const span = useCircuitStore.getState().schemaSpan;
    expect(span).not.toBeNull();
    expect(span?.pairs).toHaveLength(1);
    expect(span?.apex_coverage).toBeCloseTo(0.25);
  });

  it("clears the span once a candidate is found again", () => {
    // A stale overlap beside a freshly installed lens would describe a
    // search that is no longer the one on screen.
    useCircuitStore.setState({
      sourceSchemaHandle: 1,
      targetSchemaHandle: 2,
      schemaSpan: {
        pairs: [{ src: "a", tgt: "b" }],
        apex_coverage: 0.5,
        apex_vertex_count: 1,
        source_vertex_count: 2,
        is_total: false,
        proven_optimal: true,
      },
    });
    useCircuitStore.getState().generateCandidates();
    expect(useCircuitStore.getState().schemaSpan).toBeNull();
  });

  it("frees the old handle when replacing an existing circuit", () => {
    useCircuitStore.setState({ circuitHandle: 5 });
    vi.mocked(wasm.importLensDoc).mockReturnValueOnce({ handle: 99, dropped: [] });
    useCircuitStore.getState().importLensDocument("{}");
    expect(wasm.free_handle).toHaveBeenCalledWith(5);
  });

  it("propagates errors via setError", () => {
    vi.mocked(wasm.importLensDoc).mockImplementationOnce(() => {
      throw new Error("parse failed");
    });
    useCircuitStore.getState().importLensDocument("garbage");
    expect(useCircuitStore.getState().error).toContain("parse failed");
  });
});

// ── importSchema ────────────────────────────────────────────────────

describe("importSchema", () => {
  it("appends to importedSchemas with the correct shape", () => {
    vi.mocked(wasm.importSchema).mockReturnValueOnce(
      makeSchemaImportResult({
        handle: 42,
        summary: { protocol: "proto-x", vertex_count: 5, edge_count: 3 },
      }),
    );
    useCircuitStore.getState().importSchema("{}");
    const schemas = useCircuitStore.getState().importedSchemas;
    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toEqual({
      handle: 42,
      name: "proto-x (5V)",
      protocol: "proto-x",
      vertexCount: 5,
      edgeCount: 3,
    });
  });

  it("propagates errors via setError", () => {
    vi.mocked(wasm.importSchema).mockImplementationOnce(() => {
      throw new Error("bad schema");
    });
    useCircuitStore.getState().importSchema("{}");
    expect(useCircuitStore.getState().error).toContain("bad schema");
  });
});

// ── importTheory ────────────────────────────────────────────────────

describe("importTheory", () => {
  it("appends to importedTheories with the correct shape", () => {
    vi.mocked(wasm.importTheory).mockReturnValueOnce(
      makeTheoryImportResult({
        handle: 7,
        name: "grp",
        sort_count: 2,
        op_count: 4,
      }),
    );
    useCircuitStore.getState().importTheory("{}");
    const theories = useCircuitStore.getState().importedTheories;
    expect(theories).toHaveLength(1);
    expect(theories[0]).toEqual({
      handle: 7,
      name: "grp",
      sortCount: 2,
      opCount: 4,
    });
  });

  it("propagates errors via setError", () => {
    vi.mocked(wasm.importTheory).mockImplementationOnce(() => {
      throw new Error("bad theory");
    });
    useCircuitStore.getState().importTheory("{}");
    expect(useCircuitStore.getState().error).toContain("bad theory");
  });
});

// ── importProtocol ──────────────────────────────────────────────────

describe("importProtocol", () => {
  it("appends to importedProtocols with the camelCase shape", () => {
    vi.mocked(wasm.importProtocolJson).mockReturnValueOnce(
      makeProtocolImportResult({
        handle: 3,
        summary: makeProtocolSummary({
          name: "alpha",
          schema_theory: "S",
          instance_theory: "I",
          obj_kind_count: 2,
          constraint_sort_count: 1,
          edge_rule_count: 4,
          has_order: true,
          has_coproducts: true,
          nominal_identity: true,
        }),
      }),
    );
    useCircuitStore.getState().importProtocol("{}");
    const ps = useCircuitStore.getState().importedProtocols;
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({
      handle: 3,
      name: "alpha",
      schemaTheory: "S",
      instanceTheory: "I",
      objKindCount: 2,
      constraintSortCount: 1,
      edgeRuleCount: 4,
      hasOrder: true,
      hasCoproducts: true,
      nominalIdentity: true,
      hasRecursion: false,
    });
  });

  it("overwrites an existing entry with the same name (case-insensitive)", () => {
    vi.mocked(wasm.importProtocolJson).mockReturnValue(
      makeProtocolImportResult({
        handle: 1,
        summary: makeProtocolSummary({ name: "Alpha", obj_kind_count: 1 }),
      }),
    );
    useCircuitStore.getState().importProtocol("{}");
    vi.mocked(wasm.importProtocolJson).mockReturnValue(
      makeProtocolImportResult({
        handle: 2,
        summary: makeProtocolSummary({ name: "alpha", obj_kind_count: 9 }),
      }),
    );
    useCircuitStore.getState().importProtocol("{}");
    const ps = useCircuitStore.getState().importedProtocols;
    expect(ps).toHaveLength(1);
    expect(ps[0].handle).toBe(2);
    expect(ps[0].objKindCount).toBe(9);
  });

  it("propagates errors via setError", () => {
    vi.mocked(wasm.importProtocolJson).mockImplementationOnce(() => {
      throw new Error("bad protocol");
    });
    useCircuitStore.getState().importProtocol("{}");
    expect(useCircuitStore.getState().error).toContain("bad protocol");
  });

  it("calls the bridge with the raw JSON body", () => {
    const body = '{"name":"p"}';
    useCircuitStore.getState().importProtocol(body);
    expect(wasm.importProtocolJson).toHaveBeenCalledWith(body);
  });
});

// ── removeProtocol ──────────────────────────────────────────────────

describe("removeProtocol", () => {
  it("removes the entry from importedProtocols on success", () => {
    useCircuitStore.setState({
      importedProtocols: [
        {
          handle: 1,
          name: "Alpha",
          schemaTheory: "s",
          instanceTheory: "i",
          objKindCount: 0,
          constraintSortCount: 0,
          edgeRuleCount: 0,
          hasOrder: false,
          hasCoproducts: false,
          hasRecursion: false,
          hasCausal: false,
          nominalIdentity: false,
          hasDefaults: false,
          hasCoercions: false,
          hasMergers: false,
          hasPolicies: false,
        },
      ],
    });
    vi.mocked(wasm.removeUserProtocol).mockReturnValueOnce(true);
    useCircuitStore.getState().removeProtocol("alpha");
    expect(wasm.removeUserProtocol).toHaveBeenCalledWith("alpha");
    expect(useCircuitStore.getState().importedProtocols).toHaveLength(0);
  });

  it("is a no-op if the bridge returns false", () => {
    useCircuitStore.setState({
      importedProtocols: [
        {
          handle: 1,
          name: "Alpha",
          schemaTheory: "s",
          instanceTheory: "i",
          objKindCount: 0,
          constraintSortCount: 0,
          edgeRuleCount: 0,
          hasOrder: false,
          hasCoproducts: false,
          hasRecursion: false,
          hasCausal: false,
          nominalIdentity: false,
          hasDefaults: false,
          hasCoercions: false,
          hasMergers: false,
          hasPolicies: false,
        },
      ],
    });
    vi.mocked(wasm.removeUserProtocol).mockReturnValueOnce(false);
    useCircuitStore.getState().removeProtocol("alpha");
    expect(useCircuitStore.getState().importedProtocols).toHaveLength(1);
  });

  it("propagates errors via setError", () => {
    vi.mocked(wasm.removeUserProtocol).mockImplementationOnce(() => {
      throw new Error("remove failed");
    });
    useCircuitStore.getState().removeProtocol("alpha");
    expect(useCircuitStore.getState().error).toContain("remove failed");
  });
});

// ── refreshProtocols ────────────────────────────────────────────────

describe("refreshProtocols", () => {
  it("replaces importedProtocols with the bridge's list", () => {
    vi.mocked(wasm.listUserProtocols).mockReturnValueOnce([
      makeProtocolSummary({ name: "one" }),
      makeProtocolSummary({ name: "two" }),
    ]);
    useCircuitStore.getState().refreshProtocols();
    const ps = useCircuitStore.getState().importedProtocols;
    expect(ps.map((p) => p.name)).toEqual(["one", "two"]);
  });

  it("maps snake_case bridge fields to camelCase store fields", () => {
    vi.mocked(wasm.listUserProtocols).mockReturnValueOnce([
      makeProtocolSummary({
        name: "p",
        schema_theory: "st",
        instance_theory: "it",
        obj_kind_count: 5,
        constraint_sort_count: 2,
        edge_rule_count: 3,
        has_order: true,
        has_coproducts: true,
        has_recursion: true,
        has_causal: true,
        nominal_identity: true,
        has_defaults: true,
        has_coercions: true,
        has_mergers: true,
        has_policies: true,
      }),
    ]);
    useCircuitStore.getState().refreshProtocols();
    const p = useCircuitStore.getState().importedProtocols[0];
    expect(p.schemaTheory).toBe("st");
    expect(p.instanceTheory).toBe("it");
    expect(p.objKindCount).toBe(5);
    expect(p.constraintSortCount).toBe(2);
    expect(p.edgeRuleCount).toBe(3);
    expect(p.hasOrder).toBe(true);
    expect(p.hasCoproducts).toBe(true);
    expect(p.hasRecursion).toBe(true);
    expect(p.hasCausal).toBe(true);
    expect(p.nominalIdentity).toBe(true);
    expect(p.hasDefaults).toBe(true);
    expect(p.hasCoercions).toBe(true);
    expect(p.hasMergers).toBe(true);
    expect(p.hasPolicies).toBe(true);
  });

  it("sets handle to -1 since listUserProtocols doesn't return handles", () => {
    vi.mocked(wasm.listUserProtocols).mockReturnValueOnce([
      makeProtocolSummary({ name: "one" }),
    ]);
    useCircuitStore.getState().refreshProtocols();
    expect(useCircuitStore.getState().importedProtocols[0].handle).toBe(-1);
  });

  it("propagates errors via setError", () => {
    vi.mocked(wasm.listUserProtocols).mockImplementationOnce(() => {
      throw new Error("list failed");
    });
    useCircuitStore.getState().refreshProtocols();
    expect(useCircuitStore.getState().error).toContain("list failed");
  });
});

// ── getProtocolJson ─────────────────────────────────────────────────

describe("getProtocolJson", () => {
  it("returns the JSON body from the bridge", () => {
    vi.mocked(wasm.getUserProtocolJson).mockReturnValueOnce('{"name":"p"}');
    const result = useCircuitStore.getState().getProtocolJson("p");
    expect(result).toBe('{"name":"p"}');
    expect(wasm.getUserProtocolJson).toHaveBeenCalledWith("p");
  });

  it("returns null on error and sets error", () => {
    vi.mocked(wasm.getUserProtocolJson).mockImplementationOnce(() => {
      throw new Error("not found");
    });
    const result = useCircuitStore.getState().getProtocolJson("p");
    expect(result).toBeNull();
    expect(useCircuitStore.getState().error).toContain("not found");
  });
});

// ── assignSourceSchema ──────────────────────────────────────────────

describe("assignSourceSchema", () => {
  it("calls wasm.setSourceSchema and sets sourceSchemaHandle", () => {
    seedWithHandle(2);
    useCircuitStore.getState().assignSourceSchema(7);
    expect(wasm.setSourceSchema).toHaveBeenCalledWith(2, 7);
    const s = useCircuitStore.getState();
    expect(s.sourceSchemaHandle).toBe(7);
    expect(s.evaluationError).toBeNull();
  });

  it("does nothing when circuitHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: null });
    useCircuitStore.getState().assignSourceSchema(7);
    expect(wasm.setSourceSchema).not.toHaveBeenCalled();
  });

  it("propagates errors via evaluationError", () => {
    seedWithHandle(2);
    vi.mocked(wasm.setSourceSchema).mockImplementationOnce(() => {
      throw new Error("assign failed");
    });
    useCircuitStore.getState().assignSourceSchema(7);
    expect(useCircuitStore.getState().evaluationError).toContain("assign failed");
  });
});

// ── setInputData ────────────────────────────────────────────────────

describe("setInputData", () => {
  it("updates inputDataJson", () => {
    useCircuitStore.getState().setInputData('{"new":true}');
    expect(useCircuitStore.getState().inputDataJson).toBe('{"new":true}');
  });
});

// ── runEvaluation ───────────────────────────────────────────────────

describe("runEvaluation", () => {
  it("calls wasm.setInputData then wasm.evaluateCircuit", () => {
    useCircuitStore.setState({
      circuitHandle: 3,
      sourceSchemaHandle: 1,
      inputDataJson: '{"a":1}',
    });
    useCircuitStore.getState().runEvaluation();
    expect(wasm.setInputData).toHaveBeenCalledWith(3, '{"a":1}');
    expect(wasm.evaluateCircuit).toHaveBeenCalledWith(3);
    const setInputOrder = vi.mocked(wasm.setInputData).mock
      .invocationCallOrder[0];
    const evalOrder = vi.mocked(wasm.evaluateCircuit).mock
      .invocationCallOrder[0];
    expect(setInputOrder).toBeLessThan(evalOrder);
  });

  it("sets outputDataJson and wireDataMap from the result", () => {
    useCircuitStore.setState({ circuitHandle: 3, sourceSchemaHandle: 1 });
    vi.mocked(wasm.evaluateCircuit).mockReturnValueOnce({
      output: '{"ok":true}',
      wire_data: { "w_1": '{"x":1}', "w_2": '{"y":2}' },
      success: true,
    });
    useCircuitStore.getState().runEvaluation();
    const s = useCircuitStore.getState();
    expect(s.outputDataJson).toBe('{"ok":true}');
    expect(s.wireDataMap).toEqual({ "w_1": '{"x":1}', "w_2": '{"y":2}' });
    expect(s.evaluationError).toBeNull();
  });

  it("sets evaluationError when circuitHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: null, sourceSchemaHandle: 1 });
    useCircuitStore.getState().runEvaluation();
    expect(useCircuitStore.getState().evaluationError).toContain(
      "no circuit loaded",
    );
    expect(wasm.evaluateCircuit).not.toHaveBeenCalled();
  });

  it("sets evaluationError when sourceSchemaHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: 3, sourceSchemaHandle: null });
    useCircuitStore.getState().runEvaluation();
    expect(useCircuitStore.getState().evaluationError).toContain(
      "no source schema assigned",
    );
    expect(wasm.evaluateCircuit).not.toHaveBeenCalled();
  });

  it("propagates bridge errors", () => {
    useCircuitStore.setState({ circuitHandle: 3, sourceSchemaHandle: 1 });
    vi.mocked(wasm.evaluateCircuit).mockImplementationOnce(() => {
      throw new Error("eval failed");
    });
    useCircuitStore.getState().runEvaluation();
    expect(useCircuitStore.getState().evaluationError).toContain("eval failed");
  });
});

// ── applyModifiedOutput ─────────────────────────────────────────────

describe("applyModifiedOutput", () => {
  it("calls wasm.applyModifiedOutput and updates inputDataJson/outputDataJson", () => {
    seedWithHandle(3);
    vi.mocked(wasm.applyModifiedOutput).mockReturnValueOnce('{"restored":1}');
    useCircuitStore.getState().applyModifiedOutput('{"edited":2}');
    expect(wasm.applyModifiedOutput).toHaveBeenCalledWith(3, '{"edited":2}');
    const s = useCircuitStore.getState();
    expect(s.inputDataJson).toBe('{"restored":1}');
    expect(s.outputDataJson).toBe('{"edited":2}');
    expect(s.evaluationError).toBeNull();
  });

  it("does nothing when circuitHandle is null", () => {
    useCircuitStore.setState({ circuitHandle: null });
    useCircuitStore.getState().applyModifiedOutput("{}");
    expect(wasm.applyModifiedOutput).not.toHaveBeenCalled();
  });

  it("propagates errors via evaluationError", () => {
    seedWithHandle(3);
    vi.mocked(wasm.applyModifiedOutput).mockImplementationOnce(() => {
      throw new Error("put failed");
    });
    useCircuitStore.getState().applyModifiedOutput("{}");
    expect(useCircuitStore.getState().evaluationError).toContain("put failed");
  });
});

// ── buildTheoryFromJson ─────────────────────────────────────────────

describe("buildTheoryFromJson", () => {
  it("appends to importedTheories with sort/op counts from getTheoryDetails", () => {
    vi.mocked(wasm.compileTheoryBundle).mockReturnValueOnce({
      id: "b",
      theories: [["t1", 10]],
      protocols: [],
      morphisms: [],
    });
    vi.mocked(wasm.getTheoryDetails).mockReturnValueOnce({
      name: "T-One",
      sorts: ["A", "B"],
      ops: ["f", "g", "h"],
      equation_count: 0,
    });
    useCircuitStore.getState().buildTheoryFromJson("{}");
    const t = useCircuitStore.getState().importedTheories;
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({
      handle: 10,
      name: "T-One",
      sortCount: 2,
      opCount: 3,
    });
  });

  it("propagates errors via setError", () => {
    vi.mocked(wasm.compileTheoryBundle).mockImplementationOnce(() => {
      throw new Error("compile failed");
    });
    useCircuitStore.getState().buildTheoryFromJson("{}");
    expect(useCircuitStore.getState().error).toContain("compile failed");
  });

  it("handles the result.theories array correctly", () => {
    vi.mocked(wasm.compileTheoryBundle).mockReturnValueOnce({
      id: "b",
      theories: [
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ],
      protocols: [],
      morphisms: [],
    });
    // Each details call returns the default single-sort theory.
    useCircuitStore.getState().buildTheoryFromJson("{}");
    const t = useCircuitStore.getState().importedTheories;
    expect(t).toHaveLength(3);
    expect(t.map((x) => x.handle)).toEqual([1, 2, 3]);
  });
});

// ── composeTheories ─────────────────────────────────────────────────

describe("composeTheories", () => {
  it("calls wasm.composeTheoriesViaColimit with the right args", () => {
    useCircuitStore.getState().composeTheories(1, 2, ["X", "Y"]);
    expect(wasm.composeTheoriesViaColimit).toHaveBeenCalledWith(1, 2, [
      "X",
      "Y",
    ]);
    expect(useCircuitStore.getState().importedTheories).toHaveLength(1);
  });

  it("handles errors via setError", () => {
    vi.mocked(wasm.composeTheoriesViaColimit).mockImplementationOnce(() => {
      throw new Error("no colimit");
    });
    useCircuitStore.getState().composeTheories(1, 2, []);
    expect(useCircuitStore.getState().error).toContain("no colimit");
  });
});

// ── applyGraph ──────────────────────────────────────────────────────

describe("applyGraph", () => {
  it("converts GraphNode/GraphEdge to React Flow Node/Edge", () => {
    const graph = {
      nodes: [
        makeGraphNode({ id: "n1", component_type: "rename_field" }),
      ],
      edges: [
        makeGraphEdge({ id: "w1", source: "n1", target: "n1" }),
      ],
    };
    useCircuitStore.getState().applyGraph(graph);
    const s = useCircuitStore.getState();
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0].id).toBe("n1");
    expect(s.nodes[0].type).toBe("component");
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0].id).toBe("w1");
    expect(s.edges[0].type).toBe("wire");
    expect(s.edges[0].sourceHandle).toBe("out");
    expect(s.edges[0].targetHandle).toBe("in");
  });

  it("uses catalog display label when available", () => {
    const graph = {
      nodes: [
        makeGraphNode({
          id: "n1",
          component_type: "rename_field",
          label: "backend-label-ignored",
        }),
      ],
      edges: [],
    };
    useCircuitStore.getState().applyGraph(graph);
    const node = useCircuitStore.getState().nodes[0];
    expect(node.data.label).toBe("RenameField");
  });

  it("falls back to backend label when catalog doesn't have the component", () => {
    const graph = {
      nodes: [
        makeGraphNode({
          id: "n1",
          component_type: "totally_unknown",
          label: "from-backend",
        }),
      ],
      edges: [],
    };
    useCircuitStore.getState().applyGraph(graph);
    const node = useCircuitStore.getState().nodes[0];
    expect(node.data.label).toBe("from-backend");
  });
});

// ── setError ────────────────────────────────────────────────────────

describe("setError", () => {
  it("sets the error state", () => {
    useCircuitStore.getState().setError("something broke");
    expect(useCircuitStore.getState().error).toBe("something broke");
  });

  it("setError(null) clears the error", () => {
    useCircuitStore.setState({ error: "old" });
    useCircuitStore.getState().setError(null);
    expect(useCircuitStore.getState().error).toBeNull();
  });
});

// ── setMode URL rewriting ───────────────────────────────────────────

// `setMode` runs from App's boot effect and rewrites the URL. atproto
// OAuth uses `response_mode=fragment`, so a completed sign-in returns to
// `/#code=...&state=...`. Dropping the fragment here turns the callback
// into an ordinary page load: the authorization request has already
// succeeded, but the token exchange never runs, and the user lands on a
// signed-out app with no error to explain it.
describe("setMode URL rewriting", () => {
  const setUrl = (url: string) => window.history.replaceState(null, "", url);

  it("preserves an OAuth callback fragment when entering presentation mode", () => {
    setUrl("/?foo=bar#code=abc123&state=xyz789");
    useCircuitStore.getState().setMode("presentation");
    expect(window.location.hash).toBe("#code=abc123&state=xyz789");
    expect(window.location.search).toContain("mode=presentation");
  });

  it("preserves the fragment when leaving presentation mode", () => {
    setUrl("/?mode=presentation#code=abc123&state=xyz789");
    useCircuitStore.getState().setMode("edit");
    expect(window.location.hash).toBe("#code=abc123&state=xyz789");
    expect(window.location.search).not.toContain("mode=presentation");
  });

  it("leaves the URL fragment-free when there was none", () => {
    setUrl("/?mode=presentation");
    useCircuitStore.getState().setMode("edit");
    expect(window.location.hash).toBe("");
  });

  it("keeps unrelated query params alongside the mode flag", () => {
    setUrl("/?c=encodedcircuit");
    useCircuitStore.getState().setMode("presentation");
    expect(window.location.search).toContain("c=encodedcircuit");
    expect(window.location.search).toContain("mode=presentation");
  });
});
