//! Handle-based resource slab allocator.
//!
//! Follows the pattern from panproto-wasm: opaque `u32` handles reference
//! resources stored in a thread-local slab. Data crosses the WASM boundary
//! as MessagePack byte slices, never as JS objects.
//!
//! Several `Resource` variants and `CircuitState` fields look unused from
//! Rust's perspective — they're reserved surface area for WASM entry points
//! that read them opaquely. The crate-level allow is intentional.

#![allow(clippy::large_enum_variant, dead_code)]

use std::cell::RefCell;
use std::collections::HashMap;

use panproto_gat::{Theory, TheoryMorphism};
use panproto_inst::WInstance;
use panproto_lens::Lens;
use panproto_lens::asymmetric::Complement;
use panproto_schema::{Protocol, Schema};

use crate::error::WasmError;

/// Resources stored in the slab.
pub enum Resource {
    /// A circuit schema with optional evaluation state.
    Circuit(CircuitState),
    /// A panproto schema (e.g., imported as the source for a circuit).
    Schema(Schema),
    /// A GAT theory.
    Theory(Theory),
    /// A protocol definition.
    Protocol(Protocol),
    /// A theory morphism. Reserved for the Colimit composer's output
    /// handle plumbing; not currently surfaced as a distinct WASM entry.
    Morphism(TheoryMorphism),
    /// An auto-generated lens (stored for direct evaluation via
    /// `asymmetric::get`/`put` without circuit decomposition).
    AutoLens(Lens),
    /// A complement from a `get` operation, stored so `put` can restore
    /// the original source instance.
    LensComplement(Complement),
}

/// Circuit + its associated evaluation state.
pub struct CircuitState {
    pub schema: Schema,
    pub source_schema_h: Option<u32>,
    /// Per-circuit protocol override handle (when the user imports a
    /// custom protocol for this circuit specifically). Currently unused
    /// by the eval path — protocols are looked up globally via
    /// `slab::find_user_protocol` — but kept for future per-circuit
    /// protocol pinning.
    pub source_protocol_h: Option<u32>,
    pub input_instance: Option<WInstance>,
    pub last_eval: Option<EvalCache>,
}

impl CircuitState {
    pub fn new(schema: Schema) -> Self {
        Self {
            schema,
            source_schema_h: None,
            source_protocol_h: None,
            input_instance: None,
            last_eval: None,
        }
    }
}

/// Cached evaluation result for backward pass.
pub struct EvalCache {
    pub final_lens: Lens,
    pub final_complement: Complement,
    pub wire_data_json: std::collections::HashMap<String, String>,
    pub output_json: String,
}

thread_local! {
    static SLAB: RefCell<Vec<Option<Resource>>> = const { RefCell::new(Vec::new()) };

    /// Registry of user-defined protocols, keyed by their canonical name.
    ///
    /// Consulted by `panproto_protocols_default` (in `api.rs`) BEFORE the
    /// hardcoded `lookup_panproto_protocol` table, so users can override
    /// or augment the built-in set. Registered via `import_protocol_json`
    /// and cleared via `remove_user_protocol`.
    ///
    /// Names are stored lowercased for case-insensitive matching.
    static USER_PROTOCOLS: RefCell<HashMap<String, Protocol>> = RefCell::new(HashMap::new());
}

/// Register a user-defined protocol. Overwrites any existing entry with
/// the same (case-insensitive) name.
pub fn register_user_protocol(protocol: Protocol) {
    USER_PROTOCOLS.with(|m| {
        let key = protocol.name.to_ascii_lowercase();
        m.borrow_mut().insert(key, protocol);
    });
}

/// Look up a user-defined protocol by name (case-insensitive).
pub fn find_user_protocol(name: &str) -> Option<Protocol> {
    let key = name.to_ascii_lowercase();
    USER_PROTOCOLS.with(|m| m.borrow().get(&key).cloned())
}

/// Remove a user-defined protocol by name. Returns `true` if an entry
/// was removed, `false` if none was found.
pub fn unregister_user_protocol(name: &str) -> bool {
    let key = name.to_ascii_lowercase();
    USER_PROTOCOLS.with(|m| m.borrow_mut().remove(&key).is_some())
}

/// List the names (canonical, original casing) of all registered user
/// protocols in lexicographic order.
pub fn list_user_protocol_names() -> Vec<String> {
    USER_PROTOCOLS.with(|m| {
        let mut names: Vec<String> = m.borrow().values().map(|p| p.name.clone()).collect();
        names.sort();
        names
    })
}

