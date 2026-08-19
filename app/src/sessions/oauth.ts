// atproto OAuth client for protolab.
//
// Wraps `@atproto/oauth-client-browser` so the rest of the app never
// imports it directly. The library owns PAR, PKCE, DPoP, IndexedDB session
// storage, and refresh-token rotation; protolab owns scope selection, the
// post-callback sync into the sessions store, and the `Agent` that writes
// records.
//
// References:
// - https://atproto.com/specs/oauth

import {
  AtprotoDohHandleResolver,
  BrowserOAuthClient,
  type OAuthSession,
} from "@atproto/oauth-client-browser";
import { Agent } from "@atproto/api";
import { ALL_DECLARED_SCOPES, getScopesForIntent } from "./scopes";
import type { AuthIntent } from "./scopes";
import { useSessionsStore } from "./store";
import type { Session } from "./types";

// Loopback dev: the synthesized `http://localhost` client_id has to declare
// the union of every scope protolab might request, so the auth server will
// permit whichever per-intent subset we name at signIn time. Without it the
// granular `repo:dev.panproto.*` scopes are rejected as undeclared.
const LOOPBACK_DECLARED_SCOPES = ALL_DECLARED_SCOPES.join(" ");

const handleResolver = new AtprotoDohHandleResolver({
  dohEndpoint: "https://dns.google/resolve",
});

/**
 * Resolve protolab's OAuth client id.
 *
 * - Loopback dev (localhost / 127.0.0.1 / [::1]); atproto OAuth requires
 *   the literal `http://localhost` with no port and no path. The real port
 *   travels in `redirect_uri` instead.
 * - Production; the URL of the deployed client-metadata.json.
 */
function getClientId(): string {
  if (typeof window === "undefined") {
    return "https://panproto.dev/protolab/oauth/client-metadata.json";
  }
  const url = new URL(window.location.origin);
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  ) {
    // Mirror production: redirect_uri is the SPA root, not a separate
    // callback page. The library matches `location.pathname` against the
    // registered redirect_uri, so the token exchange only runs when the
    // auth server lands us back on that same path.
    //
    // The host must be the loopback *IP*, not the name: RFC 8252 §8.3
    // disallows `localhost` in a redirect_uri (it can resolve off-machine),
    // and @atproto/oauth-client-browser enforces that — passing
    // `http://localhost:3001/` throws "Use of localhost hostname is not
    // allowed". The client_id itself still has to be the literal
    // `http://localhost`, which is why only the redirect is rewritten.
    //
    // Consequence for dev: open the app at http://127.0.0.1:<port>/, not
    // http://localhost:<port>/, or the auth server redirects to an origin
    // this tab is not on and the exchange never runs.
    const redirect = `http://127.0.0.1:${window.location.port}${import.meta.env.BASE_URL}`;
    const params = new URLSearchParams({
      redirect_uri: redirect,
      scope: LOOPBACK_DECLARED_SCOPES,
    });
    return `http://localhost?${params.toString()}`;
  }
  return `${window.location.origin}${import.meta.env.BASE_URL}oauth/client-metadata.json`;
}

let _client: BrowserOAuthClient | null = null;
let _initPromise: Promise<BrowserOAuthClient> | null = null;

export async function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (_client) return _client;
  if (_initPromise) return _initPromise;
  _initPromise = BrowserOAuthClient.load({
    clientId: getClientId(),
    handleResolver,
  }).then((client) => {
    _client = client;
    return client;
  });
  return _initPromise;
}

/**
 * Initialise the client and adopt any session waiting in IndexedDB, plus
 * complete the callback exchange when we have just been redirected back.
 * Call once on boot.
 *
 * Only the session the library resumes is synced. Other DIDs already in the
 * store keep their persisted display metadata and are restored lazily by
 * {@link agentFor}.
 */
let _resumePromise: Promise<OAuthSession | null> | null = null;

export async function resumeSession(): Promise<OAuthSession | null> {
  // Memoized because `client.init()` consumes the one-time authorization
  // code in the callback URL, and protolab mounts `SessionMenu` twice on a
  // cold boot: the app starts in edit mode, then switches to presentation
  // mode, unmounting one toolbar and mounting the other. Two concurrent
  // `init()` calls race for the same code and one of them loses.
  if (_resumePromise) return _resumePromise;
  _resumePromise = (async () => {
    const client = await getOAuthClient();
    const result = await client.init();
    if (!result) return null;
    const session = "session" in result ? result.session : result;
    await syncSessionToStore(session);
    // A fresh sign-in should become the session you publish under.
    useSessionsStore.getState().setActiveDid(session.did);
    return session;
  })();
  return _resumePromise;
}

