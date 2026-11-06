"use strict";

/**
 * Small-screen layout, offline shell and library hygiene.
 *
 * These are static assertions plus one worker harness: the point is to keep the
 * promises (desktop untouched, shell never caches proxied traffic, every tile has
 * a fallback) from silently regressing.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

/** Everything outside a media query, so "desktop changed" can be asserted. */
function outsideMediaQueries(css) {
  let depth = 0;
  let out = "";
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) out += char;
    if (char === "@" && css.slice(i, i + 6) === "@media") {
      // skip the whole block
      let cursor = css.indexOf("{", i);
      let nest = 0;
      for (; cursor < css.length; cursor++) {
        if (css[cursor] === "{") nest++;
        else if (css[cursor] === "}") {
          nest--;
          if (nest === 0) break;
        }
      }
      i = cursor;
    }
  }
  return out;
}

test("mobile_css_only_ever_applies_inside_a_media_query", () => {
  const css = read("assets/css/mobile.css");

  // strip comments, then make sure no declaration is at the top level
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const topLevel = outsideMediaQueries(stripped);
  assert.doesNotMatch(
    topLevel,
    /[.#][\w-]+\s*\{/,
    "mobile.css must not define top-level rules: it would change the desktop view"
  );
  assert.match(css, /@media \(max-width: 640px\)/);
});

test("new_index_css_does_not_touch_desktop_rules", () => {
  const css = read("styles/index.css");
  const marker = "Panic key / debug log additions";
  const additionStart = css.indexOf(marker);
  assert.ok(additionStart > 0, "the new settings styles should be appended");

  const addition = css.slice(additionStart);
  // the additions before the mobile section are new components only
  const beforeMobile = addition.split("Mobile / small-screen layout")[0];
  for (const selector of beforeMobile.matchAll(/^([.#][\w-]+)\s*\{/gm)) {
    assert.ok(
      /graip-toggle-slot|settings-select|settings-content-container|debug-|\.app/.test(selector[1]),
      `unexpected selector added to the desktop stylesheet: ${selector[1]}`
    );
  }

  // and everything after the mobile marker is inside a media query
  const mobileSection = addition.split("Mobile / small-screen layout")[1] || "";
  const stripped = mobileSection.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(outsideMediaQueries(stripped), /[.#][\w-]+\s*\{/);
});

test("critical_pages_load_the_mobile_stylesheet", () => {
  for (const page of [
    "pages/browser.html",
    "pages/browser-minimum.html",
    "pages/embed.html",
    "pages/play.html",
    "pages/vms.html",
    "pages/assistant.html",
  ]) {
    assert.match(read(page), /\/assets\/css\/mobile\.css/, `${page} has no small-screen layout`);
  }
});

test("manifest_is_valid_and_installable", () => {
  const manifest = JSON.parse(read("manifest.json"));

  assert.equal(manifest.start_url, "/?launch=1");
  assert.equal(manifest.scope, "/");
  assert.ok(["standalone", "minimal-ui"].includes(manifest.display));
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  for (const icon of manifest.icons) {
    assert.ok(
      fs.existsSync(path.join(ROOT, icon.src.split(/[?#]/, 1)[0].replace(/^\//, ""))),
      `manifest icon ${icon.src} does not exist`
    );
  }

  for (const page of ["index.html", "404.html", "newtab.html"]) {
    const source = read(page);
    assert.match(source, /rel="manifest"/, `${page} does not declare the manifest`);
    assert.match(source, /name="theme-color"/);
  }
});

function createWorkerHarness() {
  let fetchListener;
  const installHandlers = [];
  const activateHandlers = [];
  const listeners = new Map();
  const cached = new Map();
  const logs = [];

  const caches = {
    async open() {
      return {
        async add(request) {
          cached.set(request.url || request, true);
        },
        async put(request, response) {
          cached.set(request.url || request, response);
        },
      };
    },
    async match(request) {
      const key = request && request.url ? request.url : request;
      return cached.get(key) || null;
    },
    async keys() {
      return ["graip-shell-v1", "graip-shell-v0", "unrelated"];
    },
    async delete(name) {
      cached.set(`deleted:${name}`, true);
      return true;
    },
  };

  const context = vm.createContext({
    URL,
    Request: class Request {
      constructor(url, options) {
        this.url = url;
        this.options = options;
      }
    },
    Response,
    Promise,
    Set,
    Map,
    setTimeout,
    clearTimeout,
    caches,
    console: { error() {}, warn() {}, log() {} },
    navigator: { userAgent: "node-test" },
    $scramjetController: { shouldRoute: () => true, route: async () => new Response("proxied") },
    self: {
      location: { origin: "https://graip.test" },
      clients: { claim: async () => true, matchAll: async () => [] },
      skipWaiting() {
        context.skipped = true;
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
        if (type === "fetch") fetchListener = listener;
        if (type === "install") installHandlers.push(listener);
        if (type === "activate") activateHandlers.push(listener);
      },
    },
    fetch: async (request) => new Response("network:" + (request.url || request), { status: 200 }),
  });
  context.importScripts = () => {};
  vm.runInContext(read("sw.js"), context, { filename: "sw.js" });

  return {
    listeners,
    cached,
    logs,
    context,
    request(url, options = {}) {
      let responsePromise;
      const event = {
        request: {
          url,
          method: "GET",
          mode: options.mode || "navigate",
          headers: {
            get: (name) => (name === "accept" ? options.accept || "text/html" : null),
          },
        },
        respondWith(value) {
          responsePromise = Promise.resolve(value);
        },
        waitUntil(value) {
          context.pending = Promise.resolve(value);
        },
      };
      fetchListener(event);
      return responsePromise;
    },
    /** Run every install listener, like the browser does. */
    install() {
      return Promise.all(
        installHandlers.map((handler) => {
          let pending;
          handler({ waitUntil: (value) => (pending = Promise.resolve(value)) });
          return pending;
        })
      );
    },
    activate() {
      return Promise.all(
        activateHandlers.map((handler) => {
          let pending;
          handler({ waitUntil: (value) => (pending = Promise.resolve(value)) });
          return pending;
        })
      );
    },
  };
}

test("service_worker_takes_control_immediately", async () => {
  const harness = createWorkerHarness();

  // the install handler must register the shell cache and call skipWaiting()
  await harness.install();
  assert.equal(harness.context.skipped, true, "install must skipWaiting()");

  await harness.activate();
  assert.equal(harness.cached.get("deleted:graip-shell-v0"), true, "old shell caches are removed");
  assert.equal(harness.cached.get("deleted:unrelated"), undefined, "other caches are left alone");
});

test("service_worker_never_caches_proxied_traffic", async () => {
  const harness = createWorkerHarness();

  await harness.request("https://graip.test/~/sj/https%3A%2F%2Fblocked.test%2F");
  await harness.request("https://graip.test/uv/service/aHR0cHM6Ly9leGFtcGxlLmNvbQ==");

  const keys = [...harness.cached.keys()].filter((key) => !String(key).startsWith("deleted:"));
  assert.deepEqual(keys, [], "proxy requests must not be written to the shell cache");
});

test("service_worker_caches_the_shell_and_serves_it_offline", async () => {
  const harness = createWorkerHarness();

  // first visit: network responds and the shell entry is stored
  const first = await harness.request("https://graip.test/styles/index.css", { mode: "no-cors" });
  assert.match(await first.text(), /network:/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    [...harness.cached.keys()].some((key) => String(key).includes("styles/index.css")),
    "the shell asset should be cached"
  );
});

test("service_worker_reports_proxied_requests_to_the_page", () => {
  const source = read("sw.js");

  assert.match(source, /\$graip\$logConfig/, "the worker listens for the page's logging config");
  assert.match(source, /function sendLog\(entry\)/);
  assert.match(source, /"page loaded through the proxy"/);
  assert.doesNotMatch(
    source,
    /\$graip\$log: \{[\s\S]{0,200}(password|token|cookie)/i,
    "log reports must not include credentials"
  );
});

test("library_tiles_have_a_placeholder_when_the_thumbnail_fails", () => {
  const home = read("index.html");

  assert.match(home, /function showPlaceholder\(el, name\)/);
  assert.match(home, /probe\.onerror/, "thumbnails are probed so a broken one is detected");
  assert.match(home, /app-image-missing/);
  assert.match(home, /noteLibraryIssue\(/, "failures are recorded for the Debug panel");
  assert.match(home, /graip_libraryIssues/);

  // the debug panel can check the bundled lists on demand
  assert.match(read("assets/js/debug-panel.js"), /GraipCheckLibrary/);
  assert.match(read("index.html"), /GraipCheckLibrary\(this\)/);
});

test("library_lists_are_well_formed", () => {
  for (const file of ["apps.json", "classplay.json", "gn-math.json"]) {
    const items = JSON.parse(read(`assets/json/${file}`));
    assert.ok(Array.isArray(items), `${file} must be an array`);

    const broken = items.filter((item) => !item || !item.name || !item.url);
    assert.equal(broken.length, 0, `${file} has ${broken.length} entries without a name/url`);

    const seen = new Set();
    for (const item of items) {
      const key = `${item.name}|${item.url}`;
      assert.ok(!seen.has(key), `${file} has a duplicate entry: ${key}`);
      seen.add(key);
    }
  }
});

test("phone navigation fits a compact grid and toasts sit above the bottom bar", () => {
  const css = read("styles/index.css");
  const phoneRules = css.split("@media (max-width: 640px)")[1].split("@media (max-width: 640px) and (orientation: landscape)")[0];
  const toastCss = read("assets/css/t.css");
  assert.match(phoneRules, /grid-template-columns:\s*repeat\(8,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(phoneRules, /height:\s*48px/);
  assert.match(toastCss, /@media \(max-width: 640px\)[\s\S]*?\.toast-container\s*\{[\s\S]*?top:\s*auto !important;[\s\S]*?bottom:\s*calc\(48px/);
});

test("mobile home search icon sits inline with the placeholder and nav logo is centered", () => {
  const css = read("styles/index.css");
  const phoneRules = css.split("@media (max-width: 640px)")[1].split("@media (max-width: 640px) and (orientation: landscape)")[0];
  assert.match(phoneRules, /\.searchathome\s*\{[^}]*display:\s*flex/);
  assert.match(phoneRules, /\.searchathome\s*\{[^}]*margin-inline:\s*auto/);
  assert.match(phoneRules, /#homesearch\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(phoneRules, /nav ul li:first-child a\s*\{[^}]*margin:\s*0 !important/);
  assert.match(phoneRules, /nav ul li:first-child img\s*\{[^}]*margin:\s*0 !important/);
});

test("phone game drawer has search, a four-column icon grid, and a separate play dialog", () => {
  const html = read("index.html");
  const css = read("styles/index.css");
  assert.match(html, /id="games-search"/);
  assert.match(html, /class="games-container launcher-grid"/);
  assert.doesNotMatch(html, /class="games-container[^\"]*(?:w-\[|flex-wrap|absolute|left-1\/2)/);
  assert.match(html, /id="mobile-game-dialog"[\s\S]*?id="mobile-game-image"[\s\S]*?id="mobile-game-title"[\s\S]*?id="mobile-game-play"/);
  assert.match(html, /openMobileGame\(item\)/);
  assert.match(html, /graipOverlay=1/);
  assert.match(css, /\.games-wrapper > \.launcher-search\s*\{[\s\S]*?width:\s*100% !important/);
  assert.match(css, /\.games-wrapper > \.launcher-grid\s*\{[\s\S]*?display:\s*flex !important[\s\S]*?gap:\s*12px/);
  assert.match(css, /\.launcher-grid > \.app\s*\{[\s\S]*?flex:\s*0 0 calc\(\(100% - 36px\) \/ 4\) !important[\s\S]*?aspect-ratio:\s*1/);
  assert.match(css, /\.games-container \.game-launch-card::after/);
});

test("game overlay widgets are opt-in, lazy-load the mini browser, and exit to Graip", () => {
  const play = read("pages/play.html");
  const shell = read("index.html");
  const overlayCss = read("assets/css/overlay.css");
  assert.match(play, /const openedFromGamesMenu = urlParams\.get\('graipOverlay'\) === '1'/);
  assert.match(play, /useOverlay === "yes" && gameurl && openedFromGamesMenu/);
  assert.match(play, /id="browser-widget" hidden/);
  assert.doesNotMatch(play.match(/<section class="overlay-browser-window"[\s\S]*?<\/section>/)[0], /<iframe[^>]+src=/);
  assert.match(play, /if \(frame && !frame\.getAttribute\("src"\)\)/);
  assert.match(play, /exitGameToGraip\(\)/);
  assert.match(shell, /event\.data\.type === "graip-exit-game"\) navTo\("home\?launch=1"\)/);
  assert.match(overlayCss, /#gameOverlay\.active \.overlay-widget-toolbar/);
  assert.match(overlayCss, /\.overlay-widget-toggle\.is-on/);
});

test("theme changes rebuild enabled Vanta fog from the active palette", () => {
  const html = read("index.html");
  const dropdown = read("assets/js/dropdown.js");
  assert.match(html, /window\.graipRefreshFog = function/);
  assert.match(html, /function isFogEnabled\(\)[\s\S]*?getItem\("graip_particlesOn"\) !== "no"[\s\S]*?getItem\("graip_reduceMotion"\) !== "yes"/);
  assert.match(html, /document\.addEventListener\("themeUpdated"/);
  assert.match(html, /highlightColor: hexToNumber\(cssVar\("--accent"\)\)/);
  assert.match(html, /midtoneColor: hexToNumber\(cssVar\("--bg-2"\)\)/);
  assert.match(html, /const startFogAfterLayout = \(\) =>[\s\S]*?window\.graipStartFog\(\)[\s\S]*?document\.readyState === "loading"[\s\S]*?document\.addEventListener\("DOMContentLoaded", startFogAfterLayout/);
  assert.doesNotMatch(html, /window\.addEventListener\("load", startFogAfterLayout/);
  assert.match(dropdown, /theme: localStorage\.getItem\("graip_theme"\) \|\| "midnight"/);
  assert.match(dropdown, /Theme and fog colors updated/);
});

test("chatroom button is removed and AI chat reserves space below the shell toolbar", () => {
  const shell = read("index.html");
  const assistant = read("pages/assistant.html");
  const mobile = read("assets/css/mobile.css");
  const shellCss = read("styles/index.css");
  assert.doesNotMatch(shell, /data-page="chatrooms"/);
  assert.doesNotMatch(shell, /AI is in beta/);
  assert.match(shellCss, /repeat\(8, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(shell, /ri-discord-fill|discord\.gg/);
  assert.match(assistant, /<body class="assistant-page">/);
  assert.match(mobile, /assistant-page \.messages-container\s*\{\s*top:\s*68px/);
  assert.match(mobile, /assistant-page > \.container\s*\{\s*position:\s*fixed/);
  assert.match(mobile, /bottom: calc\(58px \+ env\(safe-area-inset-bottom/);
  assert.doesNotMatch(mobile, /#particles-container\s*\{\s*display:\s*none/);
});

test("settings version fade remains confined to the category rail", () => {
  const css = read("styles/index.css");
  const docs = read("AGENTS.md");
  assert.match(css, /\.settings-sidebar::after\s*\{[\s\S]*?backdrop-filter:\s*blur\(7px\)[\s\S]*?mask-image:\s*linear-gradient/);
  assert.match(css, /\.settings-sidebar::after \{ display: none; \}/);
  assert.match(css, /\.partners-wrapper\s*\{[\s\S]*?height:\s*auto;[\s\S]*?max-height:\s*70vh/);
  assert.match(css, /\.special-thanks-grid\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow-y:\s*auto/);
  assert.match(docs, /### 11\.2 Reading a settings JSON file/);
  assert.match(docs, /\| `graip_wispUrlCustom` \| User-supplied WebSocket endpoint/);
  assert.match(docs, /\| `graip_panicOpenIn` \| Whether panic opens in the same tab or a new tab/);
});

test("mobile apps share the compact squircle launcher grid and Discord is removed from navigation", () => {
  const shell = read("index.html");
  const css = read("styles/index.css");
  assert.doesNotMatch(shell, /ri-discord-fill|discord\.gg/);
  for (const page of ["pages/apps.html", "pages/games.html", "pages/movieframe.html", "pages/partners.html"]) {
    assert.doesNotMatch(read(page), /ri-discord-fill|discord\.gg/);
  }
  assert.match(css, /\.apps-wrapper > \.apps-container,[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.apps-container > \.app,[\s\S]*?aspect-ratio:\s*1/);
  assert.match(css, /\.apps-container > \.app::after/);
  assert.match(shell, /class="apps-container launcher-grid"/);
  assert.match(css, /\.apps-wrapper > \.launcher-grid,[\s\S]*?\.games-wrapper > \.launcher-grid\s*\{[\s\S]*?display:\s*flex !important[\s\S]*?gap:\s*12px/);
});

test("movies page has independent responsive layout and bounded visible loading state", () => {
  const movies = read("pages/movies.html");
  assert.doesNotMatch(movies, /cdn\.tailwindcss|alpinejs/);
  assert.match(movies, /assets\/js\/colors\.js/);
  assert.match(movies, /class="movie-status"[\s\S]*?Loading movies/);
  assert.match(movies, /AbortController\(\)/);
  assert.match(movies, /movie-search/);
  assert.match(movies, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(movies, /aria-pressed/);
});
