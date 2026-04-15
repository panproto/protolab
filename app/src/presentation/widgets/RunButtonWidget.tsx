import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore, hasDataLevelMapping } from "../../store/circuitStore";
import { getProp } from "./widgetHelpers";

/**
 * Run button widget: triggers forward evaluation of the circuit
 * against the current `inputDataJson`, populating `outputDataJson`.
 */
export function RunButtonWidget({ widget }: WidgetProps) {
  const label = getProp(widget, "label", "Run");
  const runEvaluation = useCircuitStore((s) => s.runEvaluation);
  // Disable until the source schema is assigned. The Lexicon Mapper
  // template resolves it asynchronously from lexicon.garden, so an
  // eager click would otherwise race the fetch and produce a
  // "no source schema assigned" error.
  const sourceReady = useCircuitStore((s) => s.sourceSchemaHandle !== null);
  const runnable = useCircuitStore(hasDataLevelMapping);
  const enabled = sourceReady && runnable;

  return (
    <button
      data-widget="run_button"
      data-ready={enabled ? "true" : "false"}
      onClick={runEvaluation}
      disabled={!enabled}
      title={
        !sourceReady
          ? "Waiting for source schema to resolve…"
          : !runnable
            ? "No data-level mapping yet — add hints or build the lens"
            : "Run the lens forward on the input data and show the output"
      }
      style={{
        padding: "12px 24px",
        background: enabled ? "#FF9800" : "oklch(0.3 0.01 250)",
        color: enabled ? "#1a1a1a" : "#888",
        border: "none",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: 700,
        cursor: enabled ? "pointer" : "not-allowed",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      ▶ {label}
    </button>
  );
}
