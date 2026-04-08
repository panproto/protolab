/**
 * CodeMirror 6 StreamLanguage for panproto-expr.
 *
 * Token classification mirrors grammars/panproto-expr.tmLanguage.json so
 * highlighting is consistent between the in-app editor and external editors
 * (VS Code with the extension, GitHub linguist, tree-sitter consumers).
 */

import {
  StreamLanguage,
  LanguageSupport,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import {
  BUILTIN_NAME_SET,
  KEYWORD_SET,
  CONSTANT_SET,
} from "./expressionBuiltins";

interface PanprotoExprState {
  // Currently no stateful tracking needed beyond CodeMirror's default.
  // Could be extended later for layout-sensitive parsing if needed.
}

const panprotoExprStreamLanguage = StreamLanguage.define<PanprotoExprState>({
  name: "panproto-expr",

  startState: () => ({}),

  token(stream, _state) {
    // Skip whitespace.
    if (stream.eatSpace()) return null;

    // Line comments: -- to end of line.
    if (stream.match("--")) {
      stream.skipToEnd();
      return "comment";
    }

    // String literals.
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') {
          stream.next(); // skip escaped char
        } else if (ch === '"') {
          break;
        }
      }
      return "string";
    }

    // Numbers (hex, float, integer).
    if (stream.match(/^0x[0-9a-fA-F][0-9a-fA-F_]*/)) return "number";
    if (stream.match(/^[0-9][0-9_]*\.[0-9][0-9_]*/)) return "number";
    if (stream.match(/^[0-9][0-9_]*/)) return "number";

    // Operators (multi-char first to avoid partial matches).
    if (stream.match(/^(->|<-|=>|==|\/=|<=|>=|&&|\|\||\+\+|\.\.|::)/)) {
      return "operator";
    }
    if (stream.match(/^[+\-*/%<>=&|.]/)) {
      return "operator";
    }
    if (stream.match(/^\\/)) {
      return "operator"; // lambda
    }

    // Punctuation.
    if (stream.match(/^[(){}[\],;]/)) {
      return "punctuation";
    }

    // Identifiers / keywords / builtins / constants / constructors.
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_']*/)) {
      const word = stream.current();

      if (KEYWORD_SET.has(word)) return "keyword";
      if (CONSTANT_SET.has(word)) return "atom";
      if (BUILTIN_NAME_SET.has(word)) return "builtin";

      // Uppercase = type/constructor; lowercase = variable.
      if (/^[A-Z]/.test(word)) return "typeName";
      if (word === "_") return "atom";
      return "variableName";
    }

    // Unknown char — advance to avoid infinite loops.
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "--" },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
    indentOnInput: /^\s*(in|then|else|of)$/,
    wordChars: "_'",
  },
});

/**
 * Custom dark theme that maps highlight tags to oklch colors matching
 * protolab's overall palette.
 */
const panprotoExprHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#c678dd", fontWeight: "bold" }, // purple
  { tag: t.comment, color: "#5c6370", fontStyle: "italic" }, // gray
  { tag: t.string, color: "#98c379" }, // green
  { tag: t.number, color: "#d19a66" }, // orange
  { tag: t.atom, color: "#56b6c2" }, // cyan (True/False/Nothing/_)
  { tag: t.operator, color: "#56b6c2" }, // cyan
  { tag: t.punctuation, color: "#abb2bf" }, // light gray
  { tag: t.typeName, color: "#e5c07b" }, // yellow (constructors)
  { tag: t.variableName, color: "#abb2bf" }, // default text
  { tag: t.standard(t.variableName), color: "#61afef", fontWeight: "500" }, // blue (builtins via standard)
]);

/**
 * The full LanguageSupport bundle for panproto-expr.
 * Use as: `extensions={[panprotoExpr()]}` in CodeMirror.
 */
export function panprotoExpr(): LanguageSupport {
  return new LanguageSupport(panprotoExprStreamLanguage, [
    syntaxHighlighting(panprotoExprHighlight),
  ]);
}

// Token type mapping for builtins to use the standard variable highlight
// (which CodeMirror routes to t.standard(t.variableName)).
StreamLanguage.define({
  name: "panproto-expr-tokens",
  startState: () => ({}),
  token: () => null,
  tokenTable: {
    builtin: t.standard(t.variableName),
  },
});
