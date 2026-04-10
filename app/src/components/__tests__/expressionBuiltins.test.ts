/**
 * Tests for the panproto-expr builtin catalog.
 * Ensures the exported sets are consistent with the BUILTINS array
 * and that every entry has the required shape.
 */

import { describe, it, expect } from "vitest";
import {
  BUILTINS,
  KEYWORDS,
  CONSTANTS,
  BUILTIN_NAME_SET,
  KEYWORD_SET,
  CONSTANT_SET,
} from "../expressionBuiltins";

describe("expressionBuiltins", () => {
  it("BUILTINS array is non-empty and every entry has name, category, signature", () => {
    expect(BUILTINS.length).toBeGreaterThan(20);
    for (const b of BUILTINS) {
      expect(typeof b.name).toBe("string");
      expect(b.name.length).toBeGreaterThan(0);
      expect(typeof b.category).toBe("string");
      expect(typeof b.signature).toBe("string");
      expect(b.signature).toContain(b.name);
    }
  });

  it("BUILTIN_NAME_SET contains exactly the names from BUILTINS", () => {
    expect(BUILTIN_NAME_SET.size).toBe(BUILTINS.length);
    for (const b of BUILTINS) {
      expect(BUILTIN_NAME_SET.has(b.name)).toBe(true);
    }
  });

  it("KEYWORD_SET covers let/in/if/then/else/case/of", () => {
    for (const kw of ["let", "in", "if", "then", "else", "case", "of"]) {
      expect(KEYWORD_SET.has(kw)).toBe(true);
    }
    expect(KEYWORD_SET.size).toBe(KEYWORDS.length);
  });

  it("CONSTANT_SET covers True/False/Nothing", () => {
    expect(CONSTANT_SET.has("True")).toBe(true);
    expect(CONSTANT_SET.has("False")).toBe(true);
    expect(CONSTANT_SET.has("Nothing")).toBe(true);
    expect(CONSTANT_SET.size).toBe(3);
  });

  it("no name collisions between builtins, keywords, and constants", () => {
    for (const name of BUILTIN_NAME_SET) {
      expect(KEYWORD_SET.has(name)).toBe(false);
      expect(CONSTANT_SET.has(name)).toBe(false);
    }
    for (const kw of KEYWORD_SET) {
      expect(CONSTANT_SET.has(kw)).toBe(false);
    }
  });

  it("includes key builtins: len, map, filter, concat, str_to_int", () => {
    for (const name of ["len", "map", "filter", "concat", "str_to_int"]) {
      expect(BUILTIN_NAME_SET.has(name)).toBe(true);
    }
  });
});
