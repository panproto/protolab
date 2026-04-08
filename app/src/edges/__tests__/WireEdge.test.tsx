import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider, Position } from "@xyflow/react";
import { WireEdge } from "../WireEdge";

// React Flow 12's `EdgeLabelRenderer` is a portal that only works inside
// a real ReactFlow canvas. In unit tests (no canvas, no portal target)
// the children silently fail to mount. Stub it to render inline so the
// tooltip contents are visible to @testing-library queries.
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="edge-label-renderer-stub">{children}</div>
    ),
  };
});

function makeProps(overrides: any = {}) {
  return {
    id: "e1",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    selected: false,
    data: { opticKind: "lens", isFeedback: false, complementInfo: "" },
    ...overrides,
  };
}

function renderEdge(props: any) {
  return render(
    <ReactFlowProvider>
      <svg>
        <WireEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
}

describe("WireEdge", () => {
  it("renders with the optic kind color", () => {
    const { container } = renderEdge(makeProps());
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
    const coloredPath = Array.from(paths).find((p) =>
      (p.getAttribute("style") ?? "").includes("2196F3"),
    );
    expect(coloredPath).toBeTruthy();
  });

  it("feedback edges render with dashed style", () => {
    const { container } = renderEdge(
      makeProps({ data: { opticKind: "lens", isFeedback: true, complementInfo: "" } }),
    );
    const paths = container.querySelectorAll("path");
    const dashed = Array.from(paths).find((p) =>
      (p.getAttribute("style") ?? "").includes("dasharray"),
    );
    expect(dashed).toBeTruthy();
  });

  // NOTE: the hover-tooltip behavior lives in a React Flow portal that
  // can't be exercised under jsdom. It's covered end-to-end by
  // `e2e/wire-tooltip.spec.ts` under Playwright.

  it("non-feedback edges render without dashed style", () => {
    const { container } = renderEdge(makeProps());
    const paths = container.querySelectorAll("path");
    const dashed = Array.from(paths).find((p) =>
      (p.getAttribute("style") ?? "").includes("dasharray"),
    );
    expect(dashed).toBeFalsy();
  });

  it("selected edges render with white stroke", () => {
    const { container } = renderEdge(makeProps({ selected: true }));
    const paths = container.querySelectorAll("path");
    // The component sets `stroke: "#fff"` inline; JSDOM normalizes this to
    // `rgb(255, 255, 255)` in `style.stroke` but the raw `style` attribute
    // keeps the original hex. Check both forms.
    const selectedPath = Array.from(paths).find((p) => {
      const attr = p.getAttribute("style") ?? "";
      const computed = (p as SVGElement).style.stroke;
      return (
        (attr.includes("stroke") && /#fff|rgb\(255,\s*255,\s*255\)/i.test(attr)) ||
        /rgb\(255,\s*255,\s*255\)|#fff/i.test(computed)
      );
    });
    expect(selectedPath).toBeTruthy();
  });
});
