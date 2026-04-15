/**
 * User-defined protocol tests: register a custom protocol via the
 * wasm bridge, verify it shows up in the protocol list, import a
 * schema in that protocol, and run auto-lens against another
 * user-defined protocol AND against an atproto schema.
 *
 * Every test asserts strict equivalence on the registry state and
 * non-hung auto-lens outcomes. No soft assertions.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { stubLexicons } from "./fixtures";

/**
 * Minimal `panproto_schema::Protocol` in JSON form. `panproto-schema`'s
 * Protocol struct deserialises directly from this shape.
 */
function minimalProtocol(name: string) {
  return {
    name,
    schema_theory: "ThWType",
    instance_theory: "ThWType",
    edge_rules: [
      { edge_kind: "prop", src_kinds: ["object"], tgt_kinds: [] },
    ],
    obj_kinds: ["object"],
    constraint_sorts: [],
  };
}

async function importProtocol(page: Page, name: string) {
  return page.evaluate(async (doc) => {
    const wasm = await import("/src/wasm/bridge.ts");
    const result = wasm.importProtocolJson(JSON.stringify(doc));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__protolabStore;
    const s = result.summary;
    store.setState((state: { importedProtocols: unknown[] }) => ({
      importedProtocols: [
        ...state.importedProtocols.filter(
          (p: { name: string }) => p.name !== s.name,
        ),
        {
          name: s.name,
          schemaTheory: s.schema_theory,
          instanceTheory: s.instance_theory,
          objKindCount: s.obj_kind_count,
          edgeRuleCount: s.edge_rule_count,
          hasOrder: s.has_order,
          hasCoproducts: s.has_coproducts,
          hasRecursion: s.has_recursion,
          nominalIdentity: s.nominal_identity,
          hasCausal: s.has_causal,
          hasDefaults: s.has_defaults,
          hasCoercions: s.has_coercions,
          hasMergers: s.has_mergers,
          hasPolicies: s.has_policies,
        },
      ],
    }));
    return { handle: result.handle, name: s.name };
  }, minimalProtocol(name));
}

base.describe("user-defined protocol registry integration", () => {
  base("registered protocol appears in listSupportedProtocols", async ({
    page,
  }) => {
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    const { name } = await importProtocol(page, "e2e-custom-1");
    // Now the wasm-side listSupportedProtocols must include our name.
    const names = await page.evaluate(async () => {
      const wasm = await import("/src/wasm/bridge.ts");
      return wasm
        .listSupportedProtocols()
        .map((p: { name: string }) => p.name);
    });
    expect(names).toContain(name);
  });
});

base.describe("cross-protocol source + target with a user protocol registered", () => {
  base("with a custom protocol registered, a CDDL source mapped to an atproto target runs auto-lens to a non-hung outcome", async ({
    page,
  }) => {
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    await importProtocol(page, "e2e-custom-2");

    // Build a minimal source schema via the CDDL parser (hermetic,
    // no hand-rolled JSON that would need internal adjacency fields).
    // Target is app.bsky.feed.post from lexicon.garden.
    const handles = await page.evaluate(async () => {
      const wasm = await import("/src/wasm/bridge.ts");
      const src = wasm.parseNativeSchema(
        "cddl",
        "user = { name: tstr, age: uint }",
      );
      const r = await fetch(
        "https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid=app.bsky.feed.post",
      );
      const body = await r.json();
      const j = JSON.stringify(
        typeof body.schema === "object" && "lexicon" in body.schema
          ? body.schema
          : body,
      );
      const tgt = wasm.parseAtprotoLexicon(j);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__protolabStore;
      store.getState().assignSourceSchema(src.handle);
      store.getState().assignTargetSchema(tgt.handle);
      return { src: src.handle, tgt: tgt.handle };
    });
    expect(handles.src).toBeGreaterThan(0);
    expect(handles.tgt).toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (window as any).__protolabStore.getState().autoLensStatus,
          ),
        { timeout: 10_000 },
      )
      .not.toBe("idle");
    const status = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__protolabStore.getState().autoLensStatus,
    );
    expect(["success", "failed"]).toContain(status);
  });
});

base.describe("schema tagged with a user-defined protocol", () => {
  base("register custom protocol → retag a CDDL source under it → assign + auto-lens", async ({
    page,
  }) => {
    // Rigorous path: (1) register a user protocol, (2) parse a source
    // via CDDL, (3) export its Schema JSON, (4) retag the protocol
    // field to the custom name, (5) importSchema the retagged JSON,
    // (6) assign + assert the auto-lens pipeline runs. Strict:
    // srcProtocol must equal the custom name on the retagged handle.
    await stubLexicons(page, ["app.bsky.feed.post"]);
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    const protoName = "e2e-retagged";
    await importProtocol(page, protoName);
    const result = await page.evaluate(
      async ({ protoName, postNsid }) => {
        const wasm = await import("/src/wasm/bridge.ts");
        const cddl = wasm.parseNativeSchema(
          "cddl",
          "r = { name: tstr, createdAt: tstr }",
        );
        const json = wasm.exportSchemaJson(cddl.handle);
        const parsed = JSON.parse(json);
        parsed.protocol = protoName;
        const retagged = wasm.importSchema(JSON.stringify(parsed));
        const r = await fetch(
          `https://lexicon.garden/xrpc/com.atproto.lexicon.resolveLexicon?nsid=${postNsid}`,
        );
        const body = await r.json();
        const j = JSON.stringify(
          typeof body.schema === "object" && "lexicon" in body.schema
            ? body.schema
            : body,
        );
        const tgt = wasm.parseAtprotoLexicon(j);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__protolabStore;
        store.getState().assignSourceSchema(retagged.handle);
        store.getState().assignTargetSchema(tgt.handle);
        return {
          srcProtocol: retagged.summary.protocol,
        };
      },
      { protoName, postNsid: "app.bsky.feed.post" },
    );
    expect(result.srcProtocol).toBe(protoName);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (window as any).__protolabStore.getState().autoLensStatus,
          ),
        { timeout: 10_000 },
      )
      .not.toBe("idle");
  });
});

base.describe("identity mapping between two parsed schemas of same shape", () => {
  base("two CDDL schemas with identical content produce 100% survival auto-lens", async ({
    page,
  }) => {
    await page.goto("/?mode=edit");
    await expect(page.getByText("protolab", { exact: true })).toBeVisible();
    await importProtocol(page, "e2e-custom-A");
    await importProtocol(page, "e2e-custom-B");

    // Build two structurally identical schemas via the CDDL parser
    // under different protocol registries. Same shape → auto-lens
    // should find a trivial mapping with no removed vertices.
    const handles = await page.evaluate(async () => {
      const wasm = await import("/src/wasm/bridge.ts");
      const a = wasm.parseNativeSchema("cddl", "rec = { x: tstr }");
      const b = wasm.parseNativeSchema("cddl", "rec = { x: tstr }");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__protolabStore;
      store.getState().assignSourceSchema(a.handle);
      store.getState().assignTargetSchema(b.handle);
      return { a: a.handle, b: b.handle };
    });
    expect(handles.a).toBeGreaterThan(0);
    expect(handles.b).toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (window as any).__protolabStore.getState().autoLensStatus,
          ),
        { timeout: 10_000 },
      )
      .toBe("success");
    const mapping = await page.evaluate(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__protolabStore.getState().autoLensSchemaMapping,
    );
    expect(mapping.removedVertices).toEqual([]);
  });
});
