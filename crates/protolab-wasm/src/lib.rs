//! WASM bindings for the lens circuits engine.
//!
//! Exposes circuit construction, topological sort, type checking, and
//! the demo circuit to JavaScript via `wasm-bindgen`. Data crosses the
//! boundary as MessagePack bytes; resources are managed via opaque
//! `u32` handles in a thread-local slab (same pattern as `panproto-wasm`).

mod api;
mod error;
mod slab;
