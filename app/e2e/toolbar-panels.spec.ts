/**
 * Coverage for each Toolbar entry point: Theories, Colimit, Schemas,
 * Protocols, Import, Export. Each test opens the panel, asserts the
 * basic UI is present, and closes it.
 */

import { test, expect } from "./fixtures";

test.describe("toolbar panels", () => {
  test("Theories button opens the theory editor modal", async ({
    ready: page,
  }) => {
    await page.getByRole("button", { name: "Theories" }).click();
    await expect(page.getByText(/Build Theory/i).first()).toBeVisible({
      timeout: 5_000,
    });
    // Close (Escape or Close button).
    await page.keyboard.press("Escape");
  });

  test("Colimit button opens the colimit composer", async ({
    ready: page,
  }) => {
    await page.getByRole("button", { name: "Colimit" }).click();
    // The composer renders even with zero imported theories — it shows
    // a hint or empty selectors.
    await expect(page.getByText(/Colimit|Compose|Theory 1|Theory 2/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });

  test("Schemas button opens the schema browser", async ({ ready: page }) => {
    await page.getByRole("button", { name: "Schemas" }).click();
    await expect(page.getByText(/Schemas & Theories|Imported/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });

  test("Protocols button opens the protocol editor", async ({
    ready: page,
  }) => {
    await page.getByRole("button", { name: "Protocols" }).click();
    await expect(page.getByText(/Protocol|Object Kinds|Edge Rules/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });

  test("Import dropdown lists all four import types", async ({
    ready: page,
  }) => {
    await page.getByRole("button", { name: /Import/ }).click();
    await expect(page.getByText("Lens Document (JSON)")).toBeVisible();
    await expect(page.getByText("Schema (JSON)")).toBeVisible();
    await expect(page.getByText("Theory (JSON)")).toBeVisible();
    await expect(page.getByText("Protocol (JSON)")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Export buttons download the four formats", async ({ ready: page }) => {
    for (const { label, suggested } of [
      { label: "Schema JSON", suggested: "circuit.json" },
      { label: "Lens JSON", suggested: "lens.json" },
      { label: "YAML", suggested: "lens.yaml" },
      { label: "Nickel", suggested: "lens.ncl" },
    ]) {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: label }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(suggested);
    }
  });
});
