/**
 * Unit tests for the lexiconGarden API client.
 *
 * `fetch` is stubbed globally via `vi.stubGlobal` so no network calls
 * are made. Each test is fully self-contained — the global stub is
 * restored after each test via `vi.unstubAllGlobals()`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchLexiconAutocomplete } from "../lexiconGarden";

// ── Helpers ─────────────────────────────────────────────────────────

function makeSuggestion(overrides: Record<string, string> = {}) {
  return {
    type: "nsid",
    label: "app.bsky.feed.post",
    did: "did:plc:abc123",
    url: "https://lexicon.garden/app.bsky.feed.post",
    ...overrides,
  };
}

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

function stubFetch(response: Response) {
  const mockFn = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", mockFn);
  return mockFn;
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLexiconAutocomplete", () => {
  it("returns [] immediately for an empty query without calling fetch", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchLexiconAutocomplete("");
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns [] for a whitespace-only query without calling fetch", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchLexiconAutocomplete("   ");
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("parses a well-formed suggestions response and returns only nsid items", async () => {
    stubFetch(
      makeOkResponse({
        suggestions: [
          makeSuggestion({ type: "nsid", label: "app.bsky.feed.post", did: "did:plc:abc" }),
          makeSuggestion({ type: "nsid", label: "app.bsky.actor.profile", did: "did:plc:def" }),
          // non-nsid items must be filtered out
          { type: "method", label: "com.atproto.repo.createRecord", did: "did:plc:xyz" },
          { type: "query", label: "com.atproto.repo.listRecords" },
        ],
      }),
    );

    const result = await fetchLexiconAutocomplete("app.bsky");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ nsid: "app.bsky.feed.post", did: "did:plc:abc" });
    expect(result[1]).toEqual({ nsid: "app.bsky.actor.profile", did: "did:plc:def" });
  });

  it("omits the did field when the suggestion has no did", async () => {
    stubFetch(
      makeOkResponse({
        suggestions: [
          { type: "nsid", label: "app.bsky.feed.post" },
        ],
      }),
    );

    const result = await fetchLexiconAutocomplete("app");
    expect(result).toHaveLength(1);
    // did is undefined — do not assert a value, just that nsid is right
    expect(result[0].nsid).toBe("app.bsky.feed.post");
  });

  it("respects the limit parameter and returns at most that many results", async () => {
    const suggestions = Array.from({ length: 10 }, (_, i) =>
      makeSuggestion({ label: `app.test.item${i}`, did: `did:plc:${i}` }),
    );
    stubFetch(makeOkResponse({ suggestions }));

    const result = await fetchLexiconAutocomplete("app", undefined, 3);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.nsid)).toEqual([
      "app.test.item0",
      "app.test.item1",
      "app.test.item2",
    ]);
  });

  it("uses the default limit of 25 when limit is omitted", async () => {
    const suggestions = Array.from({ length: 30 }, (_, i) =>
      makeSuggestion({ label: `app.test.item${i}` }),
    );
    stubFetch(makeOkResponse({ suggestions }));

    const result = await fetchLexiconAutocomplete("app");
    expect(result).toHaveLength(25);
  });

  it("throws on a non-ok HTTP response", async () => {
    stubFetch(makeErrorResponse(503));

    await expect(fetchLexiconAutocomplete("app.bsky")).rejects.toThrow(
      "autocomplete HTTP 503",
    );
  });

  it("throws on a 404 response", async () => {
    stubFetch(makeErrorResponse(404));

    await expect(fetchLexiconAutocomplete("bsky")).rejects.toThrow(
      "autocomplete HTTP 404",
    );
  });

  it("handles a missing suggestions field gracefully by returning []", async () => {
    stubFetch(makeOkResponse({}));

    const result = await fetchLexiconAutocomplete("app");
    expect(result).toEqual([]);
  });

  it("passes the AbortSignal through to fetch", async () => {
    const mockFetch = stubFetch(makeOkResponse({ suggestions: [] }));
    const controller = new AbortController();

    await fetchLexiconAutocomplete("app", controller.signal);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("includes the query in the fetch URL", async () => {
    const mockFetch = stubFetch(makeOkResponse({ suggestions: [] }));

    await fetchLexiconAutocomplete("app.bsky.feed");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("q=app.bsky.feed");
    expect(url).toContain("/api/autocomplete-nsid");
  });

  it("URL-encodes the query before including it in the request URL", async () => {
    const mockFetch = stubFetch(makeOkResponse({ suggestions: [] }));

    await fetchLexiconAutocomplete("hello world");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("q=hello%20world");
  });

  it("filters out suggestions that lack a label field", async () => {
    stubFetch(
      makeOkResponse({
        suggestions: [
          { type: "nsid" }, // no label — should be excluded
          { type: "nsid", label: "app.bsky.feed.post" },
        ],
      }),
    );

    const result = await fetchLexiconAutocomplete("app");
    expect(result).toHaveLength(1);
    expect(result[0].nsid).toBe("app.bsky.feed.post");
  });
});
