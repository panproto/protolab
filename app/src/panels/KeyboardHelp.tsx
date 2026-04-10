/**
 * KeyboardHelp modal: lists all keyboard shortcuts.
 * Triggered by pressing "?" (when no input is focused) or via a "?" button.
 */

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
const mod = isMac ? "Cmd" : "Ctrl";

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: [`${mod}+E`], description: "Toggle between presentation mode and edit mode" },
  { keys: ["Backspace", "Delete"], description: "Delete the selected component or wire (edit mode)" },
  { keys: ["?"], description: "Show this keyboard shortcut reference" },
  { keys: ["Enter"], description: "Resolve the NSID in the Lexicon Import widget" },
  { keys: ["Escape"], description: "Close the autocomplete dropdown or any modal" },
  { keys: ["Arrow Up / Down"], description: "Navigate autocomplete suggestions in Lexicon Import" },
];

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 3000,
};

const modalStyle: React.CSSProperties = {
  background: "oklch(0.16 0.01 250)",
  border: "1px solid oklch(0.3 0.01 250)",
  borderRadius: 8,
  padding: 24,
  width: 520,
  maxHeight: "80vh",
  overflow: "auto",
  color: "#ccc",
  fontSize: 12,
};

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 7px",
  background: "oklch(0.22 0.01 250)",
  border: "1px solid oklch(0.38 0.01 250)",
  borderBottom: "2px solid oklch(0.28 0.01 250)",
  borderRadius: 4,
  fontFamily: "ui-monospace, SF Mono, monospace",
  fontSize: 11,
  color: "#ddd",
};

export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalStyle}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#eee" }}>Keyboard Shortcuts</div>
          <button
            onClick={onClose}
            title="Close (Escape)"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid oklch(0.3 0.01 250)",
              color: "#ccc",
              padding: "2px 8px",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Close
          </button>
        </div>

        {/* Shortcut table */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {SHORTCUTS.map((row, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: "1px solid oklch(0.22 0.01 250)",
                }}
              >
                <td
                  style={{
                    padding: "8px 12px 8px 0",
                    verticalAlign: "middle",
                    whiteSpace: "nowrap",
                    width: 1,
                  }}
                >
                  <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
                    {row.keys.map((k, ki) => (
                      <span key={ki}>
                        {ki > 0 && (
                          <span style={{ color: "#666", margin: "0 2px", fontSize: 10 }}>/</span>
                        )}
                        <span style={kbdStyle}>{k}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td style={{ padding: "8px 0 8px 12px", color: "#bbb", fontSize: 12 }}>
                  {row.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            marginTop: 16,
            fontSize: 11,
            color: "#666",
            borderTop: "1px solid oklch(0.22 0.01 250)",
            paddingTop: 12,
          }}
        >
          Shortcuts that involve text input fields (NSID, JSON, params) are intentionally
          skipped so typing never conflicts with global bindings.
        </div>
      </div>
    </div>
  );
}
