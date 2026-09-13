// Editorial-style architecture brief, served at `/doc`. All HTML, CSS, and
// SVG are inline so the page is one self-contained response — no static
// assets to wrangle, no client JS to ship.

export function renderDoc(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>largediff · architecture brief</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <!--
      Preload the latin-subset woff2 files for each family directly so the
      browser doesn't have to wait until the Google Fonts CSS arrives and
      parses to discover them. These are versioned URLs (v24, v26 today);
      when Google bumps the version the preload will 404 but the actual
      font load still works via the stylesheet path below — so the worst
      case is a wasted preload request, never a visual regression.
    -->
    <link
      rel="preload"
      as="font"
      type="font/woff2"
      crossorigin
      href="https://fonts.gstatic.com/s/newsreader/v26/cY9AfjOCX1hbuyalUrK4397yjIJFJpc.woff2"
    />
    <link
      rel="preload"
      as="font"
      type="font/woff2"
      crossorigin
      href="https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2"
    />
    <!-- And kick off the CSS fetch early too. -->
    <link
      rel="preload"
      as="style"
      href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700&family=JetBrains+Mono:wght@400;500&display=swap"
    />
    <link
      href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600;6..72,700&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --bg: #0d1117;
        --panel: #11161d;
        --elevated: #161b22;
        --rule: #21262d;
        --rule-strong: #30363d;
        --fg: #e6edf3;
        --fg-strong: #f5f8fb;
        --muted: #8b949e;
        --muted-dim: #5b626c;
        --accent: #ffd86e;
        --accent-dim: #b59c4f;
        --accent-soft: rgba(255, 216, 110, 0.12);
        --add: #3fb950;
        --del: #f85149;
        --serif: "Newsreader", Charter, "Iowan Old Style", "Cambria",
          Georgia, serif;
        --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo,
          monospace;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
      }

      body {
        background: var(--bg);
        color: var(--fg);
        font-family: var(--serif);
        font-size: 18px;
        line-height: 1.55;
        font-feature-settings:
          "ss01",
          "kern",
          "liga";
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        overflow-x: hidden;
      }

      a {
        color: var(--fg-strong);
        text-decoration: underline;
        text-decoration-color: var(--accent-dim);
        text-underline-offset: 3px;
        text-decoration-thickness: 1px;
      }
      a:hover {
        text-decoration-color: var(--accent);
      }

      /* ---------- Top bar ---------- */
      .topbar {
        position: sticky;
        top: 0;
        z-index: 20;
        background: rgba(13, 17, 23, 0.85);
        backdrop-filter: saturate(160%) blur(12px);
        -webkit-backdrop-filter: saturate(160%) blur(12px);
        border-bottom: 1px solid var(--rule);
      }
      .topbar-inner {
        max-width: 1280px;
        margin: 0 auto;
        padding: 12px 32px;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 24px;
      }
      .topbar .brand {
        font-family: var(--mono);
        font-size: 13px;
        letter-spacing: 0.04em;
        color: var(--muted);
      }
      .topbar .brand strong {
        color: var(--fg-strong);
        font-weight: 500;
      }
      .topbar .links {
        display: flex;
        gap: 22px;
        font-family: var(--mono);
        font-size: 12.5px;
        letter-spacing: 0.04em;
        color: var(--muted);
      }
      .topbar .links a {
        color: var(--muted);
        text-decoration: none;
      }
      .topbar .links a:hover {
        color: var(--fg-strong);
      }

      /* ---------- Layout shells ---------- */
      .body-col {
        max-width: 720px;
        margin: 0 auto;
        padding: 0 28px;
      }
      .wide-col {
        max-width: 1080px;
        margin: 0 auto;
        padding: 0 28px;
      }

      section {
        padding-block: 96px;
        border-top: 1px solid var(--rule);
      }
      section:first-of-type {
        border-top: none;
      }
      section .eyebrow {
        font-family: var(--mono);
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent);
        margin: 0 0 22px 0;
      }
      section h2 {
        font-family: var(--serif);
        font-size: clamp(34px, 4.8vw, 56px);
        line-height: 1.06;
        font-weight: 500;
        letter-spacing: -0.018em;
        margin: 0 0 28px 0;
        color: var(--fg-strong);
        text-wrap: balance;
      }
      section p {
        margin: 0 0 18px 0;
        color: var(--fg);
      }
      section p.lede {
        font-size: 22px;
        line-height: 1.5;
        color: var(--fg);
      }
      section p:has(+ p) {
        margin-bottom: 18px;
      }
      .small {
        color: var(--muted);
        font-size: 14px;
      }
      code,
      .kbd {
        font-family: var(--mono);
      }
      p code,
      li code {
        background: var(--elevated);
        border: 1px solid var(--rule);
        border-radius: 4px;
        padding: 1.5px 6px;
        font-size: 0.86em;
        color: var(--fg-strong);
      }

      /* ---------- Hero ---------- */
      .hero {
        padding-block: 140px 110px;
        border-top: none;
        position: relative;
        overflow: hidden;
      }
      .hero::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          radial-gradient(
            ellipse at 18% -10%,
            rgba(255, 216, 110, 0.07),
            transparent 60%
          ),
          radial-gradient(
            ellipse at 88% 110%,
            rgba(63, 185, 80, 0.05),
            transparent 60%
          );
        pointer-events: none;
      }
      .hero .eyebrow {
        margin-bottom: 32px;
      }
      .hero h1 {
        font-family: var(--serif);
        font-size: clamp(48px, 7.6vw, 96px);
        font-weight: 500;
        line-height: 0.98;
        letter-spacing: -0.025em;
        margin: 0 0 36px 0;
        color: var(--fg-strong);
        text-wrap: balance;
        font-feature-settings:
          "ss01",
          "kern",
          "liga",
          "dlig";
      }
      .hero h1 em {
        font-style: italic;
        color: var(--accent);
        font-weight: 500;
      }
      .hero .subhead {
        font-size: 22px;
        line-height: 1.5;
        color: var(--muted);
        max-width: 640px;
      }
      .stat-strip {
        margin-top: 64px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0;
        border-top: 1px solid var(--rule);
        border-bottom: 1px solid var(--rule);
      }
      .stat {
        padding: 28px 22px;
        border-right: 1px solid var(--rule);
      }
      .stat:last-child {
        border-right: none;
      }
      .stat .num {
        font-family: var(--serif);
        font-size: clamp(34px, 3.6vw, 46px);
        line-height: 1.05;
        font-weight: 500;
        color: var(--fg-strong);
        letter-spacing: -0.015em;
        font-variant-numeric: tabular-nums;
      }
      .stat .num .unit {
        font-size: 0.55em;
        color: var(--muted);
        margin-left: 4px;
        font-weight: 500;
        letter-spacing: 0;
      }
      .stat .label {
        font-family: var(--mono);
        font-size: 11.5px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted);
        margin-top: 12px;
      }

      /* ---------- Pull quote ---------- */
      .pullquote {
        margin: 56px 0 0 0;
        padding-left: 24px;
        border-left: 2px solid var(--accent);
        font-style: italic;
        font-size: 22px;
        line-height: 1.5;
        color: var(--fg-strong);
        max-width: 620px;
      }

      /* ---------- Drop cap ---------- */
      .drop::first-letter {
        font-family: var(--serif);
        font-weight: 500;
        font-size: 4.1em;
        line-height: 0.86;
        float: left;
        padding: 4px 12px 0 0;
        color: var(--accent);
      }

      /* ---------- Diagram frame ---------- */
      .diagram {
        margin: 56px 0 12px 0;
        padding: 28px 24px 24px 24px;
        background: var(--panel);
        border: 1px solid var(--rule);
        border-radius: 10px;
        position: relative;
      }
      .diagram .caption {
        margin-top: 16px;
        font-family: var(--mono);
        font-size: 12.5px;
        color: var(--muted);
        letter-spacing: 0.02em;
        text-align: center;
      }
      .diagram svg {
        width: 100%;
        height: auto;
        display: block;
      }

      /* ---------- Hero diagram (the window) ---------- */
      .ribbon-mark {
        fill: var(--rule-strong);
      }
      .ribbon-mark.dim {
        fill: var(--rule);
      }
      .ribbon-mark.file-edge {
        fill: var(--muted-dim);
      }
      .scrolling-tape {
        animation: tape-scroll 14s linear infinite;
      }
      @keyframes tape-scroll {
        from {
          transform: translateY(0);
        }
        to {
          transform: translateY(-360px);
        }
      }
      .viewport-frame {
        fill: none;
        stroke: var(--accent);
        stroke-width: 1.2;
        filter: drop-shadow(0 0 16px rgba(255, 216, 110, 0.22));
      }
      .viewport-glow {
        fill: rgba(255, 216, 110, 0.04);
        stroke: none;
      }
      .rendered-row {
        fill: #1a2230;
        stroke: var(--rule-strong);
        stroke-width: 0.75;
      }
      .rendered-row.add {
        fill: rgba(63, 185, 80, 0.12);
        stroke: rgba(63, 185, 80, 0.35);
      }
      .rendered-row.del {
        fill: rgba(248, 81, 73, 0.1);
        stroke: rgba(248, 81, 73, 0.35);
      }
      .rendered-row.file-card {
        fill: #1d2632;
        stroke: var(--rule-strong);
      }
      .row-text {
        fill: var(--muted-dim);
      }
      .row-num {
        fill: var(--muted-dim);
        font-family: var(--mono);
        font-size: 9px;
      }
      .legend-line {
        stroke: var(--rule-strong);
        stroke-width: 1;
        stroke-dasharray: 3 4;
      }
      .legend-label {
        fill: var(--muted);
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.04em;
      }
      .legend-label.accent {
        fill: var(--accent);
      }
      .legend-label.strong {
        fill: var(--fg-strong);
      }
      .pulse-dot {
        fill: var(--accent);
      }
      .pulse-dot.echo {
        animation: pulse 2.4s ease-out infinite;
        transform-origin: center;
        transform-box: fill-box;
      }
      @keyframes pulse {
        0% {
          transform: scale(1);
          opacity: 0.9;
        }
        70% {
          transform: scale(3.4);
          opacity: 0;
        }
        100% {
          transform: scale(3.4);
          opacity: 0;
        }
      }

      /* ---------- CQRS diagram ---------- */
      .cqrs-frame {
        fill: var(--elevated);
        stroke: var(--rule-strong);
        stroke-width: 1;
      }
      .cqrs-title {
        fill: var(--fg-strong);
        font-family: var(--mono);
        font-size: 13px;
        letter-spacing: 0.04em;
      }
      .cqrs-sub {
        fill: var(--muted);
        font-family: var(--mono);
        font-size: 11px;
      }
      .cqrs-wire {
        stroke: var(--rule-strong);
        stroke-width: 1;
        fill: none;
      }
      .cqrs-wire.warm {
        stroke: var(--accent-dim);
        stroke-dasharray: 4 4;
      }
      .cqrs-arrow {
        fill: var(--muted);
      }
      .cqrs-arrow.warm {
        fill: var(--accent);
      }
      .cqrs-label {
        fill: var(--muted);
        font-family: var(--mono);
        font-size: 11.5px;
        letter-spacing: 0.04em;
      }
      .cqrs-label.warm {
        fill: var(--accent);
      }
      .packet {
        fill: var(--muted);
      }
      .packet.warm {
        fill: var(--accent);
      }
      .packet-out {
        animation: packet-go 4s ease-in-out infinite;
        animation-delay: 0s;
      }
      .packet-back {
        animation: packet-back 4s ease-in-out infinite;
        animation-delay: 1.5s;
      }
      @keyframes packet-go {
        0% {
          transform: translate(0, 0);
          opacity: 0;
        }
        8% {
          opacity: 1;
        }
        45% {
          transform: translate(380px, 0);
          opacity: 1;
        }
        60% {
          transform: translate(380px, 0);
          opacity: 0;
        }
        100% {
          transform: translate(380px, 0);
          opacity: 0;
        }
      }
      @keyframes packet-back {
        0% {
          transform: translate(0, 0);
          opacity: 0;
        }
        8% {
          opacity: 1;
        }
        55% {
          transform: translate(-380px, 0);
          opacity: 1;
        }
        70% {
          transform: translate(-380px, 0);
          opacity: 0;
        }
        100% {
          transform: translate(-380px, 0);
          opacity: 0;
        }
      }

      /* ---------- Numbers table ---------- */
      .numbers {
        margin-top: 48px;
        border: 1px solid var(--rule);
        border-radius: 10px;
        overflow: hidden;
        background: var(--panel);
      }
      .numbers-row {
        display: grid;
        grid-template-columns: 1fr 220px 140px;
        gap: 0;
        padding: 18px 24px;
        align-items: baseline;
        border-bottom: 1px solid var(--rule);
      }
      .numbers-row:last-child {
        border-bottom: none;
      }
      .numbers-row .metric {
        font-family: var(--serif);
        font-size: 18.5px;
        color: var(--fg);
      }
      .numbers-row .metric .note {
        display: block;
        font-size: 13px;
        color: var(--muted);
        margin-top: 4px;
        font-family: var(--mono);
        letter-spacing: 0.01em;
      }
      .numbers-row .value {
        font-family: var(--mono);
        font-size: 22px;
        color: var(--fg-strong);
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .numbers-row .value.win {
        color: var(--accent);
      }
      .numbers-row .delta {
        font-family: var(--mono);
        font-size: 13px;
        color: var(--add);
        text-align: right;
        letter-spacing: 0.04em;
      }

      /* ---------- Lesson cards ---------- */
      .lessons {
        margin-top: 48px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 18px;
      }
      .lesson {
        padding: 24px 22px 22px 22px;
        background: var(--panel);
        border: 1px solid var(--rule);
        border-radius: 10px;
        position: relative;
      }
      .lesson .index {
        font-family: var(--mono);
        font-size: 11.5px;
        color: var(--accent);
        letter-spacing: 0.16em;
      }
      .lesson h4 {
        margin: 10px 0 10px 0;
        font-family: var(--serif);
        font-size: 22px;
        line-height: 1.18;
        font-weight: 500;
        color: var(--fg-strong);
        letter-spacing: -0.01em;
      }
      .lesson p {
        margin: 0;
        font-size: 16px;
        line-height: 1.55;
        color: var(--muted);
      }
      .lesson p code {
        font-size: 13px;
        color: var(--fg);
      }

      /* ---------- Code chip ---------- */
      .codeblock {
        margin: 32px 0 0 0;
        padding: 22px 24px;
        background: var(--panel);
        border: 1px solid var(--rule);
        border-radius: 10px;
        font-family: var(--mono);
        font-size: 13.5px;
        line-height: 1.7;
        color: var(--fg);
        overflow-x: auto;
        white-space: pre;
      }
      .codeblock .c {
        color: var(--muted);
      }
      .codeblock .k {
        color: #ff7b72;
      }
      .codeblock .s {
        color: var(--accent);
      }
      .codeblock .n {
        color: var(--fg-strong);
      }

      /* ---------- Footer ---------- */
      footer {
        padding: 64px 0 96px 0;
        border-top: 1px solid var(--rule);
        font-family: var(--mono);
        font-size: 13px;
        color: var(--muted);
        text-align: center;
        letter-spacing: 0.02em;
      }
      footer .arrow {
        color: var(--accent);
      }

      /* ---------- Smaller screens ---------- */
      @media (max-width: 880px) {
        .stat-strip {
          grid-template-columns: repeat(2, 1fr);
        }
        .stat:nth-child(2) {
          border-right: none;
        }
        .stat:nth-child(1),
        .stat:nth-child(2) {
          border-bottom: 1px solid var(--rule);
        }
        .lessons {
          grid-template-columns: 1fr;
        }
        .numbers-row {
          grid-template-columns: 1fr 110px;
        }
        .numbers-row .delta {
          display: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .scrolling-tape,
        .packet-out,
        .packet-back,
        .pulse-dot.echo {
          animation: none !important;
        }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand"><strong>largediff</strong> &nbsp;·&nbsp; an architecture brief</div>
        <nav class="links">
          <a href="/">demo →</a>
        </nav>
      </div>
    </header>

    <main>
      <!-- ============================================================
           HERO
           ============================================================ -->
      <section class="hero">
        <div class="wide-col">
          <p class="eyebrow">An architecture brief · 2026</p>
          <h1>
            Reviewing a diff <em>the size&nbsp;of a small&nbsp;city.</em>
          </h1>
          <p class="subhead">
            largediff renders pull requests with a quarter&#8209;million
            lines of code without ever putting them in the browser. The
            trick isn't faster JavaScript&nbsp;— it's a backend that
            keeps the truth, and a wire that only carries what changes.
          </p>

          <div class="stat-strip" aria-label="Headline numbers">
            <div class="stat">
              <div class="num">200,000<span class="unit">lines</span></div>
              <div class="label">in the demo diff</div>
            </div>
            <div class="stat">
              <div class="num">5.3<span class="unit">k nodes</span></div>
              <div class="label">live DOM, any scroll</div>
            </div>
            <div class="stat">
              <div class="num">1.7<span class="unit">KB</span></div>
              <div class="label">wire bytes per push</div>
            </div>
            <div class="stat">
              <div class="num">34<span class="unit">ms</span></div>
              <div class="label">largest contentful paint</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============================================================
           THE PREMISE
           ============================================================ -->
      <section>
        <div class="body-col">
          <p class="eyebrow">The premise</p>
          <h2>Most rich UIs ship the data to the user. We don't.</h2>
          <p class="drop">
            The browser is an excellent renderer and a hostile state
            store. The instant a diff with two hundred thousand lines
            lands as a JSON blob, you've shipped twenty megabytes,
            spent thirty seconds parsing it, and handed the page to a
            framework that now has to re&#8209;render the universe
            every time the user scrolls.
          </p>
          <p>
            largediff inverts that. The backend is the single source of
            truth&nbsp;— it owns the diff, the parse tree, the
            collapse state, the highlight ranges. The frontend is a
            projection: a few signals, a couple thousand DOM nodes, no
            parsers, no virtual&#8209;DOM accountant. When something
            changes on the server, a short SSE message lands and the
            page morphs.
          </p>
          <div class="pullquote">
            The page isn't an app that fetches data. It's a long, live
            view onto a diff that lives somewhere else.
          </div>
        </div>
      </section>

      <!-- ============================================================
           THE WINDOW (hero diagram)
           ============================================================ -->
      <section>
        <div class="wide-col">
          <p class="eyebrow">The window</p>
          <h2>The browser holds a couple of files. The server holds the rest.</h2>
          <div class="body-col" style="padding: 0">
            <p>
              Every row in the diff has an absolute pixel position the
              moment the file list is known&nbsp;— a flat
              <code>pixelOffsets[]</code> array on the server. The
              scroller's height is set to the tape's total, and exactly
              the <em>files</em> whose pixels currently intersect the
              viewport get rendered into the DOM as
              <code>&lt;section data-file&gt;</code> subtrees. Scroll,
              and the server picks a new file range. Sections leaving
              the window come out by id; arriving ones go in by id; the
              sections in the middle never move.
            </p>
            <p style="color:var(--muted);font-size:14.5px;margin-top:8px">
              An earlier draft of this page sliced row&#8209;by&#8209;row
              and proudly reported <strong>76 live rows</strong> in the
              DOM. The number was real but the architecture was
              brittle: every scroll re&#8209;stamped <code>top:Npx</code>
              on every row, sticky chrome handoffs needed JavaScript,
              and the morph payload was a flat sea of identical&#8209;looking
              <code>&lt;div&gt;</code>s. File&#8209;windowed sections
              cost a few hundred extra rows in the live DOM and bought
              back: pure&#8209;CSS sticky, atomic jumps, and a morph
              that's byte&#8209;identical when you scroll within a
              file&nbsp;— so most scrolls send zero patches.
            </p>
          </div>

          <div class="diagram" aria-label="Virtualization diagram">
            <svg viewBox="0 0 1024 540" role="img">
              <defs>
                <clipPath id="tape-clip">
                  <rect x="412" y="60" width="120" height="440" rx="4" />
                </clipPath>
                <linearGradient id="tape-fade" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stop-color="#0d1117" stop-opacity="1" />
                  <stop offset="12%" stop-color="#0d1117" stop-opacity="0" />
                  <stop offset="88%" stop-color="#0d1117" stop-opacity="0" />
                  <stop offset="100%" stop-color="#0d1117" stop-opacity="1" />
                </linearGradient>
              </defs>

              <!-- Left column: the abstract "full diff" label ----------- -->
              <g transform="translate(40, 60)">
                <text class="legend-label" x="0" y="0">THE BACKING TAPE</text>
                <text class="legend-label strong" x="0" y="22" style="font-size:14px">
                  200,000 rows · 500 files
                </text>
                <text class="legend-label" x="0" y="44" style="font-size:11px">
                  pixelOffsets[] — flat array
                </text>
                <text class="legend-label" x="0" y="62" style="font-size:11px">
                  rowAtPixel(y) — binary search
                </text>

                <!-- guide line from label to ribbon -->
                <line class="legend-line" x1="160" y1="44" x2="375" y2="200" />
              </g>

              <!-- The ribbon (clipped, animated) ----------------------- -->
              <g clip-path="url(#tape-clip)">
                <g class="scrolling-tape">
                  ${ribbonMarks(412, 60, 120, 800)}
                </g>
              </g>

              <!-- Tape fade overlay at top and bottom -->
              <rect x="412" y="60" width="120" height="440" fill="url(#tape-fade)" pointer-events="none" />

              <!-- The viewport frame (fixed) --------------------------- -->
              <g transform="translate(548, 196)">
                <rect class="viewport-glow" x="-8" y="-8" width="356" height="178" rx="6" />
                <rect class="viewport-frame" x="0" y="0" width="340" height="162" rx="4" />

                <!-- Rendered rows inside the viewport -->
                <g transform="translate(0, 0)">
                  <!-- file-card-header -->
                  <rect class="rendered-row file-card" x="6" y="6" width="328" height="22" rx="3" />
                  <text class="row-text" x="14" y="20.5" style="font-family:var(--mono);font-size:11px;fill:var(--fg-strong)">▾ app/registry.py</text>

                  <!-- hunk header -->
                  <rect class="rendered-row" x="6" y="32" width="328" height="16" rx="2" />
                  <text class="row-num" x="14" y="43">@@ hunk 3 @@</text>

                  <!-- diff lines -->
                  <rect class="rendered-row" x="6" y="52" width="328" height="14" rx="2" />
                  <text class="row-num" x="14" y="62.5">128</text>
                  <line x1="38" y1="59" x2="320" y2="59" stroke="var(--muted-dim)" stroke-width="0.7" />

                  <rect class="rendered-row add" x="6" y="68" width="328" height="14" rx="2" />
                  <text class="row-num" x="14" y="78.5">129</text>
                  <line x1="38" y1="75" x2="280" y2="75" stroke="rgba(63,185,80,0.55)" stroke-width="0.9" />

                  <rect class="rendered-row add" x="6" y="84" width="328" height="14" rx="2" />
                  <text class="row-num" x="14" y="94.5">130</text>
                  <line x1="38" y1="91" x2="240" y2="91" stroke="rgba(63,185,80,0.55)" stroke-width="0.9" />

                  <rect class="rendered-row del" x="6" y="100" width="328" height="14" rx="2" />
                  <text class="row-num" x="14" y="110.5">131</text>
                  <line x1="38" y1="107" x2="260" y2="107" stroke="rgba(248,81,73,0.55)" stroke-width="0.9" />

                  <rect class="rendered-row" x="6" y="116" width="328" height="14" rx="2" />
                  <text class="row-num" x="14" y="126.5">132</text>
                  <line x1="38" y1="123" x2="300" y2="123" stroke="var(--muted-dim)" stroke-width="0.7" />

                  <rect class="rendered-row" x="6" y="132" width="328" height="14" rx="2" />
                  <text class="row-num" x="14" y="142.5">133</text>
                  <line x1="38" y1="139" x2="200" y2="139" stroke="var(--muted-dim)" stroke-width="0.7" />
                </g>

                <!-- viewport label -->
                <g transform="translate(0, 178)">
                  <circle class="pulse-dot" cx="6" cy="6" r="3" />
                  <circle class="pulse-dot echo" cx="6" cy="6" r="3" />
                  <text class="legend-label accent" x="16" y="9.5">
                    LIVE DOM · 2 file sections
                  </text>
                </g>

                <!-- arrow to viewport from above -->
                <text class="legend-label accent" x="248" y="-12">VIEWPORT</text>
              </g>

              <!-- Right column: arrows + commentary -->
              <g transform="translate(920, 260)">
                <line class="legend-line" x1="0" y1="0" x2="-20" y2="0" />
                <text class="legend-label strong" x="-12" y="-8" text-anchor="end">
                  the slice the browser sees
                </text>
                <text class="legend-label" x="-12" y="14" text-anchor="end">
                  fat morph · stable ids
                </text>
              </g>

              <!-- Bottom commentary -->
              <g transform="translate(412, 524)">
                <text class="legend-label" x="0" y="0" style="font-size:11px">
                  scrolls 1px → server re-slices the window → SSE pushes a patch
                </text>
              </g>
            </svg>
            <div class="caption">
              The tape never ships. The window does.
            </div>
          </div>

          <div class="body-col" style="padding: 24px 0 0 0">
            <p>
              At any scroll position, the live DOM under
              <code>#ds-window</code> holds about two file sections —
              the one the viewport is parked in, plus its nearest
              neighbour caught in the overscan buffer. The other 498
              files exist only as offsets in a
              <code>Uint32Array</code> on the server. Scrolling to file
              one hundred and ninety costs the same as scrolling to
              file ten&nbsp;— a binary search, a slice, a
              brotli&#8209;flushed SSE frame. And when the slice
              fingerprint hasn't changed (the common case for
              within&#8209;file scrolls of an inline file), the server
              sends nothing at all.
            </p>
          </div>
        </div>
      </section>

      <!-- ============================================================
           THE PIPE (CQRS / SSE diagram)
           ============================================================ -->
      <section>
        <div class="wide-col">
          <p class="eyebrow">The pipe</p>
          <h2>One stream stays warm. Everything else is a 204.</h2>
          <div class="body-col" style="padding: 0">
            <p>
              The browser opens a single long&#8209;lived
              <code>GET&nbsp;/sessions/:sid/stream</code> and never
              closes it. Every interaction — scroll, jump, collapse,
              toggle — is a tiny POST that returns
              <code>204&nbsp;No&nbsp;Content</code>. The actual
              response flows down the open stream as an
              already&#8209;compressed brotli frame. The brotli
              encoder is kept warm per session, so each subsequent
              push compresses against a shared dictionary of prior
              frames. After thirty pushes, the average
              wire&nbsp;cost is <strong>~1.7&nbsp;KB</strong> for
              ~22&nbsp;KB of decoded HTML and JSON.
            </p>
          </div>

          <div class="diagram" aria-label="CQRS over SSE diagram">
            <svg viewBox="0 0 900 320" role="img">
              <!-- Browser box -->
              <g transform="translate(40, 60)">
                <rect class="cqrs-frame" x="0" y="0" width="200" height="200" rx="8" />
                <text class="cqrs-title" x="18" y="32">BROWSER</text>
                <text class="cqrs-sub" x="18" y="54">datastar · signals</text>
                <text class="cqrs-sub" x="18" y="72">per-token spans</text>

                <!-- Mini DOM rows -->
                <g transform="translate(18, 96)">
                  <rect width="164" height="9" rx="2" fill="var(--rule-strong)" />
                  <rect y="14" width="140" height="9" rx="2" fill="var(--rule-strong)" />
                  <rect y="28" width="156" height="9" rx="2" fill="rgba(63,185,80,0.35)" />
                  <rect y="42" width="124" height="9" rx="2" fill="rgba(248,81,73,0.35)" />
                  <rect y="56" width="148" height="9" rx="2" fill="var(--rule-strong)" />
                  <rect y="70" width="132" height="9" rx="2" fill="var(--rule-strong)" />
                  <rect y="84" width="120" height="9" rx="2" fill="var(--rule-strong)" />
                </g>
              </g>

              <!-- Server box -->
              <g transform="translate(660, 60)">
                <rect class="cqrs-frame" x="0" y="0" width="200" height="200" rx="8" />
                <text class="cqrs-title" x="18" y="32">SERVER</text>
                <text class="cqrs-sub" x="18" y="54">Bun.serve · brotli (warm)</text>
                <text class="cqrs-sub" x="18" y="72">diff engine · tokenizer</text>

                <!-- session diagram -->
                <g transform="translate(18, 96)">
                  <rect width="164" height="92" rx="6" fill="none" stroke="var(--rule-strong)" stroke-dasharray="3 3" />
                  <text class="cqrs-sub" x="10" y="20" style="fill:var(--muted-dim);font-size:10px">REVIEWSESSION</text>
                  <rect x="10" y="30" width="100" height="6" rx="2" fill="var(--accent-dim)" opacity="0.6" />
                  <rect x="10" y="42" width="80" height="6" rx="2" fill="var(--accent-dim)" opacity="0.4" />
                  <rect x="10" y="54" width="120" height="6" rx="2" fill="var(--accent-dim)" opacity="0.4" />
                  <text class="cqrs-sub" x="10" y="80" style="fill:var(--muted-dim);font-size:9.5px">{ view, settings }</text>
                </g>
              </g>

              <!-- Top wire: command (cold, fire-and-forget) -->
              <g>
                <text class="cqrs-label" x="450" y="98" text-anchor="middle">POST /view · 204 No Content</text>
                <line class="cqrs-wire" x1="248" y1="120" x2="660" y2="120" />
                <polygon class="cqrs-arrow" points="654,116 654,124 664,120" />

                <!-- traveling packet -->
                <circle class="packet packet-out" cx="252" cy="120" r="4" />
              </g>

              <!-- Bottom wire: SSE projection (warm) -->
              <g>
                <text class="cqrs-label warm" x="450" y="220" text-anchor="middle">SSE · brotli patch · &lt;2 KB</text>
                <line class="cqrs-wire warm" x1="248" y1="200" x2="660" y2="200" />
                <polygon class="cqrs-arrow warm" points="256,196 256,204 246,200" />

                <!-- traveling packet -->
                <circle class="packet warm packet-back" cx="656" cy="200" r="4" />
              </g>

              <!-- Cycle label -->
              <text class="cqrs-label" x="450" y="288" text-anchor="middle" style="font-size:11px;fill:var(--muted-dim)">
                fire commands · let the stream answer
              </text>
            </svg>
            <div class="caption">
              Commands and queries don't share a request. They share a session.
            </div>
          </div>

          <div class="body-col" style="padding: 24px 0 0 0">
            <p>
              The separation matters. A scroll command and an SSE
              response are no longer racing each other for one HTTP
              cycle; the response is whatever the next projection
              happens to be, with whatever batched state changes
              landed in between. <em>Coalescing</em> is built in.
            </p>
          </div>
        </div>
      </section>

      <!-- ============================================================
           THE FAT MORPH
           ============================================================ -->
      <section>
        <div class="body-col">
          <p class="eyebrow">The fat morph</p>
          <h2>One render path. One payload. The whole UI, every push.</h2>
          <p>
            For most of the project's life the wire carried three
            kinds of events per push: a morph for the diff window,
            a signals patch for active-file metadata and imperative
            scrolls, and a second morph for the sidebar slice. Each
            had its own emit gate, its own skip&#8209;when&#8209;unchanged
            fingerprint, and its own contract with the client. It was
            efficient on the wire. It was also a steady source of
            bugs the moment you stopped staring at it.
          </p>
          <p>
            The version live today replaces those three events with
            <em>one</em>:
          </p>
          <pre class="codeblock"><span class="c">// every command handler ends here</span>
writer.<span class="n">send</span>(<span class="s">"datastar-patch-elements"</span>, [
  <span class="s">"selector #app"</span>,
  <span class="s">"mode inner"</span>,
  ...<span class="n">renderAppInner</span>(session, deps).<span class="n">split</span>(<span class="s">"\n"</span>)
    .<span class="n">map</span>(line =&gt; <span class="s">"elements "</span> + line),
].<span class="n">join</span>(<span class="s">"\n"</span>));</pre>
          <p>
            Every push re&#8209;renders the entire content tree from
            session state. The browser receives the whole inner HTML
            of <code>#app</code> — topbar, sidebar, scroller, and
            every visible row — and Idiomorph reconciles it against
            the live DOM. Stable ids
            (<code>#scroller</code>, <code>#ds-window</code>,
            <code>#file-tree</code>, <code>#layout</code>,
            <code>#topbar</code>, plus
            <code>#f-&lt;fid&gt;</code> per section and
            <code>#file-row-&lt;fid&gt;</code> per row) let the morph
            match in place; scroll position, focus, and one&#8209;shot
            <code>data-init</code> survive across pushes.
          </p>
          <p>
            Imperative actions — scroll to a file, scroll to the top,
            recenter the sidebar — can't be expressed as DOM changes;
            they have to call <code>scrollTo</code>. They ride
            <em>inside</em> the morph as a transient command element:
          </p>
          <pre class="codeblock"><span class="c">// first child of #app's inner morph, only when needed</span>
&lt;<span class="k">div</span> <span class="n">id</span>=<span class="s">"cmd-42"</span>
     <span class="n">data-signals</span>=<span class="s">'{"navEpoch":3}'</span>
     <span class="n">data-init</span>=<span class="s">"window.__largediffJump?.(2007388)"</span>&gt;
&lt;/<span class="k">div</span>&gt;</pre>
          <p>
            The id carries a monotonic counter (<code>cmdSeq</code>)
            that bumps on every push that needs to fire imperatives,
            so Idiomorph treats the element as new and Datastar
            re&#8209;runs both plugins.
            <code>data-init</code> calls the scroll function directly
            — no signal gate, so a target pixel of 0 (back to top,
            cmd+Up) works the same as any other value.
            <code>data-signals</code> carries
            <code>navEpoch</code> back to the client so the next
            <code>/view</code> POST echoes the current epoch and the
            server can drop stale scroll events from the prior
            position.
          </p>

          <h3 style="font-size:1.05rem; font-weight:500; margin-top:32px">
            A class of bugs disappeared with the third event.
          </h3>
          <p>
            The split protocol had at least four failure modes you
            could only see at the seams:
          </p>
          <ul style="padding-left: 20px; line-height: 1.7">
            <li>
              <strong>State drift between fingerprints.</strong>
              Moving the active class from one sidebar row to
              another doesn't change the rendered HTML's byte
              length, so a length&#8209;keyed fingerprint silently
              treated it as unchanged. The sidebar's morph got
              skipped, the highlight stuck to the old row, and the
              user blamed Datastar. With one fingerprint that
              includes <code>activeFileId</code>, this can't
              happen.
            </li>
            <li>
              <strong>The imperative&#8209;signal&#8209;can't&#8209;be&#8209;zero
              trap.</strong> A
              <code>data-effect="$jumpToPx&nbsp;&gt;&nbsp;0"</code>
              gate can't carry <code>jumpToPx&nbsp;=&nbsp;0</code> as
              a target. Back&#8209;to&#8209;top, cmd+Up, and any
              <code>/jump</code> to file&nbsp;0 had to be
              special&#8209;cased. With <code>data-init</code>
              firing on a fresh&#8209;id element, there is no gate;
              the expression just runs.
            </li>
            <li>
              <strong>Sequencing across events.</strong> Diff morph
              → signals → sidebar morph means the client sees three
              intermediate DOM states per push. Idiomorph applies
              each event in its own task, and the browser can paint
              between them. Users sometimes saw the sidebar update
              before the diff caught up, or scroll happen before the
              target section was mounted. One morph applies the
              entire next state atomically.
            </li>
            <li>
              <strong>Routing every new feature.</strong> Adding a
              new piece of state — "show file count," "swap a
              chrome mode," "mark a file reviewed" — meant deciding
              which event carries it. Sometimes the answer was
              "two of them." Now the answer is always: change the
              session state, the next morph carries the difference.
            </li>
          </ul>

          <p>
            The UI is a pure function of session state. There is no
            way to make the rendered tree disagree with the server's
            model, because there is nowhere else for it to come from.
            <em>Immediate&#8209;mode rendering with a single
            projection</em> — same pattern a game loop uses to
            redraw the frame from world state, retargeted at a DOM.
          </p>

          <h3 style="font-size:1.05rem; font-weight:500; margin-top:32px">
            The trade-off, and why it stopped hurting.
          </h3>
          <p>
            The cost is real: every push ships the entire
            <code>#app</code> inner instead of just the slice that
            changed. The wire eats it without complaint — a warm
            brotli encoder per session compresses against the prior
            frame's dictionary, so the topbar, the sticky chrome,
            and the unchanged sidebar rows cost almost nothing per
            push. The topbar's "wire" chip shows the running ratio;
            on a typical session it sits around 94&nbsp;% saved.
          </p>
          <p>
            The harder cost was on the client side. We measured it.
            It wasn't the wire; it was the browser's style work on
            the ~3,000 token spans of any newly&#8209;mounted file
            section. Re&#8209;enabling
            <code>content-visibility:&nbsp;auto</code> on
            <code>.file-section</code> deferred the per&#8209;span
            style work to the moment a section enters the viewport,
            and the scroll&#8209;time style recalc dropped from
            <strong>~95&nbsp;ms per push</strong> to
            <strong>not flagged by the trace at all</strong>. The
            forced reflow inside Datastar's morph went the same way
            — 395&nbsp;ms aggregated over five scrolls is now zero
            in Chrome's performance insights.
          </p>
          <p>
            Larger payload, smaller mental model, equal latency. The
            architecture trades a thing the server is good at
            (rendering bytes) for a thing programmers are bad at
            (keeping three concurrent views of state in sync).
          </p>
        </div>
      </section>

      <!-- ============================================================
           SYNTAX HIGHLIGHTING — THE ROUND TRIP
           ============================================================ -->
      <section>
        <div class="body-col">
          <p class="eyebrow">Tokens in the DOM</p>
          <h2>Tokens render where the spec wants them: in the DOM.</h2>
          <p>
            The first version of largediff tried to be clever about
            syntax highlighting. Per&#8209;token
            <code>&lt;span&gt;</code>s are the classic place a diff
            view collapses, so we kept row text as a plain text node
            and used the
            <a href="https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API"
              >CSS Custom Highlight API</a> instead. The server
            shipped <code>[fileId, lineIdx, startCol, endCol]</code>
            tuples; the client built one <code>Highlight</code> per
            kind and registered it with
            <code>CSS.highlights.set("ds-keyword", …)</code>. Six
            kinds, ~1,500 ranges, no <code>&lt;span&gt;</code>
            allocation. In Blink it ran in about two milliseconds.
          </p>
          <p>
            In WebKit it stalled the paint pipeline for
            <strong>200–800&nbsp;ms</strong> after every jump.
          </p>
          <p>
            The engines implement the API differently. Reading the
            WebKit source,
            <code>Highlight::repaintRange()</code> walks each node a
            range intersects and calls <code>repaint()</code> per
            renderer; Blink batches the same work in its PrePaint
            pass. With ~1,500 ranges per push, the per-renderer
            walk adds up. It's a reasonable difference between two
            engines; it's just not a difference we can paper over
            from userland.
          </p>
          <p>
            Looking at production: Monaco, CodeMirror 6, GitHub's PR
            diff view, Sourcegraph, Zed — none use
            <code>CSS.highlights</code> for syntax tokens. They all
            use per&#8209;token spans (or, in Zed's case, GPU
            glyphs). The API is designed for cross&#8209;token
            annotations like find-in-page hits and blame ribbons,
            not for token coloring at scale. We were choosing a path
            that nobody who renders code at scale chooses.
          </p>
          <p>
            So now we render what everyone else renders. The morph
            payload carries the spans inline:
          </p>

          <div class="codeblock"><span class="c">// files.ts — what the server emits inside each row's .text span</span>
<span class="k">&lt;span class=</span><span class="s">"text"</span><span class="k">&gt;</span>
  <span class="k">&lt;span class=</span><span class="s">"kw"</span><span class="k">&gt;</span>const<span class="k">&lt;/span&gt;</span> <span class="k">&lt;span class=</span><span class="s">"fn"</span><span class="k">&gt;</span>parse<span class="k">&lt;/span&gt;</span> = (<span class="k">&lt;span class=</span><span class="s">"typ"</span><span class="k">&gt;</span>input<span class="k">&lt;/span&gt;</span>: <span class="k">&lt;span class=</span><span class="s">"typ"</span><span class="k">&gt;</span>string<span class="k">&lt;/span&gt;</span>) =&gt; {
<span class="k">&lt;/span&gt;</span></div>
          <p style="margin-top:24px">
            Class names compress beautifully under brotli (the
            dictionary picks them up on the second push), the wire
            cost ends up similar to the CSS-Highlight version, and
            both engines paint the page the same way because we're
            letting the browser do what it already does well: text
            rendering. The 200–800 ms post-jump stall is gone.
          </p>
        </div>
      </section>

      <!-- ============================================================
           BY THE NUMBERS
           ============================================================ -->
      <section>
        <div class="wide-col">
          <p class="eyebrow">By the numbers</p>
          <h2>What it actually costs to render the impossible.</h2>
          <div class="body-col" style="padding: 0">
            <p>
              Profiled against the demo seed&nbsp;— five hundred files,
              two hundred thousand lines, GitHub&#8209;style chrome.
              Measurements come from Chrome DevTools performance
              traces taken through the DevTools MCP, and from
              <code>performance.now()</code> checkpoints the client
              forwards over a diagnostic <code>POST&nbsp;/log</code>
              endpoint so Safari and Chrome can be measured
              side&#8209;by&#8209;side.
            </p>
          </div>

          <div class="numbers">
            <div class="numbers-row">
              <div class="metric">
                Largest Contentful Paint
                <span class="note">cold load, populated diff</span>
              </div>
              <div class="value win">34 ms</div>
              <div class="delta">desktop</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Cumulative Layout Shift
                <span class="note">across the first 10s of session life</span>
              </div>
              <div class="value win">0.00</div>
              <div class="delta">from 7.72 in v0</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Wire bytes per push
                <span class="note">warm brotli, average over 30 scrolls</span>
              </div>
              <div class="value">~1.7 KB</div>
              <div class="delta">~0 KB when slice unchanged</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Total DOM elements
                <span class="note">populated page, any scroll</span>
              </div>
              <div class="value">~5,290</div>
              <div class="delta">↓ from 7,814</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Client state for the sidebar
                <span class="note">file metadata embedded in the page</span>
              </div>
              <div class="value win">0 bytes</div>
              <div class="delta">↓ from 50 kB JSON blob</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Forced reflow on jump
                <span class="note">click → first paint of new file region</span>
              </div>
              <div class="value">~118 ms</div>
              <div class="delta">↓ from ~211 ms</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Click → first paint after jump
                <span class="note">sidebar click to scrolled content visible</span>
              </div>
              <div class="value">~50 ms</div>
              <div class="delta">Chrome &amp; Safari</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Style recalc per scroll-driven morph
                <span class="note">previously 3K&#8211;4K elements</span>
              </div>
              <div class="value win">~0 ms</div>
              <div class="delta">↓ from ~95 ms · content&#8209;visibility</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Forced reflow over 5 scrolls
                <span class="note">aggregate over a wheel fling</span>
              </div>
              <div class="value win">not flagged</div>
              <div class="delta">↓ from ~395 ms</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                SSE events per push
                <span class="note">previously diff morph + signals + sidebar morph</span>
              </div>
              <div class="value win">1</div>
              <div class="delta">↓ from 3 · fat morph</div>
            </div>
            <div class="numbers-row">
              <div class="metric">
                Sidebar IntersectionObservers
                <span class="note">previously one per file row</span>
              </div>
              <div class="value win">0</div>
              <div class="delta">↓ from 500</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============================================================
           THE ARC — the optimization story
           ============================================================ -->
      <section>
        <div class="wide-col">
          <p class="eyebrow">The arc</p>
          <h2>Nine corrections, in the order they hurt.</h2>
          <div class="body-col" style="padding: 0">
            <p>
              None of the architecture above arrived in one draft.
              Each move below started as a measurement that didn't
              match the intuition.
            </p>
          </div>

          <div class="lessons">
            <div class="lesson">
              <div class="index">01 · Sections, not rows</div>
              <h4>Per-row pixel windowing made every scroll re-stamp
                <code>top:Npx</code> on every row.</h4>
              <p>
                Sticky chrome handoffs needed JavaScript, jumps had a
                race between the morph and the scrollTo, and the
                morph payload was a flat sea of identical
                <code>&lt;div&gt;</code>s. Switching to per-file
                <code>&lt;section&gt;</code>s with
                <code>position:&nbsp;sticky</code> chrome cost a few
                hundred extra rows in the live DOM, but bought:
                pure-CSS sticky handoff, atomic jumps, and a morph
                that's byte-identical for in-file scrolls. Most
                scrolls now send zero patches.
              </p>
            </div>
            <div class="lesson">
              <div class="index">02 · scrollend</div>
              <h4>Datastar's <code>__throttle</code> is leading-edge
                only. The trailing position can vanish.</h4>
              <p>
                A scrollbar drag followed by a release sometimes left
                the viewport on a y where no section was mounted —
                the final scroll never triggered a
                <code>/view</code> POST because the throttle window
                was still open. The fix was two extra words in the
                shell:
                <code>data-on:scrollend="…"</code>, which fires once
                after the scroll settles and always carries the final
                position to the server.
              </p>
            </div>
            <div class="lesson">
              <div class="index">03 · The pixel signal</div>
              <h4>Sticky <code>scrollIntoView</code> is a coin flip.</h4>
              <p>
                Anchoring a jump to a sticky <code>.file-card-header</code>
                worked in Chrome and intermittently mis-landed in
                Safari by 30 to 70 pixels — the engine sometimes
                computed the chrome's natural position before laying
                out the just-mounted section. We replaced the anchor
                with a <code>jumpToPx</code> signal: the server
                already knows the exact pixel, so it pushes a number
                and a body-level <code>data-effect</code> calls
                <code>scroller.scrollTo({top: $jumpToPx})</code>.
                Element position never enters the equation.
              </p>
            </div>
            <div class="lesson">
              <div class="index">04 · Tokens in the DOM</div>
              <h4>The CSS Custom Highlight API isn't built for
                per-token coloring at scale.</h4>
              <p>
                Detailed in the section above. We replaced the API
                with per-token <code>&lt;span&gt;</code>s in the
                morph payload — what every production code surface
                (Monaco, CodeMirror, GitHub, Sourcegraph) actually
                uses. The wire cost barely moved (brotli eats the
                class names) and the post-jump stall went from
                200–800&nbsp;ms to zero in WebKit.
              </p>
            </div>
            <div class="lesson">
              <div class="index">05 · The crowded sidebar</div>
              <h4>500 file rows in the DOM. 500 IntersectionObservers.</h4>
              <p>
                A performance trace flagged the sidebar as the largest
                single subtree on the page — the file tree mounted
                every row up front and attached an
                <code>IntersectionObserver</code> per row for
                hover&#8209;prewarm. We virtualized: the server emits
                file metadata as a JSON blob, the client mounts ~25
                rows in the visible window, and prewarm fires once
                per row at mount time. DOM dropped from 7,814 to
                5,290 elements. Cold LCP improved from 65 ms to
                57 ms.
              </p>
            </div>
            <div class="lesson">
              <div class="index">06 · The sidebar joins the server</div>
              <h4>The client virtualizer was an outlier in an
                otherwise server-driven architecture.</h4>
              <p>
                The first virtualizer shipped all file metadata as a
                ~50&nbsp;kB JSON blob to the browser and reimplemented
                the file-window pattern client-side. It worked, but it
                violated the project principle that state lives on the
                server. It also had a subtle mobile bug: each scroll
                re-rendered the row subtree with
                <code>innerHTML</code>, so a tap that landed during a
                small momentum scroll could be delivered on a
                replaced DOM node. We moved the sidebar onto the same
                shape as the diff window: <code>POST /sidebar</code>
                ships scroll telemetry, <code>pushProjection</code>
                emits a slice morph onto
                <code>#file-tree&nbsp;.file-rows</code>, the active
                class is server-baked, and stable
                <code>id="file-row-{fid}"</code>s let Idiomorph
                preserve DOM identity across morphs. Drawer-open
                re-centering became another small command:
                <code>POST /sidebar/recenter</code> sets the server's
                <code>sidebarScrollTop</code> to put the active file
                at the list's upper third, and a
                <code>sidebarJumpToPx</code> signal moves the
                client's scroll position to match. Cold LCP dropped
                another 23&nbsp;ms (page no longer carries the JSON);
                jump-time forced reflow dropped from ~211 ms to
                ~118 ms (no client-side sidebar follow-up).
              </p>
            </div>
            <div class="lesson">
              <div class="index">07 · The fat morph</div>
              <h4>Three SSE event types, three skip-when-unchanged
                fingerprints, three places to plumb a new feature.</h4>
              <p>
                The split protocol — <code>#ds-window</code> morph,
                signals patch, <code>#file-tree .file-rows</code>
                morph — earned its keep when each piece had different
                cadence and cost. It also meant every new feature was
                a routing decision (which event carries this?), and
                the per-area fingerprints could disagree, letting an
                active-class toggle slip through when its visible
                bytes happened to balance to zero. We collapsed to a
                single <code>selector&nbsp;#app, mode&nbsp;inner</code>
                fat morph that re-renders the whole UI from state on
                every push. Imperative scrolls
                (<code>jumpToPx</code>, back&#8209;to&#8209;top,
                sidebar recenter) ride <em>inside</em> the morph as a
                transient <code>&lt;div&nbsp;id="cmd-N"
                data-init="…"&gt;</code> with a bumped sequence
                number, so Idiomorph treats it as a fresh node and
                Datastar re&#8209;fires the binding. No
                <code>$jumpToPx&nbsp;&gt;&nbsp;0</code> gate, no
                special-cased scroll-to-zero. One mental model.
              </p>
            </div>
            <div class="lesson">
              <div class="index">08 · Initial paint, inlined</div>
              <h4>The first paint shouldn't depend on the SSE
                stream's first chunk.</h4>
              <p>
                Browsers buffer the first body chunk of a streaming
                response on different schedules. Letting the
                first&#8209;paint experience hinge on when that chunk
                arrives was the wrong shape: there's no header, no
                response setting, and no encoding choice that lets
                you depend on it. The fix is structural — render the
                initial diff slice + initial sidebar slice directly
                into the HTML response, plus an inline
                <code>&lt;script&gt;</code> that sets
                <code>scrollTop</code> on both scrollers before
                first paint. The SSE attaches in parallel and the
                fingerprint gate skips its first push because the
                rendered state already matches the HTML the browser
                just parsed.
              </p>
            </div>
            <div class="lesson">
              <div class="index">09 · content-visibility, revisited</div>
              <h4>Each scroll-driven morph was styling ~3,000 token
                spans the user couldn't see.</h4>
              <p>
                Per-scroll style recalc was 75&nbsp;– 110&nbsp;ms on
                3K&#8209;4K elements, and forced reflow inside
                Datastar's morph added another ~70&nbsp;ms. The
                cause: a file section's ~3,000 syntax-token spans get
                styled the moment the section enters the DOM, even
                if it's nowhere near the viewport. We tried
                <code>content-visibility:&nbsp;auto</code> on
                <code>.file-section</code> in 2026-05; Safari
                occasionally failed to activate a section's subtree
                after a jump and the diffview went blank. The
                file-windowed architecture changed the calculus: a
                section's subtree no longer gets reconstructed on
                each scroll (Idiomorph matches
                <code>#f-&lt;fid&gt;</code>, only morphs row
                content), so the activation-vs-morph race no longer
                exists. We turned <code>content-visibility</code>
                back on. The Chrome performance trace now flags
                neither DOMSize nor ForcedReflow during scroll — the
                browser styles a section only when the viewport
                enters it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- ============================================================
           LESSONS — smaller-grain
           ============================================================ -->
      <section>
        <div class="wide-col">
          <p class="eyebrow">Other things we learned the hard way</p>
          <h2>The small ones that kept biting.</h2>

          <div class="lessons">
            <div class="lesson">
              <div class="index">A · Stable ids</div>
              <h4>Give every row a stable id, or pay for it in layout shift.</h4>
              <p>
                Datastar's morph matches new children to existing ones by
                <code>id</code>, falling back to positional matching when
                the ids are absent. Without an id, every row's
                <code>style="top:Npx"</code> got rewritten on every
                push. CLS dropped from <strong>7.72</strong> to
                <strong>0.00</strong> the moment rows got
                <code>id="r-N"</code>.
              </p>
            </div>
            <div class="lesson">
              <div class="index">B · No inline scripts in morphs</div>
              <h4>iOS WebKit doesn't run them reliably.</h4>
              <p>
                Idiomorph-injected
                <code>&lt;script&gt;</code> tags are spec&#8209;permitted
                to skip execution; some engines run them anyway, iOS
                WebKit doesn't. Imperative actions ride through a
                signal change (or a <code>data-init</code> on a fresh-
                id element) and are picked up by a body-level
                <code>data-effect</code>, never as an inline
                <code>&lt;script&gt;</code> inside a morph's HTML.
              </p>
            </div>
            <div class="lesson">
              <div class="index">C · Sticky outer height stays stable</div>
              <h4>A child that shrinks the sticky shifts the page below.</h4>
              <p>
                A child rule that changed under
                <code>@container scroll-state(stuck)</code> shrank the
                sticky element from 72&nbsp;px to 40&nbsp;px,
                which&nbsp;— combined with a negative
                <code>margin-bottom</code>&nbsp;— shifted the entire
                diff upward by 32&nbsp;px the moment the bar pinned.
                Fixing the outer height and absolutely positioning the
                bar inside removed the jump entirely.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer>
      built with <strong style="color:var(--fg-strong);font-weight:500">Bun</strong>,
      <strong style="color:var(--fg-strong);font-weight:500">Datastar</strong>,
      and a long-lived stream &nbsp;<span class="arrow">→</span>&nbsp;
      <a href="/" style="text-decoration:none;color:var(--accent)">open the demo</a>
    </footer>
  </body>
</html>
`;
}

// Generate the row marks inside the scrolling tape. We render two copies
// stacked vertically so the loop animation reads as continuous motion.
function ribbonMarks(x: number, y: number, width: number, totalHeight: number): string {
  // Each mark is a short horizontal stroke. Layout breaks the tape into
  // "files" by inserting slightly thicker bands every 11 rows.
  const rowH = 4;
  const rowCount = Math.floor(totalHeight / rowH);
  const out: string[] = [];
  for (let copy = 0; copy < 2; copy++) {
    const yBase = y + copy * totalHeight;
    for (let i = 0; i < rowCount; i++) {
      const yy = yBase + i * rowH;
      // Pseudo-random width based on i so the marks don't all look identical.
      // We just want visual texture, not real data.
      const w = 18 + ((i * 7919) % 60);
      const isFileEdge = i % 11 === 0;
      const cls = isFileEdge
        ? "ribbon-mark file-edge"
        : (i * 31) % 5 === 0
          ? "ribbon-mark"
          : "ribbon-mark dim";
      const h = isFileEdge ? 1.6 : 0.8;
      out.push(
        `<rect class="${cls}" x="${x + (width - w) / 2}" y="${yy}" width="${w}" height="${h}" rx="0.4" />`,
      );
    }
  }
  return out.join("\n");
}
