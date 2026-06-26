/**
 * config.ts
 *
 * Resolves Zuar Portal credentials. Env vars win (the path MCPB / Claude Code
 * use via user_config); a config.json next to the bundle is an optional dev
 * fallback. No secrets are ever logged.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Top-level config ────────────────────────────────────────────────────────
export const DEBUG = process.env.PORTAL_DEBUG === "1";

const CONFIG_FILENAME = "config.json";

export interface PortalConfig {
  url: string;
  apiKey: string;
  userId: string;
}

// ── Write-safety configuration ───────────────────────────────────────────────
// Every write tool is tagged with a risk domain. Domains gate independently so
// an operator can enable low-risk content edits while leaving SQL/admin off.
export type WriteDomain = "content" | "data" | "admin";

export interface SafetyConfig {
  readOnly: boolean; // PORTAL_READONLY=1 — blocks every write, regardless of domain.
  allowData: boolean; // PORTAL_ALLOW_DATA_WRITES=1 — datasources, db_modifications, run.
  allowAdmin: boolean; // PORTAL_ALLOW_ADMIN_WRITES=1 — users, passwords, groups, config, etc.
}

// Env values that count as "on". Anything else is off (safe default).
const TRUTHY = new Set(["1", "true", "yes", "on"]);

function envOn(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && TRUTHY.has(v.trim().toLowerCase());
}

// Resolved once per process; safety posture doesn't change mid-run.
let cachedSafety: SafetyConfig | null = null;

/**
 * Resolve the write-safety posture from the environment.
 * Default posture: content writes ON, data + admin writes OFF (opt-in).
 */
export function loadSafetyConfig(): SafetyConfig {
  if (cachedSafety === null) {
    cachedSafety = {
      readOnly: envOn("PORTAL_READONLY"),
      allowData: envOn("PORTAL_ALLOW_DATA_WRITES"),
      allowAdmin: envOn("PORTAL_ALLOW_ADMIN_WRITES"),
    };
  }
  return cachedSafety;
}

/**
 * Decide whether a write in `domain` is permitted. Returns null when allowed,
 * or an actionable operator-facing message (which env flag to set) when blocked.
 */
export function blockReason(domain: WriteDomain): string | null {
  const s = loadSafetyConfig();
  if (s.readOnly) {
    return "Server is in read-only mode (PORTAL_READONLY is set). Unset it to allow writes.";
  }
  if (domain === "data" && !s.allowData) {
    return (
      "Data writes are disabled. This touches datasources/SQL/db_modifications — " +
      "set PORTAL_ALLOW_DATA_WRITES=1 to enable them."
    );
  }
  if (domain === "admin" && !s.allowAdmin) {
    return (
      "Admin writes are disabled. This touches users/passwords/groups/config — " +
      "set PORTAL_ALLOW_ADMIN_WRITES=1 to enable them."
    );
  }
  return null;
}

// ── Logger (stderr only — stdout is reserved for MCP JSON-RPC framing) ────────
export function log(...args: unknown[]): void {
  if (DEBUG) console.error("[zuar-portal-mcp]", ...args);
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
let cachedRawFile: Record<string, unknown> | null = null;

// Read the whole config.json once (beside dist/, or one level up at the project root).
function readRawConfigFile(): Record<string, unknown> {
  if (cachedRawFile !== null) return cachedRawFile;
  cachedRawFile = {};
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [path.join(dir, CONFIG_FILENAME), path.join(dir, "..", CONFIG_FILENAME)];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        cachedRawFile = (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) ?? {};
        break;
      }
    }
  } catch {
    cachedRawFile = {};
  }
  return cachedRawFile;
}

function readConfigFile(): Partial<PortalConfig> {
  const raw = readRawConfigFile();
  return (raw.portal as Partial<PortalConfig>) ?? (raw as Partial<PortalConfig>) ?? {};
}

// ── Version-control configuration ─────────────────────────────────────────────
export interface VcSettings {
  dir: string | null; // resolved repo path; null = version control disabled
  push: boolean;
  remote: string;
  remoteUrl: string | null; // if set, the server configures this remote automatically
  token: string | null; // optional PAT for HTTPS push auth (never logged)
  username: string; // HTTPS basic-auth username for the token (default x-access-token)
}

let cachedVc: VcSettings | null = null;

/**
 * Resolve version-control settings. Env vars win; otherwise a `vc` section in
 * config.json:
 *   { "dir": "/path/to/repo", "push": true, "remote": "origin",
 *     "remote_url": "https://github.com/you/zuar-portal-state.git",
 *     "token": "<PAT>", "username": "x-access-token" }
 * `dir` unset/empty = VC disabled (no-op). With `remote_url` (+ `token` for HTTPS), the
 * server creates/points the remote and configures auth so push works on a fresh machine
 * with no manual git setup. config.json is gitignored; the token is never logged.
 */
export function loadVcConfig(): VcSettings {
  if (cachedVc !== null) return cachedVc;
  const f = (readRawConfigFile().vc as Record<string, unknown>) ?? {};
  const s = (k: string): string | undefined => (typeof f[k] === "string" ? (f[k] as string) : undefined);
  const rawDir = process.env.PORTAL_VC_DIR ?? s("dir");
  const dir = rawDir && rawDir.trim() ? path.resolve(rawDir.trim()) : null;
  const push = envOn("PORTAL_VC_PUSH") || f.push === true;
  const remote = process.env.PORTAL_VC_REMOTE ?? s("remote") ?? "origin";
  const remoteUrl = (process.env.PORTAL_VC_REMOTE_URL ?? s("remote_url") ?? "").trim() || null;
  const token = (process.env.PORTAL_VC_TOKEN ?? s("token") ?? "").trim() || null;
  const username = (process.env.PORTAL_VC_USERNAME ?? s("username") ?? "x-access-token").trim() || "x-access-token";
  cachedVc = { dir, push, remote, remoteUrl, token, username };
  return cachedVc;
}

/**
 * Resolve and validate portal credentials. Throws an actionable error if any
 * of url / apiKey / userId is missing.
 */
export function loadPortalConfig(): PortalConfig {
  const file = readConfigFile();
  const url = process.env.PORTAL_URL ?? file.url;
  const apiKey = process.env.PORTAL_API_KEY ?? file.apiKey;
  const userId = process.env.PORTAL_USER_ID ?? file.userId;

  if (!url || !apiKey || !userId) {
    const missing = [
      !url ? "PORTAL_URL" : null,
      !apiKey ? "PORTAL_API_KEY" : null,
      !userId ? "PORTAL_USER_ID" : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Missing portal credentials: ${missing}. Set them in your MCP client config ` +
        `(or the bundle's settings), or provide a config.json with a "portal" section.`
    );
  }

  return { url: url.replace(/\/$/, ""), apiKey, userId };
}
