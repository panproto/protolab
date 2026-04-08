import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchemaBrowser } from "../SchemaBrowser";
import { useCircuitStore } from "../../store/circuitStore";
import { resetMockBridge } from "../../test/wasmBridgeMock";

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

describe("SchemaBrowser", () => {
  it("renders imported schemas list", () => {
    resetStore({
      importedSchemas: [
        {
          handle: 7,
          name: "my-schema",
          protocol: "json",
          vertexCount: 5,
          edgeCount: 3,
        },
      ],
    });
    render(<SchemaBrowser onClose={() => {}} />);
    expect(screen.getByText("my-schema")).toBeInTheDocument();
    expect(screen.getByText(/json/)).toBeInTheDocument();
  });

  it("assign as source button calls assignSourceSchema", async () => {
    const assign = spyAction("assignSourceSchema");
    resetStore({
      importedSchemas: [
        {
          handle: 7,
          name: "my-schema",
          protocol: "json",
          vertexCount: 5,
          edgeCount: 3,
        },
      ],
      assignSourceSchema: assign,
    });
    const user = userEvent.setup();
    render(<SchemaBrowser onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Use as source/ }));
    expect(assign).toHaveBeenCalledWith(7);
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SchemaBrowser onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows empty state when no schemas imported", () => {
    render(<SchemaBrowser onClose={() => {}} />);
    expect(screen.getByText(/No schemas imported/)).toBeInTheDocument();
  });
});
