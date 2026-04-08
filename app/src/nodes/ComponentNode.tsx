/**
 * Custom React Flow node for circuit components.
 */

import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

const OPTIC_COLORS: Record<string, string> = {
  iso: "#4CAF50",
  lens: "#2196F3",
  prism: "#9C27B0",
  affine: "#FF9800",
  traversal: "#F44336",
};

const OPTIC_BG: Record<string, string> = {
  iso: "rgba(76, 175, 80, 0.08)",
  lens: "rgba(33, 150, 243, 0.08)",
  prism: "rgba(156, 39, 176, 0.08)",
  affine: "rgba(255, 152, 0, 0.08)",
  traversal: "rgba(244, 67, 54, 0.08)",
};

interface PortData {
  id: string;
  direction: "input" | "output" | "parameter";
  trigger: "hot" | "cold";
}

interface ParamData {
  key: string;
  value: string;
}

export interface ComponentNodeData {
  label: string;
  componentType: string;
  opticKind: string;
  ports: PortData[];
  params: ParamData[];
}

export function ComponentNode({ data, selected }: NodeProps) {
  const d = data as unknown as ComponentNodeData;
  const borderColor = OPTIC_COLORS[d.opticKind] ?? "#666";
  const bgColor = OPTIC_BG[d.opticKind] ?? "rgba(100,100,100,0.05)";
  const [tooltip, setTooltip] = useState<PortData | null>(null);

  const inputs = d.ports.filter((p) => p.direction === "input");
  const outputs = d.ports.filter((p) => p.direction === "output");
  const params = d.ports.filter((p) => p.direction === "parameter");

  return (
    <>
      {/*
        Port handles OUTSIDE the styled div so React Flow positions them
        relative to the node's bounding box, not the inner content div.
      */}

      {/* Input handles — left side */}
      {inputs.map((port) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          onMouseEnter={() => setTooltip(port)}
          onMouseLeave={() => setTooltip(null)}
          style={{
            background: port.trigger === "hot" ? borderColor : "transparent",
            border: `2px solid ${borderColor}`,
            width: 10,
            height: 10,
          }}
        />
      ))}

      {/* Output handles — right side */}
      {outputs.map((port) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          onMouseEnter={() => setTooltip(port)}
          onMouseLeave={() => setTooltip(null)}
          style={{
            background: port.trigger === "hot" ? borderColor : "transparent",
            border: `2px solid ${borderColor}`,
            width: 10,
            height: 10,
          }}
        />
      ))}

      {/* Parameter handles — top, black center */}
      {params.map((port) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Top}
          id={port.id}
          onMouseEnter={() => setTooltip(port)}
          onMouseLeave={() => setTooltip(null)}
          style={{
            background: "#111",
            border: `2px dashed ${borderColor}`,
            width: 8,
            height: 8,
          }}
        />
      ))}

      {/* Node content */}
      <div
        style={{
          border: `2px solid ${selected ? "#fff" : borderColor}`,
          borderRadius: 8,
          background: bgColor,
          padding: "12px 16px",
          minWidth: 180,
          color: "#e0e0e0",
          fontSize: 12,
          fontFamily: "inherit",
          boxShadow: selected ? `0 0 12px ${borderColor}44` : undefined,
        }}
      >
        {/* Header + optic badge on same line */}
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: borderColor, display: "inline-block", flexShrink: 0 }} />
          {d.label}
          <span style={{ fontSize: 10, color: borderColor, textTransform: "uppercase", letterSpacing: "0.05em", marginLeft: "auto", fontWeight: 500 }}>
            {d.opticKind}
          </span>
        </div>

        {/* Params */}
        {d.params.length > 0 && (
          <div style={{ fontSize: 11, color: "#999", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 6, marginTop: 4, lineHeight: 1.6 }}>
            {d.params.map((p) => (
              <div key={p.key}>
                {p.key}: <span style={{ color: "#ccc" }}>{p.value || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "oklch(0.2 0.02 250)",
            border: "1px solid oklch(0.35 0.02 250)",
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 10,
            color: "#ddd",
            whiteSpace: "nowrap",
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 600 }}>{tooltip.id}</div>
          <div>
            {tooltip.direction} · {tooltip.trigger === "hot" ? "⚡ hot" : "❄ cold"}
          </div>
        </div>
      )}
    </>
  );
}
