/**
 * Colimit composer: pick two theories from the imported list and compose
 * them via panproto-gat::colimit_by_name over shared sorts.
 */

import { useState, useEffect, useMemo } from "react";
import { useCircuitStore } from "../store/circuitStore";
import * as wasm from "../wasm/bridge";

export function ColimitComposer({ onClose }: { onClose: () => void }) {
  const { importedTheories, composeTheories } = useCircuitStore();
  const [t1Handle, setT1Handle] = useState<number | null>(null);
  const [t2Handle, setT2Handle] = useState<number | null>(null);
  const [t1Sorts, setT1Sorts] = useState<string[]>([]);
  const [t2Sorts, setT2Sorts] = useState<string[]>([]);
  const [selectedSharedSorts, setSelectedSharedSorts] = useState<Set<string>>(new Set());

  // Default to first two theories if available.
  useEffect(() => {
    if (t1Handle === null && importedTheories.length > 0) {
      setT1Handle(importedTheories[0].handle);
    }
    if (t2Handle === null && importedTheories.length > 1) {
      setT2Handle(importedTheories[1].handle);
    }
  }, [importedTheories, t1Handle, t2Handle]);

  // Fetch sort lists for selected theories.
  useEffect(() => {
    if (t1Handle !== null) {
      try {
        setT1Sorts(wasm.getTheoryDetails(t1Handle).sorts);
      } catch {
        setT1Sorts([]);
      }
    }
  }, [t1Handle]);

  useEffect(() => {
    if (t2Handle !== null) {
      try {
        setT2Sorts(wasm.getTheoryDetails(t2Handle).sorts);
      } catch {
        setT2Sorts([]);
      }
    }
  }, [t2Handle]);

  // Sorts present in both theories — these are the candidates for sharing.
  const intersection = useMemo(() => {
    const set1 = new Set(t1Sorts);
    return t2Sorts.filter((s) => set1.has(s));
  }, [t1Sorts, t2Sorts]);

  const toggleSharedSort = (sort: string) => {
    const next = new Set(selectedSharedSorts);
    if (next.has(sort)) next.delete(sort);
    else next.add(sort);
    setSelectedSharedSorts(next);
  };

  const compose = () => {
    if (t1Handle === null || t2Handle === null) return;
    composeTheories(t1Handle, t2Handle, Array.from(selectedSharedSorts));
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    background: "oklch(0.18 0.01 250)",
    border: "1px solid oklch(0.3 0.01 250)",
    color: "#ddd",
    padding: "5px 8px",
    borderRadius: 3,
    fontSize: 11,
    fontFamily: "monospace",
    width: "100%",
    marginTop: 4,
  };

  const buttonStyle: React.CSSProperties = {
    padding: "4px 10px",
    background: "oklch(0.22 0.01 250)",
    border: "1px solid oklch(0.35 0.01 250)",
    borderRadius: 3,
    color: "#ccc",
    cursor: "pointer",
    fontSize: 11,
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
          width: 540,
          maxHeight: "85vh",
          overflow: "auto",
          color: "#ccc",
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          Colimit (Pushout) Composition
        </div>
        <div style={{ fontSize: 11, color: "#999", marginBottom: 12 }}>
          Compose two theories by identifying shared sorts. The result is a new
          theory containing all sorts and operations from both, with the shared
          sorts identified (a categorical pushout via{" "}
          <code style={{ color: "#bbb" }}>panproto-gat::colimit_by_name</code>).
        </div>

        {importedTheories.length < 2 ? (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              color: "#777",
              fontStyle: "italic",
              border: "1px dashed oklch(0.3 0.01 250)",
              borderRadius: 4,
            }}
          >
            Need at least 2 imported theories to compose. Use Toolbar →
            Theories to build one, or import via the Import dropdown.
          </div>
        ) : (
          <>
            <label style={{ fontSize: 10, color: "#777" }}>First theory</label>
            <select
              value={t1Handle ?? ""}
              onChange={(e) => setT1Handle(parseInt(e.target.value, 10))}
              style={inputStyle}
            >
              {importedTheories.map((t) => (
                <option key={t.handle} value={t.handle}>
                  {t.name} ({t.sortCount}S {t.opCount}O)
                </option>
              ))}
            </select>

            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 10, color: "#777" }}>Second theory</label>
              <select
                value={t2Handle ?? ""}
                onChange={(e) => setT2Handle(parseInt(e.target.value, 10))}
                style={inputStyle}
              >
                {importedTheories.map((t) => (
                  <option key={t.handle} value={t.handle}>
                    {t.name} ({t.sortCount}S {t.opCount}O)
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 10, color: "#777" }}>
                Shared sorts (intersection auto-detected)
              </label>
              {intersection.length === 0 ? (
                <div
                  style={{
                    padding: 8,
                    color: "#777",
                    fontSize: 11,
                    fontStyle: "italic",
                    marginTop: 4,
                  }}
                >
                  No sorts with matching names exist in both theories. The
                  result will be a coproduct (disjoint union).
                </div>
              ) : (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {intersection.map((sort) => {
                    const selected = selectedSharedSorts.has(sort);
                    return (
                      <button
                        key={sort}
                        onClick={() => toggleSharedSort(sort)}
                        style={{
                          padding: "3px 8px",
                          background: selected ? "#2196F3" : "oklch(0.22 0.01 250)",
                          color: selected ? "#fff" : "#ccc",
                          border: `1px solid ${selected ? "#2196F3" : "oklch(0.35 0.01 250)"}`,
                          borderRadius: 3,
                          fontSize: 11,
                          cursor: "pointer",
                          fontFamily: "monospace",
                        }}
                      >
                        {sort}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={buttonStyle} onClick={onClose}>Cancel</button>
          <button
            style={{
              ...buttonStyle,
              background: "#2196F3",
              borderColor: "#2196F3",
              color: "#fff",
              opacity: importedTheories.length < 2 ? 0.5 : 1,
              cursor: importedTheories.length < 2 ? "not-allowed" : "pointer",
            }}
            onClick={compose}
            disabled={importedTheories.length < 2 || t1Handle === null || t2Handle === null}
          >
            Compose
          </button>
        </div>
      </div>
    </div>
  );
}
