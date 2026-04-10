# Changelog

All notable changes to protolab are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/panproto/protolab/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/panproto/protolab/releases/tag/v0.1.0
[panproto#23]: https://github.com/panproto/panproto/issues/23
[panproto#24]: https://github.com/panproto/panproto/issues/24
