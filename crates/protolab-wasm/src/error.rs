//! WASM error types.

/// Errors from circuit WASM operations.
///
/// Implements `std::error::Error` via thiserror, which means
/// `wasm_bindgen`'s blanket `From<E: StdError> for JsError` applies
/// automatically — no manual `From` impl needed.
#[derive(Debug, thiserror::Error)]
pub enum WasmError {
    #[error("invalid handle: {0}")]
    InvalidHandle(u32),

    #[error("type mismatch: expected {expected}, got {got}")]
    TypeMismatch {
        expected: &'static str,
        got: &'static str,
    },

    #[error("deserialization failed: {0}")]
    DeserializationFailed(String),

    #[error("serialization failed: {0}")]
    SerializationFailed(String),

    #[error("circuit error: {0}")]
    Circuit(#[from] protolab_schema::CircuitError),
}
