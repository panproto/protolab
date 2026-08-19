import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// protolab is deployed at https://panproto.dev/protolab via GitHub Pages
// (repo: panproto/protolab). Production asset URLs must be prefixed with
// `/protolab/`. Local dev (`npm run dev`) keeps the empty base so the
// Vite dev server serves at root.
// The LexiconImport widget autocompletes lexicon NSIDs against
// lexicon.garden's `/api/autocomplete-nsid` endpoint. That endpoint
// does NOT set CORS headers (only `/xrpc/...` endpoints do), so direct
// browser fetches from other origins are blocked. We proxy the call
// through the Vite dev server so development works without tripping
// CORS. For production (panproto.dev/protolab/), a separate proxy —
// Cloudflare Worker, function, or lexicon.garden adding CORS — is
// required; the widget falls back to no-autocomplete if the proxy is
// unreachable.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/protolab/" : "/",
  plugins: [react(), wasm(), topLevelAwait()],
  server: {
    port: 3000,
    // Bind the loopback IP rather than the default, which resolves to ::1
    // only. atproto OAuth rejects `localhost` in a redirect_uri (RFC 8252
    // §8.3), so the dev client registers `http://127.0.0.1:<port>/` — and
    // the auth server can only redirect back into this tab if the app is
    // actually being served there. See `sessions/oauth.ts`.
    host: "127.0.0.1",
    proxy: {
      "/lexicon-garden": {
        target: "https://lexicon.garden",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/lexicon-garden/, ""),
      },
    },
  },
}));
