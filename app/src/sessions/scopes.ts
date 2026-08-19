// atproto OAuth scopes for protolab.
//
// protolab is a lens authoring surface. The only things it writes to a
// user's repo are the two panproto record types a published lens is made
// of, so those are the only scopes it asks for. We use atproto's granular
// scope spec (`repo:` / `blob:`) rather than the broad transitional
// `transition:generic` grant, which would let protolab create, update, and
// delete *any* record in the repo.
//
// Reads need no scope: `com.atproto.repo.listRecords` and `getRecord`
// against a public repo are unauthenticated, so browsing a lens library —
// the user's own or anyone else's — costs nothing in the grant. There are
// no `rpc:`, `identity:`, or `account:` scopes for the same reason: we
// only touch the signed-in user's own repo.
//
// References:
// - https://atproto.com/specs/oauth
// - grain-editor's `src/oauthScope.js` (the minimal-scope pattern we follow)

/** atproto base scope; always required. */
export const ATPROTO_BASE_SCOPE = "atproto";

/**
 * The collections protolab creates records in.
 *
 * A `dev.panproto.schema.lens` record requires `sourceSchema` and
 * `targetSchema` as at-uris, so publishing a lens means publishing (or
 * reusing) the two `dev.panproto.schema.schema` records it points at.
 * Asking for the lens scope alone would let protolab write a record it
 * cannot populate.
 */
export const WRITTEN_COLLECTIONS = {
  LENS: "dev.panproto.schema.lens",
  SCHEMA: "dev.panproto.schema.schema",
} as const;

/** One `repo:` scope per written collection (covers create/update/delete). */
export const REPO_SCOPES = {
  LENS: `repo:${WRITTEN_COLLECTIONS.LENS}`,
  SCHEMA: `repo:${WRITTEN_COLLECTIONS.SCHEMA}`,
} as const;

/**
 * Blob upload scope, narrowed to the one MIME type the lexicons accept.
 *
 * Both record types carry `{"type": "blob", "accept":
 * ["application/x-msgpack"]}`, so a wildcard `blob:*` / `blob:*​/*` would
 * grant strictly more than protolab can use.
 */
export const BLOB_SCOPE = "blob:application/x-msgpack";

/**
 * Permission tiers protolab offers at sign-in.
 *
 * - `read-only`; browse and evaluate lenses, no publish capability. The
 *   library still works — public repo reads are unauthenticated — so this
 *   is a real tier, not a degraded one.
 * - `author`; publish lenses and the schemas they reference. The default.
 */
export type AuthIntent = "read-only" | "author";

const AUTHOR_SCOPES = [REPO_SCOPES.SCHEMA, REPO_SCOPES.LENS, BLOB_SCOPE];

/** Every scope protolab might ever request, for client-metadata + dev. */
export const ALL_DECLARED_SCOPES = [ATPROTO_BASE_SCOPE, ...AUTHOR_SCOPES];

/**
 * The space-separated scope string to request for `intent`.
 *
 * Always includes `atproto`. `read-only` adds nothing to it.
 */
export function getScopesForIntent(intent: AuthIntent): string {
  const parts = [ATPROTO_BASE_SCOPE];
  if (intent === "author") parts.push(...AUTHOR_SCOPES);
  return parts.join(" ");
}

/**
 * True if the granted scopes satisfy `required`.
 *
 * `transition:generic` is treated as a wildcard: a session minted before
 * granular scopes existed carries it and can in fact write anything.
 */
export function hasScope(
  grantedScopes: readonly string[],
  required: string,
): boolean {
  if (grantedScopes.includes("transition:generic")) return true;
  return grantedScopes.includes(required);
}

/**
 * The scopes a publish needs, or the subset of them that is missing from
 * `granted`. Used by the publish button to explain itself before the PDS
 * rejects the write.
 *
 * An empty `granted` means the library has not surfaced the grant yet; we
 * report nothing missing and let the PDS be the authority.
 */
export function missingPublishScopes(
  granted: readonly string[],
): readonly string[] {
  if (granted.length === 0) return [];
  return AUTHOR_SCOPES.filter((s) => !hasScope(granted, s));
}
