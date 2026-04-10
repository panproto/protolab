import type { WidgetProps } from "../WidgetRegistry";
import { useCircuitStore } from "../../store/circuitStore";

const OPTIC_COLORS: Record<string, string> = {
  iso: "#4CAF50",
  lens: "#2196F3",
  prism: "#9C27B0",
  affine: "#FF9800",
  traversal: "#F44336",
};

/**
 * Summarize a component's key params into a short human-readable string.
 * Each component type has a different "signature" shape; this function
 * picks the most informative params and formats them compactly.
 */
function summarizeParams(
  componentType: string,
  params: Array<{ key: string; value: string }>,
): string {
  const get = (key: string) => params.find((p) => p.key === key)?.value ?? "";
  switch (componentType) {
    case "rename_field":
      return `${get("old_name")} → ${get("new_name")}`;
    case "add_field":
      return `${get("field_name")} = "${get("default")}"`;
    case "drop_field":
      return get("field_name");
    case "hoist_field":
      return `${get("parent")}.${get("intermediate")}.${get("child")}`;
    case "nest_field":
      return `${get("child")} into ${get("wrapper")}`;
    case "coerce_type":
    case "apply_expr":
      return `${get("field")}: ${get("expr")}`;
    case "compute_field":
      return `${get("target")} = ${get("expr")}`;
    case "map_items":
      return `over ${get("focus")}`;
    default:
      return params
        .filter((p) => p.value && !p.key.startsWith("presentation:"))
        .map((p) => `${p.key}: ${p.value}`)
        .join(", ");
  }
}

/**
 * SVG connector between adjacent step cards: a short vertical line with
 * a color gradient, capped by a filled triangle. Vertically centered in
 * a fixed-height box so the gap above and below each card is equal.
 */
function StepConnector({ color, nextColor }: { color: string; nextColor: string }) {
  const id = `grad-${color}-${nextColor}`.replace(/[^a-zA-Z0-9-]/g, "");
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: 28,
      }}
    >
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.5" />
            <stop offset="100%" stopColor={nextColor} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {/* Vertical stem */}
        <line x1="8" y1="0" x2="8" y2="12" stroke={`url(#${id})`} strokeWidth="2" />
        {/* Filled triangle */}
        <path d="M4 12 L8 19 L12 12 Z" fill={nextColor} fillOpacity="0.5" />
      </svg>
    </div>
  );
}

/**
 * Lens chain widget: reads the circuit's real components from the store
 * and renders them as a compact visual pipeline. This stays in sync with
 * the actual circuit, so edits in edit mode (Cmd+E) are reflected here
 * automatically.
 */
export function LensChainWidget(_props: WidgetProps) {
  const nodes = useCircuitStore((s) => s.nodes);
  const autoLensStatus = useCircuitStore((s) => s.autoLensStatus);
  const autoLensError = useCircuitStore((s) => s.autoLensError);

  if (nodes.length === 0) {
    return (
      <div
        data-widget="lens_chain"
        style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}
      >
        No lens steps yet. Press Cmd+E to add components in edit mode.
      </div>
    );
  }

  return (
    <div
      data-widget="lens_chain"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
      }}
    >
      {/* Info hint: these are the real circuit components */}
      <div
        style={{
          fontSize: 11,
          color: "#666",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span
          title="These are the actual circuit components. Press Cmd+E to edit them."
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "1px solid #555",
            fontSize: 9,
            color: "#777",
            cursor: "default",
            flexShrink: 0,
          }}
        >
          i
        </span>
        These are the actual circuit components. Press{" "}
        <kbd
          style={{
            display: "inline-block",
            padding: "0 4px",
            background: "oklch(0.22 0.01 250)",
            border: "1px solid oklch(0.35 0.01 250)",
            borderRadius: 3,
            fontFamily: "ui-monospace, SF Mono, monospace",
            fontSize: 10,
            color: "#bbb",
          }}
        >
          Cmd+E
        </kbd>{" "}
        to edit them.
      </div>
      {autoLensStatus === "failed" && (
        <div
          style={{
            fontSize: 12,
            color: "#FF9800",
            background: "rgba(255, 152, 0, 0.08)",
            border: "1px solid rgba(255, 152, 0, 0.2)",
            borderRadius: 4,
            padding: "8px 12px",
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Could not auto-generate a lens between these schemas
          </div>
          <div style={{ fontSize: 11, color: "#bbb" }}>
            {autoLensError || "The morphism search did not find an alignment."}
            {" "}The current lens steps are unchanged. Press Cmd+E to build or adjust the lens manually.
          </div>
        </div>
      )}
      {autoLensStatus === "success" && (
        <div
          style={{
            fontSize: 11,
            color: "#4CAF50",
            marginBottom: 8,
          }}
        >
          Lens auto-generated from source and target schemas.
        </div>
      )}
      {nodes.map((node, i) => {
        const d = node.data as any;
        const componentType: string = d?.componentType ?? "";
        const params: Array<{ key: string; value: string }> = d?.params ?? [];
        const optic: string = d?.opticKind ?? "lens";
        const label: string = d?.label ?? componentType;
        const color = OPTIC_COLORS[optic] ?? "#666";
        const summary = summarizeParams(componentType, params);
        const prevOptic: string = i > 0 ? ((nodes[i - 1].data as any)?.opticKind ?? "lens") : optic;
        const prevColor = OPTIC_COLORS[prevOptic] ?? "#666";

        return (
          <div key={node.id}>
            {/* Arrow connector between steps */}
            {i > 0 && <StepConnector color={prevColor} nextColor={color} />}
            {/* Step card */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "oklch(0.14 0.01 250)",
                border: `1px solid ${color}33`,
                borderLeft: `3px solid ${color}`,
                borderRadius: 4,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 2,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13, color: "#ddd" }}>
                    {label}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontWeight: 500,
                    }}
                  >
                    {optic}
                  </span>
                </div>
                {summary && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#aaa",
                      fontFamily: "ui-monospace, SF Mono, monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {summary}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
