/**
 * Theory-level diff modal. Shows the chain of elementary theory
 * transforms (AddSort, DropOp, etc.) that panproto derived between
 * the source and target schemas when no data-level mapping could be
 * inferred. Kept in a separate modal so the edit-mode canvas isn't
 * polluted with components that don't actually transform data.
 */

import { useCircuitStore } from "../store/circuitStore";

export function TheoryDiffModal() {
  const steps = useCircuitStore((s) => s.autoLensChainSteps);
  const close = useCircuitStore((s) => s.closeTheoryDiff);

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
          width: 720,
          maxHeight: "85vh",
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
            {steps.length} {steps.length === 1 ? "step" : "steps"}
          </div>
          <button
            onClick={close}
            style={{
              marginLeft: "auto",
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
          theory. They describe the structural diff between the two
          schemas but do <strong>not</strong> transform instance data.
          To produce data-level output, add hints or build the lens
          manually.
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px 12px" }}>
          {steps.length === 0 ? (
            <div style={{ color: "#666", padding: 12 }}>
              No chain steps. Source and target schema theories are
              already equivalent at the structural level.
            </div>
          ) : (
            steps.map((step, i) => (
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
                  <TransformLine label="source" value={step.sourceTransform} />
                  <TransformLine label="target" value={step.targetTransform} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TransformLine({ label, value }: { label: string; value: string }) {
  // Skip identity rows — they're the overwhelming majority and add
  // no information. Users can see which side contributed by the
  // non-identity line.
  if (value === "Identity") return null;
  return (
    <div style={{ fontSize: 10, color: "#bbb" }}>
      <span style={{ color: "#666" }}>{label}: </span>
      {value}
    </div>
  );
}
