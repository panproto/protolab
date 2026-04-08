import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Node, Edge } from "@xyflow/react";
import { Inspector } from "../Inspector";
import { useCircuitStore } from "../../store/circuitStore";
import { resetMockBridge, bangComponent } from "../../test/wasmBridgeMock";

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

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: "comp_1",
    type: "component",
    position: { x: 0, y: 0 },
    data: {
      label: "CoerceType",
      componentType: "coerce_type",
      opticKind: "lens",
      ports: [
        { id: "comp_1.in", direction: "input", trigger: "hot" },
        { id: "comp_1.out", direction: "output", trigger: "hot" },
      ],
      params: [
        { key: "field", value: "age" },
        { key: "expr", value: "str(x)" },
        { key: "coercion", value: "iso" },
      ],
    },
    ...overrides,
  };
}

function makeEdge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: "e1",
    source: "comp_1",
    target: "comp_2",
    type: "wire",
    data: { opticKind: "prism", isFeedback: false, complementInfo: "" },
    ...overrides,
  };
}

beforeEach(() => {
  resetMockBridge();
  resetStore();
});

describe("Inspector / NodeInspector", () => {
  it("renders the component label and optic kind badge", () => {
    const node = makeNode();
    resetStore({ nodes: [node], selectedNodeId: node.id });
    render(<Inspector />);
    expect(screen.getByText("CoerceType")).toBeInTheDocument();
    expect(screen.getByText("lens")).toBeInTheDocument();
  });

  it("renders every catalog param with the right label and required marker", () => {
    const node = makeNode();
    resetStore({ nodes: [node], selectedNodeId: node.id });
    render(<Inspector />);
    // CoerceType has Field (required), Forward (required), Inverse, Coercion Class
    expect(screen.getByText(/Field/)).toBeInTheDocument();
    expect(screen.getByText(/Forward/)).toBeInTheDocument();
    expect(screen.getByText(/Coercion Class/)).toBeInTheDocument();
    // Required asterisks present
    const asterisks = screen.getAllByText("*");
    expect(asterisks.length).toBeGreaterThanOrEqual(2);
  });

  it("enum params render as select elements with options", () => {
    const node = makeNode();
    resetStore({ nodes: [node], selectedNodeId: node.id });
    render(<Inspector />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain("iso");
    expect(opts).toContain("retraction");
    expect(opts).toContain("projection");
    expect(opts).toContain("opaque");
  });

  it("expression params render the ExpressionEditor", () => {
    const node = makeNode();
    resetStore({ nodes: [node], selectedNodeId: node.id });
    const { container } = render(<Inspector />);
    // CodeMirror mounts a .cm-editor container when it initializes.
    const cmEditors = container.querySelectorAll(".cm-editor");
    expect(cmEditors.length).toBeGreaterThan(0);
  });

  it("text params render as input elements", () => {
    // Use a component with only text params, e.g. rename_field.
    const node = makeNode({
      id: "comp_2",
      data: {
        label: "RenameField",
        componentType: "rename_field",
        opticKind: "iso",
        ports: [],
        params: [
          { key: "old_name", value: "foo" },
          { key: "new_name", value: "bar" },
        ],
      },
    });
    resetStore({ nodes: [node], selectedNodeId: node.id });
    render(<Inspector />);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    const values = inputs.map((i) => i.value);
    expect(values).toContain("foo");
    expect(values).toContain("bar");
  });

  it("field_ref params render as input elements with 'field' badge", () => {
    const node = makeNode({
      data: {
        label: "MapItems",
        componentType: "map_items",
        opticKind: "traversal",
        ports: [],
        params: [{ key: "focus", value: "items" }],
      },
    });
    resetStore({ nodes: [node], selectedNodeId: node.id });
    render(<Inspector />);
    expect(screen.getByText("field")).toBeInTheDocument();
  });

  it("text input onBlur calls updateParam with the new value", () => {
    const update = spyAction("updateParam");
    const node = makeNode({
      data: {
        label: "RenameField",
        componentType: "rename_field",
        opticKind: "iso",
        ports: [],
        params: [{ key: "old_name", value: "foo" }],
      },
    });
    resetStore({ nodes: [node], selectedNodeId: node.id, updateParam: update });
    render(<Inspector />);
    const input = screen.getByDisplayValue("foo") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "baz" } });
    fireEvent.blur(input);
    expect(update).toHaveBeenCalledWith("comp_1", "old_name", "baz");
  });

  it("enum select onChange calls updateParam", () => {
    const update = spyAction("updateParam");
    const node = makeNode();
    resetStore({ nodes: [node], selectedNodeId: node.id, updateParam: update });
    render(<Inspector />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "projection" } });
    expect(update).toHaveBeenCalledWith("comp_1", "coercion", "projection");
  });

  it("Delete Component button calls removeComponent", async () => {
    const remove = spyAction("removeComponent");
    const node = makeNode();
    resetStore({ nodes: [node], selectedNodeId: node.id, removeComponent: remove });
    render(<Inspector />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Delete Component/ }));
    expect(remove).toHaveBeenCalledWith("comp_1");
  });

  it("Bang button calls wasm.bangComponent and renders the result", async () => {
    bangComponent.mockReturnValue('{"result":"ok"}');
    const node = makeNode();
    resetStore({ nodes: [node], selectedNodeId: node.id });
    render(<Inspector />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Bang/ }));
    expect(bangComponent).toHaveBeenCalledWith(0, "comp_1");
    expect(screen.getByText(/Wire output/)).toBeInTheDocument();
    expect(screen.getByText(/"result"/)).toBeInTheDocument();
  });

  it("Bang button shows the error state if the call throws", async () => {
    bangComponent.mockImplementation(() => {
      throw new Error("boom");
    });
    const node = makeNode();
    resetStore({ nodes: [node], selectedNodeId: node.id });
    render(<Inspector />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Bang/ }));
    expect(screen.getByText(/Bang error/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});

