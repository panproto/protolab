/**
 * Schema browser modal: lists imported schemas and theories,
 * lets you assign a schema as the source for the current circuit.
 */

import { useCircuitStore } from "../store/circuitStore";

export function SchemaBrowser({ onClose }: { onClose: () => void }) {
  const {
    importedSchemas,
    importedTheories,
    sourceSchemaHandle,
    targetSchemaHandle,
    assignSourceSchema,
    assignTargetSchema,
  } = useCircuitStore();

  const buttonStyle: React.CSSProperties = {
    padding: "3px 8px",
    background: "#2196F3",
    color: "#fff",
    border: "none",
    borderRadius: 3,
    cursor: "pointer",
    fontSize: 10,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "oklch(0.16 0.01 250)",
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 8,
          padding: 20,
          width: 600,
          maxHeight: "80vh",
          overflow: "auto",
          color: "#ccc",
          fontSize: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Schemas & Theories</div>
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid oklch(0.3 0.01 250)",
              color: "#ccc",
              padding: "2px 8px",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Close
          </button>
        </div>

        {/* Schemas */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              color: "#777",
              letterSpacing: "0.05em",
              marginBottom: 6,
            }}
          >
            Imported Schemas ({importedSchemas.length})
          </div>
          {importedSchemas.length === 0 ? (
            <div style={{ color: "#666", fontStyle: "italic", padding: 8 }}>
              No schemas imported. Use Toolbar → Import → Schema (JSON).
            </div>
          ) : (
            importedSchemas.map((s) => (
              <div
                key={s.handle}
                style={{
                  padding: "6px 10px",
                  background:
                    sourceSchemaHandle === s.handle
                      ? "oklch(0.2 0.05 220)"
                      : targetSchemaHandle === s.handle
                        ? "oklch(0.2 0.03 300)"
                        : "oklch(0.14 0.01 250)",
                  borderLeft:
                    sourceSchemaHandle === s.handle
                      ? "3px solid #2196F3"
                      : targetSchemaHandle === s.handle
                        ? "3px solid #9C27B0"
                        : "3px solid transparent",
                  marginBottom: 4,
                  borderRadius: 3,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: "#777" }}>
                    Protocol: {s.protocol} · Vertices: {s.vertexCount} · Edges: {s.edgeCount}
                  </div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button
                    style={buttonStyle}
                    onClick={() => {
                      assignSourceSchema(s.handle);
                      onClose();
                    }}
                    disabled={sourceSchemaHandle === s.handle}
                    title="Set this schema as the circuit source (left side of the lens)"
                  >
                    {sourceSchemaHandle === s.handle ? "Source ✓" : "Use as source"}
                  </button>
                  <button
                    style={{ ...buttonStyle, background: "#9C27B0" }}
                    onClick={() => {
                      assignTargetSchema(s.handle);
                      onClose();
                    }}
                    disabled={targetSchemaHandle === s.handle}
                    title="Set this schema as the circuit target (right side of the lens)"
                  >
                    {targetSchemaHandle === s.handle ? "Target ✓" : "Use as target"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Theories */}
        <div>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              color: "#777",
              letterSpacing: "0.05em",
              marginBottom: 6,
            }}
          >
            Imported Theories ({importedTheories.length})
          </div>
          {importedTheories.length === 0 ? (
            <div style={{ color: "#666", fontStyle: "italic", padding: 8 }}>
              No theories yet. Use Toolbar → Theories to build one.
            </div>
          ) : (
            importedTheories.map((t, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 10px",
                  background: "oklch(0.14 0.01 250)",
                  marginBottom: 4,
                  borderRadius: 3,
                }}
              >
                <div style={{ fontWeight: 500 }}>{t.name}</div>
                <div style={{ fontSize: 10, color: "#777" }}>
                  Sorts: {t.sortCount} · Operations: {t.opCount}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
