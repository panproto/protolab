/**
 * Presentation canvas: renders the presentation layer
 * (`presentationDoc.widgets`) via the WidgetRegistry. Widgets are pure
 * UI chrome — they don't exist as circuit nodes — so edit mode stays
 * clean and presentation mode is a separate, curated view.
 *
 * Supports three layouts:
 *   - free       — absolute positioning from widget.x / widget.y
 *   - form       — vertical stack, ignores coordinates
 *   - two_column — widgets tagged `column: "left" | "right"` split into
 *                  two middle columns; widgets tagged `column: ""` span
 *                  as top/bottom bands depending on their position in
 *                  the widget list
 */

import type { CSSProperties } from "react";
import { useCircuitStore, type PresentationWidget } from "../store/circuitStore";
import { lookupWidget } from "./WidgetRegistry";

export function PresentationCanvas() {
  const doc = useCircuitStore((s) => s.presentationDoc);

  if (doc.widgets.length === 0) {
    return <EmptyState />;
  }

  switch (doc.layout) {
    case "form":
      return <FormLayout widgets={doc.widgets} />;
    case "two_column":
      return <TwoColumnLayout widgets={doc.widgets} />;
    case "free":
    default:
      return <FreeLayout widgets={doc.widgets} />;
  }
}

// ── Layouts ─────────────────────────────────────────────────────────

function renderWidget(widget: PresentationWidget) {
  const Widget = lookupWidget(widget.kind);
  return (
    <div key={widget.id} data-widget-id={widget.id}>
      <Widget widget={widget} />
    </div>
  );
}

function FreeLayout({ widgets }: { widgets: PresentationWidget[] }) {
  return (
    <div
      data-layout="free"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "oklch(0.12 0.01 250)",
        overflow: "auto",
      }}
    >
      {widgets.map((widget) => {
        const Widget = lookupWidget(widget.kind);
        return (
          <div
            key={widget.id}
            data-widget-id={widget.id}
            style={{
              position: "absolute",
              left: widget.x,
              top: widget.y,
              minWidth: 120,
            }}
          >
            <Widget widget={widget} />
          </div>
        );
      })}
    </div>
  );
}

function FormLayout({ widgets }: { widgets: PresentationWidget[] }) {
  return (
    <div
      data-layout="form"
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        background: "oklch(0.12 0.01 250)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          margin: "0 auto",
          padding: "32px 24px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          color: "#ddd",
        }}
      >
        {widgets.map(renderWidget)}
      </div>
    </div>
  );
}

function TwoColumnLayout({ widgets }: { widgets: PresentationWidget[] }) {
  // Split widgets into three bands by position relative to the
  // left/right-tagged widgets:
  //   - topSpanning:    everything before the first left/right widget
  //   - left / right:   the column-tagged widgets themselves
  //   - bottomSpanning: everything after the last left/right widget
  const firstColIdx = widgets.findIndex(
    (w) => w.column === "left" || w.column === "right",
  );
  const lastColIdx = (() => {
    for (let i = widgets.length - 1; i >= 0; i--) {
      const c = widgets[i].column;
      if (c === "left" || c === "right") return i;
    }
    return -1;
  })();

  const topSpanning = firstColIdx === -1 ? widgets : widgets.slice(0, firstColIdx);
  const middle = firstColIdx === -1 ? [] : widgets.slice(firstColIdx, lastColIdx + 1);
  const bottomSpanning = lastColIdx === -1 ? [] : widgets.slice(lastColIdx + 1);

  const left = middle.filter((w) => w.column === "left");
  const right = middle.filter((w) => w.column === "right");

  const col: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    flex: 1,
    minWidth: 0,
  };

  return (
    <div
      data-layout="two_column"
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        background: "oklch(0.12 0.01 250)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "32px 32px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          color: "#ddd",
        }}
      >
        {topSpanning.length > 0 && (
          <div
            data-band="top"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {topSpanning.map(renderWidget)}
          </div>
        )}
        {(left.length > 0 || right.length > 0) && (
          <div
            data-band="middle"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
              alignItems: "stretch",
            }}
          >
            <div style={col} data-column="left">
              {left.map(renderWidget)}
            </div>
            <div style={col} data-column="right">
              {right.map(renderWidget)}
            </div>
          </div>
        )}
        {bottomSpanning.length > 0 && (
          <div
            data-band="bottom"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            {bottomSpanning.map(renderWidget)}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const setMode = useCircuitStore((s) => s.setMode);
  return (
    <div
      data-layout="empty"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "#888",
        padding: 48,
        textAlign: "center",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 16, color: "#aaa" }}>Nothing to show in presentation mode</div>
      <div style={{ fontSize: 12, maxWidth: 420 }}>
        This circuit has no presentation layer. Load a template, import
        a shared presentation doc, or switch to edit mode to build one.
      </div>
      <button
        onClick={() => setMode("edit")}
        style={{
          marginTop: 12,
          padding: "8px 16px",
          background: "oklch(0.22 0.01 250)",
          border: "1px solid oklch(0.35 0.01 250)",
          borderRadius: 4,
          color: "#ddd",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Edit circuit
      </button>
    </div>
  );
}
