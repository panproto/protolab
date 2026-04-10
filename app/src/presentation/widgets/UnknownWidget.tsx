import type { WidgetProps } from "../WidgetRegistry";

/**
 * Fallback widget used when a `PresentationWidget.kind` is not
 * registered. Shows a small warning box so authors can see and fix
 * malformed presentation docs without the canvas going blank.
 */
export function UnknownWidget({ widget }: WidgetProps) {
  return (
    <div
      data-widget="unknown"
      style={{
        padding: "8px 12px",
        border: "1px dashed #F44336",
        borderRadius: 4,
        background: "oklch(0.14 0.01 250)",
        color: "#F44336",
        fontSize: 12,
        fontFamily: "ui-monospace, SF Mono, monospace",
      }}
    >
      unknown widget: <strong>{widget.kind}</strong>
    </div>
  );
}
