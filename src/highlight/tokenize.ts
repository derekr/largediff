// Regex-based per-language tokenizer.
//
// Returns per-kind, per-line column ranges (no fileId — that's added at the
// projection layer). Strings and comments are scanned first; the offsets they
// occupy are marked as "consumed" so subsequent passes (keywords, numbers,
// function/type heuristics) don't fire inside them.
//
// This is intentionally regex-based rather than tree-sitter. The
// `DiffSynthesizer.tokens` contract is stable — a follow-up bean can swap
// `tokenize` for a tree-sitter-backed implementation without touching
// callers, the wire format, or the client.

import type { HighlightKind, HighlightSpan, Language, TokenSpans } from "../store/diff.ts";

const KEYWORDS: Record<Language, readonly string[]> = {
  typescript: [
    "import",
    "export",
    "from",
    "as",
    "const",
    "let",
    "var",
    "function",
    "class",
    "interface",
    "type",
    "return",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "new",
    "throw",
    "try",
    "catch",
    "finally",
    "async",
    "await",
    "of",
    "in",
    "typeof",
    "instanceof",
    "null",
    "undefined",
    "true",
    "false",
    "this",
    "super",
    "extends",
    "implements",
    "static",
    "public",
    "private",
    "protected",
    "readonly",
    "abstract",
    "enum",
  ],
  python: [
    "def",
    "class",
    "import",
    "from",
    "as",
    "return",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "in",
    "not",
    "and",
    "or",
    "is",
    "None",
    "True",
    "False",
    "lambda",
    "with",
    "try",
    "except",
    "finally",
    "raise",
    "pass",
    "break",
    "continue",
    "yield",
    "global",
    "nonlocal",
    "async",
    "await",
  ],
  go: [
    "package",
    "import",
    "func",
    "var",
    "const",
    "type",
    "struct",
    "interface",
    "return",
    "if",
    "else",
    "for",
    "range",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "go",
    "defer",
    "select",
    "chan",
    "map",
    "make",
    "new",
    "nil",
    "true",
    "false",
  ],
  rust: [
    "fn",
    "let",
    "mut",
    "const",
    "static",
    "use",
    "mod",
    "pub",
    "crate",
    "extern",
    "return",
    "if",
    "else",
    "for",
    "while",
    "loop",
    "match",
    "impl",
    "trait",
    "struct",
    "enum",
    "union",
    "self",
    "Self",
    "super",
    "where",
    "move",
    "ref",
    "as",
    "in",
    "continue",
    "break",
    "true",
    "false",
    "async",
    "await",
    "dyn",
    "unsafe",
    "box",
  ],
  json: ["true", "false", "null"],
};

function keywordRegex(lang: Language): RegExp {
  return new RegExp(`\\b(?:${KEYWORDS[lang].join("|")})\\b`, "g");
}

function stringRegex(lang: Language): RegExp {
  // Known limit of the multi-line alternatives (TS template literals,
  // Python triple quotes, Go raw strings): they exclude no newline, so an
  // UNPAIRED opening delimiter would pair with the next one anywhere later
  // in the file and paint every intervening line as one string. Safe here
  // because this tokenizer only ever sees the synthetic corpus, and the
  // snippet bank (src/diff/snippets.ts) contains no backticks or triple
  // quotes at all — the generator stitches and truncates whole snippet
  // LINES, so it cannot manufacture one either. Revisit before pointing
  // this at arbitrary input.
  if (lang === "python") {
    return /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
  }
  if (lang === "typescript") {
    return /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  }
  if (lang === "go") {
    return /"(?:[^"\\\n]|\\.)*"|`[^`]*`/g;
  }
  if (lang === "rust") {
    return /r?"(?:[^"\\\n]|\\.)*"/g;
  }
  return /"(?:[^"\\\n]|\\.)*"/g;
}

function commentRegex(lang: Language): RegExp | undefined {
  if (lang === "python") return /#[^\n]*/g;
  if (lang === "json") return undefined; // JSON has no comments (strict)
  return /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
}

const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;
// Lowercase-starting identifier followed by `(` — picks call sites & defs.
const FUNCTION_RE = /\b([a-z_][a-zA-Z0-9_]*)\s*\(/g;
// PascalCase identifier — picks type names, class names, etc.
const TYPE_RE = /\b[A-Z][a-zA-Z0-9_]*\b/g;

// Build a [lineStart, lineLength] index for fast offset → (line, col) conversion.
interface LineIndex {
  starts: number[];
  lengths: number[];
}

function indexLines(content: string): LineIndex {
  const starts: number[] = [0];
  const lengths: number[] = [];
  let lineStart = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      lengths.push(i - lineStart);
      starts.push(i + 1);
      lineStart = i + 1;
    }
  }
  lengths.push(content.length - lineStart);
  return { starts, lengths };
}

