/**
 * ExpressionEditor — CodeMirror 6 editor for the panproto expression language.
 *
 * Features:
 * - Custom syntax highlighting via expressionLanguage.ts
 * - Autocomplete for builtins, keywords, constants
 * - Live linting via WASM parse_expression (debounced)
 * - Optional test panel: sample env JSON + Eval button + result display
 * - Compact mode (single-line, no line numbers) for inline use in Inspector
 */

import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput, foldGutter } from "@codemirror/language";
import {
  autocompletion,
  completionKeymap,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { linter, lintGutter, Diagnostic } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";

import { panprotoExpr } from "./expressionLanguage";
import { BUILTINS, KEYWORDS, CONSTANTS } from "./expressionBuiltins";
import * as wasm from "../wasm/bridge";

interface ExpressionEditorProps {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  showTestPanel?: boolean;
  height?: number;
  placeholder?: string;
}

/**
 * Build the autocomplete source. Returns builtins + keywords + constants
 * filtered by the current word being typed.
 */
function exprCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[a-zA-Z_][a-zA-Z0-9_']*/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;

  return {
    from: word.from,
    options: [
      ...BUILTINS.map((b) => ({
        label: b.name,
        type: "function",
        detail: b.signature,
        info: b.category,
        boost: 5,
      })),
      ...KEYWORDS.map((k) => ({
        label: k,
        type: "keyword",
        boost: 10,
      })),
      ...CONSTANTS.map((c) => ({
        label: c,
        type: "constant",
        boost: 8,
      })),
    ],
  };
}

/**
 * Linter that calls the WASM parse_expression function on debounced input.
 * Returns Diagnostic[] for any parse errors.
 */
function exprLinter(view: EditorView): Diagnostic[] {
  const source = view.state.doc.toString();
  if (!source.trim()) return [];

  try {
    const result = wasm.parseExpression(source);
    if (result.ok) return [];
    return [
      {
        from: 0,
        to: source.length,
        severity: "error",
        message: result.error ?? "Parse error",
      },
    ];
  } catch (err) {
    return [
      {
        from: 0,
        to: source.length,
        severity: "error",
        message: String(err),
      },
    ];
  }
}

export function ExpressionEditor({
  value,
  onChange,
  compact = false,
  showTestPanel = false,
  height,
  placeholder = "",
}: ExpressionEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [testEnv, setTestEnv] = useState('{\n  "x": 5\n}');
  const [testResult, setTestResult] = useState<string>("");
  const [testError, setTestError] = useState<string | null>(null);

  // Initialize editor.
  useEffect(() => {
    if (!containerRef.current) return;

    const editableCompartment = new Compartment();

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newValue = update.state.doc.toString();
        onChangeRef.current(newValue);
      }
    });

    const extensions = [
      panprotoExpr(),
      autocompletion({ override: [exprCompletions] }),
      linter(exprLinter, { delay: 300 }),
      bracketMatching(),
      indentOnInput(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
      oneDark,
      updateListener,
      editableCompartment.of(EditorState.readOnly.of(false)),
      EditorView.theme({
        "&": {
          height: compact ? "auto" : `${height ?? 200}px`,
          fontSize: "12px",
          fontFamily: "monospace",
        },
        ".cm-content": {
          padding: compact ? "4px 8px" : "8px",
          ...(compact ? { minHeight: "20px" } : {}),
        },
        ".cm-scroller": {
          overflow: "auto",
        },
        "&.cm-focused": {
          outline: "1px solid #2196F3",
        },
      }),
    ];

    if (!compact) {
      extensions.push(lineNumbers(), foldGutter(), lintGutter(), highlightActiveLine());
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, height]);

  // Sync external value changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  const runTest = () => {
    try {
      const result = wasm.evaluateExpression(value, testEnv);
      setTestResult(result);
      setTestError(null);
    } catch (err) {
      setTestError(String(err));
      setTestResult("");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        ref={containerRef}
        style={{
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 4,
          background: "oklch(0.12 0.01 250)",
          overflow: "hidden",
        }}
      >
        {!value && placeholder && (
          <div
            style={{
              position: "absolute",
              padding: "8px",
              color: "#555",
              pointerEvents: "none",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            {placeholder}
          </div>
        )}
      </div>

      {showTestPanel && (
        <div
          style={{
            display: "flex",
            gap: 6,
            background: "oklch(0.13 0.01 250)",
            border: "1px solid oklch(0.25 0.01 250)",
            borderRadius: 4,
            padding: 6,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "#777", marginBottom: 2 }}>
              Sample env (JSON)
            </div>
            <textarea
              value={testEnv}
              onChange={(e) => setTestEnv(e.target.value)}
              style={{
                width: "100%",
                height: 80,
                background: "oklch(0.1 0.01 250)",
                color: "#ddd",
                border: "1px solid oklch(0.3 0.01 250)",
                borderRadius: 3,
                fontFamily: "monospace",
                fontSize: 11,
                padding: 4,
                resize: "vertical",
              }}
              spellCheck={false}
            />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <button
              onClick={runTest}
              style={{
                padding: "4px 10px",
                background: "#2196F3",
                color: "#fff",
                border: "none",
                borderRadius: 3,
                cursor: "pointer",
                fontSize: 11,
                alignSelf: "flex-start",
              }}
            >
              Eval ▶
            </button>
            <div style={{ fontSize: 10, color: "#777" }}>Result</div>
            <div
              style={{
                flex: 1,
                background: "oklch(0.1 0.01 250)",
                border: `1px solid ${testError ? "#F44336" : "oklch(0.3 0.01 250)"}`,
                borderRadius: 3,
                padding: 4,
                fontSize: 11,
                fontFamily: "monospace",
                color: testError ? "#F44336" : "#98c379",
                whiteSpace: "pre-wrap",
                overflow: "auto",
                minHeight: 60,
              }}
            >
              {testError ?? testResult ?? "(no result)"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
