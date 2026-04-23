# Changelog

All notable changes to protolab are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Open Graph card (`app/public/og.png`, 1200×630) rendered from
  `app/public/og.html` via headless Chrome. Depicts a three-node
  `RenameField → MapItems → CoerceType` circuit in the app's actual
  visual language, with a `protolab` wordmark and the tagline "a
  patchbay for your schemas."
- `og:*` and `twitter:*` meta tags in `app/index.html` pointing at
  `https://panproto.dev/protolab/og.png` so rich embeds populate on
  Twitter/X, Slack, LinkedIn, Discord, and iMessage.

### Changed

- README rewritten: trimmed feature-dump bullet lists, dropped the
  self-congratulatory sections, kept the useful bits (component table,
  install steps, project layout).

## [0.5.0] — 2026-04-17

### Added

- **panproto v0.33.0 integration** — the new Candidate API
  (`auto_generate_candidates` / `auto_generate_candidates_with_hints`)
  replaces the single-morphism auto-generation path. Each candidate
  carries quality, coverage, per-step explanations, strategy
  provenance, and a `lens_handle` for direct evaluation.
- **Stringency selector** (Strict / Balanced / Lenient / Exploratory)
  in the Inspector and CanvasEmptyState overlay. Changing stringency
  re-runs candidate generation at the new tier. At **Lenient**, the
  alias strategy recognizes `createdAt ≡ createdAt` automatically,
  the token-similarity strategy handles casing variations, and span
  search produces partial morphisms — **the original
  `blue.2048.verification.stats → app.bsky.graph.verification` case
  now produces at least one candidate with non-zero quality**, which
  was the issue that started this entire thread.
- **CandidateList + CandidateCard components** showing ranked
  candidates with quality/coverage badges, strategy-tag chips, and
  per-step explanations. Clicking a candidate selects it for
  evaluation. Mounted in the Inspector, the CanvasEmptyState overlay,
  and presentation mode.
- **`auto_generate_candidates` wasm export** returning MessagePack-
  encoded `{ candidates: Vec<CandidateDescWithHandle> }` with each
  candidate's lens stored in the slab for direct evaluation.
- **Mobile-responsive layout**: side panels (Palette, Inspector)
  hidden at ≤768px; DataPanel stacks vertically; React Flow minimap
  + controls hidden; toolbar flex-wraps instead of overflowing;
  modals go full-width; touch targets enlarged. Presentation mode
  already worked as a single column and now has explicit widget
  border-radius + padding tuning at ≤640px.
- 6 new rigorous e2e tests in `candidates-stringency.spec.ts`:
  blue.2048 at Lenient produces candidates (the original issue);
  Strict ≤ Lenient count monotonicity; identity → one 100%-quality
  candidate; stringency selector updates store; mobile 375×812
  viewport renders without horizontal overflow in both edit and
  presentation modes.

### Changed

