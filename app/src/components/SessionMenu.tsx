/**
 * Account badge and multi-account switcher.
 *
 * protolab can hold several atproto sessions at once; the active one is
 * what a publish writes to. The badge shows who that is, because "which
 * DID am I about to publish under" is the question this control exists to
 * answer.
 */

import { useEffect, useRef, useState } from "react";
import { useSessionsStore } from "../sessions/store";
import { resumeSession, signOut, startSignIn } from "../sessions/oauth";
import { getScopesForIntent, type AuthIntent } from "../sessions/scopes";

interface ActorMatch {
  did: string;
  handle: string;
  displayName?: string;
}

// bsky's public AppView fronts typeahead with open CORS, so the handle
// field can autocomplete without a proxy or a session.
const TYPEAHEAD_URL =
  "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead";

const INTENT_LABEL: Record<AuthIntent, string> = {
  "read-only": "Read-only",
  author: "Author",
};

const INTENT_HINT: Record<AuthIntent, string> = {
  "read-only": "browse libraries; cannot publish",
  author: "publish lenses and the schemas they reference",
};

// Fixed, not absolute: the edit toolbar sets `overflow: hidden` so its
// buttons wrap cleanly, which clips any absolutely-positioned child that
// extends past the bar — the panel rendered into the DOM and was
// invisible. Anchoring to the viewport escapes that clipping context.
//
// `top` is measured from the trigger rather than hard-coded, because the
// two toolbars this renders in are different heights (the edit bar is a
// 40px min-height row; the presentation bar is padding-sized).
const panel: React.CSSProperties = {
  position: "fixed",
  width: 340,
  background: "oklch(0.16 0.01 250)",
  border: "1px solid oklch(0.3 0.01 250)",
  borderRadius: 6,
  padding: 12,
  zIndex: 40,
  boxShadow: "0 8px 24px oklch(0 0 0 / 0.45)",
  color: "#ccc",
  fontSize: 12,
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "5px 7px",
  background: "oklch(0.12 0.01 250)",
  border: "1px solid oklch(0.3 0.01 250)",
  borderRadius: 4,
  color: "#ddd",
  fontSize: 12,
};

