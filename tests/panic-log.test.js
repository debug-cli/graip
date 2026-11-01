"use strict";

/**
 * Debug log, panic key and tab sessions.
 *
 * These are behavioural, dependency-free tests: each module is loaded into a vm
 * context with a small fake browser, so the storage keys, the filtering rules and
 * the "never log a query string" guarantee are checked without jsdom.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

/** A minimal storage that behaves like localStorage for these tests. */
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function loadLog(overrides = {}) {
  const localStorage = overrides.localStorage || fakeStorage();
  const events = [];
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage,
    sessionStorage: overrides.sessionStorage || fakeStorage(),
    location: { href: "https://graip.test/pages/browser.html?url=https%3A%2F%2Fsecret.test" },
    navigator: { userAgent: "node-test", language: "en" },
    setTimeout,
    clearTimeout,
    URL,
    Blob: class Blob {},
    addEventListener() {},
    document: overrides.document || {
      readyState: "complete",
      createElement: () => ({ click() {}, remove() {}, set href(value) {}, download: "" }),
      body: { appendChild() {} },
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
    },
    URLSearchParams,
    Event: class Event {},
    CustomEvent: class CustomEvent {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("assets/js/log.js"), sandbox, { filename: "log.js" });
  return { log: sandbox.GraipLog, localStorage, events };
}

function loadCloak(overrides = {}) {
  const localStorage = overrides.localStorage || fakeStorage();
  const sessionStorage = overrides.sessionStorage || fakeStorage();
  const elements = new Map();
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    localStorage,
    sessionStorage,
    URL,
    URLSearchParams,
    addEventListener() {},
    setTimeout,
    clearTimeout,
    location: { href: "https://graip.test/?launch=1", replace: (url) => (sandbox.__replaced = url) },
    open: overrides.open || (() => null),
    document: {
      title: "graip",
      documentElement: { dataset: overrides.dataset || {} },
      readyState: "complete",
      addEventListener() {},
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: () => [],
      getElementById: (id) => elements.get(`#${id}`) || null,
      body: { appendChild() {}, style: {} },
    },
    Element: class Element {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("assets/js/cloak.js"), sandbox, { filename: "cloak.js" });
  return { cloak: sandbox.GraipCloak, sandbox, localStorage, sessionStorage, elements };
}

// ------------------------------------------------------------------ debug log

test("ui_clicks_are_logged_without_destinations_or_keyboard_events", () => {
  const listeners = {};
  const doc = {
    addEventListener: (name, callback) => { listeners[name] = callback; },
    createElement: () => ({ click() {}, remove() {}, set href(value) {}, download: "" }),
    body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  };
  const { log } = loadLog({ document: doc });
  const target = {
    tagName: "A", textContent: "Open site", href: "https://visited.example/path",
    closest: () => target, getAttribute: () => null,
  };
  listeners.click({ target });
  const entry = log.entries().find((item) => item.category === "ui");
  assert.ok(entry);
  assert.match(entry.message, /Open site/);
  assert.doesNotMatch(JSON.stringify(entry), /visited\.example/);
  assert.equal(listeners.keydown, undefined);
});

test("log_is_on_by_default_and_records_actions", () => {
  const { log } = loadLog();

  assert.equal(log.isVerbose(), true, "verbose logging must default to on");

  log.action("nav", "open movies");
  log.warn("wisp", "probe failed");

  // install() itself records one "debug log ready" entry
  const entries = log.entries().filter((entry) => entry.category !== "app");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].category, "nav");
  assert.equal(entries[1].level, "warn");
  assert.ok(entries[0].at.includes("T"), "entries carry an ISO timestamp");
  assert.ok(log.entries().some((entry) => entry.message.includes("debug log ready")));
});

test("log_verbose_off_keeps_warnings_and_errors", () => {
  const { log } = loadLog();

  log.setVerbose(false);
  const before = log.entries().length;

  log.debug("test", "routine noise");
  log.action("test", "clicked something");
  log.warn("test", "still recorded");
  log.error("test", "always recorded");

  const after = log.entries();
  assert.equal(after.length, before + 2);
  assert.equal(
    JSON.stringify(after.slice(-2).map((entry) => entry.level)),
    JSON.stringify(["warn", "error"])
  );
});

