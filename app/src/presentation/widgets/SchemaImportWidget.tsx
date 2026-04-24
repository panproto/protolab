import { useEffect, useRef, useState } from "react";
import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore } from "../../store/circuitStore";
import * as wasm from "../../wasm/bridge";
import type { ProtocolMeta } from "../../wasm/bridge";
import { getProp } from "./widgetHelpers";
import { exampleRecordForNsid } from "../lexiconExamples";
import { fetchLexiconAutocomplete, type LexiconSuggestion } from "../lexiconGarden";
import type { PairStatus } from "../../lib/autoLensSnapshot";

// Small colored dot + label shown next to each NSID suggestion in
// the autocomplete dropdown, communicating whether a precomputed
// auto-lens exists for the pair (the suggestion ↔ the other side's
// assigned schema). The snapshot is sparse by design: only
// known-working pairs are stored, and anything not in the snapshot
// reports as "unknown" — which is the right default for any
// schema added to lexicon.garden after the last snapshot build, or
// any custom user-imported schema.
function AutoLensBadge({
  status,
  hasOther,
}: {
  status: PairStatus;
  hasOther: boolean;
}) {
  if (!hasOther) return null;
  const spec: Record<PairStatus, { dot: string; label: string; title: string }> = {
    works: {
      dot: "#4CAF50",
      label: "auto",
      title: "Auto-lens known to work for this pair.",
    },
    "no-lens": {
      dot: "#F44336",
      label: "no auto",
      title:
        "Precomputed: no non-degenerate auto-lens between these schemas. You'll have to build the circuit by hand or pin hints.",
    },
    unknown: {
      dot: "#666",
      label: "unknown",
      title:
        "Not in the precomputed snapshot yet (added to the garden recently, or a custom import). The app will still try to auto-generate on demand.",
    },
  };
  const s = spec[status];
  return (
    <span
      title={s.title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 9,
        color: "#9aa0ab",
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.dot,
          flexShrink: 0,
        }}
      />
      {s.label}
    </span>
  );
}

/**
 * Unified multi-protocol schema import widget. Replaces the old
 * atproto-only LexiconImportWidget with a protocol selector that
 * drives protocol-specific input UI:
 *
 *   atproto  → NSID input + lexicon.garden autocomplete + Resolve
 *   openapi  → paste OpenAPI JSON + Parse
 *   mongodb  → paste $jsonSchema + Parse
 *   cddl     → paste CDDL text + Parse
 *   (etc. for all ~50 panproto-supported protocols)
 *
 * The widget reads `role` ("source" or "target") from props to decide
 * which schema handle to assign in the store.
 */
export function SchemaImportWidget({ widget }: WidgetProps) {
  return (
    <SchemaImportForm
      label={getProp(widget, "label", "Schema")}
      role={(getProp(widget, "role", "source") as "source" | "target")}
      defaultProtocol={getProp(widget, "default_protocol", "atproto")}
      defaultNsid={getProp(widget, "default_nsid", "")}
    />
  );
}

export interface SchemaImportFormProps {
  label: string;
  role: "source" | "target";
  defaultProtocol?: string;
  defaultNsid?: string;
  /** When true, render a tighter layout suitable for the edit-mode Inspector. */
  compact?: boolean;
}

const miniBtnStyle: React.CSSProperties = {
  padding: "3px 8px",
  background: "oklch(0.22 0.01 250)",
  color: "#ccc",
  border: "1px solid oklch(0.35 0.01 250)",
  borderRadius: 3,
  fontSize: 10,
  cursor: "pointer",
};

/**
 * Standalone schema-import form — usable both as a presentation widget
 * body and inline in the edit-mode Inspector. Rehydrates from the
 * store's `sourceSchemaHandle`/`targetSchemaHandle` so a previously
 * assigned schema remains visible across mode switches.
 */
