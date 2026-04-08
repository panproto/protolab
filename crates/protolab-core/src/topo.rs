//! Topological sort of circuit components.
//!
//! Operates on a circuit [`Schema`] by extracting component vertices and
//! building adjacency from `wired_to` edges (tracing through port
//! ownership). Feedback edges are excluded from the DAG traversal.

use std::collections::{HashMap, HashSet, VecDeque};

use panproto_gat::Name;
use panproto_schema::Schema;

use protolab_schema::{CircuitError, kinds};

/// Topologically sort the components of a circuit.
///
/// Returns component vertex IDs in evaluation order (sources first).
/// Feedback edges (kind `"feedback"`) are excluded from the DAG — they
/// are handled by fixpoint iteration in the evaluation engine.
///
/// # Errors
///
/// Returns [`CircuitError::CycleDetected`] if the non-feedback edges
/// form a cycle.
pub fn topological_sort(circuit: &Schema) -> Result<Vec<Name>, CircuitError> {
    // 1. Collect component IDs.
    let components: HashSet<Name> = circuit
        .vertices
        .iter()
        .filter(|(_, v)| v.kind.as_ref() == kinds::COMPONENT)
        .map(|(id, _)| id.clone())
        .collect();

    if components.is_empty() {
        return Ok(Vec::new());
    }

    // 2. Build port → owning component map.
    let port_owner = build_port_owner_map(circuit);

    // 3. Build component adjacency from wired_to edges (excluding feedback).
    let mut adj: HashMap<Name, Vec<Name>> = HashMap::new();
    let mut in_degree: HashMap<Name, usize> = HashMap::new();

    for comp in &components {
        adj.entry(comp.clone()).or_default();
        in_degree.entry(comp.clone()).or_insert(0);
    }

    for edge in circuit.edges.keys() {
        if edge.kind.as_ref() == "wired_to" {
            let Some(src_comp) = port_owner.get(&edge.src) else {
                continue;
            };
            let Some(tgt_comp) = port_owner.get(&edge.tgt) else {
                continue;
            };
            if src_comp == tgt_comp {
                continue;
            }
            if !components.contains(src_comp) || !components.contains(tgt_comp) {
                continue;
            }
            adj.entry(src_comp.clone())
                .or_default()
                .push(tgt_comp.clone());
            *in_degree.entry(tgt_comp.clone()).or_insert(0) += 1;
        }
    }

    // 4. Kahn's algorithm.
    let mut queue: VecDeque<Name> = in_degree
        .iter()
        .filter(|(_, deg)| **deg == 0)
        .map(|(id, _)| id.clone())
        .collect();

    // Deterministic ordering: sort the initial queue.
    let mut sorted_queue: Vec<Name> = queue.drain(..).collect();
    sorted_queue.sort();
    queue.extend(sorted_queue);

    let mut result = Vec::with_capacity(components.len());

    while let Some(node) = queue.pop_front() {
        result.push(node.clone());
        if let Some(neighbors) = adj.get(&node) {
            for neighbor in neighbors {
                let deg = in_degree.get_mut(neighbor).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push_back(neighbor.clone());
                }
            }
        }
    }

    if result.len() != components.len() {
        return Err(CircuitError::CycleDetected);
    }

    Ok(result)
}

/// Build a map from port vertex ID to its owning component ID.
///
/// Traces `has_input`, `has_output`, and `has_param` edges.
fn build_port_owner_map(circuit: &Schema) -> HashMap<Name, Name> {
    let mut map = HashMap::new();
    for edge in circuit.edges.keys() {
        let kind = edge.kind.as_ref();
        if kind == "has_input" || kind == "has_output" || kind == "has_param" {
            map.insert(edge.tgt.clone(), edge.src.clone());
        }
    }
    map
}

/// Return the owning component for each port in the circuit.
///
/// Public wrapper around the port ownership map for use by the WASM
/// bridge and other modules.
#[must_use]
pub fn port_owners(circuit: &Schema) -> HashMap<Name, Name> {
    build_port_owner_map(circuit)
}

#[cfg(test)]
mod tests {
    use protolab_schema::builder::demo_circuit;

    use super::*;

    #[test]
    fn demo_circuit_sorts_correctly() {
        let circuit = demo_circuit();
        let sorted = topological_sort(&circuit).unwrap();

        assert_eq!(sorted.len(), 3);

        // rename must come before add, add before drop.
        let pos = |name: &str| sorted.iter().position(|n| n.as_ref() == name).unwrap();
        assert!(pos("rename") < pos("add"));
        assert!(pos("add") < pos("drop"));
    }

    #[test]
    fn empty_circuit_sorts_to_empty() {
        let circuit = protolab_schema::CircuitBuilder::new().build();
        let sorted = topological_sort(&circuit).unwrap();
        assert!(sorted.is_empty());
    }

    #[test]
    fn port_owner_map_is_complete() {
        let circuit = demo_circuit();
        let owners = port_owners(&circuit);

        // 9 ports, each owned by a component.
        assert_eq!(owners.len(), 9);
        assert_eq!(
            owners.get(&Name::from("rename.in")).unwrap().as_ref(),
            "rename"
        );
        assert_eq!(
            owners.get(&Name::from("add.param")).unwrap().as_ref(),
            "add"
        );
        assert_eq!(
            owners.get(&Name::from("drop.out")).unwrap().as_ref(),
            "drop"
        );
    }
}
