/**
 * Tests for target schema assignment and automatic lens generation.
 *
 * These test the store actions: assignTargetSchema, generateCandidates,
 * selectCandidate, and their interaction with assignSourceSchema and
 * the circuit state. The auto-lens flow runs entirely through the
 * candidates API now — `assignTargetSchema → generateCandidates →
 * selectCandidate(0)` installs the top candidate's chain as circuit
 * components via `installCandidateComponents`. The legacy
 * `autoGenerateLens` / `autoGenerateAndStore` path is gone.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCircuitStore, emptyPresentationDoc } from "../circuitStore";
import {
  resetMockBridge,
  autoGenerateCandidates,
  installCandidateComponents,
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
      autoLensHints: {},
      autoLensCandidates: [],
      selectedCandidateIdx: null,
      discoveredAnchors: [],
      stringency: "balanced" as const,
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

  it("triggers the candidates API when set to a non-null value", () => {
    // generateCandidates needs source + target. Set source so the
    // auto-generate path actually fires.
    resetStore({ sourceSchemaHandle: 1, circuitHandle: 0 });
    useCircuitStore.getState().assignTargetSchema(2);
    expect(autoGenerateCandidates).toHaveBeenCalled();
    // selectCandidate(0) installs the top candidate's components.
    expect(installCandidateComponents).toHaveBeenCalledWith(0, 99, 1, 2);
  });

  it("does NOT trigger candidate generation when set to null", () => {
    resetStore({ sourceSchemaHandle: 1, circuitHandle: 0 });
    useCircuitStore.getState().assignTargetSchema(null);
    expect(autoGenerateCandidates).not.toHaveBeenCalled();
    expect(installCandidateComponents).not.toHaveBeenCalled();
  });
});

// ── generateCandidates + selectCandidate ────────────────────────────

describe("generateCandidates + selectCandidate", () => {
  it("does nothing when sourceSchemaHandle is null", () => {
    resetStore({ circuitHandle: 0, sourceSchemaHandle: null, targetSchemaHandle: 5 });
    useCircuitStore.getState().generateCandidates();
    expect(autoGenerateCandidates).not.toHaveBeenCalled();
  });

  it("does nothing when targetSchemaHandle is null", () => {
    resetStore({ circuitHandle: 0, sourceSchemaHandle: 1, targetSchemaHandle: null });
    useCircuitStore.getState().generateCandidates();
    expect(autoGenerateCandidates).not.toHaveBeenCalled();
  });

  it("calls the candidates wasm path and installs the top candidate", () => {
    resetStore({ circuitHandle: 10, sourceSchemaHandle: 1, targetSchemaHandle: 2 });
    useCircuitStore.getState().generateCandidates();
    expect(autoGenerateCandidates).toHaveBeenCalledWith(1, 2, expect.any(Object));
    expect(installCandidateComponents).toHaveBeenCalledWith(10, 99, 1, 2);
  });

  it("applies the installed graph to the store", () => {
    resetStore({ circuitHandle: 0, sourceSchemaHandle: 1, targetSchemaHandle: 2 });
    useCircuitStore.getState().generateCandidates();
    // The mock returns defaultGraph() which has 3 nodes.
    expect(useCircuitStore.getState().nodes.length).toBe(3);
  });

  it("sets autoLensHandle + chain + mapping on success", () => {
    resetStore({
      circuitHandle: 0,
      sourceSchemaHandle: 1,
      targetSchemaHandle: 2,
      evaluationError: "old error",
    });
    useCircuitStore.getState().generateCandidates();
    const s = useCircuitStore.getState();
    expect(s.autoLensStatus).toBe("success");
    expect(s.autoLensHandle).toBe(99);
    expect(s.autoLensChainSteps.length).toBeGreaterThan(0);
    expect(s.autoLensSchemaMapping).not.toBeNull();
    expect(s.autoLensError).toBeNull();
    expect(s.autoLensCandidates.length).toBe(1);
    expect(s.selectedCandidateIdx).toBe(0);
  });

  it("sets autoLensError + empty discoveredAnchors when the CSP finds nothing", () => {
    autoGenerateCandidates.mockImplementation(() => {
      throw new Error("no morphism found between schemas");
    });
    resetStore({ circuitHandle: 0, sourceSchemaHandle: 1, targetSchemaHandle: 2 });
    useCircuitStore.getState().generateCandidates();
    const s = useCircuitStore.getState();
    expect(s.autoLensError).toContain("no morphism found");
    expect(s.autoLensCandidates).toEqual([]);
    expect(s.selectedCandidateIdx).toBeNull();
  });
});

// ── Integration: assignSourceSchema does NOT trigger auto-lens ──────

describe("assignSourceSchema interaction", () => {
  it("does not call the candidates API (only target assignment does)", () => {
    resetStore({ circuitHandle: 0 });
    useCircuitStore.getState().assignSourceSchema(1);
    expect(autoGenerateCandidates).not.toHaveBeenCalled();
  });

  it("refreshes the graph for optic reclassification", () => {
    resetStore({ circuitHandle: 0 });
    useCircuitStore.getState().assignSourceSchema(1);
    expect(setSourceSchema).toHaveBeenCalledWith(0, 1);
    expect(useCircuitStore.getState().sourceSchemaHandle).toBe(1);
  });
});