describe("Inspector / EdgeInspector", () => {
  it("renders Wire title and optic kind", () => {
    const edge = makeEdge();
    resetStore({ edges: [edge], selectedEdgeId: edge.id });
    render(<Inspector />);
    expect(screen.getByText("Wire")).toBeInTheDocument();
    expect(screen.getByText("prism")).toBeInTheDocument();
  });

  it("shows source and target node ids", () => {
    const edge = makeEdge();
    resetStore({ edges: [edge], selectedEdgeId: edge.id });
    render(<Inspector />);
    expect(screen.getByText("comp_1")).toBeInTheDocument();
    expect(screen.getByText("comp_2")).toBeInTheDocument();
  });

  it("Delete Wire button calls removeWire", async () => {
    const remove = spyAction("removeWire");
    const edge = makeEdge();
    resetStore({ edges: [edge], selectedEdgeId: edge.id, removeWire: remove });
    render(<Inspector />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Delete Wire/ }));
    expect(remove).toHaveBeenCalledWith("e1");
  });
});

describe("Inspector / CircuitInspector", () => {
  it("renders component and wire counts", () => {
    resetStore({
      nodes: [makeNode(), makeNode({ id: "comp_2" })],
      edges: [makeEdge()],
    });
    const { container } = render(<Inspector />);
    // The counts are interleaved as text siblings of the label spans,
    // so a plain `getByText("2")` wouldn't find them. Assert the full
    // line text via the container instead.
    expect(screen.getByText(/Components:/)).toBeInTheDocument();
    expect(screen.getByText(/Wires:/)).toBeInTheDocument();
    expect(container.textContent).toMatch(/Components:\s*2/);
    expect(container.textContent).toMatch(/Wires:\s*1/);
  });

  it("renders export buttons when circuitHandle is non-null", () => {
    resetStore({ circuitHandle: 0 });
    render(<Inspector />);
    expect(screen.getByRole("button", { name: /Schema JSON/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lens JSON/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /YAML/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nickel/ })).toBeInTheDocument();
  });

  it("hides export buttons when circuitHandle is null", () => {
    resetStore({ circuitHandle: null });
    render(<Inspector />);
    expect(screen.queryByRole("button", { name: /Schema JSON/ })).not.toBeInTheDocument();
  });

  it("renders imported schemas list when non-empty", () => {
    resetStore({
      importedSchemas: [
        {
          handle: 1,
          name: "s",
          protocol: "json-schema",
          vertexCount: 3,
          edgeCount: 2,
        },
      ],
    });
    render(<Inspector />);
    expect(screen.getByText(/Imported Schemas/)).toBeInTheDocument();
    expect(screen.getByText(/json-schema/)).toBeInTheDocument();
  });

  it("renders imported theories list when non-empty", () => {
    resetStore({
      importedTheories: [
        { handle: 1, name: "monoid", sortCount: 1, opCount: 2 },
      ],
    });
    render(<Inspector />);
    expect(screen.getByText(/Imported Theories/)).toBeInTheDocument();
    expect(screen.getByText(/monoid/)).toBeInTheDocument();
  });

  it("renders user protocols list when non-empty", () => {
    resetStore({
      importedProtocols: [
        {
          handle: 1,
          name: "proto-x",
          schemaTheory: "a",
          instanceTheory: "b",
          objKindCount: 2,
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
        },
      ],
    });
    render(<Inspector />);
    expect(screen.getByText(/User Protocols/)).toBeInTheDocument();
    expect(screen.getByText(/proto-x/)).toBeInTheDocument();
  });

  it("hides schema/theory/protocol lists when empty", () => {
    resetStore();
    render(<Inspector />);
    expect(screen.queryByText(/Imported Schemas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Imported Theories/)).not.toBeInTheDocument();
    expect(screen.queryByText(/User Protocols/)).not.toBeInTheDocument();
  });
});
