/**
 * security.test.ts — output secret redaction and portal-URL validation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/redact.js";
import { loadPortalConfig, resetConfigCache } from "../src/config.js";

// loadPortalConfig gives a discovered project config.json precedence over env, so
// these tests must run from a clean CWD (an empty temp dir) with the config cache
// reset — otherwise the repo-root config.json shadows the env vars under test.
// Restores CWD + env + cache afterwards so the rest of the suite is unaffected.
function withCleanConfigEnv<T>(env: Record<string, string>, fn: () => T): T {
  const prevCwd = process.cwd();
  const keys = ["PORTAL_URL", "PORTAL_API_KEY", "PORTAL_USER_ID"] as const;
  const prevEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zpmcp-cfg-"));
  try {
    process.chdir(tmp);
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    resetConfigCache();
    return fn();
  } finally {
    process.chdir(prevCwd);
    for (const k of keys) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
    resetConfigCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test("redactSecrets masks secret-bearing fields but keeps identifiers and data", () => {
  const input = {
    username: "bob",
    password: "hunter2",
    api_key: "sk-live-123",
    access_token: "abc",
    credentials_id: "c-1", // *_id must survive
    id: "u-1",
    profile: { refresh_token: "r", display_name: "Bob" },
    keys: [{ secret: "s1" }, { note: "ok" }],
  };
  const out = redactSecrets(input) as typeof input;

  assert.equal(out.username, "bob");
  assert.equal(out.password, "[redacted]");
  assert.equal(out.api_key, "[redacted]");
  assert.equal(out.access_token, "[redacted]");
  assert.equal(out.credentials_id, "c-1", "identifier fields are not secrets");
  assert.equal(out.id, "u-1");
  assert.equal(out.profile.refresh_token, "[redacted]");
  assert.equal(out.profile.display_name, "Bob");
  assert.equal((out.keys[0] as { secret: string }).secret, "[redacted]");
  assert.equal((out.keys[1] as { note: string }).note, "ok");
});

test("redactSecrets does not mutate the original object", () => {
  const input = { password: "p" };
  redactSecrets(input);
  assert.equal(input.password, "p", "original must be untouched (deep clone)");
});

test("redaction can be disabled via PORTAL_REDACT_SECRETS=0", () => {
  process.env.PORTAL_REDACT_SECRETS = "0";
  try {
    const out = redactSecrets({ password: "p" }) as { password: string };
    assert.equal(out.password, "p", "disabled → returned as-is");
  } finally {
    delete process.env.PORTAL_REDACT_SECRETS;
  }
});

test("loadPortalConfig accepts a clean https url and strips a trailing slash", () => {
  withCleanConfigEnv(
    { PORTAL_URL: "https://portal.example.com/", PORTAL_API_KEY: "k", PORTAL_USER_ID: "u" },
    () => assert.equal(loadPortalConfig().url, "https://portal.example.com")
  );
});

test("loadPortalConfig rejects a non-http(s) scheme", () => {
  withCleanConfigEnv(
    { PORTAL_URL: "ftp://portal.example.com", PORTAL_API_KEY: "k", PORTAL_USER_ID: "u" },
    () => assert.throws(() => loadPortalConfig(), /scheme must be http or https/)
  );
});

test("loadPortalConfig rejects a malformed url", () => {
  withCleanConfigEnv(
    { PORTAL_URL: "not a url", PORTAL_API_KEY: "k", PORTAL_USER_ID: "u" },
    () => assert.throws(() => loadPortalConfig(), /not a valid URL/)
  );
});
