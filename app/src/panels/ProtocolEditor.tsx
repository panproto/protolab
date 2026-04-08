/**
 * ProtocolEditor: build a `panproto_schema::Protocol` via UI forms and
 * register it in the user-protocol registry.
 *
 * Outputs JSON in the exact shape panproto-schema's `Protocol` struct
 * expects, then calls `importProtocol` on the circuit store to register
 * it. Also lists existing user protocols (from `importedProtocols`)
 * with remove / export actions.
 */

import { useEffect, useState } from "react";
import { useCircuitStore } from "../store/circuitStore";

interface EdgeRuleRow {
  edge_kind: string;
  src_kinds: string;
  tgt_kinds: string;
}

// All structural + enrichment capability flags on `panproto_schema::Protocol`.
const FLAGS = [
  { key: "has_order", label: "Ordered collections (ThOrder)" },
  { key: "has_coproducts", label: "Coproduct / union types (ThCoproduct)" },
  { key: "has_recursion", label: "Recursive types (ThRecursion)" },
  { key: "has_causal", label: "Causal / temporal ordering (ThCausal)" },
  { key: "nominal_identity", label: "Nominal identity (ThNominal)" },
  { key: "has_defaults", label: "Default value expressions (ThValued)" },
  { key: "has_coercions", label: "Type coercion expressions (ThCoercible)" },
  { key: "has_mergers", label: "Merge / split expressions (ThMergeable)" },
  { key: "has_policies", label: "Conflict resolution policies (ThPolicied)" },
] as const;

type FlagKey = (typeof FLAGS)[number]["key"];

