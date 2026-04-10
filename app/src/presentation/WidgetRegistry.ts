/**
 * Widget registry: maps a `PresentationWidget.kind` to a React component
 * that renders it. Widgets are pure UI chrome — they live in the
 * presentation layer (`presentationDoc.widgets`), NOT as circuit nodes.
 * That's what keeps the edit-mode circuit canvas clean: it only shows
 * the real lens components (rename_field, compute_field, etc.).
 */

import type { ComponentType } from "react";

import { HeadingWidget } from "./widgets/HeadingWidget";
import { ParagraphWidget } from "./widgets/ParagraphWidget";
import { PanelWidget } from "./widgets/PanelWidget";
import { InputJsonWidget } from "./widgets/InputJsonWidget";
import { OutputJsonWidget } from "./widgets/OutputJsonWidget";
import { RunButtonWidget } from "./widgets/RunButtonWidget";
import { LexiconImportWidget } from "./widgets/LexiconImportWidget";
import { UnknownWidget } from "./widgets/UnknownWidget";
import type { PresentationWidget, WidgetKind } from "../store/circuitStore";

/** Props passed uniformly to every widget renderer. */
export interface WidgetProps {
  widget: PresentationWidget;
}

export type WidgetComponent = ComponentType<WidgetProps>;

const REGISTRY: Record<WidgetKind, WidgetComponent> = {
  heading: HeadingWidget,
  paragraph: ParagraphWidget,
  panel: PanelWidget,
  input_json: InputJsonWidget,
  output_json: OutputJsonWidget,
  run_button: RunButtonWidget,
  lexicon_import: LexiconImportWidget,
};

/**
 * Look up a widget component by kind, returning a placeholder for
 * unknown kinds so a malformed presentation doc still renders something
 * the author can see and fix.
 */
export function lookupWidget(kind: string): WidgetComponent {
  return (REGISTRY as Record<string, WidgetComponent>)[kind] ?? UnknownWidget;
}

/** The set of known widget kinds. */
export const KNOWN_WIDGETS: WidgetKind[] = Object.keys(REGISTRY) as WidgetKind[];