/**
 * Begin the sign-in flow. Navigates away to the user's auth server; under
 * the happy path this promise never resolves.
 */
export async function startSignIn(
  handle: string,
  intent: AuthIntent,
): Promise<void> {
  const client = await getOAuthClient();
  await client.signIn(handle, { scope: getScopesForIntent(intent) });
}

/**
 * Sign out one DID, removing it from IndexedDB and from the sessions
 * store. If it was the active DID, the store rotates the active pointer to
 * whatever is still signed in.
 */
export async function signOut(did: string): Promise<void> {
  const client = await getOAuthClient();
  try {
    const session = await client.restore(did);
    await session.signOut();
  } catch {
    // Already gone server-side; clearing local state still matters.
  }
  useSessionsStore.getState().removeSession(did);
}

/**
 * An authenticated `Agent` for a specific DID, or `null` if the session
 * cannot be restored (expired past refresh, or revoked).
 */
export async function agentFor(did: string): Promise<Agent | null> {
  const client = await getOAuthClient();
  try {
    const session = await client.restore(did);
    // Mirror the freshest token state back so the UI shows real expiry.
    await syncSessionToStore(session);
    return new Agent(session);
  } catch (e) {
    console.warn("could not restore session", did, e);
    return null;
  }
}

/** An authenticated `Agent` for the active DID, or `null`. */
export async function activeAgent(): Promise<Agent | null> {
  const did = useSessionsStore.getState().activeDid;
  if (!did) return null;
  return agentFor(did);
}

/**
 * Pull the bits protolab displays out of an `OAuthSession` and write them
 * into the sessions store. Every lookup here is best-effort: a failure
 * degrades the badge, never the sign-in.
 */
async function syncSessionToStore(session: OAuthSession): Promise<void> {
  const did = session.did;

  // Record the session *before* enriching it. Everything below is a
  // best-effort lookup against a remote service, and an authenticated
  // session whose profile lookup failed is still an authenticated
  // session — it can publish. Enriching first meant a single throw
  // anywhere in here (a rejected `new Agent`, an offline AppView) left a
  // successfully authenticated user reading as signed out, with the
  // library's IndexedDB holding a live session that nothing surfaced.
  useSessionsStore.getState().upsertSession({
    did,
    pdsUrl: "",
    label: did,
    expiresAt: null,
    scope: null,
  });

  let agent: Agent;
  try {
    agent = new Agent(session);
  } catch (e) {
    console.warn("could not build an Agent for", did, e);
    return;
  }

  let handle: string | undefined;
  let avatar: string | undefined;
  let displayName: string | undefined;
  let pdsUrl = "";

  try {
    const repo = await agent.com.atproto.repo.describeRepo({ repo: did });
    handle = repo.data.handle;
  } catch {
    // Fall through with whatever we already have.
  }

  // Resolve the PDS from the DID document. plc.directory serves the
  // canonical doc for did:plc:* and is open-CORS.
  try {
    const r = await fetch(`https://plc.directory/${did}`);
    if (r.ok) {
      const doc: { service?: Array<{ id: string; serviceEndpoint: string }> } =
        await r.json();
      const svc = doc.service?.find((s) => s.id === "#atproto_pds");
      if (svc?.serviceEndpoint) pdsUrl = svc.serviceEndpoint.replace(/\/$/, "");
    }
  } catch {
    // Leave pdsUrl empty; callers show a placeholder.
  }

  // Avatar and display name come from bsky's public AppView. The user's PDS
  // does not necessarily proxy app.bsky.* calls, and this data is public
  // anyway, so we ask the AppView directly and unauthenticated.
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`;
    const r = await fetch(url);
    if (r.ok) {
      const profile = (await r.json()) as {
        avatar?: string;
        displayName?: string;
        handle?: string;
      };
      avatar = profile.avatar;
      displayName = profile.displayName;
      handle = handle ?? profile.handle;
    }
  } catch {
    // Fall through to the handle-initial avatar.
  }

  // Granted scope + expiry drive the publish-side guard.
  let scope: string | null = null;
  let expiresAt: number | null = null;
  try {
    const info = await session.getTokenInfo("auto");
    scope = info.scope ?? null;
    expiresAt = info.expiresAt?.getTime() ?? null;
  } catch {
    // Guard falls back to letting the PDS decide.
  }

  // Patch rather than replace: the minimal record written above already
  // established the session, and `patchSession` leaves it alone if it has
  // since been signed out from another tab.
  const enriched: Partial<Session> = {
    handle,
    avatar,
    displayName,
    pdsUrl,
    label: handle ?? did,
    expiresAt,
    scope,
  };
  useSessionsStore.getState().patchSession(did, enriched);
}
