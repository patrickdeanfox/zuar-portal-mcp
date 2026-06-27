/**
 * config.test.ts — unit tests for the write-safety posture and tool-gating policy.
 *
 * These read process.env. Tool gating is re-resolvable via resetConfigCache(), so we
 * drive several env permutations in one process. The write-safety posture caches once
 * per process (by design — it can't change mid-run), so we assert the DEFAULT posture
 * before anything could have set the flags.
 *
 * Node's test runner isolates each test FILE in its own child process, so the env
 * mutations here don't leak into rules/contract tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockReason,
  loadSafetyConfig,
  loadToolGating,
  toolEnabled,
  resetConfigCache,
} from "../src/config.js";

// Clear any inherited safety flags BEFORE the first loadSafetyConfig() call so the
// cached posture is the documented default (content on, data/admin off).
delete process.env.PORTAL_READONLY;
delete process.env.PORTAL_ALLOW_DATA_WRITES;
delete process.env.PORTAL_ALLOW_ADMIN_WRITES;

test("default safety posture: content writes allowed, data + admin blocked", () => {
  const s = loadSafetyConfig();
  assert.equal(s.readOnly, false);
  assert.equal(s.allowData, false);
  assert.equal(s.allowAdmin, false);

  assert.equal(blockReason("content"), null, "content writes are on by default");
  assert.match(blockReason("data") ?? "", /PORTAL_ALLOW_DATA_WRITES/);
  assert.match(blockReason("admin") ?? "", /PORTAL_ALLOW_ADMIN_WRITES/);
});

test("gating default (no policy): every group is on (denylist mode)", () => {
  delete process.env.PORTAL_DISABLE_TOOLS;
  delete process.env.PORTAL_ENABLE_TOOLS;
  delete process.env.PORTAL_TOOLS_MODE;
  resetConfigCache();

  const g = loadToolGating();
  assert.equal(g.mode, "denylist");
  assert.equal(g.source, "default");
  assert.equal(toolEnabled("create_block", "blocks"), true);
  assert.equal(toolEnabled("set_user_groups", "users"), true);
});

test("denylist: disabling a group removes its tools", () => {
  process.env.PORTAL_DISABLE_TOOLS = "users";
  delete process.env.PORTAL_ENABLE_TOOLS;
  delete process.env.PORTAL_TOOLS_MODE;
  resetConfigCache();

  assert.equal(toolEnabled("set_user_groups", "users"), false, "users group is denied");
  assert.equal(toolEnabled("create_block", "blocks"), true, "other groups untouched");
});

test("allowlist: setting PORTAL_ENABLE_TOOLS flips to default-off", () => {
  delete process.env.PORTAL_DISABLE_TOOLS;
  process.env.PORTAL_ENABLE_TOOLS = "blocks";
  delete process.env.PORTAL_TOOLS_MODE;
  resetConfigCache();

  const g = loadToolGating();
  assert.equal(g.mode, "allowlist");
  assert.equal(toolEnabled("create_block", "blocks"), true, "enabled group is on");
  assert.equal(toolEnabled("set_user_groups", "users"), false, "everything else is off");
});

test("deny always wins over allow for the same name", () => {
  process.env.PORTAL_ENABLE_TOOLS = "blocks";
  process.env.PORTAL_DISABLE_TOOLS = "blocks";
  delete process.env.PORTAL_TOOLS_MODE;
  resetConfigCache();

  assert.equal(toolEnabled("create_block", "blocks"), false, "disable beats enable");
});

test("tool-level gating works independent of group", () => {
  delete process.env.PORTAL_ENABLE_TOOLS;
  process.env.PORTAL_DISABLE_TOOLS = "delete_block";
  delete process.env.PORTAL_TOOLS_MODE;
  resetConfigCache();

  assert.equal(toolEnabled("delete_block", "blocks"), false, "single tool denied by name");
  assert.equal(toolEnabled("create_block", "blocks"), true, "sibling in same group still on");
});
