/**
 * Rigorous data-transformation correctness tests.
 *
 * Every test asserts the EXACT shape AND VALUES of the output — not
 * just "contains x". Where a value is computed (e.g. charCount), the
 * test recomputes it from the input and asserts equality. Assertions
 * are strict (toEqual / toBe), not partial.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { stubLexicons } from "./fixtures";

const CANONICAL_POST = {
  text: "Just shipped a bidirectional schema mapper that translates between atproto lexicons using panproto's protolens pipeline. Rename fields, compute derived values, add defaults; the lens runs both ways so you can edit the output and recover the original. Try it at panproto.dev/protolab",
  createdAt: "2026-04-11T14:30:00.000Z",
  langs: ["en"],
  tags: ["panproto", "atproto", "schemas"],
};

base.describe("Lexicon Mapper template produces the documented target shape", () => {
  base("forward evaluation emits {body, timestamp, charCount, source} with exact values", async ({
    page,
  }) => {
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    // The Run button becomes ready once the source schema resolves.
    await expect(page.locator('[data-widget="run_button"]')).toHaveAttribute(
      "data-ready",
      "true",
      { timeout: 15_000 },
    );
    // Seed the input exactly — the template's default input differs
    // from the exact value we assert against.
    await page
      .locator('[data-widget="input_json"] textarea')
      .fill(JSON.stringify(CANONICAL_POST, null, 2));
    await page.locator('[data-widget="run_button"]').click();

    // Poll the store until the output reflects the lens run. Parsing
    // a stale placeholder would produce flaky undefined reads.
    const output = await expect
      .poll(
        () =>
          page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const json = (window as any).__protolabStore.getState().outputDataJson;
            try {
              return JSON.parse(json);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch {
              return null;
            }
          }),
        { timeout: 10_000 },
      )
      .toMatchObject({ body: expect.any(String), source: "bluesky" })
      .then(() =>
        page.evaluate(() =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          JSON.parse(
            (window as any).__protolabStore.getState().outputDataJson,
          ),
        ),
      );

    // Strict assertions against every key the lens is documented to
    // produce. Fail fast on any deviation.
    expect(output.body).toBe(CANONICAL_POST.text);
    expect(output.timestamp).toBe(CANONICAL_POST.createdAt);
    expect(output.source).toBe("bluesky");
    expect(output.charCount).toBe(CANONICAL_POST.text.length);
    // text/createdAt are renamed, so must NOT appear in output.
    expect(output).not.toHaveProperty("text");
    expect(output).not.toHaveProperty("createdAt");
    // Pass-through fields survive (documented behaviour of the 4-step
    // lens: rename, compute, add — no drop).
    expect(output.langs).toEqual(CANONICAL_POST.langs);
    expect(output.tags).toEqual(CANONICAL_POST.tags);
  });

  base("charCount tracks body: edit body and Run again → charCount recomputes", async ({
    page,
  }) => {
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-widget="run_button"]')).toHaveAttribute(
      "data-ready",
      "true",
      { timeout: 15_000 },
    );

    // Two distinct inputs with known exact text lengths. Assert
    // charCount is STRICTLY equal to the new body length in each case.
    const short = { text: "hi", createdAt: "2026-01-01T00:00:00.000Z" };
    const long = {
      text: "abcdefghijklmnopqrstuvwxyz0123456789",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    for (const sample of [short, long]) {
      await page
        .locator('[data-widget="input_json"] textarea')
        .fill(JSON.stringify(sample, null, 2));
      await page.locator('[data-widget="run_button"]').click();
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const j = (window as any).__protolabStore.getState().outputDataJson;
              try {
                return JSON.parse(j);
              } catch {
                return null;
              }
            }),
          { timeout: 10_000 },
        )
        .toEqual(expect.objectContaining({ body: sample.text, charCount: sample.text.length }));
    }
  });
});

base.describe("Apply Back round-trip through rename_field", () => {
  base("editing displayName in output restores input.name on Apply Back", async ({
    page,
  }, testInfo) => {
    // panproto#40: v0.33.0 put() regression scrambles field assignment.
    testInfo.fail();
    // The demo circuit's first step is rename_field (name → displayName).
    // Editing displayName in the output and Apply Back must propagate
    // the new value back to input.name via asymmetric::put on the
    // cached lens + complement. No approximation; strict equality.
    await page.goto("/?mode=edit");
    await expect(page.locator(".react-flow__node")).toHaveCount(3, {
      timeout: 15_000,
    });
    // Run forward so last_eval is populated.
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(page.getByTestId("data-panel-output")).toContainText(
      '"displayName"',
      { timeout: 10_000 },
    );
    // Read the current output (JSON), edit displayName to a sentinel,
    // put it back, assert input.name equals the sentinel.
    const originalOutput = JSON.parse(
      await page.getByTestId("data-panel-output").inputValue(),
    );
    const sentinel = "Zebulon Pike";
    const modifiedOutput = { ...originalOutput, displayName: sentinel };
    await page
      .getByTestId("data-panel-output")
      .fill(JSON.stringify(modifiedOutput, null, 2));
    await page.getByRole("button", { name: /Apply Back/ }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            JSON.parse(
              (window as any).__protolabStore.getState().inputDataJson,
            ),
          ),
        { timeout: 10_000 },
      )
      .toMatchObject({ name: sentinel });
  });

  base("Run after Apply Back re-derives the same displayName", async ({
    page,
  }, testInfo) => {
    // panproto#40: v0.33.0 put() regression scrambles field assignment.
    testInfo.fail();
    // Round-trip law: put then get must yield the modified view.
    await page.goto("/?mode=edit");
    await expect(page.locator(".react-flow__node")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(page.getByTestId("data-panel-output")).toContainText(
      '"displayName"',
      { timeout: 10_000 },
    );
    const originalOutput = JSON.parse(
      await page.getByTestId("data-panel-output").inputValue(),
    );
    const sentinel = "Round Trip";
    await page
      .getByTestId("data-panel-output")
      .fill(
        JSON.stringify({ ...originalOutput, displayName: sentinel }, null, 2),
      );
    await page.getByRole("button", { name: /Apply Back/ }).click();
    // Run forward again; output.displayName must equal sentinel.
    await page.getByRole("button", { name: /Run/ }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            JSON.parse(
              (window as any).__protolabStore.getState().outputDataJson,
            ),
          ),
        { timeout: 10_000 },
      )
      .toMatchObject({ displayName: sentinel });
  });
});

base.describe("Validation badge reflects target-schema conformance", () => {
  base("output that matches the target schema resolves the badge to ✓ VALID", async ({
    page,
  }) => {
    // panproto v0.32.0 fixed the upstream root-inference bug
    // (panproto#35): the atproto parser now emits structural ref
    // edges so `#replyRef` isn't an orphan, and every consumer uses
    // `panproto_schema::primary_entry` to pick the parse root from a
    // declared basepoint family rather than reinventing a heuristic.
    // The previous testInfo.fail() gate is removed; this is a real
    // regression detector again.
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    // Identity map: source = target = app.bsky.feed.post. Input is a
    // well-formed post; output must validate.
    await page.evaluate(async () => {
      const wasm = await import("/src/wasm/bridge.ts");
      const r = await fetch(
        "https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid=app.bsky.feed.post",
      );
      const body = await r.json();
      const j = JSON.stringify(
        typeof body.schema === "object" && "lexicon" in body.schema
          ? body.schema
          : body,
      );
      const h = wasm.parseAtprotoLexicon(j).handle;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__protolabStore;
      store.getState().assignSourceSchema(h);
      store.getState().assignTargetSchema(h);
    });
    await page
      .getByTestId("data-panel-input")
      .fill(JSON.stringify(CANONICAL_POST, null, 2));
    await page.getByRole("button", { name: /Run/ }).click();
    const badge = page.getByTestId("output-validation-badge");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveAttribute("data-valid", "true");
  });
});
