/**
 * Shared fixtures for protolab Playwright tests.
 *
 * Each test spawns the app, waits for the demo circuit to finish loading
 * (3 components visible: RenameField, AddField, DropField), and yields
 * the ready `page`. This mirrors the real startup path: WASM init →
 * `create_demo_circuit_with_handle` → React Flow mount.
 */

import { test as base, expect, type Page } from "@playwright/test";

/**
 * Wait for the demo circuit to be fully mounted. The `initDemo` flow
 * calls `wasm.initWasm()` + `getDemoCircuitWithHandle()` asynchronously,
 * so `goto("/")` returns before React Flow has actually rendered the
 * component nodes.
 */
export async function waitForDemoLoaded(page: Page) {
  // The Toolbar's brand heading renders synchronously once the React
  // tree mounts; use it as a proof-of-mount.
  await expect(page.getByText("protolab", { exact: true })).toBeVisible();
  // The demo circuit has exactly 3 components: rename_field, add_field,
  // drop_field. React Flow renders each as a `.react-flow__node` div.
  await expect(page.locator(".react-flow__node")).toHaveCount(3, {
    timeout: 15_000,
  });
  // And exactly 2 wires between them.
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
}

export const test = base.extend<{ ready: Page }>({
  ready: async ({ page }, use) => {
    // The app's default landing is presentation mode with the Lexicon
    // Mapper template. Existing edit-mode tests expect the raw demo
    // editor, so the `ready` fixture explicitly requests edit mode
    // with no template injection via `?mode=edit`.
    await page.goto("/?mode=edit");
    await waitForDemoLoaded(page);
    await use(page);
  },
});

export { expect };
