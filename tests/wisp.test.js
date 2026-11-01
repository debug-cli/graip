"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../assets/js/wisp.js"),
  "utf8"
);

function createWispHarness() {
  const values = new Map();
  const sockets = [];
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
    }

    close() {
      this.readyState = 3;
    }
  }

  const window = { localStorage };
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

test("normalizes_wisp_urls", () => {
  const { wisp } = createWispHarness();

  assert.equal(
    wisp.normalizeWispUrl(" https://example.test/wisp#fragment "),
    "wss://example.test/wisp/"
  );
  assert.equal(wisp.normalizeWispUrl("localhost:8080"), "wss://localhost:8080/");
  assert.equal(wisp.normalizeWispUrl("ftp://example.test/"), null);
});

test("candidate_list_keeps_configured_first_and_excludes_normalized_duplicates", () => {
  const { wisp, values } = createWispHarness();
  values.set(wisp.KEYS.active, "wss://custom.example/wisp");

  const candidates = wisp.candidateList({
    exclude: ["wss://phantom.lol/wisp"],
  });

  assert.equal(candidates[0], "wss://custom.example/wisp/");
  assert.equal(candidates.includes("wss://phantom.lol/wisp/"), false);
  assert.equal(new Set(candidates).size, candidates.length);
});

test("probe_waits_for_valid_wisp_v1_continue_frame", async () => {
  const { wisp, sockets } = createWispHarness();
  let settled = false;
  const result = wisp
    .probeWispServer("wss://wisp.example/", { timeoutMs: 100 })
    .then((value) => {
      settled = true;
      return value;
    });

  const socket = sockets[0];
  socket.readyState = 1; // WebSocket open without a Wisp packet is not healthy.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);

  socket.onmessage({ data: new Uint8Array([3, 0, 0, 0, 0, 4, 0, 0, 0]).buffer });
  assert.equal((await result).ok, true);
  assert.equal(socket.readyState, 3);
});

test("probe_rejects_invalid_frames_and_reports_socket_errors", async () => {
  const { wisp, sockets } = createWispHarness();
  const invalidFrames = [
    ["wss://not-wisp.example/", new Uint8Array([5, 0, 0, 0, 0, 2, 1])], // Wisp v2 INFO
    ["wss://wrong-stream.example/", new Uint8Array([3, 1, 0, 0, 0, 4, 0, 0, 0])],
    ["wss://truncated.example/", new Uint8Array([3, 0, 0, 0, 0, 4])],
    ["wss://api.example/", '{"status":"connected"}'], // unrelated JSON WebSocket
  ];

  for (const [url, data] of invalidFrames) {
    const invalidPromise = wisp.probeWispServer(url);
    const socket = sockets[sockets.length - 1];
    socket.readyState = 1;
    socket.onmessage({ data });

    const invalid = await invalidPromise;
    assert.equal(invalid.ok, false);
    assert.equal(invalid.reason, "invalid-handshake");
    assert.equal(socket.readyState, 3);
  }

  const errorPromise = wisp.probeWispServer("wss://wisp.example/");
  const errorSocket = sockets[sockets.length - 1];
  errorSocket.onerror(new Error("socket failed"));

  const error = await errorPromise;
  assert.equal(error.ok, false);
  assert.equal(error.reason, "socket-error");
  assert.equal(errorSocket.readyState, 3);
});

test("probe_reports_response_timeout", async () => {
  const { wisp, sockets } = createWispHarness();
  const resultPromise = wisp.probeWispServer("wss://wisp.example/", {
    timeoutMs: 1,
  });
  sockets[0].readyState = 1;

  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout-response");
  assert.equal(sockets[0].readyState, 3);
});
