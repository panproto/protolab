/**
 * Hover tooltip on a wire renders the component-specific complement info
 * (or the generic optic description when no complement info is supplied).
 *
 * This replaces the skipped vitest test in
 * `src/edges/__tests__/WireEdge.test.tsx`. React Flow v12's
 * `EdgeLabelRenderer` is a portal that needs a real canvas + DOM layout,
 * which vitest + jsdom can't provide. With a real browser Playwright can
 * hover the edge and see the rendered tooltip.
 *
 * Key test-infra insight (do not remove this comment): Playwright's
 * `page.mouse.move(x, y)` without a `steps` argument teleports the
 * pointer and does NOT reliably fire React's synthetic `mouseenter`,
 * because React 18 routes mouse enter/leave through native `mouseover`
 * events which only fire when the pointer trajectory crosses a DOM
 * boundary. Using `{ steps: 5 }` simulates a real motion and fires the
 * events correctly. `locator.hover()` and `dispatchEvent('mouseenter')`
 * both fail to trigger the tooltip.
 */

import { test, expect, type Page } from "@playwright/test";
import { test as fixtureTest } from "./fixtures";

async function hoverEdgeByLabel(page: Page, label: string) {
  // React Flow stamps `aria-label="Edge from {source} to {target}"` on
  // each edge <g>. This is stable across runs, unlike index-based
  // selectors which depend on the non-deterministic HashMap order the
  // Rust backend iterates edges in.
  const edge = page.getByRole("group", { name: label });
  await expect(edge).toBeVisible();
  const box = await edge.boundingBox();
  if (!box) throw new Error(`edge ${label} has no bounding box`);
  // Park the mouse outside the canvas first so the motion into the edge
  // bbox fires a proper mouseover trajectory.
  await page.mouse.move(0, 0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 5,
  });
}

/** Locator scoped to the React Flow edge-label portal container — the
 *  tooltips render here via `EdgeLabelRenderer`, so scoping assertions
 *  to this subtree avoids collisions with palette badges and node
 *  labels that happen to contain the same text ("iso", "lens"). */
function tooltipScope(page: Page) {
  return page.locator(".react-flow__edgelabel-renderer");
}

fixtureTest.describe("WireEdge tooltip", () => {
  fixtureTest("hovering the add→drop wire shows its lens badge and complement info", async ({
    ready: page,
  }) => {
    // The `add → drop` wire has `complementInfo` populated by Rust's
    // `compute_complement_info` for the source component (add_field),
    // so the tooltip shows the add_field complement text.
    await hoverEdgeByLabel(page, "Edge from add to drop");

    // Scope to the label-renderer container to avoid matching palette or
    // node-body text that also contains "lens".
    const scope = tooltipScope(page);
    await expect(scope.getByText("lens", { exact: true })).toBeVisible();
    await expect(
      scope.getByText(/Adds field .* Complement records/i),
    ).toBeVisible();
  });

  fixtureTest("hovering the rename→add wire shows its iso badge and rename info", async ({
    ready: page,
  }) => {
    // `rename → add`. rename_field is an Iso, so the badge reads `iso`
    // and the complement info describes the rename operation.
    await hoverEdgeByLabel(page, "Edge from rename to add");

    const scope = tooltipScope(page);
    await expect(scope.getByText("iso", { exact: true })).toBeVisible();
    await expect(scope.getByText(/Isomorphism.*renames/i)).toBeVisible();
  });

  fixtureTest("moving the mouse away dismisses the tooltip", async ({
    ready: page,
  }) => {
    await hoverEdgeByLabel(page, "Edge from add to drop");
    const scope = tooltipScope(page);
    const tooltip = scope.getByText(/Adds field .* Complement records/i);
    await expect(tooltip).toBeVisible();

    // Move well away from any edge — into the top-left corner which is
    // above the Toolbar.
    await page.mouse.move(5, 5, { steps: 5 });

    // `EdgeLabelRenderer` unmounts the tooltip children on mouseleave.
    await expect(tooltip).not.toBeVisible();
  });
});
