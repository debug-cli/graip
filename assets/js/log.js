/**
 * graip debug log.
 *
 * A single, dependency-free recorder for everything the site does: navigation,
 * settings changes, Wisp probe results, proxied requests (reported by sw.js),
 * route recovery and every uncaught error. The buffer is exportable from
 * Settings -> Debug as JSON or plain text, which is the whole point: when a
 * filter breaks something, the user can hand over one file instead of a
 * screenshot of a console.
 *
 * Design constraints:
 * - must load before every other script so it can catch their errors;
 * - must never throw itself (a broken logger is worse than no logger);
 * - must not keep more than a bounded number of entries in memory or storage;
 * - must not record query strings or fragments, only origin + pathname.
 */
(function (global) {
  "use strict";

  const VERSION = 1;
  const APP_VERSION = "v2.1.0 \"juice\"";

  const KEYS = {
    verbose: "graip_verboseLogs",
    buffer: "graip_debugLog",
    maxEntries: "graip_debugMaxEntries",
  };

  /** Entries kept in memory. Older ones are dropped first. */
  const MEMORY_LIMIT = 1000;
  /** Entries mirrored into localStorage so a reload does not lose a crash. */
  const STORAGE_LIMIT = 400;
  const MAX_DATA_CHARS = 2000;

  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

  const state = {
    entries: [],
    seq: 0,
    verbose: true,
    listeners: new Set(),
    persistTimer: null,
    installed: false,
    swConfigured: false,
  };

  const originalConsole = {
    log: console.log.bind(console),
    info: console.info ? console.info.bind(console) : console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  function now() {
    try {
      return new Date().toISOString();
    } catch (error) {
      return String(Date.now());
    }
  }

  /** localStorage wrapper that never throws (private mode, quota, disabled). */
  function storage() {
    try {
      const store = global.localStorage;
      if (!store) return null;
      const probe = "__graip_probe__";
      store.setItem(probe, "1");
      store.removeItem(probe);
      return store;
    } catch (error) {
      return null;
    }
  }

  function readVerbose() {
    const store = storage();
    if (!store) return true;
    const value = store.getItem(KEYS.verbose);
    if (value === null || value === undefined) return true; // on by default
    return value !== "off" && value !== "no" && value !== "false";
  }

  /**
   * Keep URLs useful but not incriminating: the log is meant to be shared, so it
   * records where a request went, never what was typed after a `?` or `#`.
   *
   * @param {string} value
   * @returns {string}
   */
  function safeUrl(value) {
    if (typeof value !== "string" || !value) return value;
    try {
      const url = new URL(value, global.location && global.location.href);
      const path = url.pathname.length > 120 ? url.pathname.slice(0, 120) + "…" : url.pathname;
      return url.origin + path;
    } catch (error) {
      return value.length > 160 ? value.slice(0, 160) + "…" : value;
    }
  }

  /**
   * Shrink arbitrary data to something JSON- and clipboard-friendly while keeping
   * the shape. Errors become {name, message}.
   */
  function cleanData(value, depth) {
    const level = depth || 0;
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      return value.length > 300 ? value.slice(0, 300) + "…" : value;
    }
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
    if (value instanceof Error || (value && value.name && value.message && level === 0)) {
      return { name: value.name || "Error", message: String(value.message || value) };
    }
    if (level > 2) return "[…]";

    if (Array.isArray(value)) {
      return value.slice(0, 25).map((item) => cleanData(item, level + 1));
    }

    if (typeof value === "object") {
      const out = {};
      let count = 0;
      for (const key of Object.keys(value)) {
        if (count++ >= 25) {
          out["…"] = "truncated";
          break;
        }
        let item = value[key];
        if (typeof item === "string" && /^(https?:)?\/\//i.test(item)) item = safeUrl(item);
        out[key] = cleanData(item, level + 1);
      }
      return out;
    }

    return String(value);
  }

  function shouldRecord(level) {
    return state.verbose || LEVELS[level] >= LEVELS.warn;
  }

  function schedulePersist() {
    if (state.persistTimer) return;
    state.persistTimer = setTimeout(() => {
      state.persistTimer = null;
      persist();
    }, 750);
  }

  function persist() {
    const store = storage();
    if (!store) return;
    try {
      const slice = state.entries.slice(-STORAGE_LIMIT);
      store.setItem(KEYS.buffer, JSON.stringify({ version: VERSION, savedAt: now(), entries: slice }));
    } catch (error) {
      // quota: drop the stored copy rather than break the page
      try {
        store.removeItem(KEYS.buffer);
      } catch (inner) {
        /* ignore */
      }
    }
  }

  function restore() {
    const store = storage();
    if (!store) return;
    try {
      const raw = store.getItem(KEYS.buffer);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries)) return;
      // Keep the restored entries, but mark them so the current session's
      // timestamps stay honest.
      state.entries = parsed.entries.slice(-STORAGE_LIMIT);
      state.seq = state.entries.reduce((max, entry) => Math.max(max, entry.seq || 0), 0);
    } catch (error) {
      /* corrupted buffer: start fresh */
    }
  }

  function notify(entry) {
    state.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (error) {
        /* a broken listener must not break logging */
      }
    });
  }

  function mirror(level, category, message, data) {
    const prefix = `%c[graip]%c ${category}`;
    const style = "color:#e2588d;font-weight:bold";
    const plain = "color:inherit";
    const args = [prefix + " " + message, style, plain];
    if (data !== undefined) args.push(data);

    if (level === "error") originalConsole.error(...args);
    else if (level === "warn") originalConsole.warn(...args);
    else originalConsole.log(...args);
  }

  /**
   * Record one entry.
   *
   * @param {"debug"|"info"|"warn"|"error"} level
   * @param {string} category e.g. "nav", "wisp", "net", "settings"
   * @param {string} message
   * @param {unknown} [data]
   * @returns {object|null} the stored entry, or null when filtered out
   */
  function log(level, category, message, data) {
    try {
      const safeLevel = LEVELS[level] ? level : "info";
      if (!shouldRecord(safeLevel)) return null;

      const entry = {
        seq: ++state.seq,
        at: now(),
        level: safeLevel,
        category: String(category || "app").slice(0, 40),
        message: String(message === undefined ? "" : message).slice(0, MAX_DATA_CHARS),
        page: global.location ? safeUrl(global.location.href) : "",
      };

      if (data !== undefined) {
        const cleaned = cleanData(data, 0);
        const json = JSON.stringify(cleaned);
        entry.data = json && json.length > MAX_DATA_CHARS ? { truncated: true } : cleaned;
      }

      state.entries.push(entry);
      if (state.entries.length > MEMORY_LIMIT) {
        state.entries.splice(0, state.entries.length - MEMORY_LIMIT);
      }

      mirror(safeLevel, entry.category, entry.message, entry.data);
      notify(entry);
      schedulePersist();
      return entry;
    } catch (error) {
      return null;
    }
  }

  const api = {
    VERSION,
    KEYS,
    LEVELS,

    debug: (category, message, data) => log("debug", category, message, data),
    info: (category, message, data) => log("info", category, message, data),
    warn: (category, message, data) => log("warn", category, message, data),
    error: (category, message, data) => log("error", category, message, data),

    /**
     * A user-visible action (click, navigation, toggle). Debug level, because
     * this is the noisiest stream and only interesting when verbose is on.
     */
    action: (category, message, data) => log("debug", category, message, data),

    log,
    safeUrl,

    entries() {
      return state.entries.slice();
    },

    /** Newest last; `limit` defaults to everything held in memory. */
    recent(limit) {
      const slice = limit ? state.entries.slice(-limit) : state.entries.slice();
      return slice;
    },

    subscribe(listener) {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },

    isVerbose() {
      return state.verbose;
    },

    /**
     * Verbose logging captures routine actions and proxied requests. Errors and
     * warnings are always recorded, even with verbose off.
     */
    setVerbose(enabled) {
      state.verbose = Boolean(enabled);
      const store = storage();
      if (store) {
        try {
          store.setItem(KEYS.verbose, state.verbose ? "on" : "off");
        } catch (error) {
          /* ignore */
        }
      }
      log("info", "settings", `verbose logging ${state.verbose ? "enabled" : "disabled"}`);
      api.configureServiceWorker();
      return state.verbose;
    },

    toggleVerbose() {
      return api.setVerbose(!state.verbose);
    },

    /** Ask sw.js to report proxied requests to this page. */
    configureServiceWorker() {
      try {
        const sw = global.navigator && global.navigator.serviceWorker;
        const controller = sw && sw.controller;
        if (!controller) return false;
        controller.postMessage({ $graip$logConfig: { verbose: state.verbose } });
        state.swConfigured = true;
        return true;
      } catch (error) {
        return false;
      }
    },

    snapshot() {
      return {
        app: "graip",
        appVersion: APP_VERSION,
        version: VERSION,
        exportedAt: now(),
        page: global.location ? safeUrl(global.location.href) : "",
        userAgent: global.navigator ? global.navigator.userAgent : "",
        language: global.navigator ? global.navigator.language : "",
        verbose: state.verbose,
        entryCount: state.entries.length,
        entries: state.entries,
      };
    },

    exportJSON() {
      try {
        return JSON.stringify(api.snapshot(), null, 2);
      } catch (error) {
        return JSON.stringify({ error: "log export failed", entries: [] });
      }
    },

    exportText() {
      const lines = [];
      const snap = api.snapshot();
      lines.push("graip debug log");
      lines.push(`graip version: ${snap.appVersion}`);
      lines.push(`exported: ${snap.exportedAt}`);
      lines.push(`page: ${snap.page}`);
      lines.push(`verbose: ${snap.verbose}`);
      lines.push(`user agent: ${snap.userAgent}`);
      lines.push(`entries: ${snap.entryCount}`);
      lines.push("".padEnd(70, "-"));

      for (const entry of snap.entries) {
        const data = entry.data === undefined ? "" : " " + JSON.stringify(entry.data);
        lines.push(
          `${entry.at} [${entry.level.toUpperCase()}] (${entry.category}) ${entry.message}${data}`
        );
      }

      return lines.join("\n");
    },

    /** Trigger a browser download of the log. */
    download(format) {
      const json = String(format).toLowerCase() === "json";
      const body = json ? api.exportJSON() : api.exportText();
      const name = `graip-log-${new Date().toISOString().replace(/[:.]/g, "-")}.${json ? "json" : "txt"}`;

      try {
        const type = json ? "application/json" : "text/plain";
        const blob = new global.Blob([body], { type: `${type};charset=utf-8` });
        const href = global.URL.createObjectURL(blob);
        const link = global.document.createElement("a");
        link.href = href;
        link.download = name;
        link.rel = "noopener";
        global.document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => {
          try {
            global.URL.revokeObjectURL(href);
          } catch (error) {
            /* ignore */
          }
        }, 10000);
        log("info", "debug", `exported log as ${name}`, { entries: state.entries.length });
        return name;
      } catch (error) {
        log("error", "debug", "could not download the log", error);
        return null;
      }
    },

    async copy() {
      const body = api.exportText();
      try {
        if (global.navigator && global.navigator.clipboard) {
          await global.navigator.clipboard.writeText(body);
          log("info", "debug", "log copied to clipboard");
          return true;
        }
      } catch (error) {
        log("warn", "debug", "clipboard write failed", error);
      }
      return false;
    },

    clear() {
      state.entries = [];
      state.seq = 0;
      const store = storage();
      if (store) {
        try {
          store.removeItem(KEYS.buffer);
        } catch (error) {
          /* ignore */
        }
      }
      log("info", "debug", "log cleared");
    },

    /**
     * Install global capture: uncaught errors, rejected promises, console.error /
     * console.warn from other scripts, fetch failures and service worker reports.
     */
    install() {
      if (state.installed) return;
      state.installed = true;
      state.verbose = readVerbose();
      restore();

      try {
        global.addEventListener("error", (event) => {
          const target = event && event.target;
          if (target && target !== global && target.tagName) {
            // resource load failure (script/link/img); useful, but not a crash
            const what = target.tagName.toLowerCase();
            const src = target.src || target.href || "(inline)";
            log("warn", "resource", `${what} failed to load`, { src: safeUrl(src) });
            return;
          }
          log("error", "uncaught", (event && event.message) || "unknown error", {
            source: event && event.filename ? safeUrl(event.filename) : "",
            line: event && event.lineno,
            column: event && event.colno,
            stack: event && event.error && event.error.stack ? String(event.error.stack).slice(0, 600) : "",
          });
        }, true);

        global.addEventListener("unhandledrejection", (event) => {
          const reason = event && event.reason;
          log("error", "unhandled-rejection", (reason && reason.message) || String(reason), {
            stack: reason && reason.stack ? String(reason.stack).slice(0, 600) : "",
          });
        });

        // Mirror console warnings/errors from vendored scripts, but keep the
        // original function so the devtools output is unchanged.
        ["error", "warn"].forEach((level) => {
          const original = console[level].bind(console);
          console[level] = (...args) => {
            try {
              const message = args
                .map((arg) => {
                  if (typeof arg === "string") return arg;
                  if (arg instanceof Error) return arg.message;
                  try {
                    return JSON.stringify(cleanData(arg, 1));
                  } catch (error) {
                    return String(arg);
                  }
                })
                .join(" ")
                .slice(0, 500);
              // Skip our own mirror output to avoid a feedback loop.
              if (!message.includes("[graip]")) log(level, "console", message);
            } catch (error) {
              /* ignore */
            }
            return original(...args);
          };
        });

        // Network failures from the page itself (metadata, TMDb, chat, ...).
        if (typeof global.fetch === "function") {
          const originalFetch = global.fetch.bind(global);
          global.fetch = async (...args) => {
            const request = args[0];
            const url = typeof request === "string" ? request : request && request.url;
            const started = Date.now();
            try {
              const response = await originalFetch(...args);
              if (!response.ok) {
                log("warn", "net", `HTTP ${response.status}`, {
                  url: safeUrl(url),
                  ms: Date.now() - started,
                });
              } else {
                log("debug", "net", `HTTP ${response.status}`, {
                  url: safeUrl(url),
                  ms: Date.now() - started,
                });
              }
              return response;
            } catch (error) {
              log("error", "net", "request failed", {
                url: safeUrl(url),
                ms: Date.now() - started,
                error: (error && error.message) || String(error),
              });
              throw error;
            }
          };
        }

        // Record deliberate UI clicks across the shell, but never the clicked
        // link destination or typed content. Keyboard events are intentionally
        // not observed; this avoids recording keystrokes and visited websites.
        if (global.document && global.document.addEventListener) {
          global.document.addEventListener("click", (event) => {
            try {
              const target = event.target && event.target.closest
                ? event.target.closest("button, a, [role=button], [role=tab], [onclick], .app, input[type=checkbox], input[type=radio], select, summary, .settings-section")
                : null;
              if (!target) return;
              const label = (target.getAttribute("aria-label") || target.innerText || target.textContent || target.title || target.id || target.tagName || "control")
                .replace(/\s+/g, " ").trim().slice(0, 100);
              const safeLabel = /^https?:\/\//i.test(label) ? "link" : label;
              log("debug", "ui", `clicked ${target.tagName.toLowerCase()}${safeLabel ? `: ${safeLabel}` : ""}`);
            } catch (error) {
              /* event logging must never disrupt the interface */
            }
          }, true);
        }

        // Record committed control changes (including keyboard-driven select or
        // toggle changes) without observing key events or entered text.
        if (global.document && global.document.addEventListener) {
          global.document.addEventListener("change", (event) => {
            try {
              const target = event.target;
              if (!target || !target.matches || !target.matches("input[type=checkbox], input[type=radio], select")) return;
              const key = target.id || target.name || target.tagName.toLowerCase();
              const value = target.type === "checkbox" || target.type === "radio" ? Boolean(target.checked) : String(target.value || "").slice(0, 80);
              log("debug", "settings", `changed ${key}`, { value });
            } catch (error) {
              /* event logging must never disrupt the interface */
            }
          }, true);
        }

        // Reports posted by sw.js (proxied requests, proxy failures).
        if (global.navigator && global.navigator.serviceWorker) {
          global.navigator.serviceWorker.addEventListener("message", (event) => {
            const payload = event && event.data && event.data.$graip$log;
            if (!payload || typeof payload !== "object") return;
            log(payload.level || "info", payload.category || "sw", payload.message || "", payload.data);
          });
          global.navigator.serviceWorker.addEventListener("controllerchange", () => {
            api.configureServiceWorker();
          });
          api.configureServiceWorker();
        }
      } catch (error) {
        originalConsole.error("[graip] log install failed:", error);
      }

      log("info", "app", `debug log ready (verbose ${state.verbose ? "on" : "off"})`, {
        entries: state.entries.length,
        page: global.location ? safeUrl(global.location.href) : "",
      });
    },
  };

  global.GraipLog = api;
  api.install();
})(typeof window !== "undefined" ? window : globalThis);
