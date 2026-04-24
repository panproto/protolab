/**
 * Load and query the precomputed auto-lens compatibility snapshot.
 *
 * Build-time, the `protolab-snapshot` rust binary crawls
 * lexicon.garden, loads every NSID's lexicon, runs panproto's
 * auto-generator pairwise at Balanced stringency, and writes the
 * working pairs to `app/public/auto-lens-snapshot.json`. At
 * runtime, the schema import autocomplete shows a colored chip per
 * suggestion indicating whether the (assigned ↔ suggestion) pair
 * is known to produce a usable lens.
 *
 * The snapshot is sparse: only pairs that actually work appear in
 * `pairs`. Failing pairs are inferred by absence — iff both NSIDs
 * are in `schemas`, a missing pair means "computed, no lens";
 * if either NSID isn't in `schemas`, the answer is "unknown"
 * (probably a lexicon added after the snapshot ran, or a user-
 * imported custom schema).
 */

export interface SnapshotSchema {
  nsid: string;
  vertex_count: number;
}

export interface SnapshotPair {
  src: string;
  tgt: string;
  status: "works";
  coverage: number | null;
  chain_length: number | null;
  elapsed_ms: number;
}

export interface Snapshot {
  generated_at: string;
  panproto_version: string;
  stringency: string;
  coverage_threshold: number;
  schemas: SnapshotSchema[];
  pairs: SnapshotPair[];
}

export type PairStatus =
  | "works" // snapshot says a non-degenerate lens exists
  | "no-lens" // both NSIDs in snapshot but the pair is absent (we computed it; it failed)
  | "unknown"; // at least one NSID not in snapshot

interface SnapshotIndex {
  meta: Pick<Snapshot, "generated_at" | "panproto_version" | "stringency" | "coverage_threshold">;
  schemaCount: number;
  knownNsids: Set<string>;
  works: Set<string>; // "src|tgt"
}

function indexKey(src: string, tgt: string): string {
  return `${src}|${tgt}`;
}

function build(snapshot: Snapshot): SnapshotIndex {
  const knownNsids = new Set<string>();
  for (const s of snapshot.schemas) knownNsids.add(s.nsid);
  const works = new Set<string>();
  for (const p of snapshot.pairs) works.add(indexKey(p.src, p.tgt));
  return {
    meta: {
      generated_at: snapshot.generated_at,
      panproto_version: snapshot.panproto_version,
      stringency: snapshot.stringency,
      coverage_threshold: snapshot.coverage_threshold,
    },
    schemaCount: snapshot.schemas.length,
    knownNsids,
    works,
  };
}

export interface LoadedSnapshot {
  readonly meta: SnapshotIndex["meta"];
  readonly schemaCount: number;
  readonly knownNsidCount: number;
  status(src: string | null, tgt: string | null): PairStatus;
  isKnown(nsid: string): boolean;
}

function wrap(index: SnapshotIndex): LoadedSnapshot {
  return {
    meta: index.meta,
    schemaCount: index.schemaCount,
    knownNsidCount: index.knownNsids.size,
    status(src, tgt) {
      if (!src || !tgt) return "unknown";
      if (!index.knownNsids.has(src) || !index.knownNsids.has(tgt)) {
        return "unknown";
      }
      return index.works.has(indexKey(src, tgt)) ? "works" : "no-lens";
    },
    isKnown(nsid: string) {
      return index.knownNsids.has(nsid);
    },
  };
}

const EMPTY_INDEX: SnapshotIndex = {
  meta: {
    generated_at: "",
    panproto_version: "",
    stringency: "",
    coverage_threshold: 0,
  },
  schemaCount: 0,
  knownNsids: new Set(),
  works: new Set(),
};

export const EMPTY_SNAPSHOT: LoadedSnapshot = wrap(EMPTY_INDEX);

let cached: Promise<LoadedSnapshot> | null = null;

/**
 * Fetch and memoize the snapshot. Safe to call repeatedly.
 * Returns `EMPTY_SNAPSHOT` if the fetch fails — callers already
 * treat "unknown" as the benign default, so an absent snapshot
 * degrades to "no indicators shown."
 *
 * The default URL is `${BASE_URL}auto-lens-snapshot.json`, which
 * resolves to `/auto-lens-snapshot.json` in dev and
 * `/protolab/auto-lens-snapshot.json` after a production build;
 * both paths serve out of `app/public/` under Vite's default
 * static-asset rules.
 */
export function loadAutoLensSnapshot(
  url = `${import.meta.env.BASE_URL ?? "/"}auto-lens-snapshot.json`,
): Promise<LoadedSnapshot> {
  if (cached !== null) return cached;
  cached = fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<Snapshot>) : null))
    .then((s) => (s ? wrap(build(s)) : EMPTY_SNAPSHOT))
    .catch(() => EMPTY_SNAPSHOT);
  return cached;
}

// Test hook; lets the snapshot be injected synchronously.
export function __setSnapshotForTest(snapshot: Snapshot | null): void {
  cached = Promise.resolve(snapshot ? wrap(build(snapshot)) : EMPTY_SNAPSHOT);
}
