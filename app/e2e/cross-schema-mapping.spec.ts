/**
 * Assign source + target schemas via the edit-mode Inspector and
 * assert that (a) the canvas shows lens components and (b) the
 * output-pane validation badge appears after Run.
 */

import { test as base, expect } from "@playwright/test";

const SOURCE_NSID = "blue.2048.verification.stats";
const TARGET_NSID = "app.bsky.graph.verification";

async function assignSchema(
  page: import("@playwright/test").Page,
  role: "source" | "target",
  nsid: string,
) {
  const widget = page
    .locator(`[data-widget="schema_import"][data-role="${role}"]`)
    .first();
  await widget.waitFor({ state: "visible", timeout: 15_000 });
  // The form collapses into an "assigned" banner when a schema is
  // already set (demo circuit pre-assigns source/target). Click Change
  // to reveal the input form.
  const changeBtn = widget.getByRole("button", { name: "Change" });
  if (await changeBtn.isVisible().catch(() => false)) {
    await changeBtn.click();
  }
  const input = widget.locator('input[aria-label="Lexicon NSID"]');
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(nsid);
  // Resolve by clicking the button (Enter would open autocomplete).
  await widget.getByRole("button", { name: "Resolve" }).click();
  // Success → the form re-collapses into the "assigned" banner with
  // the new NSID. Wait for the banner to show the NSID we just typed.
  await expect(widget.getByRole("button", { name: "Change" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(widget).toContainText(nsid, { timeout: 10_000 });
}

base.describe("cross-schema lens mapping", () => {
  base("surfaces the CanvasEmptyState with hint + theory-diff CTAs when no data-level mapping is inferred", async ({
    page,
  }) => {
    // v0.4.4: assigning two atproto schemas whose diff is purely
    // theory-level (blue.2048 ↔ bsky.graph.verification) leaves the
    // canvas empty on purpose. The user sees a prominent overlay with
    // three clear next moves — Add hints (primary), View theory-level
    // diff (secondary), drag from palette — rather than a chain of
    // chain_step placeholders that would silently run as identity.
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await assignSchema(page, "source", SOURCE_NSID);
    await assignSchema(page, "target", TARGET_NSID);

    // Canvas is empty by design here.
    const empty = page.getByTestId("canvas-empty-state");
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText("No data-level mapping inferred");
    await expect(empty.getByTestId("canvas-empty-add-hints")).toBeVisible();
    await expect(empty.getByTestId("canvas-empty-view-diff")).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
  });

  base("validates output against the target schema after Run", async ({
    page,
  }) => {
    // Use identity mapping (same atproto NSID as source + target) so
    // the data-level lens exists (identity), Run is enabled, and the
    // validation badge fires. Disjoint-schema cases surface the
    // CanvasEmptyState instead (covered above) and Run is disabled
    // there — which is the correct v0.4.4 UX.
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await assignSchema(page, "source", "app.bsky.feed.post");
    await assignSchema(page, "target", "app.bsky.feed.post");

    await page.getByTestId("data-panel-input").fill("{}");
    await page.getByRole("button", { name: /Run/ }).click();

    const badge = page.getByTestId("output-validation-badge");
    await expect(badge).toBeVisible({ timeout: 20_000 });
    const isValid = await badge.getAttribute("data-valid");
    expect(["true", "false"]).toContain(isValid);
  });
});
