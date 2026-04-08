//! Circuit schema mutation operations.
//!
//! Functions for modifying an existing circuit [`Schema`]: adding/removing
//! components, wires, and updating parameters. Unlike [`CircuitBuilder`]
//! which constructs from scratch, these operate on a mutable schema.

use panproto_gat::Name;
use panproto_schema::{Constraint, Edge, Schema, Vertex};

use crate::error::CircuitError;
use crate::{Direction, TriggerMode, kinds};

/// Add a component with ports to an existing circuit schema.
///
/// Creates the component vertex, port vertices, and connecting edges.
/// Returns the IDs of all created vertices.
pub fn add_component(
    schema: &mut Schema,
    id: &str,
    component_type: &str,
    ports: &[PortSpec],
) -> Result<Vec<String>, CircuitError> {
    let comp_name = Name::from(id);
    if schema.vertices.contains_key(&comp_name) {
        return Err(CircuitError::DuplicateVertex(id.to_owned()));
    }

    // Add component vertex.
    schema.vertices.insert(
        comp_name.clone(),
        Vertex {
            id: id.into(),
            kind: kinds::COMPONENT.into(),
            nsid: None,
        },
    );
    add_constraint(schema, &comp_name, "component_type", component_type);

    let mut created = vec![id.to_owned()];

    // Add ports.
    for port in ports {
        let port_name = Name::from(port.id.as_str());
        schema.vertices.insert(
            port_name.clone(),
            Vertex {
                id: port.id.clone().into(),
                kind: kinds::PORT.into(),
                nsid: None,
            },
        );

        let edge = Edge {
            src: comp_name.clone(),
            tgt: port_name.clone(),
            kind: port.direction.edge_kind().into(),
            name: Some(port_name.clone()),
        };
        insert_edge(schema, edge);

        add_constraint(schema, &port_name, "direction", &port.direction.to_string());
        add_constraint(
            schema,
            &port_name,
            "trigger_mode",
            &port.trigger.to_string(),
        );

        created.push(port.id.clone());
    }

    Ok(created)
}

/// Remove a component and all its ports and connected wires from a circuit.
pub fn remove_component(schema: &mut Schema, component_id: &str) -> Result<(), CircuitError> {
    let comp_name = Name::from(component_id);
    if !schema.vertices.contains_key(&comp_name) {
        return Err(CircuitError::VertexNotFound(component_id.to_owned()));
    }

    // Find all ports owned by this component.
    let port_ids: Vec<Name> = schema
        .edges
        .keys()
        .filter(|e| {
            e.src == comp_name
                && matches!(e.kind.as_ref(), "has_input" | "has_output" | "has_param")
        })
        .map(|e| e.tgt.clone())
        .collect();

    // Find all wires connected to these ports.
    let wire_names: Vec<Name> = schema
        .edges
        .keys()
        .filter(|e| {
            (e.kind.as_ref() == "wired_to" || e.kind.as_ref() == "feedback")
                && (port_ids.contains(&e.src) || port_ids.contains(&e.tgt))
        })
        .filter_map(|e| e.name.clone())
        .collect();

    // Remove wire vertices.
    for wn in &wire_names {
        schema.vertices.remove(wn);
        schema.constraints.remove(wn);
    }

    // Remove all edges involving the component or its ports.
    let to_remove: Vec<Edge> = schema
        .edges
        .keys()
        .filter(|e| {
            e.src == comp_name
                || e.tgt == comp_name
                || port_ids.contains(&e.src)
                || port_ids.contains(&e.tgt)
        })
        .cloned()
        .collect();

    for edge in &to_remove {
        remove_edge(schema, edge);
    }

    // Remove port vertices.
    for pid in &port_ids {
        schema.vertices.remove(pid);
        schema.constraints.remove(pid);
    }

    // Remove component vertex.
    schema.vertices.remove(&comp_name);
    schema.constraints.remove(&comp_name);

    Ok(())
}

/// Add a wire between two ports.
pub fn add_wire(
    schema: &mut Schema,
    wire_id: &str,
    src_port: &str,
    tgt_port: &str,
    optic_kind: Option<&str>,
    is_feedback: bool,
) -> Result<(), CircuitError> {
    let src_name = Name::from(src_port);
    let tgt_name = Name::from(tgt_port);

    if !schema.vertices.contains_key(&src_name) {
        return Err(CircuitError::PortNotFound(src_port.to_owned()));
    }
    if !schema.vertices.contains_key(&tgt_name) {
        return Err(CircuitError::PortNotFound(tgt_port.to_owned()));
    }

    let wire_name = Name::from(wire_id);
    schema.vertices.insert(
        wire_name.clone(),
        Vertex {
            id: wire_id.into(),
            kind: kinds::WIRE.into(),
            nsid: None,
        },
    );

    let edge_kind = if is_feedback { "feedback" } else { "wired_to" };
    let edge = Edge {
        src: src_name,
        tgt: tgt_name,
        kind: edge_kind.into(),
        name: Some(wire_name.clone()),
    };
    insert_edge(schema, edge);

    if let Some(ok) = optic_kind {
        add_constraint(schema, &wire_name, "optic_kind", ok);
    }

    Ok(())
}

