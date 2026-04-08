# Contributing to protolab

Thanks for your interest. protolab is the visual layer on top of
[panproto]; most of the interesting code already lives in panproto,
and most of protolab's complexity comes from keeping the UI in sync
with panproto's evolving Rust API.

This guide covers the day-to-day workflow. For the overall architecture
and the mathematical foundations, see [README.md](README.md).

## Requirements

- **Rust** — a toolchain matching `rust-toolchain.toml` (currently
  `stable` with the `2024` edition). `rustup show` should pick this up
  automatically.
- **Node.js** — 20 LTS or newer.
- **[`wasm-pack`][wasm-pack]** — installed via its installer script
  or `cargo install wasm-pack`.
- **Optional**: [`cargo-deny`] for license / advisory checks, and
  [`tree-sitter-cli`] if you need to regenerate the tree-sitter grammar.

## Build

The Rust → WASM → app pipeline is a single script:

```bash
./scripts/build-wasm.sh
```

This runs `wasm-pack build crates/protolab-wasm --target web --out-dir
../../app/src/wasm/pkg`. It takes ~3 minutes cold, ~15 seconds warm.

Then the frontend:

```bash
cd app
npm install
npm run dev              # http://localhost:3000
```

`npm run dev` hot-reloads React changes. Rust changes need
`./scripts/build-wasm.sh` and a dev-server restart (or just let Vite
notice the `pkg/` file change).

For a production build:

```bash
cd app
npm run build            # writes to app/dist/ with base /protolab/
npm run preview          # serve dist/ locally for inspection
```

## Tests

protolab has three test layers. Run them all before opening a PR:

```bash
# Rust: unit + integration. ~240 tests, <10s.
cargo test --workspace

# Frontend component + store: vitest + React Testing Library + jsdom.
# ~170 tests, <5s. WASM bridge is mocked via vitest alias.
cd app && npm test

# End-to-end: Playwright against real Chromium and real WASM.
# ~8 tests, ~5s. Needs the WASM pkg built (scripts/build-wasm.sh).
cd app && npm run test:e2e
```

Before opening a PR, also run the license / advisory gate:

```bash
cargo deny check
```

### Adding tests

- **Rust unit tests** go in `#[cfg(test)] mod tests` blocks inside the
  source file they exercise.
- **Rust integration tests** go in `crates/<crate>/tests/*.rs`. For
  `protolab-eval`, look at the four existing files (`components.rs`,
  `round_trips.rs`, `expression_errors.rs`, `end_to_end.rs`) for the
  idioms — in particular the `flat_schema` / `nested_schema` /
  `single_component_circuit` helper patterns.
- **WASM API tests** use the `_inner` function pattern: every
  `#[wasm_bindgen]` function in `protolab-wasm/src/api.rs` has a
  private `_inner` variant returning `Result<_, WasmError>` (not
  `JsError`, which panics on non-wasm targets). Unit tests exercise
  the `_inner` variants.
- **Frontend component tests** go in `app/src/<dir>/__tests__/`.
  Reset the Zustand store in `beforeEach` and use the factories in
  `app/src/test/factories.ts`. The WASM bridge mock in
  `app/src/test/wasmBridgeMock.ts` is swapped in automatically by
  `vitest.config.ts`'s `resolve.alias` — tests never need to import
  the real bridge.
- **End-to-end tests** go in `app/e2e/*.spec.ts` and use the `ready`
  fixture from `e2e/fixtures.ts`. Prefer stable `aria-label` selectors
  over `nth(index)` — React Flow edge order is non-deterministic. For
  hover interactions, use `page.mouse.move(x, y, { steps: 5 })`; the
  teleport form and `locator.hover()` don't fire React's synthetic
  `mouseenter`.

## Commit messages

protolab uses **scoped conventional commits** so the changelog can be
generated automatically and so reviewers can see at a glance what part
of the codebase a change touches.

Format:

```
<type>(<scope>): <subject line, lower-case, imperative, no trailing period>

<optional body explaining the *why*, not the *what*. Wrap at 72 columns.>
```

### Types

