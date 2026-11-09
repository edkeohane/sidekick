// Clicking the toolbar icon opens the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("setPanelBehavior failed:", err));
});

const MAX_CHARS = 30000;

// Runs INSIDE the active tab. Must be fully self-contained.
function extractPage(maxChars) {
  const selection = String(window.getSelection() || "");
  const root = document.querySelector("main, article, [role=main]") || document.body;
  let content = (root.innerText || "").replace(/\n{3,}/g, "\n\n");
  if (content.length > maxChars) content = content.slice(0, maxChars) + "\n…[truncated]";
  return { title: document.title, url: location.href, selection, content };
}

// The Summarize button lives inside the embedded Google page and asks us for the active tab's content.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "GSB_GET_PAGE" || sender.id !== chrome.runtime.id) return;
  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error("No active tab");
      if (!/^(https?|file|ftp):/.test(tab.url || "")) {
        throw new Error("Can't read this page");
      }
      if (msg.urlOnly) {
        sendResponse({ ok: true, page: { title: tab.title || "", url: tab.url, selection: "", content: "" } });
        return;
      }
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPage,
        args: [MAX_CHARS],
      });
      sendResponse({ ok: true, page: res.result });
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();
  return true; // async response
});

// Tell the side panel's page (via a long-lived port) when the active tab or its URL changes,
// so the login/paywall toggle can show the right state for the current site.
const ports = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "gsb" || port.sender?.id !== chrome.runtime.id) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});
const broadcast = (msg) => {
  for (const p of ports) {
    try { p.postMessage(msg); } catch (_) { ports.delete(p); }
  }
};
const notifyTabChanged = () => broadcast({ type: "GSB_TAB_CHANGED" });
chrome.tabs.onActivated.addListener(notifyTabChanged);
chrome.windows.onFocusChanged.addListener(notifyTabChanged);

// When the active tab in the focused window finishes navigating to a new page (or its URL changes),
// tell the panel once things have settled so it can auto-summarise.
const navTimers = new Map();
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!(info.url || info.status === "complete")) return;
  notifyTabChanged();
  clearTimeout(navTimers.get(tabId));
  navTimers.set(tabId, setTimeout(async () => {
    navTimers.delete(tabId);
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.active || !tab.url || tab.status !== "complete") return;
      const win = await chrome.windows.getLastFocused();
      if (tab.windowId !== win.id) return;
      broadcast({ type: "GSB_NAVIGATED", url: tab.url });
    } catch (_) { /* tab closed */ }
  }, 1200));
});
