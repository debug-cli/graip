"use strict";

/**
 * Regression tests for how Graip picks and remembers a Wisp endpoint.
 *
 * The behaviour that matters here:
 *   - the endpoint somebody chose in Settings survives an automatic failover
 *     (it used to be overwritten with a "Fallback" marker, so the saved choice
 *     was lost for good and the dropdown could never show it again);
 *   - the failover is still recorded, so the UI can say what is being used;
 *   - a fresh install, or an old build's leftover values, still resolve to a
 *     usable endpoint.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../assets/js/wisp.js"),
  "utf8"
);

/**
 * @param {{ answer?: (url: string) => boolean, location?: object }} [config]
 *        `answer` decides which endpoints speak wisp; default: everything does.
 */
function createHarness(config = {}) {
  const values = new Map();
  const sockets = [];
  const answer = config.answer || (() => true);

  const localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
      // Respond on the next tick like a real handshake would.
      setTimeout(() => this.respond(), 0);
    }

    respond() {
      if (this.readyState === 3) return;
      if (answer(this.url)) {
        this.readyState = 1;
        if (this.onmessage) this.onmessage({ data: new Uint8Array([3, 0, 0, 0, 0, 32, 0, 0, 0]) });
      } else {
        this.readyState = 1;
        if (this.onerror) this.onerror(new Error("refused"));
      }
    }

    close() {
      this.readyState = 3;
    }
  }

  const window = { localStorage, location: config.location };
  const context = {
    window,
    URL,
    Set,
    Date,
    Promise,
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    WebSocket: FakeWebSocket,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(source, context, { filename: "assets/js/wisp.js" });

  return { wisp: window.GraipWisp, values, sockets };
}

test("explicit_preset_is_the_configured_url", () => {
  const { wisp, values } = createHarness();

  values.set(wisp.KEYS.preset, "Anura 1");
  values.set(wisp.KEYS.active, "wss://leftover.example/wisp/");

  assert.equal(wisp.getConfiguredUrl(), "wss://anura.pro/");
});

test("custom_url_wins_over_a_stale_active_url", () => {
  const { wisp, values } = createHarness();

  values.set(wisp.KEYS.preset, "Custom");
  values.set(wisp.KEYS.custom, "wss://mine.example/wisp");
  values.set(wisp.KEYS.active, "wss://phantom.lol/wisp/");

  assert.equal(wisp.getConfiguredUrl(), "wss://mine.example/wisp/");
  assert.equal(wisp.getActiveUrl(), "wss://phantom.lol/wisp/");
});

test("legacy_fallback_marker_does_not_stick", () => {
  const { wisp, values } = createHarness();

  // what older builds wrote over the user's selection
  values.set(wisp.KEYS.preset, "Fallback");
  values.set(wisp.KEYS.active, "wss://fallback.example/wisp/");

  assert.equal(wisp.getConfiguredUrl(), "wss://fallback.example/wisp/");
  assert.equal(wisp.isUsingFallback(), false);
});

test("failover_keeps_the_saved_choice_and_records_the_fallback", async () => {
  const failing = "wss://wisp.mercurywork.shop/";
  const { wisp, values } = createHarness({
    answer: (url) => url !== failing,
  });

  values.set(wisp.KEYS.preset, "Mercury");
  values.set(wisp.KEYS.active, failing);

  const result = await wisp.getWorkingWispServer({ preferredTimeoutMs: 50 });

  assert.ok(result, "a fallback endpoint should have been found");
  assert.notEqual(result.url, failing);

  // the failover is recorded...
  assert.equal(values.get(wisp.KEYS.active), result.url);
  assert.equal(values.get(wisp.KEYS.fallback), result.url);
  assert.equal(wisp.getFallbackUrl(), result.url);
  assert.equal(wisp.isUsingFallback(), true);

  // ...but the deliberate choice is untouched and still resolves first
  assert.equal(values.get(wisp.KEYS.preset), "Mercury");
  assert.equal(wisp.getConfiguredUrl(), failing);
});

test("picking_a_server_by_hand_clears_the_fallback", () => {
  const { wisp, values } = createHarness();

  values.set(wisp.KEYS.fallback, "wss://somewhere-else.example/wisp/");

  const url = wisp.setActiveServer("wss://aluu.xyz/wisp/", { custom: true });

  assert.equal(url, "wss://aluu.xyz/wisp/");
  assert.equal(values.get(wisp.KEYS.fallback), "");
  assert.equal(values.get(wisp.KEYS.preset), "Custom");
  assert.equal(wisp.isUsingFallback(), false);
});

test("the_deployments_own_wisp_endpoint_is_selectable_but_not_probed_by_default", () => {
  const { wisp } = createHarness({
    location: { protocol: "https:", host: "graip.example" },
  });

  const local = wisp.localPreset();
  assert.deepEqual(
    { id: local.id, url: local.url },
    { id: "Local", url: "wss://graip.example/wisp/" }
  );

  const candidates = wisp.candidateList();
  assert.equal(candidates.includes(local.url), false);

  const chosen = createHarness({
    location: { protocol: "https:", host: "graip.example" },
  });
  chosen.values.set(chosen.wisp.KEYS.preset, "Local");
  assert.equal(chosen.wisp.getConfiguredUrl(), "wss://graip.example/wisp/");
  assert.equal(chosen.wisp.candidateList()[0], "wss://graip.example/wisp/");
});

test("pool_starts_with_the_publicly_documented_endpoints", () => {
  const { wisp } = createHarness();

  assert.equal(wisp.PRESETS[0].url, "wss://wisp.mercurywork.shop/");
  assert.ok(wisp.PRESETS.some((preset) => preset.url === "wss://anura.pro/"));
  const researchCandidates = [
    "wss://play.wispnetwork.org/",
    "wss://wisp.webmc.fun/",
    "wss://proxy.crllect.dev/wisp/",
    "wss://backend.crllect.dev/wisp/",
    "wss://pycoder42--5d21a10c4c0811f1a553ee650bb23af1.web.val.run/",
  ];
  for (const url of researchCandidates) {
    assert.ok(wisp.PRESETS.some((preset) => preset.url === url), `missing research candidate ${url}`);
  }
  assert.equal(wisp.PRESETS.length, 35);
  assert.equal(
    wisp.PRESETS.some((preset) => /(?:example\.com|\.example|USERNAME|127\.0\.0\.1)/i.test(preset.url)),
    false,
    "placeholder hosts and the source's localhost example are not public routes"
  );
  // cross-realm arrays, so compare through JSON instead of deepStrictEqual
  const list = wisp.candidateList();
  assert.deepEqual(
    JSON.parse(JSON.stringify(list)),
    Array.from(new Set(list))
  );
});
