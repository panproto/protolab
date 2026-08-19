/**
 * Lens library: publish the circuit on the canvas to a PDS, and browse the
 * lenses a DID has already published.
 *
 * Browsing works signed out. Publishing does not, and the panel says which
 * of the two you are looking at rather than presenting a dead button.
 */

import { useCallback, useEffect, useState } from "react";
import { useCircuitStore } from "../store/circuitStore";
import { useSessionsStore } from "../sessions/store";
import { grantedScopes } from "../sessions/types";
import { missingPublishScopes } from "../sessions/scopes";
import { publishLens, PublishError, type LensPublishResult } from "../sessions/publishLens";
import { loadLibrary, type LensWithSchemas } from "../sessions/lensLibrary";

interface Props {
  onClose: () => void;
}

const OPTIC_COLOR: Record<string, string> = {
  iso: "oklch(0.75 0.15 160)",
  retraction: "oklch(0.78 0.15 90)",
  projection: "oklch(0.72 0.15 40)",
  opaque: "oklch(0.65 0.02 250)",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "oklch(0 0 0 / 0.55)",
  display: "grid",
  placeItems: "center",
  zIndex: 100,
};

const dialog: React.CSSProperties = {
  width: "min(720px, 92vw)",
  maxHeight: "82vh",
  display: "flex",
  flexDirection: "column",
  background: "oklch(0.14 0.01 250)",
  border: "1px solid oklch(0.3 0.01 250)",
  borderRadius: 8,
  color: "#ccc",
  fontSize: 12,
};

const tabStyle = (on: boolean): React.CSSProperties => ({
  padding: "6px 14px",
  background: "none",
  border: "none",
  borderBottom: `2px solid ${on ? "oklch(0.6 0.13 160)" : "transparent"}`,
  color: on ? "#eee" : "#999",
  cursor: "pointer",
  fontSize: 12,
});

