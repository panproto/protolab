import { useEffect, useRef, useState } from "react";
import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore } from "../../store/circuitStore";
import * as wasm from "../../wasm/bridge";
import { getProp } from "./widgetHelpers";
import { exampleRecordForNsid } from "../lexiconExamples";
import { fetchLexiconAutocomplete, type LexiconSuggestion } from "../lexiconGarden";

/**
 * Lexicon import widget: fetches a lexicon schema from lexicon.garden
 * by NSID and installs it as the circuit's source schema.
 *
 *   GET https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid=<NSID>
 *
 * The endpoint is served with permissive CORS, so the browser fetches
 * directly — no proxy. The response is `{cid, uri, schema: {...}}`;
 * the `schema` field is handed to `panproto_protocols::web_document::
 * atproto::parse_lexicon` via the WASM bridge.
 *
 * For NSIDs with a bundled canonical example (`lexiconExamples.ts`),
 * the widget also seeds the circuit's input data so Run is immediately
 * meaningful.
 *
 * An advanced "paste JSON" expander is kept as a last-resort offline
 * path; it accepts either a bare schema or the wrapped resolveLexicon
 * response.
 */

const LEXICON_GARDEN_XRPC =
  "https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon";

function extractSchema(parsed: unknown): unknown {
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (
      "schema" in obj &&
      typeof obj.schema === "object" &&
      obj.schema !== null &&
      "lexicon" in (obj.schema as Record<string, unknown>)
    ) {
      return obj.schema;
    }
  }
  return parsed;
}

