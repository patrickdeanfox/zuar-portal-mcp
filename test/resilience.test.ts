/**
 * resilience.test.ts — unit tests for the portal HTTP client's retry/backoff,
 * circuit breaker, write-retry safety, and body-size guard.
 *
 * The client calls the global fetch(), so we stub globalThis.fetch with a
 * programmable fake. Backoff is pinned to 0ms (PORTAL_BACKOFF_*=0) so retries
 * run instantly and deterministically.
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resetConfigCache } from "../src/config.js";
import { request, resetSession, breakerStatus } from "../src/portalClient.js";

// Minimal stand-in for a fetch Response, covering only what the client touches.
function fakeResponse(status: number, body = "", headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    headers: {
      get: (name: string) => lower[name.toLowerCase()] ?? null,
      getSetCookie: () => ["session=abc; Path=/"],
    },
    text: async () => body,
  };
}

const LOGIN = "/auth/login";
const realFetch = globalThis.fetch;

// Install a fetch stub that always satisfies the login call and routes everything
// else to `handler`, which returns a fake Response or throws (a network error).
let apiCalls = 0;
function stubFetch(handler: (callIndex: number) => unknown): void {
  apiCalls = 0;
  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    if (String(url).includes(LOGIN)) return fakeResponse(200, "");
    const r = handler(apiCalls);
    apiCalls += 1;
    if (r instanceof Error) throw r;
    return r;
  };
}

beforeEach(() => {
  process.env.PORTAL_URL = "https://portal.example.com";
  process.env.PORTAL_API_KEY = "k";
  process.env.PORTAL_USER_ID = "u";
  process.env.PORTAL_BACKOFF_BASE_MS = "0";
  process.env.PORTAL_BACKOFF_MAX_MS = "0";
  process.env.PORTAL_MAX_RETRIES = "2";
  process.env.PORTAL_BREAKER_THRESHOLD = "5";
  resetConfigCache();
  resetSession();
});

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
});

test("GET retries a transient 503 and then succeeds", async () => {
  stubFetch((i) => (i < 2 ? fakeResponse(503, "busy") : fakeResponse(200, '{"ok":true}')));
  const res = await request<{ ok: boolean }>("GET", "/api/blocks");
  assert.deepEqual(res, { ok: true });
  assert.equal(apiCalls, 3, "two failed attempts + one success");
});

test("GET retries a pre-response network error", async () => {
  stubFetch((i) => (i < 1 ? new Error("ECONNRESET") : fakeResponse(200, "{}")));
  await request("GET", "/api/blocks");
  assert.equal(apiCalls, 2);
});

test("GET gives up after maxRetries and throws the last error", async () => {
  stubFetch(() => fakeResponse(500, "boom"));
  await assert.rejects(() => request("GET", "/api/blocks"), /HTTP 500/);
  assert.equal(apiCalls, 3, "1 initial + 2 retries");
});

test("a write (POST) does NOT retry an ambiguous 500", async () => {
  stubFetch(() => fakeResponse(500, "boom"));
  await assert.rejects(() => request("POST", "/api/blocks", { name: "x" }), /HTTP 500/);
  assert.equal(apiCalls, 1, "writes must not replay on an ambiguous 5xx");
});

test("a write (POST) DOES retry an explicit 429 back-pressure", async () => {
  stubFetch((i) => (i < 1 ? fakeResponse(429, "slow down") : fakeResponse(201, "{}")));
  await request("POST", "/api/blocks", { name: "x" });
  assert.equal(apiCalls, 2, "429 means definitely-not-applied, safe to retry");
});

test("an oversized body is rejected before any network call", async () => {
  process.env.PORTAL_MAX_BODY_BYTES = "1024"; // the configurable floor
  resetConfigCache();
  stubFetch(() => fakeResponse(200, "{}"));
  await assert.rejects(
    () => request("POST", "/api/blocks", { blob: "x".repeat(2000) }),
    /exceeds the 1024-byte limit/
  );
  assert.equal(apiCalls, 0, "guard fires before fetch");
  delete process.env.PORTAL_MAX_BODY_BYTES;
});

test("circuit breaker opens after the failure threshold and then fails fast", async () => {
  process.env.PORTAL_MAX_RETRIES = "0"; // one attempt per request → 1 failure each
  process.env.PORTAL_BREAKER_THRESHOLD = "3";
  resetConfigCache();
  resetSession();
  stubFetch(() => fakeResponse(500, "down"));

  for (let n = 0; n < 3; n++) {
    await assert.rejects(() => request("GET", "/api/blocks"));
  }
  assert.equal(breakerStatus().state, "open", "breaker should be open after 3 failures");

  // Next call fails fast WITHOUT hitting the network.
  const before = apiCalls;
  await assert.rejects(() => request("GET", "/api/blocks"), /circuit breaker is open/);
  assert.equal(apiCalls, before, "open breaker short-circuits the request");
});

test("a successful call resets the breaker's failure count", async () => {
  process.env.PORTAL_MAX_RETRIES = "0";
  resetConfigCache();
  resetSession();
  let mode = "fail";
  stubFetch(() => (mode === "fail" ? fakeResponse(500, "x") : fakeResponse(200, "{}")));
  await assert.rejects(() => request("GET", "/api/blocks"));
  assert.ok(breakerStatus().consecutiveFailures > 0);
  mode = "ok";
  await request("GET", "/api/blocks");
  assert.equal(breakerStatus().consecutiveFailures, 0, "success clears the count");
});
