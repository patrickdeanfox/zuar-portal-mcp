/**
 * github.test.ts — unit tests for the GitHub remote parser and the no-network
 * paths of the access validator (used by setup_portal's "configure + validate"
 * flow). Network-dependent branches of validateGithubAccess are not exercised
 * here; only the pure parsing and the early skip-returns are.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubRepo, validateGithubAccess } from "../src/github.js";

test("parses https with .git suffix", () => {
  const r = parseGithubRepo("https://github.com/acme/portal-state.git");
  assert.deepEqual(r, {
    host: "github.com",
    owner: "acme",
    repo: "portal-state",
    isGithubCom: true,
    apiBase: "https://api.github.com",
  });
});

test("parses https without .git and a trailing slash", () => {
  const r = parseGithubRepo("https://github.com/acme/portal-state/");
  assert.equal(r?.owner, "acme");
  assert.equal(r?.repo, "portal-state");
  assert.equal(r?.apiBase, "https://api.github.com");
});

test("strips userinfo (token-in-URL) from the host", () => {
  const r = parseGithubRepo("https://x-access-token:ghp_secret@github.com/acme/portal-state.git");
  assert.equal(r?.host, "github.com");
  assert.equal(r?.owner, "acme");
  assert.equal(r?.repo, "portal-state");
});

test("parses scp-like ssh syntax (git@github.com:owner/repo.git)", () => {
  const r = parseGithubRepo("git@github.com:acme/portal-state.git");
  assert.equal(r?.host, "github.com");
  assert.equal(r?.owner, "acme");
  assert.equal(r?.repo, "portal-state");
  assert.equal(r?.isGithubCom, true);
});

test("parses ssh:// url form", () => {
  const r = parseGithubRepo("ssh://git@github.com/acme/portal-state.git");
  assert.equal(r?.owner, "acme");
  assert.equal(r?.repo, "portal-state");
});

test("Enterprise host gets the /api/v3 base and isGithubCom=false", () => {
  const r = parseGithubRepo("https://github.example.com/acme/portal-state.git");
  assert.equal(r?.host, "github.example.com");
  assert.equal(r?.isGithubCom, false);
  assert.equal(r?.apiBase, "https://github.example.com/api/v3");
});

test("rejects junk / incomplete repo paths", () => {
  assert.equal(parseGithubRepo(""), null);
  assert.equal(parseGithubRepo("   "), null);
  assert.equal(parseGithubRepo("https://github.com/acme"), null); // owner only, no repo
  assert.equal(parseGithubRepo("not a url"), null);
  // @ts-expect-error — defends the runtime guard against non-string input
  assert.equal(parseGithubRepo(null), null);
});

test("validateGithubAccess skips (checked=false) when the URL can't be parsed", async () => {
  const v = await validateGithubAccess({ remoteUrl: "nonsense", token: "ghp_whatever" });
  assert.equal(v.checked, false);
  assert.equal(v.ok, false);
  assert.match(v.reason ?? "", /could not parse/i);
});

test("validateGithubAccess skips (checked=false) when no token is supplied", async () => {
  const v = await validateGithubAccess({ remoteUrl: "https://github.com/acme/portal-state.git", token: "" });
  assert.equal(v.checked, false);
  assert.equal(v.ok, false);
  assert.equal(v.repoFullName, "acme/portal-state");
  assert.match(v.reason ?? "", /no token/i);
});