- panproto upgraded across the workspace from v0.32.0 → **v0.33.0**
  (12 dependencies). See the [panproto v0.33.0 release
  notes](https://github.com/panproto/panproto/releases/tag/v0.33.0)
  for the full upstream changelog (Stringency axis, six alignment
  strategies, sort coercion, span search, candidate API,
  ComplementSpec serde rename).
- `assignTargetSchema` now calls both `generateCandidates()` (the
  v0.33.0 candidate path) and the legacy `autoGenerateLens()` for
  backwards compatibility with the existing chain-steps / mapping
  widget until the UI fully migrates.

### Known issues

- [panproto#40](https://github.com/panproto/panproto/issues/40):
  v0.33.0 `put()` regression scrambles field assignment in backward
  eval. The rename_field lens (name → displayName) backward-
  evaluates "Bob" into the email slot instead of the name slot.
  Three Apply Back e2e tests are gated behind `testInfo.fail()`
  until upstream resolves. Forward eval is unaffected.

## [0.4.5] — 2026-04-15

### Changed

- Upgrade panproto across the workspace from v0.30.1 → **v0.32.0**.
  v0.32 makes schemas *pointed* — `Schema.entries: Vec<Name>` is the
  basepoint family, materialised by every protocol parser per its
  own semantics (atproto records / openapi paths / cddl rules /
  avro top-level / etc.). The new
  [`panproto_schema::primary_entry`] is the canonical way to pick a
  parse root.
- `protolab_eval::find_root_vertex` is now a thin wrapper over
  `panproto_schema::primary_entry`. The old in-tree
  "no-incoming-edges, prefer object kind" heuristic is gone — it
  was the deterministic source of [panproto#35] (it landed on
  `app.bsky.feed.post#replyRef` because the atproto parser left it
  with no inbound edges; v0.32 fixes that with proper structural
  ref edges, and the basepoint is now declared by the parser, not
  inferred topologically).
- Demo + circuit `Schema` constructors declare an explicit
  `entries` family (`vec!["user"]` for the demo, empty for the
  generic circuit schema where the topological fallback still does
  the right thing).

### Fixed

- The `data-transformation.spec.ts` "validation badge resolves to
  ✓ VALID" test no longer needs `testInfo.fail()`. With the
  upstream parser fix and the basepoint API in place, validating a
  canonical `app.bsky.feed.post` against its own schema now passes
  — closes the gating note from [panproto#35].
- App favicon: now points at `/favicon.svg` (copied from
  panproto.github.io) and registered via `<link rel="icon" …>` in
  `index.html`. Previously the protolab tab fell back to the
  default browser globe.

[panproto#35]: https://github.com/panproto/panproto/issues/35
[`panproto_schema::primary_entry`]: https://docs.rs/panproto-schema/0.32.0/panproto_schema/fn.primary_entry.html

## [0.4.4] — 2026-04-14

### Changed

- **Empty canvas is now the correct state when no data-level mapping
  can be inferred.** Previously (v0.4.0–v0.4.3) the installer emitted
  `chain_step` placeholder components that ran as the identity at the
  instance level, producing a "Run yields input back, plus a red
  validation badge" UX that silently confused users. The fallback is
  removed; the canvas stays genuinely empty and the UI surfaces the
  situation explicitly.
- **Run button disabled** in both edit mode (`DataPanel`) and
  presentation mode (`RunButtonWidget`) whenever auto-gen succeeded
  but installed no components AND the chain has at least one
  theory-level step. Tooltip: "No data-level mapping yet — add hints
  or build the lens." The identity case (source ≡ target) stays
  Runnable as before.

### Added

- **`CanvasEmptyState`** overlay renders centered in the React Flow
  pane when no data-level mapping was derived. Three clear paths:
  - **🎯 Add hints to guide the search** (primary, opens HintEditor)
  - **View theory-level diff** (secondary, opens TheoryDiffModal)
  - *"Or drag components from the palette →"* hint toward the palette
- **`TheoryDiffModal`** lists the protolens chain's sort/op-level
  rewrites (AddSort, DropOp, …) with explicit copy making it clear
  they describe the structural diff but do NOT transform instance
  data. Accessible from both the canvas empty state and the
  presentation-mode mapping widget (new `Theory diff` link).
- Presentation-mode `SchemaMappingWidget` now mirrors the same
  empty-state banner (same CTAs) in place of its normal mapping
  sections when no field-level transforms exist — instance-level
  and theory-level information no longer share a pane, which was
  the source of the confusion.
- `hasDataLevelMapping(state)` selector in the store: the single
  source of truth that drives the Run button's enabled state and the
  `CanvasEmptyState` visibility condition.

### Fixed

- `schemas_byte_equal` replaced with a set-wise `Schema` comparison
  (protocol + vertex map + edge map + per-vertex constraint set).
  The old msgpack-bytes comparison was HashMap-iteration-order-
  dependent, so two independent parses of the same NSID produced
  different bytes and the identity short-circuit didn't fire — the
  symptom was a 30 s+ hang on self-mapping after parsing the same
  schema twice.

### Rigorous e2e coverage

- Three new tests in `hinting-rigorous.spec.ts`: clicking **Add
  hints** on the empty-state overlay opens the HintEditor; clicking
  **View theory-level diff** opens the TheoryDiffModal with at
  least one chain step listed; Run is disabled when no data-level
  mapping is inferred.
- Updated `cross-schema-mapping.spec.ts`, `complex-workflows.spec.ts`,
  `cross-language.spec.ts`, and `hinting.spec.ts` to assert the
  empty-state UX instead of the old `chain_step` placeholder count.

## [0.4.3] — 2026-04-14

### Fixed

- Identity short-circuit in `auto_generate_and_store_inner` and
  `_with_hints_and_store_inner`: when source and target schema
  handles are equal (or the schemas are byte-equal), skip the
  constraint-solver fallback and return the identity lens directly.
  Previously self-mapping on a non-trivial atproto schema could
  enter an exhaustive morphism search that did not terminate in
  practice (observed > 5 min on `app.bsky.feed.post`). Pinned via
  three Rust unit tests in `protolab-wasm`.

### Added

- `export_schema_json` + `exportSchemaJson` bridge: inverse of
  `importSchema`/`parseAtprotoLexicon`. Lets tooling retag a parsed
  schema under a different protocol or round-trip it through a DSL.
- User-registered protocols appear in `list_supported_protocols`
  under a `User-defined` category, making them selectable in the
  SchemaImportWidget protocol dropdown.
- Rigorous hermetic e2e suite (21 new tests, 83 total). All hit
  lexicon.garden via cached fixtures (`e2e/fixtures/lexicons/*.json`
  + `stubLexicons` helper) and complete in under 5 s each:
  - `hinting-rigorous.spec.ts` (6 tests): verifies hint-guided
    auto-lens on real atproto schemas. Covers the identity case,
    disjoint schemas, and over-constraining anchors — asserting the
    system surfaces an observable consequence (changed mapping or
    `autoLensError`), never a silent no-op.
  - `data-transformation.spec.ts` (5 tests): Lexicon Mapper output
    asserted value-by-value against the documented shape (`body`,
    `timestamp`, `charCount = body.length`, `source = "bluesky"`,
    pass-through `langs`/`tags`). Apply Back round-trip strictly
    reflects the edit. One case `testInfo.fail()`-gated to
    [panproto#35].
  - `mode-consistency.spec.ts` (4 tests): parameter edits in edit
    mode are visible when Run fires in presentation; schema
    assignments persist across Cmd+E toggle; hint spec persists;
    circuit deletion is visible in the other mode.
  - `cross-language.spec.ts` (3 tests): OpenAPI ↔ atproto; CDDL ↔
    OpenAPI; atproto ↔ OpenAPI. All assert a non-hung outcome.
  - `user-protocols.spec.ts` (4 tests): a user-registered protocol
    appears in `listSupportedProtocols`; a CDDL source retagged
    under a user-defined protocol assigns cleanly; two identical
    CDDL schemas produce 100% survival.

### Panproto issue filed

- [panproto#35](https://github.com/panproto/panproto/issues/35):
  required edges on optional ref sub-objects are hoisted to the
  record root during atproto lexicon parsing. Reproducer +
  tracking test in `data-transformation.spec.ts`.

## [0.4.2] — 2026-04-14

### Added

- **Hint-guided auto-lens generation** wired through to the UI. New
  wasm export `auto_generate_with_hints_and_store(circuit, src, tgt,
  hints_json)` calls `panproto_lens::auto_generate_with_hints` with
  resolved `HintParts` (anchors, scope pairs, exclusions, scoring
  weights, name-similarity threshold). Forward-chaining anchor
  propagation runs server-side via `panproto_lens::hint::resolve_hints`.
- **HintEditor modal** lets the user declare anchors interactively:
  add anchor rows, type or pick source/target vertex ids, optionally
  exclude vertices on either side, set a quality threshold, and
  click Re-generate to invoke the hinted pipeline. Mounted globally
  in `App.tsx` so it's reachable from edit and presentation modes.
- **SchemaViewerModal**: searchable inspector for any imported
  schema (vertices grouped by id with kind, NSID, edges, and
  constraints). Doubles as a vertex picker when launched from
  HintEditor's "Pick…" buttons. Reads via the new
  `get_schema_details` wasm export.
- **Alignment-quality badge** in the schema-mapping panel. Shows
  the survival ratio (source vertices that reached a target) as a
  green/amber/red percentage. A `HINTED` badge appears when the
  current chain was generated with non-empty hints.
- **View / Hints / Change buttons** on every assigned-schema banner
  in `SchemaImportForm` (works in both the presentation
  `SchemaImportWidget` and the edit-mode Inspector forms).
- **Schema mapping panel mirrored into edit-mode Inspector** so
  alignment quality, viewer links, and the hints entry point are
  reachable without leaving edit mode. The two modes now share the
  full hinting infrastructure via shared store state
  (`schemaViewerHandle`, `hintEditorOpen`, `autoLensHints`).
- **E2e coverage for hinting**: opening the schema viewer for
  source + target, declaring an anchor and re-generating, and
  verifying the alignment-quality badge appears.

### Changed

- panproto upgraded across the workspace from v0.30.0 → **v0.30.1**
  (12 dependencies). Sets the stage for delegating more wasm
  surface area to `@panproto/core` in a follow-up.

## [0.4.1] — 2026-04-14

### Fixed

- **Apply Back was silently broken on every demo-flavoured circuit.**
  `apply_modified_output_inner` was serialising the cached
  `final_lens.tgt_schema` and `final_complement` to JSON and
  immediately re-parsing them inside the same `with_resource` closure
  where both values are already borrowable.
  `Complement.contraction_choices: HashMap<(u32, u32), Edge>` and
  `arc_edges: HashMap<(u32, u32), Edge>` are not representable as JSON
  object keys (tuple keys aren't strings), so `serde_json::to_string`
  errored, the trailing `unwrap_or_default()` turned the failure into
  an empty string, and the next `from_str` then failed with "EOF
  while parsing" — masking the real serialization bug as a generic
  deserialization error. Replaced with an in-place borrow: `parse_json`
  + `put` + `to_json` happen inside one `with_resource_mut`, with all
  errors propagated through `WasmError`. `find_root_vertex` is now
  used instead of `tgt_schema.vertices.keys().next()` so the right
  root is picked when iteration order isn't deterministic.
- **`backward evaluation (Apply Back)` e2e** now strictly asserts the
  input field reflects the user's output edit ("Bob" propagates
  through the `rename_field` step) instead of soft-failing.

## [0.4.0] — 2026-04-14

### Added

- **Target-schema validation badge** in the output pane. New
  `validate_data_against_schema` wasm export runs `panproto-inst`'s
  `parse_json` + `validate_wtype` against the assigned target schema
  on every Run; the output pane shows a green ✓ VALID or red ✗ N ERR
  badge, and clicking the red badge expands per-error details.
- **Chain-step fallback in `install_field_level_components`**
  (`crates/protolab-wasm/src/api.rs`): cross-schema mappings whose
  diff is purely theory-level (sort/op rewrites — e.g.
  `blue.2048.verification.stats → app.bsky.graph.verification`)
  previously produced a populated chain-steps panel but a blank edit
  canvas. The installer now emits one `chain_step` component per
  protolens step when no field-level transforms produced components,
  so edit mode is never blank.
- **Source/target schema forms in the edit-mode Inspector**: the new
  reusable `SchemaImportForm` (extracted from `SchemaImportWidget`)
  is rendered in `CircuitInspector` as well as the presentation
  layer, so schemas can be assigned without leaving edit mode.
- **Schema-assignment rehydration**: `SchemaImportForm` now reads
  `sourceSchemaHandle` / `targetSchemaHandle` from the store and
  shows an "assigned" banner with a Change button when this role
  already has a schema, so mode-switching no longer appears to reset
  state.
- **Run button readiness gate**: the presentation `RunButtonWidget`
  is disabled while the source schema is null, with a
  `data-ready="true|false"` attribute. Eliminates the race where a
  user (or template auto-resolve) could click Run before
  lexicon.garden returned the source schema.
- **E2e coverage explosion** (21 → 54 tests):
  `cross-schema-mapping.spec.ts` (regression for the empty-canvas
  fix), `toolbar-panels.spec.ts` (Theories / Colimit / Schemas /
  Protocols / Import / Export entry points), and
  `complex-workflows.spec.ts` (20 multi-step user journeys including
  expression-driven `compute_field` chains, `map_items` scoped
  traversals, theory import + colimit composition, share-URL
  round-trip, and validation-badge failure path).
- **Store exposed on `window` for e2e**: `__protolabStore` lets
  Playwright drive the circuit deterministically without simulating
  fragile React Flow drag/drop.
- **Stable testids on the DataPanel**: `data-panel-input`,
  `data-panel-wire`, `data-panel-output`,
  `output-validation-badge`, `output-validation-details`.

### Changed

- **panproto upgraded across the workspace from v0.28.0 → v0.30.0**
  (12 dependencies).

### Fixed

- Pre-existing test breakage caused by stale selectors:
  `Edit circuit` ambiguity (toolbar + empty-state body), the
  `lexicon_import → schema_import` widget rename, demo data drift
  from `"legacyId":42` to `7042`, and `presentation.spec.ts` Run
  tests racing the lexicon auto-resolve fetch.

## [0.3.0] — 2026-04-12

### Added

- **Multi-protocol schema import with 30+ parsers**: a new unified
  `SchemaImportWidget` replaces the atproto-only `LexiconImportWidget`
  with a protocol selector that drives protocol-specific input UI
  (atproto → NSID + lexicon.garden autocomplete + Resolve, openapi →
  paste OpenAPI JSON + Parse, mongodb → paste `$jsonSchema` + Parse,
  cddl → paste CDDL text + Parse, etc. for all panproto-supported
  protocols).
- **Native panproto auto-lens pipeline**: target-schema assignment
  triggers `wasm.autoGenerateAndStore` which diffs source vs. target
  via `panproto_check::diff` + `diff_to_protolens`, instantiates the
  resulting `ProtolensChain` to a `Lens`, and stores the chain steps
  + schema mapping for the presentation layer to display. Forward
  evaluation uses `asymmetric::get` directly through the cached lens;
  put-back uses `asymmetric::put` with the cached complement.
- **Target schema assignment + automatic lens generation**: assigning
  a target schema fires `autoGenerateLens`, which produces a real
  editable circuit on the canvas (or a chain-steps summary in
  presentation mode). Auto-lens status is surfaced in the lens chain
  widget, schema mapping panel, and inspector.
- **Tooltips, keyboard-shortcut help, presentation help modal**: a
  `?` shortcut opens a keyboard-help overlay; presentation mode has
  a dedicated help modal explaining the layout.
- **Default landing loads the Lexicon Mapper template** in
  presentation mode for first-time visitors; explicit `?mode=edit`
  bypasses the template.
- **Richer demo data** with non-trivial values (Alice Chen,
  legacyId 7042) so eval output is visibly meaningful.
- **Lens chain widget redesign**: SVG arrow connectors, equal
  spacing between filled-triangle arrows, removed static
  bidirectionality claims that went stale when chains changed.

### Changed

- panproto upgraded to **v0.28.0**: array round-trip fix
  ([panproto#27]), `Value::List`, generic `is_list_vertex` detection,
  incremental git import, XRPC query endpoints.
- Removed `free` and `two_column` presentation layouts in favour of
  the form layout — the only one that actually held up across widget
  combinations.
- Generic Input/Output labels on the data panel that don't go stale
  as schemas change.

### Fixed

- Don't auto-generate when target is null; don't pollute
  `evaluationError` on auto-lens failures.
- Restore `langs`/`tags` in the canonical post fixture (workaround
  for [panproto#27]).
- CI default landing loads the template via raw URL check for
  `?mode=edit`.
- Robust template loading on refresh with `?mode=presentation`;
  presentation doc is set before WASM calls so the UI has widgets
  even if WASM init throws.
- Reorder presentation widgets so the lens chain sits between input
  and output (left-to-right reading order matches the data flow).

## [0.2.2] — 2026-04-10

### Added

- **Lens chain widget**: presentation mode now shows the actual circuit
  pipeline as a compact visual summary (component name, optic badge,
  key params). This reads live from the store, so edits in edit mode
  are reflected immediately; no more stale hardcoded descriptions.

## [0.2.1] — 2026-04-10

### Fixed

- **E2e tests**: non-blocking lexicon auto-resolve so presentation mode
  appears immediately without waiting on the network fetch. Scoped
  output assertions to the output textarea to avoid matching the input.
  Fixed strict-mode selectors for "Lexicon Mapper" (toolbar title vs.
  heading widget).
- **Paragraph widget text**: reformatted as a numbered list describing
  each lens step. Removed all dashes used as punctuation in user-facing
  text.
- **CORS fallback UX**: when autocomplete is unavailable, the widget
  links to lexicon.garden/browse so users can find NSIDs manually.

## [0.2.0] — 2026-04-10

### Presentation mode (Max/MSP-inspired)

- **Cmd+E toggles** between edit mode (full circuit editor) and
  presentation mode (curated front panel). Presentation widgets —
  headings, paragraphs, JSON I/O, run button, lexicon importer — live
  in a separate UI layer (`presentationDoc`), NOT as circuit vertices.
  Edit mode shows only the real lens chain.
- **Three layouts**: form (vertical stack, default), two_column
  (left/right with top/bottom spanning bands), and free (absolute
  x/y positioning).
- **URL-driven**: `?mode=presentation`, `?layout=two_column`,
  `?template=lexicon_mapper`, `?c=<base64(circuit)>` all work as
  share-friendly entry points.

### Lexicon Mapper template

- The default landing loads a **Lexicon Mapper** in presentation mode:
  a 4-step lens that renames `text→body`, `createdAt→timestamp`,
  computes `charCount = len(body)`, and adds `source = "bluesky"`.
- **Auto-resolves `app.bsky.feed.post`** from lexicon.garden's XRPC
  endpoint (`Access-Control-Allow-Origin: *`) and seeds the input
  with a canonical example record. Click Run and the transformed
  output appears immediately.
- **NSID autocomplete** against lexicon.garden's
  `/api/autocomplete-nsid` with debounced typeahead and keyboard
  navigation (works in dev via Vite proxy; production needs a
  CORS-aware proxy once lexicon.garden adds CORS to `/api/*`).
- Bundled example records for 6 common NSIDs (posts, follows,
  profiles, likes, reposts, blocks) auto-seed the input widget.

### Edit mode improvements

- **Fixed-width component nodes** (220px) with ellipsis truncation on
  long params, preventing horizontal overflow and node overlap.
- `assignSourceSchema` now refreshes the circuit graph so optic
  badges update immediately when a new source schema is assigned.

### Test coverage

- 510 total tests: 187 Rust, 296 vitest, 27 Playwright e2e.
- New vitest suites: all 7 presentation widgets, WidgetRegistry,
  lexiconGarden API client, lexiconMapper template loader,
  expressionBuiltins catalog.
- Rewritten Playwright e2e: default landing, Cmd+E toggle, layout
  switching, lexicon resolve, Run → lens output, edit mode shows
  only 4 real lens nodes, forward/backward eval, drag/drop/delete
  components, JSON export, per-component Bang.

## [0.1.0] — 2026-04-08

Initial public release of protolab.

### Visual circuit editor

- Three-panel React Flow layout: Palette on the left, Canvas in the
  centre, Inspector on the right, Data panel at the bottom, Toolbar at
  the top.
- Drag components from the Palette onto the Canvas. Wire them by
  dragging between ports. Click a component to edit its parameters,
  click a wire to see its optic classification + complement info.
- Per-component **Bang** button (Max/MSP-inspired) runs the forward
  pass up to that component and displays the wire state inline.

### Nine built-in component types

- `rename_field`, `add_field`, `drop_field` (structural, iso/lens)
- `hoist_field`, `nest_field` (structural nesting, lens)
- `coerce_type`, `apply_expr`, `compute_field` (expression-backed;
  iso when an inverse is provided, otherwise lens / projection)
- `map_items` (traversal carrier)

### Bidirectional evaluation engine

- Forward pass via `panproto_lens::asymmetric::get` on the composed
  lens, with per-wire target schemas and per-wire complement tracking.
- Backward pass via protolab's own `put_view` wrapper, which handles
  expression-component inverses and multi-field arc remapping before
  delegating to panproto's `put`.
- Per-wire JSON rendering uses each wire's own target schema (not the
  source) so transformed data is displayed correctly at every point
  in the pipeline.
- Runtime expression errors (unknown variable, type mismatch,
  division by zero, step-limit overflow) silently leave the target
  field unchanged — matches panproto-inst's documented behaviour.

### Expression language

- Full `panproto-expr` support in the in-canvas CodeMirror editor:
  syntax highlighting, autocomplete against the ~50 panproto builtins,
  inline linter calling the Rust parser, optional test environment
  and Eval button for interactive debugging.
- Portable grammar distribution: `grammars/panproto-expr.tmLanguage.json`
  for VS Code / GitHub linguist, `grammars/tree-sitter-panproto-expr/`
  for Helix / Neovim / Zed, all derived from the canonical
  `grammars/tokens.json`.

### User-defined protocols and theories

- `Protocols` toolbar button opens a form-based editor for building
  a `panproto_schema::Protocol` (name, schema theory, instance theory,
  obj kinds, constraint sorts, edge rules, capability flags). Imported
  protocols take precedence over panproto's built-in protocol table.
- `Theories` toolbar button opens a theory editor (sorts, operations,
  equations, directed equations with coercion classes) that compiles
  through `panproto_theory_dsl`.
- `Colimit` toolbar button composes two imported theories over a set
  of shared sorts via panproto's `colimit_by_name`.
- `Schemas` toolbar button browses imported schemas with an
  "assign as source" action to wire a schema into the active circuit.

### Import and export

- Import: lens DSL JSON, schema JSON, theory JSON, protocol JSON.
  Paste into the import dialog or upload a file.
- Export: circuit as raw schema JSON, as a lens DSL JSON document, as
  YAML, as Nickel (with `| L.Lens` contract marker). Every exported
  format round-trips through `lens_document_to_circuit` with full
  parameter fidelity — including `apply_expr` inverses and coercion
  classes, `hoist` and `nest` edge configurations, and `compute_field`
  targets.

### Tests

- **240 Rust tests** (unit + integration) across four crates. Every
  WASM entry point has a native-callable `_inner` variant so it can
  be exercised without the wasm-bindgen runtime.
- **172 frontend unit / component tests** via vitest + React Testing
  Library, with the WASM bridge mocked through vitest's alias resolver
  so tests run in jsdom.
- **8 end-to-end tests** via Playwright against real Chromium and
  real WASM running on the vite dev server. The suite covers demo
  startup, per-component eval, wire tooltips, and the Bang flow.
- Total: 420 tests, 0 ignored, 0 skipped, 0 failing.

### Dependencies

- **panproto** v0.27.3 (pinned via git tag in workspace Cargo.toml).
  This release incorporates two upstream fixes that protolab drove:
  - [panproto#23]: `combinators::nest_field` signature change so it
    works against schemas with qualified vertex ids.
  - [panproto#24]: `wtype_restrict` node synthesis so nest_field's
    forward eval materialises the intermediate WInstance node.
- **React 19**, **React Flow 12**, **Zustand 5**, **CodeMirror 6**.
- **vitest 2**, **@testing-library/react 16**, **Playwright 1.59**.

[Unreleased]: https://github.com/panproto/protolab/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/panproto/protolab/compare/v0.4.5...v0.5.0
[0.4.5]: https://github.com/panproto/protolab/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/panproto/protolab/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/panproto/protolab/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/panproto/protolab/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/panproto/protolab/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/panproto/protolab/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/panproto/protolab/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/panproto/protolab/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/panproto/protolab/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/panproto/protolab/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/panproto/protolab/releases/tag/v0.1.0
[panproto#23]: https://github.com/panproto/panproto/issues/23
[panproto#24]: https://github.com/panproto/panproto/issues/24
[panproto#27]: https://github.com/panproto/panproto/issues/27
