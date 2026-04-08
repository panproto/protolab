import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// protolab is deployed at https://panproto.dev/protolab via GitHub Pages
// (repo: panproto/protolab). Production asset URLs must be prefixed with
// `/protolab/`. Local dev (`npm run dev`) keeps the empty base so the
// Vite dev server serves at root.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/protolab/" : "/",
  plugins: [react(), wasm(), topLevelAwait()],
  server: { port: 3000 },
}));
