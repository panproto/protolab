// Per-DID session state.
//
// protolab supports authenticating several atproto identities at once. A
// lens is a piece of shared infrastructure as often as it is a personal
// artifact, so the same person may want to publish one under a personal
// DID and another under an organization's. Sessions are keyed by DID and
// the active one is what a publish writes to.

export interface Session {
  /** atproto DID this session authenticates (`did:plc:...`). */
  did: string;
  /** Human-friendly handle as resolved at sign-in time. */
  handle?: string;
  /** Avatar URL from the user's bsky profile, when resolvable. */
  avatar?: string;
  /** Display name from the user's bsky profile, when resolvable. */
  displayName?: string;
  /** Base URL of the user's PDS (resolved from the DID document). */
  pdsUrl: string;
  /** Display label; falls back to handle, then DID. */
  label: string;
  /** Time the access token expires (ms since epoch), when known. */
  expiresAt: number | null;
  /**
   * Granted OAuth scope string (space-separated). `null` when the library
   * has not surfaced it yet; the publish-side guard treats that as "let
   * the PDS decide" and skips its early warning.
   */
  scope: string | null;
}

/** Split a session's granted scope string into individual scopes. */
export function grantedScopes(session: Session | undefined): string[] {
  return session?.scope?.split(/\s+/).filter(Boolean) ?? [];
}
