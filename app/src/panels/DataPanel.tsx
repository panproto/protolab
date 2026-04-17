/**
 * Data panel: bottom panel showing input, output, and per-wire data
 * for the currently-selected wire.
 */

import { useState } from "react";
import { useCircuitStore, hasDataLevelMapping } from "../store/circuitStore";

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
    outputValidation,
  } = useCircuitStore();
  const runnable = useCircuitStore(hasDataLevelMapping);
  const [showValidationDetails, setShowValidationDetails] = useState(false);

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
      className="data-panel"
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
          <button
            style={buttonStyle}
            onClick={runEvaluation}
            disabled={sourceSchemaHandle === null || !runnable}
            title={
              sourceSchemaHandle === null
                ? "Assign a source schema first"
                : !runnable
                  ? "No data-level mapping yet — add hints or build the lens"
                  : "Run the lens forward on the input"
            }
          >
            Run ▶
          </button>
        </div>
        <textarea
          data-testid="data-panel-input"
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
          data-testid="data-panel-wire"
          value={wireData ?? (selectedWireId ? "(no data — run evaluation)" : "(select a wire to inspect)")}
          readOnly
          style={{ ...textareaStyle, color: wireData ? "#ddd" : "#666" }}
          spellCheck={false}
        />
      </div>

      {/* Output */}
      <div style={{ ...sectionStyle, position: "relative" }}>
        <div style={headerStyle}>
          <span>Output</span>
          {outputValidation && (
            <button
              onClick={() => setShowValidationDetails((v) => !v)}
              title={
                outputValidation.valid
                  ? "Output conforms to target schema"
                  : `${outputValidation.errors.length} validation error(s) — click for details`
              }
              data-testid="output-validation-badge"
              data-valid={outputValidation.valid ? "true" : "false"}
              style={{
                padding: "1px 6px",
                borderRadius: 3,
                border: "none",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.05em",
                cursor: outputValidation.valid ? "default" : "pointer",
                background: outputValidation.valid ? "#1B5E20" : "#B71C1C",
                color: "#fff",
              }}
            >
              {outputValidation.valid
                ? "✓ VALID"
                : `✗ ${outputValidation.errors.length} ERR`}
            </button>
          )}
          <button
            style={buttonStyle}
            onClick={() => applyModifiedOutput(outputDataJson)}
            disabled={!outputDataJson}
          >
            ◀ Apply Back
          </button>
        </div>
        <textarea
          data-testid="data-panel-output"
          value={outputDataJson || "(run evaluation to see output)"}
          onChange={(e) => useCircuitStore.setState({ outputDataJson: e.target.value })}
          style={{ ...textareaStyle, color: outputDataJson ? "#ddd" : "#666" }}
          spellCheck={false}
        />
        {outputValidation && !outputValidation.valid && showValidationDetails && (
          <div
            data-testid="output-validation-details"
            style={{
              position: "absolute",
              top: 28,
              left: 8,
              right: 8,
              maxHeight: 140,
              overflowY: "auto",
              background: "oklch(0.14 0.02 25)",
              border: "1px solid #B71C1C",
              borderRadius: 4,
              padding: 8,
              zIndex: 50,
              fontSize: 10,
              color: "#F8BBD0",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Output does not conform to target schema:
            </div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {outputValidation.errors.map((e, i) => (
                <li key={i} style={{ marginBottom: 2 }}>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}
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
