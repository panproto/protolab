/**
 * Tests for all presentation widgets, widgetHelpers, and lexiconExamples.
 *
 * Widgets receive `{ widget: PresentationWidget }` — NOT React Flow nodes.
 * The WASM bridge is intercepted by the vitest alias in vitest.config.ts,
 * so no real WASM loads here. The Zustand store is reset before each test
 * to prevent state leaking across cases.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  useCircuitStore,
  emptyPresentationDoc,
  type PresentationWidget,
} from "../../store/circuitStore";
import { resetMockBridge, evaluateCircuit } from "../../test/wasmBridgeMock";

import { HeadingWidget } from "../widgets/HeadingWidget";
import { ParagraphWidget } from "../widgets/ParagraphWidget";
import { PanelWidget } from "../widgets/PanelWidget";
import { InputJsonWidget } from "../widgets/InputJsonWidget";
import { OutputJsonWidget } from "../widgets/OutputJsonWidget";
import { RunButtonWidget } from "../widgets/RunButtonWidget";
import { UnknownWidget } from "../widgets/UnknownWidget";
import { getProp } from "../widgets/widgetHelpers";
import {
  exampleRecordForNsid,
  knownNsids,
} from "../lexiconExamples";

// ── Helpers ─────────────────────────────────────────────────────────

function resetStore(
  overrides: Partial<ReturnType<typeof useCircuitStore.getState>> = {},
) {
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
      mode: "edit",
      presentationDoc: emptyPresentationDoc(),
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

function makeWidget(patch: Partial<PresentationWidget> = {}): PresentationWidget {
  return {
    id: "w1",
    kind: "heading",
    props: {},
    ...patch,
  };
}

beforeEach(() => {
  resetMockBridge();
  resetStore();
});

// ── widgetHelpers: getProp ───────────────────────────────────────────

describe("getProp", () => {
  it("returns the value when the key exists", () => {
    const w = makeWidget({ props: { label: "My Label" } });
    expect(getProp(w, "label")).toBe("My Label");
  });

  it("returns the fallback string when the key is absent", () => {
    const w = makeWidget({ props: {} });
    expect(getProp(w, "missing", "default-val")).toBe("default-val");
  });

  it("returns empty string as the default fallback", () => {
    const w = makeWidget({ props: {} });
    expect(getProp(w, "nope")).toBe("");
  });

  it("does not use the fallback when the value is an empty string", () => {
    const w = makeWidget({ props: { key: "" } });
    // Empty string is a valid stored value — do NOT substitute the fallback.
    expect(getProp(w, "key", "FALLBACK")).toBe("");
  });
});

// ── HeadingWidget ────────────────────────────────────────────────────

describe("HeadingWidget", () => {
  it("renders text as h1 by default (level '1')", () => {
    const w = makeWidget({ kind: "heading", props: { text: "Welcome", level: "1" } });
    render(<HeadingWidget widget={w} />);
    const el = document.querySelector('[data-widget="heading"]') as HTMLElement;
    expect(el.tagName).toBe("H1");
    expect(el.textContent).toBe("Welcome");
  });

  it("renders text as h2 when level is '2'", () => {
    const w = makeWidget({ kind: "heading", props: { text: "Section", level: "2" } });
    render(<HeadingWidget widget={w} />);
    const el = document.querySelector('[data-widget="heading"]') as HTMLElement;
    expect(el.tagName).toBe("H2");
    expect(el.textContent).toBe("Section");
  });

  it("renders text as h3 when level is '3'", () => {
    const w = makeWidget({ kind: "heading", props: { text: "Subsection", level: "3" } });
    render(<HeadingWidget widget={w} />);
    const el = document.querySelector('[data-widget="heading"]') as HTMLElement;
    expect(el.tagName).toBe("H3");
    expect(el.textContent).toBe("Subsection");
  });

  it("clamps level below 1 to h1", () => {
    const w = makeWidget({ kind: "heading", props: { text: "Clamped Low", level: "0" } });
    render(<HeadingWidget widget={w} />);
    const el = document.querySelector('[data-widget="heading"]') as HTMLElement;
    expect(el.tagName).toBe("H1");
  });

  it("clamps level above 3 to h3", () => {
    const w = makeWidget({ kind: "heading", props: { text: "Clamped High", level: "99" } });
    render(<HeadingWidget widget={w} />);
    const el = document.querySelector('[data-widget="heading"]') as HTMLElement;
    expect(el.tagName).toBe("H3");
  });

  it("clamps non-numeric level to h1", () => {
    const w = makeWidget({ kind: "heading", props: { text: "NaN Level", level: "banana" } });
    render(<HeadingWidget widget={w} />);
    const el = document.querySelector('[data-widget="heading"]') as HTMLElement;
    expect(el.tagName).toBe("H1");
  });

  it("uses the 'Heading' fallback text when text prop is absent", () => {
    const w = makeWidget({ kind: "heading", props: {} });
    render(<HeadingWidget widget={w} />);
    const el = document.querySelector('[data-widget="heading"]') as HTMLElement;
    expect(el.textContent).toBe("Heading");
  });

  it("uses level 1 fallback when level prop is absent", () => {
    const w = makeWidget({ kind: "heading", props: { text: "No Level" } });
    render(<HeadingWidget widget={w} />);
    const el = document.querySelector('[data-widget="heading"]') as HTMLElement;
    expect(el.tagName).toBe("H1");
  });

  it("sets the data-widget attribute", () => {
    const w = makeWidget({ kind: "heading", props: { text: "X", level: "1" } });
    render(<HeadingWidget widget={w} />);
    expect(document.querySelector('[data-widget="heading"]')).not.toBeNull();
  });
});

// ── ParagraphWidget ──────────────────────────────────────────────────

describe("ParagraphWidget", () => {
  it("renders text inside a <p> element", () => {
    const w = makeWidget({ kind: "paragraph", props: { text: "Hello world" } });
    render(<ParagraphWidget widget={w} />);
    const el = document.querySelector('[data-widget="paragraph"]') as HTMLElement;
    expect(el.tagName).toBe("P");
    expect(el.textContent).toBe("Hello world");
  });

  it("renders empty string when text prop is absent", () => {
    const w = makeWidget({ kind: "paragraph", props: {} });
    render(<ParagraphWidget widget={w} />);
    const el = document.querySelector('[data-widget="paragraph"]') as HTMLElement;
    expect(el.textContent).toBe("");
  });

  it("preserves multi-line text content verbatim", () => {
    const multiline = "Line one\nLine two\nLine three";
    const w = makeWidget({ kind: "paragraph", props: { text: multiline } });
    render(<ParagraphWidget widget={w} />);
    const el = document.querySelector('[data-widget="paragraph"]') as HTMLElement;
    expect(el.textContent).toBe(multiline);
  });

  it("sets the data-widget attribute", () => {
    const w = makeWidget({ kind: "paragraph", props: { text: "x" } });
    render(<ParagraphWidget widget={w} />);
    expect(document.querySelector('[data-widget="paragraph"]')).not.toBeNull();
  });
});

// ── PanelWidget ──────────────────────────────────────────────────────

describe("PanelWidget", () => {
  it("renders a div with data-widget='panel'", () => {
    const w = makeWidget({ kind: "panel", props: { title: "My Section" } });
    render(<PanelWidget widget={w} />);
    expect(document.querySelector('[data-widget="panel"]')).not.toBeNull();
  });

  it("shows the title when provided", () => {
    const w = makeWidget({ kind: "panel", props: { title: "Config" } });
    render(<PanelWidget widget={w} />);
    expect(screen.getByText("Config")).toBeTruthy();
  });

  it("renders no title element when title is empty string", () => {
    const w = makeWidget({ kind: "panel", props: { title: "" } });
    render(<PanelWidget widget={w} />);
    const panel = document.querySelector('[data-widget="panel"]') as HTMLElement;
    // Inner div for the label only appears when title is truthy.
    expect(panel.children.length).toBe(0);
  });

  it("renders no title element when title prop is absent", () => {
    const w = makeWidget({ kind: "panel", props: {} });
    render(<PanelWidget widget={w} />);
    const panel = document.querySelector('[data-widget="panel"]') as HTMLElement;
    expect(panel.children.length).toBe(0);
  });
});

// ── InputJsonWidget ──────────────────────────────────────────────────

describe("InputJsonWidget", () => {
  it("displays the current inputDataJson from the store", () => {
    resetStore({ inputDataJson: '{"name":"Alice"}' });
    const w = makeWidget({ kind: "input_json", props: { label: "Input" } });
    render(<InputJsonWidget widget={w} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe('{"name":"Alice"}');
  });

  it("uses the label prop as the aria-label and visible label", () => {
    resetStore({ inputDataJson: "" });
    const w = makeWidget({ kind: "input_json", props: { label: "JSON Data" } });
    render(<InputJsonWidget widget={w} />);
    expect(screen.getByLabelText("JSON Data")).toBeTruthy();
    expect(screen.getByText("JSON Data")).toBeTruthy();
  });

  it("falls back to 'Input' when label prop is absent", () => {
    resetStore({ inputDataJson: "" });
    const w = makeWidget({ kind: "input_json", props: {} });
    render(<InputJsonWidget widget={w} />);
    expect(screen.getByLabelText("Input")).toBeTruthy();
  });

  it("calls setInputData on the store when the textarea changes", () => {
    resetStore({ inputDataJson: "" });
    const w = makeWidget({ kind: "input_json", props: { label: "Input" } });
    render(<InputJsonWidget widget={w} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '{"x":1}' } });
    expect(useCircuitStore.getState().inputDataJson).toBe('{"x":1}');
  });

  it("textarea value stays in sync with multiple store updates", () => {
    resetStore({ inputDataJson: "first" });
    const w = makeWidget({ kind: "input_json", props: { label: "Input" } });
    const { rerender } = render(<InputJsonWidget widget={w} />);
    useCircuitStore.getState().setInputData("second");
    rerender(<InputJsonWidget widget={w} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("second");
  });

  it("sets data-widget='input_json'", () => {
    resetStore({ inputDataJson: "" });
    const w = makeWidget({ kind: "input_json", props: {} });
    render(<InputJsonWidget widget={w} />);
    expect(document.querySelector('[data-widget="input_json"]')).not.toBeNull();
  });
});

// ── OutputJsonWidget ─────────────────────────────────────────────────

describe("OutputJsonWidget", () => {
  it("shows '// run to see output' placeholder when output is empty and no error", () => {
    resetStore({ outputDataJson: "", evaluationError: null });
    const w = makeWidget({ kind: "output_json", props: { label: "Output" } });
    render(<OutputJsonWidget widget={w} />);
    expect(screen.getByLabelText("Output").textContent).toContain("// run to see output");
  });

  it("shows the outputDataJson when present", () => {
    resetStore({ outputDataJson: '{"displayName":"Alice"}', evaluationError: null });
    const w = makeWidget({ kind: "output_json", props: { label: "Output" } });
    render(<OutputJsonWidget widget={w} />);
    expect(screen.getByLabelText("Output").textContent).toBe('{"displayName":"Alice"}');
  });

  it("shows the error message with prefix when evaluationError is set", () => {
    resetStore({ outputDataJson: "", evaluationError: "something went wrong" });
    const w = makeWidget({ kind: "output_json", props: { label: "Output" } });
    render(<OutputJsonWidget widget={w} />);
    const pre = screen.getByLabelText("Output");
    expect(pre.textContent).toContain("// error:");
    expect(pre.textContent).toContain("something went wrong");
  });

  it("prefers error over outputDataJson when both are set", () => {
    resetStore({
      outputDataJson: '{"some":"data"}',
      evaluationError: "evaluation failed",
    });
    const w = makeWidget({ kind: "output_json", props: { label: "Output" } });
    render(<OutputJsonWidget widget={w} />);
    const pre = screen.getByLabelText("Output");
    expect(pre.textContent).toContain("// error:");
    expect(pre.textContent).not.toContain('{"some":"data"}');
  });

  it("uses the label prop as aria-label and visible label", () => {
    resetStore({ outputDataJson: "", evaluationError: null });
    const w = makeWidget({ kind: "output_json", props: { label: "Result" } });
    render(<OutputJsonWidget widget={w} />);
    expect(screen.getByLabelText("Result")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
  });

  it("falls back to 'Output' when label prop is absent", () => {
    resetStore({ outputDataJson: "", evaluationError: null });
    const w = makeWidget({ kind: "output_json", props: {} });
    render(<OutputJsonWidget widget={w} />);
    expect(screen.getByLabelText("Output")).toBeTruthy();
  });

  it("renders as a <pre> element for preformatted output", () => {
    resetStore({ outputDataJson: "{}", evaluationError: null });
    const w = makeWidget({ kind: "output_json", props: { label: "Output" } });
    render(<OutputJsonWidget widget={w} />);
    const el = screen.getByLabelText("Output");
    expect(el.tagName).toBe("PRE");
  });

  it("sets data-widget='output_json'", () => {
    resetStore({ outputDataJson: "", evaluationError: null });
    const w = makeWidget({ kind: "output_json", props: {} });
    render(<OutputJsonWidget widget={w} />);
    expect(document.querySelector('[data-widget="output_json"]')).not.toBeNull();
  });
});

// ── RunButtonWidget ──────────────────────────────────────────────────

describe("RunButtonWidget", () => {
  it("renders a button with the label from props", () => {
    const w = makeWidget({ kind: "run_button", props: { label: "Execute" } });
    render(<RunButtonWidget widget={w} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("Execute");
  });

  it("falls back to 'Run' when label prop is absent", () => {
    const w = makeWidget({ kind: "run_button", props: {} });
    render(<RunButtonWidget widget={w} />);
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("Run");
  });

  it("calls runEvaluation from the store when clicked", () => {
    resetStore({
      circuitHandle: 1,
      sourceSchemaHandle: 1,
      inputDataJson: "{}",
      // hasDataLevelMapping requires at least one circuit node when
      // there's no target schema (the manual-circuit path).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodes: [{ id: "n1", type: "component", position: { x: 0, y: 0 }, data: {} as any }],
    });
    const w = makeWidget({ kind: "run_button", props: { label: "Run" } });
    render(<RunButtonWidget widget={w} />);
    fireEvent.click(screen.getByRole("button"));
    // runEvaluation delegates to the WASM bridge — verify it called evaluateCircuit.
    expect(evaluateCircuit).toHaveBeenCalled();
  });

  it("sets data-widget='run_button'", () => {
    const w = makeWidget({ kind: "run_button", props: {} });
    render(<RunButtonWidget widget={w} />);
    expect(document.querySelector('[data-widget="run_button"]')).not.toBeNull();
  });

  it("renders disabled with no source schema (data-ready=false)", () => {
    resetStore({ circuitHandle: null, sourceSchemaHandle: null });
    const w = makeWidget({ kind: "run_button", props: { label: "Run" } });
    render(<RunButtonWidget widget={w} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("data-ready")).toBe("false");
  });

  it("renders disabled with circuit but no source schema", () => {
    resetStore({ circuitHandle: 1, sourceSchemaHandle: null });
    const w = makeWidget({ kind: "run_button", props: { label: "Run" } });
    render(<RunButtonWidget widget={w} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("clicking with valid circuit and schema populates outputDataJson", () => {
    resetStore({
      circuitHandle: 1,
      sourceSchemaHandle: 1,
      inputDataJson: "{}",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodes: [{ id: "n1", type: "component", position: { x: 0, y: 0 }, data: {} as any }],
    });
    const w = makeWidget({ kind: "run_button", props: { label: "Run" } });
    render(<RunButtonWidget widget={w} />);
    fireEvent.click(screen.getByRole("button"));
    // The mock evaluateCircuit returns '{"displayName":"Alice"}'
    expect(useCircuitStore.getState().outputDataJson).toBe('{"displayName":"Alice"}');
    expect(useCircuitStore.getState().evaluationError).toBeNull();
  });
});

// ── UnknownWidget ─────────────────────────────────────────────────────

describe("UnknownWidget", () => {
  it("renders the data-widget='unknown' attribute", () => {
    const w = makeWidget({ kind: "heading" as any, props: {} });
    // Pretend kind is an unregistered string.
    const wUnknown = { ...w, kind: "mystery_widget" as any };
    render(<UnknownWidget widget={wUnknown} />);
    expect(document.querySelector('[data-widget="unknown"]')).not.toBeNull();
  });

  it("displays the kind name inside the error box", () => {
    const w = makeWidget({ props: {} });
    const wUnknown = { ...w, kind: "mystery_widget" as any };
    render(<UnknownWidget widget={wUnknown} />);
    const el = document.querySelector('[data-widget="unknown"]') as HTMLElement;
    expect(el.textContent).toContain("mystery_widget");
  });

  it("wraps the kind in a <strong> element", () => {
    const w = makeWidget({ props: {} });
    const wUnknown = { ...w, kind: "secret_kind" as any };
    render(<UnknownWidget widget={wUnknown} />);
    const strong = document.querySelector('[data-widget="unknown"] strong') as HTMLElement;
    expect(strong).not.toBeNull();
    expect(strong.textContent).toBe("secret_kind");
  });

  it("includes 'unknown widget' in the message", () => {
    const w = makeWidget({ props: {} });
    const wUnknown = { ...w, kind: "foo" as any };
    render(<UnknownWidget widget={wUnknown} />);
    const el = document.querySelector('[data-widget="unknown"]') as HTMLElement;
    expect(el.textContent).toContain("unknown widget");
  });
});

// ── lexiconExamples ──────────────────────────────────────────────────

describe("exampleRecordForNsid", () => {
  it("returns a non-null record for app.bsky.feed.post", () => {
    const rec = exampleRecordForNsid("app.bsky.feed.post");
    expect(rec).not.toBeNull();
    expect(rec!.$type).toBe("app.bsky.feed.post");
  });

  it("returns a non-null record for app.bsky.graph.follow", () => {
    const rec = exampleRecordForNsid("app.bsky.graph.follow");
    expect(rec).not.toBeNull();
    expect(rec!.$type).toBe("app.bsky.graph.follow");
  });

  it("returns a non-null record for app.bsky.actor.profile", () => {
    const rec = exampleRecordForNsid("app.bsky.actor.profile");
    expect(rec).not.toBeNull();
    expect(rec!.$type).toBe("app.bsky.actor.profile");
  });

  it("returns a non-null record for app.bsky.feed.like", () => {
    const rec = exampleRecordForNsid("app.bsky.feed.like");
    expect(rec).not.toBeNull();
    expect(rec!.$type).toBe("app.bsky.feed.like");
  });

  it("returns a non-null record for app.bsky.feed.repost", () => {
    const rec = exampleRecordForNsid("app.bsky.feed.repost");
    expect(rec).not.toBeNull();
    expect(rec!.$type).toBe("app.bsky.feed.repost");
  });

  it("returns a non-null record for app.bsky.graph.block", () => {
    const rec = exampleRecordForNsid("app.bsky.graph.block");
    expect(rec).not.toBeNull();
    expect(rec!.$type).toBe("app.bsky.graph.block");
  });

  it("returns null for an unknown NSID", () => {
    expect(exampleRecordForNsid("com.example.unknown")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(exampleRecordForNsid("")).toBeNull();
  });

  it("is case-sensitive — wrong casing returns null", () => {
    expect(exampleRecordForNsid("APP.BSKY.FEED.POST")).toBeNull();
  });
});

describe("knownNsids", () => {
  it("returns an array of strings", () => {
    const nsids = knownNsids();
    expect(Array.isArray(nsids)).toBe(true);
    expect(nsids.length).toBeGreaterThan(0);
  });

  it("includes the six bundled NSIDs", () => {
    const nsids = knownNsids();
    expect(nsids).toContain("app.bsky.feed.post");
    expect(nsids).toContain("app.bsky.graph.follow");
    expect(nsids).toContain("app.bsky.actor.profile");
    expect(nsids).toContain("app.bsky.feed.like");
    expect(nsids).toContain("app.bsky.feed.repost");
    expect(nsids).toContain("app.bsky.graph.block");
  });

  it("every NSID returned has a corresponding example record", () => {
    for (const nsid of knownNsids()) {
      expect(exampleRecordForNsid(nsid)).not.toBeNull();
    }
  });

  it("returns distinct NSIDs (no duplicates)", () => {
    const nsids = knownNsids();
    expect(new Set(nsids).size).toBe(nsids.length);
  });
});

// Silence unused vi import if tree-shaken by the transpiler.
void vi;
