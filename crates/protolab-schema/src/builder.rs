//! Circuit schema builder.
//!
//! [`CircuitBuilder`] provides a fluent API for constructing circuit
//! schemas. Each method adds vertices, edges, and constraints to an
//! underlying panproto [`Schema`].

use std::collections::HashMap;

use panproto_gat::Name;
use panproto_schema::{Constraint, Edge, Schema, Vertex};
use smallvec::SmallVec;

use crate::error::CircuitError;
use crate::{Direction, TriggerMode, kinds};

/// A builder for constructing circuit schemas.
///
/// Wraps a panproto [`Schema`] and provides circuit-specific convenience
/// methods. Call [`build`](Self::build) to produce the final schema.
pub struct CircuitBuilder {
    vertices: HashMap<Name, Vertex>,
    edges: HashMap<Edge, Name>,
    constraints: Vec<(Name, Constraint)>,
    outgoing: HashMap<Name, SmallVec<Edge, 4>>,
    incoming: HashMap<Name, SmallVec<Edge, 4>>,
    between: HashMap<(Name, Name), SmallVec<Edge, 2>>,
}

impl CircuitBuilder {
    /// Create a new empty circuit builder.
    #[must_use]
    pub fn new() -> Self {
        Self {
            vertices: HashMap::new(),
            edges: HashMap::new(),
            constraints: Vec::new(),
            outgoing: HashMap::new(),
            incoming: HashMap::new(),
            between: HashMap::new(),
        }
    }

    /// Add a component to the circuit.
    ///
    /// Creates a vertex of kind `"component"` with a `component_type`
    /// constraint recording what kind of lens operation this component
    /// performs (e.g., `"rename_field"`, `"add_field"`, `"drop_field"`).
    pub fn add_component(mut self, id: &str, component_type: &str) -> Result<Self, CircuitError> {
        let name = Name::from(id);
        if self.vertices.contains_key(&name) {
            return Err(CircuitError::DuplicateVertex(id.to_owned()));
        }
        self.vertices.insert(
            name.clone(),
            Vertex {
                id: id.into(),
                kind: kinds::COMPONENT.into(),
                nsid: None,
            },
        );
        self.add_constraint(&name, "component_type", component_type);
        Ok(self)
    }

    /// Add a port to a component.
    ///
    /// Creates a port vertex and connects it to the parent component
    /// via the appropriate edge kind (`has_input`, `has_output`, or
    /// `has_param`). Stores `direction` and `trigger_mode` as constraints.
    pub fn add_port(
        mut self,
        port_id: &str,
        component_id: &str,
        direction: Direction,
        trigger: TriggerMode,
    ) -> Result<Self, CircuitError> {
        let port_name = Name::from(port_id);
        let comp_name = Name::from(component_id);

        if !self.vertices.contains_key(&comp_name) {
            return Err(CircuitError::VertexNotFound(component_id.to_owned()));
        }
        if self.vertices.contains_key(&port_name) {
            return Err(CircuitError::DuplicateVertex(port_id.to_owned()));
        }

        self.vertices.insert(
            port_name.clone(),
            Vertex {
                id: port_id.into(),
                kind: kinds::PORT.into(),
                nsid: None,
            },
        );

        // Connect component → port via the direction-appropriate edge.
        let edge = Edge {
            src: comp_name.clone(),
            tgt: port_name.clone(),
            kind: direction.edge_kind().into(),
            name: Some(Name::from(port_id)),
        };
        self.insert_edge(edge);

        // Constraints on the port.
        self.add_constraint(&port_name, "direction", &direction.to_string());
        self.add_constraint(&port_name, "trigger_mode", &trigger.to_string());

        Ok(self)
    }

    /// Add a data wire connecting two ports.
    ///
    /// The wire connects a source port (typically an output) to a target
    /// port (typically an input). An optional `optic_kind` constraint
    /// records the information-theoretic classification.
    pub fn add_wire(
        mut self,
        wire_id: &str,
        src_port: &str,
        tgt_port: &str,
        optic_kind: Option<&str>,
    ) -> Result<Self, CircuitError> {
        let src_name = Name::from(src_port);
        let tgt_name = Name::from(tgt_port);

        if !self.vertices.contains_key(&src_name) {
            return Err(CircuitError::PortNotFound(src_port.to_owned()));
        }
        if !self.vertices.contains_key(&tgt_name) {
            return Err(CircuitError::PortNotFound(tgt_port.to_owned()));
        }

        // Add the wire vertex.
        let wire_name = Name::from(wire_id);
        self.vertices.insert(
            wire_name.clone(),
            Vertex {
                id: wire_id.into(),
                kind: kinds::WIRE.into(),
                nsid: None,
            },
        );

        // Connect src_port → tgt_port via wired_to edge.
        let edge = Edge {
            src: src_name,
            tgt: tgt_name,
            kind: "wired_to".into(),
            name: Some(wire_name.clone()),
        };
        self.insert_edge(edge);

        if let Some(ok) = optic_kind {
            self.add_constraint(&wire_name, "optic_kind", ok);
        }

        Ok(self)
    }