export function LexiconImportWidget({ widget }: WidgetProps) {
  const label = getProp(widget, "label", "Lexicon NSID");
  const defaultNsid = getProp(widget, "default_nsid", "app.bsky.feed.post");
  const [nsid, setNsid] = useState(defaultNsid);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<null | { kind: "ok" | "err"; message: string }>(null);

  // ── Autocomplete state ─────────────────────────────────────────
  const [suggestions, setSuggestions] = useState<LexiconSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [autocompleteAvailable, setAutocompleteAvailable] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const assignSourceSchema = useCircuitStore((s) => s.assignSourceSchema);
  const setInputData = useCircuitStore((s) => s.setInputData);

  // Debounced autocomplete: fetch lexicon.garden suggestions 150ms
  // after the user stops typing. Each effect-run has its own
  // AbortController so stale responses are discarded when the user
  // keeps typing.
  useEffect(() => {
    if (!nsid.trim()) {
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
        // Network / CORS failure: disable autocomplete UI silently.
        setSuggestions([]);
        setAutocompleteAvailable(false);
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [nsid]);

  // Hide the suggestion dropdown when the user clicks outside the
  // widget's input cluster.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const installLexicon = (schemaJsonText: string, seededFromNsid?: string) => {
    try {
      const result = wasm.parseAtprotoLexicon(schemaJsonText);
      useCircuitStore.setState((s) => ({
        importedSchemas: [
          ...s.importedSchemas,
          {
            handle: result.handle,
            name: `${seededFromNsid ?? result.summary.protocol} (lexicon, ${result.summary.vertex_count}V)`,
            protocol: result.summary.protocol,
            vertexCount: result.summary.vertex_count,
            edgeCount: result.summary.edge_count,
          },
        ],
      }));
      assignSourceSchema(result.handle);

      if (seededFromNsid) {
        const example = exampleRecordForNsid(seededFromNsid);
        if (example) {
          const current = useCircuitStore.getState().inputDataJson;
          if (!current || current.trim() === "" || current.includes('"Alice"')) {
            setInputData(JSON.stringify(example, null, 2));
          }
        }
      }

      setStatus({
        kind: "ok",
        message: `imported ${seededFromNsid ?? "lexicon"} (${result.summary.vertex_count}V, ${result.summary.edge_count}E)`,
      });
    } catch (err) {
      const msg = String(err);
      setStatus({ kind: "err", message: msg });
      useCircuitStore.setState({ error: msg });
    }
  };

  const handleResolve = async () => {
    setStatus(null);
    const trimmed = nsid.trim();
    if (!trimmed) {
      setStatus({ kind: "err", message: "enter an NSID (e.g. app.bsky.feed.post)" });
      return;
    }
    setBusy(true);
    try {
      const url = `${LEXICON_GARDEN_XRPC}?nsid=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(
          `lexicon.garden returned HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
        );
      }
      const body = await res.json();
      if (!body || typeof body.schema !== "object") {
        throw new Error("lexicon.garden response missing `schema` field");
      }
      installLexicon(JSON.stringify(body.schema), trimmed);
    } catch (err) {
      setStatus({
        kind: "err",
        message: `fetch failed: ${err}. You can paste the lexicon JSON below instead.`,
      });
      setShowPaste(true);
    } finally {
      setBusy(false);
    }
  };

  const handlePasteLoad = () => {
    setStatus(null);
    const src = paste.trim();
    if (!src) {
      setStatus({ kind: "err", message: "paste a lexicon JSON document" });
      return;
    }
    try {
      const parsed = JSON.parse(src);
      const schema = extractSchema(parsed);
      installLexicon(JSON.stringify(schema));
    } catch (err) {
      setStatus({ kind: "err", message: `invalid JSON: ${err}` });
    }
  };

  const chooseSuggestion = (s: LexiconSuggestion) => {
    setNsid(s.nsid);
    setShowSuggestions(false);
    setHighlightedIdx(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const open = showSuggestions && suggestions.length > 0;
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      if (open && highlightedIdx >= 0 && highlightedIdx < suggestions.length) {
        e.preventDefault();
        chooseSuggestion(suggestions[highlightedIdx]);
        return;
      }
      if (!busy) handleResolve();
      return;
    }
    if (e.key === "Escape" && open) {
      setShowSuggestions(false);
    }
  };

  return (
    <div
      ref={containerRef}
      data-widget="lexicon_import"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 10,
        border: "1px solid oklch(0.3 0.01 250)",
        borderRadius: 6,
        background: "oklch(0.14 0.01 250)",
      }}
    >
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
      <div style={{ position: "relative", display: "flex", gap: 4 }}>
        <input
          type="text"
          value={nsid}
          onChange={(e) => {
            setNsid(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={onKeyDown}
          placeholder="app.bsky.feed.post"
          aria-label="Lexicon NSID"
          aria-autocomplete="list"
          aria-expanded={showSuggestions && suggestions.length > 0}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          style={{
            flex: 1,
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
          onClick={handleResolve}
          disabled={busy}
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
        {showSuggestions && suggestions.length > 0 && (
          <ul
            role="listbox"
            aria-label="NSID suggestions"
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 2,
              listStyle: "none",
              padding: 0,
              maxHeight: 240,
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
                key={`${s.did ?? ""}|${s.nsid}`}
                role="option"
                aria-selected={i === highlightedIdx}
                onMouseDown={(e) => {
                  // Use onMouseDown so the click registers before the
                  // input blur hides the dropdown.
                  e.preventDefault();
                  chooseSuggestion(s);
                }}
                onMouseEnter={() => setHighlightedIdx(i)}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontFamily: "ui-monospace, SF Mono, monospace",
                  fontSize: 12,
                  color: i === highlightedIdx ? "#fff" : "#ddd",
                  background:
                    i === highlightedIdx ? "oklch(0.2 0.02 280)" : "transparent",
                }}
              >
                {s.nsid}
                {s.did && (
                  <span
                    style={{
                      marginLeft: 8,
                      color: "#666",
                      fontSize: 10,
                    }}
                  >
                    {s.did.slice(0, 20)}…
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ fontSize: 10, color: "#666" }}>
        {autocompleteAvailable
          ? "type to search · ↑/↓ to navigate · ↵ to select"
          : "autocomplete unavailable (CORS); type a full NSID and click Resolve"}
      </div>
      <button
        onClick={() => setShowPaste((v) => !v)}
        style={{
          alignSelf: "flex-start",
          background: "none",
          border: "none",
          color: "#61afef",
          fontSize: 10,
          cursor: "pointer",
          padding: 0,
        }}
      >
        {showPaste ? "− hide paste" : "+ or paste lexicon JSON directly"}
      </button>
      {showPaste && (
        <>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            aria-label="Lexicon JSON"
            placeholder='{"lexicon":1,"id":"...","defs":{...}}'
            spellCheck={false}
            style={{
              minHeight: 80,
              padding: 6,
              background: "oklch(0.1 0.01 250)",
              border: "1px solid oklch(0.3 0.01 250)",
              borderRadius: 3,
              color: "#ddd",
              fontFamily: "ui-monospace, SF Mono, monospace",
              fontSize: 11,
              outline: "none",
              resize: "vertical",
            }}
          />
          <button
            onClick={handlePasteLoad}
            style={{
              alignSelf: "flex-start",
              padding: "4px 10px",
              background: "oklch(0.25 0.01 250)",
              border: "1px solid oklch(0.35 0.01 250)",
              color: "#ddd",
              borderRadius: 3,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Load from paste
          </button>
        </>
      )}
      {status && (
        <div
          style={{
            fontSize: 10,
            color: status.kind === "ok" ? "#98c379" : "#F44336",
          }}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}
