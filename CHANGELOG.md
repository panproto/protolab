# Changelog

All notable changes to protolab are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] — 2026-08-19

### Added

- **Multi-account atproto sign-in.** protolab can hold several
  atproto sessions at once, keyed by DID, with an account badge in
  both the edit and presentation toolbars naming the DID a publish
  would write to. Signed out it is a labelled "Sign in" button;
  signed in it collapses to the account's avatar alone, with the
  handle and any other signed-in accounts one click away in the
  panel. It appears in both bars because a bare visit lands in
  presentation mode — an account control only in the edit toolbar is
  unreachable for anyone who has not been told about Cmd+E. A lens is
  shared infrastructure as often as a personal artifact, so the same
  person may want to publish one under a personal DID and another
  under an organization's. Tokens live in the OAuth library's
  IndexedDB store; only display metadata is persisted, under a
  `protolab.sessions.v1` key separate from canvas state, so clearing
  a circuit cannot sign anyone out.
- **Publishing lenses to a PDS.** A new Library panel writes the
  canvas circuit as a `dev.panproto.schema.lens` record, plus a
  `dev.panproto.schema.schema` record for each endpoint it
  references — a lens record requires `sourceSchema` and
  `targetSchema` as at-uris, so publishing a lens means publishing
  the schemas it points at. Both carry an `application/x-msgpack`
  blob. Schemas are content-addressed, so republishing an unchanged
  one reuses the existing record instead of duplicating it.
- **Browsing any repo's lens library.** The Library panel's Browse
  tab lists a DID's published lenses, labelled by the protocols at
  each end (`atproto → openapi`) rather than by raw at-uri, with
  round-trip class and law-verification status. Listing records is an
  unauthenticated public read, so this works signed out and for
  anyone's DID.
- **Content addressing at the WASM boundary.** New exports
  `schema_object_hash`, `schema_msgpack`, `lens_msgpack`, and
  `blake3_hex`. A schema's `objectHash` is panproto's own object id
  (`panproto_vcs::hash::hash_schema` — blake3 over the canonical
  MessagePack form), not an ad-hoc digest, so a published record
  lines up with the same schema held in a panproto repo or registry.
  A lens is addressed by blake3 over the bytes it ships, since a
  `LensDocument` has no canonical form in `panproto-vcs`.

### Changed

- **panproto 0.38.0 → 0.71.0.** `LensDocument` gained `from_diff`,
  `symmetric`, and `directed_equations`; protolab emits a `steps`
  body and sets each to `None`.
- **Anchor discovery reads the aggregated evidence table.** panproto
  0.71 replaced `align::resolve_anchors`, a per-source argmax over raw
  confidences, with aggregate-then-select: the whole pool reduces to
  one score per `(source, target)` — a provenance ceiling, a priority
  band, a `max` within each of six evidence families, then a
  fixed-arity mean — and the choice is made off that table.
  `discover_anchors` now uses `StrictPriority` aggregation with
  `Cardinality::Strict` and `RowFilter::relative_only`, the same
  combination the search itself seeds on, so the anchors protolab
  displays remain the ones the morphism search actually tried. The
  relative tolerance rather than an absolute floor is the decision
  rule, because a mean over six families never clears the floor on the
  strength of one family alone.
- **`HintParts` lost `name_similarity_threshold`**; the hint path no
  longer sets it.
- **The empty state says what the schemas share, measured.** When
  auto-generation found no lens, the canvas asserted that the field
  names "don't overlap enough for the solver to guess" — a claim about
  the schemas that nothing had established. "Is there a lens worth
  installing" and "what is the largest part of the source that maps"
  are different questions, and the second always has an answer:
  panproto's span search never refuses, returning an empty apex where
  two schemas genuinely share nothing. A new `schema_span` WASM export
  runs it, and the overlay now reports the covered fraction and lists
  the correspondences, which is what a user needs to decide whether to
  map by hand. Deliberately no score: `SchemaSpan::quality` is
  documented as a ranking signal among spans over one source schema
  with no absolute reading, so showing it as a number comparable across
  schema pairs would invent a meaning it does not have. `apex_coverage`
  is `|apex| / |source|`, which does mean what it looks like. An
  unproven optimum says so rather than reading as a verdict, and the
  pairs are sorted, since `apex.vertices` is a `HashMap` and the list
  would otherwise reshuffle on every search.