/// Clear the entire user-protocol registry. Used by tests to isolate
/// state between test functions that share the thread-local slab.
#[cfg(test)]
pub fn clear_user_protocols() {
    USER_PROTOCOLS.with(|m| m.borrow_mut().clear());
}

/// Allocate a resource and return its handle.
pub fn alloc(resource: Resource) -> u32 {
    SLAB.with(|slab| {
        let mut slab = slab.borrow_mut();
        for (i, slot) in slab.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(resource);
                return i as u32;
            }
        }
        let handle = slab.len() as u32;
        slab.push(Some(resource));
        handle
    })
}

/// Free a resource by handle.
pub fn free(handle: u32) {
    SLAB.with(|slab| {
        let mut slab = slab.borrow_mut();
        if let Some(slot) = slab.get_mut(handle as usize) {
            *slot = None;
        }
    });
}

/// Access a resource by handle via a closure.
pub fn with_resource<F, R>(handle: u32, f: F) -> Result<R, WasmError>
where
    F: FnOnce(&Resource) -> R,
{
    SLAB.with(|slab| {
        let slab = slab.borrow();
        let resource = slab
            .get(handle as usize)
            .and_then(|slot| slot.as_ref())
            .ok_or(WasmError::InvalidHandle(handle))?;
        Ok(f(resource))
    })
}

/// Access a resource mutably by handle via a closure.
pub fn with_resource_mut<F, R>(handle: u32, f: F) -> Result<R, WasmError>
where
    F: FnOnce(&mut Resource) -> R,
{
    SLAB.with(|slab| {
        let mut slab = slab.borrow_mut();
        let resource = slab
            .get_mut(handle as usize)
            .and_then(|slot| slot.as_mut())
            .ok_or(WasmError::InvalidHandle(handle))?;
        Ok(f(resource))
    })
}

/// Get a circuit schema from a handle.
pub fn get_circuit(handle: u32) -> Result<Schema, WasmError> {
    with_resource(handle, |r| match r {
        Resource::Circuit(state) => Ok(state.schema.clone()),
        _ => Err(WasmError::TypeMismatch {
            expected: "Circuit",
            got: "other",
        }),
    })?
}

/// Get a panproto schema from a handle.
pub fn get_schema(handle: u32) -> Result<Schema, WasmError> {
    with_resource(handle, |r| match r {
        Resource::Schema(s) => Ok(s.clone()),
        Resource::Circuit(state) => Ok(state.schema.clone()),
        _ => Err(WasmError::TypeMismatch {
            expected: "Schema",
            got: "other",
        }),
    })?
}

/// Get a theory from a handle.
pub fn get_theory(handle: u32) -> Result<Theory, WasmError> {
    with_resource(handle, |r| match r {
        Resource::Theory(t) => Ok(t.clone()),
        _ => Err(WasmError::TypeMismatch {
            expected: "Theory",
            got: "other",
        }),
    })?
}

/// Get a protocol from a handle.
pub fn get_protocol(handle: u32) -> Result<Protocol, WasmError> {
    with_resource(handle, |r| match r {
        Resource::Protocol(p) => Ok(p.clone()),
        _ => Err(WasmError::TypeMismatch {
            expected: "Protocol",
            got: "other",
        }),
    })?
}

#[cfg(test)]
mod tests {
    //! These tests share the thread-local SLAB across all #[test]s. Each test
    //! allocates its own handles and frees them; tests must NOT depend on
    //! absolute handle values across tests, only relative ordering within a
    //! single test.

    use super::*;
    use std::collections::HashMap;

    // ─── Helpers ───

    fn dummy_schema() -> Schema {
        Schema {
            protocol: "test-protocol".into(),
            vertices: HashMap::new(),
            edges: HashMap::new(),
            hyper_edges: HashMap::new(),
            constraints: HashMap::new(),
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
            outgoing: HashMap::new(),
            incoming: HashMap::new(),
            between: HashMap::new(),
        }
    }

    fn dummy_circuit_state() -> CircuitState {
        CircuitState::new(dummy_schema())
    }

    fn dummy_theory() -> Theory {
        Theory::new("test-theory", vec![], vec![], vec![])
    }

    fn dummy_morphism() -> TheoryMorphism {
        TheoryMorphism::identity(&dummy_theory())
    }

    fn dummy_protocol() -> Protocol {
        Protocol {
            name: "test".into(),
            ..Protocol::default()
        }
    }

    // ─── alloc / free ───

