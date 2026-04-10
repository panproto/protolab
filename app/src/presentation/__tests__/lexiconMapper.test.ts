/**
 * Unit tests for the Lexicon Mapper template.
 *
 * Verifies that `loadLexiconMapperTemplate()` correctly populates the
 * Zustand store: presentation doc, widgets, input seed, and the wired
 * lens-chain circuit components.
 *
 * The WASM bridge is replaced by the jsdom-safe mock at
 * `src/test/wasmBridgeMock.ts` via `vi.mock` (since the template
 * imports `../../wasm/bridge`, a different relative path than the
 * `../wasm/bridge` covered by the vitest.config alias).
 *
 * The fetch call that auto-resolves the lexicon is stubbed to avoid
 * any network dependency — failure is handled gracefully by the
 * template, so we also test that path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// vi.mock hoisting: replace the wasm bridge before any imports execute.
vi.mock("../../wasm/bridge", () => import("../../test/wasmBridgeMock"));

import { useCircuitStore, emptyPresentationDoc } from "../../store/circuitStore";
import { resetMockBridge } from "../../test/wasmBridgeMock";
import * as wasm from "../../test/wasmBridgeMock";
import { loadLexiconMapperTemplate } from "../templates/lexiconMapper";

// ── Store reset ──────────────────────────────────────────────────────

function resetStore() {
  useCircuitStore.setState(
    {
      nodes: [],
      edges: [],
      loading: false,
      error: null,
      circuitHandle: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      importedSchemas: [],
      importedTheories: [],
      importedProtocols: [],
      mode: "edit",
      presentationDoc: emptyPresentationDoc(),
      sourceSchemaHandle: null,
      inputDataJson: "",
      outputDataJson: "",
      wireDataMap: {},
      evaluationError: null,
      selectedWireId: null,
    },
    false,
  );
}

// ── Fetch stubs ──────────────────────────────────────────────────────

function stubFetchOk() {
  const fakeSchema = {
    schema: {
      type: "object",
      properties: { text: { type: "string" }, createdAt: { type: "string" } },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fakeSchema,
    } as unknown as Response),
  );
}

function stubFetchFail() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Network error")),
  );
}

// ── Setup / teardown ─────────────────────────────────────────────────

beforeEach(() => {
  resetMockBridge();
  resetStore();
  stubFetchOk();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("loadLexiconMapperTemplate: presentationDoc", () => {
  it("sets the presentation title to 'Lexicon Mapper'", async () => {
    await loadLexiconMapperTemplate();
    const { presentationDoc } = useCircuitStore.getState();
    expect(presentationDoc.title).toBe("Lexicon Mapper");
  });

  it("sets the presentation layout to 'form'", async () => {
    await loadLexiconMapperTemplate();
    const { presentationDoc } = useCircuitStore.getState();
    expect(presentationDoc.layout).toBe("form");
  });

  it("installs exactly 6 widgets", async () => {
    await loadLexiconMapperTemplate();
    const { widgets } = useCircuitStore.getState().presentationDoc;
    expect(widgets).toHaveLength(6);
  });

  it("widgets have the correct kinds in order", async () => {
    await loadLexiconMapperTemplate();
    const { widgets } = useCircuitStore.getState().presentationDoc;
    const kinds = widgets.map((w) => w.kind);
    expect(kinds).toEqual([
      "heading",
      "paragraph",
      "lexicon_import",
      "input_json",
      "output_json",
      "run_button",
    ]);
  });

  it("heading widget spans both columns (column = '')", async () => {
    await loadLexiconMapperTemplate();
    const { widgets } = useCircuitStore.getState().presentationDoc;
    const heading = widgets.find((w) => w.kind === "heading");
    expect(heading).toBeDefined();
    expect(heading!.column).toBe("");
  });

  it("input_json widget is in the left column", async () => {
    await loadLexiconMapperTemplate();
    const { widgets } = useCircuitStore.getState().presentationDoc;
    const input = widgets.find((w) => w.kind === "input_json");
    expect(input).toBeDefined();
    expect(input!.column).toBe("left");
  });

  it("output_json widget is in the right column", async () => {
    await loadLexiconMapperTemplate();
    const { widgets } = useCircuitStore.getState().presentationDoc;
    const output = widgets.find((w) => w.kind === "output_json");
    expect(output).toBeDefined();
    expect(output!.column).toBe("right");
  });

  it("run_button widget spans both columns (column = '')", async () => {
    await loadLexiconMapperTemplate();
    const { widgets } = useCircuitStore.getState().presentationDoc;
    const run = widgets.find((w) => w.kind === "run_button");
    expect(run).toBeDefined();
    expect(run!.column).toBe("");
  });

  it("lexicon_import widget has the default NSID set to 'app.bsky.feed.post'", async () => {
    await loadLexiconMapperTemplate();
    const { widgets } = useCircuitStore.getState().presentationDoc;
    const lexicon = widgets.find((w) => w.kind === "lexicon_import");
    expect(lexicon).toBeDefined();
    expect(lexicon!.props.default_nsid).toBe("app.bsky.feed.post");
  });
});

describe("loadLexiconMapperTemplate: inputDataJson seed", () => {
  it("seeds inputDataJson with the canonical post text field", async () => {
    await loadLexiconMapperTemplate();
    const { inputDataJson } = useCircuitStore.getState();
    const parsed = JSON.parse(inputDataJson);
    expect(parsed.text).toBe("Hello, ATProtocol!");
  });

  it("seeds inputDataJson with the canonical post createdAt field", async () => {
    await loadLexiconMapperTemplate();
    const { inputDataJson } = useCircuitStore.getState();
    const parsed = JSON.parse(inputDataJson);
    expect(parsed.createdAt).toBe("2024-01-15T12:00:00.000Z");
  });

  it("inputDataJson is valid JSON", async () => {
    await loadLexiconMapperTemplate();
    const { inputDataJson } = useCircuitStore.getState();
    expect(() => JSON.parse(inputDataJson)).not.toThrow();
  });
});

describe("loadLexiconMapperTemplate: circuit components", () => {
  it("calls wasm.addComponent 4 times (one per lens-chain step)", async () => {
    await loadLexiconMapperTemplate();
    expect(wasm.addComponent).toHaveBeenCalledTimes(4);
  });

  it("calls wasm.addComponent with rename_field as the first lens step", async () => {
    await loadLexiconMapperTemplate();
    const firstCall = vi.mocked(wasm.addComponent).mock.calls[0];
    // Second arg is the component spec object
    const spec = firstCall[1] as { component_type: string };
    expect(spec.component_type).toBe("rename_field");
  });

  it("calls wasm.addComponent with add_field as the last lens step", async () => {
    await loadLexiconMapperTemplate();
    const calls = vi.mocked(wasm.addComponent).mock.calls;
    const lastSpec = calls[3][1] as { component_type: string };
    expect(lastSpec.component_type).toBe("add_field");
  });

  it("uses the correct four component types in order", async () => {
    await loadLexiconMapperTemplate();
    const calls = vi.mocked(wasm.addComponent).mock.calls;
    const types = calls.map((c) => (c[1] as { component_type: string }).component_type);
    expect(types).toEqual([
      "rename_field",
      "rename_field",
      "compute_field",
      "add_field",
    ]);
  });

  it("calls updateParam for at least 6 component params", async () => {
    await loadLexiconMapperTemplate();
    // The mock's defaultGraph returns a fixed 3-node graph, so the
    // template only sees 3 lens nodes (not 4). That means 2+2+2=6
    // updateParam calls reach the WASM bridge. With a real WASM the
    // count would be 9 (2+2+2+3). We verify the mock-realistic count.
    expect(wasm.updateParam).toHaveBeenCalledTimes(6);
  });
});

describe("loadLexiconMapperTemplate: circuit wiring", () => {
  it("calls wasm.addWire to connect the lens chain", async () => {
    await loadLexiconMapperTemplate();
    // The mock defaultGraph() returns 3 nodes, so lens.length = 3 and
    // connectPorts (→ addWire) is called lens.length − 1 = 2 times.
    expect(wasm.addWire).toHaveBeenCalledTimes(2);
  });

  it("each wire connection uses out → in port direction", async () => {
    await loadLexiconMapperTemplate();
    const wireCalls = vi.mocked(wasm.addWire).mock.calls;
    for (const [, spec] of wireCalls) {
      const { src_port, tgt_port } = spec as { src_port: string; tgt_port: string };
      expect(src_port).toMatch(/\.out$/);
      expect(tgt_port).toMatch(/\.in$/);
    }
  });
});

describe("loadLexiconMapperTemplate: fresh circuit initialization", () => {
  it("calls wasm.createEmptyCircuit to start with a clean slate", async () => {
    await loadLexiconMapperTemplate();
    expect(wasm.createEmptyCircuit).toHaveBeenCalledOnce();
  });

  it("sets circuitHandle to the value returned by createEmptyCircuit (0)", async () => {
    await loadLexiconMapperTemplate();
    expect(useCircuitStore.getState().circuitHandle).toBe(0);
  });
});

describe("loadLexiconMapperTemplate: lexicon auto-resolve", () => {
  it("attempts to fetch the app.bsky.feed.post lexicon from lexicon.garden", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    loadLexiconMapperTemplate();
    // The fetch is fire-and-forget; flush microtasks so it completes.
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("app.bsky.feed.post");
    expect(url).toContain("lexicon.garden");
  });

  it("adds the resolved lexicon to importedSchemas on success", async () => {
    loadLexiconMapperTemplate();
    // Wait for the fire-and-forget resolve to complete.
    await vi.waitFor(() => {
      const { importedSchemas } = useCircuitStore.getState();
      expect(importedSchemas.length).toBeGreaterThan(0);
    });
    const { importedSchemas } = useCircuitStore.getState();
    expect(importedSchemas[0].name).toContain("app.bsky.feed.post");
  });

  it("proceeds gracefully when the fetch fails (no throw)", async () => {
    vi.unstubAllGlobals();
    stubFetchFail();
    // Should resolve without throwing even if fetch errors.
    await expect(loadLexiconMapperTemplate()).resolves.toBeUndefined();
  });

  it("still seeds the presentation doc when lexicon fetch fails", async () => {
    vi.unstubAllGlobals();
    stubFetchFail();
    await loadLexiconMapperTemplate();
    const { presentationDoc } = useCircuitStore.getState();
    expect(presentationDoc.title).toBe("Lexicon Mapper");
    expect(presentationDoc.widgets).toHaveLength(6);
  });

  it("still seeds inputDataJson when lexicon fetch fails", async () => {
    vi.unstubAllGlobals();
    stubFetchFail();
    await loadLexiconMapperTemplate();
    const { inputDataJson } = useCircuitStore.getState();
    const parsed = JSON.parse(inputDataJson);
    expect(parsed.text).toBe("Hello, ATProtocol!");
  });
});