test("log_never_records_query_strings", () => {
  const { log } = loadLog();

  log.info("net", "request", { url: "https://site.test/page?token=abc#frag" });

  const text = log.exportText();
  assert.doesNotMatch(text, /token=abc/);
  assert.doesNotMatch(text, /#frag/);
  assert.match(text, /https:\/\/site\.test\/page/);
});

test("log_exports_valid_json_and_readeable_text", () => {
  const { log } = loadLog();
  log.info("app", "hello", { nested: { deep: { deeper: { tooDeep: true } } } });

  const parsed = JSON.parse(log.exportJSON());
  assert.equal(parsed.app, "graip");
  assert.equal(parsed.appVersion, 'v2.1.0 "juice"');
  assert.ok(parsed.entries.length >= 1);
  assert.equal(parsed.entries.at(-1).message, "hello");

  const text = log.exportText();
  assert.ok(text.startsWith("graip debug log"));
  assert.match(text, /graip version: v2\.1\.0 "juice"/);
  assert.match(text, /\[INFO\] \(app\) hello/);
});

test("log_survives_a_storage_that_throws", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };

  const { log } = loadLog({ localStorage: broken });
  assert.doesNotThrow(() => log.info("app", "still works"));
  assert.equal(log.entries().length >= 1, true);
});

test("log_clears_and_persists_through_storage", async () => {
  const localStorage = fakeStorage();
  const { log } = loadLog({ localStorage });

  log.info("app", "one");
  // the buffer is written on a short debounce so a burst of logs is one write
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.ok(localStorage.getItem("graip_debugLog"), "buffer is persisted for the next page load");

  log.clear();
  // clearing keeps exactly one entry: the "log cleared" note itself
  assert.equal(log.entries().length, 1);
  assert.equal(log.entries()[0].message, "log cleared");
  assert.equal(localStorage.getItem("graip_debugLog"), null);
});

test("every_first_party_page_captures_errors", () => {
  const pages = ["index.html", "404.html", "newtab.html"].concat(
    fs
      .readdirSync(path.join(ROOT, "pages"))
      .filter((file) => file.endsWith(".html") && file !== "classroom.html")
      .map((file) => `pages/${file}`)
  );

  for (const page of pages) {
    const source = read(page);
    assert.match(source, /\/assets\/js\/log\.js/, `${page} does not load the debug log`);
    assert.match(source, /\/assets\/js\/cloak\.js/, `${page} does not load the panic/cloak module`);
  }
});

// -------------------------------------------------------------------- panic

test("panic_is_off_until_enabled", () => {
  const { cloak } = loadCloak();
  const event = { key: "\\", target: { tagName: "BODY" } };

  assert.equal(cloak.settings().enabled, false);
  assert.equal(cloak.matches(event), false, "a disabled panic key must never fire");
});

test("panic_key_matches_the_configured_key_only", () => {
  const localStorage = fakeStorage();
  localStorage.setItem("graip_panicEnabled", "yes");
  localStorage.setItem("graip_panicKey", "\\");
  const { cloak } = loadCloak({ localStorage });

  assert.equal(cloak.matches({ key: "\\", target: { tagName: "BODY" } }), true);
  assert.equal(cloak.matches({ key: "Escape", target: { tagName: "BODY" } }), false);
  assert.equal(cloak.matches({ key: "z", target: { tagName: "BODY" } }), false);
});

test("panic_key_does_not_hijack_typing_or_shortcuts", () => {
  const localStorage = fakeStorage();
  localStorage.setItem("graip_panicEnabled", "yes");
  localStorage.setItem("graip_panicKey", "z");
  const { cloak } = loadCloak({ localStorage });

  assert.equal(cloak.matches({ key: "z", target: { tagName: "INPUT" } }), false);
  assert.equal(cloak.matches({ key: "z", ctrlKey: true, target: { tagName: "BODY" } }), false);
  assert.equal(cloak.matches({ key: "z", target: { tagName: "BODY" } }), true);
});

