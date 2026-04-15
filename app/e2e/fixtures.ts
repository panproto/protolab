/**
 * Shared fixtures for protolab Playwright tests.
 *
 * Each test spawns the app, waits for the demo circuit to finish loading
 * (3 components visible: RenameField, AddField, DropField), and yields
 * the ready `page`. This mirrors the real startup path: WASM init →
 * `create_demo_circuit_with_handle` → React Flow mount.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "lexicons",
);

/**
 * Stub lexicon.garden routes so tests are hermetic and instant. Tests
 * that hit network-resolved schemas should opt in by calling this
 * helper with the NSIDs they need before navigating.
 *
 * Fixtures live in `e2e/fixtures/lexicons/*.json` — refresh them via
 * `curl https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid=<n>`.
 */
export async function stubLexicons(page: Page, nsids: string[]) {
  // Cache reads so concurrent route handlers share the same payload.
  const cache = new Map<string, string>();
  for (const nsid of nsids) {
    cache.set(
      nsid,
      await readFile(join(FIXTURES_DIR, `${nsid}.json`), "utf8"),
    );
  }
  await page.route(
    "https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon**",
    async (route) => {
      const url = new URL(route.request().url());
      const nsid = url.searchParams.get("nsid") ?? "";
      const body = cache.get(nsid);
      if (!body) {
        await route.fulfill({ status: 404, body: `no fixture for ${nsid}` });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body,
      });
    },
  );
  // Autocomplete: return only the requested nsid as a single match,
  // keeping the dropdown deterministic.
  await page.route(
    "https://lexicon.garden/api/autocomplete-nsid**",
    async (route) => {
      const url = new URL(route.request().url());
      const q = url.searchParams.get("q") ?? "";
      const matches = nsids.filter((n) => n.startsWith(q));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(matches.map((nsid) => ({ nsid }))),
      });
    },
  );
}

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

/**
 * Drive the SchemaImportForm for one role to assign an atproto NSID
 * via the (stubbed) lexicon.garden lookup. Rejects fast if the form
 * doesn't transition to the assigned banner.
 */
export async function assignAtprotoSchema(
  page: Page,
  role: "source" | "target",
  nsid: string,
) {
  // The Inspector shows the SchemaImportForm only when no node/edge
  // is selected (otherwise it swaps to the per-node inspector). Other
  // actions (assigning source schemas, etc.) can re-render React Flow
  // and inadvertently select a node. Clear selection through the
  // store to be robust regardless of how we got here.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__protolabStore;
    if (store) store.getState().selectNode(null);
  });
  const form = page
    .locator(`[data-widget="schema_import"][data-role="${role}"]`)
    .first();
  await form.waitFor({ state: "visible", timeout: 5_000 });
  const change = form.getByRole("button", { name: "Change" });
  if (await change.isVisible().catch(() => false)) {
    await change.click();
    // Banner→input transition: wait for the form to actually re-render.
    await form
      .locator('input[aria-label="Lexicon NSID"]')
      .waitFor({ state: "visible", timeout: 2_000 });
  }
  await form.locator('input[aria-label="Lexicon NSID"]').fill(nsid);
  await form.getByRole("button", { name: "Resolve" }).click();
  try {
    await expect(form.getByRole("button", { name: "Change" })).toBeVisible({
      timeout: 10_000,
    });
  } catch (err) {
    // Surface the wasm-side error if there was one — `parseAtprotoLexicon`
    // surfaces `WasmError` strings into `setStatus` which renders as
    // `.fontSize: 10` text inside the form.
    const formText = await form.textContent();
    throw new Error(
      `assignAtprotoSchema(${role}, ${nsid}) failed.\n` +
        `Form text was: ${formText?.slice(0, 500)}\n` +
        `Original error: ${(err as Error).message}`,
    );
  }
  await expect(form).toContainText(nsid, { timeout: 10_000 });
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
