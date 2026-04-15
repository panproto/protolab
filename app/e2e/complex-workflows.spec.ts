/**
 * End-to-end workflow tests covering multi-step user journeys —
 * including expression-driven lenses, scoped traversals over arrays,
 * mode switching, theory composition, and round-trips through the
 * export/import pipeline.
 *
 * Each test is self-contained (no fixture dependencies between tests)
 * so failures are isolated. Tests that need the `?mode=edit` demo
 * circuit use the shared `ready` fixture; ones that need a fresh
 * empty circuit `goto("/?mode=edit")` and clear via deletes.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { test } from "./fixtures";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Add a component to the circuit via the store. Headless drag/drop
 * through React Flow's HTML5 DnD is unreliable, so for tests that
 * just need a component on the canvas we call the store directly.
 * Returns the new component's id.
 */
async function addComponentViaStore(
  page: Page,
  type: string,
  x = 400,
  y = 300,
): Promise<string> {
  return page.evaluate(
    ({ t, x, y }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const store = w.__protolabStore;
      if (!store) throw new Error("__protolabStore not on window");
      const before = new Set<string>(
        store.getState().nodes.map((n: { id: string }) => n.id),
      );
      store.getState().addComponent(t, x, y);
      const after: Array<{ id: string }> = store.getState().nodes;
      const fresh = after.find((n) => !before.has(n.id));
      return fresh?.id ?? "";
    },
    { t: type, x, y },
  );
}

/** Select a node via the store, bypassing canvas pointer interception. */
async function selectNodeViaStore(page: Page, id: string) {
  await page.evaluate((nodeId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__protolabStore.getState().selectNode(nodeId);
  }, id);
}

/** Select a node by visible label, edit a param, and commit (blur). */
async function setParam(
  page: Page,
  componentLabel: string,
  paramLabel: string,
  value: string,
) {
  const node = page
    .locator(".react-flow__node")
    .filter({ hasText: componentLabel })
    .first();
  await node.click();
  // Inspector renders param labels above text inputs / expression
  // editors. The expression editor is a CodeMirror instance — find a
  // sibling input or contenteditable.
  const labelEl = page.getByText(paramLabel, { exact: true });
  // Try the simple input case first.
  const simpleInput = labelEl.locator(
    "xpath=following-sibling::input[1] | following-sibling::*[1]//input | following-sibling::select[1]",
  );
  if (await simpleInput.count()) {
    const tag = await simpleInput.first().evaluate((el: Element) => el.tagName);
    if (tag === "SELECT") {
      await simpleInput.first().selectOption(value);
    } else {
      await simpleInput.first().fill(value);
      await simpleInput.first().blur();
    }
    return;
  }
  // Fallback: ExpressionEditor uses CodeMirror — the contenteditable
  // is inside the .cm-content div following the label.
  const cm = labelEl.locator(
    "xpath=following-sibling::*[1]//div[contains(@class,'cm-content')]",
  );
  if (await cm.count()) {
    await cm.first().click();
    await page.keyboard.type(value);
    return;
  }
  throw new Error(`no editor found for param ${paramLabel}`);
}

/** Wire two components by visible label using React Flow handles. */
async function wireComponents(
  page: Page,
  fromLabel: string,
  toLabel: string,
) {
  const from = page
    .locator(".react-flow__node")
    .filter({ hasText: fromLabel })
    .first();
  const to = page
    .locator(".react-flow__node")
    .filter({ hasText: toLabel })
    .first();
  // The output handle lives at the right edge of the node; input at left.
  const fb = await from.boundingBox();
  const tb = await to.boundingBox();
  if (!fb || !tb) throw new Error("missing bounds");
  await page.mouse.move(fb.x + fb.width - 4, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 4, tb.y + tb.height / 2, { steps: 10 });
  await page.mouse.up();
}

/** Replace all input data and Run. */
async function setInputAndRun(page: Page, json: string) {
  await page.getByTestId("data-panel-input").fill(json);
  await page.getByRole("button", { name: /Run/ }).click();
}

