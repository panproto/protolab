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
 * Lens chain widget: reads the circuit's real components from the store
 * and renders them as a compact visual pipeline. This stays in sync with
 * the actual circuit, so edits in edit mode (Cmd+E) are reflected here
 * automatically.
 */
export function LensChainWidget(_props: WidgetProps) {
  const nodes = useCircuitStore((s) => s.nodes);

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
      {nodes.map((node, i) => {
        const d = node.data as any;
        const componentType: string = d?.componentType ?? "";
        const params: Array<{ key: string; value: string }> = d?.params ?? [];
        const optic: string = d?.opticKind ?? "lens";
        const label: string = d?.label ?? componentType;
        const color = OPTIC_COLORS[optic] ?? "#666";
        const summary = summarizeParams(componentType, params);

        return (
          <div key={node.id}>
            {/* Arrow connector (skip before first) */}
            {i > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "2px 0",
                  color: "#555",
                  fontSize: 11,
                }}
              >
                ↓
              </div>
            )}
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
