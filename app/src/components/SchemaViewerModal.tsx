/**
 * Modal that shows a schema's vertices, edges, and constraints. Opened
 * from the SchemaImportForm assigned-banner and from the schema-mapping
 * panel's "View source / target" links. Reads details lazily via
 * `wasm.getSchemaDetails`.
 *
 * The viewer is a flat searchable list — not a graph rendering — so it
 * loads instantly even on large lexicons. Click a vertex id to copy it
 * to the clipboard so the user can paste it into the HintEditor as an
 * anchor.
 */

import { useEffect, useMemo, useState } from "react";
import * as wasm from "../wasm/bridge";
import type { SchemaDetails, SchemaVertexDetail } from "../wasm/bridge";

interface Props {
  schemaHandle: number;
  /** Optional human-readable label rendered in the header. */
  label?: string;
  onClose: () => void;
  /**
   * Optional callback invoked when the user clicks a vertex id. Used
   * by the HintEditor to feed picks into anchor declarations.
   */
  onPickVertex?: (vertexId: string) => void;
}

export function SchemaViewerModal({
  schemaHandle,
  label,
  onClose,
  onPickVertex,
}: Props) {
  const [details, setDetails] = useState<SchemaDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    try {
      setDetails(wasm.getSchemaDetails(schemaHandle));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [schemaHandle]);

  const filtered = useMemo<SchemaVertexDetail[]>(() => {
    if (!details) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return details.vertices;
    return details.vertices.filter(
      (v) =>
        v.id.toLowerCase().includes(q) ||
        v.kind.toLowerCase().includes(q) ||
        (v.nsid?.toLowerCase().includes(q) ?? false),
    );
  }, [details, filter]);

  const edgesForVertex = useMemo(() => {
    const map: Record<string, wasm.SchemaEdgeDetail[]> = {};
    if (details) {
      for (const e of details.edges) {
        (map[e.src] ??= []).push(e);
      }
    }
    return map;
  }, [details]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        data-testid="schema-viewer-modal"
        style={{
          background: "oklch(0.14 0.01 250)",
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 8,
          width: 720,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          color: "#ddd",
          fontSize: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid oklch(0.25 0.01 250)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {label ?? "Schema"}
          </div>
          {details && (
            <div style={{ fontSize: 10, color: "#888" }}>
              {details.protocol} · {details.vertices.length}V ·{" "}
              {details.edges.length}E
              {details.root && <> · root: <code>{details.root}</code></>}
            </div>
          )}
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto",
              padding: "2px 10px",
              background: "oklch(0.22 0.01 250)",
              border: "1px solid oklch(0.35 0.01 250)",
              borderRadius: 3,
              color: "#ccc",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: "8px 16px", borderBottom: "1px solid oklch(0.22 0.01 250)" }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter vertices by id, kind, or NSID…"
            spellCheck={false}
            style={{
              width: "100%",
              padding: "6px 8px",
              background: "oklch(0.1 0.01 250)",
              border: "1px solid oklch(0.3 0.01 250)",
              borderRadius: 3,
              color: "#ddd",
              fontFamily: "ui-monospace, SF Mono, monospace",
              fontSize: 12,
              outline: "none",
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 12px" }}>
          {error && (
            <div style={{ color: "#F44336", padding: 12, fontFamily: "monospace" }}>
              {error}
            </div>
          )}
          {!error && filtered.length === 0 && (
            <div style={{ color: "#666", padding: 12 }}>
              {details ? "No vertices match the filter." : "Loading…"}
            </div>
          )}
          {filtered.map((v) => (
            <VertexRow
              key={v.id}
              vertex={v}
              edges={edgesForVertex[v.id] ?? []}
              onPick={onPickVertex}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function VertexRow({
  vertex,
  edges,
  onPick,
}: {
  vertex: SchemaVertexDetail;
  edges: wasm.SchemaEdgeDetail[];
  onPick?: (id: string) => void;
}) {
  return (
    <div
      data-testid="schema-viewer-vertex"
      style={{
        padding: "8px 0",
        borderBottom: "1px solid oklch(0.18 0.01 250)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <button
          onClick={() => onPick?.(vertex.id)}
          title={onPick ? "Pick this vertex as a hint anchor" : "Vertex id"}
          style={{
            padding: "1px 6px",
            background: onPick ? "oklch(0.2 0.04 280)" : "transparent",
            border: "1px solid oklch(0.3 0.02 280)",
            borderRadius: 3,
            color: "#ddd",
            cursor: onPick ? "pointer" : "default",
            fontFamily: "ui-monospace, SF Mono, monospace",
            fontSize: 11,
          }}
        >
          {vertex.id}
        </button>
        <span style={{ fontSize: 10, color: "#888" }}>{vertex.kind}</span>
        {vertex.nsid && (
          <span style={{ fontSize: 10, color: "#61afef" }}>{vertex.nsid}</span>
        )}
      </div>
      {edges.length > 0 && (
        <div style={{ marginLeft: 16, marginTop: 4 }}>
          {edges.map((e, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                color: "#aaa",
                fontFamily: "ui-monospace, SF Mono, monospace",
              }}
            >
              <span style={{ color: "#666" }}>{e.kind}</span>
              {e.name && <span style={{ color: "#98c379" }}> {e.name}</span>}
              <span style={{ color: "#666" }}> →</span>{" "}
              <span>{e.tgt}</span>
            </div>
          ))}
        </div>
      )}
      {vertex.constraints.length > 0 && (
        <div style={{ marginLeft: 16, marginTop: 4 }}>
          {vertex.constraints.map((c, i) => (
            <div key={i} style={{ fontSize: 10, color: "#999" }}>
              <span style={{ color: "#FF9800" }}>{c.sort}</span>
              {": "}
              <span style={{ color: "#ddd" }}>{c.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
