/**
 * Edit-mode canvas overlay shown when panproto's auto-discovery
 * couldn't derive any data-level transforms between the assigned
 * source and target schemas.
 *
 * Before v0.4.4 the canvas was populated with `chain_step` placeholder
 * components that ran as the identity at the instance level — so Run
 * produced the input verbatim, plus a red validation badge, with no
 * visible explanation. This overlay replaces that UX with three
 * explicit next steps:
 *   1. Add hints to guide the morphism search  (primary)
 *   2. View the theory-level diff in a modal   (secondary)
 *   3. Drag components from the palette        (manual path)
 *
 * Visible only when: both schemas assigned, auto-lens succeeded,
 * zero circuit components installed, and the chain had at least one
 * step (i.e. the schemas weren't already identical — identity case
 * legitimately has an empty canvas with nothing to explain).
 */

import { useCircuitStore } from "../store/circuitStore";
import { StringencySelector, CandidateList } from "./CandidateList";

export function CanvasEmptyState() {
  const shouldShow = useCircuitStore((s) => {
    return (
      s.autoLensStatus === "success" &&
      s.sourceSchemaHandle !== null &&
      s.targetSchemaHandle !== null &&
      s.autoLensChainSteps.length > 0 &&
      s.nodes.length === 0
    );
  });
  const openHintEditor = useCircuitStore((s) => s.openHintEditor);
  const openTheoryDiff = useCircuitStore((s) => s.openTheoryDiff);
  const hasCandidates = useCircuitStore((s) => s.autoLensCandidates.length > 0);

  if (!shouldShow) return null;

  return (
    <div
      data-testid="canvas-empty-state"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          maxWidth: 480,
          background: "oklch(0.14 0.01 250)",
          border: "1px solid oklch(0.3 0.01 250)",
          borderRadius: 10,
          padding: "24px 28px",
          color: "#ddd",
          boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            fontSize: 36,
            marginBottom: 8,
          }}
        >
          🧭
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "#fff",
            marginBottom: 6,
          }}
        >
          No data-level mapping inferred
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#aaa",
            lineHeight: 1.55,
            marginBottom: 18,
          }}
        >
          panproto couldn't derive a transform between these schemas
          automatically. That usually means the field names don't
          overlap enough for the solver to guess.
          <br />
          Tell the system which fields correspond, or build the chain
          by hand.
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "stretch",
          }}
        >
          <button
            onClick={openHintEditor}
            data-testid="canvas-empty-add-hints"
            style={{
              padding: "10px 16px",
              background: "#9C27B0",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: "0.01em",
            }}
          >
            🎯 Add hints to guide the search
          </button>
          <button
            onClick={openTheoryDiff}
            data-testid="canvas-empty-view-diff"
            style={{
              padding: "8px 14px",
              background: "oklch(0.22 0.01 250)",
              color: "#ccc",
              border: "1px solid oklch(0.35 0.01 250)",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            View theory-level diff
          </button>
        </div>
        {hasCandidates && (
          <div style={{ marginTop: 12, maxWidth: "100%" }}>
            <CandidateList />
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <StringencySelector />
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: "#777",
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden="true">←</span> Or drag components from the
          palette to build the lens manually.
        </div>
      </div>
    </div>
  );
}
