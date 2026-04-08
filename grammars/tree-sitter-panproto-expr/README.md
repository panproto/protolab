# tree-sitter-panproto-expr

A [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for the panproto expression language.

## Build

```bash
npm install
npx tree-sitter generate
npx tree-sitter build
```

## Test

```bash
npx tree-sitter parse <file.expr>
```

## Use in editors

### Helix

Add to `~/.config/helix/languages.toml`:

```toml
[[language]]
name = "panproto-expr"
scope = "source.panproto-expr"
file-types = ["expr", "pexpr"]
comment-token = "--"
indent = { tab-width = 2, unit = "  " }

[[grammar]]
name = "panproto-expr"
source = { git = "https://github.com/panproto/protolab", subpath = "grammars/tree-sitter-panproto-expr" }
```

Then `hx --grammar fetch` and `hx --grammar build`.

### Neovim (nvim-treesitter)

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.panproto_expr = {
  install_info = {
    url = "https://github.com/panproto/protolab",
    files = { "grammars/tree-sitter-panproto-expr/src/parser.c" },
    branch = "main",
  },
  filetype = "expr",
}
```

## Grammar overview

This grammar covers all forms in the panproto-expr language:

- Literals: integers (decimal, hex), floats, strings (with escape sequences), booleans (`True`, `False`), `Nothing`
- Identifiers: lowercase variables/functions, uppercase constructors, `_` wildcard
- Operators: arithmetic, comparison, logical, concat, pipe, lambda, arrow
- Control flow: `let ... in ...`, `if ... then ... else`, `case ... of ...`
- Lambdas: `\param -> body` (multi-param via nested lambdas)
- Patterns: literal, var, wildcard, list, constructor
- Lists: `[1, 2, 3]`, comprehensions `[x*2 | x <- xs, x > 0]`, ranges `[1..10]`
- Records: `{field: value}`, punning shorthand `{field}`
- Field access: `record.field`
- Indexing: `list[i]` (negative from end)
- Comments: `-- ...` (line only; no block comments)

## Layout sensitivity

The actual panproto-expr-parser is layout-sensitive (Haskell-style). tree-sitter does not natively support indentation-based parsing, so this grammar treats whitespace as insignificant. For most well-formatted code (or code using explicit `{...}` braces) the highlighting is accurate.

For full layout-aware parsing, use the Rust parser via `panproto_expr_parser::parse` directly — that's what the protolab in-app editor calls.
