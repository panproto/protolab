import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Node 26 exposes a native `localStorage` global that stays `undefined`
// unless the process is started with `--localstorage-file`. Under vitest's
// jsdom environment `window === globalThis`, and that native own-property
// shadows the Storage jsdom would otherwise install — so `window.localStorage`
// reads back as `undefined` rather than throwing. Any component that reads
// persisted state in a `useState` initializer (Inspector's pane width, the
// sessions store) then dies during render.
//
// Install a spec-shaped in-memory Storage when it is missing. Guarded so a
// runtime that does provide one keeps it.
function installStorage(key: "localStorage" | "sessionStorage"): void {
  const existing = (globalThis as Record<string, unknown>)[key];
  if (existing) return;

  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  };

  Object.defineProperty(globalThis, key, {
    value: storage,
    configurable: true,
    writable: true,
  });
}

installStorage("localStorage");
installStorage("sessionStorage");

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
