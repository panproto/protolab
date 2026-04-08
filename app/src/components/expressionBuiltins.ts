/**
 * panproto-expr builtin function names + categories.
 * This list MUST stay in sync with crates/protolab-wasm/src/api.rs::list_expr_builtins
 * and grammars/tokens.json.
 */

export interface BuiltinSpec {
  name: string;
  category: string;
  signature: string;
}

export const BUILTINS: BuiltinSpec[] = [
  // Arithmetic
  { name: "add", category: "arithmetic", signature: "add(a, b)" },
  { name: "sub", category: "arithmetic", signature: "sub(a, b)" },
  { name: "mul", category: "arithmetic", signature: "mul(a, b)" },
  { name: "div", category: "arithmetic", signature: "div(a, b)" },
  { name: "mod_", category: "arithmetic", signature: "mod_(a, b)" },
  { name: "neg", category: "arithmetic", signature: "neg(a)" },
  { name: "abs", category: "arithmetic", signature: "abs(a)" },
  // Rounding
  { name: "floor", category: "rounding", signature: "floor(a)" },
  { name: "ceil", category: "rounding", signature: "ceil(a)" },
  { name: "round", category: "rounding", signature: "round(a)" },
  // Comparison
  { name: "eq", category: "comparison", signature: "eq(a, b)" },
  { name: "neq", category: "comparison", signature: "neq(a, b)" },
  { name: "lt", category: "comparison", signature: "lt(a, b)" },
  { name: "lte", category: "comparison", signature: "lte(a, b)" },
  { name: "gt", category: "comparison", signature: "gt(a, b)" },
  { name: "gte", category: "comparison", signature: "gte(a, b)" },
  // Boolean
  { name: "and", category: "boolean", signature: "and(a, b)" },
  { name: "or", category: "boolean", signature: "or(a, b)" },
  { name: "not", category: "boolean", signature: "not(a)" },
  // String
  { name: "concat", category: "string", signature: "concat(a, b)" },
  { name: "len", category: "string", signature: "len(s)" },
  { name: "slice", category: "string", signature: "slice(s, start, end)" },
  { name: "upper", category: "string", signature: "upper(s)" },
  { name: "lower", category: "string", signature: "lower(s)" },
  { name: "trim", category: "string", signature: "trim(s)" },
  { name: "split", category: "string", signature: "split(s, delim)" },
  { name: "join", category: "string", signature: "join(parts, delim)" },
  { name: "replace", category: "string", signature: "replace(s, from, to)" },
  { name: "contains", category: "string", signature: "contains(s, substr)" },
  // List
  { name: "map", category: "list", signature: "map(list, f)" },
  { name: "filter", category: "list", signature: "filter(list, pred)" },
  { name: "fold", category: "list", signature: "fold(list, init, f)" },
  { name: "append", category: "list", signature: "append(list, item)" },
  { name: "head", category: "list", signature: "head(list)" },
  { name: "tail", category: "list", signature: "tail(list)" },
  { name: "reverse", category: "list", signature: "reverse(list)" },
  { name: "flat_map", category: "list", signature: "flat_map(list, f)" },
  { name: "length", category: "list", signature: "length(list)" },
  // Record
  { name: "merge", category: "record", signature: "merge(a, b)" },
  { name: "keys", category: "record", signature: "keys(r)" },
  { name: "values", category: "record", signature: "values(r)" },
  { name: "has_field", category: "record", signature: "has_field(r, name)" },
  // Utility
  { name: "default", category: "utility", signature: "default(x, fallback)" },
  { name: "clamp", category: "utility", signature: "clamp(x, min, max)" },
  { name: "truncate_str", category: "utility", signature: "truncate_str(s, max_len)" },
  // Coercion
  { name: "int_to_float", category: "coercion", signature: "int_to_float(n)" },
  { name: "float_to_int", category: "coercion", signature: "float_to_int(f)" },
  { name: "int_to_str", category: "coercion", signature: "int_to_str(n)" },
  { name: "float_to_str", category: "coercion", signature: "float_to_str(f)" },
  { name: "str_to_int", category: "coercion", signature: "str_to_int(s)" },
  { name: "str_to_float", category: "coercion", signature: "str_to_float(s)" },
  // Inspection
  { name: "type_of", category: "inspection", signature: "type_of(v)" },
  { name: "is_null", category: "inspection", signature: "is_null(v)" },
  { name: "is_list", category: "inspection", signature: "is_list(v)" },
  // Graph
  { name: "edge", category: "graph", signature: "edge(node, edge_kind)" },
  { name: "children", category: "graph", signature: "children(node)" },
  { name: "has_edge", category: "graph", signature: "has_edge(node, edge_kind)" },
  { name: "edge_count", category: "graph", signature: "edge_count(node)" },
  { name: "anchor", category: "graph", signature: "anchor(node)" },
];

export const KEYWORDS = [
  "let", "in", "where", "if", "then", "else",
  "case", "of", "do", "guard", "otherwise",
];

export const CONSTANTS = ["True", "False", "Nothing"];

export const BUILTIN_NAME_SET = new Set(BUILTINS.map((b) => b.name));
export const KEYWORD_SET = new Set(KEYWORDS);
export const CONSTANT_SET = new Set(CONSTANTS);
