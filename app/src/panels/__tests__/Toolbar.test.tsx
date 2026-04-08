import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "../Toolbar";
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

/** Replace a store action with a spy so we can assert calls. */
function spyAction<K extends keyof ReturnType<typeof useCircuitStore.getState>>(key: K) {
  const fn = vi.fn();
  useCircuitStore.setState({ [key]: fn } as any);
  return fn;
}

beforeEach(() => {
  resetMockBridge();
  resetStore();
});

describe("Toolbar", () => {
  it("renders the protolab brand heading", () => {
    render(<Toolbar />);
    expect(screen.getByText("protolab")).toBeInTheDocument();
  });

  it("renders Theories, Colimit, Schemas, Protocols buttons", () => {
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: "Theories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Colimit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schemas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Protocols" })).toBeInTheDocument();
  });

  it("clicking Theories opens the TheoryEditor modal", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: "Theories" }));
    expect(screen.getByText(/Build Theory/)).toBeInTheDocument();
  });

  it("clicking Protocols opens the ProtocolEditor modal", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: "Protocols" }));
    expect(screen.getByText(/Build Protocol/)).toBeInTheDocument();
  });

  it("clicking Schemas opens the SchemaBrowser modal", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: "Schemas" }));
    expect(screen.getByText(/Schemas & Theories/)).toBeInTheDocument();
  });

  it("clicking Colimit opens the ColimitComposer modal", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: "Colimit" }));
    expect(screen.getByText(/Colimit \(Pushout\) Composition/)).toBeInTheDocument();
  });

  it("Import dropdown opens with Lens/Schema/Theory/Protocol options", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: /Import/ }));
    expect(screen.getByText("Lens Document (JSON)")).toBeInTheDocument();
    expect(screen.getByText("Schema (JSON)")).toBeInTheDocument();
    expect(screen.getByText("Theory (JSON)")).toBeInTheDocument();
    expect(screen.getByText("Protocol (JSON)")).toBeInTheDocument();
  });

  it("clicking a dropdown option opens the import dialog with the right title", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: /Import/ }));
    await user.click(screen.getByText("Schema (JSON)"));
    expect(screen.getByText("Import Schema")).toBeInTheDocument();
  });

  it("import dialog's file picker reads file content into the textarea", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: /Import/ }));
    await user.click(screen.getByText("Lens Document (JSON)"));

    const file = new File(['{"hello":"world"}'], "lens.json", {
      type: "application/json",
    });
    // Hidden file input — find by type
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    // FileReader is async; wait a tick.
    await new Promise((r) => setTimeout(r, 50));
    const textarea = screen.getByPlaceholderText(/Paste JSON here/) as HTMLTextAreaElement;
    expect(textarea.value).toContain("hello");
  });

  it("import dialog's Cancel button closes the dialog", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: /Import/ }));
    await user.click(screen.getByText("Lens Document (JSON)"));
    expect(screen.getByText("Import Lens Document")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Import Lens Document")).not.toBeInTheDocument();
  });

  it("import button does nothing when textarea is empty", async () => {
    const user = userEvent.setup();
    const spy = spyAction("importLensDocument");
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: /Import/ }));
    await user.click(screen.getByText("Lens Document (JSON)"));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText("Import Lens Document")).toBeInTheDocument();
  });

  async function doImport(optionText: string, text: string) {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole("button", { name: /Import/ }));
    await user.click(screen.getByText(optionText));
    const textarea = screen.getByPlaceholderText(/Paste JSON here/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: text } });
    await user.click(screen.getByRole("button", { name: "Import" }));
  }

  it("import lens calls importLensDocument", async () => {
    const spy = spyAction("importLensDocument");
    await doImport("Lens Document (JSON)", '{"lens":1}');
    expect(spy).toHaveBeenCalledWith('{"lens":1}');
  });

  it("import schema calls importSchema", async () => {
    const spy = spyAction("importSchema");
    await doImport("Schema (JSON)", '{"schema":1}');
    expect(spy).toHaveBeenCalledWith('{"schema":1}');
  });

  it("import theory calls importTheory", async () => {
    const spy = spyAction("importTheory");
    await doImport("Theory (JSON)", '{"theory":1}');
    expect(spy).toHaveBeenCalledWith('{"theory":1}');
  });

  it("import protocol calls importProtocol", async () => {
    const spy = spyAction("importProtocol");
    await doImport("Protocol (JSON)", '{"protocol":1}');
    expect(spy).toHaveBeenCalledWith('{"protocol":1}');
  });

  it("Import button closes dialog after successful import", async () => {
    spyAction("importLensDocument");
    await doImport("Lens Document (JSON)", '{"lens":1}');
    expect(screen.queryByText("Import Lens Document")).not.toBeInTheDocument();
  });
});
