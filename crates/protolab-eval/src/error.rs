/// Errors during circuit evaluation.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum EvalError {
    #[error("circuit topology error: {0}")]
    Topology(#[from] protolab_schema::CircuitError),

    #[error("unknown component type: {0}")]
    UnknownComponentType(String),

    #[error("missing required parameter '{key}' on component '{component}'")]
    MissingParam { component: String, key: String },

    #[error("panproto lens error: {0}")]
    Lens(String),

    #[error("instance parse error: {0}")]
    ParseInstance(String),

    #[error("schema not assigned — call set_source_schema first")]
    NoSourceSchema,

    #[error("invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),

    #[error("expression parse error in component '{component}' field '{field}': {message}")]
    ExprParse {
        component: String,
        field: String,
        message: String,
    },
}