    #[test]
    fn alloc_returns_handle_for_each_resource() {
        let h1 = alloc(Resource::Circuit(dummy_circuit_state()));
        let h2 = alloc(Resource::Schema(dummy_schema()));
        let h3 = alloc(Resource::Protocol(dummy_protocol()));

        assert!(with_resource(h1, |r| matches!(r, Resource::Circuit(_))).unwrap());
        assert!(with_resource(h2, |r| matches!(r, Resource::Schema(_))).unwrap());
        assert!(with_resource(h3, |r| matches!(r, Resource::Protocol(_))).unwrap());

        free(h1);
        free(h2);
        free(h3);
    }

    #[test]
    fn alloc_after_free_reuses_freed_slot() {
        let h1 = alloc(Resource::Schema(dummy_schema()));
        let h2 = alloc(Resource::Schema(dummy_schema()));
        let h3 = alloc(Resource::Schema(dummy_schema()));

        free(h2);
        let h_new = alloc(Resource::Schema(dummy_schema()));
        assert_eq!(h_new, h2, "new alloc should reuse freed slot");

        free(h1);
        free(h_new);
        free(h3);
    }

    #[test]
    fn free_invalid_handle_is_noop() {
        // Should not panic.
        free(99_999);
        free(u32::MAX);
    }

    #[test]
    fn alloc_many_resources_grows_slab() {
        let handles: Vec<u32> = (0..50)
            .map(|_| alloc(Resource::Schema(dummy_schema())))
            .collect();

        for &h in &handles {
            assert!(with_resource(h, |r| matches!(r, Resource::Schema(_))).unwrap());
        }

        for h in handles {
            free(h);
        }
    }

    // ─── with_resource / with_resource_mut ───

    #[test]
    fn with_resource_returns_value_from_closure() {
        let h = alloc(Resource::Schema(dummy_schema()));
        let protocol_name = with_resource(h, |r| match r {
            Resource::Schema(s) => s.protocol.clone(),
            _ => panic!("expected schema"),
        })
        .unwrap();
        assert_eq!(protocol_name, "test-protocol");
        free(h);
    }

    #[test]
    fn with_resource_mut_can_modify_circuit_state() {
        let h = alloc(Resource::Circuit(dummy_circuit_state()));

        // Precondition: source_schema_h starts as None.
        let before = with_resource(h, |r| match r {
            Resource::Circuit(state) => state.source_schema_h,
            _ => panic!("expected circuit"),
        })
        .unwrap();
        assert_eq!(before, None);

        // Mutate via with_resource_mut.
        with_resource_mut(h, |r| match r {
            Resource::Circuit(state) => {
                state.source_schema_h = Some(7);
            }
            _ => panic!("expected circuit"),
        })
        .unwrap();

        // Verify via with_resource.
        let after = with_resource(h, |r| match r {
            Resource::Circuit(state) => state.source_schema_h,
            _ => panic!("expected circuit"),
        })
        .unwrap();
        assert_eq!(after, Some(7));

        free(h);
    }

    #[test]
    fn with_resource_invalid_handle_returns_invalid_handle_error() {
        let result = with_resource(987_654, |_| ());
        match result {
            Err(WasmError::InvalidHandle(h)) => assert_eq!(h, 987_654),
            other => panic!("expected InvalidHandle, got {:?}", other.err()),
        }
    }

    #[test]
    fn with_resource_mut_invalid_handle_returns_invalid_handle_error() {
        let result = with_resource_mut(876_543, |_| ());
        match result {
            Err(WasmError::InvalidHandle(h)) => assert_eq!(h, 876_543),
            other => panic!("expected InvalidHandle, got {:?}", other.err()),
        }
    }

    #[test]
    fn with_resource_after_free_returns_invalid_handle_error() {
        let h = alloc(Resource::Schema(dummy_schema()));
        free(h);
        let result = with_resource(h, |_| ());
        assert!(matches!(result, Err(WasmError::InvalidHandle(_))));
    }

    // ─── get_circuit ───

    #[test]
    fn get_circuit_returns_schema_for_circuit_handle() {
        let h = alloc(Resource::Circuit(dummy_circuit_state()));
        let schema = get_circuit(h).unwrap();
        assert_eq!(schema.protocol, "test-protocol");
        free(h);
    }

    #[test]
    fn get_circuit_errors_on_schema_handle_with_type_mismatch() {
        let h = alloc(Resource::Schema(dummy_schema()));
        let err = get_circuit(h).unwrap_err();
        assert!(matches!(
            err,
            WasmError::TypeMismatch {
                expected: "Circuit",
                ..
            }
        ));
        free(h);
    }

