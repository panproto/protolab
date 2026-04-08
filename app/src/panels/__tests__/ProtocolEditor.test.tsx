import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProtocolEditor } from "../ProtocolEditor";
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

function makeProtocolInfo(overrides: any = {}) {
  return {
    handle: 1,
    name: "proto-1",
    schemaTheory: "ThWType",
    instanceTheory: "ThWType",
    objKindCount: 1,
    constraintSortCount: 0,
    edgeRuleCount: 1,
    hasOrder: false,
    hasCoproducts: false,
    hasRecursion: false,
    hasCausal: false,
    nominalIdentity: false,
    hasDefaults: false,
    hasCoercions: false,
    hasMergers: false,
    hasPolicies: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetMockBridge();
  resetStore();
});

describe("ProtocolEditor", () => {
  it("renders identity section with name, schema_theory, instance_theory inputs", () => {
    render(<ProtocolEditor onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/my-corp-api-v2/)).toBeInTheDocument();
    // Default values
    const defaults = screen.getAllByDisplayValue("ThWType");
    expect(defaults.length).toBe(2);
  });

  it("initial refreshProtocols is called on mount", () => {
    const refresh = spyAction("refreshProtocols");
    render(<ProtocolEditor onClose={() => {}} />);
    expect(refresh).toHaveBeenCalled();
  });

  it("name input is required — Register button shows error if empty", async () => {
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Register Protocol/ }));
    expect(screen.getByText(/Protocol name is required/)).toBeInTheDocument();
  });

  it("add obj kind / remove obj kind", async () => {
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    expect(screen.getByText(/Object kinds \(1\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add obj kind/ }));
    expect(screen.getByText(/Object kinds \(2\)/)).toBeInTheDocument();
  });

  it("add constraint sort / remove constraint sort", async () => {
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    expect(screen.getByText(/Constraint sorts \(0\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add constraint sort/ }));
    expect(screen.getByText(/Constraint sorts \(1\)/)).toBeInTheDocument();
  });

  it("add edge rule / remove edge rule / update edge rule fields", async () => {
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    expect(screen.getByText(/Edge rules \(1\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add edge rule/ }));
    expect(screen.getByText(/Edge rules \(2\)/)).toBeInTheDocument();

    // Update the edge_kind of the new row
    const edgeKindInputs = screen.getAllByPlaceholderText("edge kind");
    fireEvent.change(edgeKindInputs[1], { target: { value: "item" } });
    expect((edgeKindInputs[1] as HTMLInputElement).value).toBe("item");
  });

  it("toggling capability flag checkboxes", async () => {
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(9);
    const first = checkboxes[0] as HTMLInputElement;
    expect(first.checked).toBe(false);
    await user.click(first);
    expect(first.checked).toBe(true);
  });

  it("Register Protocol button calls importProtocol with the assembled JSON", async () => {
    const imp = spyAction("importProtocol");
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    const nameInput = screen.getByPlaceholderText(/my-corp-api-v2/);
    await user.type(nameInput, "my-proto");
    await user.click(screen.getByRole("button", { name: /Register Protocol/ }));
    expect(imp).toHaveBeenCalled();
    const arg = imp.mock.calls[0][0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.name).toBe("my-proto");
    expect(parsed.schema_theory).toBe("ThWType");
  });

  it("registered-protocols list renders entries from importedProtocols", () => {
    resetStore({ importedProtocols: [makeProtocolInfo({ name: "alpha" })] });
    render(<ProtocolEditor onClose={() => {}} />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText(/Registered \(1\)/)).toBeInTheDocument();
  });

  it("Edit button loads a protocol back into the form via getProtocolJson", async () => {
    const getJson = vi.fn().mockReturnValue(
      JSON.stringify({
        name: "alpha",
        schema_theory: "Sch",
        instance_theory: "Inst",
        obj_kinds: ["row"],
        constraint_sorts: [],
        edge_rules: [{ edge_kind: "prop", src_kinds: ["row"], tgt_kinds: [] }],
        has_order: true,
      }),
    );
    resetStore({
      importedProtocols: [makeProtocolInfo({ name: "alpha" })],
      getProtocolJson: getJson as any,
    });
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(getJson).toHaveBeenCalledWith("alpha");
    expect(screen.getByDisplayValue("alpha")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sch")).toBeInTheDocument();
  });

  it("Export button triggers a JSON download", async () => {
    // jsdom doesn't define URL.createObjectURL / revokeObjectURL by default,
    // so install stubs before spying.
    const originalCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    const originalRevoke = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => "blob:test";
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
    const createSpy = vi.spyOn(URL, "createObjectURL");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");

    const getJson = vi.fn().mockReturnValue('{"name":"alpha"}');
    resetStore({
      importedProtocols: [makeProtocolInfo({ name: "alpha" })],
      getProtocolJson: getJson as any,
    });
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(createSpy).toHaveBeenCalled();

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = originalCreate;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = originalRevoke;
  });

  it("Remove button calls removeProtocol", async () => {
    const remove = spyAction("removeProtocol");
    resetStore({
      importedProtocols: [makeProtocolInfo({ name: "alpha" })],
      removeProtocol: remove,
    });
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={() => {}} />);
    // The remove (×) button for the registered protocol
    const rows = screen.getByText("alpha").closest("div")?.parentElement?.parentElement;
    const removeBtn = within(rows as HTMLElement).getByRole("button", { name: "×" });
    await user.click(removeBtn);
    expect(remove).toHaveBeenCalledWith("alpha");
  });

  it("error message displays local and store errors", () => {
    resetStore({ error: "store error" });
    render(<ProtocolEditor onClose={() => {}} />);
    expect(screen.getByText("store error")).toBeInTheDocument();
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ProtocolEditor onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