    /// Add a feedback wire (cycle) connecting an output port back to an
    /// earlier input port.
    ///
    /// Feedback edges are excluded from topological sort and evaluated
    /// via fixpoint iteration (Para^Iter).
    pub fn add_feedback_wire(
        mut self,
        wire_id: &str,
        src_port: &str,
        tgt_port: &str,
    ) -> Result<Self, CircuitError> {
        let src_name = Name::from(src_port);
        let tgt_name = Name::from(tgt_port);

        if !self.vertices.contains_key(&src_name) {
            return Err(CircuitError::PortNotFound(src_port.to_owned()));
        }
        if !self.vertices.contains_key(&tgt_name) {
            return Err(CircuitError::PortNotFound(tgt_port.to_owned()));
        }

        let wire_name = Name::from(wire_id);
        self.vertices.insert(
            wire_name,
            Vertex {
                id: wire_id.into(),
                kind: kinds::WIRE.into(),
                nsid: None,
            },
        );

        let edge = Edge {
            src: src_name,
            tgt: tgt_name,
            kind: "feedback".into(),
            name: Some(Name::from(wire_id)),
        };
        self.insert_edge(edge);

        Ok(self)
    }

    /// Set a parameter value on a component.
    ///
    /// Stores key-value pairs as constraints on the component vertex.
    pub fn set_param(mut self, component_id: &str, key: &str, value: &str) -> Self {
        let comp_name = Name::from(component_id);
        self.add_constraint(&comp_name, &format!("param:{key}"), value);
        self
    }

    /// Build the final circuit schema.
    pub fn build(self) -> Schema {
        let mut constraints_map: HashMap<Name, Vec<Constraint>> = HashMap::new();
        for (vertex, constraint) in self.constraints {
            constraints_map.entry(vertex).or_default().push(constraint);
        }

        Schema {
            protocol: "circuit".into(),
            vertices: self.vertices,
            edges: self.edges,
            hyper_edges: HashMap::new(),
            constraints: constraints_map,
            required: HashMap::new(),
            nsids: HashMap::new(),
            variants: HashMap::new(),
            orderings: HashMap::new(),
            recursion_points: HashMap::new(),
            spans: HashMap::new(),
            usage_modes: HashMap::new(),
            nominal: HashMap::new(),
            coercions: HashMap::new(),
            mergers: HashMap::new(),
            defaults: HashMap::new(),
            policies: HashMap::new(),
            // panproto v0.32.0 made schemas pointed: `entries` is the
            // basepoint family. Circuit schemas don't have meaningful
            // entries (the "root" vertex is computed by graph topology
            // when needed), so leave the vector empty and let the
            // legacy `primary_entry` fallback pick a topological root.
            entries: Vec::new(),
            outgoing: self.outgoing,
            incoming: self.incoming,
            between: self.between,
        }
    }

    /// Add a constraint to a vertex.
    fn add_constraint(&mut self, vertex: &Name, sort: &str, value: &str) {
        self.constraints.push((
            vertex.clone(),
            Constraint {
                sort: Name::from(sort),
                value: value.to_owned(),
            },
        ));
    }

    /// Insert an edge and update all index maps.
    fn insert_edge(&mut self, edge: Edge) {
        self.outgoing
            .entry(edge.src.clone())
            .or_default()
            .push(edge.clone());
        self.incoming
            .entry(edge.tgt.clone())
            .or_default()
            .push(edge.clone());
        self.between
            .entry((edge.src.clone(), edge.tgt.clone()))
            .or_default()
            .push(edge.clone());
        self.edges.insert(edge, Name::from("circuit"));
    }
}

