// Publish a circuit's lens to the signed-in user's PDS.
//
// A `dev.panproto.schema.lens` record requires `sourceSchema` and
// `targetSchema` as at-uris, so publishing a lens means publishing the two
// `dev.panproto.schema.schema` records it points at first — unless the user
// already has records for them, in which case we reuse those. The whole
// operation is therefore up to three record writes and three blob uploads.
//
// Every blob is `application/x-msgpack`; that is the only type either
// lexicon accepts, and the only blob scope protolab requests.

import type { Agent } from "@atproto/api";
import { activeAgent } from "./oauth";
import { useSessionsStore } from "./store";
import { grantedScopes } from "./types";
import { missingPublishScopes } from "./scopes";
import { WRITTEN_COLLECTIONS } from "./scopes";
import {
  schemaMsgpack,
  schemaObjectHash,
  lensMsgpack,
  blake3Hex,
  getSchemaDetails,
} from "../wasm/bridge";

const MSGPACK_MIME = "application/x-msgpack";

export class PublishError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PublishError";
    this.cause = cause;
  }
}

export interface PublishedRef {
  uri: string;
  cid: string;
  /** True when an existing record was reused instead of written. */
  reused: boolean;
}

export interface LensPublishResult {
  lens: PublishedRef;
  source: PublishedRef;
  target: PublishedRef;
}

/** Options for a lens publish. */
export interface PublishLensOptions {
  circuitHandle: number;
  sourceSchemaHandle: number;
  targetSchemaHandle: number;
  /** Optic class of the composed chain, recorded on the lens. */
  roundTripClass?: "iso" | "retraction" | "projection" | "opaque";
  /** Whether protolab verified the round-trip laws for this chain. */
  lawsVerified?: boolean;
}

/**
 * Publish a lens and the schemas it references.
 *
 * Schemas are content-addressed by panproto's object id, so republishing an
 * unchanged schema is a no-op: we look for an existing record with the same
 * `objectHash` and reuse its at-uri rather than writing a duplicate.
 */
export async function publishLens(
  opts: PublishLensOptions,
): Promise<LensPublishResult> {
  const agent = await activeAgent();
  if (!agent) {
    throw new PublishError(
      "No active session. Sign in to a PDS before publishing a lens.",
    );
  }
  const did = useSessionsStore.getState().activeDid;
  if (!did) throw new PublishError("Session lost between checks.");

  const session = useSessionsStore.getState().sessions[did];
  const missing = missingPublishScopes(grantedScopes(session));
  if (missing.length > 0) {
    throw new PublishError(
      `This session is missing ${missing.join(", ")}. Sign in again with the "Author" intent to publish.`,
    );
  }

  const source = await ensureSchemaRecord(agent, did, opts.sourceSchemaHandle);
  const target = await ensureSchemaRecord(agent, did, opts.targetSchemaHandle);

  const blob = lensMsgpack(opts.circuitHandle, source.uri, target.uri);
  const objectHash = blake3Hex(blob);

  // Reuse an identical lens rather than piling up duplicates on every click.
  const existing = await findByObjectHash(
    agent,
    did,
    WRITTEN_COLLECTIONS.LENS,
    objectHash,
  );
  if (existing) return { lens: { ...existing, reused: true }, source, target };

  const blobRef = await uploadMsgpack(agent, blob);
  const record: Record<string, unknown> = {
    $type: WRITTEN_COLLECTIONS.LENS,
    sourceSchema: source.uri,
    targetSchema: target.uri,
    objectHash,
    blob: blobRef,
    createdAt: new Date().toISOString(),
  };
  if (opts.roundTripClass) record.roundTripClass = opts.roundTripClass;
  if (opts.lawsVerified !== undefined) record.lawsVerified = opts.lawsVerified;

  const written = await createRecord(agent, did, WRITTEN_COLLECTIONS.LENS, record);
  return { lens: { ...written, reused: false }, source, target };
}

/**
 * Return the at-uri of a `dev.panproto.schema.schema` record for this
 * schema, writing one only if the user does not already have a record with
 * the same object hash.
 */
async function ensureSchemaRecord(
  agent: Agent,
  did: string,
  schemaHandle: number,
): Promise<PublishedRef> {
  const objectHash = schemaObjectHash(schemaHandle);
  const existing = await findByObjectHash(
    agent,
    did,
    WRITTEN_COLLECTIONS.SCHEMA,
    objectHash,
  );
  if (existing) return { ...existing, reused: true };

  const details = getSchemaDetails(schemaHandle);
  const blob = schemaMsgpack(schemaHandle);
  const blobRef = await uploadMsgpack(agent, blob);

  // The counts are denormalized onto the record so a library view can show
  // a schema's shape without fetching and decoding its blob.
  const constraintCount = details.vertices.reduce(
    (n, v) => n + (v.constraints?.length ?? 0),
    0,
  );

  const written = await createRecord(agent, did, WRITTEN_COLLECTIONS.SCHEMA, {
    $type: WRITTEN_COLLECTIONS.SCHEMA,
    protocol: details.protocol,
    objectHash,
    vertexCount: details.vertices.length,
    edgeCount: details.edges.length,
    constraintCount,
    blob: blobRef,
    createdAt: new Date().toISOString(),
  });
  return { ...written, reused: false };
}

/** Upload a MessagePack blob and return the blob ref for a record. */
async function uploadMsgpack(agent: Agent, bytes: Uint8Array): Promise<unknown> {
  try {
    const out = await agent.com.atproto.repo.uploadBlob(bytes, {
      encoding: MSGPACK_MIME,
    });
    return out.data.blob;
  } catch (e) {
    throw new PublishError(
      `Blob upload failed: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
}

async function createRecord(
  agent: Agent,
  repo: string,
  collection: string,
  record: Record<string, unknown>,
): Promise<{ uri: string; cid: string }> {
  try {
    const out = await agent.com.atproto.repo.createRecord({
      repo,
      collection,
      record,
    });
    return { uri: out.data.uri, cid: out.data.cid };
  } catch (e) {
    throw new PublishError(
      `Writing ${collection} failed: ${e instanceof Error ? e.message : String(e)}`,
      e,
    );
  }
}

/**
 * Find an existing record in `collection` whose `objectHash` matches.
 *
 * Content addressing makes this safe: same hash means same object, so
 * reusing the record is correct rather than merely convenient. Listing is
 * an unauthenticated public read, so it costs no scope.
 */
async function findByObjectHash(
  agent: Agent,
  repo: string,
  collection: string,
  objectHash: string,
): Promise<{ uri: string; cid: string } | null> {
  let cursor: string | undefined;
  try {
    do {
      const page = await agent.com.atproto.repo.listRecords({
        repo,
        collection,
        limit: 100,
        cursor,
      });
      for (const rec of page.data.records) {
        const value = rec.value as { objectHash?: string };
        if (value?.objectHash === objectHash) {
          return { uri: rec.uri, cid: rec.cid };
        }
      }
      cursor = page.data.cursor;
    } while (cursor);
  } catch {
    // A missing collection 400s on some PDS implementations; treat any
    // lookup failure as "no match" and write a fresh record.
    return null;
  }
  return null;
}
