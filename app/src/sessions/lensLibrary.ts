// Read a repo's published lenses.
//
// Listing records is a public, unauthenticated read, so a library can be
// browsed for any DID — the signed-in user's own or someone else's — and
// costs nothing in the OAuth grant. That is why this module talks to the
// PDS over plain fetch rather than through an authenticated `Agent`: a
// library view must work before anyone signs in.

const LENS_NSID = "dev.panproto.schema.lens";
const SCHEMA_NSID = "dev.panproto.schema.schema";

/** A `dev.panproto.schema.lens` record as listed from a repo. */
export interface LensRecord {
  uri: string;
  cid: string;
  rkey: string;
  sourceSchema: string;
  targetSchema: string;
  objectHash: string;
  roundTripClass?: "iso" | "retraction" | "projection" | "opaque";
  lawsVerified?: boolean;
  createdAt: string;
}

/** A `dev.panproto.schema.schema` record, for resolving a lens's endpoints. */
export interface SchemaRecord {
  uri: string;
  protocol: string;
  objectHash: string;
  vertexCount?: number;
  edgeCount?: number;
  constraintCount?: number;
  createdAt: string;
}

export class LibraryError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "LibraryError";
  }
}

/**
 * Resolve a DID's PDS endpoint from its DID document.
 *
 * `did:plc:*` resolves through plc.directory; `did:web:*` serves its own
 * document at a well-known path. Both are open-CORS.
 */
export async function resolvePds(did: string): Promise<string> {
  const url = did.startsWith("did:web:")
    ? `https://${did.slice("did:web:".length).replace(/:/g, "/")}/.well-known/did.json`
    : `https://plc.directory/${did}`;
  const r = await fetch(url);
  if (!r.ok) throw new LibraryError(`Could not resolve ${did} (HTTP ${r.status})`);
  const doc: { service?: Array<{ id: string; serviceEndpoint: string }> } =
    await r.json();
  const svc = doc.service?.find((s) => s.id === "#atproto_pds");
  if (!svc?.serviceEndpoint) {
    throw new LibraryError(`${did} has no #atproto_pds service endpoint`);
  }
  return svc.serviceEndpoint.replace(/\/$/, "");
}

interface ListedRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

/** Page through `com.atproto.repo.listRecords` for one collection. */
async function listAll(
  pds: string,
  did: string,
  collection: string,
): Promise<ListedRecord[]> {
  const out: ListedRecord[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({
      repo: did,
      collection,
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);
    const r = await fetch(
      `${pds}/xrpc/com.atproto.repo.listRecords?${params.toString()}`,
    );
    if (r.status === 400) {
      // An empty or absent collection 400s on some implementations.
      return out;
    }
    if (!r.ok) {
      throw new LibraryError(`listRecords ${collection} failed (HTTP ${r.status})`);
    }
    const page = (await r.json()) as {
      records?: ListedRecord[];
      cursor?: string;
    };
    out.push(...(page.records ?? []));
    cursor = page.cursor;
  } while (cursor);
  return out;
}

function rkeyOf(uri: string): string {
  return uri.split("/").pop() ?? "";
}

/** Every lens published by `did`, newest first. */
export async function listLenses(
  did: string,
  pdsUrl?: string,
): Promise<LensRecord[]> {
  const pds = pdsUrl ?? (await resolvePds(did));
  const records = await listAll(pds, did, LENS_NSID);
  return records
    .map((r) => {
      const v = r.value as Partial<LensRecord>;
      return {
        uri: r.uri,
        cid: r.cid,
        rkey: rkeyOf(r.uri),
        sourceSchema: v.sourceSchema ?? "",
        targetSchema: v.targetSchema ?? "",
        objectHash: v.objectHash ?? "",
        roundTripClass: v.roundTripClass,
        lawsVerified: v.lawsVerified,
        createdAt: v.createdAt ?? "",
      } satisfies LensRecord;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Every schema published by `did`, keyed by at-uri, so a lens list can show
 * what its endpoints actually are instead of raw at-uris.
 */
export async function listSchemas(
  did: string,
  pdsUrl?: string,
): Promise<Map<string, SchemaRecord>> {
  const pds = pdsUrl ?? (await resolvePds(did));
  const records = await listAll(pds, did, SCHEMA_NSID);
  const map = new Map<string, SchemaRecord>();
  for (const r of records) {
    const v = r.value as Partial<SchemaRecord>;
    map.set(r.uri, {
      uri: r.uri,
      protocol: v.protocol ?? "unknown",
      objectHash: v.objectHash ?? "",
      vertexCount: v.vertexCount,
      edgeCount: v.edgeCount,
      constraintCount: v.constraintCount,
      createdAt: v.createdAt ?? "",
    });
  }
  return map;
}

/** A lens together with whatever we know about its two endpoints. */
export interface LensWithSchemas {
  lens: LensRecord;
  source?: SchemaRecord;
  target?: SchemaRecord;
}

/**
 * A DID's whole lens library, endpoints resolved in one pass.
 *
 * Both collections are fetched together because a lens list is close to
 * unreadable without the schemas: `at://did:plc:…/dev.panproto.schema.schema/3k…`
 * tells a user nothing, `atproto → openapi` tells them what the lens is for.
 */
export async function loadLibrary(did: string, pdsUrl?: string): Promise<LensWithSchemas[]> {
  const pds = pdsUrl ?? (await resolvePds(did));
  const [lenses, schemas] = await Promise.all([
    listLenses(did, pds),
    listSchemas(did, pds),
  ]);
  return lenses.map((lens) => ({
    lens,
    source: schemas.get(lens.sourceSchema),
    target: schemas.get(lens.targetSchema),
  }));
}

/** Web URL for a lens record, for linking out to protolab. */
export function protolabUrlForLens(uri: string, base = "https://panproto.dev/protolab/"): string {
  return `${base}?lens=${encodeURIComponent(uri)}`;
}
