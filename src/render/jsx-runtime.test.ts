import { describe, expect, test } from "bun:test";
import { Fragment, jsx, jsxs, renderToString, StaticHtml } from "./jsx-runtime.ts";

describe("jsx-runtime", () => {
  test("renders elements with escaped text and attributes", () => {
    expect(renderToString(jsx("div", { class: "row", children: "a<b>&" }))).toBe(
      '<div class="row">a&lt;b&gt;&amp;</div>',
    );
    expect(renderToString(jsx("span", { title: 'say "hi" & bye', children: "x" }))).toBe(
      '<span title="say &quot;hi&quot; &amp; bye">x</span>',
    );
  });

  test("single quotes pass through raw in attributes (Datastar expressions)", () => {
    expect(renderToString(jsx("div", { "data-signals": "{'a':1}", children: "" }))).toBe(
      `<div data-signals="{'a':1}"></div>`,
    );
  });

  test("script and style children are raw text (entities would corrupt code)", () => {
    expect(
      renderToString(
        jsx("script", { children: "var s=document.getElementById('x');if(a<b){c&d;}" }),
      ),
    ).toBe("<script>var s=document.getElementById('x');if(a<b){c&d;}</script>");
    expect(renderToString(jsx("div", { children: "a<b>&'\"" }))).toBe(
      "<div>a&lt;b&gt;&amp;&#39;&quot;</div>",
    );
  });

  test("void elements get no closing tag; false/null/undefined children vanish", () => {
    expect(renderToString(jsx("link", { rel: "stylesheet", href: "/s.css" }))).toBe(
      '<link rel="stylesheet" href="/s.css">',
    );
    expect(renderToString(jsx("div", { children: ["a", false, null, undefined, 0] }))).toBe(
      "<div>a0</div>",
    );
  });

  test("boolean attributes render bare; components and fragments compose", () => {
    const Chip = (props: { label: string; active?: boolean }) =>
      jsx("span", { class: "chip", "data-on": props.active, children: props.label });
    expect(renderToString(jsx(Chip, { label: "w", active: true }))).toBe(
      '<span class="chip" data-on>w</span>',
    );
    expect(
      renderToString(
        jsx(Fragment, { children: [jsx(Chip, { label: "a" }), jsx(Chip, { label: "b" })] }),
      ),
    ).toBe('<span class="chip">a</span><span class="chip">b</span>');
    expect(jsxs).toBe(jsx);
  });

  test("component returning a string is escaped, not injected", () => {
    const Evil = () => "<script>alert(1)</script>";
    expect(renderToString(jsx(Evil, {}))).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("StaticHtml emits verbatim (static script constants only)", () => {
    expect(renderToString(jsx(StaticHtml, { html: "<script>var a=1;</script>" }))).toBe(
      "<script>var a=1;</script>",
    );
  });
});
