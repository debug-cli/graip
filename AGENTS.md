# graip — engineering handbook

This is the deep reference for **anyone changing this repository**: full-time developers, drive-by
contributors, and coding agents. It assumes you can read JavaScript, service workers and HTML. If you
are looking for "what is this site and why should I use it", that lives in [`README.md`](README.md).

Nothing here is aspirational. Every claim was checked against the files at the commit that added it,
and the counts are reproducible with the commands in [Verifying this document](#verifying-this-document).

---

## Changelog and version naming rule

- Never add, edit, or invent a release entry unless the user explicitly asks to change the version name or number across the repository. Never guess a version string; use only the exact version the user supplies.
- Every README release heading must include the date the version was introduced in `YYYY-MM-DD` form. For historical entries, use verifiable release evidence (v2.0.0 was introduced when PR #2 merged on 2026-10-26); never guess a date.
- Keep one README entry per version and record **all changes included in that version** there. Update that entry as work is completed; do not leave placeholders or split notes into chat/PR headings.
- Prefix the PR title for release work with the exact version and `initial:`, followed by a concise summary; for example, `v2.1.0 initial: version metadata and dated changelog`.

## 0. How to use this document

| If you are… | Read |
| --- | --- |
| Opening the repo for the first time | §1 mental model, §2 map, §3 shell |
| Touching the proxy | §8 service worker, §9 proxy stack, §10 Wisp contract |
| Touching settings or storage | §6 storage reference, §7 events, §11 settings format |
| Touching cloaking, panic or tabs | §12 cloaking, §5.5 tab engine |
| Chasing a bug | §20 debugging cookbook, §22 traps, §23 sweep findings |
| Adding a feature | §21 conventions, §24 playbooks, then the relevant subsystem |
| Changing shell or page UI, dropdowns, or switches | §27 UI architecture and contribution patterns |
| Updating README badges or their metadata | §28 README badge conventions |
| Reviewing a PR | §25 invariants checklist |

**Hard rules that no section overrides** — if you only remember four things:

1. No build step, no package manifest, no bundler, no framework. Every tracked file is served as-is.
2. `stores/`, `fa/`, `assets/icons/`, `homework/`, `uv/`, `baremux/`, `libcurl/` and `assets/js/lib/`
   are vendored. Read them, never reformat them, never "clean them up", keep diffs mechanical.
3. Every DOM/global lookup in a shared script must tolerate absence. A page that does not use a
   feature still loads the file.
4. `node --test tests/*.test.js` stays green (137 tests). Nothing else is required to verify a change,
   and nothing else may be added to the repo to verify one.

---

## 1. Mental model

graip is a **static site that proxies by running a proxy inside the user's browser tab**. There is no
server component in this repository: the host only serves bytes. That single fact explains almost
every design decision in the codebase.

```
┌─────────────────────────────── browser tab (this origin) ───────────────────────────────┐
│                                                                                         │
│  index.html  ── the shell ───────────────────────────────────────────────────────────┐   │
│  │  sidebar nav, settings panels, drawers, address bar, tab strip                    │   │
│  │  inline JS: navTo(), library loaders, settings wiring, visitor counter            │   │
│  └───────────────┬──────────────────────────────────────────────────────────────────┘   │
│                  │ iframe #contentFrame                                                │
│                  ▼                                                                      │
│  pages/*.html ── one page per feature (browser, games, movies, chat, …) ────────────┐   │
│  │  pages/browser.html loads assets/js/browserfunctions.js:                          │   │
│  │    tab model ──> Scramjet controller (page side) ──> iframe per tab               │   │
│  └───────────────┬──────────────────────────────────────────────────────────────────┘   │
│                  │ fetch(/~/sj/<encoded target>)                                       │
│                  ▼                                                                      │
│  sw.js (service worker) ── route() ──> $scramjetController (page) ──> libcurl WASM ──┐  │
│                                                                                      │  │
└──────────────────────────────────────────────────────────────────────────────────────┼──┘
                                                                                       │
                                          WebSocket (Wisp protocol)                    │
                                                                                       ▼
                                                       public or self-hosted Wisp server
                                                       ──> HTTPS ──> destination site
```

Consequences you must internalise:

- **The service worker is the proxy's front door.** Without an active, controlling worker the
  static host answers `/~/sj/<anything>` with its own 404. That is why `browserfunctions.js` waits for
  `navigator.serviceWorker.ready`, then for actual control, before it navigates a tab.
- **Nothing survives a host restart**, because nothing is on the host. All state is in the browser:
  `localStorage`, `sessionStorage`, IndexedDB (service-worker caches only) and memory.
- **There are no redirects, rewrites or headers to lean on** except what `vercel.json` (Vercel) or the
  equivalent host config sets. Deep links must therefore be query strings on `index.html`, not paths.
  That is why settings deep links are `/?launch=1&settings=1&section=proxy`.
- **Cross-origin is the norm, not the exception.** The proxy turns every destination into same-origin
  paths, and the shell deliberately never caches any of them.

### The four layers

| Layer | Files | Loaded when |
| --- | --- | --- |
| **Shell** | `index.html`, `styles/index.css`, `assets/css/*`, `assets/js/{dropdown,settings,debug-panel,settings-io,splash}.js` | Always the app entry point |
| **Pages** | `pages/*.html`, `assets/css/elements.css` | Inside `#contentFrame` when the user opens a feature |
| **Browser engine** | `assets/js/browserfunctions.js`, `assets/js/wisp.js`, `assets/js/proxy-errors.js`, Scramjet bundles | Only on `index.html` and the three browser pages |
| **Proxy runtime** | `sw.js`, `homework/`, `uv/`, `baremux/`, `libcurl/` | Service worker + on-demand `import()` |

Two scripts sit above all layers and must load first on every page: `assets/js/log.js` (so it can
catch every error) and `assets/js/cloak.js` (so a cloaked tab never shows the real title, even for a
second).

---

## 2. Repository map

```
.
├── index.html                 1,831 lines  the whole app shell (markup + 36 script blocks)
├── panic.html                  328        self-contained panic decoy
├── newtab.html                  43 lines  new-tab stub
├── 404.html                    190        host 404 page (mini shell)
├── start.html                50878        byte-for-byte Google Classroom copy (the disguise)
├── sw.js                       651        service worker: proxy routing, blocklist, offline shell, logging
├── manifest.json                49        PWA manifest
├── vercel.json                  29        headers only (no build, no rewrites)
├── README.md                    ~450      user-facing document
├── AGENTS.md                    this file engineering handbook
├── MOVING.md                    12        legacy fork stub
├── LICENSE                              AGPL-3.0
├── .gitignore                   41
├── docs/superpowers/plans/
│   └── 2026-10-03-curl-60-wisp-scramjet-diagnosis.md
│                                        historical investigation plan (curl 60 / Wisp)
├── pages/                     15 files  features loaded into #contentFrame
├── assets/
│   ├── js/                    15 files  first-party scripts (+ lib/ vendored)
│   ├── css/                   10 files  themes, layout, components, mobile
│   ├── json/                   5 files  game/app/partner lists + particles config
│   ├── img/                  811 files  thumbnails, icons, cloaks, cover
│   ├── fonts/                 25 files  brand fonts (9 MB)
│   └── icons/fonts/           15 files  Remix Icon 4.7.0
├── styles/index.css                 1763 shell stylesheet (+ media-query mobile block)
├── homework/                   9 files  Scramjet runtime, disguised filenames:
│                                        `math.all.js` + `math.all.js.map`, `science.sync.js` +
│                                        `science.sync.js.map`, `english.bundle.js` +
│                                        `english.bundle.js.map`, `chemistry.sw.js` +
│                                        `chemistry.sw.js.map`, `history.wasm.wasm`
├── uv/                         6 files  Ultraviolet 3.2.10
├── baremux/                    3 files  bare-mux 2.1.7
├── libcurl/                    4 files  libcurl.js 0.7.5 bundles (WASM as base64):
│                                        `index.mjs`/`index.js`/`index.cjs` + `libcurl.mjs`
├── fa/                       409 files  Font Awesome Free 7.1.0
├── stores/                  7026 files  vendored games: ucp-games (6402) + gn-math (624)
└── tests/                     13 files  137 dependency-free tests
```

Totals: **8,401 tracked files, ~2.7 GB**. Roughly 120 of them are first-party.

### Size and editability

| Area | Files | Size | Editable? |
| --- | --- | --- | --- |
| `stores/ucp-games/` | 6,402 | 2.4 GB | **No** — 54 vendored game folders (largest single files: `owt2/index.pck` 70 MB, `html/gd.html` 49 MB) |
| `stores/gn-math/` | 624 | 13 MB | **No** — single-file HTML games, `0.html`… |
| `assets/img/` | 811 | 237 MB | Adding icons yes; never re-encode existing art |
| `fa/` | 409 | 14 MB | **No** — Font Awesome Free 7.1.0 |
| `assets/icons/fonts/` | 15 | 13 MB | **No** — Remix Icon 4.7.0 (+ 2 MB of vendor demo HTML) |
| `assets/fonts/` | 25 | 9 MB | **No** — licensed fonts |
| `homework/`,`uv/`,`baremux/`,`libcurl/` | 22 | 8.3 MB | **No** — vendored proxy runtime |
| `pages/` | 15 | 1.7 MB | Yes, except `classroom.html` |
| `assets/js/` | 19 | 1.3 MB | Yes, except `lib/` |
| `tests/` | 13 | 120 KB | Yes — the source of truth for behaviour |
| `assets/css/` + `styles/` | 26 | 76 KB | Yes |
| `docs/` | 1 | 24 KB | Reference only |
| Root | 13 | ~2 MB | Yes, except `LICENSE` |

---

## 3. The shell — `index.html`

1,831 lines: 8 body containers, 8 settings panels, 4 drawers, **36 `<script>` blocks** (12 inline, 24
external). It is the app.

### 3.1 Body container map

| Line | Element | Role |
| --- | --- | --- |
| 73 | `#gohomeblock` | Floating "back to home" button shown while a page is open |
| 76–154 | `<nav>` | Sidebar: home, games, apps, movies, VMs, AI, partners, settings. Chatrooms remains a direct page but has no sidebar button; Discord has no navigation button. The `gmbl` entry is commented out |
| 156 | `#homeContent` | Hero: logo, splash text, search box, visitor count |
| 179 | `#contentFrame` | The iframe every page loads into (`navTo`) |
| 181 | `.settings-container.settings-hidden` | The settings sheet (fixed 625 px) |
| 634 | `.browser-container` | The shell's own tab strip + address bar shown above proxied content |
| 680 | `.apps-wrapper` | App shortcuts drawer |
| 692 | `.download-wrapper` | "Download Games" drawer (Google Drive links) |
| 709 | `.games-wrapper` | Games drawer (tiles for the selected store) |
| 721 | `.partners-wrapper` | Partner sites drawer |
| 738+ | `#vanta-fog-container`, cursor div | Vanta fog background and custom cursor host |

Drawers (`apps`, `games`, `partners`, `download`) and the settings sheet are mutually exclusive:
each `toggleX()` closes the others and adds a `.blurOverlay` the user can click to dismiss. The
state is CSS classes `settings-shown` / `settings-hidden` — there is no boolean anywhere.

### 3.2 Settings panels

| Panel id | Line | Contains |
| --- | --- | --- |
| `#settings-general` | 220 | Theme selector, fog toggle (`#pjs-toggle`), custom cursor toggle (`#cursor-toggle`) |
| `#settings-gaming` | 297 | Game store selector, overlay toggle (`#overlay-toggle`), "Download Games" |
| `#settings-cloaking` | 348 | Decoy (cloak) selector, `openAB()` button + auto-about:blank toggle, panic toggle/keys/target/behaviour/decoy, "Test panic now", "Clear session traces" |
| `#settings-backup` | 464 | Save/copy settings file, file + paste import, status `<pre>`, export preview, reset |
| `#settings-debug` | 512 | Verbose toggle slot, export JSON/TXT/copy/clear, "Test all Wisp routes", log preview, library health |
| `#settings-proxy` | 550 | Wisp selector + custom URL + status, backend selector, search engine selector |
| `#settings-info` | 591 | Credits |
| `#settings-updates` | 618 | Version + release link |

Sidebar entries carry `data-target`, which must equal the panel suffix. `switchSettingsPage(target)`
(script block at 1024) looks up `#settings-${target}`, ignores unknown targets (a bad `data-target`
must never blank the area), removes `.settings-active` from every `.settings-page`, adds it to the
target, and logs `panel <target>`. Deep link: `/?launch=1&settings=1&section=proxy`.

### 3.3 Script block map

| Lines | What it does |
| --- | --- |
| 40–57 | First inline block: redirect to `/start.html` unless `?launch` is present (the disguise) |
| 748–757 | `particlesJS.load` when `graip_particlesOn` is `yes` |
| 760–912 | **Library loaders**: `gj(file)`, `load(file, type, fn, toRun, prefix)`, `noteLibraryIssue`, `showPlaceholder`, `applyThumb`, `observe` (IntersectionObserver), initial `load("apps"…)` + `load(selectedStore…)`, `storeUpdated` listener |
| 914–1002 | `registerSW()`: registers `/uv/sw.js` then `/sw.js`, toasts, hides the spinner, enables `#homesearch` |
| 1022–1030 | Address-bar Enter handler (`#searchbar` → `rSearch`) |
| 1032–1040 | `load`: clears stale `.active` frames |
| 1042–1425 | Drawer/settings machinery: `switchSettingsPage`, `toggleSettings/Apps/Games/Partners/DownloadGames`, `GraipShellState` (1237–1382), `rSearch`, `searchApps` |
| 1426–1440 | `#homesearch` Enter handler |
| 1445–1486 | `updatePJS()` fog toggle (tears down/creates the Vanta effect) |
| 1487–1505 | `updateOverlaySettings()` (`graip_useOverlay`) |
| 1507–1674 | Version check (`graip_siteVersion`), `resetTheme()`, `openAB()`, `updateABSettings()`, `updateCLSettings()` (confirm-leave), `updateCur()` (cursor), two `beforeunload` guards, `DOMContentLoaded` deep-link handler |
| 1676–1831 | Vanta effect (WebGL, guarded), visitor counter, `setWispStatus`, `setCurrentWispServer`, Wisp custom-input prefill, `setWisp`, `testWispServer` |

If you need to add shell behaviour, prefer a **new script block at the end** over editing an existing
one: the blocks share the global scope, and a throw in an early block silently kills everything after
it in that block only (not later blocks — they are separate `<script>` elements).

### 3.4 `navTo()`

```js
navTo(l)                       // l is e.g. "movies", "play.html?launch=/stores/…", "home?launch=1"
  ├─ GraipLog.action("nav", `open ${l}`)
  ├─ l.includes("home")  → remove #contentFrame, show nav + #homeContent, hide #gohomeblock
  ├─ l === "vms"         → fade nav out, show #contentFrame, src = /pages/vms.html
  └─ otherwise           → ensure #contentFrame is in the body, hide the nav when the game overlay
                           is on and the target is a game, then src = /pages/<l>
```

`navTo` assigns `iframe.src` **for pages**, never for proxied content. Proxied navigation always goes
through `go()` in `browserfunctions.js` — see §5.5.

### 3.5 Library loaders and health

`load(file, type, …)` fetches `/assets/json/<file>.json`, drops entries without `name`/`url` (counting
them via `noteLibraryIssue("entry", …)`), builds `.app` tiles, and defers thumbnail work to an
IntersectionObserver. `applyThumb()` probes each image with `new Image()`; on error it adds
`.app-image-missing` (`data-graip-missing="1"`), keeps the title, and records
`noteLibraryIssue("thumbnail", …)`. `graip_libraryIssues` keeps the last 100 issues for Settings →
Debug → *Check library now*.

The games list follows `graip_gameStore` (`Classplay` → `classplay.json`, `GN-Math` → `gn-math.json`).
The `storeUpdated` event (dispatched by `dropdown.js`) empties the container and reloads.

---

## 4. `pages/` catalogue

Everything here is loaded in `#contentFrame` unless noted. `log.js` + `cloak.js` are on all of them.

| File | Lines | Purpose | Key deps / ids / params |
| --- | --- | --- | --- |
| `browser.html` | 328 | Main proxied browser | `browserfunctions.js`, Scramjet bundle, `#searchbar`, `.tabs`, `.viewframe`; `?launch=<url>` first tab |
| `browser-minimum.html` | 353 | Same engine, no floating logo/side menu, fixed-position frame | same, own inline `registerSW()` |
| `embed.html` | 360 | Browser for embedding by other pages | same; reads `?launch=` and navigates once |
| `play.html` | 507 | Game player | `#gameframe` iframe, overlay (`#gameOverlay`, `#sessionTime`, `#temperature`, `#currentTime`, `#startRecording`, `#stopRecording`, `#downloadBtn`), particles |
| `games.html` | 343 | Games list as a standalone page | `/assets/json/<store>.json`, `#particles-container` |
| `apps.html` | 327 | App shortcuts as a standalone page | `/assets/json/apps.json` |
| `partners.html` | 295 | Partner list | `/assets/json/partners.json` |
| `movies.html` | 214 | TMDb browse/search | `api.themoviedb.org/3`, `image.tmdb.org`, Alpine + Tailwind CDN |
| `watch.html` | 510 | TMDb detail + player | season/episode UI, providers `iframe.pstream.mov`, `multiembed.mov`, vidsrc |
| `movieframe.html` | 154 | Legacy wrapper embedding `movies.html` full-screen with its own nav | iframe + `<nav id="nav-ul">` |
| `assistant.html` | 467 | AI page | `text.pollinations.ai` / `image.pollinations.ai`, marked + KaTeX + highlight.js CDNs, `vm.js` |
| `vms.html` | 144 | VM page | `<iframe src="/pages/embed.html?launch=https://browser.lol/create">`, `vm.js` |
| `chatrooms.html` | 3,196 | Socket.io chat | `socket.io` + `emoji-mart` CDNs, `CHAT_BACKEND = https://qs03x443-3000.usw3.devtunnels.ms/`, `graipChatOffline()` notice |
| `gmbl.html` | 220 | Joke slot machine (`party-js`) | Reachable only by URL |
| `classroom.html` | 37,761 | Second, unused Classroom copy | Not referenced anywhere; excluded from tests |

Rules: a page-local "Settings" link must be `/?launch=1&amp;settings=1` with `target="_top"`
(otherwise it renders the settings page *inside* the frame). Any page-level failure must show a
message in the page, not hang — `chatrooms.html` and `assistant.html` show the pattern.

---

## 5. First-party JavaScript

### 5.0 Boot order

```
every page:      log.js  →  cloak.js  →  (page-specific)
index.html:      wisp.js → colors.js → assets/splashes/splash.js → debug-panel.js → proxy-errors.js
                 → browserfunctions.js → particles → dropdown.js → settings-io.js
browser pages:   baremux/index.js → math.all.js → wisp.js → t.js → english.bundle.js
                 → proxy-errors.js → browserfunctions.js
```

`log.js` is deliberately **not** deferred: it must install `window.onerror` before anything else can
throw. Everything else is `defer` or ordered by hand where one file reads another's globals
(`dropdown.js` reads `GraipWisp.PRESETS` and `GraipCloak.PROFILES`; `debug-panel.js` reads both).

### 5.1 `assets/js/log.js` — `window.GraipLog` (586 lines)

A bounded, redacting recorder. Design constraints: never throw, never log a query string, never grow
without limit.

| Constant | Value | Meaning |
| --- | --- | --- |
| `MEMORY_LIMIT` | 1000 | Entries kept in memory |
| `STORAGE_LIMIT` | 400 | Entries mirrored to `graip_debugLog` |
| `MAX_DATA_CHARS` | 2000 | Truncation for `message` and serialized `data` |
| `LEVELS` | debug 10, info 20, warn 30, error 40 | Verbose off keeps ≥ warn |
| `VERSION` | `1` | Debug-log export format version; not the Graip app version |
| `APP_VERSION` | `v2.1.0 "juice"` | Current release, included in JSON and text exports |
| `KEYS.verbose` / `KEYS.buffer` | `graip_verboseLogs` / `graip_debugLog` | The two keys this file actually touches |
| `KEYS.maxEntries` | `graip_debugMaxEntries` | **Declared but never used.** `MEMORY_LIMIT`/`STORAGE_LIMIT` are the real caps; `settings-io.js` lists the key in `IGNORED` so it can never be imported |

Entry shape:

```json
{ "seq": 42, "at": "2026-10-25T23:07:35.016Z", "level": "warn", "category": "proxy",
  "message": "HTTP 404", "page": "https://host/index.html", "data": { "url": "https://x/y", "ms": 12 } }
```

API:

| Member | Behaviour |
| --- | --- |
| `debug/info/warn/error(category, message, data)` | Record; `action()` is `debug` level and exists so user actions read clearly in the text export |
| `log(level, …)`, `safeUrl(url)`, `cleanData(value, depth)` | Lower-level helpers (also used by `cloak.js`, `panic.html`) |
| `entries()`, `recent(limit)`, `snapshot()` | In-memory copy / last N / export envelope; `snapshot()` includes `appVersion` and keeps `version` as the log-format version |
| `subscribe(fn)` | Panel re-render hook |
| `isVerbose()`, `setVerbose(bool)`, `toggleVerbose()` | Persists `graip_verboseLogs` (`on`/`off`) and re-posts the SW config |
| `configureServiceWorker()` | `controller.postMessage({ $graip$logConfig: { verbose } })` |
| `exportJSON()`, `exportText()`, `download("json"\|"txt")`, `copy()` | Settings → Debug |
| `clear()` | Empties, then logs exactly one entry: `log cleared` |
| `install()` | Automatic (last line of the file) |

Automatic capture installed by `install()`: `error` (capture phase, distinguishes resource failures
from crashes), `unhandledrejection`, `console.warn`/`console.error` mirroring (skips its own output to
avoid loops), a `fetch` wrapper that records non-OK and failed requests, and service-worker
`message` reports from `sw.js`.

Categories in use: `app`, `api`, `browser`, `cloak`, `console`, `library`, `nav`/`navigate`, `net`,
`panic`, `proxy`, `resource`, `settings`, `stats`, `sw`, `ui`, `uncaught`, `unhandled-rejection`,
`wisp`. Adding a category is free; adding a *second* logging mechanism is not.

### 5.2 `assets/js/cloak.js` — `window.GraipCloak` (607 lines)

Owns disguises, the panic key and the decoy documents. Loads on every page and applies the saved
disguise on load (unless `<html data-graip-no-auto-cloak="1">`).

| Table | Contents |
| --- | --- |
| `PROFILES` (9) | `None`, `Google`, `Google Docs`, `Google Drive`, `Google Classroom`, `Youtube`, `Canvas`, `Khan Acadamy`, `Desmos` — each `{ title, icon, page }` where `page` ∈ `none`/`search`/`video`/`document` |
| `TARGETS` (9) | `Classroom`, `Google`, `Google Docs`, `Google Drive`, `Canvas`, `Khan Academy`, `Wikipedia`, `Blank (about:blank)`, `Custom URL…` |
| `PANIC_KEYS` (8) | `\`, `Escape`, `` ` ``, `~`, `]`, `z`, `q`, `Shift+Z` (values are `KeyboardEvent.key`) |
| `DEFAULTS` | `{ enabled:false, key:"\\", target:"Classroom", openIn:"same-tab", showDecoy:true }` |

| Function | Behaviour |
| --- | --- |
| `settings()` | Reads storage into a validated object (unknown target/profile falls back to the default) |
| `profileName()`, `profile(name)` | Validated accessor for `PROFILES` |
| `applyCloak(name)` | Sets `document.title` and the `link[rel*=icon]` href; `None` restores graip's own |
| `decoyMarkup(page)` | Generates a full HTML document: `search` (Google logo + search box), `video` (YouTube header + 6 skeleton tiles), anything else (Docs toolbar + grey text lines) |
| `blankDocument(name)` | `decoyMarkup` + a hidden "press Esc" escape hint that appears on pointer movement |
| `targetUrl()` | Resolves the configured destination (including a validated custom URL) |
| `matches(event)` | Key matching: `Shift+Z` needs shift, letter keys are ignored while typing or with modifiers |
| `panic(options)` | The panic action: record the return point, open `decoyUrl(...)` in this tab or a new one |
| `rememberReturnPoint()` | Stores `location.href` + a `GraipShellState.capture()` snapshot (see §12.2) |
| `storedReturnUrl()` | The stored URL, but only when it is same-origin `http(s)` — never an open redirect |
| `clearReturnPoint()` | Removes both return keys; the decoy calls it once it has used the URL, the shell after restoring |
| `installPanicKey()` | One capture-phase `keydown` listener per page (`window.__graipPanicInstalled`) |
| `openAboutBlank()` | Opens the current site in an `about:blank`-titled window and leaves a neutral tab behind |
| `autoAboutBlank()` | Runs once per tab (`sessionStorage.graip_abOpened`), only at top level, and only when `graip_autoAB === "yes"` |
| `isCloaked()` | True when `window.opener` exists (i.e. this tab is the visible half of a cloak) |
| `decoyUrl(url, cloak, showDecoy)` | Builds `/panic.html?to=…&cloak=…&plain=1` |

Storage owned: `decoy`, `graip_cloakProfile`, `graip_cloakTitle`, `graip_cloakIcon`,
`graip_panicEnabled`, `graip_panicKey`, `graip_panicTarget`, `graip_panicTargetUrl`,
`graip_panicOpenIn`, `graip_panicShowDecoy`, `graip_autoAB`, plus `sessionStorage.graip_abOpened`,
`graip_panicReturn`, `graip_panicReturnUrl`, `graip_panicReturnState` and (on panic only)
`graip_skipLeaveGuard`.

### 5.3 `assets/js/wisp.js` — `window.GraipWisp` (779 lines)

Endpoint catalogue, protocol probe, failover, transport configuration, error classification.

- `PRESETS`: **30** endpoints. Examples: `Mercury wss://wisp.mercurywork.shop/`, `Anura 1
  wss://anura.pro/`, `Phantom wss://phantom.lol/wisp/`, `rhw wss://wisp.rhw.one/`, Radius
  `wss://radiusproxy.app/wisp/` and its ad-blocking variant `/adblock/`. Plus `localPreset()`, which
  offers `${ws(s)}://${location.host}/wisp/` when a deployment runs its own server.
- `normalizeWispUrl(raw)`: adds the scheme if missing, forces a trailing `/`, rejects anything that is
  not `ws(s)://host/path/`. A URL without the trailing slash is not Wisp.
- `probeWispServer(url, { timeoutMs = 4000 })`: opens a `WebSocket`, resolves `{ ok, url, ms, reason,
  detail }`. **`ok` requires the server's first frame** (Wisp v1 sends `CONTINUE` for stream 0
  immediately); a socket that opens and stays silent is `reason: "silent"`.
- `probePool(urls, { concurrency })`: races candidates, prefers the earliest success.
- `getWorkingWispServer(options)`: the failover algorithm.
  1. Return `state.verified` if fresh and not excluded and not `force`.
  2. Probe the configured endpoint alone with `preferredTimeoutMs || 1500`.
  3. On failure, race `candidateList()` (built-in presets + custom, minus exclusions).
  4. Cache the winner in `state.verified`; write `graip_wispUrlFallback` only when the winner is not
     the preferred endpoint; clear it when it is.
  5. Dispatch `graipWispServerChanged` on `window` when the active URL changes.
- `getConfiguredUrl()` (user choice: `graip_wispUrlSelected` → preset id / `Custom` →
  `graip_wispUrlCustom`), `getActiveUrl()`, `getFallbackUrl()`, `isUsingFallback()`.
- `setActiveServer(url, { custom })`: manual pick; clears fallback and cache, writes
  `graip_wispUrlSelected` (and `graip_wispUrlCustom` when `custom`).
- `resetCache()`: forgets `state.verified`/`inflight` (Settings → *Test current server*).
- `configureTransport(target, options)`: `target.setTransport("/libcurl/index.mjs", [{ websocket: url }])`.
- `curlCode(error)`, `describeError(error)`: user-facing strings; delegates classification to
  `GraipProxyErrors` when present.

`GraipWisp.KEYS`: `active` = `graip_wispUrl`, `preset` = `graip_wispUrlSelected`, `custom` =
`graip_wispUrlCustom`, `verifiedAt` = `graip_wispUrlVerifiedAt`, `fallback` = `graip_wispUrlFallback`.

### 5.4 `assets/js/proxy-errors.js` — `window.GraipProxyErrors` (84 lines)

One classifier shared by the page and the service worker (`sw.js` `importScripts` it, so it must stay
dependency-free and ES5-safe).

| `kind` | Matched by | Retry budget (`maxRouteAttempts`) | Message intent |
| --- | --- | --- | --- |
| `peer-verification` | curl 60, "peer certificate", "cert verify" | 2 | Destination chain / client trust store / clock / interception; **verification stays on** |
| `tls-handshake` | curl 35, "ssl connect error", "tls handshake" | 6 | This route could not complete TLS; another route may work |
| `connectivity` | curl 7, "could not connect to server" | 6 | Route down or blocked |
| `runtime` | "wasm not loaded", "load_wasm" | 0 | libcurl WASM failed to load; reload |
| `other` | everything else | 0 | Raw message |

`parseInt`-free: the code is read with `/error code\s+(-?\d+)/i`.

### 5.5 `assets/js/browserfunctions.js` — the tab engine (1,199 lines)

The most stateful file in the repo. Module state:

```js
let aTab = 0;                  // active tab id
let tabCounter = 1;            // next id
let bTabs = [];                // { id, title, url, history[], historyIndex, restoreUrl }
let bareMuxConnection = null;  // Ultraviolet transport
let wispUrl = null;            // active endpoint
let transportPromise = null, transportClassPromise = null;
let scramjetController = null, scramjetControllerPromise = null;
const scramjetFrames = new Map();  // tabId -> Scramjet Frame
const recoveryAttempts = new Map();// tabId -> attempts
const closedTabs = [];         // Ctrl+Shift+T stack
```

Transport and controller:

| Function | Notes |
| --- | --- |
| `getBareMuxConnection()` | Lazily creates `BareMuxConnection("/baremux/worker.js")`; a blocked worker must not break Scramjet |
| `waitForServiceWorkerControl()` | Resolves when `navigator.serviceWorker.controller` exists, else after `controllerchange`; times out gracefully |
| `loadTransportClass()` | `import("/libcurl/libcurl.mjs")`, cached |
| `createTransport(server)` | `transportClass([{ websocket: url }])` |
| `initScramjetController()` | `new $scramjetController.Controller({ serviceworker: "/sw.js", transport, config: SCRAMJET_CONFIG })` |
| `ensureTransport(force, options)` | Returns the active wisp transport; on `force` re-probes and re-creates |
| `scramjetFrameFor(tabId, element)` | Cached `Frame` per tab (this is why a tab's frame survives tab switches) |
| `isUltravioletBackend()` | `(localStorage.graip_backend || "").toLowerCase() === "ultraviolet"` |

`SCRAMJET_CONFIG = { prefix: "/~/sj/", scramjetPath: "/homework/math.all.js", injectPath:
"/homework/science.sync.js", wasmPath: "/homework/history.wasm.wasm", virtualWasmPath:
"scramjet.wasm.js" }` — the disguised filenames are load-bearing; see §9.

Tabs:

| Function | Notes |
| --- | --- |
| `newTab(initial)` | Pushes `{id, title, url, history, historyIndex, restoreUrl}`, builds `.tab[data-tab-id]` with a favicon `<img id="fav" data-fav-id="<id>">`, loads `/newtab.html` |
| `switchTab(id)` | Sets `aTab`, toggles `.active` on frames, lazily navigates `restoreUrl` |
| `closeTab(id)` | Removes DOM, pushes to `closedTabs` (cap 10), re-activates a neighbour |
| `setTabTitle(id, title)` | Updates the model + the `<span>` in the tab strip |
| `saveTabSession()` / `readTabSession()` / `clearTabSession()` | `sessionStorage` mirror under `graip_tabs:<pathname>` |
| `restoreTabSession()` | Rebuilds tabs from storage, lazily; falls back to one new tab |

`go(target, tabId)` — the only correct way to load proxied content:

```
1. find tab, frame, tab strip element; set the title to "Loading..."
2. update the address bar and the Google favicon service image
3. await Promise.all([initScramjetController(), serviceWorkerReady, ensureTransport()])
   └─ failure → setTabError(GraipWisp.describeError(error))
4. viewframe.onload:
   ├─ documentElement.dataset.graipProxyError  → handleProxyFailure()
   ├─ success → clear recoveryAttempts, copy iframe title to the tab, saveTabSession()
   └─ cross-origin (throws) → fall back to the hostname as the title
5. Ultraviolet backend: getBareMuxConnection() → setTransport("/libcurl/index.mjs") →
   viewframe.src = __uv$config.prefix + __uv$config.encodeUrl(target)
   Scramjet backend: (await scramjetFrameFor(...)).go(target)
```

Recovery and traces: `setTabError()` writes a toast + "Proxy unavailable"; `handleProxyFailure()`
classifies the failure, respects `maxRouteAttempts`, calls `retryProxyRoute()` (which forces
`ensureTransport(true)` and retries with a different endpoint), and gives up with an explanation.
`scrubDocumentUrl()`, `clearBrowserTraces()` (drops the tab session, `graip_lastUrl` and the address
bar) and `updateUrlFromIframe()` keep destinations out of the visible URL.

Chrome actions: `b()`, `f()`, `r()`, `full()`, `hideBrowser()`, `launchEruda()`, `fixProxy()`
(re-`ensureTransport(true)` and re-register both workers).

Omnibox: `installOmnibox()` binds shortcuts (`Ctrl/Cmd+L/T/W`, `Ctrl+Tab`, `Ctrl/Cmd+Shift+T`,
`Alt+←/→`), `installOmniboxInput()` binds the address bar, and `resolveOmniboxInput(raw)` is a pure
function: a bare domain becomes `https://…`, anything else a Google search, with bangs `!g !ddg !b !yt
!w !gh !r`. It is unit-tested — extend the bang table there, not in `index.html`.

There is also a one-time migration: `graip_searchEngineGoogleDefaultV1` rewrites a stored
`DuckDuckGo` default (from the era when the site shipped DDG as default) to `Google`.

### 5.6 `assets/js/settings-io.js` — `window.GraipSettings` (831 lines)

Backend-free settings backup. Full format spec in §11. Structural notes:

- `SCHEMA` (23 entries) is the allowlist; `IGNORED` lists runtime keys that must never travel;
  `graip_tabs*` is skipped by prefix.
- `sanitize(entry, raw)` is the only writer path and returns `{ ok, value }` / `{ ok: false, reason }`.
- `apply(input)` merges: absent keys untouched, `null`/`""` on optional keys ignored, unchanged values
  not rewritten, invalid values reported per key.
- `preview(input)` produces the diff without writing (used by tests, not yet by the UI).
- `download()`/`copy()`/`importFile(file)`/`reset()`/`reloadNow()` handle transfer.
- Two globals are attached for inline buttons: `GraipSettingsUiCopy()`, `GraipSettingsUiReset()`.

### 5.7 `assets/js/debug-panel.js` (456 lines)

Settings wiring for Debug + Cloaking panels. `makeSwitch()` clones the first `.switch` in the DOM and
`mountToggle(slotName, options)` mounts the clone into every `.graip-toggle-slot[data-slot=…]`, so new
toggles cannot drift visually from the originals. Also renders the panic selects, the log preview, and
defines the inline-button globals `GraipLogClear`, `GraipPanicTest`, `GraipClearTraces`,
`GraipCheckLibrary`, `GraipProbeAll`.

### 5.8 `assets/js/dropdown.js` (429 lines)

The custom selectors (`wisp`, `backend`, `search-engine`, `decoy`, `theme`, `store`).
`createSelector(type, selectedEl, optionsEl, allOptions, currentVal, storageKey, eventName, successMsg)`
builds one: click opens (closing every other), click an option writes `localStorage[storageKey]`,
dispatches `CustomEvent(eventName, { detail })` on `document`, toasts and logs
(`settings` category). Backend values are lowercased in storage but displayed capitalised.
`applyDecoy()` delegates to `GraipCloak.applyCloak`. `updateWispSelector()` re-renders the Wisp
picker and shows `chosen → fallback` while a failover is live.

### 5.9 The rest

| File | Lines | Summary |
| --- | --- | --- |
| `settings.js` | 216 | Legacy: `setTabTitle/setTabIcon/applyTheme/settingsNav/setWispStatus/setWispServer/setCustomWispServer/testWispServer/cloakMe`. Loaded by 96 store pages, so **every lookup is optional** (`tests/page-bootstrap.test.js` enforces it) |
| `colors.js` | 12 | Applies `graip_theme` to `#css-theme-link` before paint; must tolerate a missing link (`404.html` regressed this once) |
| `t.js` | 146 | `showToast(type, message, icon)`; creates `.toast-container` if absent, pauses timers on hover, stacks toasts |
| `cursor.js` | 115 | ZXS cursor; `cursor()` starts it, disabling removes `#cursor-style-zxs`/`#cursor-thank-you-zxs` and all listeners |
| `assets/splashes/splash.js` | — | Fetches a UTF-8 line-based phrase list, picks one at random, and safely renders optional Markdown links |
| `assets/splashes/splashes.txt` | 80 lines | Editable splash phrases, one per line; this is the copy source of truth |
| `vm.js` | 118 | Legacy Hyperbeam launcher with `graip_vm_cooldown` (20 min); every lookup optional, no-ops on today's pages |
| `chatrooms.js` | 129 | CometChat client (`api.x8r.dev` token). **Not loaded anywhere**; `chatrooms.html` uses socket.io. Dead code |
| `lib/particles.js` | 963 | Vendored particles.js |
| `lib/three.min.js` | 26,887 | Vendored three.js (Vanta dependency, `index.html` only) |
| `lib/vanta.fog.min.js` | 440 | Vendored Vanta fog |
| `lib/detectmobile.js` | 35 | `isMobile()` UA sniff; used only by vendored GN-Math pages |

### 5.10 Updating splash phrases

The splash copy is maintained in [`assets/splashes/splashes.txt`](assets/splashes/splashes.txt), next
to its loader, [`assets/splashes/splash.js`](assets/splashes/splash.js). To change the rotating
homepage phrases, edit the `.txt` file directly in any plain-text editor:

1. Put exactly one splash on each line. The file is UTF-8; blank lines are ignored and surrounding
   whitespace is trimmed. Do not add JSON quotes, commas, or array brackets.
2. Use ordinary text by default. A clickable link can use the form
   `[visible label](https://example.com)`; only HTTPS links are rendered as links, and they open in a
   new tab with `noopener noreferrer`. Do not add raw HTML: the loader renders all other content as
   text, so tags cannot execute or alter the page.
3. Save the file, check that the new line appears once, then run
   `node --test tests/*.test.js` and `git diff --check`. No JavaScript edit is needed for copy-only
   changes.
4. Keep both files together in `assets/splashes/`, update the shell script path in `index.html` if
   the loader ever moves, and keep both assets in `sw.js` → `SHELL_ASSETS` so the splash works offline.
   Bump `SHELL_CACHE` when changing the shell asset list or service-worker behavior, not merely to
   change a phrase in the text file.

Change `assets/splashes/splash.js` only when changing phrase-loading or rendering behavior. If doing
so, retain the plain-text-by-default rendering and the HTTPS-only Markdown link behavior.

---

## 6. Storage reference

Prefix rule: first-party keys are `graip_*`; `decoy` is the single exception inherited from upstream.
Never write a `cherri_*` key.

### 6.1 `localStorage`

| Key | Values | Written by | Read by | In backup? |
| --- | --- | --- | --- | --- |
| `graip_theme` | `midnight`, `void`, `ocean`, `forest`, `ember`, `dunes`, `lavendar`, `coral`, `golden`, `lime`, `magenta`, `neon`, `royal blue`, `sea`, `violet`, `mint`, `default` | `dropdown.js`, `settings.js` | `colors.js`, `settings.js`, `dropdown.js`, `index.html` | ✅ |
| `graip_reduceMotion` | `yes`/`no` | `index.html` (`updateReducedMotion`) | `index.html`, `styles/index.css`, `assets/js/cursor.js` | ✅ |
| `graip_particlesOn` | `yes`/`no` | `index.html` (`updatePJS`) | `index.html` | ✅ |
| `graip_customCursor` | `yes`/`no` | `index.html` (`updateCur`) | `cursor.js`, `index.html` | ✅ |
| `graip_useOverlay` | `yes`/`no` | `index.html` | `index.html` | ✅ |
| `graip_confirmLeave` | `yes`/`no` | `index.html` | both `beforeunload` handlers | ✅ |
| `graip_backend` | `scramjet`/`ultraviolet` (lowercase) | `dropdown.js` | `browserfunctions.js` | ✅ |
| `graip_searchEngine` | `Google`, `DuckDuckGo`, `Brave`, `Qwant`, `Bing`, `Startpage` | `dropdown.js` | `browserfunctions.js`, `index.html`, `404.html` | ✅ |
| `graip_gameStore` | `Classplay`/`GN-Math` | `dropdown.js` | `index.html` | ✅ |
| `graip_wispUrlSelected` | preset id, `Custom`, `Local` | `dropdown.js`, `wisp.js` | `wisp.js`, `dropdown.js` | ✅ |
| `graip_wispUrlCustom` | `wss://…/` | `wisp.js` | `wisp.js`, `index.html` | ✅ |
| `graip_wispUrl` | active endpoint (may be a fallback) | `wisp.js` | `wisp.js` | ❌ runtime |
| `graip_wispUrlFallback` | endpoint that answered | `wisp.js` | `wisp.js`, `index.html` | ❌ runtime |
| `graip_wispUrlVerifiedAt` | epoch ms | `wisp.js` | `wisp.js` | ❌ runtime |
| `decoy` | profile name | `dropdown.js`, `cloak.js` | `cloak.js`, `settings.js` | ✅ |
| `graip_cloakProfile` | profile name | `cloak.js` | `cloak.js` | ✅ |
| `graip_cloakTitle` | string ≤120 | `cloak.js`, `settings.js` | `cloak.js`, `settings.js` | ✅ |
| `graip_cloakIcon` | `/path` or `https://…` | `cloak.js`, `settings.js` | `cloak.js`, `settings.js` | ✅ |
| `graip_panicEnabled` | `yes`/`no` | `debug-panel.js` | `cloak.js` | ✅ |
| `graip_panicKey` | `KeyboardEvent.key` | `debug-panel.js` | `cloak.js` | ✅ |
| `graip_panicTarget` | label from `TARGETS` | `debug-panel.js` | `cloak.js` | ✅ |
| `graip_panicTargetUrl` | URL | `debug-panel.js`, `cloak.js` | `cloak.js` | ✅ |
| `graip_panicOpenIn` | `same-tab`/`new-tab` | `debug-panel.js` | `cloak.js` | ✅ |
| `graip_panicShowDecoy` | `yes`/`no` | `debug-panel.js` | `cloak.js` | ✅ |
| `graip_autoAB` | `yes`/`no` (anything else = off) | `index.html` | `cloak.js` | ✅ |
| `graip_verboseLogs` | `on`/`off` (default on) | `log.js` | `log.js` | ✅ |
| `graip_debugLog` | JSON array (last 400) | `log.js` | `log.js`, `debug-panel.js` | ❌ use Debug → Export |
| `graip_debugMaxEntries` | *(never written or read)* | — | — | ❌ |
| `graip_libraryIssues` | JSON array (last 100) | `index.html`, `debug-panel.js` | `debug-panel.js` | ❌ per-device |
| `graip_siteVersion` | version string | `index.html` | `index.html` | ❌ |
| `graip_lastUrl` | last address-bar URL | `browserfunctions.js` | `browserfunctions.js` | ❌ scrubbed by "Clear traces" |
| `graip_vm_cooldown` | epoch ms | `vm.js` | `vm.js` | ❌ |
| `graip_searchEngineGoogleDefaultV1` | `1` | `browserfunctions.js` | `browserfunctions.js` | ❌ migration marker |
| `bare-mux-path` | worker path (bare-mux's own) | bare-mux | bare-mux | ❌ |

### 6.2 `sessionStorage` (per tab, dies with the tab)

| Key | Purpose |
| --- | --- |
| `graip_tabs:<pathname>` | Tab session mirror (`browserfunctions.js`) |
| `graip_panicReturn` | `"1"` after a same-tab panic; the browser page consumes it to log the return |
| `graip_panicReturnUrl` | Where the decoy sends the tab back (`location.href` at panic time). Written by `panic()`, read once by `panic.html`, deleted on use |
| `graip_panicReturnState` | JSON `GraipShellState.capture()` snapshot: frame src, drawer, settings panel, display flags, scroll. Deleted by `GraipShellState.resume()` |
| `graip_abOpened` | Auto-about:blank has run once in this tab |
| `graip_skipLeaveGuard` | One-shot: a deliberate reload (settings importer) or a panic must not trigger the leave prompt |

### 6.3 Service-worker caches

| Cache | Contents | Invalidation |
| --- | --- | --- |
| `graip-shell-v8` | 27 same-origin shell assets (`SHELL_ASSETS`) | Bump `SHELL_CACHE`; `activate` deletes every `graip-shell-*` that does not match |

Proxy responses and cross-origin requests are never cached. Range requests bypass the cache entirely.

---

## 7. Event contracts

Custom events on `document` (from `dropdown.js`) and `window` (from `wisp.js`):

| Event | Target | `detail` | Producer | Consumer |
| --- | --- | --- | --- | --- |
| `themeUpdated` | `document` | theme name | `dropdown.js` | `dropdown.js` (swaps `#css-theme-link`), `index.html` (rebuilds enabled Fog with the new theme colors) |
| `decoyUpdated` | `document` | profile name | `dropdown.js` | `dropdown.js` → `GraipCloak.applyCloak` |
| `storeUpdated` | `document` | `Classplay`/`GN-Math` | `dropdown.js` | `index.html` (reloads the games grid) |
| `wispUpdated` | `document` | endpoint | `dropdown.js` | `dropdown.js` (`selectWisp`) |
| `backendUpdated` | `document` | `scramjet`/`ultraviolet` | `dropdown.js` | *(none today; reload to apply)* |
| `graipWispServerChanged` | `window` | endpoint | `wisp.js` | `index.html` (`setCurrentWispServer`, `updateWispSelector`) |

Service-worker messages:

| Message | Direction | Payload |
| --- | --- | --- |
| `$graip$logConfig` | page → worker | `{ verbose: boolean }` — enables/disables worker logging |
| `$graip$log` | worker → page | `{ level, category, message, data }`, batched 25 entries / 400 ms |

---

## 8. Service worker — `sw.js`

651 lines, tabs for indentation (vendored style). It is both the proxy front door and the offline
shell. `importScripts("/assets/js/proxy-errors.js", "/homework/chemistry.sw.js")` — so
`proxy-errors.js` must never use `let`/`const` at top level or ES2015+ syntax the worker cannot parse.

### 8.1 Lifecycle

| Event | Behaviour |
| --- | --- |
| `install` | `skipWaiting()` immediately, then opens `graip-shell-v8` and `cache.add`s every `SHELL_ASSETS` entry individually (one failure must not fail the install) |
| `activate` | Deletes stale `graip-shell-*` caches, then `clients.claim()` |

Before this fork, the worker never called `skipWaiting()`, so a fix to this file (or to the blocklist)
did nothing until every tab was closed.

### 8.2 Fetch pipeline

```
fetch event
 ├─ url includes "supabase.co"           → return (untouched)
 ├─ method !== GET                      → return
 ├─ same-origin AND not a proxy path    → Range header? return : respondWith(shellRequest)
 └─ everything else                     → respondWith(handleRequest)
       ├─ blockedTarget(url)?  → 403 "Site Blocked" + warn log
       ├─ !$scramjetController.shouldRoute(event) → fetch(request)
       ├─ route(event) throws → transportErrorPage(event, error) + error log
       ├─ response contains a rendered transport error → transportErrorPage + error log
       └─ log navigation (always) / other requests (verbose, non-static) → return response
```

`isProxyPath()` is `/~/sj/` or `/uv/service/`. `SUBRESOURCE_NOISE` (images, fonts, media) keeps static
subresources out of the log unless they fail.

### 8.3 Ad blocklist

`CONFIG.blocked` is an ordered list of patterns (`"youtube.com/pagead/*"`, `".criteo.com"`,
`"*/ads/*"`, …). Matching happens in the worker on the **decoded destination**, not on the proxy URL, so
nothing has to travel through the frame. `toRegex()` translates `*` → `[^/]*` and `**` → `.*`; entries
with a `/` are matched host + path, entries without are host-only; a leading `.` means "this host or a
subdomain" via the regex anchor; `#` and `*` prefixes are stripped. A blocked request never reaches
libcurl.

### 8.4 Error page

`transportErrorPage(event, error)` renders a self-contained dark page (`data-graip-proxy-error="1"`,
`#graip-proxy-message`) for navigations/documents and a plain `502` text body for subresources. The
marker is what `go()`'s `onload` looks for, which is how a route dying mid-session is detected.

### 8.5 Logging

`LOG_STATE = { enabled:false, queue:[], flushTimer }`; `LOG_BATCH = 25`, `LOG_FLUSH_MS = 400`.
`sendLog()` queues, flushes immediately on `warn`/`error`, and `flushLog()` posts
`{ $graip$log: entry }` to every window client (`includeUncontrolled: true`). Worker logging stays off
until the page sends `$graip$logConfig` — that is why a fresh worker is silent in the panel until the
first page load configures it.

### 8.6 Shell cache

`SHELL_ASSETS` = 27 first-party files (shell HTML, the CSS/JS the shell needs, `particles.json`,
`fav.png`). `shellRequest()` is network-first with a cache fallback so a deploy is picked up
immediately and an offline visit still boots. Bump `SHELL_CACHE` when the list or behaviour changes.

---

## 9. Proxy stack

Two backends, one transport.

### 9.1 Scramjet (default)

| Piece | Path | Role |
| --- | --- | --- |
| Client bundle | `homework/math.all.js` | `$scramjet` (main world + injected world), 227 KB |
| Inject script | `homework/science.sync.js` | Loaded into proxied documents |
| Controller (page) | `homework/english.bundle.js` | `$scramjetController.Controller` (`0.0.14`) |
| Controller (worker) | `homework/chemistry.sw.js` | Imported by `sw.js` |
| WASM | `homework/history.wasm.wasm` | 585 KB payload |

Prefix `/~/sj/`. The **page** owns the controller and the cookie jar; the worker only forwards
`prefix` requests back to the page that owns the frame. Frames are per tab
(`scramjetFrames: Map<tabId, Frame>`).

### 9.2 Ultraviolet (legacy)

| Piece | Path | Role |
| --- | --- | --- |
| Bundle / client / handler | `uv/uv.bundle.js`, `uv/uv.client.js`, `uv/uv.handler.js` | UV 3.2.10 (build 92d9075) |
| Worker | `uv/uv.sw.js`, registered via `uv/sw.js` + `uv/uv.config.js` | `/uv/service/` prefix, XOR codec |

Ultraviolet is selected by `graip_backend === "ultraviolet"`; `browserfunctions.js` then sets
`viewframe.src = __uv$config.prefix + __uv$config.encodeUrl(target)` after installing the transport
into bare-mux.

### 9.3 Transport chain

```
page code ── import("/libcurl/libcurl.mjs")
          ── libcurl-transport 2.0.6 (BareTransport)
          ── libcurl.js 0.7.5 (curl + Mbed TLS + nghttp2 + CA bundle, WASM as base64)
          ── WebSocket ──> Wisp server ──> HTTPS ──> destination
```

`baremux/` (2.1.7, build c56d286) is the MessagePort plumbing used by Ultraviolet and by the
`setTransport()` path; it is created lazily so a blocked `/baremux/index.js` cannot break Scramjet.

**Never hand-edit the embedded base64 WASM, the CA bundle, or the TLS verification flags.** To
upgrade: unpack `@mercuryworkshop/libcurl-transport@<v>` and `libcurl.js@<v>`, rebuild all four files in
`libcurl/`, then run `tests/libcurl-bundle.test.js` (WASM magic, `wasm not loaded` messaging, 15 s load
timeout, `libcurl_abort` path).

### 9.4 Wisp protocol contract

- v1 framing; **the server sends `CONTINUE` for stream 0 immediately on connect**. A socket that opens
  and says nothing is not a Wisp server — treat it as a failure, not a success.
- Endpoint URLs must end with `/`. `normalizeWispUrl()` enforces it.
- Public endpoints are community-run and may vanish: never describe them as official, always keep the
  failover path working, and never write a successful probe back over the user's saved choice.

---

## 10. Timeouts, retries and budgets

| Knob | Value | Where |
| --- | --- | --- |
| Preferred-endpoint probe | 1500 ms | `wisp.js` `getWorkingWispServer` |
| Pooled probe | 4000 ms each | `probeWispServer` default |
| "Test all Wisp routes" | 4000 ms, 3 at a time | `debug-panel.js` |
| libcurl transport load | 15 s | `libcurl/` bundle (tested) |
| Route retries — peer verification | 2 | `GraipProxyErrors.maxRouteAttempts` |
| Route retries — TLS / connectivity | 6 | same |
| Visitor counter | 30 s interval, stops after 3 failures | `index.html` |
| VM cooldown | 20 min | `vm.js` |
| Toast lifetime | ~4.3 s | `t.js` |
| Log flush | 25 entries / 400 ms | `sw.js` |
| Log persistence debounce | 900 ms | `log.js` |
| Settings reload after import | 900 ms | `settings-io.js` |

---

## 11. Settings file format

`GraipSettings.exportData()` produces:

```json
{
  "format": "graip-settings",
  "version": 1,
  "exportedAt": "2026-10-25T23:07:35.016Z",
  "site": "https://your-site/",
  "settings": { "graip_theme": "void", "graip_particlesOn": "no", "graip_panicKey": "Escape" }
}
```

Accepted inputs on import: this object, the same object without the wrapper (a bare map), or either as
a JSON string. `MAX_BYTES` = 64 KiB.

### 11.1 Schema (23 keys)

| Group | Keys | Type |
| --- | --- | --- |
| appearance | `graip_theme`, `graip_reduceMotion`, `graip_particlesOn`, `graip_customCursor` | token, bool, bool, bool |
| proxy | `graip_wispUrlSelected`, `graip_wispUrlCustom`, `graip_backend`, `graip_searchEngine` | label, wisp (optional), token, token |
| cloaking | `decoy`, `graip_cloakTitle`, `graip_cloakIcon`, `graip_cloakProfile`, `graip_panicEnabled`, `graip_panicKey`, `graip_panicTarget`, `graip_panicTargetUrl`, `graip_panicOpenIn`, `graip_panicShowDecoy`, `graip_autoAB` | label, text, url, label, bool, key, label, url, enum, bool, bool |
| gaming | `graip_gameStore`, `graip_useOverlay`, `graip_confirmLeave` | token, bool, bool |
| logging | `graip_verboseLogs` | bool (`on`/`off`) |

### 11.2 Reading a settings JSON file

Treat the file as a versioned backup envelope. The top-level `format` identifies it as a Graip settings
backup; `version` is the envelope/schema generation (currently `1`); `exportedAt` is when the file
was created; `site` records the Graip origin that made it. The `settings` object is the actual map of
setting key to saved value. Keys deliberately match Graip's preference keys, so use the table below
as a legend. Values are strings in the format expected by storage, not labels to display verbatim.
The file does not include browsing history, open tabs, debug logs, or runtime Wisp health data.

| JSON key | Meaning of its value |
| --- | --- |
| `graip_theme` | Theme name; `midnight` is the default. |
| `graip_reduceMotion` | `yes` disables animations, Fog and the custom cursor; `no` permits their separate controls. |
| `graip_particlesOn` | Whether the animated Vanta Fog background is enabled (`yes`/`no`). |
| `graip_customCursor` | Whether the custom circle cursor is enabled (`yes`/`no`). |
| `graip_wispUrlSelected` | Identifier of the selected Wisp route, or `Custom`/`Local`. |
| `graip_wispUrlCustom` | User-supplied WebSocket endpoint (`wss://…`) used for a custom route. |
| `graip_backend` | Proxy engine selection: `scramjet` or `ultraviolet`. |
| `graip_searchEngine` | Search provider used for address-bar searches. |
| `decoy` | Cloak profile name used for the tab title/icon disguise. |
| `graip_cloakTitle` | Optional custom tab title for a cloak. |
| `graip_cloakIcon` | Optional icon URL/path for a cloak. |
| `graip_cloakProfile` | Selected built-in cloak profile. |
| `graip_panicEnabled` | Whether the panic key is enabled. |
| `graip_panicKey` | Configured keyboard key for panic activation. The key value is not a keystroke history. |
| `graip_panicTarget` | Preset destination chosen for panic activation. |
| `graip_panicTargetUrl` | Custom panic destination URL, when selected. |
| `graip_panicOpenIn` | Whether panic opens in the same tab or a new tab. |
| `graip_panicShowDecoy` | Whether to show the decoy page during panic. |
| `graip_autoAB` | Whether automatic `about:blank` cloaking is enabled. |
| `graip_gameStore` | Game catalog selection (`Classplay` or `GN-Math`). |
| `graip_useOverlay` | Whether the optional game overlay is enabled. |
| `graip_confirmLeave` | Whether Graip asks before leaving the page. |
| `graip_verboseLogs` | Whether routine debug/action logs are recorded (`on`/`off`). |

A bare map containing those keys is also accepted for import. Unknown keys and invalid values are
reported and skipped; missing keys are left unchanged. Never assume the input is trusted: `sanitize()`
validates each entry before storage is written.

### 11.3 Validation rules (the security boundary)

| Type | Accepts | Rejects |
| --- | --- | --- |
| `bool` | `yes/on/true/1/y`, `no/off/false/0/n`, real booleans | anything else |
| `token` | `^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$` | paths, traversal, markup |
| `label` | same + `()` `’` `'` | markup, slashes |
| `text` | ≤120 chars, no `<`/`>` | HTML |
| `url` | `http(s)://…`, `/single-leading-slash`, `about:blank` | `javascript:`, `data:`, `//host` |
| `wisp` | `ws(s)://host/path` | http(s) URLs, bare hosts |
| `key` | one printable char, `Shift+X`, or a named key (`Escape`, `F1`…) | whitespace, words |
| `enum` | the entry's `options` (case-insensitive) | everything else |

Control characters are rejected for every type. `null`/`""` on an optional key means "leave it alone",
not "clear it".

### 11.4 Merge and side effects

- Absent key → untouched. Invalid → skipped and reported. Same value → counted as unchanged, not
  rewritten.
- Importing `graip_wispUrlSelected`/`graip_wispUrlCustom` removes `graip_wispUrl`,
  `graip_wispUrlFallback` and `graip_wispUrlVerifiedAt`, otherwise the cached probe result keeps
  winning and the import looks like a no-op.
- After a successful import the panel reloads (settings are read once at boot). The reload sets
  `sessionStorage.graip_skipLeaveGuard = "1"`, which both `beforeunload` handlers check and
  `DOMContentLoaded` clears.

---

## 12. Cloaking and panic mechanics

### 12.1 What a disguise touches

`applyCloak(name)` sets `document.title` and the `link[rel*=icon]` href only. It is intentionally cheap
and runs on every page load — a tab that says "graip" while a game is open defeats the point.
`PROFILES[x].icon` may point at a bundled file (`/assets/img/cloaks/*.png`) or a remote favicon.

### 12.2 Panic sequence

```
keydown (capture, every page)
 ├─ matches(event)?  (enabled + key match + not typing + modifiers)
 ├─ preventDefault + stopPropagation
 └─ panic()
     ├─ rememberReturnPoint()                  (location.href + GraipShellState.capture())
     ├─ sessionStorage.graip_panicReturn = "1"
     ├─ sessionStorage.graip_skipLeaveGuard = "1"   (a panic is not "leaving on purpose")
     └─ openIn === "new-tab" ? openInNewTab() : location.replace(decoyUrl(...))
          decoyUrl = /panic.html?to=<dest>&cloak=<profile>[&plain=1]
```

`panic.html`:

1. Renders `#blackout` (`#000`, `position:fixed`, z-index above everything) and a hidden frame.
2. Sets the decoy title/icon immediately (from `?cloak=`), so the tab already looks right.
3. Loads `?to=` into the frame. On `load` (+ two `requestAnimationFrame`s for same-origin targets, or
   a hard timeout as the last resort) it adds `body.revealed`, drops the blackout and reveals the
   decoy page.
4. Calls `history.replaceState({}, "", "/panic.html")` **before** the target loads, so the destination
   never appears in the address bar or the back-button history.
5. `Escape` **or the configured panic key** returns the tab to `sessionStorage.graip_panicReturnUrl`
   with `location.replace` — see below. With no snapshot it falls back to a live `window.opener`
   (focus + close) and then to `history.back()`.
6. The key listener is registered capture-phase on `panic.html` **and**, for same-origin targets, on
   the frame's own document (`frame.contentWindow.document.addEventListener`). A cross-origin target
   keeps its key events, so `#hint` doubles as a click target; it only accepts pointer events once
   `body.hint-on` is set, so it never intercepts clicks a user means for the site.

#### Returning to the same place

A same-tab panic *replaces* the document, so the tab keeps no memory of what it was showing. The old
behaviour — `history.back()` — therefore landed on whatever preceded graip, which in practice is
`/start.html`, the disguise the tab was opened from: a return looked like a brand-new open.

The fix is a two-key snapshot written by `panic()` before the swap:

| Key | Written by | Read by | Cleared by |
| --- | --- | --- | --- |
| `graip_panicReturnUrl` | `panic()` → `rememberReturnPoint()` | `panic.html` → `returnUrl()` via `GraipCloak.storedReturnUrl()` | the decoy, immediately before `location.replace` |
| `graip_panicReturnState` | same, from `GraipShellState.capture()` | `index.html` → `GraipShellState.resume()` on `DOMContentLoaded` | `resume()` via `clearReturnPoint()` |

`storedReturnUrl()` only returns a URL whose origin matches `location.origin` and whose protocol is
`http`/`https`, so a stray `sessionStorage` write cannot turn the decoy into an open redirect.
`location.replace` (not `assign`) is what keeps the tab's single history entry intact: Back from the
restored tab still goes where it went before the panic.

`GraipShellState` (in `index.html`) is the shell half:

| Method | Behaviour |
| --- | --- |
| `capture()` | `{ view, frameSrc, frameInBody, frameDisplay, homeDisplay, navDisplay, navOpacity, homeBtnDisplay, drawer, panel, scrollY, at }` — inline styles only, so it describes what is on screen rather than re-deriving `navTo()`'s rules |
| `restore(state)` | Replays the snapshot: puts the frame back (re-setting `src` reloads the page, which is what restores a browser tab session), shows the page or home, re-opens the sheet/drawer via the same `toggleX()` functions, re-selects the settings panel |
| `resume()` | Reads `graip_panicReturnState`, always clears the snapshot first, restores, and logs `returned to graip` |

`resume()` is registered last (the module lives in the final `defer` block), so the deep-link handler
(`?launch=1&page=…&settings=1&section=…`) runs first and the snapshot has the final word. The browser
page no longer wipes its tab session on return: `pagehide` saved it on the way out and
`restoreTabSession()` now brings it back.

Nothing from graip may ever be visible on that page. It loads only `log.js` and `cloak.js` (for
`safeUrl`/`blankDocument`) and sets `data-graip-no-auto-cloak="1"` so `cloak.js` does not overwrite its
title.

### 12.3 Auto about:blank

`autoAboutBlank()` runs only when `graip_autoAB === "yes"`, only at top level, and only once per tab
(`sessionStorage.graip_abOpened`). It opens the current URL in a new window whose document is
`blankDocument(profile)` — a static decoy page with a hidden "press Esc" hint — so the address bar shows
`about:blank` while the real site runs in the child window.

---

## 13. CSS architecture

| File | Lines | Scope |
| --- | --- | --- |
| `styles/index.css` | 1,763 | The shell only (nav, tabs, address bar, drawers, settings sheet, toasts, library tiles, then the mobile block) |
| `assets/css/colors.css` | 18 | Default palette, 13 variables on `:root` |
| `assets/css/themes/*.css` | 16 files | Same 13 variables per theme — `coral.css`, `dunes.css`, `ember.css`, `forest.css`, `golden.css`, `lavendar.css` (sic), `lime.css`, `magenta.css`, `midnight.css`, `mint.css`, `neon.css`, `ocean.css`, `royal blue.css` (space in the name), `sea.css`, `violet.css`, `void.css` |
| `assets/css/elements.css` | 344 | Shared layout for the standalone pages (grids, bottom nav, custom select) |
| `assets/css/dropdown.css` | 137 | `.x-selector` widgets |
| `assets/css/font.css` | 151 | 24 `@font-face` rules, 16 families |
| `assets/css/t.css` | 55 | Toasts |
| `assets/css/overlay.css` | 154 | In-game overlay |
| `assets/css/ai-elements.css` | 32 | AI chat bubbles |
| `assets/css/cursor.css` | 47 | Custom cursor |
| `assets/css/mobile.css` | 142 | **644 px media query only** |

### 13.1 The variable contract

Every theme file defines exactly these on `:root`: `--bg`, `--bg-2`, `--bg-3`, `--bg-4`, `--bg-5`,
`--border`, `--border-2`, `--border-3`, `--border-4`, `--text`, `--bright-text`, `--accent`,
`--accent-2`. A new theme is a copy of an existing file with 13 colours changed — nothing else. Themes
are selected by swapping `#css-theme-link`'s href to `/assets/css/themes/<name>.css` (or
`/assets/css/colors.css` for `default`).

### 13.2 Breakpoints and the desktop guarantee

Mobile rules exist in `styles/index.css` (inside `@media (max-width: 900px)` and `(max-width: 640px)`
blocks at the end of the file) and in `assets/css/mobile.css` (640 px only).
`tests/mobile-pwa.test.js` fails if *any* top-level rule appears in either mobile section, so the
desktop view cannot change by accident. Add mobile fixes inside those blocks, never at top level.

### 13.3 Class conventions

- Layout/state: `.hcontainer`, `.vflex`, `.settings-shown` / `.settings-hidden`, `.active`,
  `.settings-page` / `.settings-active`, `.blurOverlay`.
- Components: `.tab`, `.viewframe`, `.newtab`, `.app`, `.app-image-missing`, `.toast-container`,
  `.graip-toggle-slot`, `.settings-select`, `.settings-backup-textarea`, `.debug-preview`.
- Selectors: `.wisp-selector`, `.backend-selector`, `.search-engine-selector`, `.decoy-selector`,
  `.theme-selector`, `.store-selector` — each needs `<name>-selected`, `<name>-options`, and gets a
  `<name>-show` class on open.
- Utility classes from Tailwind CDN appear inline on some pages. They are not part of the design
  system; do not build on them.

---

## 14. Data formats

### 14.1 Game and app lists

```json
[ { "name": "Crazy Cattle", "url": "/stores/ucp-games/cc3d/", "img": "/assets/img/games/cc3d.png" } ]
```

`name` and `url` are required (the loader drops entries without them and records a library issue);
`img` is optional and gets a placeholder when it fails. `games` entries open through
`pages/play.html?launch=<url>`; `apps` entries may be external (`https://…`) and are opened by
`rSearch`. Totals: `classplay.json` 97, `gn-math.json` 478, `apps.json` 30, `partners.json` 2.

### 14.2 Images

`assets/img/games/` 119 PNGs + `assets/img/games/gn-math/` 622 (one per GN-Math entry);
`assets/img/apps/` 50 (29 referenced); `assets/img/cloaks/` 8; `assets/img/partners/` 2; `fav.png`
(160×160), `fav.svg`, `cover.png`, `s.png`, `c-down.png`. Thumbnails are lazy (`data-bg` +
IntersectionObserver), never `<img>` in the grid.

### 14.3 Fonts and icons

`assets/fonts/`: 16 top-level files + `gg-sans/` (4 weights) + `sfc/` (6 SF Compact weights);
`googlesans.ttf` is 4 MB — the single largest first-party asset. `fa/` is Font Awesome **Free** 7.1.0
(21 CSS files, 388 webfonts) — Pro-only icon names render nothing. `assets/icons/fonts/` is Remix Icon
4.7.0 plus the vendor's demo HTML; only `remixicon.css` is used by the site.

---

## 15. Testing

```bash
node --test tests/*.test.js        # 137 tests, ~5 s, no dependencies, no network
```

| File | Tests | Behaviour it pins |
| --- | --- | --- |
| `wisp.test.js` | 5 | URL normalisation, preset lookup, handshake probing |
| `wisp-selection.test.js` | 7 | Chosen endpoint survives failover, fallback labelling, custom URLs |
| `proxy-errors.test.js` | 3 | curl code → message classification, retry budgets |
| `scramjet-errors.test.js` | 4 | Worker error page, proxy-vs-origin failures |
| `service-worker-control.test.js` | 2 | `skipWaiting`/`claim`, controller readiness |
| `libcurl-bundle.test.js` | 6 | WASM magic, load timeout, abort path, no TLS downgrade |
| `browser-recovery.test.js` | 2 | Route recovery path |
| `browser-tab-navigation.test.js` | 1 | `go()`/`nav()` wiring and failure branch |
| `page-bootstrap.test.js` | 11 | Every page boots with missing DOM/globals |
| `site-wiring.test.js` | 10 | Asset refs resolve, nav targets exist, sidebar ↔ panels, no missing `/pages/*.html`, counter cannot throw, `<head>` structure, no duplicate `<script src>`, release version |
| `panic-log.test.js` | 32 | Log filtering/redaction, panic matching/navigation, decoy structure, the return path (`returnUrl`/`leave` run against a fake document), `GraipShellState` capture/restore/resume, cloak profiles, tab restore, omnibox |
| `mobile-pwa.test.js` | 17 | Media-query-only CSS, desktop untouched, manifest, SW shell caching, library placeholders |
| `settings-io.test.js` | 28 | Allowlist, validation, partial imports, reset, failure paths, panel wiring |

Conventions that make these work — follow them, they cost nothing:

- Modules are loaded into a `vm` context with hand-built fakes; nothing uses jsdom.
- Arrays/objects created inside the context have a different prototype: compare with
  `JSON.stringify`, not `assert.deepStrictEqual`.
- Workers need `importScripts` and `self.addEventListener` stubs, and `self.location`.
- Parse HTML as a string; do not boot a DOM.

### 15.1 Out-of-tree behavioural checks

```bash
python3 -m http.server 8899 --bind 0.0.0.0 &     # repo root
cd /tmp/verify && npm i jsdom@24                  # throwaway, never committed
```

Mandatory harness details: `process.on("unhandledRejection", () => {})` (jsdom surfaces page errors as
rejections and would kill the process), `resources: "usable"`, `pretendToBeVisual: true`, wait for
`load` + ~300 ms, and filter the expected noise (`MessagePort`, service-worker registration, CDN
failures for `lucide`/`marked`/`io`/Tailwind, WebGL/`canvas.getContext()`, particles).

There is no Chromium or Playwright here: **proxy traffic cannot be exercised end to end**. Say what was
and was not covered; never call a proxy fix "verified" on jsdom evidence alone.

---

## 16. Security and privacy model

What the project actually promises, and where each promise is implemented:

| Promise | Implementation | Where it can break |
| --- | --- | --- |
| Query strings are never recorded | `GraipLog.safeUrl()` strips query + fragment; `describeRequest()` in `sw.js` does the same | A new log call passing a raw `location.href` |
| TLS verification is never disabled | The libcurl bundle keeps peer verification; curl 60 is surfaced, not bypassed | Editing the WASM/CA bundle or the transport flags |
| A panic leaves no destination behind | `history.replaceState` in `panic.html`, `scrubDocumentUrl()`; the return point lives in `sessionStorage` and never reaches the address bar | Writing the destination anywhere persistent (do not) |
| A config file cannot inject code | `settings-io.js` type validation (`url`/`wisp`/`token` regexes) | Assigning imported values to `href`/`src` without validation |
| Cloaking does not leak the real title | `cloak.js` sets title/icon on load; `panic.html` opts out of auto-cloak | A page that overrides `document.title` after load |
| Proxied traffic is never cached | `sw.js` `isProxyPath()` guard | Adding a cache-first branch for `/~/sj/` |
| No account, no server-side state | Nothing but static assets | Adding a backend call that sends URLs anywhere |

Known gaps, stated plainly: there is **no CSP** (the shell injects inline scripts by design), the site
loads an Umami analytics tag and a dead visitor counter in `index.html`, and `start.html` plus the
`og:image` meta still contain upstream author metadata. The debug log is capped and redacted but it is
still a record of *what the user did* (not where) — treat an exported log as personal data.

---

## 17. Performance notes

- **Shell payload**: `index.html` 1,831 lines (92 KB) + `styles/index.css` (1,763 lines, 34 KB) + ~9
  first-party scripts.
  `assets/js/lib/three.min.js` (26,887 lines) and `vanta.fog.min.js` are the heaviest first-party
  downloads and are only on `index.html`; the fog toggle exists to let users drop them.
- **Lazy everything**: tabs restore lazily (`restoreUrl`), thumbnails load through an
  IntersectionObserver probe, the libcurl transport is a dynamic `import()`, bare-mux is created on
  first use, and `scratch` Scramjet frames are created per tab on demand.
- **Caching**: `/assets/*` gets a 7-day `Cache-Control` on Vercel (`vercel.json`), the worker serves
  the shell network-first with a cache fallback, and `sw.js` itself is `must-revalidate` so a deploy
  lands.
- **Avoid**: adding more vendored libraries to the shell, eagerly probing all 30 Wisp endpoints, or
  making the shell wait on anything other than the three boot promises in `go()`.

---

## 18. Browser and environment support

| Environment | Notes |
| --- | --- |
| Chromium (Chrome, Edge, Chromebooks) | The primary target; service workers, `about:blank` windows and PWA install all work |
| Firefox | `sw.js` has a shim that defines `crossOriginIsolated = true`; Scramjet needs it |
| Safari / iOS | Service worker + standalone mode work; `about:blank` popups are more restricted, so auto-cloak may be blocked by the popup blocker |
| Incognito / private | `localStorage` may be unavailable at the end of the session; every storage access is wrapped |
| No WebGL | The Vanta fog is wrapped in `try/catch` and logs `ui` → `fog background unavailable` |
| Filtered network | The shell boots from the cache; CDN scripts fail and every feature that needs one checks its global first |
| No service worker | The site loads, but `go()` cannot proxy: it waits, then reports "Proxy unavailable" |

---

## 19. Deploy and release

- **Any static host**. Root deployment only: the worker must live at `/sw.js` with
  `Service-Worker-Allowed: /`. A project subpath breaks it.
- **Vercel**: `vercel.json` sets the manifest MIME type, `sw.js` no-cache + `Service-Worker-Allowed`,
  `/assets/*` 7-day cache, `nosniff` and `no-referrer`. No build, no rewrites.
- **Cloudflare Pages**: 25 MB per-file limit forces the GN-Math store only; the Classplay game files do
  not fit (`MOVING.md` records this).
- **Release checklist**: only change versions when the user supplies the exact name/number and asks
  for a repo-wide update. Keep the index version stamp, Settings footer/Updates panel,
  `assets/js/log.js` `APP_VERSION`, tests and README heading synchronized; keep the log/settings schema
  versions separate from the app release version. Bump `SHELL_CACHE` when shell behavior/assets
  change. Run the tests and update one dated README entry with every change included in the release.
- Prefix the release PR title with `<version> initial: <concise changes>` (for example,
  `v2.1.0 initial: version metadata and dated changelog`).
- Do not add an automated upstream sync workflow. Keep fork-specific work on the current Arena branch.

---

## 20. Debugging cookbook

| Symptom | First check | Then |
| --- | --- | --- |
| Sites never load, tab says "Proxy unavailable" | Settings → Debug: is there a `wisp` error? | Settings → Proxy → *Test current server*, then *Test all Wisp routes* |
| Tab loads but the frame is the host's 404 | `navigator.serviceWorker.controller` — no controller means the worker is not intercepting | Reload, or *fixProxy*, or check the worker scope |
| Every request returns `Site Blocked` | `CONFIG.blocked` in `sw.js` matched the destination | Narrow the pattern; the log names the host |
| `error code 60` | Which host? Is it only that host? | Compare a known-good site; try one other route to prove it is route-specific; never disable verification |
| Log panel is empty | Is `log.js` loaded before the page's own scripts? | `GraipLog.entries().length` in the console; check that verbose is on |
| A page's JS silently stops halfway | An uncaught `TypeError` in the same `<script>` block | Console, then guard the lookup (`if (!el) return`) |
| Settings do not apply after import | Import reloads the page; a failed import shows the reason in `#settings-import-status` | Preview the file, check the per-key skip reasons |
| Panic does nothing | Toggle off? Typing in an input? Modifier held? | `GraipCloak.matches(event)` in the console |
| Images all show placeholders | `graip_libraryIssues` in storage | Settings → Debug → *Check library now* |
| Stale assets after deploy | Service worker serving the old shell | Bump `SHELL_CACHE`; DevTools → Application → Service Workers → Update |

Console one-liners that answer most questions:

```js
GraipLog.entries().slice(-20)          // what just happened
GraipWisp.getConfiguredUrl()           // what the user chose
GraipWisp.getActiveUrl()               // what answered last
GraipCloak.settings()                  // panic/cloak state
GraipSettings.collect()                // every backed-up setting
JSON.parse(localStorage.graip_tabs__)  // (see §6.2 for the real key: pathname-suffixed)
navigator.serviceWorker.controller     // null means the proxy cannot intercept
```

---

## 21. Conventions and invariants

### Additional non-negotiable agent rules

1. **Accessible UI:** new interactive elements need an accessible name, keyboard operation, visible focus, and a reduced-motion-safe presentation. Use native controls where possible.
2. **Settings schema:** every new persistent setting must be added to `assets/js/settings-io.js` `SCHEMA`, wired into Settings and runtime behavior, documented in the settings reference, and covered by tests for validation/backup/import behavior.
3. **Logging privacy:** add tests for logging changes that prove keyboard events and visited-site URLs or typed content are not captured; log only explicitly permitted operational endpoints (Wisp/API/server) when a URL is needed.
4. **Unavailable controls:** when a setting or feature is disabled/grayed out because of another setting or condition, always show a short note directly beneath it explaining what the user must do to re-enable it. Keep the note hidden while the control is available.


**Style.** Plain browser JS; no modules except `import("/libcurl/libcurl.mjs")`; no TypeScript; no
framework. 2-space indent in `assets/js`, 4-space in HTML, tabs in `sw.js` and vendored files. Match the
file you are in — the repo has three styles and that is fine.

**Comments.** Explain *why* a workaround exists, not what the next line does. The existing comments are
the reason this codebase is maintainable.

**Copy.** Lowercase, short, sentence-cased, no trailing period on buttons ("Test current server").
Never describe public Wisp endpoints as official or reliable.

**Code invariants.**

1. Shared scripts must survive missing DOM and missing globals.
2. Proxy navigation only through `go()`; never assign a proxied `iframe.src` by hand.
3. Same-origin page navigation only through `navTo()`; every `pages/*.html` reference must exist.
4. Settings reads/writes in bulk only through `GraipSettings`; single values through their owning
   module (`GraipCloak.KEYS`, `GraipWisp.KEYS`, …).
5. Log through `GraipLog`; never add a second logging path.
6. New user-visible actions and every failure path get a log line.
7. New toggles mount through `.graip-toggle-slot` + `debug-panel.js`; do not copy the switch markup.
8. Mobile CSS lives only inside media queries.
9. `sw.js` never caches proxied or cross-origin responses.
10. Any change to a URL, title or storage key updates this document.

---

## 22. Traps

- Dead third-party endpoints: `api.x8r.dev` (visitor counter, CometChat tokens, Hyperbeam),
  `qs03x443-3000.usw3.devtunnels.ms` (chat socket). Features on them must degrade with a visible
  message; `index.html` shows the pattern (dash + one log entry + stop polling).
- TMDb host is `api.themoviedb.org`; `api.tmdb.org` does not serve the API. Streams come from
  `iframe.pstream.mov`, `multiembed.mov`, vidsrc.
- CDN dependencies (Alpine, Tailwind, `marked`, `lucide`, KaTeX, `socket.io`, `emoji-mart`, `eruda`)
  fail on filtered networks — check the global before use.
- `stores/ucp-games/*`, `homework/math.all.js`, `assets/icons/fonts/index.html`, `start.html`,
  `pages/classroom.html` are huge vendored files: greps and diffs against them are noise.
- `start.html` contains an upstream `og-profile-acct` Gmail address; `index.html` still points
  `og:image`/`twitter:image` at `https://cherri.x8r.dev`. Both are upstream leftovers.
- Single-commit `main` history: diff against `https://github.com/x8rr/cherri` (shallow clone).
- The nightly sync workflow forcibly syncs the default branch — never work on `main`.
- `tests/site-wiring.test.js` enforces invariants that were broken once already: the Movies tab opens
  the built-in page, side menus deep-link to `/?launch=1&settings=1`, every nav/settings target exists,
  no `/pages/*.html` reference is missing.
- Regenerating anything in `libcurl/` by hand is forbidden; rebuild from the packages and re-run the
  bundle test.

---

## 23. Repo sweep findings

A full pass over every first-party file and every vendored tree. Fifteen findings, all real, none
blocking. #5 and #15 are **fixed**; the rest are documented behaviour.

1. **`assets/js/chatrooms.js` is dead code** — no page includes it; `chatrooms.html` has its own
   socket.io client.
2. **`assets/js/lib/detectmobile.js` is only used by vendored GN-Math pages.**
3. **`assets/css/themes/mint.css` exists but is not offered** — `allThemeOptions` in `dropdown.js`
   lists 15 themes + `default`. Add `"mint"` there to expose it; `settings-io.js` already accepts it.
4. **`assets/json/partners.json` is inconsistent** — the Hydra Network entry points at
   `https://prism.onl/` and reuses `prism.png` although `hydra.png` exists; the Hydra tile in
   `index.html` uses `hydra.png` directly.
5. **~~`index.html` had a stray `</html>` inside `<head>`~~ — fixed.** It sat before the manifest and
   `theme-color`/Apple meta tags, so the parser closed `<head>` early and pushed them into `<body>`;
   the trailing `</head>` became a no-op. Removed, and `site-wiring.test.js` now fails if a `</html>`
   reappears inside `<head>`, if `<head>` closes twice, or if the same `<script src>` is listed twice.
6. **`pages/classroom.html` (37,761 lines) is unreachable** — a second Classroom copy from upstream;
   `start.html` is the one that is shown.
7. **`pages/gmbl.html` is only reachable by URL** — its sidebar entry is commented out.
8. **Icon-font mismatch in the settings sidebar** — it asks for `far fa-cog`, `far fa-bug`,
   `far fa-hood-cloak`, `far fa-bell-on`, but the bundled font is Font Awesome **Free**, so some icons
   render blank. Use names that exist in `fa/css/all.min.css` (`fa-floppy-disk` does; `fa-cog` does not).
9. **Two identical `beforeunload` handlers** in `index.html`; both honour `graip_skipLeaveGuard`. A
   third guard must check it too.
10. **`settings.js` is still loaded by 96 vendored store pages** — hence the optional-everything rule.
11. **Visitor counter and chat endpoints are dead**; both now fail visibly.
12. **`404.html` carries unreachable navigation JS** (`navTo`, `rSearch`, `toast`) — no nav and no
    `#homesearch` input. `rSearch()` used to target the never-existing `/pages/ultraviolet.html`; it now
    targets `pages/browser.html`, and a test fails on any missing `/pages/*.html` reference.
13. **The fog background is the only WebGL dependency**; a `VANTA.FOG()` throw used to abort the rest of
    that script block (counter, Wisp status, settings wiring). Now guarded.
14. **No CI runs the tests.** The only workflow syncs the fork. A new workflow must stay
    dependency-free (`node --test tests/*.test.js` needs nothing installed).
15. **~~The Tailwind CDN was requested twice in `<head>`~~ — fixed in `index.html` *and*
    `newtab.html`**, and the duplicate `<script src>` check in `site-wiring.test.js` now runs over every
    first-party page, so the whole class of bug is pinned. Note that Tailwind's JIT CDN script is
    still the first thing that runs on the shell, before `log.js`: a network stall there delays every
    boot, which is why `log.js` installs `window.onerror` in the second script slot, not after it.

---

## 24. Playbooks

**Add a settings toggle.** Panel markup → `<div class="graip-toggle-slot" data-slot="name"></div>`;
`debug-panel.js` → `mountToggle("name", { id, checked, onChange })`; persist under a `graip_` key;
add a `SCHEMA` row in `settings-io.js`; log the change; extend a test.

**Add a select.** Prefer `<select id="…" class="settings-select">`; populate options from the owning
module's table (`TARGETS`, `PANIC_KEYS`, …), never inline in markup.

**Add a page.** Create `pages/<name>.html`, include `log.js` + `cloak.js` (+ `colors.js`, `t.js` as needed),
add a `navTo('x')` entry **and** make sure the nav target exists (the wiring test checks both ways),
add it to the jsdom smoke list, and document it in §4.

**Add a cloak profile.** One entry in `GraipCloak.PROFILES` (title, icon, page kind). `dropdown.js`,
`panic.html` and `about:blank` pick it up automatically. If it needs a new page kind, extend
`decoyMarkup()`.

**Add a Wisp preset.** One entry in `GraipWisp.PRESETS` with an `id`, a `name` and a trailing-slash URL.
Do not add one you have not probed; do not promise uptime.

**Add a log line.** `GraipLog.info("category", "what happened", { …safe fields })`. URLs go through
`safeUrl`. User actions use `action()`.

**Add a migration.** Follow `graip_searchEngineGoogleDefaultV1`: a version marker key, idempotent,
guarded, and logged.

**Change storage.** Update §6, the `settings-io.js` schema if it is a preference, and any test that
asserts the key.

---

## 25. Review checklist

- [ ] `node --test tests/*.test.js` → 137/137, and a test exists for the new behaviour
- [ ] No new dependency, build step, or vendored file
- [ ] Every new DOM lookup is guarded; every new page is loadable standalone
- [ ] No site URL, token or query string reaches the log
- [ ] New preference: `SCHEMA` row + README settings table + AGENTS §6
- [ ] New action or failure path: a `GraipLog` line
- [ ] Mobile changes only inside media queries
- [ ] Proxy changes: no TLS downgrade, no caching of proxied responses, `go()` still the only path
- [ ] `README.md` / `AGENTS.md` updated in the same commit
- [ ] jsdom smoke run over the touched pages, with the coverage stated honestly

---

## 26. Fork delta versus upstream Cherri

Kept for context; the authoritative list is `README.md` → FORK NOTICE.

- Rebranded Cherri → graip (display text, storage keys, globals, titles); default theme `midnight`.
- Wisp handling rewritten: real handshake probing, 30 presets, pooled failover that never overwrites
  the user's choice, `chosen → fallback` labelling.
- TLS failures classified and retried (curl 7/35/60) with explanations; verification stays on.
- libcurl.js 0.7.5 + libcurl-transport 2.0.6, with a load timeout and `libcurl_abort` handling.
- Panic key + blackout decoy page (`panic.html`), cloak profiles, auto-`about:blank`.
- Panic return point: the decoy reopens graip at the exact URL, page, drawer and settings panel the
  user left, instead of falling through to `/start.html` via `history.back()`.
- Current release stamp `v2.1.0 "juice"`: `<graipattr version="s2.1.0">` in `index.html` drives
  the update toast; the Settings footer/Updates panel and `GraipLog.snapshot().appVersion` show
  `v2.1.0 "juice"`; the shell cache is `graip-shell-v8`. The previous v2.0.0 release was
  introduced on 2026-10-26.
- Exportable debug log (verbose on by default) and Debug/Backup settings panels.
- Tab sessions restored after reload; omnibox shortcuts and bangs.
- Mobile layout (desktop unchanged); PWA manifest + offline shell cache; `vercel.json` headers.
- Library hygiene (placeholders + `graip_libraryIssues`), settings export/import.
- Fixes: Movies tab opened an external site; settings sidebar blanked the panel; side-menu settings
  links pointed at a nonexistent page; movies called `api.tmdb.org`; chat hung on its loader; shared
  scripts threw on pages without their markup; `sw.js` never called `skipWaiting()`; visitor counter
  threw on load; `VANTA.FOG()` aborted its script block; `404.html` pointed at a missing page.
- Added `tests/` and this handbook (the suite now has 137 tests).

---

## 27. UI architecture and contribution patterns

This section is the practical map for visual changes. Keep the HTML-first, static-site model: there is
no app bundler or component framework. The shell is assembled in `index.html` (markup plus inline
scripts), styled primarily by `styles/index.css`, and enhanced by shared scripts in `assets/js/`.
Feature pages are separate HTML documents under `pages/`, usually shown in the shell's
`#contentFrame`; some can also be opened directly. `assets/css/elements.css` provides shared styles
for those pages, while feature-specific styles may live in the page or a dedicated stylesheet. A few
legacy pages use utility classes from the Tailwind CDN; that is a dependency of those pages, not the
preferred way to build new UI. Use existing CSS and theme tokens instead of adding a library.

### 27.1 Desktop and mobile are intentionally different

The mobile UI is not simply a shrunken desktop layout. Preserve established interaction differences
and keep phone-only corrections inside the mobile media queries described in §13.2. Do not move a
mobile fix to a top-level rule to make it easier to write; that can change desktop.

| Area | Desktop | Mobile / narrow viewport |
| --- | --- | --- |
| Shell navigation | Compact navigation sits at the top of the shell. | Navigation becomes the fixed bottom bar; keep page content and controls clear of it and of device safe areas. |
| Settings | A centered settings sheet with a side category list and a content pane. | Categories and settings content stack/scroll in the available viewport; controls must remain reachable without horizontal overflow. |
| Apps and Games | Launcher panels use the shared tile system and keep the established desktop activation behavior. | Search and tiles fit the viewport; the shared `.launcher-grid` keeps a consistent four-across tile layout where space permits. Games show the mobile details dialog before the Play action. |
| Movies | The feature page uses its desktop card grid and controls. | Cards reflow to fewer columns and controls remain touch-sized; preserve the current Movies composition when editing other pages. |
| Special Thanks | Cards use the desktop panel and grid dimensions. | The panel grows with its contents and the cards use the compact phone layout rather than being clipped. |
| Feature pages in the shell | Page documents render in the content iframe and retain their feature-specific desktop layout. | The same page documents use responsive rules (often from `assets/css/mobile.css`); test the page in the shell as well as standalone if its navigation or sizing depends on the shell. |

This table records interaction and layout contracts, not pixel-perfect dimensions. Before changing a
feature, inspect its current markup and the matching selectors in `styles/index.css`,
`assets/css/elements.css`, `assets/css/mobile.css`, or its own page. The approved Apps/Games and Movies
layouts are regression-sensitive; make the smallest local change and compare both viewport classes.

### 27.2 Where to make a visual change

1. **Shell structure or shell behavior:** edit the relevant markup in `index.html`; shared settings,
   dropdown, logging, and navigation helpers are in `assets/js/`. Keep shell-only styling in
   `styles/index.css`.
2. **A standalone/iframe feature:** edit its `pages/<feature>.html` and feature stylesheet, if any.
   Shared page chrome belongs in `assets/css/elements.css`; shared phone overrides belong in
   `assets/css/mobile.css` (max-width 644 px). Do not assume a page's CSS is inherited from the shell:
   the iframe has its own document and stylesheet cascade.
3. **Theme-sensitive colors:** use the variables from §13.1 (`--bg*`, `--border*`, `--text`,
   `--bright-text`, `--accent`, `--accent-2`) rather than hard-coded palette colors. Theme selection
   swaps the root theme stylesheet, so hard-coded colors will not adapt.
4. **Icons:** reuse the icon libraries already loaded by the page and provide accessible text/labels
   for icon-only controls. Do not add or edit vendored assets just to change markup.
5. **Responsive behavior:** add narrow-viewport rules inside the existing media query. Keep the
   unqualified/base rule responsible for desktop, and add the corresponding mobile override only when
   needed. Prefer `min-width: 0`, wrapping, and bounded widths over viewport-wide overflow.

### 27.3 Dropdown / selector pattern

The Settings selectors are built from a wrapper, a selected-value element, and an initially empty
options container. Their classes follow the selector contract in §13.3 (for example,
`.theme-selector`, `.theme-selected`, `.theme-options`). `assets/js/dropdown.js`'s `createSelector()`
takes `(selectorType, selectedEl, optionsEl, allOptions, currentVal, storageKey, eventName, successMsg)`;
it sets the selected text, excludes the current choice from the generated options, closes other
selectors, persists the selected value, optionally emits a `CustomEvent` and success toast, logs the
setting action, and calls `runMenuCloak()` for the special `cloakLink` key. `backend` and `transport`
values are lowercased before storage. The current option rows are clickable `<div>` elements and the
helper does not provide keyboard or ARIA behavior, so add those explicitly when building an accessible
new selector. When adding a selector:

- Reuse this pattern and the shared `closeAllSelectors()` behavior rather than adding a second,
  incompatible dropdown implementation.
- Add the wrapper/selected/options markup in the appropriate Settings page, with a unique selector
  type and storage key; wire its initialization alongside the existing `createSelector()` calls.
- Enumerate allowed values in code. Normalize values only where the existing storage contract
  requires it, and listen for the event where dependent UI must refresh.
- Match the selector's open/closed CSS states in `assets/css/dropdown.css` or the shell stylesheet as
  appropriate. Keep the options usable on touch screens and within the viewport.
- Include button-like keyboard operation, focus visibility, and `aria-expanded` / `aria-controls` (or
  an equivalent accessible pattern) when introducing a new selector; do not copy missing accessibility
  behavior just because a legacy selector lacks it. Use DOM APIs and `textContent` for option labels,
  never HTML interpolation for values.
- Log a settings change through `GraipLog.action("settings", ...)` without logging typed content,
  destinations, or other private values. Add/update the relevant test for persistence and emitted events.

### 27.4 Switch / checkbox pattern

Use a native checkbox inside the existing `.switch` label and the existing `.slider` / `.circle`
structure. Give it a stable, unique `id`, a visible nearby heading and explanation, and a real label
(or an `aria-label` when the design cannot show one). Native checkbox semantics preserve keyboard
and assistive-technology support; do not replace the input with a clickable `div`.

For a new persistent switch, initialize its checked state from its documented storage key during page
startup and have one named change handler own persistence and side effects. Follow existing Settings
conventions: validate dependencies (for example, Reduced Motion can disable motion features), keep the
control state synchronized when a parent setting changes, dispatch an event if another subsystem needs
to react, and record the setting action with `GraipLog`. Never log keystrokes, entered text, or link
destinations. Provide a disabled-state explanation if a parent preference makes the switch unavailable.

### 27.5 UI change checklist

- Identify whether the element belongs to the shell or to an iframe page; update the correct document
  and stylesheet.
- Preserve desktop behavior when a request is mobile-only; scope mobile overrides as §13.2 requires.
- Check the phone layout around the bottom navigation, settings sheet, and safe areas; check desktop
  at a wide viewport too. Test keyboard focus and reduced-motion behavior for interactive controls.
- For dropdowns/switches, verify initial saved state, change handling, persistence, logging privacy,
  and any dependent event or visual state.
- Add regression tests to `tests/`, run `node --test tests/*.test.js`, and run `git diff --check`.
  A passing source test is not a substitute for visually verifying the deployed preview when the fix
  concerns appearance or rendering.

---

## 28. README badge conventions

The badge block at the top of `README.md` is manually maintained. Use ShieldCN for badge images and
keep the existing theme-aware `<picture>` pattern: the `<source>` selects the dark-mode URL and the
`<img>` is the light-mode fallback. In HTML attributes, encode query separators as `&amp;`. Keep
meaningful `alt` text and wrap live repository metrics in links to the matching GitHub page.

When adding or updating badges:

- Use the canonical repository path `debug-cli/graip` for live GitHub metrics. Do not copy the example
  source in an attached badge template (it may refer to another repository) or use the old
  `debug-cli/cherri-vercel` path for repository statistics.
- Only include badges for facts that are true of this repo. The currently relevant static facts are
  no build step, the current passing test count, the Scramjet/Ultraviolet proxy, libcurl.js/Wisp
  transport, Vercel hosting, Tailwind CDN usage, and the presence of this agent guide. Do not add
  sample badges for Next.js, React, TypeScript, package managers, or tools this repo does not use.
- Keep the static Tests badge in sync with the real `node --test tests/*.test.js` result; it currently
  reports **137 passing**. Run the full suite before changing that number.
- There is no tracked GitHub Actions workflow in this repository today. Do not add a CI-status badge
  that implies a workflow exists; reassess if the repository gains CI later.
- Replace any `shields.io` image badges with the corresponding ShieldCN image rather than mixing badge
  providers. Keep deploy buttons from other providers as distinct links, unless replacing a
  Shields.io-derived badge itself.

After changing the README badge markup, run `node --test tests/*.test.js` and
`git diff --check`. `tests/site-wiring.test.js` checks that the README uses this repository's ShieldCN
metrics and has no remaining Shields.io image URLs.

---

## Verifying this document

Everything above is checkable from a clone:

```bash
wc -l index.html panic.html sw.js assets/js/*.js styles/index.css   # line counts
ls assets/css/themes | wc -l                                       # 16 themes
ls assets/json && node -e 'for (const f of ["classplay","gn-math","apps","partners"])
  console.log(f, JSON.parse(require("fs").readFileSync(`assets/json/${f}.json`)).length)'
node --test tests/*.test.js | tail -3                              # 137 pass
git ls-files | wc -l                                               # 8400
```

If a number here disagrees with the tree, the tree is right: fix the document in the same commit that
changed the code.
