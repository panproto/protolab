/**
 * Toolbar with import/export dropdowns.
 */

import { useState, useRef } from "react";
import { useCircuitStore } from "../store/circuitStore";
import { TheoryEditor } from "./TheoryEditor";
import { ColimitComposer } from "./ColimitComposer";
import { SchemaBrowser } from "./SchemaBrowser";
import { ProtocolEditor } from "./ProtocolEditor";
import { KeyboardHelp } from "./KeyboardHelp";
import { SessionMenu } from "../components/SessionMenu";
import { LensLibrary } from "../components/LensLibrary";

export function Toolbar() {
  const [importOpen, setImportOpen] = useState(false);
  const [importType, setImportType] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [theoryEditorOpen, setTheoryEditorOpen] = useState(false);
  const [colimitOpen, setColimitOpen] = useState(false);
  const [schemaBrowserOpen, setSchemaBrowserOpen] = useState(false);
  const [protocolEditorOpen, setProtocolEditorOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const { importLensDocument, importSchema, importTheory, importProtocol, setError } =
    useCircuitStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = () => {
    if (!importText.trim()) return;
    try {
      if (importType === "lens") importLensDocument(importText);
      else if (importType === "schema") importSchema(importText);
      else if (importType === "theory") importTheory(importText);
      else if (importType === "protocol") importProtocol(importText);
      setImportOpen(false);
      setImportText("");
      setImportType(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(reader.result as string);
    reader.readAsText(file);
  };

  const buttonStyle: React.CSSProperties = {
    padding: "4px 10px",
    background: "oklch(0.2 0.01 250)",
    border: "1px solid oklch(0.3 0.01 250)",
    borderRadius: 4,
    color: "#ccc",
    cursor: "pointer",
    fontSize: 12,
  };

  return (
    <div
      style={{
        minHeight: 40,
        background: "oklch(0.12 0.01 250)",
        borderBottom: "1px solid oklch(0.25 0.01 250)",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 8,
        fontSize: 12,
        color: "#ccc",
        flexWrap: "wrap",
        overflow: "hidden",
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 14, marginRight: 12 }}>protolab</span>

      {/* Theories button */}
      <button
        style={buttonStyle}
        onClick={() => setTheoryEditorOpen(true)}
        title="Open the theory editor to build or inspect algebraic theories"
      >
        Theories
      </button>

      {/* Colimit button */}
      <button
        style={buttonStyle}
        onClick={() => setColimitOpen(true)}
        title="Compose theories via colimit to define a new protocol"
      >
        Colimit
      </button>

      {/* Schemas button */}
      <button
        style={buttonStyle}
        onClick={() => setSchemaBrowserOpen(true)}
        title="Browse imported schemas and assign source or target"
      >
        Schemas
      </button>

      {/* Protocols button */}
      <button
        style={buttonStyle}
        onClick={() => setProtocolEditorOpen(true)}
        title="Define a custom protocol (object kinds and edge rules)"
      >
        Protocols
      </button>

      {/* Lens library button */}
      <button
        style={buttonStyle}
        onClick={() => setLibraryOpen(true)}
        title="Publish this lens to a PDS, or browse a published lens library"
      >
        Library
      </button>

      {/* Import dropdown */}
      <div style={{ position: "relative" }}>
        <button
          style={buttonStyle}
          onClick={() => setImportOpen(!importOpen)}
          title="Import a lens document, schema, theory, or protocol from JSON"
        >
          Import ▾
        </button>
        {importOpen && (
          <div
            style={{
              position: "absolute",
              top: 32,
              left: 0,
              background: "oklch(0.16 0.01 250)",
              border: "1px solid oklch(0.3 0.01 250)",
              borderRadius: 4,
              padding: 4,
              zIndex: 1000,
              minWidth: 140,
            }}
          >
            {[
              { key: "lens", label: "Lens Document (JSON)" },
              { key: "schema", label: "Schema (JSON)" },
              { key: "theory", label: "Theory (JSON)" },
              { key: "protocol", label: "Protocol (JSON)" },
            ].map((item) => (
              <div
                key={item.key}
                onClick={() => {
                  setImportType(item.key);
                }}
                style={{
                  padding: "4px 8px",
                  cursor: "pointer",
                  borderRadius: 3,
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = "oklch(0.22 0.01 250)";
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = "transparent";
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import dialog */}
      {importType && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setImportType(null);
              setImportOpen(false);
            }
          }}
        >
          <div
            style={{
              background: "oklch(0.16 0.01 250)",
              border: "1px solid oklch(0.3 0.01 250)",
              borderRadius: 8,
              padding: 20,
              width: 500,
              maxHeight: "80vh",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
              Import{" "}
              {importType === "lens"
                ? "Lens Document"
                : importType === "schema"
                  ? "Schema"
                  : importType === "theory"
                    ? "Theory"
                    : "Protocol"}
            </div>
            <div style={{ marginBottom: 8 }}>
              <button style={buttonStyle} onClick={() => fileRef.current?.click()}>
                Choose File
              </button>
              <input ref={fileRef} type="file" accept=".json,.yaml,.yml" style={{ display: "none" }} onChange={handleFile} />
              <span style={{ marginLeft: 8, fontSize: 11, color: "#777" }}>or paste JSON below</span>
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste JSON here..."
              style={{
                width: "100%",
                height: 200,
                background: "oklch(0.12 0.01 250)",
                border: "1px solid oklch(0.3 0.01 250)",
                borderRadius: 4,
                color: "#ddd",
                fontFamily: "monospace",
                fontSize: 11,
                padding: 8,
                resize: "vertical",
              }}
            />
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                style={buttonStyle}
                onClick={() => {
                  setImportType(null);
                  setImportOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                style={{ ...buttonStyle, background: "#2196F3", borderColor: "#2196F3", color: "#fff" }}
                onClick={handleImport}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Presentation mode toggle */}
      <button
        style={{ ...buttonStyle, marginLeft: "auto" }}
        onClick={() => useCircuitStore.getState().setMode("presentation")}
        title="Switch to presentation mode (Cmd+E or Ctrl+E)"
      >
        Presentation
      </button>

      {/* Keyboard shortcut help */}
      <button
        style={{ ...buttonStyle, fontWeight: 700 }}
        onClick={() => setKeysOpen(true)}
        title="Keyboard shortcut reference"
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>

      {/* Account badge / multi-account switcher, pushed to the right edge */}
      <SessionMenu />

      {/* Modals */}
      {libraryOpen && <LensLibrary onClose={() => setLibraryOpen(false)} />}
      {theoryEditorOpen && <TheoryEditor onClose={() => setTheoryEditorOpen(false)} />}
      {colimitOpen && <ColimitComposer onClose={() => setColimitOpen(false)} />}
      {schemaBrowserOpen && <SchemaBrowser onClose={() => setSchemaBrowserOpen(false)} />}
      {protocolEditorOpen && <ProtocolEditor onClose={() => setProtocolEditorOpen(false)} />}
      {keysOpen && <KeyboardHelp onClose={() => setKeysOpen(false)} />}
    </div>
  );
}
