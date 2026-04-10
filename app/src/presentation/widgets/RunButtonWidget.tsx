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

  return (
    <button
      data-widget="run_button"
      onClick={runEvaluation}
      style={{
        padding: "12px 24px",
        background: "#FF9800",
        color: "#1a1a1a",
        border: "none",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      ▶ {label}
    </button>
  );
}
