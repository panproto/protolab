/**
 * Client for lexicon.garden's NSID autocomplete and lexicon resolution
 * endpoints.
 *
 * CORS caveat: `/api/autocomplete-nsid` does NOT set
 * `Access-Control-Allow-Origin`, so the browser blocks direct
 * cross-origin reads. In development we proxy through Vite (see
 * `vite.config.ts` `/lexicon-garden` rule). In production a separate
 * proxy is required — or autocomplete will fail and the widget will
 * gracefully fall back to no-suggestions mode. The `/xrpc/` endpoints
 * (used by `resolveLexicon`) DO have open CORS and work directly.
 */

const AUTOCOMPLETE_PATH = "/api/autocomplete-nsid";

/**
 * The base URL for lexicon.garden requests. In dev, Vite proxies
 * `/lexicon-garden/*` to the real host; in prod we try direct fetches
 * and accept that they may fail without a separately-deployed proxy.
 */
function baseUrl(): string {
  if (typeof window === "undefined") return "https://lexicon.garden";
  // Vite dev server runs at :3000 (see vite.config.ts). We detect it
  // by checking for the `/lexicon-garden` proxy path existence
  // implicitly: try it first, and fall back to direct on failure.
  return import.meta.env.DEV ? "/lexicon-garden" : "https://lexicon.garden";
}

/** A single NSID suggestion from the autocomplete endpoint. */
export interface LexiconSuggestion {
  /** Fully-qualified NSID, e.g. `app.bsky.feed.post`. */
  nsid: string;
  /** DID of the authority publishing the lexicon. */
  did?: string;
}

interface AutocompleteResponse {
  suggestions?: Array<{
    type?: string;
    label?: string;
    did?: string;
    url?: string;
  }>;
}

/**
 * Query lexicon.garden's autocomplete endpoint for NSID suggestions
 * matching `query`. Returns at most `limit` suggestions. Throws on
 * network/CORS failure so callers can decide to hide the dropdown.
 */
export async function fetchLexiconAutocomplete(
  query: string,
  signal?: AbortSignal,
  limit = 25,
): Promise<LexiconSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const url = `${baseUrl()}${AUTOCOMPLETE_PATH}?q=${encodeURIComponent(trimmed)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`autocomplete HTTP ${res.status}`);
  }
  const body = (await res.json()) as AutocompleteResponse;
  const raw = body.suggestions ?? [];
  return raw
    .filter((s) => s.type === "nsid" && typeof s.label === "string")
    .slice(0, limit)
    .map((s) => ({ nsid: s.label as string, did: s.did }));
}
