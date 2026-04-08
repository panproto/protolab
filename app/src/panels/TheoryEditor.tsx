/**
 * Theory editor: build a panproto-theory-dsl TheoryDocument via UI forms.
 *
 * Outputs a JSON document in the format panproto-theory-dsl::eval::eval_json
 * expects, then calls compileTheoryBundle to compile it.
 */

import { useState } from "react";
import { useCircuitStore } from "../store/circuitStore";
import { ExpressionEditor } from "../components/ExpressionEditor";

interface SortRow {
  name: string;
  kind: string;
}

interface OpRow {
  name: string;
  input: string;
  output: string;
}

interface EqRow {
  name: string;
  lhs: string;
  rhs: string;
}

interface DirectedEqRow {
  name: string;
  lhs: string;
  rhs: string;
  impl_expr: string;
  inverse: string;
  coercion_class: string;
}

export function TheoryEditor({ onClose }: { onClose: () => void }) {
  const { buildTheoryFromJson } = useCircuitStore();

  const [theoryName, setTheoryName] = useState("MyTheory");
  const [sorts, setSorts] = useState<SortRow[]>([{ name: "X", kind: "structural" }]);
  const [ops, setOps] = useState<OpRow[]>([]);
  const [eqs, setEqs] = useState<EqRow[]>([]);
  const [dirEqs, setDirEqs] = useState<DirectedEqRow[]>([]);

  const addSort = () => setSorts([...sorts, { name: "", kind: "structural" }]);
  const addOp = () => setOps([...ops, { name: "", input: "", output: "" }]);
  const addEq = () => setEqs([...eqs, { name: "", lhs: "", rhs: "" }]);
  const addDirEq = () =>
    setDirEqs([
      ...dirEqs,
      { name: "", lhs: "", rhs: "", impl_expr: "", inverse: "", coercion_class: "iso" },
    ]);
  const updateDirEq = (i: number, key: keyof DirectedEqRow, value: string) => {
    const next = [...dirEqs];
    next[i] = { ...next[i], [key]: value };
    setDirEqs(next);
  };

  const updateSort = (i: number, key: keyof SortRow, value: string) => {
    const next = [...sorts];
    next[i] = { ...next[i], [key]: value };
    setSorts(next);
  };
  const updateOp = (i: number, key: keyof OpRow, value: string) => {
    const next = [...ops];
    next[i] = { ...next[i], [key]: value };
    setOps(next);
  };
  const updateEq = (i: number, key: keyof EqRow, value: string) => {
    const next = [...eqs];
    next[i] = { ...next[i], [key]: value };
    setEqs(next);
  };

  // Derived: list of valid sort names (filtered to non-empty).
  const sortNames = sorts.map((s) => s.name).filter((n) => n.trim());
  // Derived: list of valid op names.
  const opNames = ops.map((o) => o.name).filter((n) => n.trim());

  /**
   * Insert an operation call into a term string. If the term is empty,
   * produces "op(x)". If non-empty, wraps the existing term: "op(<existing>)".
   * Useful for building nested terms via clicks.
   */
  const insertOpTerm = (existing: string, opName: string): string => {
    if (!existing.trim()) return `${opName}(x)`;
    return `${opName}(${existing.trim()})`;
  };

  const compile = () => {
    const doc = {
      id: `dev.protolab.theories.${theoryName}`,
      description: `User-defined theory: ${theoryName}`,
      theory: theoryName,
      sorts: sorts.filter((s) => s.name).map((s) => ({
        name: s.name,
        kind: { type: s.kind },
      })),
      ops: ops.filter((o) => o.name && o.output).map((o) => ({
        name: o.name,
        input: o.input || undefined,
        output: o.output,
      })),
      equations: eqs.filter((e) => e.name && e.lhs && e.rhs).map((e) => ({
        name: e.name,
        lhs: e.lhs,
        rhs: e.rhs,
      })),
      directed_equations: dirEqs
        .filter((d) => d.name && d.lhs && d.rhs && d.impl_expr)
        .map((d) => ({
          name: d.name,
          lhs: d.lhs,
          rhs: d.rhs,
          impl_expr: d.impl_expr,
          inverse: d.inverse || undefined,
          coercion_class: d.coercion_class,
        })),
    };

    buildTheoryFromJson(JSON.stringify(doc));
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    background: "oklch(0.18 0.01 250)",
    border: "1px solid oklch(0.3 0.01 250)",
    color: "#ddd",
    padding: "3px 6px",
    borderRadius: 3,
    fontSize: 11,
    fontFamily: "monospace",
  };

  const sectionHeader: React.CSSProperties = {
    fontSize: 10,
    textTransform: "uppercase",
    color: "#777",
    letterSpacing: "0.05em",
    marginBottom: 6,
    marginTop: 12,
  };

  const buttonStyle: React.CSSProperties = {
    padding: "3px 8px",
    background: "oklch(0.22 0.01 250)",
    border: "1px solid oklch(0.35 0.01 250)",
    borderRadius: 3,
    color: "#ccc",
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
          maxHeight: "85vh",
          overflow: "auto",
          color: "#ccc",
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
          Build Theory (panproto-theory-dsl)
        </div>

        <label style={{ fontSize: 10, color: "#777" }}>Theory Name</label>
        <input
          type="text"
          value={theoryName}
          onChange={(e) => setTheoryName(e.target.value)}
          style={{ ...inputStyle, width: "100%", marginTop: 4 }}
        />

        {/* Sorts */}
        <div style={sectionHeader}>Sorts ({sorts.length})</div>
        {sorts.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <input
              type="text"
              placeholder="name"
              value={s.name}
              onChange={(e) => updateSort(i, "name", e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={s.kind}
              onChange={(e) => updateSort(i, "kind", e.target.value)}
              style={{ ...inputStyle, width: 110 }}
            >
              <option value="structural">structural</option>
              <option value="val">val</option>
            </select>
            <button style={buttonStyle} onClick={() => setSorts(sorts.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button style={buttonStyle} onClick={addSort}>+ Add sort</button>

        {/* Ops */}
        <div style={sectionHeader}>Operations ({ops.length})</div>
        {ops.length > 0 && sortNames.length === 0 && (
          <div style={{ fontSize: 10, color: "#F44336", marginBottom: 4 }}>
            Add at least one sort before defining operations.
          </div>
        )}
        {ops.map((o, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <input
              type="text"
              placeholder="name"
              value={o.name}
              onChange={(e) => updateOp(i, "name", e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={o.input}
              onChange={(e) => updateOp(i, "input", e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
              disabled={sortNames.length === 0}
            >
              <option value="">— input sort —</option>
              {sortNames.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={o.output}
              onChange={(e) => updateOp(i, "output", e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
              disabled={sortNames.length === 0}
            >
              <option value="">— output sort —</option>
              {sortNames.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button style={buttonStyle} onClick={() => setOps(ops.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button
          style={{ ...buttonStyle, opacity: sortNames.length === 0 ? 0.5 : 1 }}
          onClick={addOp}
          disabled={sortNames.length === 0}
        >
          + Add operation
        </button>

        {/* Equations */}
        <div style={sectionHeader}>Equations ({eqs.length})</div>
        {eqs.length > 0 && opNames.length === 0 && (
          <div style={{ fontSize: 10, color: "#F44336", marginBottom: 4 }}>
            Add at least one operation before defining equations.
          </div>
        )}
        {eqs.map((e, i) => (
          <div
            key={i}
            style={{
              marginBottom: 6,
              padding: 6,
              background: "oklch(0.14 0.01 250)",
              borderRadius: 3,
            }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <input
                type="text"
                placeholder="equation name"
                value={e.name}
                onChange={(ev) => updateEq(i, "name", ev.target.value)}
                style={{ ...inputStyle, flex: 2 }}
              />
              <button style={buttonStyle} onClick={() => setEqs(eqs.filter((_, j) => j !== i))}>×</button>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#777", width: 24 }}>lhs</span>
              <select
                value=""
                onChange={(ev) => {
                  if (ev.target.value) {
                    updateEq(i, "lhs", insertOpTerm(e.lhs, ev.target.value));
                  }
                }}
                style={{ ...inputStyle, width: 110 }}
                disabled={opNames.length === 0}
              >
                <option value="">+ wrap with op</option>
                {opNames.map((n) => (
                  <option key={n} value={n}>{n}(…)</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="term, e.g. f(x)"
                value={e.lhs}
                onChange={(ev) => updateEq(i, "lhs", ev.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#777", width: 24 }}>rhs</span>
              <select
                value=""
                onChange={(ev) => {
                  if (ev.target.value) {
                    updateEq(i, "rhs", insertOpTerm(e.rhs, ev.target.value));
                  }
                }}
                style={{ ...inputStyle, width: 110 }}
                disabled={opNames.length === 0}
              >
                <option value="">+ wrap with op</option>
                {opNames.map((n) => (
                  <option key={n} value={n}>{n}(…)</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="term, e.g. g(x)"
                value={e.rhs}
                onChange={(ev) => updateEq(i, "rhs", ev.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
          </div>
        ))}
        <button
          style={{ ...buttonStyle, opacity: opNames.length === 0 ? 0.5 : 1 }}
          onClick={addEq}
          disabled={opNames.length === 0}
        >
          + Add equation
        </button>

        {/* Directed Equations */}
        <div style={sectionHeader}>Directed Equations ({dirEqs.length})</div>
        <div style={{ fontSize: 10, color: "#777", marginBottom: 6 }}>
          Directed equations have an executable <code>impl_expr</code> written in
          panproto-expr. They form the computational content of a theory.
        </div>
        {dirEqs.length > 0 && opNames.length === 0 && (
          <div style={{ fontSize: 10, color: "#F44336", marginBottom: 4 }}>
            Add at least one operation before defining directed equations.
          </div>
        )}
        {dirEqs.map((d, i) => (
          <div
            key={i}
            style={{
              marginBottom: 8,
              padding: 8,
              background: "oklch(0.14 0.01 250)",
              borderRadius: 3,
            }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input
                type="text"
                placeholder="directed equation name"
                value={d.name}
                onChange={(ev) => updateDirEq(i, "name", ev.target.value)}
                style={{ ...inputStyle, flex: 2 }}
              />
              <select
                value={d.coercion_class}
                onChange={(ev) => updateDirEq(i, "coercion_class", ev.target.value)}
                style={{ ...inputStyle, width: 110 }}
              >
                <option value="iso">iso</option>
                <option value="retraction">retraction</option>
                <option value="projection">projection</option>
                <option value="opaque">opaque</option>
              </select>
              <button
                style={buttonStyle}
                onClick={() => setDirEqs(dirEqs.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#777", width: 24 }}>lhs</span>
              <input
                type="text"
                placeholder="term, e.g. f(x)"
                value={d.lhs}
                onChange={(ev) => updateDirEq(i, "lhs", ev.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#777", width: 24 }}>rhs</span>
              <input
                type="text"
                placeholder="term, e.g. g(x)"
                value={d.rhs}
                onChange={(ev) => updateDirEq(i, "rhs", ev.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
            <div style={{ fontSize: 10, color: "#777", marginBottom: 2 }}>
              impl_expr (panproto-expr)
            </div>
            <ExpressionEditor
              value={d.impl_expr}
              onChange={(v) => updateDirEq(i, "impl_expr", v)}
              height={80}
              placeholder="e.g. upper(x)"
            />
            <div style={{ fontSize: 10, color: "#777", marginTop: 6, marginBottom: 2 }}>
              inverse (optional, panproto-expr)
            </div>
            <ExpressionEditor
              value={d.inverse}
              onChange={(v) => updateDirEq(i, "inverse", v)}
              height={80}
              placeholder="e.g. lower(x)"
            />
          </div>
        ))}
        <button
          style={{ ...buttonStyle, opacity: opNames.length === 0 ? 0.5 : 1 }}
          onClick={addDirEq}
          disabled={opNames.length === 0}
        >
          + Add directed equation
        </button>

        {/* Actions */}
        <div
          style={{
            marginTop: 16,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            borderTop: "1px solid oklch(0.25 0.01 250)",
            paddingTop: 12,
          }}
        >
          <button style={buttonStyle} onClick={onClose}>Cancel</button>
          <button
            style={{ ...buttonStyle, background: "#2196F3", borderColor: "#2196F3", color: "#fff" }}
            onClick={compile}
          >
            Compile Theory
          </button>
        </div>
      </div>
    </div>
  );
}
