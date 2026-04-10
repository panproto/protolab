/**
 * Inspector panel: shows details of selected node/edge, with editable params.
 */

import { useState } from "react";
import { useCircuitStore, COMPONENT_CATALOG } from "../store/circuitStore";
import type { ParamDef } from "../store/circuitStore";
import * as wasm from "../wasm/bridge";
import { ExpressionEditor } from "../components/ExpressionEditor";

const OPTIC_COLORS: Record<string, string> = {
  iso: "#4CAF50",
  lens: "#2196F3",
  prism: "#9C27B0",
  affine: "#FF9800",
  traversal: "#F44336",
};

export function Inspector() {
  const {
    selectedNodeId,
    selectedEdgeId,
    nodes,
    edges,
    circuitHandle,
    importedSchemas,
    importedTheories,
    importedProtocols,
  } = useCircuitStore();

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId);

  return (
    <div
      style={{
        width: 260,
        background: "oklch(0.13 0.01 250)",
        borderLeft: "1px solid oklch(0.25 0.01 250)",
        overflow: "auto",
        fontSize: 12,
        color: "#ccc",
        padding: "8px 10px",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Inspector</div>

      {selectedNode && <NodeInspector node={selectedNode} />}
      {selectedEdge && !selectedNode && <EdgeInspector edge={selectedEdge} />}
      {!selectedNode && !selectedEdge && (
        <CircuitInspector
          handle={circuitHandle}
          nodeCount={nodes.length}
          edgeCount={edges.length}
          schemas={importedSchemas}
          theories={importedTheories}
          protocols={importedProtocols}
        />
      )}
    </div>
  );
}

function NodeInspector({ node }: { node: any }) {
  const { updateParam, removeComponent, circuitHandle } = useCircuitStore();
  const data = node.data;
  const color = OPTIC_COLORS[data.opticKind] ?? "#666";
  const [bangResult, setBangResult] = useState<string | null>(null);
  const [bangError, setBangError] = useState<string | null>(null);

  const onBang = () => {
    if (circuitHandle === null) return;
    try {
      const result = wasm.bangComponent(circuitHandle, node.id);
      setBangResult(result);
      setBangError(null);
    } catch (err) {
      setBangError(String(err));
      setBangResult(null);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>{data.label}</div>
        <button
          onClick={onBang}
          title="Trigger forward evaluation up to this component"
          style={{
            padding: "3px 8px",
            background: color,
            color: "#fff",
            border: "none",
            borderRadius: 3,
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          ▶ Bang
        </button>
      </div>
      <div style={{ color, fontSize: 10, textTransform: "uppercase", marginBottom: 8 }}>
        {data.opticKind}
      </div>

      {/* Bang output: shows the component's wire data after the most
          recent trigger, or an error if the eval failed. */}
      {(bangResult || bangError) && (
        <div
          style={{
            marginBottom: 8,
            padding: 6,
            background: "oklch(0.1 0.01 250)",
            border: `1px solid ${bangError ? "#F44336" : "oklch(0.3 0.01 250)"}`,
            borderRadius: 3,
          }}
        >
          <div style={{ fontSize: 10, color: "#777", marginBottom: 2 }}>
            {bangError ? "Bang error" : "Wire output"}
          </div>
          <pre
            style={{
              margin: 0,
              fontSize: 10,
              color: bangError ? "#F44336" : "#98c379",
              whiteSpace: "pre-wrap",
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {bangError ?? bangResult}
          </pre>
        </div>
      )}

      {/* Ports */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>Ports</div>
        {(data.ports ?? []).map((p: any) => (
          <div key={p.id} style={{ fontSize: 11, display: "flex", gap: 4, marginBottom: 2 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                border: `1.5px solid ${color}`,
                background: p.trigger === "hot" ? color : "transparent",
                marginTop: 3,
                flexShrink: 0,
              }}
            />
            <span>{p.id}</span>
            <span style={{ color: "#666", marginLeft: "auto" }}>{p.direction}</span>
          </div>
        ))}
      </div>

      {/* Params — look up each param's schema from COMPONENT_CATALOG so the
          UI knows how to render it (text, expression editor, enum dropdown,
          field_ref). Params missing from the catalog (e.g., user-added via
          JSON import) fall back to a plain text input. */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>Parameters</div>
        {(() => {
          const def = COMPONENT_CATALOG.find((c) => c.type === data.componentType);
          const paramDefs: Record<string, ParamDef> = Object.fromEntries(
            (def?.params ?? []).map((p) => [p.key, p]),
          );
          // Include catalog params that aren't yet in data.params (so missing
          // ones can still be filled in).
          const knownKeys = new Set((data.params ?? []).map((p: any) => p.key));
          const catalogOnly = (def?.params ?? [])
            .filter((p) => !knownKeys.has(p.key))
            .map((p) => ({ key: p.key, value: "" }));
          const allParams = [...(data.params ?? []), ...catalogOnly];

          return allParams.map((p: any) => {
            const pdef = paramDefs[p.key];
            const kind = pdef?.kind ?? "text";
            const label = pdef?.label ?? p.key;
            const required = pdef?.required ?? false;
            const badge =
              kind === "expression"
                ? "expr"
                : kind === "enum"
                  ? "enum"
                  : kind === "field_ref"
                    ? "field"
                    : null;
            return (
              <div key={p.key} style={{ marginBottom: 6 }}>
                <label style={{ fontSize: 10, color: "#999" }}>
                  {label}
                  {required && <span style={{ color: "#F44336", marginLeft: 2 }}>*</span>}
                  {badge && (
                    <span style={{ marginLeft: 4, color: "#61afef", fontSize: 9 }}>
                      {badge}
                    </span>
                  )}
                </label>
                {kind === "expression" ? (
                  <div style={{ marginTop: 2 }}>
                    <ExpressionEditor
                      value={p.value}
                      onChange={(v) => updateParam(node.id, p.key, v)}
                      compact
                      height={80}
                      placeholder={pdef?.default ?? ""}
                    />
                  </div>
                ) : kind === "enum" ? (
                  <select
                    value={p.value}
                    onChange={(e) => updateParam(node.id, p.key, e.target.value)}
                    style={{
                      width: "100%",
                      padding: "3px 6px",
                      background: "oklch(0.18 0.01 250)",
                      border: "1px solid oklch(0.3 0.01 250)",
                      borderRadius: 3,
                      color: "#ddd",
                      fontSize: 11,
                      outline: "none",
                      marginTop: 2,
                    }}
                  >
                    {(pdef?.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === "" ? "(default)" : opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    defaultValue={p.value}
                    onBlur={(e) => updateParam(node.id, p.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    style={{
                      width: "100%",
                      padding: "3px 6px",
                      background: "oklch(0.18 0.01 250)",
                      border: "1px solid oklch(0.3 0.01 250)",
                      borderRadius: 3,
                      color: "#ddd",
                      fontSize: 11,
                      outline: "none",
                      marginTop: 2,
                    }}
                  />
                )}
              </div>
            );
          });
        })()}
      </div>

      <button
        onClick={() => removeComponent(node.id)}
        title="Remove this component from the circuit (Backspace)"
        style={{
          padding: "4px 10px",
          background: "#F44336",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 11,
        }}
      >
        Delete Component
      </button>
    </div>
  );
}

function EdgeInspector({ edge }: { edge: any }) {
  const { removeWire } = useCircuitStore();
  const optic = edge.data?.opticKind ?? "lens";
  const color = OPTIC_COLORS[optic] ?? "#666";

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Wire</div>
      <div style={{ color, fontSize: 10, textTransform: "uppercase", marginBottom: 8 }}>
        {optic}
      </div>
      <div style={{ fontSize: 11, marginBottom: 2 }}>
        Source: <span style={{ color: "#eee" }}>{edge.source}</span>
      </div>
      <div style={{ fontSize: 11, marginBottom: 8 }}>
        Target: <span style={{ color: "#eee" }}>{edge.target}</span>
      </div>
      <button
        onClick={() => removeWire(edge.id)}
        title="Remove this wire from the circuit (Backspace)"
        style={{
          padding: "4px 10px",
          background: "#F44336",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 11,
        }}
      >
        Delete Wire
      </button>
    </div>
  );
}

function CircuitInspector({
  handle,
  nodeCount,
  edgeCount,
  schemas,
  theories,
  protocols,
}: {
  handle: number | null;
  nodeCount: number;
  edgeCount: number;
  schemas: any[];
  theories: any[];
  protocols: any[];
}) {
  return (
    <div>
      <div style={{ fontSize: 11, marginBottom: 8 }}>
        <span style={{ color: "#777" }}>Components:</span> {nodeCount}
        <br />
        <span style={{ color: "#777" }}>Wires:</span> {edgeCount}
      </div>

      {/* Export buttons */}
      {handle !== null && <ExportButtons handle={handle} />}

      {/* Imported schemas */}
      {schemas.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>Imported Schemas</div>
          {schemas.map((s, i) => (
            <div key={i} style={{ fontSize: 11, marginBottom: 2 }}>
              {s.protocol} ({s.vertexCount}V, {s.edgeCount}E)
            </div>
          ))}
        </div>
      )}

      {/* Imported theories */}
      {theories.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>Imported Theories</div>
          {theories.map((t, i) => (
            <div key={i} style={{ fontSize: 11, marginBottom: 2 }}>
              {t.name} ({t.sortCount}S, {t.opCount}O)
            </div>
          ))}
        </div>
      )}

      {/* User-defined protocols */}
      {protocols.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>User Protocols</div>
          {protocols.map((p, i) => (
            <div key={i} style={{ fontSize: 11, marginBottom: 2 }}>
              {p.name}{" "}
              <span style={{ color: "#666" }}>
                ({p.objKindCount}K, {p.edgeRuleCount}R)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportButtons({ handle }: { handle: number }) {
  const download = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buttonStyle: React.CSSProperties = {
    padding: "4px 8px",
    background: "oklch(0.22 0.01 250)",
    border: "1px solid oklch(0.35 0.01 250)",
    borderRadius: 3,
    color: "#ccc",
    cursor: "pointer",
    fontSize: 10,
  };

  return (
    <div>
      <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>Export</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        <button
          style={buttonStyle}
          title="Download the circuit as a schema JSON document"
          onClick={() => download(wasm.exportJson(handle), "circuit.json")}
        >
          Schema JSON
        </button>
        <button
          style={buttonStyle}
          title="Download the circuit as a panproto lens document (JSON)"
          onClick={() => download(wasm.exportLensJson(handle), "lens.json")}
        >
          Lens JSON
        </button>
        <button
          style={buttonStyle}
          title="Download the circuit as a YAML lens document"
          onClick={() => download(wasm.exportYaml(handle), "lens.yaml")}
        >
          YAML
        </button>
        <button
          style={buttonStyle}
          title="Download the circuit as a Nickel lens specification"
          onClick={() => download(wasm.exportNickel(handle), "lens.ncl")}
        >
          Nickel
        </button>
      </div>
    </div>
  );
}
