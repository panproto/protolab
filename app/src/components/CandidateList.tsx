/**
 * Ranked lens candidate list. Shown in the Inspector and in
 * presentation mode's SchemaMappingWidget when the candidates API
 * (v0.33.0) returns more than zero results. Each candidate shows
 * quality, coverage, strategy badges, per-step explanations, and a
 * "Use" button that selects that candidate for evaluation.
 */

import { useCircuitStore } from "../store/circuitStore";
import type { LensCandidateDesc, Stringency } from "../wasm/bridge";

const STRINGENCY_OPTIONS: Array<{ value: Stringency; label: string }> = [
  { value: "strict", label: "Strict" },
  { value: "balanced", label: "Balanced" },
  { value: "lenient", label: "Lenient" },
  { value: "exploratory", label: "Exploratory" },
];

const STRATEGY_COLORS: Record<string, string> = {
  Exact: "#4CAF50",
  Alias: "#2196F3",
  TokenSimilarity: "#FF9800",
  WrapUnwrap: "#9C27B0",
  TypeSignature: "#E91E63",
  Structural: "#607D8B",
};

export function StringencySelector() {
  const stringency = useCircuitStore((s) => s.stringency);
  const setStringency = useCircuitStore((s) => s.setStringency);

  return (
    <div
      data-testid="stringency-selector"
      style={{ display: "flex", alignItems: "center", gap: 6 }}
    >
      <label
        style={{
          fontSize: 10,
          color: "#999",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Stringency
      </label>
      <select
        value={stringency}
        onChange={(e) => setStringency(e.target.value as Stringency)}
        style={{
          padding: "3px 6px",
          background: "oklch(0.18 0.01 250)",
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 3,
          color: "#ddd",
          fontSize: 11,
          outline: "none",
          cursor: "pointer",
        }}
      >
        {STRINGENCY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CandidateList() {
  const candidates = useCircuitStore((s) => s.autoLensCandidates);
  const selectedIdx = useCircuitStore((s) => s.selectedCandidateIdx);
  const selectCandidate = useCircuitStore((s) => s.selectCandidate);

  if (candidates.length === 0) return null;

  return (
    <div data-testid="candidate-list" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontSize: 10,
          color: "#999",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Candidates ({candidates.length})
      </div>
      {candidates.map((c, i) => (
        <CandidateCard
          key={i}
          candidate={c}
          index={i}
          selected={i === selectedIdx}
          onSelect={() => selectCandidate(i)}
        />
      ))}
    </div>
  );
}

function CandidateCard({
  candidate,
  index,
  selected,
  onSelect,
}: {
  candidate: LensCandidateDesc;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      data-testid="candidate-card"
      onClick={onSelect}
      style={{
        padding: "8px 10px",
        background: selected
          ? "oklch(0.18 0.03 280)"
          : "oklch(0.14 0.01 250)",
        border: selected
          ? "1px solid oklch(0.35 0.06 280)"
          : "1px solid oklch(0.25 0.01 250)",
        borderRadius: 5,
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#ddd" }}>
          #{index + 1}
        </span>
        <QualityBadge value={candidate.quality} label="quality" />
        <QualityBadge value={candidate.coverage} label="coverage" />
        {selected && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9,
              color: "#9C27B0",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Selected
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
        {candidate.strategies_used.map((s, i) => (
          <span
            key={i}
            style={{
              padding: "1px 5px",
              background: STRATEGY_COLORS[s] ?? "#666",
              color: "#fff",
              borderRadius: 3,
              fontSize: 9,
              fontWeight: 600,
            }}
          >
            {s}
          </span>
        ))}
      </div>
      {candidate.steps.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {candidate.steps.slice(0, 4).map((step, i) => (
            <div
              key={i}
              style={{
                fontSize: 10,
                color: "#aaa",
                lineHeight: 1.5,
                paddingLeft: 4,
              }}
            >
              <span style={{ color: "#888" }}>{step.kind}</span>{" "}
              {step.explanation}
              {step.confidence < 1 && (
                <span style={{ color: "#666", marginLeft: 4 }}>
                  ({(step.confidence * 100).toFixed(0)}%)
                </span>
              )}
            </div>
          ))}
          {candidate.steps.length > 4 && (
            <div style={{ fontSize: 10, color: "#666", paddingLeft: 4 }}>
              +{candidate.steps.length - 4} more steps
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QualityBadge({ value, label }: { value: number; label: string }) {
  const pct = (value * 100).toFixed(0);
  const color =
    value >= 0.85 ? "#1B5E20" : value >= 0.5 ? "#FF9800" : "#B71C1C";
  return (
    <span
      title={`${label}: ${pct}%`}
      style={{
        padding: "1px 5px",
        borderRadius: 3,
        background: color,
        color: "#fff",
        fontSize: 9,
        fontWeight: 700,
      }}
    >
      {pct}% {label}
    </span>
  );
}
