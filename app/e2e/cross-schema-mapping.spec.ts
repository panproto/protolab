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
  base("produces an editable circuit for theory-level diffs", async ({
    page,
  }) => {
    // Start in edit mode so the Inspector schema forms are visible.
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    // The Inspector's CircuitInspector (which hosts the schema forms)
    // only renders when no node/edge is selected. The demo circuit
    // auto-loads nothing selected, but deselect defensively by pressing
    // Escape — otherwise clicking in the canvas may select a node.
    await page.keyboard.press("Escape");

    await assignSchema(page, "source", SOURCE_NSID);
    await assignSchema(page, "target", TARGET_NSID);

    // Auto-generation fires on target assignment. The regression was
    // that zero nodes were installed here. We assert at least one
    // component appears on the canvas — either a field-level component
    // or a `chain_step` fallback, either is fine.
    await expect(page.locator(".react-flow__node").first()).toBeVisible({
      timeout: 15_000,
    });
    const nodeCount = await page.locator(".react-flow__node").count();
    expect(nodeCount).toBeGreaterThan(0);
  });

  base("validates output against the target schema after Run", async ({
    page,
  }) => {
    // The demo circuit pre-assigns `source` only, not `target`, so
    // validation wouldn't fire without assigning one. Point source and
    // target at the same atproto NSID (identity-ish mapping) so the
    // circuit definitely has a target handle wired up; validation then
    // runs against that target after Run.
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await assignSchema(page, "target", "app.bsky.feed.post");

    // Input needs to be something the source schema can parse; pasting
    // an empty object reliably produces output regardless of target.
    const inputBox = page
      .locator("textarea")
      .filter({ hasText: /.*/ })
      .first();
    await inputBox.fill("{}");

    await page.getByRole("button", { name: /Run/ }).click();

    const badge = page.getByTestId("output-validation-badge");
    await expect(badge).toBeVisible({ timeout: 20_000 });
    const isValid = await badge.getAttribute("data-valid");
    expect(["true", "false"]).toContain(isValid);
  });
});
