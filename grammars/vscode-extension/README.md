# Panproto Expression Language — VS Code Extension

Syntax highlighting for `.expr` and `.pexpr` files (the panproto expression language used in protolab, panproto-lens, and panproto-theory-dsl).

## What it highlights

- **Keywords**: `let`, `in`, `where`, `if`/`then`/`else`, `case`/`of`, `do`, `guard`, `not`, `mod`, `div`
- **Constants**: `True`, `False`, `Nothing`, `otherwise`
- **Builtins** (highlighted distinctly from user functions): the ~59 builtins from panproto-expr — `add`, `map`, `filter`, `concat`, `upper`, `lower`, `head`, `tail`, `merge`, `keys`, `values`, `has_field`, `int_to_str`, `type_of`, `edge`, etc.
- **Operators**: arithmetic (`+ - * / %`), comparison (`== /= < <= > >=`), logical (`&& ||`), concat (`++`), pipe (`&`), lambda (`\`), arrow (`->`), generator (`<-`), range (`..`), field access (`.`)
- **Numbers**: decimal `42`, hex `0xFF`, float `3.14`
- **Strings**: `"hello\nworld"` with `\\ \" \n \t \r \0 \xNN \u{...}` escapes
- **Comments**: `-- line comments`
- **Constructors**: `Pair`, `Just`, `Cons` (uppercase identifiers)
- **Variables**: `x`, `my_field`, `x'` (lowercase, primes allowed)

## Install (local development)

```bash
# Symlink into your VS Code extensions folder:
ln -s "$(pwd)" ~/.vscode/extensions/panproto-expr-0.1.0

# Or package and install:
npx vsce package
code --install-extension panproto-expr-0.1.0.vsix
```

Then reload VS Code. Open any `.expr` file and you'll see syntax highlighting.

## Example

```
-- A simple panproto-expr expression
let
  greet name = concat "Hello, " (concat name "!")
  upperCase = \s -> upper s
in
  map (\x -> upperCase (greet x)) ["alice", "bob", "charlie"]
```

## Grammar source

This extension's grammar (`syntaxes/panproto-expr.tmLanguage.json`) is generated from the canonical token definitions in `../tokens.json`. The same grammar is used by:

- The protolab in-app expression editor (CodeMirror 6)
- This VS Code extension
- The tree-sitter grammar at `../tree-sitter-panproto-expr/`
- GitHub linguist (when contributed upstream)
