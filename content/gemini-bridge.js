// Runs on google.com/search. It ONLY activates when the page is framed by this extension's
// side panel, so normal Google searches in your tabs are never touched.
(() => {
  const EXT_ORIGIN = `chrome-extension://${chrome.runtime.id}`;
  const inPanel =
    window !== window.top &&
    window.parent === window.top &&
    location.ancestorOrigins?.[0] === EXT_ORIGIN;
  if (!inPanel) return;
  if (window.__gsbInit) return; // never run two copies in one frame
  window.__gsbInit = true;

  /* ---------------------------------------------------------------
   * 1 & 2. Hide navbar tabs, Google logo, apps menu and avatar
   * ------------------------------------------------------------- */
  const HIDE_SELECTORS = [
    // Google logo
    'a[href="/"]', 'a[href^="/webhp"]', 'a[href^="https://www.google.com/webhp"]',
    'a[aria-label="Google" i]', 'img[alt="Google" i]', '#logo',
    // Apps (3x3 grid) menu
    '[aria-label*="Google apps" i]', 'a[href*="about.google/products"]',
    // Account avatar
    '[aria-label*="Google Account" i]', 'a[href*="accounts.google.com/SignOutOptions"]',
    // Google's account/app widgets are often iframes
    'iframe[src*="ogs.google.com"]',
    // Classic top bar containers
    '#gb', '#gbw', '#hdtb', '#appbar',
  ];
  const style = document.createElement("style");
  style.textContent = `${HIDE_SELECTORS.join(",")}{display:none !important;}`;
  document.documentElement.appendChild(style);

  // Nav tabs (AI Mode / All / Images / Videos / ...): class names are obfuscated, so find them by
  // label text near the top of the page and hide their common container.
  const NAV_LABELS = new Set([
    "ai mode", "all", "images", "videos", "short videos", "news", "shopping", "forums",
    "more", "web", "books", "maps", "flights", "finance", "tools", "search tools",
  ]);
  function hideNav() {
    const hits = [...document.querySelectorAll('a, [role="tab"], [role="link"], button')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.top > 180) return false;
      return NAV_LABELS.has((el.textContent || "").trim().toLowerCase());
    });
    if (hits.length < 3) return;
    let lca = hits[0];
    while (lca && !hits.every((h) => lca.contains(h))) lca = lca.parentElement;
    if (!lca || lca === document.body || lca === document.documentElement) return;
    if (lca.querySelector('textarea, input, [contenteditable="true"]')) return; // never hide the prompt box
    if (lca.getBoundingClientRect().height > 160) return;
    lca.style.setProperty("display", "none", "important");
  }

  /* ---------------------------------------------------------------
   * Prompt box helpers
   * ------------------------------------------------------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  function findInput() {
    const all = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].filter(isVisible);
    return all[all.length - 1] || null; // follow-up composer sits at the bottom
  }

  function findSend() {
    const btns = [...document.querySelectorAll('button, [role="button"]')].filter(isVisible);
    return btns.reverse().find((b) =>
      /^(send|submit|search)\b/i.test((b.getAttribute("aria-label") || b.title || "").trim())
    );
  }

  const readValue = (el) => ("value" in el ? el.value : el.innerText) || "";
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const countOf = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
  const isTextField = (el) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

  function setTextField(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function selectAll(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Replaces the box's content with `text` using ONE method (never two in the same attempt).
  function replaceContent(el, text) {
    el.focus();
    if (isTextField(el)) { setTextField(el, text); return; }
    selectAll(el); // select everything so the insert REPLACES any leftover text
    document.execCommand("insertText", false, text);
  }

  function clearContent(el) {
    el.focus();
    if (isTextField(el)) { setTextField(el, ""); return; }
    selectAll(el);
    document.execCommand("delete");
  }

  async function insertText(text) {
    const el = findInput();
    if (!el) return false;
    const want = norm(text);

    replaceContent(el, text);
    await sleep(150);
    let cur = norm(readValue(el));

    if (!cur) {
      // The editor ignored the insert: try a single simulated paste instead.
      try {
        el.focus();
        selectAll(el);
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (_) { /* ignore */ }
      await sleep(150);
      cur = norm(readValue(el));
      if (!cur) return false;
    }

    // Safety net: if the text ended up in the box more than once, clear it and insert it once.
    if (countOf(cur, want) > 1) {
      clearContent(el);
      await sleep(80);
      replaceContent(el, text);
      await sleep(150);
    }
    return true;
  }

  let lastSubmit = 0;
  function submit() {
    const now = Date.now();
    if (now - lastSubmit < 3000) return; // never submit twice in quick succession
    lastSubmit = now;
    const btn = findSend();
    if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
      btn.click(); // one method only
      return;
    }
    const el = findInput();
    if (el) {
      // keydown only: some sites also act on keyup, which would submit a second time
      el.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
    }
  }

  /* ---------------------------------------------------------------
   * Summarise button + Login/paywall toggle (inside the page, in a shadow root)
   *  - site NOT on the list: Summarise sends the link
   *  - site on the list (built-in + user changes): Summarise sends the page text
   * ------------------------------------------------------------- */
  const SITES = self.GSB_SITES;
  let bar, btn, toggle, labelTimer;
  const DEFAULT_LABEL = "Summarise";

  function setLabel(text, revertMs) {
    btn.textContent = text;
    clearTimeout(labelTimer);
    if (revertMs) labelTimer = setTimeout(() => (btn.textContent = DEFAULT_LABEL), revertMs);
  }

  // Strip tracking / syndication parameters (e.g. FT's ?syn-xxxx=1, utm_*, fbclid) so the link is clean.
  const TRACKING_PARAM = /^(utm_.*|syn-.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|smid|cmpid|sr_share|_ga)$/i;
  function cleanUrl(href) {
    try {
      const u = new URL(href);
      [...u.searchParams.keys()].forEach((k) => { if (TRACKING_PARAM.test(k)) u.searchParams.delete(k); });
      return u.toString();
    } catch (_) {
      return href;
    }
  }

  const askBackground = async (urlOnly) => {
    const res = await chrome.runtime.sendMessage({ type: "GSB_GET_PAGE", urlOnly });
    if (!res?.ok) throw new Error(res?.error || "Couldn't read the page");
    return res.page;
  };

  async function loadLists() {
    const { gsbAdded = [], gsbRemoved = [] } = await chrome.storage.local.get(["gsbAdded", "gsbRemoved"]);
    return { added: gsbAdded, removed: gsbRemoved };
  }

  /* ----- Login/paywall toggle ----- */
  function renderToggle(host, on) {
    if (!toggle) return;
    toggle.dataset.host = host || "";
    toggle.disabled = !host;
    toggle.setAttribute("aria-checked", on ? "true" : "false");
    toggle.title = !host
      ? "Not available on this page"
      : on
        ? `Login/paywall mode is ON for ${host}: Summarise sends the page text. Click to turn off.`
        : `Login/paywall mode is OFF for ${host}: Summarise sends the link. Click to turn on and add this site.`;
  }

  async function refreshToggle() {
    if (!toggle) return;
    try {
      const page = await askBackground(true);
      const host = SITES.hostOf(page.url);
      renderToggle(host, host ? SITES.isOn(host, await loadLists()) : false);
    } catch (_) {
      renderToggle(null, false);
    }
  }

  async function onToggle() {
    const host = toggle.dataset.host;
    if (!host) return;
    toggle.disabled = true;
    try {
      const next = SITES.toggled(host, await loadLists());
      await chrome.storage.local.set({ gsbAdded: next.added, gsbRemoved: next.removed });
    } finally {
      await refreshToggle();
    }
  }

  // Keep the toggle in step with the active tab: the background pushes tab changes over a port.
  function connectPort() {
    try {
      const port = chrome.runtime.connect({ name: "gsb" });
      port.onMessage.addListener((m) => {
        if (m?.type === "GSB_TAB_CHANGED") refreshToggle();
        else if (m?.type === "GSB_NAVIGATED") onNavigated(m.url);
      });
      port.onDisconnect.addListener(() => setTimeout(connectPort, 1000)); // service worker restarted
    } catch (_) { /* extension context gone */ }
  }
  connectPort();
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.gsbAuto) { autoOn = !!changes.gsbAuto.newValue; renderAuto(); }
    refreshToggle();
  });
  window.addEventListener("focus", () => refreshToggle());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshToggle(); });

  /* ----- Auto-refresh (summarise automatically when the tab goes to a new page) ----- */
  let autoBtn, autoOn = false, lastAutoUrl = "";

  function renderAuto() {
    if (!autoBtn) return;
    autoBtn.setAttribute("aria-pressed", autoOn ? "true" : "false");
    autoBtn.title = autoOn
      ? "Auto-summarise is ON: Sidekick summarises each new page you open. Click to turn off."
      : "Auto-summarise is OFF. Click to summarise each new page automatically.";
  }
  chrome.storage.local.get("gsbAuto").then(({ gsbAuto }) => { autoOn = !!gsbAuto; renderAuto(); });

  function onToggleAuto() {
    autoOn = !autoOn;
    renderAuto();
    chrome.storage.local.set({ gsbAuto: autoOn });
  }

  async function onNavigated(url) {
    if (!autoOn) return;
    const key = cleanUrl(url);
    if (key === lastAutoUrl) return; // same page again (reload, duplicate event)
    lastAutoUrl = key;
    await summarise(true);
  }

  /* ----- Summarise ----- */
  async function summarise(auto) {
    if (btn.disabled) return; // a run is already in progress
    btn.disabled = true;
    if (!auto) setLabel("Reading page…");
    try {
      let page = await askBackground(true); // cheap: just the tab's URL
      const host = SITES.hostOf(page.url);
      // Auto mode stays quiet on unreadable pages and never touches private workspaces.
      if (auto && (!host || SITES.isNoAuto(host))) return;
      if (auto) setLabel("Reading page…");
      let text, sent;
      if (host && SITES.isOn(host, await loadLists())) {
        page = await askBackground(false); // read the page text from the logged-in tab
        if (!page.content.trim()) throw new Error("No readable text on this page");
        text = `Summarise the following text concisely with the key points.\n\n${page.content}`;
        sent = "Sent text ✓";
      } else {
        text = `Summarise this page concisely with the key points: ${cleanUrl(page.url)}`;
        sent = "Sent link ✓";
      }
      if (await insertText(text)) {
        setTimeout(submit, 400);
        setLabel(sent, 3000);
      } else {
        await navigator.clipboard.writeText(text).catch(() => {});
        setLabel("Prompt box not found — copied", 5000);
      }
    } catch (err) {
      setLabel(auto ? "Auto-summarise failed" : err.message || "Error", 5000);
    } finally {
      btn.disabled = false;
    }
  }
  const onClick = () => summarise(false);

  function injectButton() {
    if (document.getElementById("gsb-host")) return;
    const host = document.createElement("div");
    host.id = "gsb-host";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .bar { position: fixed; top: 18px; left: 16px; right: 16px; z-index: 2147483647;
               display: flex; flex-wrap: wrap; gap: 8px; pointer-events: none; }
        button {
          pointer-events: auto; box-sizing: border-box; height: 42px;
          display: inline-flex; align-items: center; gap: 10px;
          font: 500 14px/1 "Google Sans", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
          padding: 0 18px; border-radius: 8px; cursor: pointer; white-space: nowrap;
          background: #ffffff; color: #1f1f1f; border: 1px solid #c4c7c5; box-shadow: none;
        }
        button:hover { background: #f0f4f9; }
        button:disabled { opacity: .6; cursor: default; }
        button:focus-visible { outline: 2px solid #747775; outline-offset: 2px; }
        button.toggle { padding: 0 14px; }
        /* refresh (auto-summarise) button: icon only */
        button.auto { width: 42px; padding: 0; justify-content: center; }
        button.auto svg { width: 20px; height: 20px; fill: currentColor; display: block; }
        button.auto[aria-pressed="true"] { background: #1f1f1f; color: #ffffff; border-color: #1f1f1f; }
        button.auto[aria-pressed="true"]:hover { background: #3c4043; }
        /* padlock: open when off, closed when on */
        .lock { width: 18px; height: 18px; fill: currentColor; flex: none; display: block; }
        .lock.closed { display: none; }
        button.toggle[aria-checked="true"] .lock.closed { display: block; }
        button.toggle[aria-checked="true"] .lock.open { display: none; }
        /* slider switch */
        .track { position: relative; width: 34px; height: 20px; border-radius: 10px;
                 background: #c4c7c5; transition: background .15s; flex: none; }
        .thumb { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%;
                 background: #ffffff; transition: transform .15s, background .15s; }
        button.toggle[aria-checked="true"] .track { background: #1f1f1f; }
        button.toggle[aria-checked="true"] .thumb { transform: translateX(14px); }
        @media (prefers-color-scheme: dark) {
          button { background: #131314; color: #e3e3e3; border-color: #444746; }
          button:hover { background: #1e1f20; }
          button:focus-visible { outline-color: #9aa0a6; }
          button.auto[aria-pressed="true"] { background: #e3e3e3; color: #131314; border-color: #e3e3e3; }
          button.auto[aria-pressed="true"]:hover { background: #c4c7c5; }
          .track { background: #444746; }
          .thumb { background: #9aa0a6; }
          button.toggle[aria-checked="true"] .track { background: #e3e3e3; }
          button.toggle[aria-checked="true"] .thumb { background: #131314; }
        }
      </style>
      <div class="bar">
        <button type="button" class="summarise" title="Summarise the current tab">Summarise</button>
        <button type="button" class="toggle" role="switch" aria-checked="false" aria-label="Log in" disabled>
          <svg class="lock open" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>
          <svg class="lock closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
          <span class="track"><span class="thumb"></span></span>
        </button>
        <button type="button" class="auto" aria-label="Auto-summarise new pages" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
      </div>`;
    bar = root.querySelector(".bar");
    btn = root.querySelector(".summarise");
    toggle = root.querySelector(".toggle");
    btn.addEventListener("click", onClick);
    toggle.addEventListener("click", onToggle);
    autoBtn = root.querySelector(".auto");
    autoBtn.addEventListener("click", onToggleAuto);
    renderAuto();
    document.documentElement.appendChild(host);
    refreshToggle();
  }

  /* ---------------------------------------------------------------
   * Keep everything applied as the SPA re-renders
   * ------------------------------------------------------------- */
  let t;
  const refresh = () => { injectButton(); hideNav(); };
  const schedule = () => { clearTimeout(t); t = setTimeout(refresh, 200); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh);
  else refresh();
})();
