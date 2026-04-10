import type { WidgetProps } from "../WidgetRegistry";
import { getProp } from "./widgetHelpers";

/**
 * Panel widget: a bordered container with an optional title, useful
 * as a visual section break in form/free layouts.
 */
export function PanelWidget({ widget }: WidgetProps) {
  const title = getProp(widget, "title", "");
  return (
    <div
      data-widget="panel"
      style={{
        border: "1px solid oklch(0.3 0.01 250)",
        borderRadius: 6,
        padding: 12,
        background: "oklch(0.14 0.01 250)",
        minWidth: 180,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#888",
            marginBottom: 8,
          }}
        >
          {title}
        </div>
      )}
    </div>
  );
}
