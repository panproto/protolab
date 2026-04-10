/**
 * Presentation mode toolbar: title, mode toggle, copy-share-URL button.
 * Replaces the edit-mode Toolbar + DataPanel.
 */

import { useCircuitStore } from "../store/circuitStore";
import { buildShareUrl } from "./url";

export function PresentationToolbar() {
  const title = useCircuitStore((s) => s.presentationDoc.title);
  const setMode = useCircuitStore((s) => s.setMode);
  const circuitHandle = useCircuitStore((s) => s.circuitHandle);

  const onShare = async () => {
    const url = buildShareUrl(circuitHandle);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard may fail in iframes / insecure contexts — fall back
      // to prompting the user with the URL.
      prompt("Share URL:", url);
    }
  };

  return (
    <div
      data-testid="presentation-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        background: "oklch(0.14 0.01 250)",
        borderBottom: "1px solid oklch(0.25 0.01 250)",
        color: "#ddd",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
      <div style={{ flex: 1 }} />
      <button
        onClick={onShare}
        style={{
          padding: "4px 10px",
          background: "oklch(0.22 0.01 250)",
          border: "1px solid oklch(0.35 0.01 250)",
          borderRadius: 3,
          color: "#ddd",
          cursor: "pointer",
          fontSize: 11,
        }}
      >
        Copy share URL
      </button>
      <button
        onClick={() => setMode("edit")}
        title="Switch to edit mode (Cmd+E)"
        style={{
          padding: "4px 10px",
          background: "oklch(0.22 0.01 250)",
          border: "1px solid oklch(0.35 0.01 250)",
          borderRadius: 3,
          color: "#ddd",
          cursor: "pointer",
          fontSize: 11,
        }}
      >
        Edit circuit
      </button>
    </div>
  );
}
