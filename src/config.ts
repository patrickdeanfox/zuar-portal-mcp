/**
 * config.ts
 *
 * Resolves Zuar Portal credentials and version-control settings, with support
 * for MULTIPLE portals/repos across MULTIPLE project folders.
 *
 * Resolution is layered, highest priority first:
 *   1. Project config  — the nearest `.zuar-portal/config.json` (or `.zuar-portal.json`,
 *      or a bare `config.json`) found by walking up from the process CWD. This is
 *      what makes one MCP install drive a different portal+repo per folder.
 *   2. Environment     — PORTAL_* vars (how MCPB / Claude Desktop user_config inject
 *      a single global portal). Empty strings count as "unset".
 *   3. Bundle config   — a `config.json` beside the bundle (dev fallback).
 *
 * Each field resolves independently, so a project file can override just the
 * portal while inheriting vc settings from the environment, etc. No secrets are
 * ever logged.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Top-level config ────────────────────────────────────────────────────────
export const DEBUG = process.env.PORTAL_DEBUG === "1";

const CONFIG_BASENAME = "config.json";
// Per-project config file names, tried in order while walking up from the CWD.
const PROJECT_CONFIG_RELPATHS = [
  path.join(".zuar-portal", "config.json"),
  ".zuar-portal.json",
  "config.json",
];

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

// Read an env var, treating empty/whitespace as unset (MCPB injects "" for blank
// user_config fields, which must not shadow a project config value).
function envStr(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
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

// ── Config file discovery (layered) ───────────────────────────────────────────
interface ConfigSource {
  path: string | null; // absolute path of the file, or null when none was found
  raw: Record<string, unknown>; // parsed contents ({} when absent/unreadable)
}

let cachedProject: ConfigSource | null = null;
let cachedBundle: ConfigSource | null = null;

function parseJsonFile(file: string): Record<string, unknown> | null {
  try {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) ?? {};
  } catch {
    return null;
  }
}

/**
 * Walk up from the process CWD looking for the nearest project config file.
 * The first readable match wins (closest folder, then by PROJECT_CONFIG_RELPATHS
 * order within a folder).
 */
function discoverProjectConfig(): ConfigSource {
  if (cachedProject !== null) return cachedProject;
  let dir = process.cwd();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const rel of PROJECT_CONFIG_RELPATHS) {
      const candidate = path.join(dir, rel);
      if (fs.existsSync(candidate)) {
        const raw = parseJsonFile(candidate);
        if (raw) {
          cachedProject = { path: candidate, raw };
          return cachedProject;
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  cachedProject = { path: null, raw: {} };
  return cachedProject;
}

/** The bundle-adjacent config.json (beside dist/, or one level up). Dev fallback. */
function discoverBundleConfig(): ConfigSource {
  if (cachedBundle !== null) return cachedBundle;
  cachedBundle = { path: null, raw: {} };
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [path.join(dir, CONFIG_BASENAME), path.join(dir, "..", CONFIG_BASENAME)];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        const raw = parseJsonFile(file);
        if (raw) {
          cachedBundle = { path: file, raw };
          break;
        }
      }
    }
  } catch {
    /* ignore — leave empty */
  }
  return cachedBundle;
}

/** Re-read config files on the next access (used after init_project_config writes one). */
export function resetConfigCache(): void {
  cachedProject = null;
  cachedBundle = null;
  cachedVc = null;
}

/** The path where init_project_config writes a new project config (under the CWD). */
export function projectConfigTarget(): string {
  return path.join(process.cwd(), ".zuar-portal", "config.json");
}

// Pull a typed section ("portal" | "vc") out of a raw config object. Tolerates a
// flat file where the portal fields live at the top level (legacy convenience).
function section(raw: Record<string, unknown>, key: "portal" | "vc"): Record<string, unknown> {
  const sub = raw[key];
  if (sub && typeof sub === "object" && !Array.isArray(sub)) return sub as Record<string, unknown>;
  if (key === "portal") return raw; // flat fallback: {url, apiKey, userId} at top level
  return {};
}

