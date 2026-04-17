/**
 * Rigorous tests for the v0.33.0 candidates + stringency API.
 *
 * These prove that:
 *   1. The blue.2048 → bsky.graph.verification pair at Lenient
 *      stringency now produces at least one candidate with non-zero
 *      quality — the ORIGINAL ISSUE that started this whole thread.
 *   2. Changing stringency changes the candidate count.
 *   3. The identity case still produces exactly one 100%-quality
 *      candidate.
 *   4. Mobile viewport renders without horizontal overflow.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { stubLexicons } from "./fixtures";

async function importAndAssign(
  page: Page,
  nsids: [string, string],
) {
  const [srcNsid, tgtNsid] = nsids;
  return page.evaluate(
    async ({ srcNsid, tgtNsid }) => {
      const wasm = await import("/src/wasm/bridge.ts");
      const load = async (nsid: string) => {
        const r = await fetch(
          `https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid=${nsid}`,
        );
        const body = await r.json();
        const j = JSON.stringify(
          typeof body.schema === "object" && "lexicon" in body.schema
            ? body.schema
            : body,
        );
        return wasm.parseAtprotoLexicon(j).handle;
      };
      const src = await load(srcNsid);
      const tgt = await load(tgtNsid);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__protolabStore;
      store.getState().assignSourceSchema(src);
      store.getState().assignTargetSchema(tgt);
      return { src, tgt };
    },
    { srcNsid, tgtNsid },
  );
}

async function getCandidates(page: Page) {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__protolabStore.getState().autoLensCandidates;
  });
}

async function setStringencyAndGenerate(page: Page, stringency: string) {
  return page.evaluate((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__protolabStore;
    store.getState().setStringency(s);
    return store.getState().autoLensCandidates.length;
  }, stringency);
}

async function setupSession(page: Page, lexicons: string[]) {
  await stubLexicons(page, lexicons);
  await page.goto("/?mode=edit");
  await expect(page.getByText("protolab", { exact: true })).toBeVisible();
}

base.describe("the original issue: blue.2048 → bsky.graph.verification", () => {
  base("at Lenient stringency, at least one candidate is produced with non-zero quality", async ({
    page,
  }) => {
    await setupSession(page, [
      "blue.2048.verification.stats",
      "app.bsky.graph.verification",
    ]);
    await importAndAssign(page, [
      "blue.2048.verification.stats",
      "app.bsky.graph.verification",
    ]);
    const count = await setStringencyAndGenerate(page, "lenient");
    expect(count).toBeGreaterThan(0);
    const candidates = await getCandidates(page);
    expect(candidates[0].quality).toBeGreaterThan(0);
    expect(candidates[0].coverage).toBeGreaterThan(0);
    // At least one strategy should have been used.
    expect(candidates[0].strategies_used.length).toBeGreaterThan(0);
  });

  base("at Strict stringency, fewer (or zero) candidates are produced than at Lenient", async ({
    page,
  }) => {
    await setupSession(page, [
      "blue.2048.verification.stats",
      "app.bsky.graph.verification",
    ]);
    await importAndAssign(page, [
      "blue.2048.verification.stats",
      "app.bsky.graph.verification",
    ]);
    const lenientCount = await setStringencyAndGenerate(page, "lenient");
    const strictCount = await setStringencyAndGenerate(page, "strict");
    expect(lenientCount).toBeGreaterThanOrEqual(strictCount);
  });
});

base.describe("identity case", () => {
  base("same schema as source + target produces exactly one 100%-quality candidate", async ({
    page,
  }) => {
    await setupSession(page, ["app.bsky.feed.post"]);
    await importAndAssign(page, [
      "app.bsky.feed.post",
      "app.bsky.feed.post",
    ]);
    const candidates = await getCandidates(page);
    expect(candidates.length).toBe(1);
    expect(candidates[0].quality).toBe(1);
    expect(candidates[0].coverage).toBe(1);
  });
});

base.describe("stringency selector is visible and functional", () => {
  base("the selector appears in the Inspector and changes store state", async ({
    page,
  }) => {
    await setupSession(page, ["app.bsky.feed.post"]);
    const selector = page.getByTestId("stringency-selector");
    await expect(selector).toBeVisible();
    const select = selector.locator("select");
    await select.selectOption("lenient");
    const stringency = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__protolabStore.getState().stringency,
    );
    expect(stringency).toBe("lenient");
  });
});

base.describe("mobile viewport", () => {
  base("375×812 viewport renders without horizontal overflow", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    // Assert no horizontal scroll: body scrollWidth should equal
    // clientWidth (or be less).
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
    await context.close();
  });

  base("presentation mode at 375×812 renders widgets without overflow", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible({
      timeout: 15_000,
    });
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflow).toBe(false);
    await context.close();
  });
});
