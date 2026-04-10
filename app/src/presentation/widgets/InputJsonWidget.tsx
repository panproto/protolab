import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore } from "../../store/circuitStore";
import { getProp } from "./widgetHelpers";

/**
 * Input JSON widget: textarea bound to `inputDataJson` in the store.
 * Uses a plain `<textarea>` rather than CodeMirror to keep the bundle
 * small; the edit-mode DataPanel still uses CodeMirror for authoring.
 */
export function InputJsonWidget({ widget }: WidgetProps) {
  const label = getProp(widget, "label", "Input");
  const inputDataJson = useCircuitStore((s) => s.inputDataJson);
  const setInputData = useCircuitStore((s) => s.setInputData);

  return (
    <div
      data-widget="input_json"
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
      <textarea
        aria-label={label}
        value={inputDataJson}
        onChange={(e) => setInputData(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%",
          flex: 1,
          minHeight: 260,
          padding: 10,
          background: "oklch(0.1 0.01 250)",
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 4,
          color: "#e0e0e0",
          fontFamily: "ui-monospace, SF Mono, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          outline: "none",
          resize: "vertical",
        }}
      />
    </div>
  );
}
