// Minimal JSX runtime: `jsx()` builds plain nodes, `renderToString`
// escapes and serializes them. No virtual DOM, no diffing, no framework —
// the server renders each push from scratch anyway, so JSX here is just
// typed function calls plus automatic escaping (the hand-rolled
// escapeHtml/escapeAttr it replaces kept its escaping rules at every
// call site; here they live in exactly one place).
//
// Wired via tsconfig `paths` (`react/jsx-runtime` -> this file) so the
// standard `"jsx": "react-jsx"` transform resolves with zero dependencies.

export interface JsxNode {
  type: string | JsxComponent;
  props: Record<string, unknown>;
}

// biome-ignore lint/suspicious/noExplicitAny: component props are intentionally open.
export type JsxComponent = (props: any) => JsxNode | string | null | undefined;

export function Fragment(props: { children?: JsxChild }): JsxNode {
  return { type: "__fragment", props };
}

// Verbatim HTML escape hatch, for the two static `<script>` constants in
// shell.ts (trace instrumentation) that predate JSX. Deliberately NOT a
// general innerHTML: the string is emitted unescaped, so this must only
// ever wrap module-scope constants, never interpolated data. Grep for
// StaticHtml if you want the complete list of raw-HTML sources.
export function StaticHtml(props: { html: string }): JsxNode {
  return { type: "__static", props };
}

export type JsxChild = JsxNode | string | number | boolean | null | undefined | JsxChild[];

export function jsx(type: JsxNode["type"], props: Record<string, unknown>): JsxNode {
  return { type, props: props ?? {} };
}

export const jsxs = jsx;

// Development transform entry: same semantics, extra validation args
// ignored (this runtime has no dev warnings to emit).
export function jsxDEV(type: JsxNode["type"], props: Record<string, unknown>): JsxNode {
  return jsx(type, props);
}

// Type namespace for the automatic transform: intrinsic elements accept
// any props (this runtime passes them straight through to attributes).
// Element is deliberately just JsxNode: every JSX expression in a .tsx
// file takes this type, so it must be assignable everywhere a rendered
// node flows (children, renderToString). Components that can render
// nothing return null at runtime — renderChild handles it; their return
// types are left inferred so no annotation fights the expression type.
export namespace JSX {
  export type Element = JsxNode;
  export interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
}

// Void elements must not get a closing tag — the browser would parse
// `<link>…</link>` children as body content.
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtmlValue(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

// Attribute values: single quotes are legal raw inside double-quoted
// attributes, so unlike text they are left alone — matching the old
// escapeAttr policy and keeping Datastar expressions (`$x === 'y'`) free
// of entity noise on the wire. `"` and `&` still escape: the former would
// terminate the attribute, the latter would corrupt on parse.
export function escapeAttrValue(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);
}

function renderProps(props: Record<string, unknown>): string {
  let out = "";
  for (const [key, value] of Object.entries(props)) {
    if (key === "children") continue;
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      out += ` ${key}`;
      continue;
    }
    out += ` ${key}="${escapeAttrValue(String(value))}"`;
  }
  return out;
}

function renderChild(child: JsxChild, rawText = false): string {
  if (child === null || child === undefined || child === false || child === true) return "";
  if (Array.isArray(child)) return child.map((c) => renderChild(c, rawText)).join("");
  if (typeof child === "object") return renderNode(child);
  return rawText ? String(child) : escapeHtmlValue(String(child));
}

function renderNode(node: JsxNode): string {
  if (typeof node.type === "function") {
    const rendered = node.type(node.props);
    if (rendered === null || rendered === undefined) return "";
    return typeof rendered === "object" ? renderNode(rendered) : escapeHtmlValue(rendered);
  }
  if (node.type === "__fragment") {
    return renderChild(node.props.children as JsxChild);
  }
  if (node.type === "__static") {
    return String((node.props as { html?: unknown }).html ?? "");
  }
  // `<script>` and `<style>` are raw-text elements: the HTML parser does
  // NOT decode entities inside them, so escaping their content would
  // corrupt the code (e.g. `&#39;` instead of `'`). Pass through verbatim —
  // by construction these only ever carry static constants.
  const rawText = node.type === "script" || node.type === "style";
  const { children } = node.props as { children?: JsxChild };
  const inner = renderChild(children, rawText);
  if (inner === "" && VOID_ELEMENTS.has(node.type)) {
    return `<${node.type}${renderProps(node.props)}>`;
  }
  return `<${node.type}${renderProps(node.props)}>${inner}</${node.type}>`;
}

export function renderToString(node: JsxNode | string): string {
  if (typeof node === "string") return escapeHtmlValue(node);
  return renderNode(node);
}
