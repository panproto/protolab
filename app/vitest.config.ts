/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Vitest runs unit/component tests under `src/`; Playwright specs
    // under `e2e/` need the real browser and are excluded from the
    // default test matcher.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/wasm/pkg/**", "**/*.d.ts", "e2e/**"],
    },
  },
  resolve: {
    alias: {
      "../wasm/bridge": path.resolve(__dirname, "src/test/wasmBridgeMock.ts"),
      // SessionMenu mounts in the Toolbar, and a real BrowserOAuthClient
      // assigns location.href on load, which jsdom cannot do.
      "../sessions/oauth": path.resolve(__dirname, "src/test/oauthMock.ts"),
    },
  },
});
