/**
 * URL encoding / decoding for presentation-mode sharing. A "share URL"
 * consists of query params the app reads at startup and whenever mode /
 * circuit state changes.
 *
 * Schema:
 *   ?mode=presentation         — start in presentation mode
 *   ?c=<base64(circuit_json)>  — full circuit state, decoded via importLensDoc
 *   ?template=lexicon_mapper   — bundled template to instantiate
 *
 * Because circuit JSON can be large, we use URL-safe base64 without
 * chunking. Circuits that push past browser URL limits (~2000 chars)
 * should be shared via file instead.
 */

import * as wasm from "../wasm/bridge";

/** URL-safe base64 encode (unicode-aware). */
export function encodeBase64(s: string): string {
  // Use TextEncoder so multi-byte characters (emoji in comments, etc.)
  // survive. Then base64-encode the bytes and make it URL-safe.
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export interface UrlState {
  mode: "edit" | "presentation";
  circuitJson: string | null;
  template: string | null;
  lexiconUrl: string | null;
}

export function readUrlState(search = window.location.search): UrlState {
  const p = new URLSearchParams(search);
  const c = p.get("c");
  return {
    mode: p.get("mode") === "presentation" ? "presentation" : "edit",
    circuitJson: c ? safeDecode(c) : null,
    template: p.get("template"),
    lexiconUrl: p.get("lexicon"),
  };
}

function safeDecode(s: string): string | null {
  try {
    return decodeBase64(s);
  } catch {
    return null;
  }
}

/**
 * Serialize a circuit handle into a share URL. Exports the circuit via
 * `exportLensJson` and base64s it into the `?c` param.
 */
export function buildShareUrl(circuitHandle: number | null): string {
  const base = typeof window === "undefined"
    ? "http://localhost/"
    : `${window.location.origin}${window.location.pathname}`;
  const p = new URLSearchParams();
  p.set("mode", "presentation");
  if (circuitHandle !== null) {
    try {
      const json = wasm.exportLensJson(circuitHandle);
      p.set("c", encodeBase64(json));
    } catch {
      // Silently skip — share URL will still carry mode.
    }
  }
  return `${base}?${p.toString()}`;
}
