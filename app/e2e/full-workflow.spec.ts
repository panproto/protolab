/**
 * Full workflow e2e tests: edit mode operations end-to-end.
 *
 * These tests use the `ready` fixture which loads `?mode=edit` with
 * the demo circuit (3 components: RenameField, AddField, DropField,
 * 2 wires connecting them). They exercise:
 *
 *   - Forward evaluation (Run) + checking output
 *   - Backward evaluation (Apply Back) + checking input update
 *   - Drag a new component from the palette onto the canvas
 *   - Delete a component via the Inspector
 *   - Export circuit as JSON
 *   - Per-component Bang evaluation
 */

import { test, expect } from "./fixtures";

test.describe("forward evaluation", () => {
  test("Run produces the expected output from the demo circuit", async ({
    ready: page,
  }) => {
    // The demo circuit: rename(name→displayName) → add(bio) → drop(legacyId)
    await page.getByRole("button", { name: /Run/ }).click();

    const outputArea = page.getByTestId("data-panel-output");
    await expect(outputArea).toContainText("displayName", { timeout: 10_000 });
    await expect(outputArea).toContainText("bio");
  });
});

test.describe("backward evaluation (Apply Back)", () => {
  test("editing the output and applying back restores the input", async ({
    ready: page,
  }) => {
    // Run forward first to populate the output.
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(
      page.getByText(/"displayName"/).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Read the current output (demo forward: {displayName, email,
    // joinedAt, bio}) and edit only the displayName.
    const outputArea = page.getByTestId("data-panel-output");
    const currentOutput = await outputArea.inputValue();
    const parsed = JSON.parse(currentOutput);
    parsed.displayName = "Bob";
    await outputArea.fill(JSON.stringify(parsed, null, 2));
    await page.getByRole("button", { name: /Apply Back/ }).click();

    // Apply Back invokes `asymmetric::put` through the cached lens +
    // complement and propagates the edit back through the rename_field
    // step, so the input's `name` field becomes "Bob". Read via the
    // store directly to avoid racing React's controlled-textarea
    // re-render.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (window as any).__protolabStore.getState().inputDataJson;
          }),
        { timeout: 15_000 },
      )
      .toContain("Bob");
  });
});

test.describe("component operations", () => {
  test("drag a new component from the palette onto the canvas", async ({
    ready: page,
  }) => {
    // Start with 3 nodes.
    await expect(page.locator(".react-flow__node")).toHaveCount(3);

    // Drag CoerceType from the palette.
    const paletteItem = page.getByText("CoerceType", { exact: true });
    const canvas = page.locator(".react-flow");

    const paletteBounds = await paletteItem.boundingBox();
    const canvasBounds = await canvas.boundingBox();
    if (!paletteBounds || !canvasBounds) throw new Error("missing bounds");

    // Simulate drag: mousedown on palette → mousemove to canvas → mouseup
    await page.mouse.move(
      paletteBounds.x + paletteBounds.width / 2,
      paletteBounds.y + paletteBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvasBounds.x + canvasBounds.width / 2,
      canvasBounds.y + canvasBounds.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    // Should now have 4 nodes.
    await expect(page.locator(".react-flow__node")).toHaveCount(4, {
      timeout: 5000,
    });
  });

  test("delete a component via the Inspector", async ({ ready: page }) => {
    // Start with 3 nodes.
    await expect(page.locator(".react-flow__node")).toHaveCount(3);

    // Select the DropField node.
    const dropNode = page
      .locator(".react-flow__node")
      .filter({ hasText: "DropField" });
    await dropNode.click();

    // Click Delete Component in the Inspector.
    await page.getByRole("button", { name: "Delete Component" }).click();

    // Now 2 nodes.
    await expect(page.locator(".react-flow__node")).toHaveCount(2, {
      timeout: 5000,
    });
  });
});

test.describe("export", () => {
  test("Schema JSON export produces valid JSON via download", async ({
    ready: page,
  }) => {
    // Set up a download listener before clicking.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Schema JSON" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("circuit.json");

    // The download should be valid JSON.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const json = Buffer.concat(chunks).toString("utf8");
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

test.describe("per-component Bang", () => {
  test("Bang on RenameField shows intermediate wire state", async ({
    ready: page,
  }) => {
    // Must Run first so input data is loaded into the WASM slab.
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(
      page.getByText(/"displayName"/).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Select RenameField and Bang.
    const rename = page
      .locator(".react-flow__node")
      .filter({ hasText: "RenameField" });
    await rename.click();
    await page.getByRole("button", { name: /Bang/ }).click();

    // The bang result should show displayName (rename applied) but
    // legacyId should still be present (not yet dropped).
    const bangPre = page.locator("pre").filter({ hasText: "displayName" });
    await expect(bangPre).toBeVisible();
  });
});
