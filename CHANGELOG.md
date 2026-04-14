# Changelog

All notable changes to protolab are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/panproto/protolab/compare/v0.4.2...HEAD
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
