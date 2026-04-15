/**
 * Theory-level diff modal. Shows the protolens chain's sort/op-level
 * rewrites between source and target schemas when no data-level
 * mapping could be inferred — kept in a separate modal so the
 * edit-mode canvas isn't polluted with components that don't
 * transform instance data.
 *
 * Layout: each step's `name` already encodes the operation as
 * `${verb}_${kind}_${target}` (e.g. `drop_op_record-schema`,
 * `add_sort_string`). We parse that into a clean structured row and
 * group consecutive same-(verb, kind) operations together so 18
 * steps render as a few digestible buckets instead of 18 lines of
 * raw Rust Debug. A "Show raw" toggle exposes the full
 * `TheoryTransform` Debug strings for users who need them.
 */

import { useMemo, useState } from "react";
import { useCircuitStore } from "../store/circuitStore";

interface RawStep {
  name: string;
  sourceTransform: string;
  targetTransform: string;
}

interface ParsedStep {
  index: number;
  raw: RawStep;
  verb: "add" | "drop" | "rename" | "other";
  kind: "op" | "sort" | "equation" | "other";
  payload: string;
}

interface Group {
  verb: ParsedStep["verb"];
  kind: ParsedStep["kind"];
  steps: ParsedStep[];
}

const VERB_LABEL: Record<ParsedStep["verb"], string> = {
  add: "add",
  drop: "drop",
  rename: "rename",
  other: "other",
};

const VERB_COLOR: Record<ParsedStep["verb"], string> = {
  add: "#4CAF50",
  drop: "#F44336",
  rename: "#FF9800",
  other: "#888",
};

function parseStep(raw: RawStep, index: number): ParsedStep {
  // Names look like `drop_op_record-schema`, `add_sort_string`,
  // `rename_op_oldname`. Some payloads themselves contain `_` (e.g.
  // `record-schema`). Match verb + kind only at the prefix and treat
  // the rest as payload.
  const match = raw.name.match(/^(add|drop|rename)_(op|sort|equation)_(.+)$/);
  if (match) {
    return {
      index,
      raw,
      verb: match[1] as ParsedStep["verb"],
      kind: match[2] as ParsedStep["kind"],
      payload: match[3],
    };
  }
  return { index, raw, verb: "other", kind: "other", payload: raw.name };
}

function groupSteps(steps: ParsedStep[]): Group[] {
  const groups: Group[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.verb === step.verb && last.kind === step.kind) {
      last.steps.push(step);
    } else {
      groups.push({ verb: step.verb, kind: step.kind, steps: [step] });
    }
  }
  return groups;
}

/** "string, string, string, string" → "string ×4"; preserves order. */
function compressPayloads(payloads: string[]): string {
  const out: Array<{ name: string; count: number }> = [];
  for (const p of payloads) {
    const last = out[out.length - 1];
    if (last && last.name === p) last.count += 1;
    else out.push({ name: p, count: 1 });
  }
  return out
    .map((p) => (p.count > 1 ? `${p.name} ×${p.count}` : p.name))
    .join(", ");
}

