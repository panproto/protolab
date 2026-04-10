/**
 * Tests for the presentation layer: store actions, PresentationCanvas
 * projection, widget registry, and URL helpers.
 *
 * Presentation widgets live in `presentationDoc.widgets`, NOT as
 * circuit nodes. These tests construct `PresentationWidget` objects
 * directly and verify they render / route correctly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  useCircuitStore,
  emptyPresentationDoc,
  type PresentationDoc,
  type PresentationWidget,
} from "../../store/circuitStore";
import { PresentationCanvas } from "../PresentationCanvas";
import { PresentationToolbar } from "../PresentationToolbar";
import { lookupWidget, KNOWN_WIDGETS } from "../WidgetRegistry";
import { encodeBase64, decodeBase64, readUrlState, buildShareUrl } from "../url";
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
    props: { text: "Hello", level: "1" },
    ...patch,
  };
}

function docWith(widgets: PresentationWidget[], overrides: Partial<PresentationDoc> = {}): PresentationDoc {
  return { ...emptyPresentationDoc(), widgets, ...overrides };
}

beforeEach(() => {
  resetMockBridge();
  resetStore();
  window.history.replaceState(null, "", window.location.pathname);
});

// ── Store actions ───────────────────────────────────────────────────

describe("presentation: store actions", () => {
  it("setMode flips the mode and writes ?mode= into the URL", () => {
    useCircuitStore.getState().setMode("presentation");
    expect(useCircuitStore.getState().mode).toBe("presentation");
    expect(window.location.search).toContain("mode=presentation");
    useCircuitStore.getState().setMode("edit");
    expect(useCircuitStore.getState().mode).toBe("edit");
    expect(window.location.search).not.toContain("mode=presentation");
  });

  it("setPresentationDoc replaces the whole doc", () => {
    const doc = docWith([makeWidget()], { title: "Test" });
    useCircuitStore.getState().setPresentationDoc(doc);
    expect(useCircuitStore.getState().presentationDoc).toEqual(doc);
  });

  it("setPresentationTitle updates the title", () => {
    useCircuitStore.getState().setPresentationTitle("Hello");
    expect(useCircuitStore.getState().presentationDoc.title).toBe("Hello");
  });

  it("addPresentationWidget appends a widget", () => {
    useCircuitStore.getState().addPresentationWidget(makeWidget({ id: "w_a" }));
    useCircuitStore.getState().addPresentationWidget(makeWidget({ id: "w_b" }));
    const widgets = useCircuitStore.getState().presentationDoc.widgets;
    expect(widgets.map((w) => w.id)).toEqual(["w_a", "w_b"]);
  });

  it("updatePresentationWidget merges patch and props", () => {
    useCircuitStore.getState().addPresentationWidget(
      makeWidget({ id: "w_a", props: { text: "old", level: "1" } }),
    );
    useCircuitStore.getState().updatePresentationWidget("w_a", {
      props: { text: "new" },
    });
    const w = useCircuitStore.getState().presentationDoc.widgets[0];
    expect(w.props.text).toBe("new");
    // level survives the merge
    expect(w.props.level).toBe("1");
  });

  it("removePresentationWidget drops by id", () => {
    useCircuitStore.getState().addPresentationWidget(makeWidget({ id: "a" }));
    useCircuitStore.getState().addPresentationWidget(makeWidget({ id: "b" }));
    useCircuitStore.getState().removePresentationWidget("a");
    const ids = useCircuitStore.getState().presentationDoc.widgets.map((w) => w.id);
    expect(ids).toEqual(["b"]);
  });
});

// ── WidgetRegistry ──────────────────────────────────────────────────

describe("presentation: WidgetRegistry", () => {
  it("looks up every known widget kind without falling through", () => {
    for (const kind of KNOWN_WIDGETS) {
      expect(lookupWidget(kind)).toBeTruthy();
    }
  });

  it("falls back to the unknown widget for unregistered kinds", () => {
    const W = lookupWidget("nope-not-a-widget");
    render(<W widget={makeWidget({ kind: "nope-not-a-widget" as any })} />);
    expect(document.querySelector('[data-widget="unknown"]')).toBeTruthy();
  });
});

// ── PresentationCanvas projection ──────────────────────────────────

describe("presentation: PresentationCanvas", () => {
  it("renders the empty state when no widgets are present", () => {
    resetStore({ presentationDoc: emptyPresentationDoc() });
    render(<PresentationCanvas />);
    expect(screen.getByText(/Nothing to show in presentation mode/)).toBeTruthy();
  });

  it("renders a heading widget", () => {
    resetStore({ presentationDoc: docWith([makeWidget()]) });
    render(<PresentationCanvas />);
    const h = document.querySelector('[data-widget="heading"]');
    expect(h).toBeTruthy();
    expect(h?.textContent).toBe("Hello");
  });

  it("form layout stacks widgets vertically", () => {
    const widgets = [
      makeWidget({ id: "h", kind: "heading", props: { text: "Title" } }),
      makeWidget({ id: "p", kind: "paragraph", props: { text: "Body text" } }),
      makeWidget({ id: "r", kind: "run_button", props: { label: "Go" } }),
    ];
    resetStore({ presentationDoc: docWith(widgets) });
    render(<PresentationCanvas />);
    expect(document.querySelector('[data-layout="form"]')).toBeTruthy();
    expect(document.querySelector('[data-widget="heading"]')).toBeTruthy();
    expect(document.querySelector('[data-widget="paragraph"]')).toBeTruthy();
    expect(document.querySelector('[data-widget="run_button"]')).toBeTruthy();
  });
});

// ── PresentationToolbar ────────────────────────────────────────────

describe("presentation: PresentationToolbar", () => {
  it("renders the title from presentationDoc", () => {
    resetStore({ presentationDoc: docWith([], { title: "Test Panel" }) });
    render(<PresentationToolbar />);
    expect(screen.getByText("Test Panel")).toBeTruthy();
  });

  it("Edit circuit button switches mode back to edit", () => {
    resetStore({ mode: "presentation" });
    render(<PresentationToolbar />);
    fireEvent.click(screen.getByText("Edit circuit"));
    expect(useCircuitStore.getState().mode).toBe("edit");
  });
});

// ── URL helpers ────────────────────────────────────────────────────

describe("presentation: URL helpers", () => {
  it("base64 round-trips unicode strings", () => {
    const s = '{"hello":"world","emoji":"🌟"}';
    expect(decodeBase64(encodeBase64(s))).toBe(s);
  });

  it("readUrlState parses mode + template + circuit", () => {
    const json = '{"foo":1}';
    const c = encodeBase64(json);
    const state = readUrlState(`?mode=presentation&template=lexicon_mapper&c=${c}`);
    expect(state.mode).toBe("presentation");
    expect(state.template).toBe("lexicon_mapper");
    expect(state.circuitJson).toBe(json);
  });

  it("buildShareUrl includes mode", () => {
    const url = buildShareUrl(0);
    expect(url).toContain("mode=presentation");
  });
});

// Silence the vi import if not directly referenced — keeps the
// no-unused-vars rule happy across refactors.
void vi;
