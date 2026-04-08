import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColimitComposer } from "../ColimitComposer";
import { useCircuitStore } from "../../store/circuitStore";
import { resetMockBridge, getTheoryDetails } from "../../test/wasmBridgeMock";

function resetStore(overrides: Partial<ReturnType<typeof useCircuitStore.getState>> = {}) {
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
      sourceSchemaHandle: null,
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

function spyAction<K extends keyof ReturnType<typeof useCircuitStore.getState>>(key: K) {
  const fn = vi.fn();
  useCircuitStore.setState({ [key]: fn } as any);
  return fn;
}

beforeEach(() => {
  resetMockBridge();
  resetStore();
});

describe("ColimitComposer", () => {
  it("renders two theory selectors when at least 2 theories exist", () => {
    resetStore({
      importedTheories: [
        { handle: 1, name: "monoid", sortCount: 1, opCount: 2 },
        { handle: 2, name: "group", sortCount: 1, opCount: 3 },
      ],
    });
    render(<ColimitComposer onClose={() => {}} />);
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBe(2);
  });

  it("shows empty state when fewer than 2 theories", () => {
    resetStore({ importedTheories: [] });
    render(<ColimitComposer onClose={() => {}} />);
    expect(screen.getByText(/Need at least 2 imported theories/)).toBeInTheDocument();
  });

  it("compose button calls composeTheories", async () => {
    const compose = spyAction("composeTheories");
    resetStore({
      importedTheories: [
        { handle: 1, name: "monoid", sortCount: 1, opCount: 2 },
        { handle: 2, name: "group", sortCount: 1, opCount: 3 },
      ],
      composeTheories: compose,
    });
    render(<ColimitComposer onClose={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Compose" }));
    expect(compose).toHaveBeenCalledWith(1, 2, expect.any(Array));
  });

  it("shared sorts intersection: selecting a shared sort includes it in compose call", async () => {
    // Return "X" in both theories so the intersection has "X".
    getTheoryDetails.mockImplementation(() => ({
      name: "t",
      sorts: ["X", "Y"],
      ops: [],
      equation_count: 0,
    }));
    const compose = spyAction("composeTheories");
    resetStore({
      importedTheories: [
        { handle: 1, name: "a", sortCount: 2, opCount: 0 },
        { handle: 2, name: "b", sortCount: 2, opCount: 0 },
      ],
      composeTheories: compose,
    });
    const user = userEvent.setup();
    render(<ColimitComposer onClose={() => {}} />);
    // Shared-sort button "X"
    await user.click(screen.getByRole("button", { name: "X" }));
    await user.click(screen.getByRole("button", { name: "Compose" }));
    expect(compose).toHaveBeenCalledWith(1, 2, ["X"]);
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ColimitComposer onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