- **Importing a lens says what the canvas could not carry.** A
  `LensDocument` holds one body, and the canvas draws a pipeline of
  components, so `steps` is the only one it can represent. A document
  with any other body used to be refused with "LensDocument has no
  steps body" — true, and useless to someone holding a valid lens. The
  error now names the body and says what follows from it: `from_diff`
  derives its chain from the source/target difference, which is what
  auto-generate runs; `symmetric` holds two pipelines meeting at a
  shared middle, which no arrangement of components means; `compose`
  references lenses by name, so import those and place them end to end.
- **A lossy import is reported rather than silent.** A document whose
  `steps` the canvas *can* draw may still carry directed equations,
  rules-variant metadata (`passthrough`, `invertible`), or extension
  keys, and those are dropped on the way in and absent from any
  subsequent export. It may also carry a step kind protolab has no
  component for — `pullback`, `merge_sorts`, `drop_equation` — which
  landed as an inert `unknown` node holding none of its parameters and
  wearing the `lens` wire colour, a claim about its optic class that
  nothing had established. Import still succeeds; it now reports each
  part it could not carry, naming unmapped steps by their position and
  their spelling in the document. `import_lens_document` returns
  `{handle, dropped}` in place of a bare handle.

### Removed

- **A stale claim about an upstream coverage floor.** A comment on the
  candidate-install path asserted that every candidate reaching it had
  cleared "the 0.15 threshold upstream". No such number exists in
  panproto 0.71 — `auto_generate` compares the pinned and released
  searches on the objective, quality first and coverage second, rather
  than gating either on a threshold. protolab's own gate is
  structural and unchanged: a candidate survives if the compiled
  migration mapped anything at all.
- **A false `iso` tag can no longer corrupt the source.** panproto
  0.66 stopped `apply_expr` over a child scalar from writing its
  result to a shadowing `extra_fields` entry on the parent — a field
  the source never carried, which on the way back outranked the
  child. A lying inverse (identity where `lower` belongs) previously
  returned `ALICE` from an unmodified round-trip; the child node is
  now authoritative and the round-trip recovers `Alice`. The tag is
  still trusted and a lying one is still a defect in the lens; it is
  no longer a destructive one.
- **A failing expression now reports instead of silently doing
  nothing.** panproto 0.57 made `apply_field_transforms` return
  `FieldTransformFailed` rather than discarding an unevaluable
  expression, on the grounds that a transform which ran and changed
  nothing is indistinguishable from one that failed. A broken
  `apply_expr` / `compute_field` now names its own failure on the
  store's error channel — ``field transform on `name` failed to
  evaluate: unbound variable: unknownVar`` — where it previously
  rendered an unexplained no-op.

### Fixed

- **A completed sign-in is no longer discarded by the mode switch.**
  atproto OAuth uses `response_mode=fragment`, so authorizing returns
  the browser to `/#code=…&state=…`. `setMode` rebuilt the URL from
  pathname and query alone, dropping the fragment — and it runs from
  App's boot effect, before the OAuth client reads the callback. The
  authorization request succeeded, the callback silently degraded into
  an ordinary page load, and the user arrived back on a signed-out app
  with an orphaned `state` entry in IndexedDB, an empty `session`
  store, and no error anywhere to explain it. The fragment is now
  preserved.
- **A session is recorded before it is enriched.** `syncSessionToStore`
  looked up handle, avatar, PDS, and scope and only then wrote to the
  store, so a single throw anywhere in that chain — a rejected
  `new Agent`, an unreachable AppView — left an authenticated user
  reading as signed out while the OAuth library held a live session.
  The session is now written on sight and patched with profile detail
  as it arrives.
- **The session probe is no longer skipped.** An earlier cut ran
  `resumeSession` only when protolab's own localStorage mirror was
  populated or the URL carried callback params. The authoritative
  store is the OAuth library's IndexedDB, so a user whose mirror was
  empty was never restored. The probe now runs on every mount, and is
  memoized so the edit → presentation remount does not race two
  `init()` calls for the same one-time authorization code.
