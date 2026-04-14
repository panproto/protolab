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
    // Match the `base: "/"` from `vite.config.ts` in dev mode. Vite binds
    // to `localhost` (ipv6 `::1`) by default, so using `localhost` here
    // avoids a 127.0.0.1/::1 mismatch when Playwright probes the server.
    baseURL: "http://localhost:5180",
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
    url: "http://localhost:5180",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The Vite dev server needs the WASM pkg to be built. Playwright runs
    // the dev server as-is; `wasm-pack build` must have run beforehand.
    // We document this in the suite's README and the npm test:e2e script.
  },
});
