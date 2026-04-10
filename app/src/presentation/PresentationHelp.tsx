/**
 * PresentationHelp modal: explains what presentation mode is and how to
 * use each widget. Triggered by an "i" button in PresentationToolbar.
 */

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
  width: 560,
  maxHeight: "82vh",
  overflow: "auto",
  color: "#ccc",
  fontSize: 13,
  lineHeight: 1.6,
};

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "#888",
  marginBottom: 4,
  marginTop: 20,
};

const bodyStyle: React.CSSProperties = {
  color: "#bbb",
  fontSize: 13,
  lineHeight: 1.65,
  margin: 0,
};

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  background: "oklch(0.22 0.01 250)",
  border: "1px solid oklch(0.38 0.01 250)",
  borderBottom: "2px solid oklch(0.28 0.01 250)",
  borderRadius: 4,
  fontFamily: "ui-monospace, SF Mono, monospace",
  fontSize: 11,
  color: "#ddd",
};

export function PresentationHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalStyle}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#eee" }}>How to use protolab</div>
          <button
            onClick={onClose}
            title="Close"
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

        {/* Intro */}
        <p style={{ ...bodyStyle, marginTop: 8 }}>
          You are in <strong style={{ color: "#ddd" }}>Presentation mode</strong>: a curated
          front panel for this circuit. It hides the wiring and shows only the controls you
          need to actually run the mapping.
        </p>

        {/* Step-by-step */}
        <div style={sectionHeadStyle}>Step 1: Resolve a source schema</div>
        <p style={bodyStyle}>
          Type an AT Protocol NSID (e.g. <code style={{ color: "#61afef" }}>app.bsky.feed.post</code>)
          into the Lexicon NSID field and click <strong style={{ color: "#ddd" }}>Resolve</strong>
          (or press <span style={kbdStyle}>Enter</span>). The schema is fetched from
          lexicon.garden and installed as the circuit source. Autocomplete narrows the list as
          you type.
        </p>

        <div style={sectionHeadStyle}>Step 2: Set a target schema (optional)</div>
        <p style={bodyStyle}>
          If a second Lexicon Import widget is present with the role "target", resolving it sets
          the target schema. When both source and target are set, a lens between them is
          auto-generated and the circuit is populated automatically.
        </p>

        <div style={sectionHeadStyle}>Step 3: Check the lens chain</div>
        <p style={bodyStyle}>
          The <strong style={{ color: "#ddd" }}>Lens Chain</strong> panel shows the actual
          circuit components that will transform your data. Each card shows the component name,
          its optic kind (iso, lens, traversal...), and a summary of its parameters. The chain
          updates live whenever you edit in edit mode.
        </p>

        <div style={sectionHeadStyle}>Step 4: Paste input and run</div>
        <p style={bodyStyle}>
          Paste a JSON document into the Input field. Click{" "}
          <strong style={{ color: "#ddd" }}>Run</strong> to apply the circuit forward. The
          transformed document appears in the Output field below.
        </p>

        <div style={sectionHeadStyle}>Switching to edit mode</div>
        <p style={bodyStyle}>
          Press <span style={kbdStyle}>Cmd+E</span> (or click{" "}
          <strong style={{ color: "#ddd" }}>Edit circuit</strong> in the toolbar) to open the
          full circuit editor. There you can drag components from the palette, wire them
          together, and inspect each node. Press <span style={kbdStyle}>Cmd+E</span> again to
          return to this view.
        </p>

        <div style={sectionHeadStyle}>Sharing</div>
        <p style={bodyStyle}>
          Click <strong style={{ color: "#ddd" }}>Copy share URL</strong> to put a link to the
          current circuit on your clipboard. Anyone who opens it will see the same presentation
          mode with the same circuit loaded.
        </p>

        {/* Shortcut hint */}
        <div
          style={{
            marginTop: 20,
            padding: "8px 12px",
            background: "oklch(0.14 0.01 250)",
            border: "1px solid oklch(0.25 0.01 250)",
            borderRadius: 4,
            fontSize: 12,
            color: "#888",
          }}
        >
          Press <span style={kbdStyle}>?</span> at any time to see all keyboard shortcuts.
        </div>
      </div>
    </div>
  );
}
