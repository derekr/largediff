import { describe, expect, test } from "bun:test";
import type { InitialPaint } from "../session/projection.ts";
import { renderAppInner, renderShell } from "./shell.tsx";

const PAINT: InitialPaint = {
  diffHtml: "<section></section>",
  sidebarHtml: "",
  activeFileId: "f0",
  chrome: "github",
  scrollerScrollTop: 0,
  sidebarScrollTop: 0,
  rowsRendered: 0,
};

// Undo the attribute-level entity escaping the renderer applies, the same
// way the HTML parser would before Datastar reads the attribute value.
function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("sid escaping", () => {
  // sid is server-generated hex in production; these prove the sinks are
  // closed anyway, so a future caller passing user input can't inject.
  const HOSTILE_SID = `x"><script>alert(1)</script><b '`;

  test("renderAppInner escapes sid in the topbar <code> sink", () => {
    const html = renderAppInner({
      sid: HOSTILE_SID,
      totalHeight: 100,
      files: [],
      initial: PAINT,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("session <code>x&quot;&gt;&lt;script&gt;");
  });

  test("renderShell's data-signals attribute survives quotes in a string signal", () => {
    const html = renderShell(HOSTILE_SID, 100, [], PAINT);
    const m = /data-signals="([^"]*)"/.exec(html);
    expect(m).not.toBeNull();
    // The captured attribute value must round-trip: entity-decode (as the
    // HTML parser does) then JSON.parse must reproduce the hostile sid
    // intact instead of the attribute having terminated at the raw quote.
    const parsed = JSON.parse(decodeEntities(m?.[1] ?? ""));
    expect(parsed._sid).toBe(HOSTILE_SID);
    expect(parsed.chrome).toBe("github");
  });

  test("numeric command signals still ship as valid JSON", () => {
    const html = renderAppInner({
      sid: "abc123",
      totalHeight: 100,
      files: [],
      initial: PAINT,
      commands: { signals: { navEpoch: 7 }, cmdSeq: 3 },
    });
    const m = /id="cmd-3" data-signals="([^"]*)"/.exec(html);
    expect(m).not.toBeNull();
    expect(JSON.parse(decodeEntities(m?.[1] ?? ""))).toEqual({ navEpoch: 7 });
  });
});

describe("diagnostic scripts", () => {
  test("stream counter and tap ship only with ?trace=1", () => {
    const plain = renderShell("abc123", 100, [], PAINT);
    expect(plain).not.toContain("__streamOpens");
    expect(plain).not.toContain("__trace");
    const traced = renderShell("abc123", 100, [], PAINT, true);
    expect(traced).toContain("__streamOpens");
    expect(traced).toContain("window.__trace");
  });
});
