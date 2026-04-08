/**
 * Data panel: bottom panel showing input, output, and per-wire data
 * for the currently-selected wire.
 */

import { useCircuitStore } from "../store/circuitStore";

export function DataPanel() {
  const {
    inputDataJson,
    outputDataJson,
    wireDataMap,
    evaluationError,
    selectedWireId,
    setInputData,
    runEvaluation,
    applyModifiedOutput,
    sourceSchemaHandle,
  } = useCircuitStore();

  const wireData = selectedWireId ? wireDataMap[selectedWireId] : null;

  const sectionStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "oklch(0.13 0.01 250)",
    border: "1px solid oklch(0.25 0.01 250)",
    borderRadius: 4,
    overflow: "hidden",
  };

  const headerStyle: React.CSSProperties = {
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 600,
    color: "#999",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    borderBottom: "1px solid oklch(0.22 0.01 250)",
    background: "oklch(0.16 0.01 250)",
    display: "flex",
    alignItems: "center",
    gap: 6,
  };

  const textareaStyle: React.CSSProperties = {
    flex: 1,
    background: "oklch(0.1 0.01 250)",
    color: "#ddd",
    fontFamily: "monospace",
    fontSize: 11,
    padding: 8,
    border: "none",
    outline: "none",
    resize: "none",
  };

  const buttonStyle: React.CSSProperties = {
    padding: "2px 8px",
    background: "oklch(0.22 0.01 250)",
    border: "1px solid oklch(0.35 0.01 250)",
    borderRadius: 3,
    color: "#ccc",
    cursor: "pointer",
    fontSize: 10,
    marginLeft: "auto",
  };

  return (
    <div
      style={{
        height: 240,
        background: "oklch(0.11 0.01 250)",
        borderTop: "1px solid oklch(0.25 0.01 250)",
        display: "flex",
        gap: 8,
        padding: 8,
      }}
    >
      {/* Input */}
      <div style={sectionStyle}>
        <div style={headerStyle}>
          <span>Input</span>
          <button style={buttonStyle} onClick={runEvaluation} disabled={sourceSchemaHandle === null}>
            Run ▶
          </button>
        </div>
        <textarea
          value={inputDataJson}
          onChange={(e) => setInputData(e.target.value)}
          style={textareaStyle}
          spellCheck={false}
        />
      </div>

      {/* Wire data */}
      <div style={sectionStyle}>
        <div style={headerStyle}>
          <span>{selectedWireId ? `Wire: ${selectedWireId}` : "Wire (click an edge)"}</span>
        </div>
        <textarea
          value={wireData ?? (selectedWireId ? "(no data — run evaluation)" : "(select a wire to inspect)")}
          readOnly
          style={{ ...textareaStyle, color: wireData ? "#ddd" : "#666" }}
          spellCheck={false}
        />
      </div>

      {/* Output */}
      <div style={sectionStyle}>
        <div style={headerStyle}>
          <span>Output</span>
          <button
            style={buttonStyle}
            onClick={() => applyModifiedOutput(outputDataJson)}
            disabled={!outputDataJson}
          >
            ◀ Apply Back
          </button>
        </div>
        <textarea
          value={outputDataJson || "(run evaluation to see output)"}
          onChange={(e) => useCircuitStore.setState({ outputDataJson: e.target.value })}
          style={{ ...textareaStyle, color: outputDataJson ? "#ddd" : "#666" }}
          spellCheck={false}
        />
      </div>

      {evaluationError && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            background: "#F44336",
            color: "#fff",
            padding: "6px 12px",
            borderRadius: 4,
            fontSize: 11,
            maxWidth: 400,
            zIndex: 100,
          }}
        >
          {evaluationError}
        </div>
      )}
    </div>
  );
}
