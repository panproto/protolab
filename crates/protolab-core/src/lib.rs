//! Circuit graph operations.
//!
//! Provides topological sort, wire type checking, and bidirectional
//! conversion between circuit schemas and lens DSL documents.

pub mod convert;
pub mod topo;
pub mod typecheck;

pub use protolab_schema::CircuitError;
