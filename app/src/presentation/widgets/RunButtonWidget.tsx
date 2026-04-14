import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore } from "../../store/circuitStore";
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

  return (
    <button
      data-widget="run_button"
      data-ready={sourceReady ? "true" : "false"}
      onClick={runEvaluation}
      disabled={!sourceReady}
      title={
        sourceReady
          ? "Run the lens forward on the input data and show the output"
          : "Waiting for source schema to resolve…"
      }
      style={{
        padding: "12px 24px",
        background: sourceReady ? "#FF9800" : "oklch(0.3 0.01 250)",
        color: sourceReady ? "#1a1a1a" : "#888",
        border: "none",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: 700,
        cursor: sourceReady ? "pointer" : "wait",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      ▶ {label}
    </button>
  );
}
