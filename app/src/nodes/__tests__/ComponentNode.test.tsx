import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ComponentNode } from "../ComponentNode";

function renderNode(props: any) {
  return render(
    <ReactFlowProvider>
      <ComponentNode {...props} />
    </ReactFlowProvider>,
  );
}

function makeProps(overrides: any = {}) {
  return {
    id: "comp_1",
    type: "component",
    data: {
      label: "RenameField",
      componentType: "rename_field",
      opticKind: "lens",
      ports: [
        { id: "comp_1.in", direction: "input", trigger: "hot" },
        { id: "comp_1.out", direction: "output", trigger: "hot" },
        { id: "comp_1.param", direction: "parameter", trigger: "cold" },
      ],
      params: [
        { key: "old_name", value: "foo" },
        { key: "new_name", value: "bar" },
      ],
    },
    selected: false,
    dragging: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    ...overrides,
  };
}

describe("ComponentNode", () => {
  it("renders the label", () => {
    renderNode(makeProps());
    expect(screen.getByText("RenameField")).toBeInTheDocument();
  });

  it("renders the optic kind badge", () => {
    renderNode(makeProps());
    expect(screen.getByText("lens")).toBeInTheDocument();
  });

  it("renders input, output, and parameter ports via React Flow Handle", () => {
    const { container } = renderNode(makeProps());
    const handles = container.querySelectorAll(".react-flow__handle");
    // 1 input + 1 output + 1 parameter
    expect(handles.length).toBe(3);
  });

  it("hovering a port shows tooltip with port info", () => {
    const { container } = renderNode(makeProps());
    const handles = container.querySelectorAll(".react-flow__handle");
    fireEvent.mouseEnter(handles[0]);
    expect(screen.getByText("comp_1.in")).toBeInTheDocument();
    expect(screen.getByText(/input/)).toBeInTheDocument();
  });

  it("renders params in the body", () => {
    renderNode(makeProps());
    expect(screen.getByText(/old_name/)).toBeInTheDocument();
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText(/new_name/)).toBeInTheDocument();
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("selected prop applies selected styling", () => {
    const { container, rerender } = renderNode(makeProps({ selected: false }));
    const getBody = () =>
      container.querySelector('[style*="min-width"]') as HTMLElement;
    const unselectedBorder = getBody().style.borderColor;
    rerender(
      <ReactFlowProvider>
        <ComponentNode {...makeProps({ selected: true })} />
      </ReactFlowProvider>,
    );
    const selectedBorder = getBody().style.borderColor;
    expect(selectedBorder).not.toBe(unselectedBorder);
  });
});