export function ProtocolEditor({ onClose }: { onClose: () => void }) {
  const {
    importProtocol,
    removeProtocol,
    refreshProtocols,
    getProtocolJson,
    importedProtocols,
    error,
  } = useCircuitStore();

  const [name, setName] = useState("");
  const [schemaTheory, setSchemaTheory] = useState("ThWType");
  const [instanceTheory, setInstanceTheory] = useState("ThWType");
  const [objKinds, setObjKinds] = useState<string[]>(["object"]);
  const [constraintSorts, setConstraintSorts] = useState<string[]>([]);
  const [edgeRules, setEdgeRules] = useState<EdgeRuleRow[]>([
    { edge_kind: "prop", src_kinds: "object", tgt_kinds: "" },
  ]);
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>(() =>
    Object.fromEntries(FLAGS.map((f) => [f.key, false])) as Record<FlagKey, boolean>,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // On mount, ensure the store's list of user protocols is fresh (e.g.,
  // entries registered by previous sessions survive the WASM boundary
  // but aren't always in the React store).
  useEffect(() => {
    refreshProtocols();
  }, [refreshProtocols]);

  const addObjKind = () => setObjKinds([...objKinds, ""]);
  const updateObjKind = (i: number, value: string) => {
    const next = [...objKinds];
    next[i] = value;
    setObjKinds(next);
  };
  const removeObjKind = (i: number) => setObjKinds(objKinds.filter((_, j) => j !== i));

  const addConstraintSort = () => setConstraintSorts([...constraintSorts, ""]);
  const updateConstraintSort = (i: number, value: string) => {
    const next = [...constraintSorts];
    next[i] = value;
    setConstraintSorts(next);
  };
  const removeConstraintSort = (i: number) =>
    setConstraintSorts(constraintSorts.filter((_, j) => j !== i));

  const addEdgeRule = () =>
    setEdgeRules([...edgeRules, { edge_kind: "", src_kinds: "", tgt_kinds: "" }]);
  const updateEdgeRule = (i: number, key: keyof EdgeRuleRow, value: string) => {
    const next = [...edgeRules];
    next[i] = { ...next[i], [key]: value };
    setEdgeRules(next);
  };
  const removeEdgeRule = (i: number) => setEdgeRules(edgeRules.filter((_, j) => j !== i));

  const buildJson = (): string => {
    const body = {
      name: name.trim(),
      schema_theory: schemaTheory.trim() || "ThWType",
      instance_theory: instanceTheory.trim() || "ThWType",
      edge_rules: edgeRules
        .filter((r) => r.edge_kind.trim())
        .map((r) => ({
          edge_kind: r.edge_kind.trim(),
          src_kinds: r.src_kinds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          tgt_kinds: r.tgt_kinds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        })),
      obj_kinds: objKinds.map((k) => k.trim()).filter(Boolean),
      constraint_sorts: constraintSorts.map((k) => k.trim()).filter(Boolean),
      ...flags,
    };
    return JSON.stringify(body, null, 2);
  };

  const compile = () => {
    setLocalError(null);
    if (!name.trim()) {
      setLocalError("Protocol name is required.");
      return;
    }
    const json = buildJson();
    importProtocol(json);
    setLastSaved(name.trim());
    // Clear the form so a second protocol can be built without manual reset.
    setName("");
  };

  // Load an existing protocol's JSON back into the form so it can be
  // edited and re-saved.
  const loadIntoForm = (protoName: string) => {
    const json = getProtocolJson(protoName);
    if (!json) return;
    try {
      const body = JSON.parse(json);
      setName(body.name ?? "");
      setSchemaTheory(body.schema_theory ?? "ThWType");
      setInstanceTheory(body.instance_theory ?? "ThWType");
      setObjKinds(body.obj_kinds ?? []);
      setConstraintSorts(body.constraint_sorts ?? []);
      setEdgeRules(
        (body.edge_rules ?? []).map((r: { edge_kind: string; src_kinds: string[]; tgt_kinds: string[] }) => ({
          edge_kind: r.edge_kind,
          src_kinds: r.src_kinds.join(","),
          tgt_kinds: r.tgt_kinds.join(","),
        })),
      );
      setFlags(
        Object.fromEntries(FLAGS.map((f) => [f.key, !!body[f.key]])) as Record<FlagKey, boolean>,
      );
      setLastSaved(null);
    } catch (err) {
      setLocalError(`Failed to parse protocol: ${String(err)}`);
    }
  };

  const exportJson = (protoName: string) => {
    const json = getProtocolJson(protoName);
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${protoName}.protocol.json`;
    a.click();
    URL.revokeObjectURL(url);
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
          width: 620,
          maxHeight: "85vh",
          overflow: "auto",
          color: "#ccc",
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
          Build Protocol (panproto-schema::Protocol)
        </div>
        <div style={{ fontSize: 10, color: "#777", marginBottom: 12 }}>
          Register a new data-format protocol. Registered protocols take
          precedence over protolab's built-in protocol table.
        </div>

        {/* Registered protocols list */}
        {importedProtocols.length > 0 && (
          <>
            <div style={sectionHeader}>Registered ({importedProtocols.length})</div>
            {importedProtocols.map((p) => (
              <div
                key={p.name}
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  marginBottom: 4,
                  padding: "4px 6px",
                  background: "oklch(0.14 0.01 250)",
                  borderRadius: 3,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 11 }}>{p.name}</div>
                  <div style={{ fontSize: 9, color: "#666" }}>
                    {p.schemaTheory} / {p.instanceTheory} · {p.objKindCount} kinds ·{" "}
                    {p.edgeRuleCount} edge rules
                  </div>
                </div>
                <button style={buttonStyle} onClick={() => loadIntoForm(p.name)}>
                  Edit
                </button>
                <button style={buttonStyle} onClick={() => exportJson(p.name)}>
                  Export
                </button>
                <button
                  style={{ ...buttonStyle, borderColor: "#F44336", color: "#F44336" }}
                  onClick={() => removeProtocol(p.name)}
                >
                  ×
                </button>
              </div>
            ))}
          </>
        )}

        {/* Form fields */}
        <div style={sectionHeader}>Identity</div>
        <label style={{ fontSize: 10, color: "#999" }}>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. my-corp-api-v2"
          style={{ ...inputStyle, width: "100%", marginTop: 2 }}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: "#999" }}>Schema theory</label>
            <input
              type="text"
              value={schemaTheory}
              onChange={(e) => setSchemaTheory(e.target.value)}
              style={{ ...inputStyle, width: "100%", marginTop: 2 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: "#999" }}>Instance theory</label>
            <input
              type="text"
              value={instanceTheory}
              onChange={(e) => setInstanceTheory(e.target.value)}
              style={{ ...inputStyle, width: "100%", marginTop: 2 }}
            />
          </div>
        </div>

        {/* Object kinds */}
        <div style={sectionHeader}>Object kinds ({objKinds.length})</div>
        <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>
          Vertex kinds that behave as containers (rows, records, documents).
        </div>
        {objKinds.map((k, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <input
              type="text"
              value={k}
              onChange={(e) => updateObjKind(i, e.target.value)}
              placeholder="e.g. object, record, table"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button style={buttonStyle} onClick={() => removeObjKind(i)}>
              ×
            </button>
          </div>
        ))}
        <button style={buttonStyle} onClick={addObjKind}>
          + Add obj kind
        </button>

        {/* Constraint sorts */}
        <div style={sectionHeader}>Constraint sorts ({constraintSorts.length})</div>
        <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>
          Recognized constraint kinds on vertices (e.g. required, maxLength).
        </div>
        {constraintSorts.map((k, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <input
              type="text"
              value={k}
              onChange={(e) => updateConstraintSort(i, e.target.value)}
              placeholder="e.g. required, maxLength, format"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button style={buttonStyle} onClick={() => removeConstraintSort(i)}>
              ×
            </button>
          </div>
        ))}
        <button style={buttonStyle} onClick={addConstraintSort}>
          + Add constraint sort
        </button>

        {/* Edge rules */}
        <div style={sectionHeader}>Edge rules ({edgeRules.length})</div>
        <div style={{ fontSize: 10, color: "#777", marginBottom: 4 }}>
          Well-formedness rules: for each edge kind, which source and target
          vertex kinds are permitted. Comma-separated, empty = any.
        </div>
        {edgeRules.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <input
              type="text"
              value={r.edge_kind}
              onChange={(e) => updateEdgeRule(i, "edge_kind", e.target.value)}
              placeholder="edge kind"
              style={{ ...inputStyle, width: 110 }}
            />
            <input
              type="text"
              value={r.src_kinds}
              onChange={(e) => updateEdgeRule(i, "src_kinds", e.target.value)}
              placeholder="src kinds (csv)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <input
              type="text"
              value={r.tgt_kinds}
              onChange={(e) => updateEdgeRule(i, "tgt_kinds", e.target.value)}
              placeholder="tgt kinds (csv)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button style={buttonStyle} onClick={() => removeEdgeRule(i)}>
              ×
            </button>
          </div>
        ))}
        <button style={buttonStyle} onClick={addEdgeRule}>
          + Add edge rule
        </button>

        {/* Capability flags */}
        <div style={sectionHeader}>Capability flags</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {FLAGS.map((f) => (
            <label
              key={f.key}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#ccc" }}
            >
              <input
                type="checkbox"
                checked={flags[f.key]}
                onChange={(e) =>
                  setFlags((prev) => ({ ...prev, [f.key]: e.target.checked }))
                }
              />
              {f.label}
            </label>
          ))}
        </div>

        {/* Status / actions */}
        {(localError || error) && (
          <div style={{ color: "#F44336", fontSize: 11, marginTop: 12 }}>
            {localError ?? error}
          </div>
        )}
        {lastSaved && (
          <div style={{ color: "#98c379", fontSize: 11, marginTop: 12 }}>
            Registered <code>{lastSaved}</code> ✓
          </div>
        )}

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
          <button style={buttonStyle} onClick={onClose}>
            Close
          </button>
          <button
            style={{
              ...buttonStyle,
              background: "#2196F3",
              borderColor: "#2196F3",
              color: "#fff",
            }}
            onClick={compile}
          >
            Register Protocol
          </button>
        </div>
      </div>
    </div>
  );
}