export function TheoryDiffModal() {
  const rawSteps = useCircuitStore((s) => s.autoLensChainSteps);
  const close = useCircuitStore((s) => s.closeTheoryDiff);
  const [showRaw, setShowRaw] = useState(false);

  const parsed = useMemo(
    () => rawSteps.map((s, i) => parseStep(s, i)),
    [rawSteps],
  );
  const groups = useMemo(() => groupSteps(parsed), [parsed]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        data-testid="theory-diff-modal"
        style={{
          background: "oklch(0.14 0.01 250)",
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 8,
          width: 600,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          color: "#ddd",
          fontSize: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid oklch(0.25 0.01 250)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14 }}>Theory-level diff</div>
          <div style={{ fontSize: 10, color: "#888" }}>
            {rawSteps.length} {rawSteps.length === 1 ? "step" : "steps"}
            {rawSteps.length > 0 && groups.length < rawSteps.length && (
              <> · {groups.length} group{groups.length === 1 ? "" : "s"}</>
            )}
          </div>
          <button
            onClick={() => setShowRaw((v) => !v)}
            data-testid="theory-diff-toggle-raw"
            title="Toggle raw TheoryTransform Debug output"
            style={{
              marginLeft: "auto",
              padding: "2px 10px",
              background: "oklch(0.22 0.01 250)",
              border: "1px solid oklch(0.35 0.01 250)",
              borderRadius: 3,
              color: "#ccc",
              cursor: "pointer",
              fontSize: 10,
            }}
          >
            {showRaw ? "Hide raw" : "Show raw"}
          </button>
          <button
            onClick={close}
            style={{
              padding: "2px 10px",
              background: "oklch(0.22 0.01 250)",
              border: "1px solid oklch(0.35 0.01 250)",
              borderRadius: 3,
              color: "#ccc",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Close
          </button>
        </div>
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid oklch(0.22 0.01 250)",
            color: "#aaa",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          These are the sort/op-level rewrites panproto derived to
          transform the source schema theory into the target schema
          theory. They describe the structural diff but do{" "}
          <strong>not</strong> transform instance data. Add hints or
          build the lens manually to produce data-level output.
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px 12px" }}>
          {rawSteps.length === 0 ? (
            <div style={{ color: "#666", padding: 12 }}>
              No chain steps. Source and target schema theories are
              already equivalent at the structural level.
            </div>
          ) : showRaw ? (
            <RawList steps={rawSteps} />
          ) : (
            <GroupList groups={groups} />
          )}
        </div>
      </div>
    </div>
  );
}

function GroupList({ groups }: { groups: Group[] }) {
  return (
    <div>
      {groups.map((group, i) => {
        const payloads = group.steps.map((s) => s.payload);
        const verbColor = VERB_COLOR[group.verb];
        const compressed = compressPayloads(payloads);
        return (
          <div
            key={i}
            data-testid="theory-diff-step"
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              padding: "6px 0",
              borderBottom: "1px solid oklch(0.18 0.01 250)",
              fontFamily: "ui-monospace, SF Mono, monospace",
            }}
          >
            <span
              style={{
                color: "#666",
                fontSize: 10,
                minWidth: 32,
                textAlign: "right",
              }}
            >
              {group.steps.length === 1
                ? `${group.steps[0].index + 1}`
                : `${group.steps[0].index + 1}–${
                    group.steps[group.steps.length - 1].index + 1
                  }`}
            </span>
            <span
              style={{
                color: verbColor,
                fontWeight: 600,
                fontSize: 11,
                minWidth: 50,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {VERB_LABEL[group.verb]}
            </span>
            <span style={{ color: "#888", fontSize: 11, minWidth: 36 }}>
              {group.kind}
            </span>
            <span style={{ color: "#ddd", fontSize: 11, wordBreak: "break-word" }}>
              {compressed}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RawList({ steps }: { steps: RawStep[] }) {
  return (
    <div>
      {steps.map((step, i) => (
        <div
          key={i}
          data-testid="theory-diff-step"
          style={{
            padding: "8px 0",
            borderBottom: "1px solid oklch(0.18 0.01 250)",
            fontFamily: "ui-monospace, SF Mono, monospace",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                color: "#888",
                fontSize: 10,
                minWidth: 20,
                textAlign: "right",
              }}
            >
              {i + 1}
            </span>
            <span style={{ color: "#98c379", fontWeight: 600, fontSize: 11 }}>
              {step.name}
            </span>
          </div>
          <div style={{ paddingLeft: 28, marginTop: 2 }}>
            {step.sourceTransform !== "Identity" && (
              <div style={{ fontSize: 10, color: "#bbb" }}>
                <span style={{ color: "#666" }}>source: </span>
                {step.sourceTransform}
              </div>
            )}
            {step.targetTransform !== "Identity" && (
              <div style={{ fontSize: 10, color: "#bbb" }}>
                <span style={{ color: "#666" }}>target: </span>
                {step.targetTransform}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