    #[test]
    fn get_circuit_errors_on_invalid_handle() {
        let err = get_circuit(765_432).unwrap_err();
        assert!(matches!(err, WasmError::InvalidHandle(765_432)));
    }

    // ─── get_schema ───

    #[test]
    fn get_schema_returns_schema_for_schema_handle() {
        let h = alloc(Resource::Schema(dummy_schema()));
        let schema = get_schema(h).unwrap();
        assert_eq!(schema.protocol, "test-protocol");
        free(h);
    }

    #[test]
    fn get_schema_returns_schema_for_circuit_handle() {
        // get_schema accepts Circuit handles too and returns the underlying schema.
        let h = alloc(Resource::Circuit(dummy_circuit_state()));
        let schema = get_schema(h).unwrap();
        assert_eq!(schema.protocol, "test-protocol");
        free(h);
    }

    #[test]
    fn get_schema_errors_on_theory_handle_with_type_mismatch() {
        let h = alloc(Resource::Theory(dummy_theory()));
        let err = get_schema(h).unwrap_err();
        assert!(matches!(
            err,
            WasmError::TypeMismatch {
                expected: "Schema",
                ..
            }
        ));
        free(h);
    }

    #[test]
    fn get_schema_errors_on_invalid_handle() {
        let err = get_schema(654_321).unwrap_err();
        assert!(matches!(err, WasmError::InvalidHandle(654_321)));
    }

    // ─── get_theory ───

    #[test]
    fn get_theory_returns_theory_for_theory_handle() {
        let h = alloc(Resource::Theory(dummy_theory()));
        let theory = get_theory(h).unwrap();
        assert_eq!(&*theory.name, "test-theory");
        free(h);
    }

    #[test]
    fn get_theory_errors_on_circuit_handle_with_type_mismatch() {
        let h = alloc(Resource::Circuit(dummy_circuit_state()));
        let err = get_theory(h).unwrap_err();
        assert!(matches!(
            err,
            WasmError::TypeMismatch {
                expected: "Theory",
                ..
            }
        ));
        free(h);
    }

    #[test]
    fn get_theory_errors_on_invalid_handle() {
        let err = get_theory(543_210).unwrap_err();
        assert!(matches!(err, WasmError::InvalidHandle(543_210)));
    }

    // ─── get_protocol ───

    #[test]
    fn get_protocol_returns_protocol_for_protocol_handle() {
        let h = alloc(Resource::Protocol(dummy_protocol()));
        let protocol = get_protocol(h).unwrap();
        assert_eq!(protocol.name, "test");
        free(h);
    }

    #[test]
    fn get_protocol_errors_on_schema_handle_with_type_mismatch() {
        let h = alloc(Resource::Schema(dummy_schema()));
        let err = get_protocol(h).unwrap_err();
        assert!(matches!(
            err,
            WasmError::TypeMismatch {
                expected: "Protocol",
                ..
            }
        ));
        free(h);
    }

    #[test]
    fn get_protocol_errors_on_invalid_handle() {
        let err = get_protocol(432_109).unwrap_err();
        assert!(matches!(err, WasmError::InvalidHandle(432_109)));
    }

    // ─── TypeMismatch error variant content ───

    #[test]
    fn type_mismatch_error_carries_expected_string() {
        let h = alloc(Resource::Schema(dummy_schema()));
        let err = get_circuit(h).unwrap_err();
        match err {
            WasmError::TypeMismatch { expected, .. } => {
                assert_eq!(expected, "Circuit");
            }
            other => panic!("expected TypeMismatch, got {:?}", other),
        }
        free(h);
    }

    // ─── Resource enum coverage ───

    #[test]
    fn morphism_resource_can_be_allocated_and_retrieved_via_with_resource() {
        let h = alloc(Resource::Morphism(dummy_morphism()));
        let is_morphism = with_resource(h, |r| matches!(r, Resource::Morphism(_))).unwrap();
        assert!(is_morphism);
        free(h);
    }

    // ─── CircuitState ───

    #[test]
    fn circuit_state_new_initializes_all_optional_fields_to_none() {
        let state = CircuitState::new(dummy_schema());
        assert!(state.source_schema_h.is_none());
        assert!(state.source_protocol_h.is_none());
        assert!(state.input_instance.is_none());
        assert!(state.last_eval.is_none());
        assert_eq!(state.schema.protocol, "test-protocol");
    }
}
