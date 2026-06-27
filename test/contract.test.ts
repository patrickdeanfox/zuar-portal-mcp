/**
 * contract.test.ts — end-to-end MCP contract tests.
 *
 * Drives the real server through a real MCP client over a linked in-memory
 * transport, exercising initialize, tools/list, input-schema rejection, the
 * validation pipeline, and tool gating — all without touching the portal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resetConfigCache } from "../src/config.js";
import { connect, toolNames, resultText } from "./helpers.js";

// Core tools every install should advertise (a subset — full list is larger).
const CORE_TOOLS = [
  "list_blocks",
  "get_block",
  "create_block",
  "validate_block",
  "get_capabilities",
  "active_config",
];

test("initialize handshake and server identity", async () => {
  const { client, close } = await connect();
  try {
    const v = client.getServerVersion();
    assert.equal(v?.name, "zuar-portal-mcp-server");
    assert.ok(typeof v?.version === "string" && v.version.length > 0);
  } finally {
    await close();
  }
});

test("tools/list advertises the core surface", async () => {
  const { client, close } = await connect();
  try {
    const names = await toolNames(client);
    for (const t of CORE_TOOLS) {
      assert.ok(names.includes(t), `missing core tool: ${t}`);
    }
  } finally {
    await close();
  }
});

test("every advertised tool has a non-empty description and input schema", async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 0, `${t.name} has no description`);
      assert.equal(t.inputSchema?.type, "object", `${t.name} has no object input schema`);
    }
  } finally {
    await close();
  }
});

test("a call with invalid input is rejected (schema validation)", async () => {
  const { client, close } = await connect();
  try {
    // get_block requires a non-empty block_id; omitting it must fail before any handler IO.
    let errored = false;
    try {
      const res = await client.callTool({ name: "get_block", arguments: {} });
      errored = res.isError === true;
    } catch {
      errored = true; // SDK may surface this as a JSON-RPC error instead of an error result
    }
    assert.ok(errored, "missing required block_id should be rejected");
  } finally {
    await close();
  }
});

test("validate_block runs the rules pipeline over the wire (no network)", async () => {
  const { client, close } = await connect();
  try {
    const res = await client.callTool({
      name: "validate_block",
      arguments: { json_data: { html: "<script>eval('x');</script>" } },
    });
    assert.notEqual(res.isError, true, "validate_block is a read-only, no-network tool");
    const payload = JSON.parse(resultText(res as { content: Array<{ type: string; text?: string }> }));
    assert.equal(payload.valid, false, "eval() must fail validation");
    assert.ok(
      payload.errors.some((m: string) => m.includes("[no_unsafe_js]")),
      "the no_unsafe_js rule should be reported"
    );
  } finally {
    await close();
  }
});

test("tool gating removes a disabled group from tools/list", async () => {
  // buildServer() freezes its tool surface from the gating policy at construction,
  // so set the env + reset the cache BEFORE connect() builds the server.
  process.env.PORTAL_DISABLE_TOOLS = "users";
  resetConfigCache();
  try {
    const { client, close } = await connect();
    try {
      const names = await toolNames(client);
      assert.ok(!names.includes("set_user_groups"), "users-group tool should be gated off");
      assert.ok(names.includes("create_block"), "other groups remain available");
      // Introspection stays reachable so the operator can always inspect/fix config.
      assert.ok(names.includes("get_capabilities"), "meta tools are always on");
    } finally {
      await close();
    }
  } finally {
    delete process.env.PORTAL_DISABLE_TOOLS;
    resetConfigCache();
  }
});
