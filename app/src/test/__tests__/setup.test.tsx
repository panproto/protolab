import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as wasm from "../wasmBridgeMock";

describe("test infrastructure", () => {
  it("vitest is wired up", () => {
    expect(1 + 1).toBe(2);
  });

  it("React Testing Library renders DOM", () => {
    render(<div>hello</div>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("WASM bridge mock exports the expected functions", () => {
    expect(typeof wasm.initWasm).toBe("function");
    expect(typeof wasm.evaluateCircuit).toBe("function");
    expect(typeof wasm.bangComponent).toBe("function");
    expect(typeof wasm.importProtocolJson).toBe("function");
  });
});