test("panic_resolves_the_target_and_the_decoy_url", () => {
  const localStorage = fakeStorage();
  localStorage.setItem("graip_panicTarget", "Classroom");
  localStorage.setItem("decoy", "Google Docs");
  const { cloak } = loadCloak({ localStorage });

  assert.equal(cloak.targetUrl(), "https://classroom.google.com/");

  localStorage.setItem("graip_panicTarget", "Custom URL…");
  localStorage.setItem("graip_panicTargetUrl", "docs.google.com/document/d/abc");
  assert.equal(cloak.targetUrl(), "https://docs.google.com/document/d/abc");

  // a javascript: URL must never become the panic destination
  localStorage.setItem("graip_panicTargetUrl", "javascript:alert(1)");
  assert.equal(cloak.targetUrl(), "about:blank");

  const url = cloak.decoyUrl("https://classroom.google.com/", "Google Docs", true);
  const params = new URL(url, "https://graip.test").searchParams;
  assert.equal(params.get("to"), "https://classroom.google.com/");
  assert.equal(params.get("cloak"), "Google Docs");
});

test("panic_replaces_the_tab_and_forgets_the_session", () => {
  const localStorage = fakeStorage();
  localStorage.setItem("graip_panicEnabled", "yes");
  const { cloak, sandbox, sessionStorage } = loadCloak({ localStorage });

  assert.equal(cloak.panic({ reason: "test" }), true);
  assert.match(sandbox.__replaced, /^\/panic\.html\?/);
  assert.equal(sessionStorage.getItem("graip_panicReturn"), "1");
});

test("panic_remembers_the_exact_return_point", () => {
  const localStorage = fakeStorage();
  localStorage.setItem("graip_panicEnabled", "yes");
  const { cloak, sandbox, sessionStorage } = loadCloak({ localStorage });

  // the shell publishes what it looked like before the document is replaced
  sandbox.GraipShellState = {
    capture: () => ({ view: "page", frameSrc: "/pages/browser.html", drawer: "settings", panel: "cloak" }),
  };

  cloak.panic({ reason: "test" });

  assert.equal(sessionStorage.getItem("graip_panicReturnUrl"), "https://graip.test/?launch=1");
  assert.deepEqual(JSON.parse(sessionStorage.getItem("graip_panicReturnState")), {
    view: "page",
    frameSrc: "/pages/browser.html",
    drawer: "settings",
    panel: "cloak",
  });

  // panicking is not "leaving on purpose": the confirm-leave guard must not
  // turn it into a browser dialog
  assert.equal(sessionStorage.getItem("graip_skipLeaveGuard"), "1");
});

test("the_stored_return_point_only_ever_points_back_at_this_site", () => {
  const localStorage = fakeStorage();
  localStorage.setItem("graip_panicEnabled", "yes");
  const { cloak, sessionStorage } = loadCloak({ localStorage });

  sessionStorage.setItem("graip_panicReturnUrl", "https://graip.test/?launch=1&page=games");
  assert.equal(cloak.storedReturnUrl(), "https://graip.test/?launch=1&page=games");

  // anything written by something else must not become an open redirect
  sessionStorage.setItem("graip_panicReturnUrl", "https://evil.test/phish");
  assert.equal(cloak.storedReturnUrl(), "");

  sessionStorage.setItem("graip_panicReturnUrl", "javascript:alert(1)");
  assert.equal(cloak.storedReturnUrl(), "");

  sessionStorage.removeItem("graip_panicReturnUrl");
  assert.equal(cloak.storedReturnUrl(), "", "no snapshot means no return target");
});

