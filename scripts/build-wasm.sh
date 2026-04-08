#!/usr/bin/env bash
#
# Build the protolab-wasm crate and drop the wasm-pack output into
# app/src/wasm/pkg/ so the Vite dev server / build can pick it up.
#
# Run this after any Rust change. ~3 minutes cold, ~15 seconds warm.

set -euo pipefail
cd "$(dirname "$0")/.."

# Clean any stale output from prior builds (including artifacts from
# the old circuit-wasm crate name before the protolab rename) so that
# `import "./pkg/protolab_wasm.js"` always picks up freshly-built files.
rm -rf app/src/wasm/pkg/*

wasm-pack build crates/protolab-wasm \
  --target web \
  --out-dir ../../app/src/wasm/pkg

echo "✓ protolab-wasm built → app/src/wasm/pkg/"
