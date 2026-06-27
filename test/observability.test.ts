/**
 * observability.test.ts — metrics, request IDs, and the get_metrics tool.
 *
 * Drives tool calls through the real MCP dispatch path (so the central instrument()
 * wrapper runs) and asserts the metrics registry reflects them. Uses no-network tools
 * (validate_block, get_metrics) so nothing touches the portal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { newRequestId, metricsSnapshot, recordCall, resetMetrics } from "../src/observability.js";
import { connect, resultText } from "./helpers.js";

test("request ids are unique and well-formed", () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.match(a, /^req-[0-9a-z]+-[0-9a-f]{8}$/);
  assert.notEqual(a, b);
});

test("recordCall accumulates calls, errors, and latency", () => {
  resetMetrics();
  recordCall("demo", 10, false);
  recordCall("demo", 30, true);
  const snap = metricsSnapshot() as { totals: { calls: number; errors: number }; tools: Record<string, { avg_ms: number; error_rate: number; max_ms: number }> };
  assert.equal(snap.totals.calls, 2);
  assert.equal(snap.totals.errors, 1);
  assert.equal(snap.tools.demo.avg_ms, 20);
  assert.equal(snap.tools.demo.max_ms, 30);
  assert.equal(snap.tools.demo.error_rate, 0.5);
});

test("tool calls are counted through the MCP dispatch path", async () => {
  resetMetrics();
  const { client, close } = await connect();
  try {
    // Two successful no-network calls (input-schema rejections are handled by the SDK
    // before our handler wrapper runs, so only invocations that reach a handler count).
    await client.callTool({ name: "validate_block", arguments: { json_data: { html: "<div></div>" } } });
    await client.callTool({ name: "get_capabilities", arguments: {} });

    const res = await client.callTool({ name: "get_metrics", arguments: {} });
    const snap = JSON.parse(resultText(res as { content: Array<{ type: string; text?: string }> }));
    assert.ok(snap.tools.validate_block?.calls >= 1, "validate_block call recorded");
    assert.ok(snap.tools.get_capabilities?.calls >= 1, "get_capabilities call recorded");
    assert.ok(typeof snap.totals.calls === "number" && snap.totals.calls >= 2);
    assert.ok(snap.upstream && typeof snap.upstream.state === "string", "breaker state reported");
  } finally {
    await close();
  }
});

test("get_metrics is advertised and always-on", async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "get_metrics"));
  } finally {
    await close();
  }
});
