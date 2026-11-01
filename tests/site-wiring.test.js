"use strict";

/**
 * Site-level wiring checks for the homepage shell and the pages it loads into
 * the content frame. Game/store bundles under stores/ are third-party drops and
 * are intentionally out of scope.
 *
 * These exist because the rebrand from Cherri to Graip (plus the tab-bar edits)
 * broke things that no unit test touched:
 *   - the Movies tab on the homepage pointed at an external site instead of
 *     opening the built-in movie browser;
 *   - the Settings entry in the Games/Apps/Partners/Movies side menus pointed at
 *     /pages/settings.html, which has never existed in this repository;
 *   - two settings sidebar buttons addressed panel ids that did not exist, so
 *     clicking them blanked the whole settings area.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

/**
 * Every page this site owns. `stores/` is vendored game content, and
 * `start.html` is the Google Classroom disguise (a copy of Classroom's own
 * markup whose links are decoration, not routes), so neither is checked here.
 */
const PAGES = ["index.html", "404.html", "newtab.html"].concat(
  fs
    .readdirSync(path.join(ROOT, "pages"))
    .filter((file) => file.endsWith(".html"))
    .map((file) => `pages/${file}`)
);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function exists(ref) {
  const clean = ref.split(/[?#]/)[0];
  if (!clean || clean.endsWith("/")) return true;
  return fs.existsSync(path.join(ROOT, clean.replace(/^\//, "")));
}

test("local asset references in first-party pages resolve", () => {
  const missing = [];

  for (const page of PAGES) {
    const source = read(page);
    const pattern = /(?:src|href)\s*=\s*"(\/[^"#?]*)"/g;
    let match;

    while ((match = pattern.exec(source))) {
      // protocol-relative URLs are external
      if (match[1].startsWith("//")) continue;
      if (!exists(match[1])) missing.push(`${page} -> ${match[1]}`);
    }
  }

  assert.deepEqual(missing, [], `broken first-party references:\n${missing.join("\n")}`);
});

test("homepage splashes load from the colocated plain-text list", () => {
  const shell = read("index.html");
  const loader = read("assets/splashes/splash.js");
  const list = read("assets/splashes/splashes.txt");
  const worker = read("sw.js");
  const phrases = list.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  assert.ok(shell.includes('src="/assets/splashes/splash.js"'));
  assert.ok(!shell.includes('src="/assets/js/splash.js"'));
  assert.ok(loader.includes('fetch("/assets/splashes/splashes.txt")'));
  assert.ok(loader.includes("document.createTextNode"));
  assert.ok(loader.includes("noopener noreferrer"));
  assert.doesNotMatch(loader, /\.innerHTML\s*=/);
  assert.ok(phrases.includes("free snacks at level 10"));
  assert.ok(phrases.includes("Also try [VAPOR!](https://vapor.my/)"));
  assert.ok(worker.includes('"/assets/splashes/splash.js"'));
  assert.ok(worker.includes('"/assets/splashes/splashes.txt"'));
});

test("README badges use shieldcn for this repo and contain no shields.io images", () => {
  const source = read("README.md");

  assert.doesNotMatch(source, /shields\.io/);
  assert.ok(source.includes("shieldcn.dev/github/stars/debug-cli/graip.svg"));
  assert.ok(source.includes("shieldcn.dev/github/license/debug-cli/graip.svg"));
  assert.ok(!source.includes("vercel/next.js"));
  assert.ok(source.includes("Tests: 137 passing"));
});

test("README renders a compact homepage screenshot, animated title, and changelog link", () => {
  const source = read("README.md");

  assert.ok(source.includes("readme-typing-svg.herokuapp.com/?font=JetBrains+Mono&amp;size=52&amp;duration=5000&amp;pause=1800&amp;repeat=true&amp;center=true&amp;vCenter=true&amp;width=500&amp;height=90&amp;lines=graip&amp;color=A78BFA"));
  assert.ok(source.includes('alt="graip"'));
  assert.ok(source.includes('<img src="assets/img/readme-homepage.png" width="780" alt="graip homepage screenshot">'));
  assert.ok(fs.existsSync(path.join(ROOT, "assets/img/readme-homepage.png")));
  assert.ok(source.includes('href="#changelog">Changelog</a>'));
});

test("homepage top bar opens the built-in movie browser", () => {
  const source = read("index.html");

  assert.match(
    source,
    /<a onclick="navTo\('movies'\)" href="#" data-page="movies">/,
    "the Movies tab must navigate to the built-in movies page"
  );
  assert.doesNotMatch(
    source,
    /stellar\.gdn/,
    "the Movies tab should not hand traffic to an external site"
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, "pages/movies.html")),
    "pages/movies.html is the page the Movies tab loads"
  );
});

test("every navTo('page') target exists", () => {
  const missing = [];
  const pattern = /navTo\('([^']+)'\)/g;

  for (const page of PAGES) {
    const source = read(page);
    let match;

    while ((match = pattern.exec(source))) {
      const target = match[1];

      // home handling and pre-built play URLs are not page names
      if (target.startsWith("home")) continue;
      if (target.includes(".html")) continue;

      if (!fs.existsSync(path.join(ROOT, "pages", `${target}.html`))) {
        missing.push(`${page} -> pages/${target}.html`);
      }
    }
  }

  assert.deepEqual(missing, [], `navTo targets without a page:\n${missing.join("\n")}`);
});

test("side menus open the real settings panel", () => {
  const embedded = [
    "pages/apps.html",
    "pages/games.html",
    "pages/partners.html",
    "pages/movieframe.html",
  ];

  for (const page of embedded) {
    assert.doesNotMatch(
      read(page),
      /href="\/pages\/settings\.html"/,
      `${page} links to a settings page that does not exist`
    );
    assert.match(
      read(page),
      /href="\/\?launch=1&amp;settings=1" target="_top"/,
      `${page} should deep link to the homepage settings panel`
    );
  }

  // ...and the homepage has to understand that deep link.
  const home = read("index.html");
  assert.match(home, /params\.get\("settings"\)/);
  assert.match(home, /params\.get\("launch"\)/);
});

test("settings sidebar targets real panels", () => {
  const home = read("index.html");
  const panelIds = new Set(
    Array.from(home.matchAll(/id="settings-([a-z-]+)"/g), (m) => m[1])
  );
  const targets = new Set(
    Array.from(home.matchAll(/data-target="([a-z-]+)"/g), (m) => m[1])
  );

  assert.ok(panelIds.size >= 5, "expected the settings panels to exist");

  for (const target of targets) {
    assert.ok(
      panelIds.has(target),
      `settings sidebar target "${target}" has no #settings-${target} panel`
    );
  }

  // every switchSettingsPage('x') literal must address a panel too
  for (const [, target] of home.matchAll(/switchSettingsPage\('([a-z-]+)'\)/g)) {
    assert.ok(
      panelIds.has(target),
      `switchSettingsPage('${target}') addresses a missing panel`
    );
  }
});

test("scramjet and ultraviolet service workers are both registered where the browser runs", () => {
  for (const page of ["index.html", "pages/browser.html", "pages/browser-minimum.html"]) {
    const source = read(page);
    assert.match(source, /\/sw\.js/, `${page} never registers Scramjet's worker`);
  }
  assert.match(read("index.html"), /\/uv\/sw\.js/);
});

test("no first-party page navigates to a page that does not exist", () => {
  // 404.html used to send searches to /pages/ultraviolet.html, a file that has
  // never existed here, so every search from the not-found page hit a 404.
  const seen = new Set();
  const broken = [];

  for (const page of PAGES.concat("panic.html")) {
    const source = read(page);
    for (const [, target] of source.matchAll(/["'`]\/?(pages\/[A-Za-z0-9_-]+\.html)/g)) {
      seen.add(target);
      if (!exists(target)) broken.push(`${page} -> ${target}`);
    }
  }

  assert.deepEqual(broken, [], `pages referenced but missing: ${broken.join(", ")}`);
  assert.ok(seen.has("pages/browser.html"), "expected the browser page to be referenced somewhere");
  assert.ok(seen.has("pages/play.html"), "expected the play page to be referenced somewhere");
});

test("the visitor counter degrades instead of throwing when its endpoint is gone", () => {
  const home = read("index.html");

  // the endpoint belongs to the upstream author and no longer answers
  assert.match(home, /api\.x8r\.dev\/api\/umami/);
  const block = home.slice(home.indexOf("async function getActiveUsers"), home.indexOf("userCountTimer = setInterval"));
  assert.match(block, /try \{/, "the counter fetch must be guarded");
  assert.match(block, /catch \(error\)/, "a dead endpoint must not become an unhandled rejection");
  assert.match(block, /clearInterval\(userCountTimer\)/, "a dead endpoint should stop being polled");
  assert.match(block, /GraipLog/, "the failure must be recorded in the debug log");
});

test("the shell document head is well formed and does not load anything twice", () => {
  // index.html carried a stray `</html>` in the middle of <head>: the parser
  // treats it as "close head", so the manifest link and every apple-mobile-web-app
  // meta silently landed in <body> and the real </head> became a no-op. The
  // Tailwind CDN was also requested twice.
  const home = read("index.html");
  const head = home.slice(home.indexOf("<head>"), home.indexOf("</head>"));

  assert.ok(head.length > 0, "index.html must have a <head> block");
  assert.ok(!/<\/html>/i.test(head), "a stray </html> inside <head> breaks document structure");
  assert.ok(!/<\/head>/i.test(head.slice(0, -1)), "head is closed twice");
  assert.match(head, /<link rel="manifest" href="\/manifest\.json">/);
  assert.match(head, /name="theme-color"/);

  // newtab.html had the same duplicated Tailwind request.
  for (const page of PAGES) {
    const source = read(page);
    const srcs = [...source.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    const dupes = [...new Set(srcs.filter((src, index) => srcs.indexOf(src) !== index))];
    assert.deepEqual(dupes, [], `${page} loads the same script more than once: ${dupes.join(", ")}`);
  }
});

test("the release version is 2.1.0 \"juice\" everywhere it is written", () => {
  const home = read("index.html");

  // one stamp drives the update toast, two places show it to a human
  assert.match(
    home,
    /<graipattr version="s2\.1\.0"><\/graipattr>/,
    "the site version stamp must be s2.1.0"
  );
  assert.match(home, /v2\.1\.0 (?:&ldquo;|“)juice(?:&rdquo;|”)<\/a>/, "the settings footer shows the release");
  assert.match(home, /What's New in v2\.1\.0 (?:&ldquo;|“)juice(?:&rdquo;|”)/, "the Updates panel names it");

  const readme = read("README.md");
  assert.match(readme, /^### v2\.1\.0 "juice" — introduced 2026-11-01$/m, "the new release date is recorded");
  assert.match(readme, /^### v2\.0\.0 "juice" — introduced 2026-10-26$/m, "the previous release is dated");
  assert.match(read("AGENTS.md"), /Every README release heading must include the date/);

  // no first-party file may still advertise the old release
  const files = ["index.html", "404.html", "newtab.html", "panic.html", "manifest.json", "README.md", "AGENTS.md"]
    .concat(fs.readdirSync(path.join(ROOT, "pages")).filter((f) => f.endsWith(".html")).map((f) => `pages/${f}`))
    .concat(fs.readdirSync(path.join(ROOT, "assets/js")).filter((f) => f.endsWith(".js")).map((f) => `assets/js/${f}`))
    .concat(["sw.js"]);

  const stale = [];
  for (const file of files) {
    const source = read(file);
    if (/\bs1\.\d+\.\d+\b|\bv1\.1\.1\b|Release 1\.1\.1/.test(source)) stale.push(file);
  }
  assert.deepEqual(stale, [], `still advertising the old version: ${stale.join(", ")}`);

  // the shell cache name carries the release so a new build retires the old one
  assert.match(read("sw.js"), /const SHELL_CACHE = "graip-shell-v8";/);
});

test("special thanks lists the README credits and settings categories can scroll", () => {
  const html = read("index.html");
  const css = read("styles/index.css");
  const thanks = html.slice(html.indexOf('class="partners-wrapper'), html.indexOf('<button id="reset-theme"'));
  assert.match(thanks, /Special Thanks/);
  for (const name of ["x8r · Cherri", "debug-cli", "MercuryWorkshop", "ading2210", "Titanium Network", "waves.lat", "binbashbanana"])
    assert.ok(thanks.includes(name), `missing credit ${name}`);
  assert.match(thanks, /href="https:\/\/github\.com\/debug-cli"[^>]*><img src="https:\/\/github\.com\/debug-cli\.png\?size=160"/);
  assert.ok(thanks.includes("<span>debug-cli<br>(saint)</span>"), "the saint label sits under the debug-cli profile card");
  assert.doesNotMatch(thanks, /Prism|Hydra Network/);
  assert.match(html, /class="settings-sidebar vflex"[^>]*aria-label="Settings categories"/);
  assert.match(css, /\.settings-sidebar\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /#homeContent h1\s*\{[^}]*overflow:\s*visible/s);
  assert.equal(fs.existsSync(path.join(ROOT, ".github/workflows/sync-fork.yml")), false);
});

test("reduced motion is persisted and disables related visual effects accessibly", () => {
  const html = read("index.html");
  const css = read("styles/index.css");
  const script = read("assets/js/cursor.js");
  assert.match(html, /id="reduce-motion-toggle"[^>]*onchange="updateReducedMotion\(\)"/);
  assert.match(html, /data-motion-feature="fog"[\s\S]*?motion-disabled-note/);
  assert.match(html, /data-motion-feature="cursor"[\s\S]*?motion-disabled-note/);
  assert.match(html, /graip_reduceMotion/);
  assert.match(html, /graip_particlesOn", "no"/);
  assert.match(html, /graip_customCursor", "no"/);
  assert.match(css, /\.graip-reduced-motion \*/);
  assert.match(script, /graip_reduceMotion.*!== "yes"/);
});