function offsetToLine(idx: LineIndex, offset: number): number {
  // Binary search for the largest starts[i] <= offset.
  let lo = 0;
  let hi = idx.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if ((idx.starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Split a (matchStart, matchEnd) range — UTF-16 code-unit indices into
// `content`, the same units the client's Range offsets use — into
// per-line spans.
function pushSpans(
  out: HighlightSpan[],
  idx: LineIndex,
  matchStart: number,
  matchEnd: number,
): void {
  const startLine = offsetToLine(idx, matchStart);
  const endLine = offsetToLine(idx, matchEnd - 1);
  if (startLine === endLine) {
    const startCol = matchStart - (idx.starts[startLine] ?? 0);
    const endCol = matchEnd - (idx.starts[startLine] ?? 0);
    out.push([startLine, startCol, endCol]);
    return;
  }
  // First line: from startCol to end of line.
  out.push([startLine, matchStart - (idx.starts[startLine] ?? 0), idx.lengths[startLine] ?? 0]);
  // Middle lines: full line.
  for (let l = startLine + 1; l < endLine; l++) {
    out.push([l, 0, idx.lengths[l] ?? 0]);
  }
  // Last line: from 0 to endCol.
  out.push([endLine, 0, matchEnd - (idx.starts[endLine] ?? 0)]);
}

function markConsumed(consumed: Uint8Array, start: number, end: number): void {
  for (let i = start; i < end; i++) consumed[i] = 1;
}

export function tokenize(content: string, lang: Language): TokenSpans {
  if (content.length === 0) return {};
  const idx = indexLines(content);
  const consumed = new Uint8Array(content.length);
  const out: { [K in HighlightKind]?: HighlightSpan[] } = {};

  // Strings first (their interior must not be re-tokenized).
  const strings: HighlightSpan[] = [];
  for (const m of content.matchAll(stringRegex(lang))) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    pushSpans(strings, idx, start, end);
    markConsumed(consumed, start, end);
  }
  if (strings.length > 0) out.string = strings;

  // Then comments.
  const cRe = commentRegex(lang);
  if (cRe !== undefined) {
    const comments: HighlightSpan[] = [];
    for (const m of content.matchAll(cRe)) {
      const start = m.index ?? 0;
      if ((consumed[start] ?? 0) === 1) continue;
      const end = start + m[0].length;
      pushSpans(comments, idx, start, end);
      markConsumed(consumed, start, end);
    }
    if (comments.length > 0) out.comment = comments;
  }

  // Keywords on un-consumed regions.
  const keywords: HighlightSpan[] = [];
  for (const m of content.matchAll(keywordRegex(lang))) {
    const start = m.index ?? 0;
    if ((consumed[start] ?? 0) === 1) continue;
    pushSpans(keywords, idx, start, start + m[0].length);
  }
  if (keywords.length > 0) out.keyword = keywords;

  // Numbers.
  const numbers: HighlightSpan[] = [];
  for (const m of content.matchAll(NUMBER_RE)) {
    const start = m.index ?? 0;
    if ((consumed[start] ?? 0) === 1) continue;
    pushSpans(numbers, idx, start, start + m[0].length);
  }
  if (numbers.length > 0) out.number = numbers;

  // Function-call heuristic (lowercase ident followed by `(`).
  if (lang !== "json") {
    const fns: HighlightSpan[] = [];
    const keywordSet = new Set(KEYWORDS[lang]);
    for (const m of content.matchAll(FUNCTION_RE)) {
      const start = m.index ?? 0;
      if ((consumed[start] ?? 0) === 1) continue;
      const name = m[1] ?? "";
      if (keywordSet.has(name)) continue;
      pushSpans(fns, idx, start, start + name.length);
    }
    if (fns.length > 0) out.function = fns;

    // Type heuristic (PascalCase identifier).
    const types: HighlightSpan[] = [];
    for (const m of content.matchAll(TYPE_RE)) {
      const start = m.index ?? 0;
      if ((consumed[start] ?? 0) === 1) continue;
      const name = m[0];
      if (keywordSet.has(name)) continue;
      pushSpans(types, idx, start, start + name.length);
    }
    if (types.length > 0) out.type = types;
  }

  return out;
}
