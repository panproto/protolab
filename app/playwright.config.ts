/**
 * Playwright configuration for protolab end-to-end smoke tests.
 *
 * The e2e suite runs against the real Vite dev server with the real WASM
 * module loaded in a headless Chromium. Unlike the vitest suite (which
 * mocks the bridge), these tests exercise the full UI → WASM pipeline
 * and catch regressions that component-level tests can't (React Flow
 * portal behavior, CodeMirror, real ResizeObserver, etc.).
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    // Match the `base: "/"` from `vite.config.ts` in dev mode, and its
    // `server.host`. The dev server binds the loopback *IP* rather than
    // the default, because atproto OAuth rejects `localhost` in a
    // redirect_uri (RFC 8252 §8.3) and the dev client registers
    // `http://127.0.0.1:<port>/`.
    //
    // Address it the same way here. `localhost` resolves to `::1` first on
    // Linux, so probing that against a server bound to 127.0.0.1 is a
    // connection refused on CI and every spec fails at navigation.
    baseURL: "http://127.0.0.1:5180",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5180",
    url: "http://127.0.0.1:5180",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The Vite dev server needs the WASM pkg to be built. Playwright runs
    // the dev server as-is; `wasm-pack build` must have run beforehand.
    // We document this in the suite's README and the npm test:e2e script.
  },
});
