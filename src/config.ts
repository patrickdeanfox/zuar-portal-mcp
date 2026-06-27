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

// Read a non-negative integer env var, clamped to [min, max]. Falsy/invalid → fallback.
function envNum(name: string, fallback: number, min: number, max: number): number {
  const raw = envStr(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

// ── Network resilience configuration ──────────────────────────────────────────
// Tunables for the portal HTTP client: per-attempt timeout, transient-failure retries
// with exponential backoff, and a circuit breaker that fails fast while the upstream
// is clearly down. All have safe defaults; every value is env-overridable.
export interface NetworkConfig {
  timeoutMs: number; // per-attempt deadline (AbortController)
  maxRetries: number; // additional attempts after the first, for transient failures
  backoffBaseMs: number; // base for exponential backoff (base * 2^attempt + jitter)
  backoffMaxMs: number; // cap on a single backoff sleep
  breakerThreshold: number; // consecutive upstream failures before the breaker opens
  breakerCooldownMs: number; // how long the breaker stays open before a half-open probe
  maxBodyBytes: number; // reject oversized request bodies before sending (input hardening)
}

let cachedNetwork: NetworkConfig | null = null;

/** Resolve the network-resilience posture from the environment (cached per process). */
export function loadNetworkConfig(): NetworkConfig {
  if (cachedNetwork === null) {
    cachedNetwork = {
      timeoutMs: envNum("PORTAL_TIMEOUT_MS", 30_000, 1_000, 600_000),
      maxRetries: envNum("PORTAL_MAX_RETRIES", 2, 0, 8),
      backoffBaseMs: envNum("PORTAL_BACKOFF_BASE_MS", 250, 0, 60_000),
      backoffMaxMs: envNum("PORTAL_BACKOFF_MAX_MS", 8_000, 0, 120_000),
      breakerThreshold: envNum("PORTAL_BREAKER_THRESHOLD", 5, 1, 100),
      breakerCooldownMs: envNum("PORTAL_BREAKER_COOLDOWN_MS", 15_000, 0, 600_000),
      maxBodyBytes: envNum("PORTAL_MAX_BODY_BYTES", 5_000_000, 1_024, 100_000_000),
    };
  }
  return cachedNetwork;
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
let cachedGating: ToolGating | null = null;
let cachedAudit: string | null | undefined = undefined; // undefined = not yet resolved

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
  cachedGating = null;
  cachedAudit = undefined;
  cachedNetwork = null;
}

/** The path where init_project_config writes a new project config (under the CWD). */
export function projectConfigTarget(): string {
  return path.join(process.cwd(), ".zuar-portal", "config.json");
}

// Pull a typed section ("portal" | "vc") out of a raw config object. Tolerates a
// flat file where the portal fields live at the top level (legacy convenience).
function section(raw: Record<string, unknown>, key: "portal" | "vc" | "tools"): Record<string, unknown> {
  const sub = raw[key];
  if (sub && typeof sub === "object" && !Array.isArray(sub)) return sub as Record<string, unknown>;
  if (key === "portal") return raw; // flat fallback: {url, apiKey, userId} at top level
  return {};
}

function projStr(sec: Record<string, unknown>, k: string): string | undefined {
  const v = sec[k];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

// ── Tool gating (capability scoping) ──────────────────────────────────────────
// Independent of the write-safety flags (which gate write EXECUTION): an operator
// can drop whole GROUPS of tools — or individual tools — from the surface entirely
// (e.g. hide all user/permission tools). Default with no policy: every tool is
// registered (byte-identical surface to before). This only ever removes tools.
export type ToolMode = "denylist" | "allowlist";
export interface ToolGating {
  mode: ToolMode;
  enable: Set<string>; // group or tool names
  disable: Set<string>; // group or tool names (always win)
  source: "config" | "env" | "default";
}

// Parse a comma/space separated list (or array) of names, lowercased.
function splitNames(v: unknown): string[] {
  const raw =
    typeof v === "string"
      ? v.split(/[,\s]+/)
      : Array.isArray(v)
        ? v.filter((x) => typeof x === "string")
        : [];
  return raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

/**
 * Resolve the tool-gating policy with project > env > bundle precedence.
 * Project config `tools` section: { "disable": ["users","config"], "enable": [...], "mode": "allowlist" }.
 * Env: PORTAL_DISABLE_TOOLS (denylist), PORTAL_ENABLE_TOOLS (setting it flips to allowlist),
 * PORTAL_TOOLS_MODE ("allowlist"|"denylist"). Names may be GROUPS or individual TOOLS.
 */
export function loadToolGating(): ToolGating {
  if (cachedGating !== null) return cachedGating;
  const proj = section(discoverProjectConfig().raw, "tools");
  const bundle = section(discoverBundleConfig().raw, "tools");
  // Project wins: a project `tools.enable`/`tools.disable` is authoritative and is NOT
  // unioned with env — otherwise env could re-grant a surface the project locked off
  // (env must never EXPAND a project allowlist). Env composes only when the project is silent.
  const enable = new Set<string>(
    proj.enable !== undefined
      ? splitNames(proj.enable)
      : [...splitNames(bundle.enable), ...splitNames(process.env.PORTAL_ENABLE_TOOLS)]
  );
  const disable = new Set<string>(
    proj.disable !== undefined
      ? splitNames(proj.disable)
      : [...splitNames(bundle.disable), ...splitNames(process.env.PORTAL_DISABLE_TOOLS)]
  );
  const explicitMode = (
    (typeof proj.mode === "string" ? proj.mode : process.env.PORTAL_TOOLS_MODE) ?? ""
  )
    .toString()
    .trim()
    .toLowerCase();
  const mode: ToolMode =
    explicitMode === "allowlist" || explicitMode === "denylist"
      ? (explicitMode as ToolMode)
      : enable.size > 0
        ? "allowlist"
        : "denylist";
  const source: ToolGating["source"] =
    proj.enable !== undefined || proj.disable !== undefined || proj.mode !== undefined
      ? "config"
      : enable.size > 0 || disable.size > 0
        ? "env"
        : "default";
  cachedGating = { mode, enable, disable, source };
  return cachedGating;
}

/**
 * Is a tool (belonging to `group`) part of the active surface? Pure.
 * Deny always wins; allowlist mode is default-OFF (only listed groups/tools);
 * denylist mode is default-ON. Always-available introspection tools bypass this
 * at the registration proxy, not here.
 */
export function toolEnabled(name: string, group: string): boolean {
  const g = loadToolGating();
  const n = name.toLowerCase();
  const grp = group.toLowerCase();
  if (g.disable.has(n) || g.disable.has(grp)) return false; // deny always wins
  if (g.mode === "allowlist") return g.enable.has(n) || g.enable.has(grp);
  return true; // denylist mode → default-on
}

// ── Audit log (opt-in, append-only) ───────────────────────────────────────────
// When configured (env PORTAL_AUDIT_LOG, or a project `audit` path/section), every
// write the MCP performs appends one JSON line of OP METADATA (op/kind/id/domain) —
// never payload bodies or secrets. Disabled by default; failures are swallowed so a
// bad path can never break a write. Complements the git VC mirror (which covers
// content writes with rollback); audit also captures data/admin actions.
export function loadAuditPath(): string | null {
  if (cachedAudit !== undefined) return cachedAudit;
  const fromCfg = (raw: Record<string, unknown>): string | undefined => {
    const a = raw.audit;
    if (typeof a === "string" && a.trim()) return a.trim();
    if (a && typeof a === "object") {
      const logPath = (a as Record<string, unknown>).log ?? (a as Record<string, unknown>).path;
      if (typeof logPath === "string" && logPath.trim()) return logPath.trim();
    }
    return undefined;
  };
  const p =
    fromCfg(discoverProjectConfig().raw) ??
    envStr("PORTAL_AUDIT_LOG") ??
    fromCfg(discoverBundleConfig().raw);
  cachedAudit = p ? path.resolve(p) : null;
  // Refuse pseudo / non-regular targets (e.g. /dev/stdout, /proc/self/fd/1): appending JSONL
  // there would corrupt the MCP stdio JSON-RPC framing. A not-yet-existent regular path is fine
  // (appendFileSync creates it).
  if (cachedAudit) {
    const lower = cachedAudit.toLowerCase();
    let bad = lower.startsWith("/dev/") || lower.startsWith("/proc/") || lower.startsWith("/sys/");
    if (!bad) {
      try {
        const st = fs.statSync(cachedAudit, { throwIfNoEntry: false });
        if (st && !st.isFile()) bad = true; // existing dir/device/fifo/socket
      } catch {
        bad = true; // can't stat a path that exists-ish → don't risk the transport
      }
    }
    if (bad) {
      log("audit: refusing non-regular/pseudo path for audit log", cachedAudit);
      cachedAudit = null;
    }
  }
  return cachedAudit;
}

/** Append one audit entry (best-effort; never throws). Metadata only — no payloads/secrets. */
export function appendAudit(entry: Record<string, unknown>): void {
  const p = loadAuditPath();
  if (!p) return;
  try {
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch (e) {
    log("audit: append failed", (e as Error).message);
  }
}

export function auditStatus(): { enabled: boolean; path: string | null } {
  const p = loadAuditPath();
  // Report only the basename — the full absolute path is harvestable infra detail.
  return { enabled: p !== null, path: p ? path.basename(p) : null };
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

  const cleanUrl = url.replace(/\/$/, "");
  // Validate the portal base URL: must be a well-formed http(s) origin. Guards against a
  // mistyped/garbage value (file:, javascript:, missing scheme) being used to build request
  // URLs against the operator's own portal.
  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    throw new Error(`Invalid portal url '${cleanUrl}': not a valid URL. Use https://your-portal.example.com.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Invalid portal url '${cleanUrl}': scheme must be http or https (got '${parsed.protocol}').`
    );
  }

  return { url: cleanUrl, apiKey, userId };
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
