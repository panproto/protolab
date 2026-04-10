/**
 * Small helpers for widget renderers to read from a
 * `PresentationWidget.props` map with a default fallback.
 */

import type { PresentationWidget } from "../../store/circuitStore";

export function getProp(widget: PresentationWidget, key: string, fallback = ""): string {
  return widget.props[key] ?? fallback;
}