/// Remove a wire by its ID.
pub fn remove_wire(schema: &mut Schema, wire_id: &str) -> Result<(), CircuitError> {
    let wire_name = Name::from(wire_id);

    // Find and remove the wired_to/feedback edge that has this wire name.
    let edge_to_remove: Option<Edge> = schema
        .edges
        .keys()
        .find(|e| e.name.as_ref() == Some(&wire_name))
        .cloned();

    if let Some(edge) = edge_to_remove {
        remove_edge(schema, &edge);
    }

    // Remove wire vertex and constraints.
    schema.vertices.remove(&wire_name);
    schema.constraints.remove(&wire_name);

    Ok(())
}

/// Update a parameter on a component.
pub fn update_param(
    schema: &mut Schema,
    component_id: &str,
    key: &str,
    value: &str,
) -> Result<(), CircuitError> {
    let comp_name = Name::from(component_id);
    if !schema.vertices.contains_key(&comp_name) {
        return Err(CircuitError::VertexNotFound(component_id.to_owned()));
    }

    let sort = Name::from(format!("param:{key}"));

    // Remove existing param constraint if present.
    if let Some(constraints) = schema.constraints.get_mut(&comp_name) {
        constraints.retain(|c| c.sort != sort);
    }

    // Add new constraint.
    add_constraint(schema, &comp_name, &format!("param:{key}"), value);

    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Port specification for add_component.
pub struct PortSpec {
    pub id: String,
    pub direction: Direction,
    pub trigger: TriggerMode,
}

fn add_constraint(schema: &mut Schema, vertex: &Name, sort: &str, value: &str) {
    schema
        .constraints
        .entry(vertex.clone())
        .or_default()
        .push(Constraint {
            sort: Name::from(sort),
            value: value.to_owned(),
        });
}

fn insert_edge(schema: &mut Schema, edge: Edge) {
    schema
        .outgoing
        .entry(edge.src.clone())
        .or_default()
        .push(edge.clone());
    schema
        .incoming
        .entry(edge.tgt.clone())
        .or_default()
        .push(edge.clone());
    schema
        .between
        .entry((edge.src.clone(), edge.tgt.clone()))
        .or_default()
        .push(edge.clone());
    schema.edges.insert(edge, Name::from("circuit"));
}

fn remove_edge(schema: &mut Schema, edge: &Edge) {
    schema.edges.remove(edge);
    if let Some(out) = schema.outgoing.get_mut(&edge.src) {
        out.retain(|e| e != edge);
    }
    if let Some(inc) = schema.incoming.get_mut(&edge.tgt) {
        inc.retain(|e| e != edge);
    }
    let key = (edge.src.clone(), edge.tgt.clone());
    if let Some(btw) = schema.between.get_mut(&key) {
        btw.retain(|e| e != edge);
    }
}

#[cfg(test)]
mod tests {
    use crate::builder::demo_circuit;

    use super::*;

    #[test]
    fn add_and_remove_component() {
        let mut circuit = demo_circuit();
        let initial_count = circuit.vertices.len(); // 14

        // Add a new component.
        add_component(
            &mut circuit,
            "coerce",
            "coerce_type",
            &[
                PortSpec {
                    id: "coerce.in".into(),
                    direction: Direction::Input,
                    trigger: TriggerMode::Hot,
                },
                PortSpec {
                    id: "coerce.out".into(),
                    direction: Direction::Output,
                    trigger: TriggerMode::Hot,
                },
            ],
        )
        .unwrap();
        assert_eq!(circuit.vertices.len(), initial_count + 3); // +1 comp +2 ports

        // Remove it.
        remove_component(&mut circuit, "coerce").unwrap();
        assert_eq!(circuit.vertices.len(), initial_count);
    }

    #[test]
    fn add_and_remove_wire() {
        let mut circuit = demo_circuit();
        let initial_verts = circuit.vertices.len();

        add_wire(
            &mut circuit,
            "w_new",
            "drop.out",
            "rename.in",
            Some("lens"),
            false,
        )
        .unwrap();
        assert_eq!(circuit.vertices.len(), initial_verts + 1);

        remove_wire(&mut circuit, "w_new").unwrap();
        assert_eq!(circuit.vertices.len(), initial_verts);
    }

    #[test]
    fn update_param_changes_value() {
        let mut circuit = demo_circuit();
        update_param(&mut circuit, "rename", "old_name", "title").unwrap();

        let val = circuit
            .constraints
            .get(&Name::from("rename"))
            .and_then(|cs| cs.iter().find(|c| c.sort.as_ref() == "param:old_name"))
            .map(|c| c.value.as_str());
        assert_eq!(val, Some("title"));
    }
}
