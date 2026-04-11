import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore } from "../../store/circuitStore";

/**
 * Schema mapping widget: shows the vertex/edge correspondences between
 * source and target schemas as derived from the auto-generated lens's
 * CompiledMigration. Renders alongside the data column so the user
 * sees theory-level transforms (schema mapping) next to instance-level
 * transforms (data I/O).
 *
 * Only visible when an auto-lens is active (autoLensSchemaMapping is
 * non-null). Shows: renamed vertices, added vertices, removed vertices,
 * and per-vertex field transforms.
 */
export function SchemaMappingWidget(_props: WidgetProps) {
  const mapping = useCircuitStore((s) => s.autoLensSchemaMapping);
  const status = useCircuitStore((s) => s.autoLensStatus);

  if (!mapping || status !== "success") {
    return null;
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#888",
    marginBottom: 4,
    marginTop: 12,
  };

  const itemStyle: React.CSSProperties = {
    fontSize: 12,
    fontFamily: "ui-monospace, SF Mono, monospace",
    color: "#bbb",
    padding: "2px 0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div
      data-widget="schema_mapping"
      style={{
        padding: 12,
        background: "oklch(0.13 0.01 250)",
        border: "1px solid oklch(0.25 0.01 250)",
        borderRadius: 6,
        maxHeight: 400,
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#ccc", marginBottom: 8 }}>
        Schema mapping
      </div>

      {mapping.vertexRemap.length > 0 && (
        <>
          <div style={sectionLabel}>Renamed ({mapping.vertexRemap.length})</div>
          {mapping.vertexRemap.slice(0, 20).map(([src, tgt], i) => (
            <div key={`r-${i}`} style={itemStyle} title={`${src} → ${tgt}`}>
              <span style={{ color: "#F44336" }}>{shortName(src)}</span>
              {" → "}
              <span style={{ color: "#4CAF50" }}>{shortName(tgt)}</span>
            </div>
          ))}
          {mapping.vertexRemap.length > 20 && (
            <div style={{ ...itemStyle, color: "#666" }}>
              and {mapping.vertexRemap.length - 20} more…
            </div>
          )}
        </>
      )}

      {mapping.removedVertices.length > 0 && (
        <>
          <div style={sectionLabel}>Removed ({mapping.removedVertices.length})</div>
          {mapping.removedVertices.slice(0, 15).map((v, i) => (
            <div key={`d-${i}`} style={{ ...itemStyle, color: "#F44336" }} title={v}>
              − {shortName(v)}
            </div>
          ))}
          {mapping.removedVertices.length > 15 && (
            <div style={{ ...itemStyle, color: "#666" }}>
              and {mapping.removedVertices.length - 15} more…
            </div>
          )}
        </>
      )}

      {mapping.addedVertices.length > 0 && (
        <>
          <div style={sectionLabel}>Added ({mapping.addedVertices.length})</div>
          {mapping.addedVertices.slice(0, 15).map((v, i) => (
            <div key={`a-${i}`} style={{ ...itemStyle, color: "#4CAF50" }} title={v}>
              + {shortName(v)}
            </div>
          ))}
          {mapping.addedVertices.length > 15 && (
            <div style={{ ...itemStyle, color: "#666" }}>
              and {mapping.addedVertices.length - 15} more…
            </div>
          )}
        </>
      )}

      {mapping.fieldTransforms.length > 0 && (
        <>
          <div style={sectionLabel}>Field transforms ({mapping.fieldTransforms.length})</div>
          {mapping.fieldTransforms.slice(0, 10).map(([vertex, transforms], i) => (
            <div key={`ft-${i}`} style={{ marginBottom: 4 }}>
              <div style={{ ...itemStyle, color: "#61afef", fontWeight: 500 }}>
                {shortName(vertex)}
              </div>
              {transforms.map((desc, j) => (
                <div key={j} style={{ ...itemStyle, paddingLeft: 12, color: "#999" }}>
                  {desc}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {mapping.survivingVertices.length > 0 && (
        <div style={{ ...sectionLabel, color: "#666" }}>
          {mapping.survivingVertices.length} vertices unchanged
        </div>
      )}
    </div>
  );
}

/** Shorten a fully-qualified vertex ID for display. */
function shortName(fqn: string): string {
  const parts = fqn.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : fqn;
}