export function LensLibrary({ onClose }: Props) {
  const [tab, setTab] = useState<"publish" | "browse">("publish");

  const circuitHandle = useCircuitStore((s) => s.circuitHandle);
  const sourceSchemaHandle = useCircuitStore((s) => s.sourceSchemaHandle);
  const targetSchemaHandle = useCircuitStore((s) => s.targetSchemaHandle);
  const nodes = useCircuitStore((s) => s.nodes);

  const sessions = useSessionsStore((s) => s.sessions);
  const activeDid = useSessionsStore((s) => s.activeDid);
  const active = activeDid ? sessions[activeDid] : undefined;

  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<LensPublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [browseDid, setBrowseDid] = useState("");
  const [library, setLibrary] = useState<LensWithSchemas[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const missing = missingPublishScopes(grantedScopes(active));
  const hasCircuit = circuitHandle !== null && nodes.length > 0;
  const hasSchemas = sourceSchemaHandle !== null && targetSchemaHandle !== null;
  const canPublish = Boolean(active) && missing.length === 0 && hasCircuit && hasSchemas;

  const load = useCallback(async (did: string) => {
    if (!did.trim()) return;
    setLoading(true);
    setBrowseError(null);
    try {
      setLibrary(await loadLibrary(did.trim()));
    } catch (e) {
      setBrowseError(e instanceof Error ? e.message : String(e));
      setLibrary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Default the browse field to the signed-in DID and load it once.
  useEffect(() => {
    if (activeDid && !browseDid) setBrowseDid(activeDid);
  }, [activeDid, browseDid]);

  useEffect(() => {
    if (tab === "browse" && browseDid && library === null && !loading) {
      void load(browseDid);
    }
  }, [tab, browseDid, library, loading, load]);

  async function doPublish() {
    if (circuitHandle === null || sourceSchemaHandle === null || targetSchemaHandle === null) {
      return;
    }
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      const r = await publishLens({
        circuitHandle,
        sourceSchemaHandle,
        targetSchemaHandle,
      });
      setResult(r);
      // A fresh publish invalidates whatever the browse tab is showing.
      setLibrary(null);
    } catch (e) {
      setError(e instanceof PublishError ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "0 12px",
            borderBottom: "1px solid oklch(0.25 0.01 250)",
          }}
        >
          <button style={tabStyle(tab === "publish")} onClick={() => setTab("publish")}>
            Publish
          </button>
          <button style={tabStyle(tab === "browse")} onClick={() => setTab("browse")}>
            Browse
          </button>
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              color: "#888",
              cursor: "pointer",
              fontSize: 18,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ padding: 14, overflowY: "auto" }}>
          {tab === "publish" ? (
            <>
              <p style={{ marginTop: 0, opacity: 0.75, lineHeight: 1.6 }}>
                Publishing writes a <code>dev.panproto.schema.lens</code> record
                to your repo, plus a <code>dev.panproto.schema.schema</code>{" "}
                record for each endpoint it references. Schemas are
                content-addressed, so republishing an unchanged one reuses the
                existing record instead of duplicating it.
              </p>

              <ul style={{ listStyle: "none", padding: 0, margin: "14px 0" }}>
                <Requirement met={Boolean(active)}>
                  {active
                    ? `Signed in as ${active.handle ?? active.did}`
                    : "Sign in from the account menu"}
                </Requirement>
                <Requirement met={Boolean(active) && missing.length === 0}>
                  {missing.length > 0
                    ? `Session is missing ${missing.join(", ")} — sign in again with "Author"`
                    : "Session can write lens and schema records"}
                </Requirement>
                <Requirement met={hasCircuit}>
                  {hasCircuit
                    ? `${nodes.length} component${nodes.length === 1 ? "" : "s"} on the canvas`
                    : "Canvas is empty — add components first"}
                </Requirement>
                {/* Source and target are reported separately. The target
                    dropdown shows a protocol and an NSID before anything is
                    resolved, so a combined "assign a source and target"
                    row reads as wrong on the default screen: both look
                    assigned, and the row does not say that the target still
                    needs resolving to become a handle. */}
                <Requirement met={sourceSchemaHandle !== null}>
                  {sourceSchemaHandle !== null
                    ? "Source schema assigned"
                    : "Assign a source schema (Schemas ▸)"}
                </Requirement>
                <Requirement met={targetSchemaHandle !== null}>
                  {targetSchemaHandle !== null
                    ? "Target schema resolved"
                    : "Resolve the target schema — the dropdown names one, but it is not resolved until you press Resolve"}
                </Requirement>
              </ul>

              <button
                disabled={!canPublish || publishing}
                onClick={() => void doPublish()}
                style={{
                  padding: "6px 14px",
                  background: canPublish ? "oklch(0.45 0.13 160)" : "oklch(0.22 0.01 250)",
                  border: "none",
                  borderRadius: 4,
                  color: canPublish ? "#fff" : "#777",
                  cursor: canPublish && !publishing ? "pointer" : "default",
                  fontSize: 12,
                }}
              >
                {publishing ? "Publishing…" : "Publish lens"}
              </button>

              {error && (
                <p style={{ color: "oklch(0.7 0.17 25)", marginTop: 12 }}>{error}</p>
              )}

              {result && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 10,
                    border: "1px solid oklch(0.4 0.1 160)",
                    borderRadius: 4,
                    background: "oklch(0.18 0.03 160)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    {result.lens.reused ? "Already published" : "Published"}
                  </div>
                  <RefLine label="lens" r={result.lens} />
                  <RefLine label="source" r={result.source} />
                  <RefLine label="target" r={result.target} />
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <input
                  value={browseDid}
                  onChange={(e) => setBrowseDid(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void load(browseDid)}
                  placeholder="did:plc:… or alice.bsky.social"
                  style={{
                    flex: 1,
                    padding: "5px 7px",
                    background: "oklch(0.11 0.01 250)",
                    border: "1px solid oklch(0.3 0.01 250)",
                    borderRadius: 4,
                    color: "#ddd",
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                />
                <button
                  onClick={() => void load(browseDid)}
                  style={{
                    padding: "5px 12px",
                    background: "oklch(0.2 0.01 250)",
                    border: "1px solid oklch(0.3 0.01 250)",
                    borderRadius: 4,
                    color: "#ccc",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Load
                </button>
              </div>

              {loading && <p style={{ opacity: 0.6 }}>Loading…</p>}
              {browseError && (
                <p style={{ color: "oklch(0.7 0.17 25)" }}>{browseError}</p>
              )}
              {library && library.length === 0 && (
                <p style={{ opacity: 0.6 }}>No lenses published by this DID yet.</p>
              )}
              {library && library.length > 0 && (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {library.map(({ lens, source, target }) => (
                    <li
                      key={lens.uri}
                      style={{
                        padding: "8px 10px",
                        marginBottom: 6,
                        border: "1px solid oklch(0.27 0.01 250)",
                        borderRadius: 4,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                          {source?.protocol ?? "?"} → {target?.protocol ?? "?"}
                        </span>
                        {lens.roundTripClass && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "1px 6px",
                              borderRadius: 999,
                              border: `1px solid ${OPTIC_COLOR[lens.roundTripClass] ?? "#555"}`,
                              color: OPTIC_COLOR[lens.roundTripClass] ?? "#999",
                            }}
                          >
                            {lens.roundTripClass}
                          </span>
                        )}
                        {lens.lawsVerified && (
                          <span style={{ fontSize: 10, color: "oklch(0.75 0.15 160)" }}>
                            laws verified
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace" }}>
                        {lens.objectHash.slice(0, 12)} ·{" "}
                        {lens.createdAt ? lens.createdAt.slice(0, 10) : "undated"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 5 }}>
      <span style={{ color: met ? "oklch(0.75 0.15 160)" : "#777" }}>{met ? "✓" : "○"}</span>
      <span style={{ opacity: met ? 0.9 : 0.65 }}>{children}</span>
    </li>
  );
}

function RefLine({ label, r }: { label: string; r: { uri: string; reused: boolean } }) {
  return (
    <div style={{ fontSize: 10, fontFamily: "monospace", opacity: 0.8, lineHeight: 1.7 }}>
      <span style={{ opacity: 0.6 }}>{label}</span> {r.uri}
      {r.reused && <span style={{ opacity: 0.5 }}> (reused)</span>}
    </div>
  );
}