- `feat` — a new capability.
- `fix` — a bug fix.
- `refactor` — an internal restructure without behaviour change.
- `perf` — a performance improvement.
- `test` — tests only.
- `docs` — documentation only.
- `build` — build system, CI, tooling.
- `chore` — release plumbing (version bumps, dep upgrades).

### Scopes

Match the touched crate or app area:

- `core` — `crates/protolab-core`
- `eval` — `crates/protolab-eval`
- `schema` — `crates/protolab-schema`
- `wasm` — `crates/protolab-wasm`
- `app` — anything under `app/src/`
- `e2e` — Playwright specs and config
- `grammars` — `grammars/`
- `ci` — `.github/workflows/`
- `deps` — dependency bumps (especially panproto)

For changes that span more than one scope, pick the primary one and
mention the others in the body. If a change truly touches everything
(a rename, a workspace-wide lint fix), use `chore(workspace): ...`.

### Examples

```
feat(eval): add put_view entry point for expression-component inverses

Forward eval installs FieldTransform::ApplyExpr on the compiled
migration, but panproto_lens::asymmetric::put clobbers the extra_fields
snapshot before apply_inverse_transforms runs, so an `iso` apply_expr
component round-trips as identity instead of F^-1 ∘ F. The new
put_view wraps panproto's put, applies inverse expressions to re-parsed
view nodes first, then delegates. Fixes 7 ignored round-trip tests.
```

```
fix(wasm): look up schema root via find_root_vertex, not HashMap order

build_user_schema was picking an arbitrary vertex from vertices.keys()
.next(), which meant parse_json sometimes started from a leaf field
instead of the actual root, producing a degenerate WInstance that made
every lens a no-op. Replace with the same find_root_vertex routine
that circuit-eval uses for the chain dispatcher.
```

```
chore(deps): bump panproto to v0.27.3
```

```
docs(readme): document user-defined protocol registration flow
```

### What not to do

- Don't commit without a scope. `feat: add foo` → `feat(app): add foo`.
- Don't use past tense (`added`, `fixed`). Use imperative (`add`, `fix`).
- Don't include the issue number in the subject line. Mention it in
  the body: `Closes #42`.
- Don't amend commits that other people might have pulled.

## Pull requests

1. Fork and branch from `main`.
2. Make your change. Scope each commit to one logical concern.
3. Run all three test suites plus `cargo deny check`. Green across
   the board is the minimum bar; a PR that reduces test coverage is
   almost always rejected.
4. Open the PR with a title that matches the commit-message convention
   (`feat(eval): …`), and a description that explains the motivation.
5. CI will run the same three suites plus the license gate on Linux
   and macOS. Expect failures there that you didn't see locally —
   the test suite is designed to be reproducible across platforms but
   small discrepancies happen.

## Reporting bugs

- **Bugs in the circuit editor or evaluation semantics**: file against
  this repo. Include a minimal reproducer as a JSON circuit export
  (Inspector → Export → Schema JSON) plus the expected vs actual
  behaviour.
- **Bugs in the panproto Rust core**: file upstream at
  [panproto/panproto]. protolab tracks panproto closely and most
  engine bugs belong there.

## Releasing

protolab uses semantic versioning. The release workflow:

1. Update the `## [Unreleased]` header in `CHANGELOG.md` to the new
   version and date.
2. Bump the workspace version in `Cargo.toml` and the npm package
   version in `app/package.json`.
3. Commit with `chore(workspace): release v<version>`.
4. Tag with `git tag -a v<version> -m "v<version>"`.
5. `git push --follow-tags`. The CI pipeline will build and deploy
   to GitHub Pages. npm publishing (if applicable for the release)
   is a separate manual step.

[panproto]: https://github.com/panproto/panproto
[panproto/panproto]: https://github.com/panproto/panproto
[wasm-pack]: https://rustwasm.github.io/wasm-pack/installer/
[`cargo-deny`]: https://embarkstudios.github.io/cargo-deny/
[`tree-sitter-cli`]: https://tree-sitter.github.io/tree-sitter/creating-parsers#installation
