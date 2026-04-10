import type { WidgetProps } from "../WidgetRegistry";
import { getProp } from "./widgetHelpers";

/**
 * Heading widget: renders `text` as h1/h2/h3 depending on `level`.
 * Levels outside 1..3 clamp to the nearest valid value.
 */
export function HeadingWidget({ widget }: WidgetProps) {
  const text = getProp(widget, "text", "Heading");
  const levelRaw = parseInt(getProp(widget, "level", "1"), 10);
  const level = Number.isFinite(levelRaw) ? Math.max(1, Math.min(3, levelRaw)) : 1;

  const sizes = { 1: 28, 2: 20, 3: 15 } as const;
  const Tag = (["h1", "h2", "h3"] as const)[level - 1];

  return (
    <Tag
      data-widget="heading"
      style={{
        margin: 0,
        fontSize: sizes[level as 1 | 2 | 3],
        fontWeight: 600,
        color: "#eaeaea",
        letterSpacing: "-0.01em",
      }}
    >
      {text}
    </Tag>
  );
}
