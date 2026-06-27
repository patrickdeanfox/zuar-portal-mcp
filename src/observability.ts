/**
 * observability.ts
 *
 * Lightweight, dependency-free observability for the MCP server:
 *   - A per-invocation request ID, so a single tool call can be traced across the
 *     structured log lines it produces.
 *   - An in-memory metrics registry (per-tool call count, error count, latency).
 *   - A structured (JSON-to-stderr) logger, opt-in via PORTAL_LOG_FORMAT=json.
 *
 * Everything here is process-local and bounded — no network, no disk, no unbounded
 * growth (metrics are keyed by the fixed tool set). stdout stays reserved for the
 * MCP JSON-RPC framing; all logging goes to stderr.
 */

import { randomUUID } from "node:crypto";
import { DEBUG } from "./config.js";

const STRUCTURED = process.env.PORTAL_LOG_FORMAT?.trim().toLowerCase() === "json";

// ── Request IDs ───────────────────────────────────────────────────────────────
let seq = 0;
/** A short, unique-per-process request id (monotonic counter + a random suffix). */
export function newRequestId(): string {
  seq += 1;
  return `req-${seq.toString(36)}-${randomUUID().slice(0, 8)}`;
}

// ── Structured logging ─────────────────────────────────────────────────────────
/**
 * Emit one structured event to stderr. When PORTAL_LOG_FORMAT=json, writes a single
 * JSON line (machine-parseable); otherwise only emits in DEBUG mode as a readable line.
 * Never logs payload bodies or secrets — callers pass metadata only.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  if (STRUCTURED) {
    try {
      console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
    } catch {
      /* serialization failure must never break a tool call */
    }
  } else if (DEBUG) {
    const kv = Object.entries(fields)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    console.error(`[zuar-portal-mcp] ${event} ${kv}`.trimEnd());
  }
}

// ── Metrics ────────────────────────────────────────────────────────────────────
export interface ToolMetric {
  calls: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

const metrics = new Map<string, ToolMetric>();
let startedAt = Date.now();

/** Record the outcome of one tool invocation. */
export function recordCall(tool: string, ms: number, isError: boolean): void {
  const m = metrics.get(tool) ?? { calls: 0, errors: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
  m.calls += 1;
  if (isError) m.errors += 1;
  m.totalMs += ms;
  m.lastMs = ms;
  if (ms > m.maxMs) m.maxMs = ms;
  metrics.set(tool, m);
}

/** A JSON-friendly snapshot of all tool metrics plus rolled-up totals. */
export function metricsSnapshot(): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  let calls = 0;
  let errors = 0;
  for (const [name, m] of [...metrics.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
    calls += m.calls;
    errors += m.errors;
    tools[name] = {
      calls: m.calls,
      errors: m.errors,
      error_rate: m.calls ? Number((m.errors / m.calls).toFixed(3)) : 0,
      avg_ms: m.calls ? Math.round(m.totalMs / m.calls) : 0,
      max_ms: m.maxMs,
      last_ms: m.lastMs,
    };
  }
  return {
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    totals: { calls, errors, error_rate: calls ? Number((errors / calls).toFixed(3)) : 0 },
    tools,
  };
}

/** Reset all metrics and the uptime clock (used by tests). */
export function resetMetrics(): void {
  metrics.clear();
  startedAt = Date.now();
}
