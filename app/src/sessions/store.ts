// Sessions slice, kept separate from `store/circuitStore.ts` so OAuth state
// does not entangle with canvas state. Sessions persist under their own
// localStorage key: clearing a circuit must not sign anyone out, and
// signing out must not lose a circuit.
//
// Only display metadata is persisted here. Tokens live in the OAuth
// library's IndexedDB store and are never copied into localStorage.

import { create } from "zustand";
import type { Session } from "./types";

interface SessionsState {
  sessions: Record<string, Session>;
  /** DID of the session used for publish actions. */
  activeDid: string | null;

  upsertSession: (s: Session) => void;
  removeSession: (did: string) => void;
  setActiveDid: (did: string | null) => void;
  patchSession: (did: string, partial: Partial<Session>) => void;
}

const STORAGE_KEY = "protolab.sessions.v1";

interface PersistedShape {
  sessions: Record<string, Session>;
  activeDid: string | null;
}

function load(): PersistedShape | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedShape;
  } catch {
    return null;
  }
}

function persist(sessions: Record<string, Session>, activeDid: string | null): void {
  if (typeof localStorage === "undefined") return;
  const payload: PersistedShape = { sessions, activeDid };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota / private-mode failures; the store still works in memory.
  }
}

const persisted = load();

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: persisted?.sessions ?? {},
  activeDid: persisted?.activeDid ?? null,

  upsertSession: (s) =>
    set((state) => {
      const sessions = { ...state.sessions, [s.did]: s };
      // First session signed in becomes the active one.
      const activeDid = state.activeDid ?? s.did;
      persist(sessions, activeDid);
      return { sessions, activeDid };
    }),

  removeSession: (did) =>
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[did];
      // Signing out the active DID rotates to whatever is still signed in.
      const activeDid =
        state.activeDid === did
          ? (Object.keys(sessions)[0] ?? null)
          : state.activeDid;
      persist(sessions, activeDid);
      return { sessions, activeDid };
    }),

  setActiveDid: (did) =>
    set((state) => {
      persist(state.sessions, did);
      return { activeDid: did };
    }),

  patchSession: (did, partial) =>
    set((state) => {
      const existing = state.sessions[did];
      if (!existing) return state;
      const sessions = { ...state.sessions, [did]: { ...existing, ...partial } };
      persist(sessions, state.activeDid);
      return { sessions };
    }),
}));

/** The active session, or `null` when nobody is signed in. */
export function activeSession(): Session | null {
  const { activeDid, sessions } = useSessionsStore.getState();
  if (!activeDid) return null;
  return sessions[activeDid] ?? null;
}
