/**
 * Panic handling and tab cloaking.
 *
 * Two related jobs:
 *
 * 1. **Cloak** (settings -> Cloaking): the disguise applied to this tab -- title,
 *    favicon, and the fake site shown inside the about:blank window. Profiles
 *    bundle those three so a disguise is one pick instead of three.
 * 2. **Panic**: a key (or the panic button) that replaces the current tab with a
 *    decoy site and drops the real page. The decoy is hidden while it loads: the
 *    screen stays black until the target site has actually painted, so a teacher
 *    looking over the shoulder never sees the proxy or a half-loaded frame.
 *
 * Everything is opt-in, everything is reversible with Escape from the decoy, and
 * nothing here writes the URL that was open into history or storage.
 */
(function (global) {
  "use strict";

  const log = (level, message, data) => {
    if (global.GraipLog) global.GraipLog[level]("cloak", message, data);
  };

  const KEYS = {
    enabled: "graip_panicEnabled",
    key: "graip_panicKey",
    target: "graip_panicTarget",
    openIn: "graip_panicOpenIn",
    showDecoy: "graip_panicShowDecoy",
    targetUrl: "graip_panicTargetUrl",
    cloak: "decoy",
    profile: "graip_cloakProfile",
    cloakTitle: "graip_cloakTitle",
    cloakIcon: "graip_cloakIcon",
  };

  /**
   * Disguise profiles. `page` is rendered inside the about:blank window, so the
   * fake tab is not just a title: it looks like the site the tab claims to be.
   */
  const PROFILES = {
    None: {
      title: "graip",
      icon: "/assets/img/fav.png?v=12",
      page: "none",
    },
    Google: {
      title: "Google",
      icon: "https://www.google.com/favicon.ico",
      page: "search",
    },
    "Google Docs": {
      title: "Untitled document - Google Docs",
      icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon-2023q4.ico",
      page: "document",
    },
    "Google Drive": {
      title: "My Drive - Google Drive",
      icon: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png",
      page: "document",
    },
    "Google Classroom": {
      title: "Classes - Google Classroom",
      icon: "https://ssl.gstatic.com/classroom/favicon.png",
      page: "document",
    },
    Youtube: {
      title: "YouTube",
      icon: "https://www.youtube.com/s/desktop/014dbbed/img/favicon_32x32.png",
      page: "video",
    },
    Canvas: {
      title: "Dashboard | Canvas",
      icon: "https://community.canvaslms.com/favicon.ico",
      page: "document",
    },
    "Khan Acadamy": {
      title: "Khan Academy | Free Online Courses",
      icon: "https://www.khanacademy.org/favicon.ico",
      page: "document",
    },
    "Desmos": {
      title: "Desmos | Graphing Calculator",
      icon: "https://www.desmos.com/favicon.ico",
      page: "document",
    },
  };

  /**
   * Panic destinations. Grouped so the settings dropdown can say what each one
   * buys you: a neutral site, an offline-looking error page, or a search page
   * that accepts whatever the user types next.
   */
  const TARGETS = {
    "Classroom": "https://classroom.google.com/",
    "Google": "https://www.google.com/",
    "Google Docs": "https://docs.google.com/document/u/0/",
    "Google Drive": "https://drive.google.com/",
    "Canvas": "https://canvas.instructure.com/",
    "Khan Academy": "https://www.khanacademy.org/",
    "Wikipedia": "https://en.wikipedia.org/wiki/Main_Page",
    "Blank (about:blank)": "about:blank",
    "Custom URL…": null,
  };

  /** Keys offered in Settings. Values are KeyboardEvent.key values. */
  const PANIC_KEYS = {
    "\\": "\\",
    "Escape": "Escape",
    "`": "`",
    "~": "~",
    "]": "]",
    "z": "z",
    "q": "q",
    "Shift+Z": "Z",
  };

  const DEFAULTS = {
    enabled: false,
    key: "\\",
    target: "Classroom",
    openIn: "same-tab",
    showDecoy: true,
  };

  /**
   * `sessionStorage` keys that carry the return point across a panic.
   *
   * A same-tab panic *replaces* this document, so the tab keeps no memory of
   * where the user was: `history.back()` from the decoy lands on whatever came
   * before graip (usually `/start.html`, the disguise they arrived from), which
   * looks like a brand-new open. These two keys are what makes the decoy able to
   * put the user back exactly where they left off.
   *
   * They are session-scoped on purpose: closing the tab forgets them, and the
   * "Clear session traces" button in Settings removes them explicitly.
   */
  const RETURN_KEYS = {
    url: "graip_panicReturnUrl",
    state: "graip_panicReturnState",
  };

  function store() {
    try {
      return global.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function read(key, fallback) {
    const s = store();
    if (!s) return fallback;
    try {
      const value = s.getItem(key);
      return value === null || value === undefined ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function write(key, value) {
    const s = store();
    if (!s) return;
    try {
      s.setItem(key, value);
    } catch (error) {
      /* ignore */
    }
  }

  function settings() {
    const target = read(KEYS.target, DEFAULTS.target);
    return {
      enabled: read(KEYS.enabled, "") === "yes",
      key: read(KEYS.key, DEFAULTS.key),
      target: Object.prototype.hasOwnProperty.call(TARGETS, target) ? target : DEFAULTS.target,
      openIn: read(KEYS.openIn, DEFAULTS.openIn) === "new-tab" ? "new-tab" : "same-tab",
      showDecoy: read(KEYS.showDecoy, "yes") !== "no",
      customUrl: read(KEYS.targetUrl, ""),
    };
  }

  function profileName() {
    const name = read(KEYS.cloak, "None");
    return Object.prototype.hasOwnProperty.call(PROFILES, name) ? name : "None";
  }

  function profile(name) {
    const key = Object.prototype.hasOwnProperty.call(PROFILES, name) ? name : "None";
    return Object.assign({ id: key }, PROFILES[key]);
  }

  /**
   * The page's own title, captured before any disguise is applied, so switching
   * the disguise off restores "graip | browser" instead of a generic "graip".
   */
  const BASE_TITLE =
    typeof global.document !== "undefined" && global.document.title
      ? global.document.title
      : "graip";

  /** The favicon element on this page, if it has one. */
  function faviconElement() {
    return (
      global.document.querySelector("link#tabIcon") ||
      global.document.querySelector("link[rel*='icon']")
    );
  }

  /**
   * Apply the saved disguise to the current tab. Called on every first-party
   * page load and whenever the profile changes.
   *
   * @param {string} [name]
   */
  function applyCloak(name) {
    const key = name || profileName();
    const chosen = profile(key);

    if (key === "None") {
      global.document.title = BASE_TITLE;
      const icon = faviconElement();
      if (icon) icon.href = "/assets/img/fav.png?v=12";
      write(KEYS.cloakTitle, "");
      write(KEYS.cloakIcon, "");
      log("debug", "cloak cleared");
      return chosen;
    }

    global.document.title = chosen.title;
    const icon = faviconElement();
    if (icon) icon.href = chosen.icon;

    // Remembered so pages that do not load this file (the Classroom copy, the
    // vendored stores) still show the disguise.
    write(KEYS.cloakTitle, chosen.title);
    write(KEYS.cloakIcon, chosen.icon);
    write(KEYS.profile, key);
    log("debug", `cloak applied: ${key}`, { title: chosen.title });
    return chosen;
  }

  /**
   * Minimal stand-in pages. They are intentionally static and tiny: the point is
   * that the tab looks plausible at a glance, not that it is a real clone.
   *
   * @param {string} page
   * @returns {string} HTML
   */
  function decoyMarkup(page) {
    const shell = (body, extraCss) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google</title>
<style>
html,body{margin:0;height:100%;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#202124}
header{display:flex;align-items:center;gap:18px;padding:12px 20px;border-bottom:1px solid #e8eaed;font-size:14px;color:#5f6368}
header b{color:#1a73e8;font-weight:500}
main{padding:28px 32px;max-width:820px;margin:0 auto}
h1{font-weight:500;font-size:22px;margin:0 0 18px}
p{line-height:1.7;color:#3c4043}
.line{height:12px;border-radius:6px;background:#f1f3f4;margin:12px 0}
.line.w1{width:92%}.line.w2{width:78%}.line.w3{width:85%}.line.w4{width:40%}
${extraCss || ""}
</style></head><body>${body}</body></html>`;

    if (page === "search") {
      return shell(
        `<main style="max-width:640px;margin:16vh auto 0;text-align:center">
   <div style="font-size:56px;font-weight:500;letter-spacing:-2px">
     <span style="color:#4285f4">G</span><span style="color:#ea4335">o</span><span style="color:#fbbc05">o</span><span style="color:#4285f4">g</span><span style="color:#34a853">l</span><span style="color:#ea4335">e</span>
   </div>
   <div style="margin:28px auto 0;max-width:520px;border:1px solid #dfe1e5;border-radius:24px;padding:12px 20px;color:#70757a;text-align:left">Search Google</div>
 </main>`
      );
    }

    if (page === "video") {
      return shell(
        `<header><b>YouTube</b><span>Home</span><span>Shorts</span><span>Subscriptions</span></header>
 <main><h1>Recommended</h1>
   <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px">
     ${Array.from({ length: 6 })
       .map(
         () => `<div><div style="aspect-ratio:16/9;background:#f1f3f4;border-radius:10px"></div>
        <div class="line w3" style="margin:10px 0 6px"></div><div class="line w4"></div></div>`
       )
       .join("")}
   </div></main>`
      );
    }

    // document / drive / classroom / canvas / everything else
    return shell(
      `<header><b>Docs</b><span>File</span><span>Edit</span><span>View</span><span>Insert</span><span>Format</span></header>
 <main><h1>Untitled document</h1>
   <div class="line w1"></div><div class="line w2"></div><div class="line w1"></div>
   <div class="line w3"></div><div class="line w2"></div><div class="line w4" style="margin-top:26px"></div>
   <div class="line w1"></div><div class="line w3"></div><div class="line w2"></div>
 </main>`
    );
  }

  /**
   * Build the about:blank document: a decoy page plus the escape hatch.
   *
   * @param {string} name
   * @returns {string} HTML
   */
  function blankDocument(name) {
    const chosen = profile(name);
    const page = chosen.page === "none" ? "document" : chosen.page;
    const html = decoyMarkup(page);

    // The escape hint is hidden until the pointer moves, so a screenshot taken
    // right after the panic looks like an ordinary page.
    const escape = `<div id="graip-escape" style="position:fixed;right:14px;bottom:12px;font:12px/1.4 Arial,sans-serif;color:#9aa0a6;opacity:0;transition:opacity .25s;user-select:none">
      press <b>Esc</b> to return
    </div>
    <script>
      (function(){
        var hint = document.getElementById('graip-escape');
        var show = function(){ hint.style.opacity = .9; };
        window.addEventListener('mousemove', show, { once: true });
        window.addEventListener('touchstart', show, { once: true });
        window.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape') return;
          try {
            if (window.opener && !window.opener.closed) { window.opener.focus(); window.close(); }
            else { history.back(); }
          } catch (error) { history.back(); }
        });
      })();
    <\/script>`;

    return html.replace("</body>", escape + "</body>");
  }

  /**
   * Resolve the panic destination.
   *
   * @returns {string} a URL, or "about:blank"
   */
  function targetUrl() {
    const config = settings();
    if (config.target === "Custom URL…") {
      const custom = (config.customUrl || "").trim();
      if (!custom) return "about:blank";
      if (/^about:blank$/i.test(custom)) return "about:blank";
      try {
        const parsed = new URL(/^[a-z]+:\/\//i.test(custom) ? custom : `https://${custom}`);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "about:blank";
        return parsed.toString();
      } catch (error) {
        return "about:blank";
      }
    }
    return TARGETS[config.target] || TARGETS.Classroom;
  }

  /**
   * Does this keyboard event match the configured panic key?
   *
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  function matches(event) {
    const config = settings();
    if (!config.enabled || !event) return false;

    const wanted = config.key;
    if (wanted === "Shift+Z") return event.shiftKey && event.key === "Z";
    if (wanted === "Escape") return event.key === "Escape" && !event.shiftKey;
    if (wanted === "z" || wanted === "q") {
      // plain letter keys must not fire while typing or with modifiers held
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const tag = (event.target && event.target.tagName) || "";
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        (event.target && event.target.isContentEditable);
      if (typing) return false;
      return event.key.toLowerCase() === wanted;
    }
    return event.key === wanted;
  }

  /**
   * Hide this tab behind a decoy and load the panic target.
   *
   * Same-tab mode replaces this document with a self-contained decoy (black
   * screen, then the site) so neither the proxy nor Graip is visible while the
   * target loads. New-tab mode keeps Graip in the background and opens the decoy
   * beside it, which cannot cover this tab but preserves the session.
   *
   * @param {{ reason?: string, target?: string }} [options]
   * @returns {boolean} whether the panic ran
   */
  function panic(options) {
    const opts = options || {};
    const config = settings();
    const url = opts.target || targetUrl();
    const cloak = profileName();
    const showDecoy = read(KEYS.showDecoy, "yes") !== "no";

    log("info", "panic triggered", {
      reason: opts.reason || "key",
      target: url === "about:blank" ? "about:blank" : global.GraipLog && global.GraipLog.safeUrl(url),
      mode: config.openIn,
      cloak,
    });

    if (config.openIn === "new-tab") {
      openInNewTab(url, cloak);
      return true;
    }

    // Where to come back to. Must happen before the document is replaced: after
    // `location.replace` this script (and everything it could ask) is gone.
    const point = rememberReturnPoint();

    try {
      global.sessionStorage.setItem("graip_panicReturn", "1");
      // The panic is not the user "leaving" on purpose, so the confirm-leave
      // guard must not turn a panic into a browser dialog.
      global.sessionStorage.setItem("graip_skipLeaveGuard", "1");
    } catch (error) {
      /* sessionStorage can be unavailable in private mode */
    }

    log("debug", "panic return point stored", {
      url: point && point.url ? global.GraipLog && global.GraipLog.safeUrl(point.url) : "(none)",
      state: Boolean(point && point.state),
    });

    global.location.replace(decoyUrl(url, cloak, showDecoy));
    return true;
  }

  /**
   * The URL this tab should reopen when the user leaves the decoy.
   *
   * @returns {string} an absolute http(s) URL, or "" when nothing was stored
   */
  function storedReturnUrl() {
    try {
      const value = global.sessionStorage && global.sessionStorage.getItem(RETURN_KEYS.url);
      if (!value) return "";

      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      // Only ever bounce back to this site: a write to sessionStorage from
      // anywhere must not turn the decoy into an open redirect.
      const here = new URL(global.location.href);
      if (parsed.origin !== here.origin) return "";
      return parsed.toString();
    } catch (error) {
      return "";
    }
  }

  /**
   * Forget the stored return point. The decoy calls this once it has used the
   * URL; graip calls it after restoring the shell state.
   */
  function clearReturnPoint() {
    try {
      if (global.sessionStorage) {
        global.sessionStorage.removeItem(RETURN_KEYS.url);
        global.sessionStorage.removeItem(RETURN_KEYS.state);
      }
    } catch (error) {
      /* ignore */
    }
  }

  /**
   * Record where graip is right now, so the decoy can put it back.
   *
   * @returns {{ url: string, state: object|null }} what was stored
   */
  function rememberReturnPoint() {
    const point = { url: "", state: null };

    try {
      point.url = String(global.location.href || "");
    } catch (error) {
      point.url = "";
    }

    try {
      if (global.GraipShellState && typeof global.GraipShellState.capture === "function") {
        point.state = global.GraipShellState.capture();
      }
    } catch (error) {
      log("warn", "could not capture the graip position", error);
    }

    try {
      if (global.sessionStorage) {
        if (point.url) global.sessionStorage.setItem(RETURN_KEYS.url, point.url);
        if (point.state) global.sessionStorage.setItem(RETURN_KEYS.state, JSON.stringify(point.state));
      }
    } catch (error) {
      log("warn", "could not store the panic return point", error);
    }

    return point;
  }

  function openInNewTab(url, cloak) {
    const win = global.open(url === "about:blank" ? "about:blank" : url, "_blank");
    if (!win) {
      log("warn", "popup blocked while panicking");
      return false;
    }
    if (url === "about:blank") {
      try {
        win.document.write(blankDocument(cloak));
        win.document.close();
      } catch (error) {
        log("warn", "could not write the about:blank decoy", error);
      }
    }
    try {
      win.opener = null;
    } catch (error) {
      /* ignore */
    }
    return true;
  }

  /**
   * Where the panic page lives. It is a tiny static document (no proxy, no CDN)
   * so it always loads, even when the network is filtered.
   */
  function decoyUrl(url, cloak, showDecoy) {
    const params = new URLSearchParams();
    params.set("to", url);
    params.set("cloak", cloak);
    if (!showDecoy) params.set("plain", "1");
    return `/panic.html?${params.toString()}`;
  }

  /**
   * Install the key listener. Safe to call on every page; the settings are read
   * at key time so a change in Settings applies without a reload.
   */
  function installPanicKey() {
    if (global.__graipPanicInstalled) return;
    global.__graipPanicInstalled = true;

    global.addEventListener("keydown", (event) => {
      if (!matches(event)) return;
      event.preventDefault();
      event.stopPropagation();
      panic({ reason: "key" });
    }, true);

    log("debug", "panic key listener installed", {
      enabled: settings().enabled,
      key: settings().key,
    });
  }

  /**
   * Open the current page inside a decoy about:blank window and leave a neutral
   * site in this tab. Used by the "Open in about:blank" button.
   *
   * @returns {boolean} whether the window was opened
   */
  function openAboutBlank() {
    const name = profileName();
    const disguise = name === "None" ? "Google Docs" : name;
    const win = global.open("about:blank", "_blank");

    if (!win) {
      log("warn", "about:blank was blocked by the popup blocker");
      if (typeof global.showToast === "function") {
        global.showToast("error", "The popup blocker stopped about:blank. Allow popups for this site.", "fas fa-triangle-exclamation");
      }
      return false;
    }

    try {
      const doc = win.document;
      doc.write(blankDocument(disguise));
      doc.close();
      doc.title = profile(disguise).title;
      doc.body.style.margin = "0";

      const frame = doc.createElement("iframe");
      frame.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0";
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.src = global.location.href;
      doc.body.appendChild(frame);

      win.opener = null;
    } catch (error) {
      log("error", "could not build the about:blank decoy", error);
      return false;
    }

    log("info", "about:blank opened", { cloak: disguise });
    global.location.replace("https://classroom.google.com/");
    return true;
  }

  /**
   * Auto about:blank: once per tab session, move everything into about:blank and
   * send this tab to a neutral page so history and filters see nothing.
   *
   * @returns {boolean} whether the redirect ran
   */
  function autoAboutBlank() {
    if (global.self !== global.top) return false;
    if (read("graip_autoAB", "no") !== "yes") return false;
    if (global.sessionStorage && global.sessionStorage.getItem("graip_abOpened") === "1") {
      // Already cloaked in this tab; do not loop on every navigation.
      return false;
    }

    const win = global.open("about:blank", "_blank");
    if (!win) {
      log("warn", "auto about:blank blocked by the popup blocker");
      return false;
    }

    try {
      const cloak = profileName();
      const doc = win.document;
      doc.write(blankDocument(cloak === "None" ? "Google Docs" : cloak));
      doc.close();
      win.document.title = profile(cloak === "None" ? "Google Docs" : cloak).title;

      const frame = doc.createElement("iframe");
      frame.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0";
      frame.src = global.location.href;
      doc.body.appendChild(frame);

      win.opener = null;
      if (global.sessionStorage) global.sessionStorage.setItem("graip_abOpened", "1");
      log("info", "auto about:blank opened", { cloak });
      global.location.replace("https://classroom.google.com/");
      return true;
    } catch (error) {
      log("error", "auto about:blank failed", error);
      return false;
    }
  }

  /**
   * True when this document is the visible half of an about:blank cloak, e.g. it
   * was opened from the panic page or from the about:blank button.
   *
   * @returns {boolean}
   */
  function isCloaked() {
    try {
      return Boolean(global.opener) && global.opener !== global;
    } catch (error) {
      return false;
    }
  }

  const api = {
    KEYS,
    RETURN_KEYS,
    PROFILES,
    TARGETS,
    PANIC_KEYS,
    DEFAULTS,
    settings,
    profile,
    profileName,
    applyCloak,
    blankDocument,
    decoyMarkup,
    targetUrl,
    matches,
    panic,
    rememberReturnPoint,
    storedReturnUrl,
    clearReturnPoint,
    installPanicKey,
    autoAboutBlank,
    isCloaked,
    decoyUrl,
    openAboutBlank,
  };

  global.GraipCloak = api;

  // Applying the saved disguise is cheap and must happen on every page: a tab
  // that says "graip" while inside a game defeats the point of cloaking.
  //
  // Pages that present their own disguise (panic.html) opt out: they get the
  // profile from the query string and set the title themselves.
  const autoCloak =
    typeof global.document !== "undefined" &&
    global.document.documentElement &&
    global.document.documentElement.dataset.graipNoAutoCloak !== "1";

  if (autoCloak) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", () => api.applyCloak(api.profileName()));
    } else {
      api.applyCloak(api.profileName());
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
