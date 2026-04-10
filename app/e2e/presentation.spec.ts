/**
 * Presentation mode e2e tests.
 *
 * Presentation mode is a separate UI layer — headings, I/O widgets,
 * lexicon importer, run button — that wraps the real lens circuit.
 * Widgets are NOT circuit nodes; they live in `presentationDoc`.
 * The edit-mode circuit canvas only shows the real lens transforms.
 */

import { test, expect, waitForDemoLoaded } from "./fixtures";
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
    await expect(page.getByRole("heading", { name: "Lexicon Mapper" })).toBeVisible();
    // Default layout is form.
    await expect(page.locator('[data-layout="form"]')).toBeVisible();
  });

  base("shows all six template widgets", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-widget="heading"]')).toBeVisible();
    await expect(page.locator('[data-widget="paragraph"]')).toBeVisible();
    await expect(page.locator('[data-widget="lexicon_import"]')).toBeVisible();
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
    await expect(textarea).toContainText("Hello, ATProtocol!");
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
    await page.getByRole("button", { name: /Edit circuit/ }).click();
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
  });
});

// ── Layout switching ────────────────────────────────────────────────

base.describe("layout switching", () => {
  base("layout selector toggles between form / two_column / free", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    // Default layout is form.
    await expect(page.locator('[data-layout="form"]')).toBeVisible();

    // Switch to two_column.
    await page
      .locator('[data-testid="presentation-toolbar"] select')
      .selectOption("two_column");
    await expect(page.locator('[data-layout="two_column"]')).toBeVisible();
    // URL should contain ?layout=two_column.
    await expect.poll(() => page.url()).toMatch(/layout=two_column/);

    // Switch to free.
    await page
      .locator('[data-testid="presentation-toolbar"] select')
      .selectOption("free");
    await expect(page.locator('[data-layout="free"]')).toBeVisible();
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

    // Click Run. The lens auto-resolved the lexicon on template load.
    await page.locator('[data-widget="run_button"]').click();

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

    await page.locator('[data-widget="run_button"]').click();
    const output = page.locator('[data-widget="output_json"]');
    await expect(output).toContainText("Testing 123", { timeout: 10_000 });
    await expect(output).toContainText("2026-04-10");
  });
});

// ── Lexicon import widget ──────────────────────────────────────────

base.describe("lexicon import widget", () => {
  base("resolves a different NSID and updates source schema", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });

    // Change the NSID and resolve a different lexicon.
    const nsidInput = page.locator('[data-widget="lexicon_import"] input[type="text"]');
    await nsidInput.fill("app.bsky.actor.profile");
    await page
      .locator('[data-widget="lexicon_import"] button')
      .filter({ hasText: "Resolve" })
      .click();

    // Should show a success status message.
    await expect(
      page.locator('[data-widget="lexicon_import"]').getByText(/imported/),
    ).toBeVisible({ timeout: 10_000 });
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
  base("URL reflects mode + layout params", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(() => page.url()).toMatch(/mode=presentation/);

    // Change layout.
    await page
      .locator('[data-testid="presentation-toolbar"] select')
      .selectOption("two_column");
    await expect.poll(() => page.url()).toMatch(/layout=two_column/);
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
    await expect(page.getByRole("heading", { name: "Lexicon Mapper" })).toBeVisible();
    await expect(page.locator('[data-widget="heading"]')).toBeVisible();
    await expect(page.locator('[data-widget="run_button"]')).toBeVisible();
  });
});
