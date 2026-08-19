/**
 * Presentation mode toolbar: title, mode toggle, copy-share-URL button,
 * lens library, and the account badge. Replaces the edit-mode Toolbar +
 * DataPanel.
 *
 * The account control lives here as well as in the edit-mode Toolbar
 * because presentation mode is where a bare visit lands: with no `?mode`
 * param the app loads the Lexicon Mapper template in presentation mode, so
 * an account control only in the edit toolbar is one Cmd+E away from
 * anybody who has not been told about Cmd+E. Publishing also reads more
 * naturally from here — you have resolved the schemas and run the lens,
 * and publishing is the next thing you want.
 */

import { useState } from "react";
import { useCircuitStore } from "../store/circuitStore";
import { buildShareUrl } from "./url";
import { PresentationHelp } from "./PresentationHelp";
import { KeyboardHelp } from "../panels/KeyboardHelp";
import { SessionMenu } from "../components/SessionMenu";
import { LensLibrary } from "../components/LensLibrary";

export function PresentationToolbar() {
  const title = useCircuitStore((s) => s.presentationDoc.title);
  const setMode = useCircuitStore((s) => s.setMode);
  const circuitHandle = useCircuitStore((s) => s.circuitHandle);
  const [helpOpen, setHelpOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const onShare = async () => {
    const url = buildShareUrl(circuitHandle);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard may fail in iframes / insecure contexts: fall back
      // to prompting the user with the URL.
      prompt("Share URL:", url);
    }
  };

  const btnStyle: React.CSSProperties = {
    padding: "4px 10px",
    background: "oklch(0.22 0.01 250)",
    border: "1px solid oklch(0.35 0.01 250)",
    borderRadius: 3,
    color: "#ddd",
    cursor: "pointer",
    fontSize: 11,
  };

  return (
    <>
      <div
        data-testid="presentation-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 16px",
          background: "oklch(0.14 0.01 250)",
          borderBottom: "1px solid oklch(0.25 0.01 250)",
          color: "#ddd",
          fontSize: 12,
          // The bar carries six controls now that the library and the
          // account badge live here, which is wider than a 375px viewport.
          // Wrap rather than overflow: the edit toolbar already does, and a
          // horizontal scrollbar on the whole document is the one outcome
          // the mobile spec rules out.
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onShare}
          title="Copy a shareable URL for this circuit to your clipboard"
          style={btnStyle}
        >
          Copy share URL
        </button>
        <button
          onClick={() => setMode("edit")}
          title="Switch to edit mode (Cmd+E or Ctrl+E)"
          style={btnStyle}
        >
          Edit circuit
        </button>
        <button
          onClick={() => setHelpOpen(true)}
          title="How to use presentation mode"
          style={{ ...btnStyle, padding: "4px 8px" }}
          aria-label="Help"
        >
          i
        </button>
        <button
          onClick={() => setKeysOpen(true)}
          title="Keyboard shortcut reference"
          style={{ ...btnStyle, padding: "4px 8px", fontWeight: 700 }}
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
        <button
          onClick={() => setLibraryOpen(true)}
          title="Publish this lens to a PDS, or browse a published lens library"
          style={btnStyle}
        >
          Library
        </button>
        <SessionMenu />
      </div>

      {libraryOpen && <LensLibrary onClose={() => setLibraryOpen(false)} />}
      {helpOpen && <PresentationHelp onClose={() => setHelpOpen(false)} />}
      {keysOpen && <KeyboardHelp onClose={() => setKeysOpen(false)} />}
    </>
  );
}
