/**
 * Presentation mode e2e tests.
 *
 * Presentation mode is a separate UI layer — headings, I/O widgets,
 * lexicon importer, run button — that wraps the real lens circuit.
 * Widgets are NOT circuit nodes; they live in `presentationDoc`.
 * The edit-mode circuit canvas only shows the real lens transforms.
 */

import { test, expect } from "./fixtures";
import { test as base } from "@playwright/test";

// ── Default landing (no URL params) ─────────────────────────────────

base.describe("default landing", () => {
  base("loads lexicon mapper template in presentation mode", async ({
    page,
  }) => {
    await page.goto("/");
    // The template auto-resolves app.bsky.feed.post from lexicon.garden
    // (may take a moment) and enters presentation mode.
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    // Title from the presentationDoc.
    await expect(page.getByRole("heading", { name: "protolab" })).toBeVisible();
    // Default layout is form.
    await expect(page.locator('[data-layout="form"]')).toBeVisible();
  });

  base("shows the template widgets", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-widget="heading"]')).toBeVisible();
    await expect(page.locator('[data-widget="paragraph"]')).toBeVisible();
    await expect(page.locator('[data-widget="lens_chain"]')).toBeVisible();
    await expect(page.locator('[data-widget="schema_import"]').first()).toBeVisible();
    await expect(page.locator('[data-widget="input_json"]')).toBeVisible();
    await expect(page.locator('[data-widget="output_json"]')).toBeVisible();
    await expect(page.locator('[data-widget="run_button"]')).toBeVisible();
  });

  base("input is pre-seeded with the canonical atproto post", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    const textarea = page.locator('[data-widget="input_json"] textarea');
    // The template seeds the input with the canonical post example.
    // Verify it contains the expected schema fields, not exact values.
    await expect(textarea).toContainText("text");
    await expect(textarea).toContainText("createdAt");
  });
});

// ── Cmd+E toggle ────────────────────────────────────────────────────

test.describe("Cmd+E toggle", () => {
  test("toggles between edit and presentation mode", async ({
    ready: page,
  }) => {
    // `ready` starts in edit mode (?mode=edit).
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible();
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
  });

  test("does not fire when focus is inside a text input", async ({
    ready: page,
  }) => {
    // Focus a text input in the palette filter.
    const filter = page.getByPlaceholder("Filter...");
    await filter.focus();
    await page.keyboard.press("Meta+E");
    // Should stay in edit mode — the shortcut shouldn't fire.
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
  });
});

// ── Presentation mode without a template ────────────────────────────

test.describe("empty presentation mode", () => {
  test("shows the empty state and an Edit circuit link", async ({
    ready: page,
  }) => {
    // `ready` goes to ?mode=edit with the demo circuit. Toggle to
    // presentation — the demo circuit has no presentationDoc widgets.
    await page.keyboard.press("Meta+E");
    await expect(
      page.getByText(/Nothing to show in presentation mode/),
    ).toBeVisible();
    await page.getByTestId("empty-presentation-edit-link").click();
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
  });
});

// ── Lexicon mapper: Run the lens ────────────────────────────────────

base.describe("lexicon mapper run", () => {
  base("Run button transforms input through the 4-step lens", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });

    // The Lexicon Mapper resolves its source schema asynchronously
    // from lexicon.garden. The Run button stays disabled until that
    // completes; wait on the `data-ready` attribute rather than a
    // fixed sleep.
    const runBtn = page.locator('[data-widget="run_button"]');
    await expect(runBtn).toHaveAttribute("data-ready", "true", {
      timeout: 20_000,
    });
    await runBtn.click();

    // The 4-step lens: rename text→body, rename createdAt→timestamp,
    // compute charCount=len(body), add source="bluesky".
    const output = page.locator('[data-widget="output_json"]');
    await expect(output).toContainText("body", { timeout: 10_000 });
    await expect(output).toContainText("timestamp");
    await expect(output).toContainText("bluesky");
  });

  base("input edit → Run updates output", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });

    // Replace the seeded input with a different post.
    const input = page.locator('[data-widget="input_json"] textarea');
    await input.fill(
      '{\n  "text": "Testing 123",\n  "createdAt": "2026-04-10T00:00:00.000Z"\n}',
    );

    const runBtn = page.locator('[data-widget="run_button"]');
    await expect(runBtn).toHaveAttribute("data-ready", "true", {
      timeout: 20_000,
    });
    await runBtn.click();
    const output = page.locator('[data-widget="output_json"]');
    await expect(output).toContainText("Testing 123", { timeout: 10_000 });
    await expect(output).toContainText("2026-04-10");
  });
});

// ── Schema import widget ───────────────────────────────────────────

base.describe("schema import widget", () => {
  base("resolves a different NSID and updates source schema", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });

    // The Lexicon Mapper template renders two SchemaImportWidget
    // instances (source + target) tagged with `data-role`. Wait for the
    // source widget to finish auto-resolving its default NSID before
    // we click Change — otherwise the widget is in mid-fetch and the
    // "Change" button doesn't exist yet.
    const source = page
      .locator('[data-widget="schema_import"][data-role="source"]')
      .first();
    await source.waitFor({ state: "visible", timeout: 15_000 });
    await expect(source.getByRole("button", { name: "Change" })).toBeVisible({
      timeout: 20_000,
    });
    await source.getByRole("button", { name: "Change" }).click();

    const nsidInput = source.locator('input[aria-label="Lexicon NSID"]');
    await nsidInput.waitFor({ state: "visible" });
    await nsidInput.fill("app.bsky.actor.profile");
    await source.getByRole("button", { name: "Resolve" }).click();

    // Success: form re-collapses to the assigned-banner with the new
    // NSID visible inside.
    await expect(source).toContainText("app.bsky.actor.profile", {
      timeout: 20_000,
    });
  });
});

// ── Edit mode after template ────────────────────────────────────────

base.describe("edit mode via Cmd+E after template", () => {
  base("shows only the 4 real lens components, not presentation widgets", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });

    // Switch to edit mode.
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();

    // The circuit should have exactly 4 React Flow nodes (the lens chain).
    await expect(page.locator(".react-flow__node")).toHaveCount(4, {
      timeout: 10_000,
    });

    // Verify the 4 component types are present.
    const nodes = page.locator(".react-flow__node");
    await expect(nodes.filter({ hasText: "RenameField" })).toHaveCount(2);
    await expect(nodes.filter({ hasText: "ComputeField" })).toHaveCount(1);
    await expect(nodes.filter({ hasText: "AddField" })).toHaveCount(1);

    // And wires connect them (3 wires for a 4-node chain).
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);

    // No "Heading", "Paragraph", "Run Button" nodes — those are
    // presentation widgets, not circuit components.
    await expect(nodes.filter({ hasText: "Heading" })).toHaveCount(0);
    await expect(nodes.filter({ hasText: "Paragraph" })).toHaveCount(0);
  });
});

// ── Share URL ──────────────────────────────────────────────────────

base.describe("share URL", () => {
  base("URL reflects mode param", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(() => page.url()).toMatch(/mode=presentation/);
  });
});

// ── Template via explicit URL param ────────────────────────────────

base.describe("explicit ?template=lexicon_mapper", () => {
  base("loads the same template as the default landing", async ({
    page,
  }) => {
    await page.goto("/?template=lexicon_mapper");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: "protolab" })).toBeVisible();
    await expect(page.locator('[data-widget="heading"]')).toBeVisible();
    await expect(page.locator('[data-widget="run_button"]')).toBeVisible();
  });
});
