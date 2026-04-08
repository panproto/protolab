import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExpressionEditor } from "../ExpressionEditor";
import {
  resetMockBridge,
  evaluateExpression,
  parseExpression,
} from "../../test/wasmBridgeMock";

beforeEach(() => {
  resetMockBridge();
});

describe("ExpressionEditor", () => {
  it("renders a container element with CodeMirror editor", () => {
    const { container } = render(
      <ExpressionEditor value="1 + 1" onChange={() => {}} />,
    );
    const cm = container.querySelector(".cm-editor");
    expect(cm).toBeTruthy();
  });

  it("mounts without error with default props and initial value", () => {
    const { container } = render(
      <ExpressionEditor value="" onChange={() => {}} placeholder="type here" />,
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    expect(screen.getByText("type here")).toBeInTheDocument();
  });

  it("showTestPanel renders the Eval button and environment input", () => {
    render(
      <ExpressionEditor value="x + 1" onChange={() => {}} showTestPanel />,
    );
    expect(screen.getByRole("button", { name: /Eval/ })).toBeInTheDocument();
    expect(screen.getByText(/Sample env/)).toBeInTheDocument();
  });

  it("Eval button calls wasm.evaluateExpression and displays the result", async () => {
    evaluateExpression.mockReturnValue("42");
    const user = userEvent.setup();
    render(
      <ExpressionEditor value="6 * 7" onChange={() => {}} showTestPanel />,
    );
    await user.click(screen.getByRole("button", { name: /Eval/ }));
    expect(evaluateExpression).toHaveBeenCalled();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("Eval button displays error when evaluateExpression throws", async () => {
    evaluateExpression.mockImplementation(() => {
      throw new Error("eval failed");
    });
    const user = userEvent.setup();
    render(
      <ExpressionEditor value="1" onChange={() => {}} showTestPanel />,
    );
    await user.click(screen.getByRole("button", { name: /Eval/ }));
    expect(screen.getByText(/eval failed/)).toBeInTheDocument();
  });

  it("linter calls wasm.parseExpression on debounce (fake timers)", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ExpressionEditor value="1 + 2" onChange={() => {}} />,
      );
      expect(container.querySelector(".cm-editor")).toBeTruthy();
      // Advance timers to fire the 300ms lint debounce.
      await vi.advanceTimersByTimeAsync(500);
      // parseExpression is called on non-empty doc
      expect(parseExpression).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("compact mode hides line numbers", () => {
    const { container } = render(
      <ExpressionEditor value="x" onChange={() => {}} compact />,
    );
    const gutters = container.querySelectorAll(".cm-lineNumbers");
    expect(gutters.length).toBe(0);
  });

  it("non-compact mode shows line numbers", () => {
    const { container } = render(
      <ExpressionEditor value="x" onChange={() => {}} />,
    );
    const gutters = container.querySelectorAll(".cm-lineNumbers");
    expect(gutters.length).toBeGreaterThan(0);
  });
});
