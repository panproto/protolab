/**
 * Tests for target schema assignment and automatic lens generation.
 *
 * These test the store actions: assignTargetSchema, autoGenerateLens,
 * and their interaction with assignSourceSchema and the circuit state.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCircuitStore, emptyPresentationDoc } from "../circuitStore";
import {
  resetMockBridge,
  autoGenerateAndStore,
  evaluateAutoLens,
  setSourceSchema,
} from "../../test/wasmBridgeMock";

function resetStore(
  overrides: Partial<ReturnType<typeof useCircuitStore.getState>> = {},
) {
  useCircuitStore.setState(
    {
      nodes: [],
      edges: [],
      loading: false,
      error: null,
      circuitHandle: 0,
      selectedNodeId: null,
      selectedEdgeId: null,
      importedSchemas: [],
      importedTheories: [],
      importedProtocols: [],
      mode: "edit",
      presentationDoc: emptyPresentationDoc(),
      sourceSchemaHandle: null,
      targetSchemaHandle: null,
      autoLensHandle: null,
      autoLensComplementHandle: null,
      autoLensStatus: "idle" as const,
      autoLensError: null,
      autoLensChainSteps: [],
      autoLensSchemaMapping: null,
      inputDataJson: "",
      outputDataJson: "",
      wireDataMap: {},
      evaluationError: null,
      selectedWireId: null,
      ...overrides,
    },
    false,
  );
}

beforeEach(() => {
  resetMockBridge();
  resetStore();
});

// ── assignTargetSchema ──────────────────────────────────────────────

describe("assignTargetSchema", () => {
  it("sets targetSchemaHandle in the store", () => {
    useCircuitStore.getState().assignTargetSchema(42);
    expect(useCircuitStore.getState().targetSchemaHandle).toBe(42);
  });

  it("accepts null to clear the target", () => {
    useCircuitStore.getState().assignTargetSchema(42);
    useCircuitStore.getState().assignTargetSchema(null);
    expect(useCircuitStore.getState().targetSchemaHandle).toBeNull();
  });

  it("triggers autoGenerateLens when set to a non-null value", () => {
    // autoGenerateLens requires both source + target + circuitHandle.
    // Set source so the auto-generate path actually fires.
    resetStore({ sourceSchemaHandle: 1, circuitHandle: 0 });
    useCircuitStore.getState().assignTargetSchema(2);
    // The WASM autoGenerateLens mock should have been called.
    expect(autoGenerateAndStore).toHaveBeenCalledWith(0, 1, 2);
  });

  it("does NOT trigger autoGenerateLens when set to null", () => {
    resetStore({ sourceSchemaHandle: 1, circuitHandle: 0 });
    useCircuitStore.getState().assignTargetSchema(null);
    expect(autoGenerateAndStore).not.toHaveBeenCalled();
  });
});

// ── autoGenerateLens ────────────────────────────────────────────────

describe("autoGenerateLens", () => {
  it("does nothing when sourceSchemaHandle is null", () => {
    resetStore({ circuitHandle: 0, sourceSchemaHandle: null, targetSchemaHandle: 5 });
    useCircuitStore.getState().autoGenerateLens();
    expect(autoGenerateAndStore).not.toHaveBeenCalled();
  });

  it("does nothing when targetSchemaHandle is null", () => {
    resetStore({ circuitHandle: 0, sourceSchemaHandle: 1, targetSchemaHandle: null });
    useCircuitStore.getState().autoGenerateLens();
    expect(autoGenerateAndStore).not.toHaveBeenCalled();
  });

  it("does nothing when circuitHandle is null", () => {
    resetStore({ circuitHandle: null, sourceSchemaHandle: 1, targetSchemaHandle: 2 });
    useCircuitStore.getState().autoGenerateLens();
    expect(autoGenerateAndStore).not.toHaveBeenCalled();
  });

  it("calls wasm.autoGenerateAndStore with correct handles", () => {
    resetStore({ circuitHandle: 10, sourceSchemaHandle: 1, targetSchemaHandle: 2 });
    useCircuitStore.getState().autoGenerateLens();
    expect(autoGenerateAndStore).toHaveBeenCalledWith(10, 1, 2);
  });

  it("applies the returned graph to the store", () => {
    resetStore({ circuitHandle: 0, sourceSchemaHandle: 1, targetSchemaHandle: 2 });
    useCircuitStore.getState().autoGenerateLens();
    // The mock returns defaultGraph() which has 3 nodes.
    expect(useCircuitStore.getState().nodes.length).toBe(3);
  });

  it("sets autoLensHandle + status on success", () => {
    resetStore({
      circuitHandle: 0,
      sourceSchemaHandle: 1,
      targetSchemaHandle: 2,
      evaluationError: "old error",
    });
    useCircuitStore.getState().autoGenerateLens();
    expect(useCircuitStore.getState().evaluationError).toBeNull();
    expect(useCircuitStore.getState().autoLensStatus).toBe("success");
    expect(useCircuitStore.getState().autoLensHandle).toBe(99);
    expect(useCircuitStore.getState().autoLensChainSteps.length).toBeGreaterThan(0);
    expect(useCircuitStore.getState().autoLensSchemaMapping).not.toBeNull();
    expect(useCircuitStore.getState().autoLensError).toBeNull();
  });

  it("sets autoLensStatus to 'failed' on failure (does NOT set evaluationError)", () => {
    autoGenerateAndStore.mockImplementation(() => {
      throw new Error("no morphism found between schemas");
    });
    resetStore({
      circuitHandle: 0,
      sourceSchemaHandle: 1,
      targetSchemaHandle: 2,
      evaluationError: null,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    useCircuitStore.getState().autoGenerateLens();
    expect(useCircuitStore.getState().evaluationError).toBeNull();
    expect(useCircuitStore.getState().autoLensStatus).toBe("failed");
    expect(useCircuitStore.getState().autoLensError).toContain("no morphism found");
    expect(warnSpy).toHaveBeenCalledWith(
      "Auto-lens generation failed:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("preserves existing nodes when auto-lens throws", () => {
    autoGenerateAndStore.mockImplementation(() => {
      throw new Error("no morphism");
    });
    const existingNodes = [
      {
        id: "comp_0",
        type: "component",
        position: { x: 0, y: 0 },
        data: { label: "RenameField", componentType: "rename_field", opticKind: "iso", ports: [], params: [] },
      },
    ];
    resetStore({
      circuitHandle: 0,
      sourceSchemaHandle: 1,
      targetSchemaHandle: 2,
      nodes: existingNodes as any,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useCircuitStore.getState().autoGenerateLens();
    // The existing node should survive (circuit not cleared on failure).
    expect(useCircuitStore.getState().nodes).toEqual(existingNodes);
    vi.restoreAllMocks();
  });
});

// ── Integration: assignSourceSchema does NOT trigger auto-lens ──────

describe("assignSourceSchema interaction", () => {
  it("does not call autoGenerateLens (only target assignment does)", () => {
    resetStore({ circuitHandle: 0 });
    useCircuitStore.getState().assignSourceSchema(1);
    expect(autoGenerateAndStore).not.toHaveBeenCalled();
  });

  it("refreshes the graph for optic reclassification", () => {
    resetStore({ circuitHandle: 0 });
    useCircuitStore.getState().assignSourceSchema(1);
    expect(setSourceSchema).toHaveBeenCalledWith(0, 1);
    expect(useCircuitStore.getState().sourceSchemaHandle).toBe(1);
  });
});
