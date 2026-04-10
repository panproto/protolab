import type { WidgetProps } from "../WidgetRegistry";
import { getProp } from "./widgetHelpers";

/**
 * Paragraph widget: renders `text` as a multi-line paragraph. Newlines
 * in the source text become line breaks; no markdown parsing.
 */
export function ParagraphWidget({ widget }: WidgetProps) {
  const text = getProp(widget, "text", "");
  return (
    <p
      data-widget="paragraph"
      style={{
        margin: 0,
        color: "#bbb",
        fontSize: 13,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        maxWidth: 640,
      }}
    >
      {text}
    </p>
  );
}
