/**
 * Custom React Flow edge colored by optic kind, with hover tooltip.
 * Feedback wires rendered with dashed stroke.
 */

import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

const OPTIC_COLORS: Record<string, string> = {
  iso: "#4CAF50",
  lens: "#2196F3",
  prism: "#9C27B0",
  affine: "#FF9800",
  traversal: "#F44336",
};

const OPTIC_DESCRIPTIONS: Record<string, string> = {
  iso: "Isomorphism — lossless, fully reversible. No data is lost.",
  lens: "Lens — projection with complement. Dropped data stored for backward pass.",
  prism: "Prism — conditional. May not apply to all inputs.",
  affine: "Affine — partial projection. Combines lens + prism properties.",
  traversal: "Traversal — multi-focus. Applies to each element independently.",
};

export function WireEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  } = props;
  const d = data as Record<string, unknown> ?? {};
  const opticKind = d.opticKind as string ?? "lens";
  const isFeedback = d.isFeedback as boolean ?? false;
  const complementInfo = d.complementInfo as string ?? "";
  const color = OPTIC_COLORS[opticKind] ?? "#666";
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        {...props}
        path={edgePath}
        style={{
          stroke: selected ? "#fff" : color,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: isFeedback ? "6 3" : undefined,
        }}
      />
      {/* Invisible wider hit area on top for hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: "pointer" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 12}px)`,
              background: "oklch(0.18 0.02 250)",
              border: `1px solid ${color}`,
              borderRadius: 5,
              padding: "6px 10px",
              fontSize: 11,
              color: "#ddd",
              pointerEvents: "none",
              maxWidth: 240,
              lineHeight: 1.4,
              zIndex: 100,
            }}
          >
            <div style={{ fontWeight: 600, color, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.04em", marginBottom: 4 }}>
              {opticKind}{isFeedback ? " (feedback)" : ""}
            </div>
            {complementInfo ? (
              <div>{complementInfo}</div>
            ) : (
              <div>{OPTIC_DESCRIPTIONS[opticKind] ?? "Unknown optic classification."}</div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
