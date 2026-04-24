/**
 * Edit-mode canvas overlay shown when panproto's auto-discovery
 * couldn't derive a usable transform between the assigned source and
 * target schemas — either because the CSP ran but produced no data-
 * level steps, or because it failed to find any morphism at all.
 *
 * The overlay surfaces three things:
 *   1. The error / partial-coverage explanation.
 *   2. The anchors the alignment strategies did discover, each
 *      promotable to a persistent hint with one click. For schemas
 *      with disjoint vocabularies this is the only real signal the
 *      user gets about what correspondences the tool saw, and is
 *      often enough to bootstrap a manual mapping (e.g. `tags → tags`,
 *      `labels → labels` between two atproto lexicons).
 *   3. Escape hatches: open the hint editor for full hint control,
 *      view the theory-level diff, or drag components from the
 *      palette.
 */

import { useCircuitStore } from "../store/circuitStore";
import { StringencySelector, CandidateList } from "./CandidateList";

const PANEL_BG = "oklch(0.14 0.01 250)";
const PANEL_BORDER = "oklch(0.3 0.01 250)";
const CHIP_BG = "oklch(0.20 0.01 250)";
const CHIP_BORDER = "oklch(0.32 0.01 250)";
const CHIP_HOVER = "oklch(0.26 0.01 250)";
const ACCENT_GREEN = "#4CAF50";
const ACCENT_BLUE = "#2196F3";

