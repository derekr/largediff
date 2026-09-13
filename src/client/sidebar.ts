// Client-side sidebar scroll reporter.
//
// All sidebar state (which rows, which is active, the row height) lives
// on the server. The server renders an initial window centered on the
// active file; this module only forwards the user's manual scrolls of
// `.file-list` to the server so it can re-slice. No client-side
// virtualization, no DOM manipulation, no signal coupling.

function readSessionId(): string {
  const sigAttr = document.body.getAttribute("data-signals");
  if (sigAttr === null) return "";
  try {
    const parsed = JSON.parse(sigAttr);
    return typeof parsed?._sid === "string" ? parsed._sid : "";
  } catch {
    return "";
  }
}

function setupSidebarScroll(): void {
  const list = document.querySelector<HTMLElement>("#file-tree .file-list");
  if (list === null) return;
  const sid = readSessionId();
  if (sid === "") return;

  const url = `/sessions/${sid}/sidebar`;
  let lastSentAt = 0;
  let pendingTimer: number | null = null;
  const THROTTLE_MS = 50;
  // Skip forwarding scrolls that the server told us to do — when the
  // server emits a `sidebarJumpToPx`, the resulting scrollTo fires a
  // scroll event that, without suppression, would echo right back to
  // /sidebar and clobber the server's own scrollTop with a slightly
  // settled-by-the-time-we-read-it value. The `data-init` string built by
  // pushProjection calls this immediately before its scrollTo.
  let serverScrollUntil = 0;
  (window as unknown as { __sidebarServerScrolled?: () => void }).__sidebarServerScrolled = () => {
    serverScrollUntil = performance.now() + 250;
  };

  // `user` distinguishes a real scroll gesture from plain telemetry. The
  // server uses it to decide whether the reader has taken the file list
  // over (see ViewState.sidebarUserScrolled). Inferring this server-side
  // from "the body carried a scrollTop" does not work: the initial
  // measurement and the resize handler both report a scrollTop too, so
  // page load alone would claim ownership and suppress the first
  // auto-recenter. Only the scroll listeners pass `user: true`.
  const send = (user: boolean): void => {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scrollTop: list.scrollTop,
        height: list.clientHeight,
        user,
      }),
      keepalive: true,
    }).catch(() => {});
  };

  // Telemetry-only report: dimensions for the server's slice math, with no
  // claim that the reader touched anything.
  const measure = (): void => send(false);

  const onScroll = (): void => {
    if (performance.now() < serverScrollUntil) return;
    const now = performance.now();
    const since = now - lastSentAt;
    if (since >= THROTTLE_MS) {
      lastSentAt = now;
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      send(true);
      return;
    }
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      lastSentAt = performance.now();
      send(true);
    }, THROTTLE_MS - since);
  };

  // `scrollend` has to honour the suppression window too. Binding it
  // straight to the sender let a server-driven scrollTo echo back as a
  // user gesture the moment it settled — which, with ownership tracking,
  // means one recenter would cancel every recenter after it.
  const onScrollEnd = (): void => {
    if (performance.now() < serverScrollUntil) return;
    send(true);
  };

  list.addEventListener("scroll", onScroll, { passive: true });
  list.addEventListener("scrollend", onScrollEnd, { passive: true });
  window.addEventListener("resize", measure, { passive: true });
  // Initial measurement — tells the server the sidebar's viewport
  // height so its slice math and auto-recenter can use it from the
  // first push, not the second. Explicitly NOT a user gesture.
  measure();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupSidebarScroll);
} else {
  setupSidebarScroll();
}
