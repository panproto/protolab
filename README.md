# protolab

**A visual editor for bidirectional data transformations, built on [panproto].**

protolab represents schema migrations, data transformations, and protocol
translations as **circuit diagrams**: each node is a (dependent) protolens
and each wire carries typed data in two directions — forward (`get`) and
backward (`put`). The circuit semantics, the optic laws, and the complement
tracking are all provided by panproto's Rust core; protolab is the visual
layer on top.

Try it: **<https://panproto.dev/protolab/>**

![protolab screenshot placeholder](docs/screenshot.png)

---

## What it does

protolab is **panproto with a face**. If panproto lets you define a
migration between two schema versions in a hundred lines of Nickel or
Rust, protolab lets you draw the same migration as a circuit, run it on
sample data, edit the output, and watch the edits propagate backwards
through the lens laws to the source.

Core capabilities:

- **Nine built-in component types** covering the common schema migration
  idioms: `rename_field`, `add_field`, `drop_field`, `hoist_field`,
  `nest_field`, `coerce_type`, `apply_expr`, `compute_field`, and
  `map_items`.
- **Nine optic classifications** per wire (iso, lens, prism, affine,
  traversal) with complement visualisation on hover — click any wire
  to see what data its backward pass has to restore.
- **Bidirectional evaluation**. Enter input JSON, click **Run**, see the
  transformed output. Edit the output, click **Apply Back**, watch the
  input update through the composed lens.
- **Per-component "bang"**: click any node's ▶ Bang button to see the
  wire state at that point in the pipeline, Max/MSP-style.
- **Live expression editor** for `coerce_type` / `apply_expr` /
  `compute_field` with syntax highlighting, autocomplete, and inline
  error linting — powered by the same `panproto-expr` parser that the
  Rust backend uses. Expressions are typechecked against the wire's
  current schema in real time.
- **User-defined protocols**. Register a custom `panproto_schema::
  Protocol` via the Protocol editor or by importing a JSON body. Your
  protocol takes precedence over panproto's built-in protocol table
  for any schema that names it.
- **User-defined theories**. Build a `panproto_theory_dsl::Theory` via
  form (sorts, operations, equations, directed equations with coercion
  classes) and compose two theories via colimit over shared sorts.
- **Import and export** as lens DSL JSON, YAML, Nickel, and raw
  circuit-schema JSON. Every export round-trips back to the exact same
  circuit (modulo HashMap ordering).
- **Full schema browser** for every imported protocol with vertex/edge
  counts and an "assign as source" button to wire it into the active
  circuit.

protolab speaks [all the protocols panproto speaks][panproto-protocols] —
~50 built-in data formats including MongoDB, AT Proto, OpenAPI, Avro,
CDDL, FHIR, GeoJSON, Parquet, and more — plus any custom protocol you
register at runtime.

## Mathematical foundation

Each component is a **morphism in Para(Optic(C))** in the sense of
Gavranović (2024). Wires compose via the symmetric monoidal structure
of the underlying category. The optic kind of a component is computed
at edit time by walking the panproto protolens chain it compiles to
and classifying each `TheoryTransform` via panproto's `classify_
transform`. Composing components composes their optic kinds via
the standard optics lattice.

The backward pass is implemented as `panproto_lens::asymmetric::put` on
the composed lens, so every round-trip obeys the `GetPut` and `PutGet`
laws that panproto's law checker verifies. Expression components'
inverses round-trip through protolab's own `put_view` wrapper which
handles the expression-layer semantics around panproto's structural
put.

## Running protolab

### Hosted

**<https://panproto.dev/protolab/>** — no install required.

### Local

You need a recent Rust toolchain (1.85+ nightly, driven by
`rust-toolchain.toml`), Node 20+, and
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/installer/).

```bash
git clone https://github.com/panproto/protolab
cd protolab
./scripts/build-wasm.sh        # cargo + wasm-pack build, ~3 minutes the first time
cd app
npm install
npm run dev                    # http://localhost:3000
```

The dev server hot-reloads the React layer. Rust changes require
re-running `./scripts/build-wasm.sh`.

## Presentation mode

protolab borrows Max/MSP's **presentation vs. edit mode** split. The
circuit is the source of truth, but authors can curate a subset of
components into a clean "front panel" that end-users see — hiding the
palette, inspector, and wire tangle behind a simple form.

The default landing — just `https://panproto.dev/protolab/` with no
query params — loads the Lexicon Mapper template in presentation mode:
a two-column front panel with a lexicon NSID resolver, input/output
JSON, and a Run button. Type `app.bsky.feed.post`, hit Resolve, click
Run. The full editor is one **Cmd+E** away (Ctrl+E on Linux/Windows).

URL entry points:

```
https://panproto.dev/protolab/                           # default: lexicon mapper, presentation
https://panproto.dev/protolab/?mode=edit                 # raw editor, no template
https://panproto.dev/protolab/?mode=presentation         # presentation mode, no template
https://panproto.dev/protolab/?template=lexicon_mapper   # explicit template load
https://panproto.dev/protolab/?c=<base64(circuit)>       # shared circuit; respects ?mode=
```

