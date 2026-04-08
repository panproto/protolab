# Circuit Protocol Definition (panproto-theory-dsl Bundle)
#
# Defines the circuit protocol as a composition of panproto building-block
# theories. This is the canonical source of truth for what a valid circuit
# looks like — vertex kinds, edge kinds, and constraint sorts.
#
# Compiled by panproto-theory-dsl at v0.27.0:
#   let compiled = panproto_theory_dsl::load_and_compile("circuit-protocol.ncl", &resolver)?;
#   let proto = &compiled.protocols["circuit"];

let T = import "panproto/theory.ncl" in
{
  id = "dev.panproto.circuit.protocol",
  description = "Circuit protocol for lens circuit diagrams — bidirectional transformation pipelines represented as directed graphs of protolens components.",

  bundle = "circuit",

  compositions = [
    {
      result = "ThCircuitSchema",
      bases = ["ThGraph", "ThHypergraph", "ThConstraint", "ThMeta"],
      steps = [
        T.colimit "ThGraph" "ThHypergraph" ["Vertex", "Edge"],
        T.colimit "step_0" "ThConstraint" ["Vertex"],
        T.colimit "step_1" "ThMeta" ["Vertex"],
      ],
    },
  ],

  protocols = [
    {
      protocol = "circuit",
      schema_theory = "ThCircuitSchema",
      instance_theory = "ThWType",
      edge_rules = [
        # Component → Port ownership
        T.edge_rule "has_input" "component" "port",
        T.edge_rule "has_output" "component" "port",
        T.edge_rule "has_param" "component" "port",

        # Port → Port data flow
        T.edge_rule "wired_to" "port" "port",
        T.edge_rule "param_wired" "port" "port",
        T.edge_rule "feedback" "port" "port",

        # Hierarchy
        T.edge_rule "contains" "sub_circuit" "component",
        T.edge_rule "exposes" "sub_circuit" "boundary",

        # Type annotations
        T.edge_rule "typed_by" "port" "schema_ref",
        T.edge_rule "optic_ref" "wire" "optic_type",

        # Component semantics
        T.edge_rule "implements" "component" "protolens_ref",
        T.edge_rule "configured" "component" "expr_ref",

        # Layout and metadata
        T.edge_rule "positioned" "component" "layout_hint",
        T.edge_rule "annotated" "component" "annotation",

        # Hyperedge anchors (fan-out / fan-in)
        T.edge_rule "fan_out" "junction" "port",
        T.edge_rule "fan_in" "port" "junction",
      ],
    },
  ],
} | T.Bundle
