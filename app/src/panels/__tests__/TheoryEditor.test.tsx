import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TheoryEditor } from "../TheoryEditor";
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

describe("TheoryEditor", () => {
  it("renders the theory name input", () => {
    render(<TheoryEditor onClose={() => {}} />);
    const nameInput = screen.getByDisplayValue("MyTheory") as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
  });

  it("add sort button adds a row with name and kind fields", async () => {
    const user = userEvent.setup();
    render(<TheoryEditor onClose={() => {}} />);
    expect(screen.getByText(/Sorts \(1\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add sort/ }));
    expect(screen.getByText(/Sorts \(2\)/)).toBeInTheDocument();
  });

  // The "Add operation" button is disabled until at least one sort has a
  // non-empty name (see TheoryEditor `sortNames` derivation). Same for
  // equations / directed equations: they need a non-empty op name. This
  // helper fills the initial sort row + (optionally) adds a named op so
  // downstream add-buttons become enabled.
  async function seedSortAndMaybeOp(user: ReturnType<typeof userEvent.setup>, addOp: boolean) {
    // The default sort row's first input has placeholder "name"; so does
    // an op row's first input. Before adding an op, only the sort row
    // exists, so the single `name` input is unambiguous.
    const sortNameInput = screen.getByPlaceholderText("name");
    await user.clear(sortNameInput);
    await user.type(sortNameInput, "S");
    if (addOp) {
      await user.click(screen.getByRole("button", { name: /\+ Add operation/ }));
      // Now there's a second "name" input (the op row). `getAllByPlaceholderText`
      // returns them in document order; the op row is the new one, index 1.
      const nameInputs = screen.getAllByPlaceholderText("name");
      await user.clear(nameInputs[1]);
      await user.type(nameInputs[1], "op1");
    }
  }

  it("add operation button adds a row with name, signature fields", async () => {
    const user = userEvent.setup();
    render(<TheoryEditor onClose={() => {}} />);
    await seedSortAndMaybeOp(user, false);
    await user.click(screen.getByRole("button", { name: /\+ Add operation/ }));
    expect(screen.getByText(/Operations \(1\)/)).toBeInTheDocument();
    // Two `name` placeholders now (sort + op).
    expect(screen.getAllByPlaceholderText("name")).toHaveLength(2);
  });

  it("add equation row", async () => {
    const user = userEvent.setup();
    render(<TheoryEditor onClose={() => {}} />);
    await seedSortAndMaybeOp(user, true);
    await user.click(screen.getByRole("button", { name: /\+ Add equation/ }));
    expect(screen.getByText(/Equations \(1\)/)).toBeInTheDocument();
  });

  it("add directed equation row with expression editor, inverse editor, coercion class dropdown", async () => {
    const user = userEvent.setup();
    render(<TheoryEditor onClose={() => {}} />);
    await seedSortAndMaybeOp(user, true);
    await user.click(screen.getByRole("button", { name: /\+ Add directed equation/ }));
    expect(screen.getByText(/Directed Equations \(1\)/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("directed equation name")).toBeInTheDocument();
  });

  it("coercion class dropdown has iso/retraction/projection/opaque options", async () => {
    const user = userEvent.setup();
    render(<TheoryEditor onClose={() => {}} />);
    await seedSortAndMaybeOp(user, true);
    await user.click(screen.getByRole("button", { name: /\+ Add directed equation/ }));
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    // Find the select with value "iso"
    const coercionSelect = selects.find((s) => s.value === "iso");
    expect(coercionSelect).toBeDefined();
    const opts = Array.from(coercionSelect!.options).map((o) => o.value);
    expect(opts).toEqual(["iso", "retraction", "projection", "opaque"]);
  });

  it("close button calls onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TheoryEditor onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("compile button constructs theory JSON with id containing dev.protolab.theories. and calls buildTheoryFromJson", async () => {
    const build = spyAction("buildTheoryFromJson");
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TheoryEditor onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /Compile Theory/ }));
    expect(build).toHaveBeenCalled();
    const arg = build.mock.calls[0][0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.id).toContain("dev.protolab.theories.");
    expect(parsed.theory).toBe("MyTheory");
    expect(onClose).toHaveBeenCalled();
  });

  it("remove a sort row", async () => {
    const user = userEvent.setup();
    render(<TheoryEditor onClose={() => {}} />);
    expect(screen.getByText(/Sorts \(1\)/)).toBeInTheDocument();
    // The × button for the sort row
    const removeButtons = screen.getAllByRole("button", { name: "×" });
    await user.click(removeButtons[0]);
    expect(screen.getByText(/Sorts \(0\)/)).toBeInTheDocument();
  });

  it("remove an operation row", async () => {
    const user = userEvent.setup();
    render(<TheoryEditor onClose={() => {}} />);
    await seedSortAndMaybeOp(user, true);
    expect(screen.getByText(/Operations \(1\)/)).toBeInTheDocument();
    const removeButtons = screen.getAllByRole("button", { name: "×" });
    // Second × button (after the sort) removes the op
    await user.click(removeButtons[1]);
    expect(screen.getByText(/Operations \(0\)/)).toBeInTheDocument();
  });
});
