/**
 * input.test.ts — the boundary oversized-input guard.
 *
 * Drives the guard through the real MCP dispatch path (instrument() runs before any
 * handler/network). Uses validate_block (no-network) so nothing touches the portal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resetConfigCache } from "../src/config.js";
import { connect, resultText } from "./helpers.js";

test("an oversized tool input is rejected at the boundary", async () => {
  process.env.PORTAL_MAX_INPUT_BYTES = "1024";
  resetConfigCache();
  const { client, close } = await connect();
  try {
    const res = await client.callTool({
      name: "validate_block",
      arguments: { json_data: { html: "x".repeat(4000) } },
    });
    assert.equal(res.isError, true, "should be rejected");
    assert.match(resultText(res as { content: Array<{ type: string; text?: string }> }), /exceeds the 1024-byte limit/);
  } finally {
    await close();
    delete process.env.PORTAL_MAX_INPUT_BYTES;
    resetConfigCache();
  }
});

test("a normal-sized input passes the boundary guard", async () => {
  delete process.env.PORTAL_MAX_INPUT_BYTES; // default 2MB
  resetConfigCache();
  const { client, close } = await connect();
  try {
    const res = await client.callTool({
      name: "validate_block",
      arguments: { json_data: { html: "<div class='wrapper'></div>" } },
    });
    assert.notEqual(res.isError, true, "a small input must pass");
  } finally {
    await close();
    resetConfigCache();
  }
});
