import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_DECLARED_SCOPES,
  ATPROTO_BASE_SCOPE,
  BLOB_SCOPE,
  REPO_SCOPES,
  getScopesForIntent,
  hasScope,
  missingPublishScopes,
} from "../scopes";

const metadata = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../public/oauth/client-metadata.json"),
    "utf8",
  ),
) as { scope: string; redirect_uris: string[]; client_id: string };

describe("scopes", () => {
  it("read-only asks for nothing beyond the base scope", () => {
    expect(getScopesForIntent("read-only")).toBe(ATPROTO_BASE_SCOPE);
  });

  it("author asks for exactly the two written collections plus msgpack blobs", () => {
    const granted = getScopesForIntent("author").split(" ");
    expect(granted).toEqual([
      ATPROTO_BASE_SCOPE,
      REPO_SCOPES.SCHEMA,
      REPO_SCOPES.LENS,
      BLOB_SCOPE,
    ]);
  });

  it("requests no rpc / identity / account scopes", () => {
    // protolab only touches the signed-in user's own repo, and reads public
    // records unauthenticated. Anything in these families would be surplus.
    const granted = getScopesForIntent("author");
    for (const family of ["rpc:", "identity:", "account:"]) {
      expect(granted).not.toContain(family);
    }
  });

  it("narrows the blob scope to the only MIME type the lexicons accept", () => {
    // Both dev.panproto.schema.{lens,schema} declare
    // accept: ["application/x-msgpack"], so a wildcard would over-grant.
    expect(BLOB_SCOPE).toBe("blob:application/x-msgpack");
    expect(getScopesForIntent("author")).not.toContain("blob:*");
  });

  it("never requests the transitional wildcard grant", () => {
    expect(getScopesForIntent("author")).not.toContain("transition:generic");
  });

  // The deployed metadata document is what the auth server actually reads.
  // If it drifts from the code, sign-in fails at the PDS with an opaque
  // "undeclared scope" rather than anywhere we control.
  it("client-metadata.json declares exactly the scopes the code requests", () => {
    expect(metadata.scope.split(" ").sort()).toEqual(
      [...ALL_DECLARED_SCOPES].sort(),
    );
  });

  it("client-metadata.json redirect_uris include the SPA root", () => {
    // oauth.ts registers the SPA root as the redirect target; the library
    // only runs the token exchange when location.pathname matches one.
    expect(metadata.redirect_uris).toContain("https://panproto.dev/protolab/");
  });

  // Every declared redirect is a promise to the authorization server that
  // protolab can receive a code there. protolab handles the callback in the
  // SPA itself and ships no separate callback page, so the SPA root is the
  // only address it can keep that promise at.
  //
  // A `/oauth/callback` entry was declared for one release, copied from
  // fieldwork — which does ship such a page. protolab does not, the deploy
  // has no SPA fallback, and that URL 404s in production. Nothing selected
  // it, because the library matches location.pathname and users start at
  // the root, so it was inert. It was still an advertised address that
  // drops a completed authorization on the floor if anything ever picks it.
  it("declares no redirect protolab cannot serve", () => {
    expect(metadata.redirect_uris).toEqual(["https://panproto.dev/protolab/"]);
  });

  it("every redirect is under the deployed base path", () => {
    // A redirect outside the app's own base path cannot be served by this
    // build regardless of what else is true.
    for (const uri of metadata.redirect_uris) {
      expect(uri.startsWith("https://panproto.dev/protolab/")).toBe(true);
    }
  });

  it("client_id is the metadata document's own URL", () => {
    expect(metadata.client_id).toBe(
      "https://panproto.dev/protolab/oauth/client-metadata.json",
    );
  });
});

describe("hasScope", () => {
  it("matches an exact grant", () => {
    expect(hasScope([REPO_SCOPES.LENS], REPO_SCOPES.LENS)).toBe(true);
  });

  it("rejects a scope that was not granted", () => {
    expect(hasScope([REPO_SCOPES.SCHEMA], REPO_SCOPES.LENS)).toBe(false);
  });

  it("treats transition:generic as a wildcard", () => {
    // Sessions minted before granular scopes carry it and really can write
    // anything, so refusing to publish under one would be wrong.
    expect(hasScope(["transition:generic"], REPO_SCOPES.LENS)).toBe(true);
  });
});

describe("missingPublishScopes", () => {
  it("is empty for a full author grant", () => {
    expect(missingPublishScopes(getScopesForIntent("author").split(" "))).toEqual(
      [],
    );
  });

  it("names every write scope a read-only session lacks", () => {
    expect(missingPublishScopes([ATPROTO_BASE_SCOPE])).toEqual([
      REPO_SCOPES.SCHEMA,
      REPO_SCOPES.LENS,
      BLOB_SCOPE,
    ]);
  });

  it("reports nothing when the grant is not yet known", () => {
    // An empty list means the library has not surfaced the scope; the PDS
    // stays the authority rather than us blocking on a guess.
    expect(missingPublishScopes([])).toEqual([]);
  });
});
