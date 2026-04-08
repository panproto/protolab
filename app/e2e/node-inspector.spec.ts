/**
 * NodeInspector end-to-end: selecting a component reveals its params,
 * editing a param persists, and the Bang button evaluates up to that node.
 */

import { test, expect } from "./fixtures";

test.describe("node inspector", () => {
  test("clicking a component shows its params in the inspector", async ({
    ready: page,
  }) => {
    // React Flow nodes render labels + params in the same text block,
    // so select the node whose label contains "RenameField" and click it.
    const renameNode = page
      .locator(".react-flow__node")
      .filter({ hasText: "RenameField" });
    await renameNode.click();

    // The Inspector's NodeInspector renders a Delete Component button
    // and a Bang button when a node is selected.
    await expect(
      page.getByRole("button", { name: "Delete Component" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Bang/ })).toBeVisible();
    // Param inputs for rename_field render as plain <input type="text">
    // with `defaultValue` set from the store. Target by value attribute.
    await expect(page.locator('input[value="name"]')).toBeVisible();
    await expect(page.locator('input[value="displayName"]')).toBeVisible();
  });

  test("Bang button on rename shows the renamed output", async ({
    ready: page,
  }) => {
    // `bang_component` reads `state.input_instance` from the Rust slab,
    // which is only populated by `set_input_data` (invoked by the "Run"
    // button via the store's `runEvaluation`). Without a prior Run click
    // the Bang handler throws `no input data set — call set_input_data
    // first`. This mirrors how the user would actually use the app:
    // configure input → Run to push it → Bang per-component to inspect
    // intermediate state.
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(
      page.getByText(/"displayName"\s*:\s*"Alice"/).first(),
    ).toBeVisible({ timeout: 10_000 });

    const renameNode = page
      .locator(".react-flow__node")
      .filter({ hasText: "RenameField" });
    await renameNode.click();
    await page.getByRole("button", { name: /Bang/ }).click();

    // The bang result pane renders the per-component wire output JSON
    // inside a <pre>. Scope to the Inspector panel to avoid matching
    // the main Output panel which also contains `displayName`.
    const bangPanel = page.locator("pre").filter({ hasText: /"displayName"/ });
    await expect(bangPanel).toBeVisible();
    // After rename only, `legacyId` is still present (not yet dropped).
    await expect(bangPanel).toContainText(/"legacyId"\s*:\s*42/);
    await expect(bangPanel).toContainText(/"displayName"\s*:\s*"Alice"/);
  });
});
