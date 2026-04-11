/**
 * Canonical example records for common atproto NSIDs, used to seed the
 * `InputJsonWidget` when a Lexicon Mapper imports a schema. These
 * examples come from lexicon.garden's own documentation (`/llms.txt`)
 * and the upstream atproto spec.
 *
 * The goal is to make "resolve `app.bsky.feed.post` → click Run" a
 * one-shot demo without requiring the user to know what a valid record
 * looks like. NSIDs not in this table fall through to whatever the
 * user has already typed into the input widget.
 */

export interface LexiconExample {
  nsid: string;
  record: Record<string, unknown>;
}

const EXAMPLES: LexiconExample[] = [
  {
    nsid: "app.bsky.feed.post",
    record: {
      $type: "app.bsky.feed.post",
      text: "Just shipped a bidirectional schema mapper that translates between atproto lexicons using panproto's protolens pipeline. Rename fields, compute derived values, add defaults; the lens runs both ways so you can edit the output and recover the original. Try it at panproto.dev/protolab",
      createdAt: "2026-04-10T14:30:00.000Z",
      langs: ["en"],
      tags: ["panproto", "atproto", "schemas"],
    },
  },
  {
    nsid: "app.bsky.graph.follow",
    record: {
      $type: "app.bsky.graph.follow",
      subject: "did:plc:abc123xyz456exampledid",
      createdAt: "2024-01-15T12:00:00.000Z",
    },
  },
  {
    nsid: "app.bsky.actor.profile",
    record: {
      $type: "app.bsky.actor.profile",
      displayName: "Alice",
      description: "Building cool things with ATProtocol",
    },
  },
  {
    nsid: "app.bsky.feed.like",
    record: {
      $type: "app.bsky.feed.like",
      subject: {
        uri: "at://did:plc:abc/app.bsky.feed.post/3k1b2c3d4e5",
        cid: "bafyreiexamplecidstring",
      },
      createdAt: "2024-01-15T12:00:00.000Z",
    },
  },
  {
    nsid: "app.bsky.feed.repost",
    record: {
      $type: "app.bsky.feed.repost",
      subject: {
        uri: "at://did:plc:abc/app.bsky.feed.post/3k1b2c3d4e5",
        cid: "bafyreiexamplecidstring",
      },
      createdAt: "2024-01-15T12:00:00.000Z",
    },
  },
  {
    nsid: "app.bsky.graph.block",
    record: {
      $type: "app.bsky.graph.block",
      subject: "did:plc:abc123xyz456exampledid",
      createdAt: "2024-01-15T12:00:00.000Z",
    },
  },
];

const BY_NSID: Map<string, Record<string, unknown>> = new Map(
  EXAMPLES.map((e) => [e.nsid, e.record]),
);

/**
 * Look up a canonical example record for an NSID. Returns `null` if no
 * example is bundled — callers should leave the current input data
 * unchanged in that case.
 */
export function exampleRecordForNsid(nsid: string): Record<string, unknown> | null {
  return BY_NSID.get(nsid) ?? null;
}

/** All NSIDs with bundled examples. */
export function knownNsids(): string[] {
  return EXAMPLES.map((e) => e.nsid);
}
