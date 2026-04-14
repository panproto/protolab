/**
 * Presentation canvas: renders the presentation layer
 * (`presentationDoc.widgets`) via the WidgetRegistry in a vertical
 * form layout — widgets are stacked top-to-bottom in a centered column.
 *
 * Widgets are pure UI chrome — they don't exist as circuit nodes — so
 * edit mode stays clean and presentation mode is a separate, curated view.
 */

import { useCircuitStore, type PresentationWidget } from "../store/circuitStore";
import { lookupWidget } from "./WidgetRegistry";

export function PresentationCanvas() {
  const doc = useCircuitStore((s) => s.presentationDoc);

  if (doc.widgets.length === 0) {
    return <EmptyState />;
  }

  return <FormLayout widgets={doc.widgets} />;
}

// ── Layout ──────────────────────────────────────────────────────────

function renderWidget(widget: PresentationWidget) {
  const Widget = lookupWidget(widget.kind);
  return (
    <div key={widget.id} data-widget-id={widget.id}>
      <Widget widget={widget} />
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
        data-testid="empty-presentation-edit-link"
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
