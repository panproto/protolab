import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Palette } from "../Palette";
import { COMPONENT_CATALOG } from "../../store/circuitStore";
import { resetMockBridge } from "../../test/wasmBridgeMock";

beforeEach(() => {
  resetMockBridge();
});

describe("Palette", () => {
  it("renders one entry per catalog component grouped by category", () => {
    render(<Palette />);
    for (const def of COMPONENT_CATALOG) {
      expect(screen.getByText(def.label)).toBeInTheDocument();
    }
    const categories = new Set(COMPONENT_CATALOG.map((c) => c.category));
    for (const cat of categories) {
      // Category headers appear in uppercase text (but the DOM uses textTransform CSS,
      // so the actual text node is the original string).
      expect(screen.getByText(cat)).toBeInTheDocument();
    }
  });

  it("filter input narrows visible entries", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    const input = screen.getByPlaceholderText("Filter...");
    await user.type(input, "RenameField");
    expect(screen.getByText("RenameField")).toBeInTheDocument();
    expect(screen.queryByText("DropField")).not.toBeInTheDocument();
  });

  it("filter is case-insensitive", async () => {
    const user = userEvent.setup();
    render(<Palette />);
    const input = screen.getByPlaceholderText("Filter...");
    await user.type(input, "renamefield");
    expect(screen.getByText("RenameField")).toBeInTheDocument();
  });

  it("dragging an entry sets the drag data with the component type", () => {
    render(<Palette />);
    const item = screen.getByText("RenameField").closest("[draggable]") as HTMLElement;
    expect(item).toBeTruthy();

    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "",
    };
    fireEvent.dragStart(item, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/lens-circuit-component",
      "rename_field",
    );
  });
});
