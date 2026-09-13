import { describe, expect, test } from "bun:test";
import { tokenize } from "./tokenize.ts";

describe("tokenize", () => {
  test("TypeScript: keywords + strings + comments + numbers + types", () => {
    const src = [
      `import { x } from "zod"; // load`,
      `const n = 42;`,
      `class User { id: number; }`,
    ].join("\n");
    const t = tokenize(src, "typescript");
    // keywords
    expect(t.keyword?.some(([line, s]) => line === 0 && src.slice(s).startsWith("import"))).toBe(
      true,
    );
    expect(
      t.keyword?.some(
        ([line, s]) => line === 1 && src.split("\n")[1]?.slice(s).startsWith("const"),
      ),
    ).toBe(true);
    // string
    expect(t.string?.some(([line]) => line === 0)).toBe(true);
    // comment
    expect(t.comment?.some(([line]) => line === 0)).toBe(true);
    // number
    expect(t.number?.some(([line]) => line === 1)).toBe(true);
    // type (PascalCase)
    expect(t.type?.some(([line]) => line === 2)).toBe(true);
  });

  test("Python: # comments and triple-quoted strings", () => {
    const src = `"""docstring"""\n# todo: implement\ndef hello():\n    return None`;
    const t = tokenize(src, "python");
    // Triple-quoted string on line 0
    expect(t.string?.some(([line]) => line === 0)).toBe(true);
    // `#` comment on line 1
    expect(t.comment?.some(([line]) => line === 1)).toBe(true);
    // `def` keyword on line 2
    expect(t.keyword?.some(([line]) => line === 2)).toBe(true);
    // `return` keyword on line 3
    expect(t.keyword?.some(([line]) => line === 3)).toBe(true);
  });

  test("Go: package + func + raw strings", () => {
    const src = `package main\nfunc handle(w int) {\n  raw := \`hello\`\n}`;
    const t = tokenize(src, "go");
    expect(t.keyword?.some(([line]) => line === 0)).toBe(true);
    expect(t.keyword?.some(([line]) => line === 1)).toBe(true);
    expect(t.string?.some(([line]) => line === 2)).toBe(true);
  });

  test("Rust: fn / let / match keywords", () => {
    const src = `fn main() {\n  let x = 1;\n  match x { _ => () }\n}`;
    const t = tokenize(src, "rust");
    expect(t.keyword?.some(([line]) => line === 0)).toBe(true);
    expect(t.keyword?.some(([line]) => line === 1)).toBe(true);
    expect(t.keyword?.some(([line]) => line === 2)).toBe(true);
    expect(t.number?.some(([line]) => line === 1)).toBe(true);
  });

  test("JSON: true / false / null keywords and strings", () => {
    const src = `{ "name": "x", "active": true, "count": 5, "empty": null }`;
    const t = tokenize(src, "json");
    expect(t.string).toBeDefined();
    expect(t.keyword?.length).toBe(2); // true, null
    expect(t.number?.length).toBe(1);
    // JSON has no comments
    expect(t.comment).toBeUndefined();
  });

  test("keywords inside strings are NOT tokenized as keywords", () => {
    const src = `const s = "if you can class true";`;
    const t = tokenize(src, "typescript");
    // The literal `if` / `class` / `true` inside the string must not be in keyword spans.
    const inside = (col: number) => {
      const line0 = src.split("\n")[0] ?? "";
      const stringStart = line0.indexOf('"');
      const stringEnd = line0.indexOf('"', stringStart + 1);
      return col > stringStart && col < stringEnd;
    };
    expect(t.keyword?.some(([line, s]) => line === 0 && inside(s))).toBe(false);
  });

  test("multi-line strings produce one span per line", () => {
    const src = `x = """\nline a\nline b\n"""`;
    const t = tokenize(src, "python");
    // Span on line 0 (the opening `"""`), spans on 1 and 2 (the body), and 3
    // (the closing `"""`). At minimum we should see lines 0–3 all covered.
    const lines = new Set((t.string ?? []).map(([line]) => line));
    expect(lines.has(0)).toBe(true);
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
  });

  test("empty content returns empty", () => {
    expect(tokenize("", "typescript")).toEqual({});
  });
});
