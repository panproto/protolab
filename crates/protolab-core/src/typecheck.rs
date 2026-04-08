//! Wire type compatibility checking.
//!
//! Uses panproto's optics hierarchy to classify wires and check
//! that connected ports are compatible.

use panproto_lens::optic::OpticKind;
use panproto_schema::Schema;

/// Parse an optic kind from a string constraint value.
#[must_use]
pub fn parse_optic_kind(s: &str) -> Option<OpticKind> {
    match s {
        "iso" => Some(OpticKind::Iso),
        "lens" => Some(OpticKind::Lens),
        "prism" => Some(OpticKind::Prism),
        "affine" => Some(OpticKind::Affine),
        "traversal" => Some(OpticKind::Traversal),
        _ => None,
    }
}

/// Compose two optic kinds (delegates to `OpticKind::compose`).
#[must_use]
pub fn compose_optics(a: OpticKind, b: OpticKind) -> OpticKind {
    a.compose(b)
}

/// Classify the overall optic kind of a circuit by composing the optic
/// kinds of all wires along the longest path from inputs to outputs.
///
/// Returns `OpticKind::Iso` for a circuit with no wires (identity).
#[must_use]
pub fn classify_circuit(circuit: &Schema) -> OpticKind {
    let mut result = OpticKind::Iso;

    for (vertex_id, constraints) in &circuit.constraints {
        // Only look at wire vertices.
        let is_wire = circuit
            .vertices
            .get(vertex_id)
            .is_some_and(|v| v.kind.as_ref() == "wire");

        if !is_wire {
            continue;
        }

        for constraint in constraints {
            if constraint.sort.as_ref() == "optic_kind"
                && let Some(kind) = parse_optic_kind(&constraint.value)
            {
                result = result.compose(kind);
            }
        }
    }

    result
}

/// Human-readable name for an optic kind.
#[must_use]
pub const fn optic_kind_name(kind: OpticKind) -> &'static str {
    match kind {
        OpticKind::Iso => "iso",
        OpticKind::Lens => "lens",
        OpticKind::Prism => "prism",
        OpticKind::Affine => "affine",
        OpticKind::Traversal => "traversal",
    }
}

/// CSS color for an optic kind (used by the frontend for wire/port coloring).
#[must_use]
pub const fn optic_kind_color(kind: OpticKind) -> &'static str {
    match kind {
        OpticKind::Iso => "#4CAF50",       // green
        OpticKind::Lens => "#2196F3",      // blue
        OpticKind::Prism => "#9C27B0",     // purple
        OpticKind::Affine => "#FF9800",    // orange
        OpticKind::Traversal => "#F44336", // red
    }
}

#[cfg(test)]
mod tests {
    use protolab_schema::builder::demo_circuit;

    use super::*;

    #[test]
    fn demo_circuit_classifies_as_lens() {
        let circuit = demo_circuit();
        // iso composed with lens = lens
        let kind = classify_circuit(&circuit);
        assert_eq!(kind, OpticKind::Lens);
    }

    #[test]
    fn parse_all_optic_kinds() {
        assert_eq!(parse_optic_kind("iso"), Some(OpticKind::Iso));
        assert_eq!(parse_optic_kind("lens"), Some(OpticKind::Lens));
        assert_eq!(parse_optic_kind("prism"), Some(OpticKind::Prism));
        assert_eq!(parse_optic_kind("affine"), Some(OpticKind::Affine));
        assert_eq!(parse_optic_kind("traversal"), Some(OpticKind::Traversal));
        assert_eq!(parse_optic_kind("unknown"), None);
    }

    #[test]
    fn compose_iso_lens_is_lens() {
        assert_eq!(
            compose_optics(OpticKind::Iso, OpticKind::Lens),
            OpticKind::Lens
        );
    }
}
