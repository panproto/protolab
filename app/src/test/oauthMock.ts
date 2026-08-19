// Test double for `sessions/oauth`.
//
// `BrowserOAuthClient.load()` inspects `window.location` and, for a loopback
// client, assigns `location.href` to bounce `localhost` onto the loopback IP.
// jsdom does not implement navigation, so merely mounting `SessionMenu` — as
// the Toolbar tests now do — raised an unhandled "Not implemented:
// navigation" error alongside otherwise passing tests.
//
// Aliased in `vitest.config.ts`, the same way `wasm/bridge` is: component
// tests want the menu's rendering and switching behavior, not a real OAuth
// handshake. Tests that care about session state drive `useSessionsStore`
// directly.

import type { Agent } from "@atproto/api";
import type { AuthIntent } from "../sessions/scopes";

/** No session waiting in storage, and no navigation attempted. */
export async function resumeSession(): Promise<null> {
  return null;
}

export async function startSignIn(
  _handle: string,
  _intent: AuthIntent,
): Promise<void> {
  // Real sign-in navigates away; a test that needs the redirect should
  // assert on this being called rather than on a location change.
}

export async function signOut(_did: string): Promise<void> {}

export async function agentFor(_did: string): Promise<Agent | null> {
  return null;
}

export async function activeAgent(): Promise<Agent | null> {
  return null;
}

export async function getOAuthClient(): Promise<never> {
  throw new Error("getOAuthClient is not available under test");
}