export function SchemaImportForm({
  label,
  role,
  defaultProtocol = "atproto",
  defaultNsid = "",
  compact = false,
}: SchemaImportFormProps) {
  const [protocols, setProtocols] = useState<ProtocolMeta[]>([]);
  const [selectedProtocol, setSelectedProtocol] = useState(defaultProtocol);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<null | { kind: "ok" | "err"; message: string }>(null);
  const [busy, setBusy] = useState(false);

  // ATProto-specific state
  const [nsid, setNsid] = useState(defaultNsid);
  const [suggestions, setSuggestions] = useState<LexiconSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [autocompleteAvailable, setAutocompleteAvailable] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const assignSourceSchema = useCircuitStore((s) => s.assignSourceSchema);
  const assignTargetSchema = useCircuitStore((s) => s.assignTargetSchema);
  const setInputData = useCircuitStore((s) => s.setInputData);
  const openSchemaViewer = useCircuitStore((s) => s.openSchemaViewer);
  const openHintEditor = useCircuitStore((s) => s.openHintEditor);
  const otherSchemaHandle = useCircuitStore((s) =>
    role === "target" ? s.sourceSchemaHandle : s.targetSchemaHandle,
  );
  const otherNsid = useCircuitStore((s) =>
    role === "target" ? s.sourceNsid : s.targetNsid,
  );
  const autoLensSnapshot = useCircuitStore((s) => s.autoLensSnapshot);

  // Rehydration: look up the schema currently assigned to this role so
  // the user can see their work persisted across mode switches.
  const assignedHandle = useCircuitStore((s) =>
    role === "target" ? s.targetSchemaHandle : s.sourceSchemaHandle,
  );
  const assignedSchema = useCircuitStore((s) =>
    assignedHandle === null
      ? null
      : s.importedSchemas.find((x) => x.handle === assignedHandle) ?? null,
  );

  // Load protocol list on mount.
  useEffect(() => {
    try {
      setProtocols(wasm.listSupportedProtocols());
    } catch {
      // WASM not ready yet; will retry on next render.
    }
  }, []);

  // ATProto autocomplete (debounced).
  useEffect(() => {
    if (selectedProtocol !== "atproto" || !nsid.trim()) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const results = await fetchLexiconAutocomplete(nsid, controller.signal);
        setSuggestions(results);
        setAutocompleteAvailable(true);
        setHighlightedIdx(-1);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setSuggestions([]);
        setAutocompleteAvailable(false);
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [nsid, selectedProtocol]);

  // Hide suggestions on outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selectedMeta = protocols.find((p) => p.name === selectedProtocol);
  const inputFormat = selectedMeta?.input_format ?? "json";
  const isAtproto = selectedProtocol === "atproto";

  const installSchema = (result: wasm.SchemaImportResult, displayLabel: string) => {
    // Track NSID separately for atproto-resolved schemas so the
    // snapshot-indicator can look up the pair. For non-atproto
    // imports (pasted native schema, custom protocol), displayLabel
    // is the protocol name rather than an NSID, so leave the NSID
    // field null — the snapshot reports "unknown" in that case,
    // which is the correct answer.
    const nsid = result.summary.protocol === "atproto" ? displayLabel : null;
    useCircuitStore.setState((s) => ({
      importedSchemas: [
        ...s.importedSchemas,
        {
          handle: result.handle,
          name: `${displayLabel} (${result.summary.protocol}, ${result.summary.vertex_count}V)`,
          protocol: result.summary.protocol,
          vertexCount: result.summary.vertex_count,
          edgeCount: result.summary.edge_count,
        },
      ],
      ...(role === "target" ? { targetNsid: nsid } : { sourceNsid: nsid }),
    }));
    if (role === "target") {
      assignTargetSchema(result.handle);
    } else {
      assignSourceSchema(result.handle);
    }
    setStatus({
      kind: "ok",
      message: `imported ${result.summary.protocol} (${result.summary.vertex_count}V, ${result.summary.edge_count}E)`,
    });
    setEditing(false);
  };

  // ATProto: resolve NSID from lexicon.garden.
  const handleResolveAtproto = async () => {
    const trimmed = nsid.trim();
    if (!trimmed) {
      setStatus({ kind: "err", message: "enter an NSID" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const url = `https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body?.schema) throw new Error("no schema in response");
      const schemaJson = JSON.stringify(
        typeof body.schema === "object" && "lexicon" in body.schema
          ? body.schema
          : body,
      );
      const result = wasm.parseAtprotoLexicon(schemaJson);
      installSchema(result, trimmed);
      // Seed input for source schemas with known examples.
      if (role === "source") {
        const example = exampleRecordForNsid(trimmed);
        if (example) {
          const current = useCircuitStore.getState().inputDataJson.trim();
          if (!current || current === "" || current === "{}") {
            setInputData(JSON.stringify(example, null, 2));
          }
        }
      }
    } catch (err) {
      setStatus({ kind: "err", message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  // Generic: parse native schema.
  const handleParseNative = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setStatus({ kind: "err", message: `paste ${inputFormat === "text" ? "schema text" : "schema JSON"}` });
      return;
    }
    setStatus(null);
    try {
      const result = wasm.parseNativeSchema(selectedProtocol, trimmed);
      installSchema(result, selectedProtocol);
    } catch (err) {
      setStatus({ kind: "err", message: String(err) });
    }
  };

  // ATProto autocomplete keyboard nav.
  const onNsidKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const open = showSuggestions && suggestions.length > 0;
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && highlightedIdx >= 0) {
        e.preventDefault();
        setNsid(suggestions[highlightedIdx].nsid);
        setShowSuggestions(false);
      } else if (!busy) {
        handleResolveAtproto();
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const chooseSuggestion = (s: LexiconSuggestion) => {
    setNsid(s.nsid);
    setShowSuggestions(false);
  };

  // Group protocols by category for the dropdown.
  const categories = [...new Set(protocols.map((p) => p.category))];
  const padding = compact ? 8 : 12;

  // If a schema is already assigned to this role, show a summary banner
  // with a Change button that falls back to the input form.
  const [editing, setEditing] = useState(false);
  const showAssignedBanner = assignedSchema !== null && !editing;

  const clearAssignment = () => {
    if (role === "target") {
      assignTargetSchema(null);
    } else {
      // No "clear source" API; assigning null would error. Just open
      // the form so the user can replace it.
    }
    setEditing(true);
    setStatus(null);
  };

  return (
    <div
      ref={containerRef}
      data-widget="schema_import"
      data-role={role}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding,
        border: "1px solid oklch(0.3 0.01 250)",
        borderRadius: 6,
        background: "oklch(0.14 0.01 250)",
      }}
    >
      {/* Label + protocol selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label
          style={{
            fontSize: 11,
            color: "#999",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </label>
        {!showAssignedBanner && (
          <select
            value={selectedProtocol}
            onChange={(e) => {
              setSelectedProtocol(e.target.value);
              setStatus(null);
              setInput("");
            }}
            title="Select schema language"
            style={{
              marginLeft: "auto",
              padding: "3px 6px",
              background: "oklch(0.18 0.01 250)",
              border: "1px solid oklch(0.3 0.01 250)",
              borderRadius: 3,
              color: "#ddd",
              fontSize: 11,
              outline: "none",
            }}
          >
            {categories.map((cat) => (
              <optgroup key={cat} label={cat}>
                {protocols
                  .filter((p) => p.category === cat)
                  .map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>

      {/* Assigned-schema banner: shows persisted assignment across mode
          switches. "Change" swaps in the input form. */}
      {showAssignedBanner && assignedSchema && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "6px 8px",
            background: "oklch(0.18 0.02 140)",
            border: "1px solid oklch(0.32 0.04 140)",
            borderRadius: 3,
            // Contain the schema-name line width so the flex child's
            // min-width can be 0 and ellipsis will actually apply.
            minWidth: 0,
          }}
        >
          <div
            title={assignedSchema.name}
            style={{
              fontSize: 11,
              color: "#98c379",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {assignedSchema.name}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button
              onClick={() => openSchemaViewer(assignedSchema.handle)}
              title="Inspect this schema's vertices, edges, and constraints"
              data-testid={`schema-viewer-open-${role}`}
              style={miniBtnStyle}
            >
              View
            </button>
            {otherSchemaHandle !== null && (
              <button
                onClick={openHintEditor}
                title="Refine the auto-generated lens with hints"
                data-testid={`hint-editor-open-${role}`}
                style={miniBtnStyle}
              >
                Hints
              </button>
            )}
            <button
              onClick={clearAssignment}
              title="Replace this schema"
              style={miniBtnStyle}
            >
              Change
            </button>
          </div>
        </div>
      )}

      {/* Protocol description */}
      {!showAssignedBanner && selectedMeta && (
        <div style={{ fontSize: 10, color: "#666" }}>
          {selectedMeta.description}
          {inputFormat === "text" ? " (paste schema text below)" : " (paste JSON below)"}
        </div>
      )}

      {/* ATProto: NSID resolver */}
      {!showAssignedBanner && isAtproto && (
        <>
          <div style={{ position: "relative", display: "flex", gap: 4 }}>
            <input
              type="text"
              value={nsid}
              onChange={(e) => { setNsid(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={onNsidKeyDown}
              placeholder="app.bsky.feed.post"
              aria-label="Lexicon NSID"
              aria-autocomplete="list"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              style={{
                flex: 1,
                minWidth: 0,
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
            <button
              onClick={handleResolveAtproto}
              disabled={busy}
              title="Fetch this lexicon from lexicon.garden"
              style={{
                padding: "6px 12px",
                background: busy ? "oklch(0.22 0.01 250)" : "#9C27B0",
                color: "#fff",
                border: "none",
                borderRadius: 3,
                fontSize: 12,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "…" : "Resolve"}
            </button>
            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <ul
                role="listbox"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: 2,
                  listStyle: "none",
                  padding: 0,
                  maxHeight: 200,
                  overflowY: "auto",
                  background: "oklch(0.12 0.01 250)",
                  border: "1px solid oklch(0.32 0.01 250)",
                  borderRadius: 4,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  zIndex: 100,
                }}
              >
                {suggestions.map((s, i) => {
                  // Snapshot indicator: look the pair up in the
                  // direction the lens would run. Role === "target"
                  // means the suggestion IS the target, so the pair
                  // is (source, suggestion); for role === "source",
                  // pair is (suggestion, target).
                  const pairStatus = autoLensSnapshot
                    ? role === "target"
                      ? autoLensSnapshot.status(otherNsid, s.nsid)
                      : autoLensSnapshot.status(s.nsid, otherNsid)
                    : "unknown";
                  return (
                    <li
                      key={s.nsid}
                      role="option"
                      aria-selected={i === highlightedIdx}
                      onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(s); }}
                      onMouseEnter={() => setHighlightedIdx(i)}
                      style={{
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontFamily: "ui-monospace, SF Mono, monospace",
                        fontSize: 12,
                        color: i === highlightedIdx ? "#fff" : "#ddd",
                        background: i === highlightedIdx ? "oklch(0.2 0.02 280)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.nsid}
                      </span>
                      <AutoLensBadge status={pairStatus} hasOther={otherNsid !== null} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div style={{ fontSize: 10, color: "#666" }}>
            {autocompleteAvailable
              ? "Type to search; use arrow keys to navigate, Enter to select."
              : <>
                  Autocomplete is not available in this environment. Type a full NSID and click Resolve.{" "}
                  <a href="https://lexicon.garden/browse" target="_blank" rel="noopener noreferrer" style={{ color: "#61afef" }}>
                    Browse available lexicons
                  </a>
                </>}
          </div>
          {otherNsid && autoLensSnapshot && (
            <div
              style={{
                fontSize: 10,
                color: "#666",
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: "#4CAF50" }}>●</span> auto ={" "}
              precomputed lens available <span style={{ margin: "0 4px" }}>·</span>
              <span style={{ color: "#F44336" }}>●</span> no auto ={" "}
              known to fail <span style={{ margin: "0 4px" }}>·</span>
              <span style={{ color: "#666" }}>●</span> unknown = outside
              the snapshot ({autoLensSnapshot.schemaCount} lexicons,{" "}
              {autoLensSnapshot.meta.generated_at.slice(0, 10)})
            </div>
          )}
        </>
      )}

      {/* Generic: paste native schema */}
      {!showAssignedBanner && !isAtproto && (
        <>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={inputFormat === "text" ? "Paste schema text here..." : "Paste schema JSON here..."}
            spellCheck={false}
            style={{
              minHeight: compact ? 60 : 100,
              padding: 8,
              background: "oklch(0.1 0.01 250)",
              border: "1px solid oklch(0.3 0.01 250)",
              borderRadius: 3,
              color: "#ddd",
              fontFamily: "ui-monospace, SF Mono, monospace",
              fontSize: 12,
              outline: "none",
              resize: "vertical",
            }}
          />
          <button
            onClick={handleParseNative}
            title={`Parse the ${selectedProtocol} schema and import it`}
            style={{
              alignSelf: "flex-start",
              padding: "6px 12px",
              background: "#9C27B0",
              color: "#fff",
              border: "none",
              borderRadius: 3,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Parse
          </button>
        </>
      )}

      {/* Status */}
      {status && (
        <div style={{ fontSize: 10, color: status.kind === "ok" ? "#98c379" : "#F44336" }}>
          {status.message}
        </div>
      )}
    </div>
  );
}
