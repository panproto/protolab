/**
 * tree-sitter-panproto-expr
 *
 * Grammar for the panproto expression language. Mirrors the structure of
 * panproto-expr-parser (Chumsky + Logos) — see
 * /Users/awhite48/Projects/phrom/crates/panproto-expr-parser/src/{lexer.rs,parser.rs}
 *
 * NOTE: This grammar focuses on accurate token highlighting and bracket
 * matching. It is intentionally permissive about layout (Indent/Dedent)
 * since tree-sitter has no built-in indentation awareness — for
 * indentation-sensitive parsing, use the Rust parser instead.
 */

module.exports = grammar({
  name: 'panproto_expr',

  extras: $ => [
    /\s/,
    $.comment,
  ],

  word: $ => $.lower_id,

  precedences: $ => [
    [
      'unary',
      'application',
      'multiplicative',
      'additive',
      'concat',
      'comparison',
      'logical_and',
      'logical_or',
      'pipe',
      'lambda',
      'sequence',
    ],
  ],

  rules: {
    source_file: $ => $._expression,

    _expression: $ => choice(
      $.let_expression,
      $.if_expression,
      $.case_expression,
      $.lambda_expression,
      $._operator_expression,
    ),

    // ── Literals ────────────────────────────────────────────────

    integer_literal: _ => choice(
      /[0-9][0-9_]*/,
      /0x[0-9a-fA-F][0-9a-fA-F_]*/
    ),

    float_literal: _ => /[0-9][0-9_]*\.[0-9][0-9_]*/,

    string_literal: $ => seq(
      '"',
      repeat(choice(
        /[^"\\]+/,
        $.escape_sequence,
      )),
      '"'
    ),

    escape_sequence: _ => /\\([\\"nrt0]|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f]+\})/,

    boolean_literal: _ => choice('True', 'False'),

    null_literal: _ => 'Nothing',

    // ── Identifiers ─────────────────────────────────────────────

    lower_id: _ => /[a-z_][a-zA-Z0-9_']*/,

    upper_id: _ => /[A-Z][a-zA-Z0-9_']*/,

    wildcard: _ => '_',

    // ── Comments ────────────────────────────────────────────────

    comment: _ => token(seq('--', /[^\n]*/)),

    // ── Composite expressions ───────────────────────────────────

    let_expression: $ => seq(
      'let',
      $.binding,
      'in',
      $._expression,
    ),

    binding: $ => seq(
      $.lower_id,
      repeat($.lower_id), // function params
      '=',
      $._expression,
    ),

    if_expression: $ => seq(
      'if',
      $._expression,
      'then',
      $._expression,
      'else',
      $._expression,
    ),

    case_expression: $ => seq(
      'case',
      $._expression,
      'of',
      repeat1($.case_arm),
    ),

    case_arm: $ => seq(
      $._pattern,
      '->',
      $._expression,
    ),

    lambda_expression: $ => prec.right('lambda', seq(
      '\\',
      repeat1(choice($.lower_id, $.wildcard)),
      '->',
      $._expression,
    )),

    // ── Patterns ────────────────────────────────────────────────

    _pattern: $ => choice(
      $.wildcard,
      $.lower_id,
      $.integer_literal,
      $.float_literal,
      $.string_literal,
      $.boolean_literal,
      $.null_literal,
      $.list_pattern,
      $.constructor_pattern,
    ),

    list_pattern: $ => seq(
      '[',
      optional(seq($._pattern, repeat(seq(',', $._pattern)))),
      ']'
    ),

    constructor_pattern: $ => seq(
      $.upper_id,
      repeat($._pattern),
    ),

    // ── Operator expressions (Pratt) ────────────────────────────

    _operator_expression: $ => choice(
      $.pipe_expression,
      $.logical_or_expression,
      $.logical_and_expression,
      $.comparison_expression,
      $.concat_expression,
      $.additive_expression,
      $.multiplicative_expression,
      $.unary_expression,
      $._application_expression,
    ),

    pipe_expression: $ => prec.left('pipe', seq(
      $._expression, '&', $._expression,
    )),

    logical_or_expression: $ => prec.left('logical_or', seq(
      $._expression, '||', $._expression,
    )),

    logical_and_expression: $ => prec.left('logical_and', seq(
      $._expression, '&&', $._expression,
    )),

    comparison_expression: $ => prec.left('comparison', seq(
      $._expression,
      choice('==', '/=', '<', '<=', '>', '>='),
      $._expression,
    )),

    concat_expression: $ => prec.right('concat', seq(
      $._expression, '++', $._expression,
    )),

    additive_expression: $ => prec.left('additive', seq(
      $._expression,
      choice('+', '-'),
      $._expression,
    )),

    multiplicative_expression: $ => prec.left('multiplicative', seq(
      $._expression,
      choice('*', '/', '%', 'mod', 'div'),
      $._expression,
    )),

    unary_expression: $ => prec('unary', seq(
      choice('-', 'not'),
      $._expression,
    )),

    // ── Application & atoms ─────────────────────────────────────

    _application_expression: $ => choice(
      $.function_application,
      $._postfix_expression,
    ),

    function_application: $ => prec.left('application', seq(
      $._postfix_expression,
      $._postfix_expression,
    )),

    _postfix_expression: $ => choice(
      $.field_access,
      $.index_expression,
      $._atom,
    ),

    field_access: $ => prec.left(seq(
      $._postfix_expression,
      '.',
      $.lower_id,
    )),

    index_expression: $ => prec.left(seq(
      $._postfix_expression,
      '[',
      $._expression,
      ']',
    )),

    _atom: $ => choice(
      $.parenthesized_expression,
      $.list_expression,
      $.record_expression,
      $.integer_literal,
      $.float_literal,
      $.string_literal,
      $.boolean_literal,
      $.null_literal,
      $.upper_id,
      $.lower_id,
      $.wildcard,
    ),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    list_expression: $ => seq(
      '[',
      optional(seq(
        $._expression,
        choice(
          repeat(seq(',', $._expression)),
          seq('|', $._comprehension_qualifier, repeat(seq(',', $._comprehension_qualifier))),
          seq('..', optional($._expression)),
        ),
      )),
      ']'
    ),

    _comprehension_qualifier: $ => choice(
      $.generator,
      $._expression,
    ),

    generator: $ => seq($.lower_id, '<-', $._expression),

    record_expression: $ => seq(
      '{',
      optional(seq(
        $.record_field,
        repeat(seq(',', $.record_field)),
      )),
      '}'
    ),

    record_field: $ => choice(
      seq($.lower_id, ':', $._expression),
      $.lower_id, // punning shorthand
    ),
  },
});
