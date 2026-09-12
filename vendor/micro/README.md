# Vendored microlighter 2.2.0 (MIT © Dave Rupert)

Source: https://github.com/davatron5000/microlighter

- `highlight.js` + `grammar-dependencies.js` — the programmatic
  `highlightAll` entry and its only static import. (NOT
  `microlighter.min.js`: that is the auto-runner, which only scans
  `pre > code` on load and exports nothing.)
- `grammars/{typescript,javascript,python,go,rust,json}.js` — the five
  largediff languages, plus `javascript` (typescript's external dependency).
  They load on demand via relative `./grammars/*.js` dynamic imports,
  which is why the directory layout here mirrors `dist/`.
- `github.css` — Highlight-API theme, applied when `?hl=micro` sets
  `data-syntax-theme="github"`.

Spike only (bean largediff-3s9i): measures whether a TextMate +
Highlight-API highlighter dodges the WebKit repaint wall documented in
largediff-ta4r, or hits the same wall as our hand-rolled `?hl=ranges`.