export function SessionMenu() {
  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [intent, setIntent] = useState<AuthIntent>("author");
  const [matches, setMatches] = useState<ActorMatch[]>([]);
  const [matchesOpen, setMatchesOpen] = useState(false);
  const skipNextSearch = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Viewport coordinates for the panel, measured from the trigger when it
  // opens. Null until then; the panel does not render before it is open.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(
    null,
  );

  function toggle() {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        const r = triggerRef.current?.getBoundingClientRect();
        if (r) {
          setAnchor({
            top: r.bottom + 6,
            right: Math.max(8, window.innerWidth - r.right),
          });
        }
      }
      return !wasOpen;
    });
  }

  const sessions = useSessionsStore((s) => s.sessions);
  const activeDid = useSessionsStore((s) => s.activeDid);
  const setActiveDid = useSessionsStore((s) => s.setActiveDid);

  // Always ask, on every mount. The authoritative session store is the
  // OAuth library's IndexedDB; protolab's localStorage is only a mirror of
  // what to *display*. An earlier version skipped this probe when the
  // mirror was empty and the URL carried no callback params, which meant a
  // user who had authenticated — library IndexedDB populated, mirror not
  // yet written — was never restored and read as signed out forever.
  // Nothing but `resumeSession` can know whether a session exists, so it
  // is not ours to short-circuit.
  //
  // `resumeSession` memoizes, so the double mount across the edit →
  // presentation switch still performs a single `init()`.
  useEffect(() => {
    void resumeSession().catch((e: unknown) =>
      console.warn("resumeSession failed", e),
    );
  }, []);

  // Debounced typeahead. The ref guard skips the search that the input's
  // own onChange would otherwise fire right after a suggestion is clicked.
  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    const q = handle.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`${TYPEAHEAD_URL}?q=${encodeURIComponent(q)}&limit=8`, {
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: { actors?: ActorMatch[] }) => {
          setMatches(d.actors ?? []);
          setMatchesOpen(true);
        })
        .catch(() => {
          /* no suggestions on a network hiccup */
        });
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [handle]);

  // No loading placeholder. The control renders straight from the store,
  // so a returning user sees "Sign in" for the moment the restore takes
  // and then the avatar. Gating the render on a probe status was what
  // tempted the skip-the-probe optimization that broke restores; there is
  // no status to get wrong if the store is the only input.
  const active = activeDid ? sessions[activeDid] : undefined;
  const list = Object.values(sessions);

  async function doSignIn() {
    if (!handle.trim()) return;
    setSigningIn(true);
    setError(null);
    try {
      // Navigates away on success, so this rarely resolves.
      await startSignIn(handle.trim(), intent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSigningIn(false);
    }
  }

  const initials = (s: { handle?: string; did: string }) =>
    (s.handle ?? s.did.replace("did:plc:", "")).slice(0, 2).toUpperCase();

  return (
    <div style={{ position: "relative", marginLeft: "auto" }}>
      {/* Signed out: a labelled button, because nothing else on the bar
          says what it is for. Signed in: the avatar alone — the handle and
          the other-accounts count live one click away in the panel, and
          the identity is what the control is now about. */}
      <button
        ref={triggerRef}
        onClick={toggle}
        title={
          active
            ? list.length > 1
              ? `Publishing as @${active.label} — ${list.length} accounts signed in`
              : `Publishing as @${active.label}`
            : "Sign in to publish"
        }
        aria-label={active ? `Account: @${active.label}` : "Sign in"}
        style={
          active
            ? {
                display: "block",
                width: 26,
                height: 26,
                padding: 0,
                borderRadius: "50%",
                overflow: "hidden",
                background: "oklch(0.3 0.01 250)",
                border: "1px solid oklch(0.6 0.13 160)",
                cursor: "pointer",
                lineHeight: 0,
              }
            : {
                padding: "4px 10px",
                background: "oklch(0.2 0.01 250)",
                border: "1px solid oklch(0.3 0.01 250)",
                borderRadius: 999,
                color: "#ccc",
                cursor: "pointer",
                fontSize: 12,
              }
        }
      >
        {active ? (
          active.avatar ? (
            <img
              src={active.avatar}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            // No avatar on the profile, or the AppView lookup failed.
            // Initials keep the control the same size and shape.
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: "100%",
                height: "100%",
                fontSize: 10,
                fontFamily: "monospace",
                color: "#ccc",
              }}
            >
              {initials(active)}
            </span>
          )
        ) : (
          "Sign in"
        )}
      </button>

      {open && (
        <div style={{ ...panel, top: anchor?.top ?? 46, right: anchor?.right ?? 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Accounts</div>

          {list.length === 0 ? (
            <p style={{ opacity: 0.6, margin: "0 0 10px" }}>
              Not signed in. You can browse any public lens library without an
              account; signing in lets you publish your own.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }}>
              {list.map((s) => {
                const isActive = s.did === activeDid;
                return (
                  <li
                    key={s.did}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 6px",
                      marginBottom: 4,
                      borderRadius: 4,
                      border: `1px solid ${isActive ? "oklch(0.6 0.13 160)" : "oklch(0.28 0.01 250)"}`,
                      background: isActive ? "oklch(0.22 0.03 160)" : "transparent",
                    }}
                  >
                    <button
                      onClick={() => setActiveDid(s.did)}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        background: "none",
                        border: "none",
                        color: "#ccc",
                        cursor: "pointer",
                        textAlign: "left",
                        padding: 0,
                      }}
                    >
                      {s.avatar ? (
                        <img
                          src={s.avatar}
                          alt=""
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: "oklch(0.3 0.01 250)",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 9,
                          }}
                        >
                          {initials(s)}
                        </span>
                      )}
                      <span style={{ minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontFamily: "monospace",
                            fontSize: 11,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {s.handle ?? s.did}
                        </span>
                        <span style={{ display: "block", fontSize: 10, opacity: 0.55 }}>
                          {s.pdsUrl ? s.pdsUrl.replace(/^https?:\/\//, "") : "PDS unknown"}
                        </span>
                      </span>
                    </button>
                    {isActive && (
                      <span style={{ fontSize: 9, color: "oklch(0.75 0.15 160)" }}>
                        publishing
                      </span>
                    )}
                    <button
                      onClick={() => void signOut(s.did)}
                      title={`Sign out ${s.handle ?? s.did}`}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#888",
                        cursor: "pointer",
                        fontSize: 14,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div style={{ fontWeight: 600, margin: "12px 0 6px" }}>
            {list.length > 0 ? "Add another account" : "Sign in"}
          </div>

          <label style={{ display: "block", position: "relative", marginBottom: 8 }}>
            <span style={{ display: "block", fontSize: 11, opacity: 0.7, marginBottom: 3 }}>
              Handle
            </span>
            <input
              type="text"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setMatchesOpen(true);
              }}
              onFocus={() => matches.length > 0 && setMatchesOpen(true)}
              onBlur={() => setTimeout(() => setMatchesOpen(false), 120)}
              onKeyDown={(e) => e.key === "Enter" && void doSignIn()}
              placeholder="alice.bsky.social"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{ ...field, fontFamily: "monospace" }}
            />
            {matchesOpen && matches.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "100%",
                  background: "oklch(0.14 0.01 250)",
                  border: "1px solid oklch(0.3 0.01 250)",
                  borderRadius: 4,
                  maxHeight: 180,
                  overflowY: "auto",
                  zIndex: 50,
                }}
              >
                {matches.map((m) => (
                  <li key={m.did}>
                    <button
                      // mousedown so the pick registers before onBlur closes us
                      onMouseDown={(e) => {
                        e.preventDefault();
                        skipNextSearch.current = true;
                        setHandle(m.handle);
                        setMatches([]);
                        setMatchesOpen(false);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "4px 7px",
                        background: "none",
                        border: "none",
                        color: "#ccc",
                        cursor: "pointer",
                        fontFamily: "monospace",
                        fontSize: 11,
                      }}
                    >
                      {m.handle}
                      {m.displayName && (
                        <span style={{ opacity: 0.5, fontFamily: "system-ui" }}>
                          {" "}
                          · {m.displayName}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>

          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ display: "block", fontSize: 11, opacity: 0.7, marginBottom: 3 }}>
              Access
            </span>
            <select
              value={intent}
              onChange={(e) => setIntent(e.target.value as AuthIntent)}
              style={field}
            >
              {(Object.keys(INTENT_LABEL) as AuthIntent[]).map((k) => (
                <option key={k} value={k}>
                  {INTENT_LABEL[k]}
                </option>
              ))}
            </select>
            <span style={{ display: "block", marginTop: 4, fontSize: 10, opacity: 0.6 }}>
              {INTENT_HINT[intent]}
            </span>
          </label>

          {/* Show the exact grant. protolab asks for two repo scopes and one
              MIME-narrowed blob scope, and nothing else; saying so plainly is
              cheaper than asking the user to trust it. */}
          <details style={{ marginBottom: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, opacity: 0.7 }}>
              What this grants
            </summary>
            <ul
              style={{
                margin: "6px 0 0",
                padding: "0 0 0 16px",
                fontFamily: "monospace",
                fontSize: 10,
                opacity: 0.8,
                lineHeight: 1.6,
              }}
            >
              {getScopesForIntent(intent)
                .split(" ")
                .map((s) => (
                  <li key={s}>{s}</li>
                ))}
            </ul>
            <p style={{ margin: "6px 0 0", fontSize: 10, opacity: 0.55 }}>
              Reading libraries needs no grant at all — public records are
              readable without signing in.
            </p>
          </details>

          <button
            disabled={signingIn || !handle.trim()}
            onClick={() => void doSignIn()}
            style={{
              padding: "5px 12px",
              background: handle.trim() ? "oklch(0.45 0.13 160)" : "oklch(0.25 0.01 250)",
              border: "none",
              borderRadius: 4,
              color: handle.trim() ? "#fff" : "#777",
              cursor: handle.trim() ? "pointer" : "default",
              fontSize: 12,
            }}
          >
            {signingIn ? "Redirecting…" : "Sign in"}
          </button>

          {error && (
            <p style={{ marginTop: 10, color: "oklch(0.7 0.17 25)", fontSize: 11 }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
