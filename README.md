# Sidekick (Chrome extension, Manifest V3)

Loads Google's AI Mode (https://www.google.com/search?udm=50) in Chrome's side panel, with Google's
header chrome hidden and a **Summarise** button inside the page (top left).

- Next to Summarise is a padlock slider for the current site. Off: Summarise sends the link. On: it sends the page text.
- On paywalled / login-only sites (built-in list in `content/paywalled-sites.js`, plus any you turn on with the toggle), it sends the page's readable
  text instead, read from your own logged-in tab, because Google can't open those links.

## Install
1. Unzip, open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** -> select the extension folder (the one containing manifest.json).
3. Click the extension icon (or Ctrl/Cmd+Shift+G) to open the side panel.

## Notes
- Edit `content/paywalled-sites.js` to add/remove domains; subdomains match automatically.
- Page tweaks only run when google.com/search is framed by this extension's panel.
- Dark mode follows your system/browser theme.
- Selectors/heuristics live in `content/gemini-bridge.js` (`HIDE_SELECTORS`, `NAV_LABELS`, `findInput`, `findSend`).
- Restricted pages (chrome://, Web Store, PDF viewer) can't be read.

## Auto-summarise (refresh button)
The icon-only refresh button next to the padlock turns auto-summarise on/off (saved between sessions).
When it's on, Sidekick summarises each new page the active tab navigates to. It does nothing on pages it
can't read, and never on private workspaces (Google Docs/Gmail, Outlook, Notion, Slack, Figma, Atlassian):
see `GSB_NO_AUTO_SITES` in `content/paywalled-sites.js`. Switching tabs does not trigger it, only navigation.