- **`compute_field` downstream of a `rename_field` resolves the
  renamed key again.** protolab evaluates expression components
  itself, against the post-`get` view where the rename has landed,
  but also installs a copy of the transform on the compiled lens as a
  complement side-channel for a direct `put`. panproto evaluates that
  copy against the *source* fiber, where the renamed name does not
  exist; before 0.57 it failed silently and protolab's own evaluation
  supplied the right answer, so the upgrade turned a latent mismatch
  into a hard error. `wire_data::rewrite_into_source_frame` now
  substitutes the copy's free variables back through the upstream
  renames, composing transitively (`a→b` then `b→c` resolves `c` to
  `a`). The substitution is value-preserving because a rename moves a
  value without changing it. The substitutions are staged through
  temporary names and applied together, so a swap does not collapse
  the way one-at-a-time rewriting would.

  This began as a workaround for an upstream composition bug —
  `compose` conjugated the vertex coordinate but not the field
  coordinate (panproto#245), and 0.66's repair read a rename map that
  `ProtolensChain::instantiate` left empty (panproto#251). Both are
  fixed as of panproto 0.68, and verified here: composing two lenses
  is functorial, and naming a field the first one took away is
  rejected at compose time with `ComposeUnboundField`.

  The rewrite stays regardless, because protolab never composes. A
  circuit is flattened into a single `ProtolensChain`, instantiated
  once, and every component's value transforms are installed onto that
  one migration. Within a single migration all transforms are by
  construction in its source frame, so there is no second frame for
  `compose_field_transforms` to conjugate between and the upstream
  repair cannot fire. Removing it against 0.68.0 makes
  `compute_field_after_rename_uses_renamed_key` fail. Dropping it for
  real means building a migration per component and composing them —
  a restructuring of the evaluation pipeline, not a deletion.
- **Chained renames of one field all apply.** A component names a
  *field*; the combinator takes the *vertex* that field's edge points
  at, and the two were assumed to line up as `{parent}.{field}`. That
  holds for a freshly parsed schema and stops holding the moment a
  chain renames anything, because `RenameEdgeName` moves the edge's
  name and leaves the vertex id alone. A second component naming the
  field by its new name computed a vertex that does not exist, and the
  combinator silently did nothing: `a → b` followed by `b → c`
  produced `b`, with no error, and a field swap could not be expressed
  at all. `drop_field` resolved its vertex the same way, so dropping a
  renamed field silently kept it. The mapping is now read off the
  schema and re-keyed as the chain is built, which also stops the
  naming convention from being load-bearing for schemas whose vertex
  ids do not follow it.
- **Component tests no longer die on `window.localStorage`.** Node 26
  exposes a native `localStorage` global that stays `undefined`
  without `--localstorage-file`, and under vitest's jsdom environment
  `window === globalThis`, so that own-property shadowed the Storage
  jsdom installs. Any component reading persisted state in a
  `useState` initializer crashed during render. The test setup now
  installs a spec-shaped in-memory Storage when one is missing.

## [0.7.0] — 2026-04-24

### Changed

- **Unified auto-lens through the candidates API.** The store no
  longer calls two wasm entries on every target assignment. Before,
  `assignTargetSchema` kicked off both `generateCandidates` (for the
  Inspector's candidate list) and a legacy `autoGenerateLens` (for
  installing components onto the canvas) — two CSP runs, two
  slightly different coverage filters, and a silent gap where the
  legacy path could dump a hundred-step `DropOp` pile onto the
  canvas while the candidate list correctly reported "no mapping
  inferred." `autoGenerateLens`/`regenerateWithHints` now both
  delegate to `generateCandidates`; its auto-selected top candidate
  is the installed one. The legacy wasm entries
  `auto_generate_and_store` and `auto_generate_with_hints_and_store`
  are gone.
- **Selecting a candidate installs its components.** A new wasm
  entry `install_candidate_components` takes `{circuit, lens,
  source, target}` handles and materializes the candidate's chain
  as editable `rename_field` / `add_field` / `drop_field` / etc.
  nodes on the canvas. The store's `selectCandidate` runs it so
  switching candidates in the Inspector actually swaps the canvas
  content — previously the chain behind the selected candidate
  never reached the canvas.
- **`Resource::AutoLens` now carries the chain alongside the lens**,
  so component installation and schema-mapping extraction can
  happen later without re-running the alignment search. The slab
  grew a `take_resource` / `put_resource` pair so operations that
  need both a lens AND the circuit that it targets don't deadlock
  the `RefCell`-backed store.

### Added

- **`clear_circuit_components` wasm entry.** Called by the store
  before each candidate regeneration so that when a search fails,
  the canvas isn't left holding stale components from a previous
  target assignment (or the demo's initial circuit).
- **`compute_schema_mapping` wasm entry.** Computes a bare schema
  mapping directly from the source/target graphs, without running
  the lens compiler. The store uses it to populate
  `autoLensSchemaMapping` even when the CSP finds no usable lens,
  so the SchemaMapping / TheoryDiff / HintEditor widgets have
  meaningful state in the "no mapping" path.
- **Drop-everything lens filter based on `vertex_remap`.** Replaces
  the 0.15 coverage-ratio heuristic from v0.6.3/v0.6.4. A candidate
  passes iff its compiled migration has at least one preserved or
  renamed vertex — the precise test for "this lens does something
  other than drop-all/add-all." Low-overlap pairs (`feed.post →
  feed.like` sharing only `createdAt`) now keep their candidate
  while the pathological `feed.post → standard.document` 123-step
  pile is still rejected.

### Fixed

- **The `feed.post → standard.document` drop-op bomb, for real.**
  v0.6.4's coverage gate only applied to the candidates API, not
  the legacy install path — mapping unrelated atproto lexicons
  still bomb'd the canvas. Gone now that the legacy path is gone.
- `SchemaMappingWidget` renders its empty-state CTA whenever a
  lens didn't compile, not only for the `successButEmpty` case.

## [0.6.4] — 2026-04-24

### Fixed

- **Coverage gate on the legacy auto-generate path.** v0.6.3 added
  the "drop drop-all/add-all candidates below 0.15 coverage" filter
  to `auto_generate_candidates_inner`, which is the candidates API
  the Inspector's candidate list uses. But `assignTargetSchema`
  ALSO calls a legacy `autoGenerateLens` that goes through
  `auto_generate_and_store_inner` — a separate wasm entry that runs
  `diff_to_protolens` + `auto_generate` (the pre-candidates single-
  morphism API) and then installs every step as a canvas component
  via `install_field_level_components`. That path bypassed the
  0.15 filter, so mapping `app.bsky.feed.post → site.standard.document`
  still produced a 123-step DropOp/AddOp pile on the canvas even
  though the candidates surface correctly reported "no mapping
  inferred". The same coverage gate (surviving ≥ 0.15 × max(|src|,
  |tgt|)) now applies in `auto_generate_and_store_inner` and
  `auto_generate_with_hints_and_store_inner` too, bailing before
  `install_field_level_components` runs. The canvas empty-state
  overlay is now the sole surface for the no-mapping case.

## [0.6.3] — 2026-04-24

### Fixed

- **Don't surface degenerate drop-everything lenses as candidates.**
  When the CSP finds a morphism whose `vertex_map` covers almost
  nothing (e.g. the "drop every source vertex, add every target
  vertex" chain that falls out of two nominally-different schemas
  with no naturality overlap), the user saw a hundred-step pile of
  `DropOp(...) / DropOp(...) / AddOp(...)` that can't do anything
  useful to real data. The wasm bridge now drops any candidate whose
  `coverage < 0.15` and, if every candidate fails that bar, returns
  a "no morphism found" error instead — which wires through to the
  new discovered-anchors empty-state UX, giving the user a path to
  pin a hint rather than stare at a nonsense chain.

## [0.6.2] — 2026-04-24

### Fixed

- **Atproto-lexicon identity round-trip produced `[]`.** Setting source
  = target on the Lexicon Mapper (identity lens) caused Run to emit
  `[]` instead of echoing the input, because
  `find_root_vertex` returned the record wrapper (e.g.
  `app.bsky.feed.post`) whose only outgoing edge is a single anonymous
  `record-schema` edge to `:body`. `to_json`'s `is_list_vertex`
  heuristic reads that as "vertex with all-unnamed outgoing edges ⇒
  list", so every round-trip collapsed to an empty array. Fix descends
  the record wrapper in `find_root_vertex` when the primary entry has
  exactly one `record-schema` edge, landing on the body vertex that
  actually matches the JSON input shape. Regression test added.
- Dropped the decorative `🧭` and `🎯` emoji on the SchemaMappingWidget
  empty state and the `⚡`/`❄` emoji on the ComponentNode hot/cold
  port tooltip. They didn't fit the interface's terminal-monospace
  aesthetic.
- `CanvasEmptyState`'s zustand selector for pinned anchors returned a
  fresh `{}` literal when `autoLensHints.anchors` was undefined,
  triggering an infinite re-render and crashing React at boot with
  "Maximum update depth exceeded". Fix is a frozen module-scoped
  `EMPTY_ANCHORS` constant.

## [0.6.1] — 2026-04-24

### Changed

- **panproto v0.38.0** (bump from v0.37.0). Picks up naturality-aware
  span exclusion in `panproto-lens` (per-source naturality feasibility
  instead of kind-only compatibility), a pile of coercion-law-check
  surface area, and several `panproto-gat` fixes around pattern-
  matching and typecheck for holes, `case`, and `let`.

### Added

- **"No automatic mapping" UX path.** When `auto_generate_candidates`
  returns no candidates (common on cross-NSID lexicon mappings like
  `app.bsky.feed.post → site.standard.document`, where the two
  vocabularies barely overlap and no naturality-satisfying total
  morphism exists), the canvas now shows the correspondences the
  alignment strategies *did* discover — e.g. `tags ↔ tags`,
  `labels ↔ labels` — with one-click chips that promote an anchor to
  a persistent hint and re-run the search. Backed by a new
  `discover_anchors` wasm entry point that runs the strategies
  without invoking the CSP, so partial discovery is surfaced even
  when the morphism search fails outright.
- `circuitStore.promoteAnchorToHint(src, tgt)` appends to the
  existing `autoLensHints.anchors` map and triggers regeneration.

### Fixed

- `generateCandidates` no longer swallows the no-morphism error into a
  console warning. It now sets `autoLensError` so the canvas overlay
  can surface the failure instead of leaving the user staring at an
  empty graph.

## [0.6.0] — 2026-04-23

### Changed

- **panproto v0.37.0** (bump from v0.34.1). Picks up six new alignment
  strategies in `panproto-mig`: `suffix_anchors` (matches on the
  terminal dotted segment, so `app.bsky.feed.post.tags` ↔
  `site.standard.document.tags` is found without hints),
  `edge_label_anchors`, `description_anchors`, `neighborhood_anchors`,
  `wl_anchors` (Weisfeiler-Leman structural refinement), and scaffolded
  `embedding_anchors`. Fixes the cross-NSID auto-lens failure reported
  in panproto#48 where two atproto lexicons with shared field names
  used to collapse to a 123-step all-`DropOp` chain at Balanced
  stringency.
- `ApplyExpr` round-trip: when a component is tagged `coercion: "iso"`
  the lens now trusts the declared inverse rather than silently
  restoring the pre-transform value from the complement. A lying
  inverse is therefore visible on unmodified round-trip, matching the
  contract of the coercion class. Tests updated.

### Added

- Open Graph card (`app/public/og.png`, 1200×630) rendered from
  `app/public/og.html` via headless Chrome. Depicts a three-node
  `RenameField → MapItems → CoerceType` circuit in the app's actual
  visual language.
- `og:*` and `twitter:*` meta tags in `app/index.html` pointing at
  `https://panproto.dev/protolab/og.png` so rich embeds populate on
  Twitter/X, Slack, LinkedIn, Discord, and iMessage.
- README rewritten: trimmed feature-dump bullet lists, dropped the
  self-congratulatory sections, kept the component table, install
  steps, and project layout.

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