test("the_decoy_returns_to_graip_instead_of_history_back", () => {
  const panic = read("panic.html");

  // the return location comes from the snapshot, and replace() keeps the tab's
  // single history entry -- history.back() used to land on /start.html
  assert.match(panic, /function returnUrl\(\)/, "the decoy needs the stored return point");
  assert.match(panic, /GraipCloak\.storedReturnUrl\(\)/, "it must ask cloak.js for the URL");
  assert.match(panic, /location\.replace\(target\)/, "the return must replace, not push a new entry");
  assert.match(panic, /history\.back\(\)/, "history is still the last resort when nothing was stored");

  const leave = panic.slice(panic.indexOf("function leave("), panic.indexOf("function isLeaveKey("));
  assert.ok(
    leave.indexOf("location.replace(target)") < leave.indexOf("history.back()"),
    "the stored URL must win over history.back()"
  );
});

test("the_decoy_leaves_on_escape_or_on_the_configured_panic_key", () => {
  const panic = read("panic.html");

  assert.match(panic, /function isLeaveKey\(event\)/, "one place decides what leaves the decoy");
  assert.match(panic, /event\.key === "Escape"/, "Escape always works");
  assert.match(panic, /GraipCloak\.matches\(event\)/, "the panic key closes the decoy too");
  assert.match(panic, /addEventListener\("keydown", onKey, true\)/, "keys are caught before the page sees them");

  // a cross-origin target keeps the keyboard inside its own frame, so there
  // must be a pointer way out as well
  assert.match(panic, /hint\.addEventListener\("click"/, "the hint must be clickable");
  assert.match(panic, /body\.hint-on #hint\s*\{[^}]*pointer-events:\s*auto/s);
});

/**
 * Run the decoy page's own script against a fake document, so the return path is
 * exercised rather than pattern-matched. Only what panic.html touches exists
 * here; anything it never reaches is deliberately left out.
 */
function loadDecoy(options = {}) {
  const html = read("panic.html");
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const code = inline[inline.length - 1];

  const sessionStorage = options.sessionStorage || fakeStorage();
  const windowListeners = [];
  const hintListeners = [];
  let backCount = 0;

  const makeClassList = () => {
    const set = new Set();
    return {
      set,
      add: (name) => set.add(name),
      remove: (name) => set.delete(name),
      contains: (name) => set.has(name),
    };
  };

  const frame = {
    style: {},
    setAttribute() {},
    appendChild() {},
    addEventListener(type, handler) {
      if (type === "load") this.onload = handler;
    },
  };

  const hint = {
    textContent: "",
    title: "",
    append() {},
    addEventListener(type, handler) {
      if (type === "click") hintListeners.push(handler);
    },
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    URL,
    URLSearchParams,
    sessionStorage,
    setTimeout: () => 0,
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    history: {
      replaceState() {},
      back() {
        backCount++;
      },
    },
    location: {
      search: options.search || "?to=https%3A%2F%2Fclassroom.google.com%2F&cloak=Google",
      replace: (url) => (sandbox.__replaced = url),
    },
    addEventListener(type, handler) {
      if (type === "keydown") windowListeners.push(handler);
    },
    GraipLog: {
      info() {},
      debug() {},
      warn() {},
      error() {},
      safeUrl: (url) => url,
    },
    GraipCloak: {
      settings: () => ({ key: options.panicKey || "\\" }),
      profile: () => null,
      storedReturnUrl: () => options.returnUrl || "",
      matches: (event) => Boolean(options.panicKeyMatches && options.panicKeyMatches(event)),
      blankDocument: () => "",
    },
    document: {
      title: "Google",
      body: { classList: makeClassList() },
      getElementById: (id) =>
        ({ stage: { appendChild() {}, style: {} }, blackout: { style: {} }, hint, tabIcon: { href: "" } })[id] || null,
      createElement: (tag) => (tag === "iframe" ? frame : { style: {}, setAttribute() {}, appendChild() {}, textContent: "" }),
      createTextNode: (text) => ({ text }),
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "panic.html" });

  const press = (event) => {
    const keys = windowListeners;
    for (const handler of keys) handler(event);
  };

  return { sandbox, sessionStorage, press, hint, hintListeners, back: () => backCount };
}

const keyEvent = (key) => ({ key, preventDefault() {}, stopPropagation() {} });

test("the_decoy_returns_to_the_snapshot_url_on_escape", () => {
  const sessionStorage = fakeStorage();
  const { sandbox, press } = loadDecoy({
    sessionStorage,
    returnUrl: "https://graip.test/?launch=1&page=games",
  });
  sessionStorage.setItem("graip_panicReturnUrl", "https://graip.test/?launch=1&page=games");

  press(keyEvent("Escape"));

  assert.equal(
    sandbox.__replaced,
    "https://graip.test/?launch=1&page=games",
    "Escape must reopen graip where it was, not navigate to start.html"
  );
  assert.equal(sessionStorage.getItem("graip_panicReturnUrl"), null, "the return point is used once");
});

test("the_decoy_also_leaves_on_the_configured_panic_key", () => {
  const { sandbox, press } = loadDecoy({
    panicKey: "\\",
    panicKeyMatches: (event) => event.key === "\\",
    returnUrl: "https://graip.test/?launch=1",
  });

  press(keyEvent("\\"));

  assert.equal(sandbox.__replaced, "https://graip.test/?launch=1");
});

test("the_decoy_falls_back_to_history_when_nothing_was_stored", () => {
  const { sandbox, press, back } = loadDecoy({ returnUrl: "" });

  press(keyEvent("Escape"));

  assert.equal(sandbox.__replaced, undefined, "nothing to reopen");
  assert.equal(back(), 1, "history is the last resort");
});

test("the_decoy_ignores_keys_it_was_not_asked_to_watch", () => {
  const { sandbox, press } = loadDecoy({ returnUrl: "https://graip.test/?launch=1" });

  press(keyEvent("a"));
  press(keyEvent("Enter"));

  assert.equal(sandbox.__replaced, undefined);
});

/**
 * Run the shell's `GraipShellState` module against a fake document, so restoring
 * the place is exercised rather than pattern-matched.
 */
function loadShellState(options = {}) {
  const home = read("index.html");
  const start = home.indexOf("window.GraipShellState = (function () {");
  const end = home.indexOf("function rSearch(input) {", start);
  assert.ok(start > 0 && end > start, "GraipShellState must be findable in index.html");

  const classList = (initial = []) => {
    const set = new Set(initial);
    return {
      add: (name) => set.add(name),
      remove: (name) => set.delete(name),
      contains: (name) => set.has(name),
    };
  };

  const frame = { style: {}, src: "", attrs: {}, getAttribute(name) { return this.attrs[name] || ""; } };
  const homeContent = { style: {} };
  const nav = { style: {} };
  const homeBtn = { style: {} };
  const settingsHolder = { classList: classList(["settings-hidden"]) };
  const appsHolder = { classList: classList(["settings-hidden"]) };
  const providers = {
    settings: settingsHolder,
    apps: appsHolder,
    games: { classList: classList(["settings-hidden"]) },
    partners: { classList: classList(["settings-hidden"]) },
    download: { classList: classList(["settings-hidden"]) },
  };

  const calls = [];
  const sessionStorage = options.sessionStorage || fakeStorage();
  const documentListeners = [];

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    sessionStorage,
    scrollY: 40,
    scrollTo: (x, y) => calls.push(["scrollTo", y]),
    addEventListener(type, handler) {
      if (type === "DOMContentLoaded") documentListeners.push(handler);
    },
    GraipCloak: {
      // mirrors cloak.js#clearReturnPoint: the snapshot is consumed, not kept
      clearReturnPoint: () => {
        calls.push(["clearReturnPoint"]);
        sessionStorage.removeItem("graip_panicReturnUrl");
        sessionStorage.removeItem("graip_panicReturnState");
      },
    },
    GraipLog: { info() {}, debug() {}, warn() {}, error() {} },
    switchSettingsPage: (name) => calls.push(["panel", name]),
    toggleSettings: () => {
      const hidden = settingsHolder.classList.contains("settings-hidden");
      settingsHolder.classList.remove(hidden ? "settings-hidden" : "settings-shown");
      settingsHolder.classList.add(hidden ? "settings-shown" : "settings-hidden");
      calls.push(["toggleSettings"]);
    },
    toggleApps: () => calls.push(["toggleApps"]),
    document: {
      getElementById: (id) =>
        ({ contentFrame: frame, homeContent, gohomeblock: homeBtn })[id] || null,
      querySelector: (selector) => {
        if (selector === "nav") return nav;
        if (selector === ".settings-page.settings-active") return options.activePanel || null;
        const match = selector.match(/^\.([a-z-]+)$/);
        if (!match) return null;
        const byClass = {
          "settings-container": providers.settings,
          "apps-wrapper": providers.apps,
          "games-wrapper": providers.games,
          "partners-wrapper": providers.partners,
          "download-wrapper": providers.download,
        };
        return byClass[match[1]] || null;
      },
      body: { contains: (node) => node !== frame || options.frameInBody !== false },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(home.slice(start, end), sandbox, { filename: "index.html#GraipShellState" });

  const boot = () => {
    for (const handler of documentListeners) handler();
  };

  return { state: sandbox.GraipShellState, calls, sessionStorage, frame, homeContent, nav, homeBtn, settingsHolder, boot };
}

test("the_shell_ignores_a_snapshot_from_long_ago", () => {
  const sessionStorage = fakeStorage();
  sessionStorage.setItem(
    "graip_panicReturnState",
    JSON.stringify({
      at: Date.now() - 10 * 60 * 1000,
      view: "page",
      frameSrc: "/pages/games.html",
      frameInBody: true,
    })
  );

  const { frame, boot } = loadShellState({ sessionStorage, frameInBody: true });
  boot();

  assert.equal(frame.src, "", "a ten-minute-old snapshot must not hijack the tab");
  assert.equal(sessionStorage.getItem("graip_panicReturnState"), null, "it is still cleaned up");
});

test("the_shell_captures_where_the_user_is", () => {
  const { state, settingsHolder } = loadShellState({ frameInBody: true });
  settingsHolder.classList.remove("settings-hidden");
  settingsHolder.classList.add("settings-shown");

  const snapshot = state.capture();

  assert.equal(snapshot.view, "home", "a pristine shell is on the home screen");
  assert.equal(snapshot.drawer, "settings");
  assert.equal(snapshot.scrollY, 40);
  assert.equal(typeof snapshot.at, "number");
});

test("the_shell_replays_a_snapshot_after_a_panic", () => {
  const { state, calls, frame, homeContent, settingsHolder } = loadShellState({ frameInBody: true });

  const restored = state.restore({
    view: "page",
    frameSrc: "/pages/browser.html",
    frameInBody: true,
    frameDisplay: "block",
    homeDisplay: "none",
    navDisplay: "block",
    navOpacity: "1",
    homeBtnDisplay: "block",
    drawer: "settings",
    panel: "proxy",
    scrollY: 0,
  });

  assert.equal(restored, true);
  assert.equal(frame.src, "/pages/browser.html", "the open page must come back");
  assert.equal(homeContent.style.display, "none", "the home screen stays hidden");
  assert.ok(calls.some(([name]) => name === "toggleSettings"), "the settings sheet must reopen");
  assert.equal(settingsHolder.classList.contains("settings-shown"), true);
  assert.deepEqual(calls.find(([name]) => name === "panel"), ["panel", "proxy"], "the panel must come back");
});

test("the_shell_restores_once_and_forgets_the_snapshot", () => {
  const sessionStorage = fakeStorage();
  sessionStorage.setItem(
    "graip_panicReturnState",
    JSON.stringify({
      view: "page",
      frameSrc: "/pages/games.html",
      frameInBody: true,
      homeDisplay: "none",
      drawer: null,
      panel: "",
    })
  );

  const { state, calls, frame, boot } = loadShellState({ sessionStorage, frameInBody: true });

  boot();

  assert.equal(frame.src, "/pages/games.html");
  assert.ok(calls.some(([name]) => name === "clearReturnPoint"), "the snapshot is consumed");
  assert.equal(sessionStorage.getItem("graip_panicReturnState"), null);

  // a second boot must not re-apply anything
  frame.src = "";
  boot();
  assert.equal(frame.src, "", "an empty snapshot does nothing");

  assert.equal(state.capture().view, "page", "the restored view is what gets captured next");
});

test("the_shell_can_snapshot_and_restore_its_place", () => {
  const home = read("index.html");

  assert.match(home, /window\.GraipShellState = \(function \(\)/, "the shell publishes its state");
  assert.match(home, /capture\(\)\s*\{/, "capture() records the place");
  assert.match(home, /function restore\(state\)/, "restore() replays it");
  assert.match(home, /frame\.src = state\.frameSrc/, "the open page goes back into the frame");
  assert.match(home, /switchSettingsPage\(state\.panel\)/, "the settings panel comes back too");
  assert.match(home, /graip_panicReturnState/, "the snapshot is read back on the next boot");
  assert.match(
    home,
    /window\.addEventListener\("DOMContentLoaded", resume\)/,
    "the restore must run after the deep-link handler"
  );
});

test("panic_new_tab_mode_opens_a_window_instead_of_replacing_the_page", () => {
  const localStorage = fakeStorage();
  localStorage.setItem("graip_panicOpenIn", "new-tab");
  let opened = null;
  const { cloak, sandbox } = loadCloak({
    localStorage,
    open: (url) => {
      opened = url;
      return { document: { write() {}, close() {}, title: "", body: { appendChild() {} }, createElement: () => ({ style: {} }) } };
    },
  });

  cloak.panic({ reason: "test" });
  assert.equal(opened, "https://classroom.google.com/");
  assert.equal(sandbox.__replaced, undefined, "the current page must stay");
});

test("panic_page_stays_black_until_the_target_loads", () => {
  const panic = read("panic.html");

  assert.match(panic, /#blackout\s*\{[^}]*background:\s*#000/s, "the loading screen must be black");
  assert.match(panic, /body\.revealed #blackout/, "the black screen is only removed after a reveal");
  assert.match(
    panic,
    /frame\.addEventListener\(\s*"load",[\s\S]*?settle\(\)/,
    "the reveal waits for the frame to load"
  );
  assert.match(panic, /HARD_TIMEOUT/, "a target that never loads must still be revealed");
  assert.match(panic, /requestAnimationFrame\(\(\) => requestAnimationFrame/, "same-origin decoys wait for a paint");
  assert.match(panic, /Escape/, "the decoy must be escapable");
});

test("cloak_profiles_cover_title_icon_and_decoy_page", () => {
  const { cloak } = loadCloak();

  for (const [name, profile] of Object.entries(cloak.PROFILES)) {
    assert.ok(profile.title, `${name} needs a title`);
    assert.ok(profile.icon, `${name} needs an icon`);
    assert.ok(profile.page, `${name} needs a decoy page kind`);
  }

  const html = cloak.blankDocument("Google Docs");
  assert.match(html, /Untitled document/, "the decoy window shows a document, not a blank page");
});

// ------------------------------------------------------------------ omnibox

const browserSource = read("assets/js/browserfunctions.js");

function loadBrowserHelpers(sessionSeed) {
  const start = browserSource.indexOf("const TAB_STORAGE_PREFIX");
  const end = browserSource.indexOf("function nav(i) {");
  const omniboxStart = browserSource.indexOf("function resolveOmniboxInput");
  const omniboxEnd = browserSource.indexOf("function b() {", omniboxStart);

  const sessionStorage = fakeStorage();
  if (sessionSeed) sessionStorage.setItem("graip_tabs:/pages/browser.html", JSON.stringify(sessionSeed));

  const tabsContainer = {
    children: [],
    insertBefore(node) {
      this.children.push(node);
    },
  };
  const created = [];

  const sandbox = {
    URL,
    URLSearchParams,
    Promise,
    console: { log() {}, error() {} },
    sessionStorage,
    localStorage: fakeStorage(),
    setTimeout,
    clearTimeout,
    graipLog: { d() {}, i() {}, w() {}, e() {}, a() {} },
    scramjetFrames: new Map(),
    scramjetFrameFor: async () => ({ go() {} }),
    aTab: 0,
    tabCounter: 1,
    bTabs: [],
    go: () => {},
    showToast: () => {},
    window: { location: { pathname: "/pages/browser.html" } },
    document: {
      querySelector(selector) {
        if (selector === ".tabs") return tabsContainer;
        if (selector === ".newtab") return created[0] || null;
        return null;
      },
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement(tag) {
        const node = {
          tagName: tag.toUpperCase(),
          dataset: {},
          style: {},
          classList: { add() {}, toggle() {} },
          innerHTML: "",
          children: [],
          setAttribute() {},
          addEventListener() {},
          appendChild() {},
          insertBefore() {},
          querySelector: () => ({
            textContent: "",
            addEventListener() {},
            classList: { add() {}, toggle() {} },
          }),
          remove() {},
        };
        created.push(node);
        return node;
      },
      body: { appendChild() {} },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(
    `${browserSource.slice(start, end)}
     ${browserSource.slice(omniboxStart, omniboxEnd)}
     globalThis.__api = { restoreTabSession, clearTabSession, saveTabSession, newTab, resolveOmniboxInput };
     globalThis.__state = { get bTabs() { return bTabs; }, get aTab() { return aTab; } };`,
    sandbox,
    { filename: "browserfunctions-tab-session-test.js" }
  );

  return { api: sandbox.__api, state: sandbox.__state, sessionStorage };
}

test("tab_session_restore_rebuilds_the_previous_tabs", () => {
  const { api, state, sessionStorage } = loadBrowserHelpers({
    active: 2,
    counter: 3,
    tabs: [
      { id: 1, title: "Docs", url: "https://docs.example/", history: ["https://docs.example/"], historyIndex: 0 },
      { id: 2, title: "Games", url: "https://games.example/", history: [], historyIndex: -1 },
    ],
  });

  const restored = api.restoreTabSession();
  assert.equal(restored, 2);
  assert.equal(state.bTabs.length, 2);
  assert.equal(state.bTabs[0].title, "Docs");
  assert.equal(state.bTabs[0].url, "https://docs.example/");
  assert.equal(state.aTab, 2, "the previously active tab is selected again");
  assert.ok(sessionStorage.getItem("graip_tabs:/pages/browser.html"));
});

test("tab_session_restore_falls_back_to_one_blank_tab", () => {
  const { api, state } = loadBrowserHelpers(null);

  api.restoreTabSession();
  assert.equal(state.bTabs.length, 1, "no saved session still leaves a usable tab");
});

test("clearing_session_traces_removes_the_saved_tabs", () => {
  const { api, sessionStorage } = loadBrowserHelpers({
    active: 1,
    counter: 2,
    tabs: [{ id: 1, title: "Secret", url: "https://secret.example/", history: [], historyIndex: -1 }],
  });

  assert.ok(sessionStorage.getItem("graip_tabs:/pages/browser.html"));
  api.clearTabSession();
  assert.equal(sessionStorage.getItem("graip_tabs:/pages/browser.html"), null);
});

test("omnibox_shortcuts_and_bangs", () => {
  const { api } = loadBrowserHelpers(null);

  assert.equal(api.resolveOmniboxInput("example.com"), "https://example.com");
  assert.equal(api.resolveOmniboxInput("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.match(api.resolveOmniboxInput("cat pictures"), /^https:\/\/google\.com\/search\?q=cat%20pictures$/);
  assert.match(api.resolveOmniboxInput("!yt lofi"), /^https:\/\/www\.youtube\.com\/results\?search_query=lofi$/);
  assert.match(api.resolveOmniboxInput("!w entropy"), /^https:\/\/en\.wikipedia\.org\//);
  assert.match(api.resolveOmniboxInput("!gh react"), /^https:\/\/github\.com\/search\?q=react$/);

  // shortcuts are wired, not just defined
  assert.match(browserSource, /installOmnibox\(\)/);
  assert.match(browserSource, /key === "l"/);
  assert.match(browserSource, /key === "t"/);
  assert.match(browserSource, /key === "w"/);
  assert.match(browserSource, /arrowleft/);
});
