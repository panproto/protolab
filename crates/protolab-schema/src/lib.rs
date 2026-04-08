//! Circuit protocol and schema builder for lens circuits.
//!
//! Defines the circuit protocol as a colimit of panproto building-block
//! theories and provides [`CircuitBuilder`] for constructing circuit
//! schemas (directed graphs of lens components connected by typed wires).
//!
//! The circuit protocol follows the Max/MSP-inspired design:
//! - **Hot inlets**: data input ports trigger evaluation on arrival
//! - **Cold inlets**: parameter ports store values without triggering
//! - **Feedback edges**: support for Para^Iter cyclic circuits

pub mod builder;
pub mod error;
pub mod mutate;

use panproto_schema::{EdgeRule, Protocol};
use serde::{Deserialize, Serialize};

pub use builder::CircuitBuilder;
pub use error::CircuitError;

// ── Port direction and trigger mode ─────────────────────────────────

/// Direction of a port on a circuit component.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// Data input (consumes a schema/instance).
    Input,
    /// Data output (produces a schema/instance).
    Output,
    /// Parameter input (configuration, not data flow).
    Parameter,
}

impl Direction {
    /// The edge kind used to attach this port to its parent component.
    #[must_use]
    pub const fn edge_kind(&self) -> &'static str {
        match self {
            Self::Input => "has_input",
            Self::Output => "has_output",
            Self::Parameter => "has_param",
        }
    }
}

impl std::fmt::Display for Direction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Input => write!(f, "input"),
            Self::Output => write!(f, "output"),
            Self::Parameter => write!(f, "parameter"),
        }
    }
}

/// Trigger mode for a port (Max/MSP hot/cold inlet semantics).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerMode {
    /// Receiving data on this port triggers component evaluation.
    Hot,
    /// Receiving data on this port stores the value without triggering.
    Cold,
}

impl TriggerMode {
    /// Default trigger mode for a given port direction.
    #[must_use]
    pub const fn default_for(direction: Direction) -> Self {
        match direction {
            Direction::Input => Self::Hot,
            Direction::Output => Self::Hot,
            Direction::Parameter => Self::Cold,
        }
    }
}

impl std::fmt::Display for TriggerMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Hot => write!(f, "hot"),
            Self::Cold => write!(f, "cold"),
        }
    }
}

// ── Circuit protocol definition ─────────────────────────────────────

/// Returns the circuit protocol definition.
///
/// The circuit protocol defines the valid structure of circuit diagrams:
/// which vertex kinds, edge kinds, and constraints are allowed.
#[must_use]
pub fn circuit_protocol() -> Protocol {
    Protocol {
        name: "circuit".into(),
        schema_theory: "ThCircuitSchema".into(),
        instance_theory: "ThWType".into(),
        schema_composition: None,
        instance_composition: None,
        edge_rules: circuit_edge_rules(),
        obj_kinds: vec!["component".into(), "sub_circuit".into(), "boundary".into()],
        constraint_sorts: vec![
            "direction".into(),
            "trigger_mode".into(),
            "optic_kind".into(),
            "component_type".into(),
            "law_status".into(),
            "quality".into(),
            "required".into(),
            "variadic".into(),
            "default_value".into(),
            "param_key".into(),
            "param_value".into(),
        ],
        has_order: false,
        has_coproducts: false,
        has_recursion: false,
        has_causal: false,
        nominal_identity: false,
        has_defaults: false,
        has_coercions: false,
        has_mergers: false,
        has_policies: false,
    }
}

