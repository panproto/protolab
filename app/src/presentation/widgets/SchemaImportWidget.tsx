import { useEffect, useRef, useState } from "react";
import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore } from "../../store/circuitStore";
import * as wasm from "../../wasm/bridge";
import type { ProtocolMeta } from "../../wasm/bridge";
import { getProp } from "./widgetHelpers";
import { exampleRecordForNsid } from "../lexiconExamples";
import { fetchLexiconAutocomplete, type LexiconSuggestion } from "../lexiconGarden";

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
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            background: "oklch(0.18 0.02 140)",
            border: "1px solid oklch(0.32 0.04 140)",
            borderRadius: 3,
          }}
        >
          <span style={{ fontSize: 11, color: "#98c379", flex: 1, wordBreak: "break-all" }}>
            {assignedSchema.name}
          </span>
          <button
            onClick={clearAssignment}
            title="Replace this schema"
            style={{
              padding: "3px 8px",
              background: "oklch(0.22 0.01 250)",
              color: "#ccc",
              border: "1px solid oklch(0.35 0.01 250)",
              borderRadius: 3,
              fontSize: 10,
              cursor: "pointer",
            }}
          >
            Change
          </button>
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
                {suggestions.map((s, i) => (
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
                    }}
                  >
                    {s.nsid}
                  </li>
                ))}
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
