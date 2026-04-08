# grammars/

Portable grammars for the panproto expression language. The same token definitions are compiled into multiple formats:

| Format | File | Used by |
|--------|------|---------|
| **Canonical token definition** | `tokens.json` | Source of truth — keywords, builtins, operators, regex patterns |
| **TextMate grammar** | `panproto-expr.tmLanguage.json` | VS Code, Sublime Text, Atom, BBEdit, GitHub linguist |
| **VS Code extension** | `vscode-extension/` | Installable VS Code language pack |
| **tree-sitter grammar** | `tree-sitter-panproto-expr/` | Helix, Neovim, Zed, any tree-sitter-aware tool |

The protolab in-app expression editor (CodeMirror 6) uses its own port of these definitions in `app/src/components/expressionLanguage.ts`, sharing the same builtin list and keyword set so highlighting is consistent between the in-app editor and external editors.

## Install the VS Code extension locally

```bash
ln -s "$(pwd)/vscode-extension" ~/.vscode/extensions/panproto-expr-0.1.0
# Reload VS Code, then open any .expr file.
```

## Build the tree-sitter grammar

```bash
cd tree-sitter-panproto-expr
npm install
npx tree-sitter generate
npx tree-sitter test
```

## Language reference

See `vscode-extension/README.md` for the language overview.

For the authoritative parser, see `panproto-expr-parser` in the panproto repository — these grammars track its surface syntax but do not attempt to be a complete reimplementation. The only correct evaluator is `panproto_expr::eval`.