/// Edge rules for the circuit protocol.
fn circuit_edge_rules() -> Vec<EdgeRule> {
    vec![
        // Component → Port edges
        EdgeRule {
            edge_kind: "has_input".into(),
            src_kinds: vec!["component".into(), "sub_circuit".into()],
            tgt_kinds: vec!["port".into()],
        },
        EdgeRule {
            edge_kind: "has_output".into(),
            src_kinds: vec!["component".into(), "sub_circuit".into()],
            tgt_kinds: vec!["port".into()],
        },
        EdgeRule {
            edge_kind: "has_param".into(),
            src_kinds: vec!["component".into(), "sub_circuit".into()],
            tgt_kinds: vec!["port".into()],
        },
        // Port → Port wires
        EdgeRule {
            edge_kind: "wired_to".into(),
            src_kinds: vec!["port".into()],
            tgt_kinds: vec!["port".into()],
        },
        EdgeRule {
            edge_kind: "param_wired".into(),
            src_kinds: vec!["port".into()],
            tgt_kinds: vec!["port".into()],
        },
        EdgeRule {
            edge_kind: "feedback".into(),
            src_kinds: vec!["port".into()],
            tgt_kinds: vec!["port".into()],
        },
        // Hierarchy
        EdgeRule {
            edge_kind: "contains".into(),
            src_kinds: vec!["sub_circuit".into()],
            tgt_kinds: vec!["component".into(), "sub_circuit".into(), "wire".into()],
        },
        EdgeRule {
            edge_kind: "exposes".into(),
            src_kinds: vec!["sub_circuit".into()],
            tgt_kinds: vec!["boundary".into()],
        },
        // Type/optic annotations
        EdgeRule {
            edge_kind: "typed_by".into(),
            src_kinds: vec!["port".into()],
            tgt_kinds: vec!["schema_ref".into()],
        },
        EdgeRule {
            edge_kind: "optic_ref".into(),
            src_kinds: vec!["wire".into()],
            tgt_kinds: vec![],
        },
        // Component semantics
        EdgeRule {
            edge_kind: "implements".into(),
            src_kinds: vec!["component".into()],
            tgt_kinds: vec!["protolens_ref".into()],
        },
        EdgeRule {
            edge_kind: "configured".into(),
            src_kinds: vec!["component".into()],
            tgt_kinds: vec!["expr_ref".into()],
        },
        // Layout
        EdgeRule {
            edge_kind: "positioned".into(),
            src_kinds: vec!["component".into(), "sub_circuit".into(), "boundary".into()],
            tgt_kinds: vec!["layout_hint".into()],
        },
        EdgeRule {
            edge_kind: "annotated".into(),
            src_kinds: vec!["component".into(), "sub_circuit".into(), "boundary".into()],
            tgt_kinds: vec!["annotation".into()],
        },
        // Hyperedge anchors
        EdgeRule {
            edge_kind: "fan_out".into(),
            src_kinds: vec!["junction".into()],
            tgt_kinds: vec!["port".into()],
        },
        EdgeRule {
            edge_kind: "fan_in".into(),
            src_kinds: vec!["port".into()],
            tgt_kinds: vec!["junction".into()],
        },
    ]
}

// ── Vertex kind constants ───────────────────────────────────────────

/// Circuit vertex kinds.
pub mod kinds {
    pub const COMPONENT: &str = "component";
    pub const PORT: &str = "port";
    pub const WIRE: &str = "wire";
    pub const SUB_CIRCUIT: &str = "sub_circuit";
    pub const BOUNDARY: &str = "boundary";
    pub const JUNCTION: &str = "junction";
    pub const ANNOTATION: &str = "annotation";
    pub const SCHEMA_REF: &str = "schema_ref";
    pub const PROTOLENS_REF: &str = "protolens_ref";
    pub const EXPR_REF: &str = "expr_ref";
    pub const LAYOUT_HINT: &str = "layout_hint";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circuit_protocol_has_correct_name() {
        let proto = circuit_protocol();
        assert_eq!(proto.name, "circuit");
    }

    #[test]
    fn circuit_protocol_has_16_edge_rules() {
        let proto = circuit_protocol();
        assert_eq!(proto.edge_rules.len(), 16);
    }

    #[test]
    fn trigger_mode_defaults() {
        assert_eq!(TriggerMode::default_for(Direction::Input), TriggerMode::Hot);
        assert_eq!(
            TriggerMode::default_for(Direction::Parameter),
            TriggerMode::Cold
        );
    }
}
