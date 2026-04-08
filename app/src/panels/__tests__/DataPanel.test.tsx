import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataPanel } from "../DataPanel";
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
      sourceSchemaHandle: 1,
      inputDataJson: '{"name":"Alice"}',
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

describe("DataPanel", () => {
  it("renders INPUT / WIRE / OUTPUT sections", () => {
    render(<DataPanel />);
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText(/Wire/)).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
  });

  it("INPUT textarea is editable and calls setInputData", () => {
    const set = spyAction("setInputData");
    render(<DataPanel />);
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    // The first textarea is the input
    const input = textareas[0];
    fireEvent.change(input, { target: { value: '{"name":"Bob"}' } });
    expect(set).toHaveBeenCalledWith('{"name":"Bob"}');
  });

  it("Run button calls runEvaluation", async () => {
    const run = spyAction("runEvaluation");
    render(<DataPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Run/ }));
    expect(run).toHaveBeenCalled();
  });

  it("Run button is disabled when sourceSchemaHandle is null", () => {
    resetStore({ sourceSchemaHandle: null });
    render(<DataPanel />);
    const btn = screen.getByRole("button", { name: /Run/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("renders the evaluation error when present", () => {
    resetStore({ evaluationError: "schema mismatch" });
    render(<DataPanel />);
    expect(screen.getByText("schema mismatch")).toBeInTheDocument();
  });

  it("OUTPUT textarea reflects outputDataJson from the store", () => {
    resetStore({ outputDataJson: '{"displayName":"Alice"}' });
    render(<DataPanel />);
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const output = textareas[textareas.length - 1];
    expect(output.value).toContain("displayName");
  });

  it("Apply Back button calls applyModifiedOutput with the modified output", async () => {
    const apply = spyAction("applyModifiedOutput");
    resetStore({ outputDataJson: '{"x":1}', applyModifiedOutput: apply });
    render(<DataPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Apply Back/ }));
    expect(apply).toHaveBeenCalledWith('{"x":1}');
  });

  it("Apply Back button is disabled when outputDataJson is empty", () => {
    resetStore({ outputDataJson: "" });
    render(<DataPanel />);
    const btn = screen.getByRole("button", { name: /Apply Back/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("wire section shows selectedWireId when present", () => {
    resetStore({ selectedWireId: "w_100", wireDataMap: { w_100: '{"foo":1}' } });
    render(<DataPanel />);
    expect(screen.getByText(/Wire: w_100/)).toBeInTheDocument();
  });
});