function projStr(sec: Record<string, unknown>, k: string): string | undefined {
  const v = sec[k];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
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
 * Resolve version-control settings with project > env > bundle precedence.
 * Project files use a `vc` section:
 *   { "dir": "/path/to/repo", "push": true, "remote": "origin",
 *     "remote_url": "https://github.com/you/zuar-portal-state.git",
 *     "token": "<PAT>", "username": "x-access-token" }
 * `dir` unset/empty = VC disabled (no-op). With `remote_url` (+ `token` for HTTPS), the
 * server creates/points the remote and configures auth so push works on a fresh machine
 * with no manual git setup. config.json is gitignored; the token is never logged.
 */
export function loadVcConfig(): VcSettings {
  if (cachedVc !== null) return cachedVc;
  const proj = section(discoverProjectConfig().raw, "vc");
  const bundle = section(discoverBundleConfig().raw, "vc");
  // field(projKey, envName) — project wins, then env, then bundle.
  const str = (k: string, env: string): string | undefined =>
    projStr(proj, k) ?? envStr(env) ?? projStr(bundle, k);

  const rawDir = str("dir", "PORTAL_VC_DIR");
  const dir = rawDir ? path.resolve(rawDir) : null;
  const push = proj.push === true || envOn("PORTAL_VC_PUSH") || bundle.push === true;
  const remote = str("remote", "PORTAL_VC_REMOTE") ?? "origin";
  const remoteUrl = str("remote_url", "PORTAL_VC_REMOTE_URL") ?? null;
  const token = str("token", "PORTAL_VC_TOKEN") ?? null;
  const username = str("username", "PORTAL_VC_USERNAME") ?? "x-access-token";
  cachedVc = { dir, push, remote, remoteUrl, token, username };
  return cachedVc;
}

/**
 * Resolve and validate portal credentials with project > env > bundle precedence.
 * Throws an actionable error if any of url / apiKey / userId is missing.
 */
export function loadPortalConfig(): PortalConfig {
  const proj = section(discoverProjectConfig().raw, "portal");
  const bundle = section(discoverBundleConfig().raw, "portal");

  const url = projStr(proj, "url") ?? envStr("PORTAL_URL") ?? projStr(bundle, "url");
  const apiKey = projStr(proj, "apiKey") ?? envStr("PORTAL_API_KEY") ?? projStr(bundle, "apiKey");
  const userId = projStr(proj, "userId") ?? envStr("PORTAL_USER_ID") ?? projStr(bundle, "userId");

  if (!url || !apiKey || !userId) {
    const missing = [
      !url ? "url (PORTAL_URL)" : null,
      !apiKey ? "apiKey (PORTAL_API_KEY)" : null,
      !userId ? "userId (PORTAL_USER_ID)" : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Missing portal credentials: ${missing}. Run init_project_config to create a ` +
        `./.zuar-portal/config.json for this folder, set the PORTAL_* env vars in your MCP ` +
        `client config, or provide a config.json with a "portal" section.`
    );
  }

  return { url: url.replace(/\/$/, ""), apiKey, userId };
}

/**
 * Describe which config is currently in effect, with all secrets redacted.
 * Powers the active_config tool so an operator can confirm the live portal/repo.
 */
export function activeConfigInfo(): {
  projectConfigPath: string | null;
  bundleConfigPath: string | null;
  portalUrl: string | null;
  userId: string | null;
  apiKeyConfigured: boolean;
  vc: ReturnType<typeof vcInfo>;
} {
  const project = discoverProjectConfig();
  const bundle = discoverBundleConfig();
  let portalUrl: string | null = null;
  let userId: string | null = null;
  let apiKeyConfigured = false;
  try {
    const c = loadPortalConfig();
    portalUrl = c.url;
    userId = c.userId;
    apiKeyConfigured = Boolean(c.apiKey);
  } catch {
    /* credentials incomplete — leave nulls */
  }
  return {
    projectConfigPath: project.path,
    bundleConfigPath: bundle.path,
    portalUrl,
    userId,
    apiKeyConfigured,
    vc: vcInfo(),
  };
}

function vcInfo(): {
  enabled: boolean;
  dir: string | null;
  push: boolean;
  remote: string;
  remoteUrl: string | null;
  tokenConfigured: boolean;
} {
  const c = loadVcConfig();
  return {
    enabled: c.dir !== null,
    dir: c.dir,
    push: c.push,
    remote: c.remote,
    remoteUrl: c.remoteUrl,
    tokenConfigured: c.token !== null,
  };
}
