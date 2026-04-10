import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore } from "../../store/circuitStore";
import { getProp } from "./widgetHelpers";

/**
 * Output JSON widget: read-only textarea showing `outputDataJson` or
 * the most recent evaluation error. Paired with `RunButtonWidget` to
 * form the "run → see result" flow in presentation mode.
 */
export function OutputJsonWidget({ widget }: WidgetProps) {
  const label = getProp(widget, "label", "Output");
  const outputDataJson = useCircuitStore((s) => s.outputDataJson);
  const evaluationError = useCircuitStore((s) => s.evaluationError);

  const body = evaluationError
    ? `// error:\n${evaluationError}`
    : outputDataJson || "// run to see output";
  const color = evaluationError ? "#F44336" : "#98c379";

  return (
    <div
      data-widget="output_json"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 280,
      }}
    >
      <label
        style={{
          fontSize: 11,
          color: "#999",
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </label>
      <pre
        aria-label={label}
        style={{
          margin: 0,
          width: "100%",
          flex: 1,
          minHeight: 260,
          padding: 10,
          background: "oklch(0.1 0.01 250)",
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 4,
          color,
          fontFamily: "ui-monospace, SF Mono, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflow: "auto",
        }}
      >
        {body}
      </pre>
    </div>
  );
}