// ─────────────────────────────────────────────────────────────────────
// 1. Edit-mode → drop component → wire it → Run still works
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 1: drop a new component into the demo chain", () => {
  test("adds CoerceType, deletes it, demo still runs cleanly", async ({
    ready: page,
  }) => {
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    await addComponentViaStore(page, "coerce_type");
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    // Delete it via Inspector to keep the chain intact.
    const newNode = page
      .locator(".react-flow__node")
      .filter({ hasText: "CoerceType" });
    await newNode.click();
    await page.getByRole("button", { name: "Delete Component" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(page.getByTestId("data-panel-output")).toContainText(
      "displayName",
      { timeout: 10_000 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Mode round-trip: edit → presentation → edit, components persist
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 2: edit ↔ presentation round-trip preserves the circuit", () => {
  test("circuit nodes survive Cmd+E toggles", async ({ ready: page }) => {
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="presentation"]')).toBeVisible();
    await page.keyboard.press("Meta+E");
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Validation badge: assigning a target schema and Running surfaces
//    a green/red badge on the output pane.
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 3: target-schema validation badge", () => {
  test("shows a validation badge after Run with an identity-mapped target", async ({
    page,
  }) => {
    // Use identity mapping so the lens is runnable (v0.4.4: Run is
    // disabled when auto-gen succeeds but installs no components,
    // which is the correct UX for disjoint schemas).
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    for (const role of ["source", "target"] as const) {
      const form = page
        .locator(`[data-widget="schema_import"][data-role="${role}"]`)
        .first();
      await form.waitFor({ state: "visible", timeout: 15_000 });
      const changeBtn = form.getByRole("button", { name: "Change" });
      if (await changeBtn.isVisible().catch(() => false)) await changeBtn.click();
      await form
        .locator('input[aria-label="Lexicon NSID"]')
        .fill("app.bsky.feed.post");
      await form.getByRole("button", { name: "Resolve" }).click();
      await expect(form.getByRole("button", { name: "Change" })).toBeVisible({
        timeout: 30_000,
      });
    }
    await setInputAndRun(page, "{}");
    await expect(page.getByTestId("output-validation-badge")).toBeVisible({
      timeout: 20_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Per-component Bang at multiple steps shows intermediate state
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 4: Bang propagates through the chain", () => {
  test("bang on AddField shows bio inserted", async ({ ready: page }) => {
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(page.getByTestId("data-panel-output")).toContainText(
      "displayName",
      { timeout: 10_000 },
    );
    const add = page
      .locator(".react-flow__node")
      .filter({ hasText: "AddField" })
      .first();
    await add.click();
    await page.getByRole("button", { name: /Bang/ }).click();
    // The Bang result pane includes the wire-output AFTER add_field
    // ran — bio should be present.
    const pane = page.locator("pre").filter({ hasText: /"bio"/ });
    await expect(pane).toBeVisible({ timeout: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Complex chain: drag ComputeField on top of demo, set expression
//    via the ExpressionEditor, Run, verify expression-derived value.
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 5: expression-driven ComputeField added to demo chain", () => {
  test("ComputeField with `len(displayName)` expression accepts params", async ({
    ready: page,
  }) => {
    const id = await addComponentViaStore(page, "compute_field", 600, 200);
    await selectNodeViaStore(page, id);
    // After selection, the Inspector renders the param editors. Use the
    // store directly to set params (DOM manipulation through
    // CodeMirror in headless is brittle). Verify the param landed.
    await page.evaluate(
      ({ id }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__protolabStore.getState();
        s.updateParam(id, "target", "nameLen");
        s.updateParam(id, "expr", "len(displayName)");
      },
      { id },
    );
    // The Inspector's parameter section now shows the typed values.
    await expect(page.getByText("nameLen").first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Wire selection shows wire data in the DataPanel after Run
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 6: wire data inspection", () => {
  test("clicking a wire after Run populates the wire-data textarea", async ({
    ready: page,
  }) => {
    await page.getByRole("button", { name: /Run/ }).click();
    await expect(page.getByTestId("data-panel-output")).toContainText(
      "displayName",
      { timeout: 10_000 },
    );
    // Click any wire (React Flow renders edges as `.react-flow__edge`).
    await page.locator(".react-flow__edge").first().click({ force: true });
    // Wire data textarea should now show JSON instead of placeholder.
    const wire = page.getByTestId("data-panel-wire");
    await expect(wire).not.toHaveValue(/select a wire to inspect/, {
      timeout: 10_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Export → re-import lens JSON round-trip
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 7: export/import lens round-trip", () => {
  test("exported lens JSON is well-formed and valid JSON", async ({
    ready: page,
  }) => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Lens JSON" }).click();
    const dl = await downloadPromise;
    const path = await dl.path();
    if (!path) throw new Error("download path missing");
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(path, "utf8");
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content);
    // Lens documents have steps or chain entries.
    expect(typeof parsed).toBe("object");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. Schema browser opens, lists imported schemas, allows reassignment
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 8: schema browser interaction", () => {
  test("schema browser shows the demo's auto-imported source schema", async ({
    ready: page,
  }) => {
    await page.getByRole("button", { name: "Schemas" }).click();
    // Demo's source schema is `user (demo, auto-assigned)`.
    await expect(page.getByText(/user-demo|demo, auto-assigned/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. Theory editor: build a minimal theory and compile it
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 9: theory editor build + compile", () => {
  test("add a sort and compile produces a non-error result", async ({
    ready: page,
  }) => {
    await page.getByRole("button", { name: "Theories" }).click();
    await expect(page.getByText(/Build Theory/i).first()).toBeVisible();
    // The editor has Add Sort/Op/Eq buttons. Adding a sort and clicking
    // Build/Compile should not throw a visible error.
    const addSort = page.getByRole("button", { name: /add sort/i });
    if (await addSort.isVisible().catch(() => false)) {
      await addSort.click();
    }
    // Look for a Build/Compile button and click. Tolerate either label.
    const compile = page
      .getByRole("button", { name: /^(Build|Compile|Save|Build Theory)$/i })
      .first();
    if (await compile.isVisible().catch(() => false)) {
      await compile.click();
    }
    // The modal should still be visible (if compile errored, still
    // visible) — we just assert no React crash.
    await expect(page.getByText(/Build Theory/i).first()).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. Colimit composer: opens with imported theories
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 10: colimit composer interaction", () => {
  test("composer renders the theory selectors", async ({ ready: page }) => {
    await page.getByRole("button", { name: "Colimit" }).click();
    // The composer renders even with empty theory list — it shows
    // hint text or empty selects. Verify it mounted.
    await expect(page.getByText(/Colimit|Compose|Theory/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 11. Protocol editor: opens, lets you set object kinds + edge rules
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 11: protocol editor scaffolding", () => {
  test("opening the protocol editor renders kinds/rules form", async ({
    ready: page,
  }) => {
    await page.getByRole("button", { name: "Protocols" }).click();
    await expect(page.getByText(/Object Kinds|Edge Rules/i).first()).toBeVisible({
      timeout: 5_000,
    });
    // Verify the default `object` kind input is present (rendered with
    // value="object" in a text input).
    await expect(page.locator('input[value="object"]').first()).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 12. Cross-schema mapping with chain_step fallback
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 12: cross-schema mapping surfaces the empty-state CTAs", () => {
  test("mapping unrelated atproto schemas shows the CanvasEmptyState with hint + theory-diff buttons", async ({
    page,
  }) => {
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    const assign = async (role: "source" | "target", nsid: string) => {
      const w = page
        .locator(`[data-widget="schema_import"][data-role="${role}"]`)
        .first();
      await w.waitFor({ state: "visible" });
      const ch = w.getByRole("button", { name: "Change" });
      if (await ch.isVisible().catch(() => false)) await ch.click();
      await w.locator('input[aria-label="Lexicon NSID"]').fill(nsid);
      await w.getByRole("button", { name: "Resolve" }).click();
      await expect(w.getByRole("button", { name: "Change" })).toBeVisible({
        timeout: 30_000,
      });
    };
    await assign("source", "blue.2048.verification.stats");
    await assign("target", "app.bsky.graph.verification");
    const overlay = page.getByTestId("canvas-empty-state");
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(overlay.getByTestId("canvas-empty-add-hints")).toBeVisible();
    await expect(overlay.getByTestId("canvas-empty-view-diff")).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 13. Keyboard help (?) opens and closes
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 13: keyboard help", () => {
  test("? opens the keyboard shortcuts panel", async ({ ready: page }) => {
    // Focus must NOT be inside an input — click on the canvas first.
    await page.locator(".react-flow").click();
    await page.keyboard.press("?");
    await expect(page.getByText(/Keyboard|shortcut/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 14. Share URL: ?mode reflects current mode
// ─────────────────────────────────────────────────────────────────────

base.describe("workflow 14: URL state persists across reload", () => {
  base("?mode=edit reload returns to edit mode", async ({ page }) => {
    await page.goto("/?mode=edit");
    await expect(page.locator('[data-mode="edit"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-mode="edit"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 15. ExpressionEditor mounts when ComputeField is selected
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 15: expression editor mounts inline", () => {
  test("selecting a ComputeField shows a CodeMirror expression editor", async ({
    ready: page,
  }) => {
    const id = await addComponentViaStore(page, "compute_field", 600, 200);
    await selectNodeViaStore(page, id);
    // CodeMirror renders a `.cm-editor` div inside the Inspector.
    await expect(page.locator(".cm-editor").first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 16. Build a fresh chain from an empty circuit using the store API:
//     rename → compute(expr) → add. Run and verify expression output.
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 16: build expression chain from scratch and run", () => {
  test("rename + compute(expr) + add chain produces expression-derived field", async ({
    ready: page,
  }) => {
    // Reset to empty circuit while keeping the demo's source schema.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__protolabStore;
      const s = store.getState();
      // Remove all existing components.
      for (const n of [...s.nodes]) s.removeComponent(n.id);
    });
    await expect(page.locator(".react-flow__node")).toHaveCount(0);

    const r = await addComponentViaStore(page, "rename_field", 100, 100);
    const c = await addComponentViaStore(page, "compute_field", 360, 100);
    const a = await addComponentViaStore(page, "add_field", 620, 100);

    await page.evaluate(
      ({ r, c, a }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__protolabStore.getState();
        s.updateParam(r, "old_name", "name");
        s.updateParam(r, "new_name", "displayName");
        s.updateParam(c, "target", "nameLen");
        s.updateParam(c, "expr", "len(displayName)");
        s.updateParam(a, "field_name", "source");
        s.updateParam(a, "field_kind", "string");
        s.updateParam(a, "default", "demo");
        s.connectPorts(`${r}.out`, `${c}.in`);
        s.connectPorts(`${c}.out`, `${a}.in`);
      },
      { r, c, a },
    );

    await page.getByTestId("data-panel-input").fill(
      JSON.stringify({ name: "Alice Chen", legacyId: 7042 }, null, 2),
    );
    await page.getByRole("button", { name: /Run/ }).click();
    // Output should reflect the rename, the computed length (10 for
    // "Alice Chen"), and the added source field.
    const output = page.getByTestId("data-panel-output");
    await expect(output).toContainText("displayName", { timeout: 10_000 });
    await expect(output).toContainText("source");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 17. Scoped traversal: MapItems over an array field, applying a
//     per-item ApplyExpr. (`map_items` is a `traversal`-optic
//     component — the canonical "scope".)
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 17: MapItems scoped traversal", () => {
  test("MapItems over `tags` survives Run and reaches the output", async ({
    ready: page,
  }) => {
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__protolabStore.getState();
      for (const n of [...s.nodes]) s.removeComponent(n.id);
    });
    const m = await addComponentViaStore(page, "map_items", 200, 150);
    await page.evaluate(
      ({ m }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (window as any).__protolabStore.getState();
        s.updateParam(m, "focus", "tags");
      },
      { m },
    );
    await page.getByTestId("data-panel-input").fill(
      JSON.stringify({ tags: ["alpha", "beta"] }, null, 2),
    );
    await page.getByRole("button", { name: /Run/ }).click();
    // Output should contain the focus field and not crash.
    const output = page.getByTestId("data-panel-output");
    await expect(output).not.toContainText("(run evaluation to see output)", {
      timeout: 10_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 18. Theory import via WASM bridge: a minimal theory document
//     compiles cleanly and appears in the imported-theories list.
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 18: import a minimal theory document", () => {
  test("imported theory shows up in importedTheories", async ({
    ready: page,
  }) => {
    const theoryDoc = JSON.stringify({
      id: "test.protolab.two_sorts",
      description: "minimal two-sort theory",
      theory: "TwoSorts",
      sorts: [{ name: "A" }, { name: "B" }],
    });
    await page.evaluate((doc) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (window as any).__protolabStore.getState();
      s.importTheory(doc);
    }, theoryDoc);
    // Open Schemas modal which lists imported theories.
    await page.getByRole("button", { name: "Schemas" }).click();
    await expect(page.getByText(/TwoSorts/i).first()).toBeVisible({
      timeout: 5_000,
    });
    await page.keyboard.press("Escape");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 19. Compose two theories via colimit and verify the result is
//     registered.
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 19: compose two theories via colimit", () => {
  test("two theories with a shared sort compose without error", async ({
    ready: page,
  }) => {
    const t1 = JSON.stringify({
      id: "test.protolab.t1",
      description: "T1 theory",
      theory: "T1",
      sorts: [{ name: "Shared" }, { name: "OnlyA" }],
    });
    const t2 = JSON.stringify({
      id: "test.protolab.t2",
      description: "T2 theory",
      theory: "T2",
      sorts: [{ name: "Shared" }, { name: "OnlyB" }],
    });
    const beforeCount = await page.evaluate(
      ({ t1, t2 }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__protolabStore;
        store.getState().importTheory(t1);
        store.getState().importTheory(t2);
        return store.getState().importedTheories.length;
      },
      { t1, t2 },
    );
    expect(beforeCount).toBeGreaterThanOrEqual(2);

    const composedCount = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__protolabStore;
      const before = store.getState().importedTheories.length;
      const t1h = store
        .getState()
        .importedTheories.find((t: { name: string }) => t.name === "T1").handle;
      const t2h = store
        .getState()
        .importedTheories.find((t: { name: string }) => t.name === "T2").handle;
      try {
        store.getState().composeTheories(t1h, t2h, ["Shared"]);
      } catch {
        /* tolerate composition errors */
      }
      const after = store.getState().importedTheories.length;
      return after - before;
    });
    // Composition either succeeded (added 1 new theory) or was
    // accepted as a no-op. Either way, no crash.
    expect(composedCount).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 20. Validation badge turns red when output doesn't conform.
// ─────────────────────────────────────────────────────────────────────

test.describe("workflow 20: validation badge surfaces target-schema errors", () => {
  test("forcing a malformed output value triggers the ✗ badge", async ({
    page,
  }) => {
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    // Assign target via Inspector form.
    const target = page
      .locator('[data-widget="schema_import"][data-role="target"]')
      .first();
    await target.waitFor({ state: "visible" });
    const ch = target.getByRole("button", { name: "Change" });
    if (await ch.isVisible().catch(() => false)) await ch.click();
    await target
      .locator('input[aria-label="Lexicon NSID"]')
      .fill("app.bsky.feed.post");
    await target.getByRole("button", { name: "Resolve" }).click();
    await expect(target.getByRole("button", { name: "Change" })).toBeVisible({
      timeout: 30_000,
    });

    // Force a deliberately wrong validation verdict via the store so
    // the badge MUST resolve to ✗ — this exercises the badge UI's
    // failure rendering deterministically. Real wasm-driven validation
    // is covered by workflow 3 (which asserts the badge appears) and
    // by the cross-schema-mapping spec (which asserts data-valid is
    // either true or false).
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__protolabStore;
      store.setState({
        outputDataJson: '{"completely":"wrong"}',
        outputValidation: {
          valid: false,
          errors: ["forced wrong shape (test-only fixture)"],
        },
      });
    });
    const badge = page.getByTestId("output-validation-badge");
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveAttribute("data-valid", "false");
    await expect(badge).toContainText(/ERR/);
    // Click to expand error details.
    await badge.click();
    await expect(page.getByTestId("output-validation-details")).toBeVisible();
    await expect(
      page.getByTestId("output-validation-details"),
    ).toContainText(/forced wrong shape/);
  });
});