In **edit mode**, each component's Inspector has a **Presentation**
section where you check "Include in presentation", pick a widget
renderer, and set (x, y, column) for the three supported layouts:

- **free** — absolute positioning from `presentation:x/y`
- **form** — vertical stack (ignores coordinates)
- **two_column** — left/right split via `presentation:column`

Presentation metadata lives on the circuit schema as constraints
(`presentation:include`, `presentation:widget`, `presentation:x/y`,
`presentation:column`), so it round-trips through export and import
just like every other schema-level property.

### Widget kinds

- **heading** / **paragraph** / **panel** — static content from the
  `presentation_heading` / `_paragraph` / `_panel` components
- **input_json** — JSON textarea bound to `inputDataJson`
- **output_json** — read-only view of `outputDataJson` (and evaluation
  errors)
- **run_button** — triggers forward evaluation
- **lexicon_import** — NSID input that resolves an atproto lexicon via
  lexicon.garden's XRPC endpoint
  (`com.atproto.lexicon.resolveLexicon?nsid=…`), unwraps the `schema`
  field, feeds it through
  `panproto_protocols::web_document::atproto::parse_lexicon`, and
  installs the result as the circuit's source schema. The endpoint is
  served with permissive CORS, so the browser fetches directly — no
  proxy. For known NSIDs (`app.bsky.feed.post`, `app.bsky.graph.follow`,
  etc.), the widget also seeds the input JSON with a canonical example
  record so the Run button is immediately meaningful.

Unknown widget keys (for example, an arbitrary `rename_field` marked
`presentation:include=true`) fall back to a compact node box so the
author can still see and fix the metadata from edit mode.

### Lexicon Mapper template

Load `?template=lexicon_mapper` for a pre-built presentation-mode
circuit tailored to the "paste a lexicon → see a mapping" flow. It
ships with a heading, a lexicon-import widget, an input JSON editor, a
run button, and an output panel laid out in two columns.

## Testing

protolab has a layered test suite. Every layer is runnable in isolation.

```bash
# Rust: 240 tests. Unit tests per crate, integration tests in
# crates/protolab-eval/tests/*, WASM API smoke tests in
# crates/protolab-wasm/src/api.rs::tests.
cargo test --workspace

# Frontend unit + component: 195 tests via vitest + React Testing Library
# + jsdom, with the WASM bridge swapped for a mock via vitest's alias.
cd app && npm test

# End-to-end: 14 tests via Playwright + real Chromium + real WASM,
# running against the vite dev server. Proves the forward/backward
# evaluation paths and the presentation-mode flow end-to-end.
cd app && npm run test:e2e
```

## Project structure

```
protolab/
├── crates/
│   ├── protolab-schema/    # Circuit protocol definition (panproto-schema wrapping)
│   ├── protolab-core/      # Topological sort, type checking, lens DSL export/import
│   ├── protolab-eval/      # Forward + backward evaluation engine
│   │                       # (expr_ops, wire_data, put_view)
│   └── protolab-wasm/      # wasm-bindgen entry points for the React frontend
├── app/                    # Vite + React 19 + TypeScript + React Flow frontend
│   ├── src/panels/         # Toolbar, Inspector, Palette, DataPanel, editors
│   ├── src/nodes/          # Custom React Flow node component
│   ├── src/edges/          # Custom React Flow edge component (with hover tooltip)
│   ├── src/store/          # Zustand store mediating UI ↔ WASM
│   ├── src/wasm/           # Bridge + msgpack wrappers (pkg/ is built output)
│   └── e2e/                # Playwright specs
├── grammars/               # panproto-expr grammars (TextMate, tree-sitter, VS Code)
└── schemas/                # Nickel component contracts
```

Each crate is a thin wrapper around panproto — protolab never reimplements
schema or lens logic. When a new panproto release ships, protolab
typically bumps the `Cargo.toml` tag and picks up the upgrade with at
most a few lines of glue code.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the third-party
dependency license picture.

## Related projects

- **[panproto]** — the schema, lens, protolens, theory, evaluation, and
  protocol machinery protolab is built on. protolab would be a
  thousand-line afternoon hack without it.
- **[Cambria]** — the lens-based JSON schema evolution system that
  inspired panproto's migration layer.
- **[Max/MSP]** — the visual dataflow environment that inspired
  protolab's hot/cold port model and per-component bang semantics.
- **[React Flow]** — the graph-editor primitives protolab builds its
  canvas on.

[panproto]: https://github.com/panproto/panproto
[panproto-protocols]: https://github.com/panproto/panproto/tree/main/crates/panproto-protocols
[Cambria]: https://www.inkandswitch.com/cambria/
[Max/MSP]: https://cycling74.com/products/max
[React Flow]: https://reactflow.dev/
