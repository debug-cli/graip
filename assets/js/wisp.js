/**
 * graip wisp helper
 *
 * Every proxied request goes through the libcurl transport, which tunnels all
 * traffic over a single wisp WebSocket server. When that server is unreachable
 * libcurl aborts the socket and rejects with:
 *
 *   TypeError: Request failed with error code 7: Could not connect to server
 *
 * (curl error 7 == CURLE_COULDNT_CONNECT, thrown from the transport's request()).
 *
 * This module owns everything about picking a wisp server that actually answers, so
 * callers never hand libcurl a dead endpoint:
 *
 *   - normalizes/validates whatever is in localStorage (libcurl throws a hard
 *     TypeError on a URL without a trailing slash or a non-ws:// scheme)
 *   - health checks a server with a real wisp handshake (the connection only counts
 *     as usable once the server sends its first packet, which is exactly what
 *     libcurl's WispConnection waits for)
 *   - fails over to the next server in the pool automatically and remembers the
 *     winner, so a dead default no longer bricks the whole browser
 */
(function (global) {
  "use strict";

  /**
   * Fallback pool, tried in order when the configured server does not answer.
   *
   * Order matters: this is the order servers get probed in, so the publicly
   * documented endpoints (the ones upstream Scramjet, libcurl.js and the Wisp
   * docs point at) come first and community mirrors follow. Every entry is a
   * *candidate*: a server is only used after it answered a real Wisp handshake.
   */
  const PRESETS = [
    {
      id: "Mercury",
      name: "Mercury (public demo)",
      url: "wss://wisp.mercurywork.shop/",
    },
    { id: "Anura 1", name: "Anura 1", url: "wss://anura.pro/" },
    { id: "Phantom", name: "Phantom", url: "wss://phantom.lol/wisp/" },

    // Both of these are advertised by community docs; the bare host and the
    // /wisp/ path have each been the working one at different times, so try
    // both instead of guessing.
    { id: "rhw", name: "RHW", url: "wss://wisp.rhw.one/" },
    { id: "rhw-wisp", name: "RHW (/wisp/)", url: "wss://wisp.rhw.one/wisp/" },

    { id: "Alu 1", name: "Alu 1", url: "wss://aluu.xyz/wisp/" },
    { id: "Alu 2", name: "Alu 2", url: "wss://freemathhw.xyz/wisp/" },
    { id: "Alu 3", name: "Alu 3", url: "wss://canvaslogin.org/wisp/" },
    { id: "Alu 4", name: "Alu 4", url: "wss://tnlnda.xyz/wisp/" },

    {
      id: "Incognito 1",
      name: "Incognito 1",
      url: "wss://incog.works/wisp/",
    },
    {
      id: "Incognito 2",
      name: "Incognito 2",
      url: "wss://math.mathpuns.lol/wisp/",
    },
    {
      id: "Incognito 3",
      name: "Incognito 3",
      url: "wss://math.americahistory.online/wisp/",
    },
    {
      id: "Incognito 4",
      name: "Incognito 4",
      url: "wss://english.geniuslecture.club/wisp/",
    },

    {
      id: "Definitely Science 1",
      name: "Definitely Science 1",
      url: "wss://definitelyscience.com/wisp/",
    },
    {
      id: "Definitely Science 2",
      name: "Definitely Science 2",
      url: "wss://onlinegames.ro/wisp/",
    },
    {
      id: "Definitely Science 3",
      name: "Definitely Science 3",
      url: "wss://mages.io/wisp/",
    },
    {
      id: "Definitely Science 4",
      name: "Definitely Science 4",
      url: "wss://lichology.com/wisp/",
    },

    { id: "Anura 2", name: "Anura 2", url: "wss://adoptmy.baby/" },
    { id: "Anura 3", name: "Anura 3", url: "wss://wallstjournal.click/" },
    { id: "Anura 4", name: "Anura 4", url: "wss://mexicoon.top/" },
    { id: "Anura 5", name: "Anura 5", url: "wss://onlineosdev.nl/" },
    { id: "Anura 6", name: "Anura 6", url: "wss://swordartii.online/" },

    {
      id: "Terbium 1",
      name: "Terbium 1",
      url: "wss://wisp.terbiumon.top/wisp/",
    },
    {
      id: "Terbium 2",
      name: "Terbium 2",
      url: "wss://quantumchemistry.club/wisp/",
    },
    {
      id: "Terbium 3",
      name: "Terbium 3",
      url: "wss://explorechemistry.online/wisp/",
    },
    { id: "Terbium 4", name: "Terbium 4", url: "wss://webmath.help/wisp/" },

    // User-provided research candidates; they were not live-probed here. The
    // strict Wisp v1 handshake check below prevents unrelated WebSockets from
    // being treated as usable routes.
    {
      id: "Wisp Network",
      name: "Wisp Network (Eaglercraft)",
      url: "wss://play.wispnetwork.org/",
    },
    { id: "WebMC", name: "WebMC", url: "wss://wisp.webmc.fun/" },
    {
      id: "Crllect Proxy",
      name: "Crllect Proxy",
      url: "wss://proxy.crllect.dev/wisp/",
    },
    {
      id: "Crllect Backend",
      name: "Crllect Backend",
      url: "wss://backend.crllect.dev/wisp/",
    },
    {
      id: "Val Town",
      name: "Val Town (pycoder42)",
      url: "wss://pycoder42--5d21a10c4c0811f1a553ee650bb23af1.web.val.run/",
    },

    { id: "Radius 1", name: "Radius 1", url: "wss://radiusproxy.app/wisp/" },
    {
      id: "Radius 1 (Adblock)",
      name: "Radius 1 (Adblock)",
      url: "wss://radiusproxy.app/adblock/",
    },
    { id: "Radius 2", name: "Radius 2", url: "wss://radiusowski.site/wisp/" },
    {
      id: "Radius 2 (Adblock)",
      name: "Radius 2 (Adblock)",
      url: "wss://radiusowski.site/adblock/",
    },
  ];

  const KEYS = {
    /**
     * Last endpoint a request was actually sent through. This may be an
     * automatic fallback, which is why it is *not* the user's preference.
     */
    active: "graip_wispUrl",
    /**
     * The endpoint the user chose (a preset id, "Custom", or absent for the
     * default). Automatic failover must never overwrite this: a server that was
     * down for one minute should not permanently replace the choice someone
     * made deliberately.
     */
    preset: "graip_wispUrlSelected",
    /** Last endpoint typed in by hand, kept so it can be retried later. */
    custom: "graip_wispUrlCustom",
    /** Timestamp of the last successful handshake. */
    verifiedAt: "graip_wispUrlVerifiedAt",
    /**
     * Endpoint picked automatically because the preferred one did not answer.
     * Cleared as soon as the preferred endpoint works again.
     */
    fallback: "graip_wispUrlFallback",
  };

  /**
   * The endpoint used when the user has never chosen one. This is the public
   * Wisp server that the upstream libcurl.js and Wisp documentation advertise.
   */
  const DEFAULT_URL = PRESETS[0].url;

  /**
   * A Wisp server can be hosted by this deployment itself. It is worth offering
   * in the picker (a self-hosted endpoint is the fastest and most reliable
   * option) but it is not added to the automatic probe pool, because most
   * static deployments do not run one and probing it would waste a handshake
   * timeout on every navigation.
   *
   * @returns {{id: string, name: string, url: string}|null}
   */
  function localPreset() {
    const loc = global.location;
    if (!loc || !loc.host || !loc.protocol) return null;
    if (loc.protocol !== "https:" && loc.protocol !== "http:") return null;

    const scheme = loc.protocol === "https:" ? "wss:" : "ws:";
    return {
      id: "Local",
      name: `This site (${loc.host})`,
      url: `${scheme}//${loc.host}/wisp/`,
    };
  }

  function storage() {
    try {
      return global.localStorage;
    } catch (error) {
      return null;
    }
  }

  function read(key) {
    const store = storage();
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function write(key, value) {
    const store = storage();
    if (!store) return;
    try {
      store.setItem(key, value);
    } catch (error) {
      /* private mode / quota — the in-memory cache still covers this session */
    }
  }

  /**
   * Turn whatever the user (or an older version of graip) stored into a URL that
   * libcurl will accept: ws:// or wss:// scheme, trailing slash, nothing else.
   *
   * Anything that parses as a URL is returned, including a bare word (treated as
   * a hostname, so "ws://localhost:8080" keeps working) — being wrong here only
   * costs a failed probe, while rejecting a valid endpoint breaks the proxy.
   *
   * @param {string} raw
   * @returns {string|null} normalized URL, or null when it cannot be parsed
   */
  function normalizeWispUrl(raw) {
    if (typeof raw !== "string") return null;

    let value = raw.trim();
    if (!value) return null;

    if (value.startsWith("//")) {
      value = "wss:" + value;
    } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      value = "wss://" + value;
    }

    value = value.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");

    let parsed;
    try {
      parsed = new URL(value);
    } catch (error) {
      return null;
    }

    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return null;
    if (!parsed.hostname) return null;

    if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
    // wisp endpoints have no business carrying a fragment
    parsed.hash = "";

    return parsed.toString();
  }

  function presetForUrl(url) {
    return PRESETS.find((preset) => preset.url === url) || null;
  }

  function presetForId(id) {
    return PRESETS.find((preset) => preset.id === id) || null;
  }

  /**
   * Resolve the endpoint the user asked for, without trusting that it is usable.
   * The user's saved choice wins: a dropdown preset, a hand typed custom URL, or
   * this deployment's own /wisp/ endpoint. Only when nothing was ever chosen does
   * the remembered active URL (possibly a fallback) or the default apply.
   *
   * @returns {string} a normalized URL, always safe to hand to libcurl
   */
  function getConfiguredUrl() {
    const selection = read(KEYS.preset);

    // An explicit pick always wins. Automatic failover writes KEYS.active and
    // KEYS.fallback only, so the next page load retries the endpoint the user
    // actually chose instead of silently staying on a fallback forever.
    if (selection === "Custom") {
      const custom = normalizeWispUrl(read(KEYS.custom));
      if (custom) return custom;
    }

    // "Fallback" is what older builds wrote over the selection; treat it as
    // "no explicit choice" so it heals instead of sticking.
    const preset = presetForId(selection);
    if (preset) return preset.url;

    const local = localPreset();
    if (local && selection === local.id) return local.url;

    const custom = normalizeWispUrl(read(KEYS.custom));
    if (custom) return custom;

    // Nothing was ever chosen (fresh install, or only an old active URL).
    const active = normalizeWispUrl(read(KEYS.active));
    if (active) return active;

    return DEFAULT_URL;
  }

  /**
   * The endpoint that was last used successfully, which is not necessarily the
   * one the user chose: it can be an automatic fallback.
   *
   * @returns {string} a normalized URL
   */
  function getActiveUrl() {
    const active = normalizeWispUrl(read(KEYS.active));
    return active || getConfiguredUrl();
  }

  /**
   * The automatic fallback currently in use, or null when the configured
   * endpoint is the one being used.
   *
   * @returns {string|null}
   */
  function getFallbackUrl() {
    const fallback = normalizeWispUrl(read(KEYS.fallback));
    if (!fallback) return null;
    return fallback === normalizeWispUrl(getConfiguredUrl()) ? null : fallback;
  }

  /** @returns {boolean} whether traffic is going through an automatic fallback */
  function isUsingFallback() {
    return Boolean(getFallbackUrl());
  }

  /**
   * Ordered, de-duplicated list of endpoints to try.
   *
   * `exclude` is used after a destination request fails. A Wisp handshake can
   * succeed while one exit server is unable to complete a particular site's TLS
   * handshake, so retrying the same endpoint would just repeat the same error.
   *
   * @param {{ exclude?: string[] }} [options]
   */
  function candidateList(options) {
    const excluded = new Set(
      (options && Array.isArray(options.exclude) ? options.exclude : [])
        .map(normalizeWispUrl)
        .filter(Boolean)
    );
    const seen = new Set();
    const list = [];

    const add = (value) => {
      const url = normalizeWispUrl(value);
      if (url && !excluded.has(url) && !seen.has(url)) {
        seen.add(url);
        list.push(url);
      }
    };

    add(getConfiguredUrl());
    add(read(KEYS.custom));
    PRESETS.forEach((preset) => add(preset.url));

    return list;
  }

  /**
   * The browser client opens the socket without a subprotocol, so Wisp servers
   * must use the v1 handshake: CONTINUE (0x03), stream 0, and a uint32 buffer
   * count. Treating any WebSocket message as success lets unrelated JSON sockets
   * masquerade as Wisp routes.
   */
  function isWispV1ContinueFrame(data) {
    let bytes;
    try {
      if (!data || typeof data !== "object" || typeof data.byteLength !== "number") return false;
      bytes = data.buffer
        ? new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength)
        : new Uint8Array(data);
    } catch (error) {
      return false;
    }

    return (
      bytes.byteLength >= 9 &&
      bytes[0] === 0x03 &&
      bytes[1] === 0 &&
      bytes[2] === 0 &&
      bytes[3] === 0 &&
      bytes[4] === 0
    );
  }

  /**
   * Check that a server really speaks Wisp v1. A WebSocket open is not enough;
   * the initial CONTINUE frame must be valid or curl error 7 will follow later.
   *
   * Always resolves; never throws, so it is safe to race a whole pool of servers.
   *
   * @param {string} url
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<{ok:boolean,url:string,ms:number,reason?:string,detail?:string}>}
   */
  function probeWispServer(url, options) {
    const timeoutMs = (options && options.timeoutMs) || 4000;
    const started = Date.now();

    return new Promise((resolve) => {
      let socket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        resolve({
          ok: false,
          url,
          ms: 0,
          reason: "invalid-url",
          detail: (error && error.message) || String(error),
        });
        return;
      }

      let settled = false;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.onopen = null;
          socket.onmessage = null;
          socket.onerror = null;
          socket.onclose = null;
        } catch (error) {
          /* ignore */
        }
        try {
          if (socket.readyState === 0 || socket.readyState === 1) socket.close();
        } catch (error) {
          /* ignore */
        }
        const outcome = Object.assign({ url, ms: Date.now() - started }, result);
        if (outcome.ok) {
          logEvent("debug", "wisp handshake ok", { url, ms: outcome.ms });
        } else {
          logEvent("warn", "wisp probe failed", {
            url,
            reason: outcome.reason,
            detail: outcome.detail,
            ms: outcome.ms,
          });
        }
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        // CONNECTING -> we never even got a socket; OPEN -> it is not a wisp server
        finish({
          ok: false,
          reason: socket.readyState === 0 ? "timeout-connect" : "timeout-response",
        });
      }, timeoutMs);

      try {
        socket.binaryType = "arraybuffer";
      } catch (error) {
        /* Blob frames cannot be checked synchronously; modern browsers use ArrayBuffer. */
      }

      socket.onmessage = (event) => {
        if (!isWispV1ContinueFrame(event && event.data)) {
          finish({ ok: false, reason: "invalid-handshake" });
          return;
        }
        finish({ ok: true });
      };
      socket.onerror = () => finish({ ok: false, reason: "socket-error" });
      socket.onclose = (event) =>
        finish({
          ok: false,
          reason: "closed",
          detail: event && event.code ? String(event.code) : "",
        });
    });
  }

  /**
   * Probe a list of servers concurrently and hand back the first one that answers.
   *
   * @param {string[]} urls
   * @param {{ concurrency?: number, timeoutMs?: number, maxWaitMs?: number, onStatus?: Function }} [options]
   * @returns {Promise<{ok:boolean,url:string,ms:number}|null>}
   */
  function probePool(urls, options) {
    const opts = options || {};
    const concurrency = Math.max(1, Math.min(opts.concurrency || 4, urls.length || 1));
    let cursor = 0;
    let found = false;

    const worker = async () => {
      while (!found && cursor < urls.length) {
        const url = urls[cursor++];
        if (opts.onStatus) opts.onStatus({ phase: "testing", url });
        const result = await probeWispServer(url, { timeoutMs: opts.timeoutMs });
        if (result.ok) {
          found = true;
          return result;
        }
        if (opts.onStatus) opts.onStatus({ phase: "failed", result });
      }
      return null;
    };

    return new Promise((resolve) => {
      let settled = false;
      let remaining = concurrency;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        found = true; // stop the other workers picking up new urls
        clearTimeout(giveUp);
        resolve(value);
      };

      // a pool where nothing answers should still report back quickly
      const giveUp = setTimeout(() => finish(null), opts.maxWaitMs || 20000);

      for (let i = 0; i < concurrency; i++) {
        worker().then(
          (result) => {
            if (result) {
              finish(result);
              return;
            }
            remaining--;
            if (remaining === 0) finish(null);
          },
          () => {
            remaining--;
            if (remaining === 0) finish(null);
          }
        );
      }
    });
  }

  /** Per-tab cache so repeated navigations do not re-probe everything. */
  const state = { verified: null, inflight: null };

  /**
   * Report probe results to the debug log. Wisp trouble is the single most
   * common cause of "the proxy is broken", so every probe outcome is recorded.
   */
  function logEvent(level, message, data) {
    const logger = global.GraipLog;
    if (!logger || typeof logger[level] !== "function") return;
    logger[level]("wisp", message, data);
  }

  /**
   * Remember a server the user picked by hand (settings page).
   *
   * @param {string} url
   * @param {{ custom?: boolean }} [options]
   * @returns {string|null} the normalized URL, or null when it was unusable
   */
  function setActiveServer(url, options) {
    const normalized = normalizeWispUrl(url);
    if (!normalized) return null;

    write(KEYS.active, normalized);
    // picking a server by hand ends any fallback state
    write(KEYS.fallback, "");

    if (options && options.custom) {
      write(KEYS.custom, normalized);
      write(KEYS.preset, "Custom");
    }

    const preset = presetForUrl(normalized);
    const local = localPreset();
    if (options && options.custom) {
      // already handled above
    } else if (preset) {
      write(KEYS.preset, preset.id);
    } else if (local && local.url === normalized) {
      write(KEYS.preset, local.id);
    }

    // a hand picked server has not been proven yet
    state.verified = null;
    logEvent("info", "wisp server chosen in settings", { url: normalized, custom: !!(options && options.custom) });
    return normalized;
  }

  /**
   * Hand back an endpoint that has been proven reachable, failing over through the
   * pool when the configured one is dead.
   *
   * @param {{ force?: boolean, timeoutMs?: number, concurrency?: number, maxWaitMs?: number, exclude?: string[], onStatus?: Function }} [options]
   * @returns {Promise<{ok:boolean,url:string,ms:number}|null>}
   */
  function getWorkingWispServer(options) {
    const opts = options || {};
    const excluded = new Set(
      (Array.isArray(opts.exclude) ? opts.exclude : [])
        .map(normalizeWispUrl)
        .filter(Boolean)
    );

    if (
      state.verified &&
      !opts.force &&
      !excluded.has(normalizeWispUrl(state.verified.url))
    ) {
      return Promise.resolve(state.verified);
    }
    if (state.inflight && !opts.force && excluded.size === 0) {
      return state.inflight;
    }

    state.inflight = (async () => {
      const preferred = normalizeWispUrl(getConfiguredUrl());
      let result = null;

      // Respect the endpoint chosen in Settings first. Fall back quickly if it
      // does not answer, rather than racing every community route and silently
      // replacing the user's selection with whichever handshake wins first.
      if (preferred && !excluded.has(preferred)) {
        if (opts.onStatus) opts.onStatus({ phase: "testing", url: preferred });
        result = await probeWispServer(preferred, {
          timeoutMs: opts.preferredTimeoutMs || 1500,
        });
        if (!result.ok) {
          if (opts.onStatus) opts.onStatus({ phase: "failed", result });
          result = null;
        }
      }

      if (!result) {
        const candidates = candidateList({
          exclude: [...excluded, ...(preferred ? [preferred] : [])],
        });
        if (!candidates.length) return null;

        result = await probePool(candidates, {
          concurrency: opts.concurrency,
          timeoutMs: opts.timeoutMs,
          maxWaitMs: opts.maxWaitMs,
          onStatus: opts.onStatus,
        });
      }

      if (result) {
        const previousActive = normalizeWispUrl(read(KEYS.active));
        write(KEYS.active, result.url);
        write(KEYS.verifiedAt, String(Date.now()));

        logEvent("info", "wisp server selected", {
          url: result.url,
          preferred,
          fallback: result.url !== preferred,
        });

        // Remember *why* traffic moved, without touching the saved preference.
        if (result.url === preferred) {
          write(KEYS.fallback, "");
        } else {
          write(KEYS.fallback, result.url);
        }

        state.verified = result;
        if (previousActive !== result.url && typeof global.dispatchEvent === "function") {
          try {
            global.dispatchEvent(
              new CustomEvent("graipWispServerChanged", { detail: result.url })
            );
          } catch (error) {
            /* non-browser test environments may not provide CustomEvent */
          }
        }
      } else {
        state.verified = null;
        logEvent("error", "no wisp server answered", {
          preferred,
          tried: candidateList({ exclude: [...excluded] }).length,
        });
      }

      return result;
    })();

    const inflight = state.inflight;
    inflight.then(() => {
      if (state.inflight === inflight) state.inflight = null;
    });

    return inflight;
  }

  /** Forget the cached server so the next call probes from scratch. */
  function resetCache() {
    state.verified = null;
    state.inflight = null;
  }

  /**
   * Point the transport at a wisp server that answers.
   *
   * @param {{ setTransport: (url: string) => Promise<void> }} target whatever owns the transport
   * @param {{ force?: boolean, timeoutMs?: number, concurrency?: number, maxWaitMs?: number, exclude?: string[], onStatus?: Function }} [options]
   * @returns {Promise<string>} the endpoint now in use
   */
  async function configureTransport(target, options) {
    const opts = options || {};
    if (!target || typeof target.setTransport !== "function") {
      throw new Error("No transport target was given to configureTransport().");
    }

    const server = await getWorkingWispServer(opts);
    if (!server) {
      const error = new Error(
        "No wisp server could be reached. Every proxy request will fail until a " +
          "working server is set in Settings -> Proxy."
      );
      error.code = "NO_WISP_SERVER";
      error.attempted = candidateList(opts);
      throw error;
    }

    await target.setTransport(server.url);
    return server.url;
  }

  /** libcurl error number from one of its rejection messages, when present. */
  function curlCode(error) {
    const message = (error && (error.message || String(error))) || "";
    const match = message.match(/error code (-?\d+)/);
    return match ? Number(match[1]) : null;
  }

  /**
   * Turn a transport failure into something a person can act on.
   *
   * @param {unknown} error
   * @returns {string}
   */
  function describeError(error) {
    const message = (error && (error.message || String(error))) || "Unknown proxy error";

    if (/no bare clients|no BareTransport was set/i.test(message)) {
      return "The proxy transport never started. Reload the page to try again.";
    }

    if (error && error.code === "NO_WISP_SERVER") {
      return (
        "None of the proxy servers on the list could be reached. Open Settings -> " +
        "Proxy and set a wisp server that works on your network."
      );
    }

    if (global.GraipProxyErrors) {
      const classification = global.GraipProxyErrors.classify(error);
      if (classification.kind === "connectivity") {
        return (
          "graip could not reach its proxy server (" +
          getConfiguredUrl() +
          "). The server is either down or blocked on this network. graip will keep " +
          "trying the other servers on the list."
        );
      }
      if (classification.kind !== "other") {
        return global.GraipProxyErrors.userMessage(classification);
      }
    }

    if (/wasm not loaded|load_wasm|failed to load wasm/i.test(message)) {
      return "The proxy's libcurl WebAssembly runtime did not load. Reload the page and try again.";
    }

    if (curlCode(error) === 7 || /could not connect to server/i.test(message)) {
      return (
        "graip could not reach its proxy server (" +
        getConfiguredUrl() +
        "). The server is either down or blocked on this network. graip will keep " +
        "trying the other servers on the list."
      );
    }

    return message;
  }

  global.GraipWisp = {
    PRESETS,
    KEYS,
    DEFAULT_URL,
    normalizeWispUrl,
    getConfiguredUrl,
    getActiveUrl,
    getFallbackUrl,
    isUsingFallback,
    localPreset,
    candidateList,
    presetForUrl,
    presetForId,
    probeWispServer,
    probePool,
    setActiveServer,
    getWorkingWispServer,
    configureTransport,
    resetCache,
    curlCode,
    describeError,
  };
})(typeof window !== "undefined" ? window : globalThis);
