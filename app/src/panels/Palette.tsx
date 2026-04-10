/**
 * Component palette: drag components onto the canvas.
 */

import { useState } from "react";
import { COMPONENT_CATALOG, type ComponentDef } from "../store/circuitStore";

const OPTIC_COLORS: Record<string, string> = {
  iso: "#4CAF50",
  lens: "#2196F3",
  prism: "#9C27B0",
  affine: "#FF9800",
  traversal: "#F44336",
};

export function Palette() {
  const [filter, setFilter] = useState("");

  const filtered = COMPONENT_CATALOG.filter(
    (c) =>
      c.label.toLowerCase().includes(filter.toLowerCase()) ||
      c.category.toLowerCase().includes(filter.toLowerCase()),
  );

  const categories = [...new Set(filtered.map((c) => c.category))];

  return (
    <div
      style={{
        width: 220,
        background: "oklch(0.13 0.01 250)",
        borderRight: "1px solid oklch(0.25 0.01 250)",
        overflow: "auto",
        fontSize: 12,
        color: "#ccc",
      }}
    >
      <div style={{ padding: "8px 10px", borderBottom: "1px solid oklch(0.25 0.01 250)" }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Components</div>
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%",
            padding: "4px 8px",
            background: "oklch(0.18 0.01 250)",
            border: "1px solid oklch(0.3 0.01 250)",
            borderRadius: 4,
            color: "#ccc",
            fontSize: 11,
            outline: "none",
          }}
        />
      </div>

      {categories.map((cat) => (
        <div key={cat}>
          <div
            style={{
              padding: "6px 10px",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#777",
              borderBottom: "1px solid oklch(0.2 0.01 250)",
            }}
          >
            {cat}
          </div>
          {filtered
            .filter((c) => c.category === cat)
            .map((def) => (
              <PaletteItem key={def.type} def={def} />
            ))}
        </div>
      ))}
    </div>
  );
}

/** One-line descriptions for each component type, shown as tooltip. */
const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  rename_field: "Iso: rename a field while preserving round-trip identity",
  add_field: "Lens: add a new field with an optional default value",
  drop_field: "Lens: remove a field from the record",
  hoist_field: "Lens: lift a nested field up through an intermediate wrapper",
  nest_field: "Lens: wrap a field inside a new parent object",
  coerce_type: "Lens: convert a field value using a panproto expression",
  map_items: "Traversal: apply the next lens step to each item in an array",
  apply_expr: "Lens: apply a forward/inverse expression pair to a field",
  compute_field: "Lens: compute a new field value from an expression",
};

function PaletteItem({ def }: { def: ComponentDef }) {
  const color = OPTIC_COLORS[def.optic] ?? "#666";
  const description = COMPONENT_DESCRIPTIONS[def.type] ?? `${def.optic}: ${def.label}`;

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/lens-circuit-component", def.type);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      title={description}
      style={{
        padding: "6px 10px",
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderBottom: "1px solid oklch(0.18 0.01 250)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = "oklch(0.18 0.01 250)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span>{def.label}</span>
      <span style={{ marginLeft: "auto", fontSize: 9, color: color, textTransform: "uppercase" }}>
        {def.optic}
      </span>
    </div>
  );
}
