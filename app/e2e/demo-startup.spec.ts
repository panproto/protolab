/**
 * Demo circuit bootstrap: the app loads, initializes WASM, creates the
 * demo circuit, assigns the built-in `user` source schema, and shows
 * three nodes + two wires in the React Flow canvas.
 */

import { test, expect } from "./fixtures";

test.describe("demo circuit startup", () => {
  test("brand heading and three demo components are visible", async ({
    ready: page,
  }) => {
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();

    // Each React Flow node renders a `<div class="react-flow__node">` whose
    // text content is the concatenation of label + optic badge + params.
    // Filter the node locators by partial text match and count them.
    const nodes = page.locator(".react-flow__node");
    await expect(nodes.filter({ hasText: "RenameField" })).toHaveCount(1);
    await expect(nodes.filter({ hasText: "AddField" })).toHaveCount(1);
    await expect(nodes.filter({ hasText: "DropField" })).toHaveCount(1);
  });

  test("default input JSON is pre-populated and runnable", async ({
    ready: page,
  }) => {
    // The DataPanel seeds `inputDataJson` with a realistic user record.
    // The JSON renders inside a <pre>/<code>/<textarea> — search all text.
    await expect(page.getByText(/"name":\s*"Alice Chen"/).first()).toBeVisible();
    await expect(page.getByText(/"legacyId":\s*7042/).first()).toBeVisible();

    // Click Run. The output should contain `displayName` (rename applied)
    // and `bio` (add_field applied). The button text is "Run ▶".
    await page.getByRole("button", { name: /Run/ }).click();

    // Wait for the output panel to populate.
    await expect(
      page.getByText(/"displayName"\s*:\s*"Alice Chen"/).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/"bio"/).first()).toBeVisible();
  });

  test("palette lists every component category", async ({ ready: page }) => {
    // Category headers are rendered in mixed case with CSS
    // `text-transform: uppercase`; Playwright matches actual text content,
    // not the rendered visual form, so match the catalog strings directly.
    await expect(page.getByText("Structure", { exact: true })).toBeVisible();
    await expect(page.getByText("Type Coercion", { exact: true })).toBeVisible();
    await expect(page.getByText("Collections", { exact: true })).toBeVisible();
    await expect(page.getByText("Expressions", { exact: true })).toBeVisible();
  });
});
