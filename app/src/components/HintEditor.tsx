/**
 * Hint editor modal: lets the user supply anchors / scope / exclusion
 * data to guide auto-lens generation. Lives in both edit and presentation
 * mode (rendered by App.tsx whenever `hintEditorOpen` is true), so the
 * two modes share the same hint state.
 *
 * The picker buttons launch the SchemaViewerModal scoped to the source
 * or target schema; clicking a vertex inside the viewer pushes its id
 * into the anchor row that opened the viewer.
 */

import { useState } from "react";
import { useCircuitStore } from "../store/circuitStore";
import * as wasm from "../wasm/bridge";
import { SchemaViewerModal } from "./SchemaViewerModal";

interface AnchorRow {
  src: string;
  tgt: string;
}

export function HintEditor() {
  const sourceSchemaHandle = useCircuitStore((s) => s.sourceSchemaHandle);
  const targetSchemaHandle = useCircuitStore((s) => s.targetSchemaHandle);
  const importedSchemas = useCircuitStore((s) => s.importedSchemas);
  const existing = useCircuitStore((s) => s.autoLensHints);
  const regenerateWithHints = useCircuitStore((s) => s.regenerateWithHints);
  const closeHintEditor = useCircuitStore((s) => s.closeHintEditor);
  const lastQuality = useCircuitStore((s) => {
    const m = s.autoLensSchemaMapping;
    return m
      ? m.survivingVertices.length /
          Math.max(1, m.survivingVertices.length + m.removedVertices.length)
      : null;
  });
  const lastError = useCircuitStore((s) => s.autoLensError);

  const [anchors, setAnchors] = useState<AnchorRow[]>(() =>
    Object.entries(existing.anchors ?? {}).map(([src, tgt]) => ({ src, tgt })),
  );
  const [excludedSources, setExcludedSources] = useState(
    (existing.excluded_sources ?? []).join(", "),
  );
  const [excludedTargets, setExcludedTargets] = useState(
    (existing.excluded_targets ?? []).join(", "),
  );
  const [qualityThreshold, setQualityThreshold] = useState(
    existing.quality_threshold !== undefined ? String(existing.quality_threshold) : "",
  );
  /**
   * `picker`: which schema is currently open in the viewer-as-picker,
   * and which anchor row (index, side) the picked vertex should land in.
   */
  const [picker, setPicker] = useState<
    | null
    | { side: "source" | "target"; rowIdx: number }
  >(null);

  const sourceLabel = importedSchemas.find((s) => s.handle === sourceSchemaHandle)?.name;
  const targetLabel = importedSchemas.find((s) => s.handle === targetSchemaHandle)?.name;

  const updateAnchor = (idx: number, key: "src" | "tgt", value: string) => {
    setAnchors((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  };
  const removeAnchor = (idx: number) =>
    setAnchors((prev) => prev.filter((_, i) => i !== idx));
  const addAnchor = () => setAnchors((prev) => [...prev, { src: "", tgt: "" }]);

  const buildSpec = (): wasm.HintSpec => {
    const anchorMap: Record<string, string> = {};
    for (const { src, tgt } of anchors) {
      const s = src.trim();
      const t = tgt.trim();
      if (s && t) anchorMap[s] = t;
    }
    const splitList = (s: string) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    const spec: wasm.HintSpec = {};
    if (Object.keys(anchorMap).length > 0) spec.anchors = anchorMap;
    const exSrc = splitList(excludedSources);
    const exTgt = splitList(excludedTargets);
    if (exSrc.length > 0) spec.excluded_sources = exSrc;
    if (exTgt.length > 0) spec.excluded_targets = exTgt;
    const qt = qualityThreshold.trim();
    if (qt) {
      const n = Number(qt);
      if (Number.isFinite(n)) spec.quality_threshold = n;
    }
    return spec;
  };

  const onRegenerate = () => {
    const spec = buildSpec();
    regenerateWithHints(spec);
  };

  if (sourceSchemaHandle === null || targetSchemaHandle === null) {
    return (
      <ModalShell onClose={closeHintEditor}>
        <div style={{ padding: 24, color: "#aaa" }}>
          Assign both a source and a target schema before refining with
          hints.
        </div>
      </ModalShell>
    );
  }

  return (
    <>
      <ModalShell onClose={closeHintEditor}>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Refine with hints</div>
            <div style={{ fontSize: 10, color: "#888", marginLeft: "auto" }}>
              {sourceLabel ?? `handle ${sourceSchemaHandle}`} →{" "}
              {targetLabel ?? `handle ${targetSchemaHandle}`}
            </div>
          </div>
          {lastError && (
            <div style={{ fontSize: 11, color: "#F44336" }}>
              Last attempt failed: {lastError}
            </div>
          )}
          {lastQuality !== null && !lastError && (
            <div style={{ fontSize: 10, color: "#888" }}>
              Last alignment quality (survival ratio):{" "}
              {(lastQuality * 100).toFixed(0)}%
            </div>
          )}

          <div>
            <SectionLabel>Anchors</SectionLabel>
            <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>
              Declare source ↔ target vertex correspondences. Forward
              chaining propagates these along unique edge-name matches.
            </div>
            {anchors.length === 0 && (
              <div style={{ fontSize: 11, color: "#666" }}>
                No anchors yet. Click + add anchor to start.
              </div>
            )}
            {anchors.map((a, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}
                data-testid="hint-anchor-row"
              >
                <input
                  type="text"
                  value={a.src}
                  onChange={(e) => updateAnchor(i, "src", e.target.value)}
                  placeholder="source vertex id"
                  spellCheck={false}
                  style={vertexInputStyle}
                />
                <button
                  onClick={() => setPicker({ side: "source", rowIdx: i })}
                  title="Pick source vertex from schema"
                  style={pickButtonStyle}
                >
                  Pick…
                </button>
                <span style={{ color: "#666" }}>→</span>
                <input
                  type="text"
                  value={a.tgt}
                  onChange={(e) => updateAnchor(i, "tgt", e.target.value)}
                  placeholder="target vertex id"
                  spellCheck={false}
                  style={vertexInputStyle}
                />
                <button
                  onClick={() => setPicker({ side: "target", rowIdx: i })}
                  title="Pick target vertex from schema"
                  style={pickButtonStyle}
                >
                  Pick…
                </button>
                <button
                  onClick={() => removeAnchor(i)}
                  title="Remove this anchor"
                  style={{
                    ...pickButtonStyle,
                    color: "#F44336",
                    borderColor: "oklch(0.32 0.05 25)",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addAnchor}
              data-testid="hint-add-anchor"
              style={{
                marginTop: 4,
                padding: "3px 10px",
                background: "oklch(0.22 0.01 250)",
                border: "1px solid oklch(0.35 0.01 250)",
                borderRadius: 3,
                color: "#ccc",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              + add anchor
            </button>
          </div>

          <div>
            <SectionLabel>Excluded sources (comma separated)</SectionLabel>
            <input
              type="text"
              value={excludedSources}
              onChange={(e) => setExcludedSources(e.target.value)}
              placeholder="vertex_id, vertex_id"
              spellCheck={false}
              style={fullWidthInputStyle}
            />
          </div>
          <div>
            <SectionLabel>Excluded targets (comma separated)</SectionLabel>
            <input
              type="text"
              value={excludedTargets}
              onChange={(e) => setExcludedTargets(e.target.value)}
              placeholder="vertex_id, vertex_id"
              spellCheck={false}
              style={fullWidthInputStyle}
            />
          </div>
          <div>
            <SectionLabel>Quality threshold (0.0–1.0)</SectionLabel>
            <input
              type="text"
              value={qualityThreshold}
              onChange={(e) => setQualityThreshold(e.target.value)}
              placeholder="0.5"
              spellCheck={false}
              style={fullWidthInputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={closeHintEditor}
              style={{
                padding: "6px 14px",
                background: "oklch(0.22 0.01 250)",
                border: "1px solid oklch(0.35 0.01 250)",
                borderRadius: 4,
                color: "#ccc",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Cancel
            </button>
            <button
              onClick={onRegenerate}
              data-testid="hint-regenerate"
              style={{
                padding: "6px 14px",
                background: "#9C27B0",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Re-generate lens
            </button>
          </div>
        </div>
      </ModalShell>
      {picker !== null && (
        <SchemaViewerModal
          schemaHandle={
            picker.side === "source"
              ? sourceSchemaHandle
              : targetSchemaHandle
          }
          label={picker.side === "source" ? "Source schema" : "Target schema"}
          onClose={() => setPicker(null)}
          onPickVertex={(vertexId) => {
            updateAnchor(
              picker.rowIdx,
              picker.side === "source" ? "src" : "tgt",
              vertexId,
            );
            setPicker(null);
          }}
        />
      )}
    </>
  );
}

const vertexInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "4px 6px",
  background: "oklch(0.1 0.01 250)",
  border: "1px solid oklch(0.3 0.01 250)",
  borderRadius: 3,
  color: "#ddd",
  fontFamily: "ui-monospace, SF Mono, monospace",
  fontSize: 11,
  outline: "none",
};

const fullWidthInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  background: "oklch(0.1 0.01 250)",
  border: "1px solid oklch(0.3 0.01 250)",
  borderRadius: 3,
  color: "#ddd",
  fontFamily: "ui-monospace, SF Mono, monospace",
  fontSize: 11,
  outline: "none",
};

const pickButtonStyle: React.CSSProperties = {
  padding: "3px 8px",
  background: "oklch(0.22 0.01 250)",
  border: "1px solid oklch(0.35 0.01 250)",
  borderRadius: 3,
  color: "#ccc",
  cursor: "pointer",
  fontSize: 10,
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: "#999",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
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
        zIndex: 1900,
      }}
    >
      <div
        data-testid="hint-editor-modal"
        style={{
          background: "oklch(0.14 0.01 250)",
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 8,
          width: 640,
          maxHeight: "85vh",
          overflowY: "auto",
          color: "#ddd",
          fontSize: 12,
        }}
      >
        {children}
      </div>
    </div>
  );
}