impl Default for CircuitBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Build the demo circuit: RenameField → AddField → DropField.
///
/// This is the Phase 0 reference circuit used for testing and the
/// initial React Flow rendering.
pub fn demo_circuit() -> Schema {
    CircuitBuilder::new()
        // Components
        .add_component("rename", "rename_field")
        .unwrap()
        .add_component("add", "add_field")
        .unwrap()
        .add_component("drop", "drop_field")
        .unwrap()
        // RenameField ports
        .add_port("rename.in", "rename", Direction::Input, TriggerMode::Hot)
        .unwrap()
        .add_port("rename.out", "rename", Direction::Output, TriggerMode::Hot)
        .unwrap()
        .add_port(
            "rename.param",
            "rename",
            Direction::Parameter,
            TriggerMode::Cold,
        )
        .unwrap()
        // AddField ports
        .add_port("add.in", "add", Direction::Input, TriggerMode::Hot)
        .unwrap()
        .add_port("add.out", "add", Direction::Output, TriggerMode::Hot)
        .unwrap()
        .add_port("add.param", "add", Direction::Parameter, TriggerMode::Cold)
        .unwrap()
        // DropField ports
        .add_port("drop.in", "drop", Direction::Input, TriggerMode::Hot)
        .unwrap()
        .add_port("drop.out", "drop", Direction::Output, TriggerMode::Hot)
        .unwrap()
        .add_port(
            "drop.param",
            "drop",
            Direction::Parameter,
            TriggerMode::Cold,
        )
        .unwrap()
        // Wires: rename.out → add.in → drop.in
        .add_wire("w1", "rename.out", "add.in", Some("iso"))
        .unwrap()
        .add_wire("w2", "add.out", "drop.in", Some("lens"))
        .unwrap()
        // Parameters
        .set_param("rename", "old_name", "name")
        .set_param("rename", "new_name", "displayName")
        .set_param("add", "field_name", "bio")
        .set_param("add", "field_kind", "string")
        .set_param("add", "default", "")
        .set_param("drop", "field_name", "legacyId")
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_circuit_has_correct_structure() {
        let circuit = demo_circuit();

        // 3 components + 9 ports + 2 wires = 14 vertices
        assert_eq!(circuit.vertices.len(), 14);

        // Count components.
        let components: Vec<_> = circuit
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == kinds::COMPONENT)
            .collect();
        assert_eq!(components.len(), 3);

        // Count ports.
        let ports: Vec<_> = circuit
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == kinds::PORT)
            .collect();
        assert_eq!(ports.len(), 9);

        // Count wires.
        let wires: Vec<_> = circuit
            .vertices
            .values()
            .filter(|v| v.kind.as_ref() == kinds::WIRE)
            .collect();
        assert_eq!(wires.len(), 2);
    }

    /// Helper: find constraint value on a vertex by sort name.
    fn find_constraint(circuit: &Schema, vertex: &str, sort: &str) -> Option<String> {
        circuit
            .constraints
            .get(&Name::from(vertex))?
            .iter()
            .find(|c| c.sort.as_ref() == sort)
            .map(|c| c.value.clone())
    }

    #[test]
    fn ports_have_direction_and_trigger_constraints() {
        let circuit = demo_circuit();

        assert_eq!(
            find_constraint(&circuit, "rename.in", "direction").as_deref(),
            Some("input")
        );
        assert_eq!(
            find_constraint(&circuit, "rename.in", "trigger_mode").as_deref(),
            Some("hot")
        );
        assert_eq!(
            find_constraint(&circuit, "rename.param", "direction").as_deref(),
            Some("parameter")
        );
        assert_eq!(
            find_constraint(&circuit, "rename.param", "trigger_mode").as_deref(),
            Some("cold")
        );
    }

    #[test]
    fn component_params_are_stored() {
        let circuit = demo_circuit();

        assert_eq!(
            find_constraint(&circuit, "rename", "param:old_name").as_deref(),
            Some("name")
        );
        assert_eq!(
            find_constraint(&circuit, "rename", "param:new_name").as_deref(),
            Some("displayName")
        );
    }

    #[test]
    fn wires_have_optic_kind() {
        let circuit = demo_circuit();

        assert_eq!(
            find_constraint(&circuit, "w1", "optic_kind").as_deref(),
            Some("iso")
        );
        assert_eq!(
            find_constraint(&circuit, "w2", "optic_kind").as_deref(),
            Some("lens")
        );
    }

    #[test]
    fn duplicate_vertex_errors() {
        let result = CircuitBuilder::new()
            .add_component("a", "rename_field")
            .unwrap()
            .add_component("a", "add_field");

        assert!(result.is_err());
    }

    #[test]
    fn missing_component_errors() {
        let result =
            CircuitBuilder::new().add_port("p", "nonexistent", Direction::Input, TriggerMode::Hot);

        assert!(result.is_err());
    }
}
