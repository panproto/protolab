//! Circuit evaluation: thin wrappers around panproto-lens.
//!
//! This crate adds NO new evaluation logic. It does two things:
//! 1. Maps a circuit schema (in the circuit protocol) to a `ProtolensChain`
//!    by dispatching on each component's `component_type` constraint.
//! 2. For per-wire data inspection, instantiates *prefixes* of the chain
//!    against the source schema and calls existing `panproto_lens::get`.
//!
//! All actual evaluation, complement tracking, and round-trip semantics
//! are handled by panproto-lens. We just sequence calls into it.

pub mod error;
pub(crate) mod expr_ops;
pub mod protolens_for_component;
pub mod wire_data;

pub use error::EvalError;
pub use protolens_for_component::{
    circuit_to_chain_and_transforms, circuit_to_protolens_chain,
    circuit_to_protolens_chain_with_schema, component_chain, component_intrinsic_optic_kind,
    component_to_field_transforms_pub, find_root_vertex,
};
pub use wire_data::{ForwardEvaluation, put_view, wire_data_for_circuit};
