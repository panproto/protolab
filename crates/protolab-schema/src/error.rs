/// Errors from circuit schema construction and validation.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum CircuitError {
    /// A vertex with this ID already exists.
    #[error("duplicate vertex: {0}")]
    DuplicateVertex(String),

    /// Referenced vertex not found.
    #[error("vertex not found: {0}")]
    VertexNotFound(String),

    /// Referenced port not found.
    #[error("port not found: {0}")]
    PortNotFound(String),

    /// Wire type mismatch.
    #[error("wire type mismatch: {0}")]
    WireMismatch(String),

    /// Cycle detected in circuit (feedback edges excluded).
    #[error("cycle detected in circuit DAG")]
    CycleDetected,

    /// Conversion error.
    #[error("conversion error: {0}")]
    Conversion(String),

    /// panproto error.
    #[error("panproto: {0}")]
    Panproto(String),
}