export function CanvasEmptyState() {
  const shouldShow = useCircuitStore((s) => {
    if (s.sourceSchemaHandle === null || s.targetSchemaHandle === null)
      return false;
    if (s.nodes.length > 0) return false;
    // Case A: autogen succeeded but produced nothing data-level useful.
    const successButEmpty =
      s.autoLensStatus === "success" && s.autoLensChainSteps.length > 0;
    // Case B: autogen errored — typically "no morphism found".
    const errored = s.autoLensError !== null;
    return successButEmpty || errored;
  });
  const openHintEditor = useCircuitStore((s) => s.openHintEditor);
  const openTheoryDiff = useCircuitStore((s) => s.openTheoryDiff);
  const hasCandidates = useCircuitStore((s) => s.autoLensCandidates.length > 0);
  const discoveredAnchors = useCircuitStore((s) => s.discoveredAnchors);
  const pinnedAnchors = useCircuitStore((s) => s.autoLensHints.anchors ?? {});
  const promoteAnchorToHint = useCircuitStore((s) => s.promoteAnchorToHint);
  const autoLensError = useCircuitStore((s) => s.autoLensError);

  if (!shouldShow) return null;

  const isErrored = autoLensError !== null;
  const unpinnedAnchors = discoveredAnchors.filter(
    (a) => pinnedAnchors[a.src] !== a.tgt,
  );

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
          width: "min(560px, calc(100% - 40px))",
          maxHeight: "calc(100% - 40px)",
          overflowY: "auto",
          background: PANEL_BG,
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: 10,
          padding: "20px 24px",
          color: "#ddd",
          boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            marginBottom: 4,
            letterSpacing: "-0.005em",
          }}
        >
          {isErrored
            ? "No automatic mapping found"
            : "No data-level mapping inferred"}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#9aa0ab",
            lineHeight: 1.55,
            marginBottom: 16,
          }}
        >
          {isErrored
            ? "The solver couldn't fit a morphism across every source vertex. This is common when the schemas cover different vocabularies and most of one side has no analog on the other."
            : "panproto couldn't derive a transform between these schemas automatically. The field names don't overlap enough for the solver to guess."}{" "}
          {unpinnedAnchors.length > 0
            ? "Lock one of the correspondences below as a hint and the search will retry — or open the hint editor for full control."
            : "Add hints to guide the search, or build the chain by hand."}
        </div>

        {unpinnedAnchors.length > 0 && (
          <AnchorChips
            anchors={unpinnedAnchors}
            onPin={(src, tgt) => promoteAnchorToHint(src, tgt)}
          />
        )}

        {Object.keys(pinnedAnchors).length > 0 && (
          <PinnedAnchors anchors={pinnedAnchors} />
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: unpinnedAnchors.length > 0 ? 16 : 4,
          }}
        >
          <button
            onClick={openHintEditor}
            data-testid="canvas-empty-add-hints"
            style={{
              flex: 1,
              padding: "8px 14px",
              background: CHIP_BG,
              color: "#e4e6ea",
              border: `1px solid ${CHIP_BORDER}`,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Open hint editor
          </button>
          <button
            onClick={openTheoryDiff}
            data-testid="canvas-empty-view-diff"
            style={{
              flex: 1,
              padding: "8px 14px",
              background: CHIP_BG,
              color: "#9aa0ab",
              border: `1px solid ${CHIP_BORDER}`,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            View theory diff
          </button>
        </div>

        {hasCandidates && (
          <div style={{ marginTop: 12 }}>
            <CandidateList />
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <StringencySelector />
        </div>

        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: `1px solid ${PANEL_BORDER}`,
            fontSize: 11,
            color: "#777",
            lineHeight: 1.5,
          }}
        >
          Or drag components from the palette to build the lens by hand.
        </div>
      </div>
    </div>
  );
}

function AnchorChips({
  anchors,
  onPin,
}: {
  anchors: ReadonlyArray<{
    src: string;
    tgt: string;
    confidence: number;
    strategy: string;
  }>;
  onPin: (src: string, tgt: string) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "#9aa0ab",
          marginBottom: 6,
        }}
      >
        Discovered correspondences
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: 180,
          overflowY: "auto",
        }}
      >
        {anchors.slice(0, 8).map((a) => (
          <button
            key={`${a.src}→${a.tgt}`}
            onClick={() => onPin(a.src, a.tgt)}
            title={`Promote to hint (strategy: ${a.strategy}, confidence: ${a.confidence.toFixed(2)})`}
            data-testid={`canvas-empty-anchor-${a.src}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr auto",
              gap: 8,
              alignItems: "center",
              padding: "6px 10px",
              background: CHIP_BG,
              border: `1px solid ${CHIP_BORDER}`,
              borderRadius: 5,
              color: "#e4e6ea",
              fontSize: 11,
              fontFamily:
                'ui-monospace, "JetBrains Mono", "Berkeley Mono", Menlo, monospace',
              textAlign: "left",
              cursor: "pointer",
              transition: "background 80ms ease",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = CHIP_HOVER)
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = CHIP_BG)}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: ACCENT_GREEN,
              }}
            >
              {terminalSegment(a.src)}
            </span>
            <span style={{ color: "#555" }}>→</span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: ACCENT_BLUE,
              }}
            >
              {terminalSegment(a.tgt)}
            </span>
            <span
              style={{
                fontSize: 9,
                color: "#777",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {strategyLabel(a.strategy)}
            </span>
          </button>
        ))}
        {anchors.length > 8 && (
          <div
            style={{
              fontSize: 10,
              color: "#777",
              padding: "2px 0 0 4px",
            }}
          >
            + {anchors.length - 8} more in the hint editor
          </div>
        )}
      </div>
    </div>
  );
}

function PinnedAnchors({ anchors }: { anchors: Record<string, string> }) {
  const entries = Object.entries(anchors);
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "#9aa0ab",
          marginBottom: 6,
        }}
      >
        Pinned hints
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {entries.map(([src, tgt]) => (
          <div
            key={src}
            style={{
              fontSize: 11,
              fontFamily:
                'ui-monospace, "JetBrains Mono", "Berkeley Mono", Menlo, monospace',
              color: "#bbb",
              padding: "3px 8px",
              background: "transparent",
              borderLeft: `2px solid ${ACCENT_GREEN}`,
            }}
          >
            {terminalSegment(src)}{" "}
            <span style={{ color: "#555" }}>→</span> {terminalSegment(tgt)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Trim an NSID-qualified vertex id (`app.bsky.feed.post:body.tags`)
 * to its terminal path segment (`tags`) for display. Falls back to
 * the full id when there's no separator.
 */
function terminalSegment(id: string): string {
  const sepIdx = Math.max(
    id.lastIndexOf("."),
    id.lastIndexOf(":"),
    id.lastIndexOf("#"),
  );
  return sepIdx >= 0 ? id.slice(sepIdx + 1) : id;
}

function strategyLabel(tag: string): string {
  // Tags arrive as Debug-formatted Rust variants ("Exact", "ExactSuffix",
  // "TokenSimilarity", ...). Camel-split for compactness.
  return tag
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}
