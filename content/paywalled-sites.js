// Sites where Summarise sends the page TEXT (read from your own logged-in tab) instead of the link,
// because Google can't open the link. Subdomains match automatically (e.g. "substack.com" also
// matches "someone.substack.com"). Add or remove domains freely.
self.GSB_PAYWALLED_SITES = [
  // UK news and magazines
  "ft.com", "telegraph.co.uk", "thetimes.co.uk", "thesundaytimes.co.uk", "economist.com",
  "spectator.co.uk", "newstatesman.com", "prospectmagazine.co.uk", "lrb.co.uk", "newscientist.com",
  "inews.co.uk", "tortoisemedia.com",
  // US news and magazines
  "nytimes.com", "wsj.com", "washingtonpost.com", "bloomberg.com", "barrons.com", "theathletic.com",
  "theatlantic.com", "newyorker.com", "wired.com", "latimes.com", "bostonglobe.com", "hbr.org",
  "foreignaffairs.com", "foreignpolicy.com", "politico.com", "businessinsider.com",
  "theinformation.com", "puck.news",
  // International news
  "theaustralian.com.au", "smh.com.au", "afr.com", "globeandmail.com", "lemonde.fr", "lefigaro.fr",
  "spiegel.de", "faz.net", "handelsblatt.com", "elpais.com", "corriere.it", "scmp.com",
  "haaretz.com", "straitstimes.com",
  // Newsletters and analysis
  "stratechery.com", "substack.com", "medium.com", "patreon.com", "seekingalpha.com", "morningstar.com",
  // Finance and business data
  "investors.com", "fool.com", "spglobal.com", "pitchbook.com", "crunchbase.com", "statista.com",
  "law360.com", "bloomberglaw.com",
  // Social and login-walled
  "reddit.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "linkedin.com", "quora.com",
  "pinterest.com", "threads.net", "tiktok.com", "nextdoor.com", "glassdoor.com", "researchgate.net",
  "academia.edu",
  // Academic journals and papers
  "nature.com", "science.org", "sciencedirect.com", "link.springer.com", "onlinelibrary.wiley.com",
  "tandfonline.com", "jstor.org", "cell.com", "thelancet.com", "nejm.org", "bmj.com",
  "jamanetwork.com", "ieeexplore.ieee.org", "dl.acm.org", "journals.sagepub.com", "academic.oup.com",
  "cambridge.org", "scribd.com",
  // Study and learning
  "chegg.com", "coursehero.com", "udemy.com",
  // Private workspaces
  "docs.google.com", "mail.google.com", "outlook.office.com", "notion.so", "slack.com", "figma.com",
  "atlassian.net",
];

// Sites that auto-summarise (the refresh button) never touches: private workspaces, where the page
// text is personal or confidential. You can still press Summarise manually on them.
self.GSB_NO_AUTO_SITES = [
  "docs.google.com", "mail.google.com", "outlook.office.com", "notion.so", "slack.com", "figma.com",
  "atlassian.net",
];

// Logic for the on/off toggle. The list above is the built-in default; the user's changes are stored
// separately (added = sites they turned on, removed = built-in sites they turned off).
self.GSB_SITES = (() => {
  const BUILTIN = self.GSB_PAYWALLED_SITES;
  const covers = (d, host) => host === d || host.endsWith("." + d);
  const matches = (host, list) => list.some((d) => covers(d, host));

  const hostOf = (href) => {
    try {
      const u = new URL(href);
      if (!/^https?:$/.test(u.protocol)) return null;
      return u.hostname.toLowerCase().replace(/^www\./, "");
    } catch (_) {
      return null;
    }
  };

  const isOn = (host, { added, removed }) =>
    !matches(host, removed) && (matches(host, BUILTIN) || matches(host, added));

  // Returns the new { added, removed } after flipping the state for `host`.
  const toggled = (host, lists) => {
    let { added, removed } = lists;
    if (isOn(host, lists)) {
      added = added.filter((d) => !covers(d, host));
      if (matches(host, BUILTIN) && !removed.includes(host)) removed = [...removed, host];
    } else {
      removed = removed.filter((d) => !covers(d, host));
      if (!matches(host, BUILTIN) && !matches(host, added)) added = [...added, host];
    }
    return { added, removed };
  };

  const isNoAuto = (host) => matches(host, self.GSB_NO_AUTO_SITES);

  return { hostOf, isOn, toggled, isNoAuto };
})();
