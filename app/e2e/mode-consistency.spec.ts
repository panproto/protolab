/**
 * Mode-consistency tests: edit mode and presentation mode must share
 * the same underlying circuit + schema + hint state. Edits in one
 * appear in the other immediately, without re-initialisation.
 *
 * Every test exercises BOTH modes within a single session, asserting
 * strict state equivalence across the boundary. No "eventually"
 * softness — if an edit in one mode isn't visible in the other, that
 * is a bug, not a timing issue.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { stubLexicons } from "./fixtures";

async function readStore<T>(page: Page, selector: string): Promise<T> {
  return page.evaluate(
    (sel) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new Function("s", `return ${sel}`)(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__protolabStore.getState(),
      ),
    selector,
  ) as Promise<T>;
}

base.describe("parameter edits in edit mode propagate to presentation run", () => {
  base("rename_field edit in edit mode → presentation Run emits the sentinel key", async ({
    page,
  }) => {
    // Start on the default landing (presentation + Lexicon Mapper
    // template: 4 real lens components). Toggle to edit mode, retarget
    // the first rename_field (text→body) at a sentinel key, toggle back
    // to presentation, Run. Output must have the sentinel instead of
    // body.
    //
    // The template's third step computes `charCount = len(body)`, so
    // renaming `body` away orphans that expression and the edit has to
    // carry it along. Up to panproto 0.38 it did not: an unevaluable
    // field transform was discarded and the rest of the chain still
    // produced output, so the rename could be edited in isolation.
    // panproto 0.57 reports the failure instead, which aborts the
    // evaluation and leaves no output at all — see the companion test
    // below, which pins that. Editing both params is also the better
    // test of what this case is about, which is whether an edit made in
    // one mode reaches a run in the other.
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
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
    const sentinel = "sentinelField";
    const renameNodeId = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__protolabStore.getState();
      const n = s.nodes.find(
        (x: {
          data: { componentType: string; params: Array<{ key: string; value: string }> };
        }) =>
          x.data.componentType === "rename_field" &&
          x.data.params.some((p) => p.key === "old_name" && p.value === "text"),
      );
      return n?.id as string;
    });
    expect(renameNodeId).toBeTruthy();
    await page.evaluate(
      ({ id, v }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__protolabStore
          .getState()
          .updateParam(id, "new_name", v);
      },
      { id: renameNodeId, v: sentinel },
    );
    // Carry the downstream expression with the rename, so the chain
    // still reads a field that exists.
    await page.evaluate((v) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__protolabStore.getState();
      const compute = store.nodes.find(
        (x: { data: { componentType: string } }) =>
          x.data.componentType === "compute_field",
      );
      if (compute) store.updateParam(compute.id, "expr", `len(${v})`);
    }, sentinel);
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible();
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
      .toEqual(expect.objectContaining({ [sentinel]: expect.any(String) }));
  });

  // The other half of the contract above. Up to panproto 0.38 an
  // unevaluable field transform was discarded and evaluation carried on,
  // so a lens broken mid-chain still produced output and the breakage was
  // indistinguishable from a transform that ran and changed nothing.
  // panproto 0.57 reports it. Pinned here because it is the user-visible
  // face of that change: the run stops and says which field failed and
  // why, rather than quietly emitting a partial record.
  base("orphaning a field a later step reads reports the failure", async ({
    page,
  }) => {
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/");
    await expect(page.locator('[data-widget="run_button"]')).toHaveAttribute(
      "data-ready",
      "true",
      { timeout: 15_000 },
    );
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();

    // Rename `body` away without touching `compute_field (len(body))`.
    const renameNodeId = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__protolabStore.getState();
      return s.nodes.find(
        (x: {
          data: { componentType: string; params: Array<{ key: string; value: string }> };
        }) =>
          x.data.componentType === "rename_field" &&
          x.data.params.some((p) => p.key === "old_name" && p.value === "text"),
      )?.id as string;
    });
    expect(renameNodeId).toBeTruthy();
    await page.evaluate((id) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__protolabStore
        .getState()
        .updateParam(id, "new_name", "orphanedField");
    }, renameNodeId);

    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible();
    await page.locator('[data-widget="run_button"]').click();

    const err = await expect
      .poll(
        () =>
          page.evaluate(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            () => (window as any).__protolabStore.getState().evaluationError,
          ),
        { timeout: 10_000 },
      )
      .toBeTruthy()
      .then(() =>
        page.evaluate(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          () => (window as any).__protolabStore.getState().evaluationError as string,
        ),
      );

    // Naming the field and the unbound variable is the whole value of
    // reporting over discarding: it says which step broke and what it
    // could not find.
    expect(err).toContain("charCount");
    expect(err).toContain("body");
  });
});

base.describe("schema assignment is shared across modes", () => {
  base("assigning target in edit Inspector then toggling to presentation shows the same assignment", async ({
    page,
  }) => {
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    const handle = await page.evaluate(async () => {
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
      (window as any).__protolabStore.getState().assignTargetSchema(h);
      return h;
    });
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible();
    // Store must still reflect the target handle assigned in edit mode.
    const targetAfterToggle = await readStore<number | null>(
      page,
      "s.targetSchemaHandle",
    );
    expect(targetAfterToggle).toBe(handle);
  });
});

base.describe("hint spec persists across mode toggle", () => {
  base("declare anchor in edit-mode HintEditor → presentation-mode HintEditor shows it", async ({
    page,
  }) => {
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    const handle = await page.evaluate(async () => {
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
      store.getState().regenerateWithHints({
        anchors: { "app.bsky.feed.post": "app.bsky.feed.post" },
      });
      return h;
    });
    expect(handle).toBeGreaterThan(0);
    // Toggle to presentation mode.
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible();
    // The store's autoLensHints should still contain the anchor.
    const hintsAfterToggle = await readStore<{
      anchors?: Record<string, string>;
    }>(page, "s.autoLensHints");
    expect(hintsAfterToggle.anchors).toMatchObject({
      "app.bsky.feed.post": "app.bsky.feed.post",
    });
  });
});

base.describe("circuit mutation in one mode is reflected in the other", () => {
  base("delete a component in edit → node count visible in presentation widgets drops", async ({
    page,
  }) => {
    await page.goto("/?mode=edit");
    await expect(page.locator(".react-flow__node")).toHaveCount(3, {
      timeout: 15_000,
    });
    // Remove the DropField component via the store.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__protolabStore.getState();
      const drop = s.nodes.find(
        (n: { data: { componentType: string } }) =>
          n.data.componentType === "drop_field",
      );
      s.removeComponent(drop.id);
    });
    // Count in edit mode: 2.
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
    // Toggle to presentation. The edit-mode circuit lives on; the
    // presentation layer has no circuit-nodes of its own, so the
    // assertion targets the store directly.
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible();
    const count = await readStore<number>(page, "s.nodes.length");
    expect(count).toBe(2);
    // Toggle back — should still be 2, not reset to 3.
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(2);
  });
});
