/**
 * portalVc.ts
 *
 * Optional file-based version control for portal CONTENT. When PORTAL_VC_DIR is
 * set, every content write the MCP performs (blocks, layouts, queries, themes,
 * partials, snippets, translations, dashboards, tags) is mirrored as a pretty
 * JSON file in that git repo and auto-committed — so any MCP change can be
 * reverted. When the var is unset, every function here is a no-op.
 *
 * Best-effort by design: the portal is the source of truth; this is a safety
 * mirror. A git/FS failure is logged and swallowed so it never breaks the
 * underlying portal write. Optionally pushes to a remote (PORTAL_VC_PUSH=1).
 *
 * Layout on disk:  <PORTAL_VC_DIR>/<kind>/<id>.json
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { log, loadVcConfig, appendAudit } from "./config.js";

/** Absolute path of the VC repo, or null when version control is disabled. */
export function vcDir(): string | null {
  return loadVcConfig().dir;
}
export function isVcEnabled(): boolean {
  return vcDir() !== null;
}

export function vcStatus(): {
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
    remoteUrl: c.remoteUrl, // a repo URL, not a secret
    tokenConfigured: c.token !== null, // never expose the token itself
  };
}

// ── git helpers ───────────────────────────────────────────────────────────────
let repoReady = false;

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

function ensureRepo(dir: string): void {
  if (repoReady) return;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, ".git"))) {
    try { git(dir, ["init", "-q", "-b", "main"]); } catch { git(dir, ["init", "-q"]); }
    try { git(dir, ["config", "user.email", "zuar-portal-mcp@local"]); } catch { /* noop */ }
    try { git(dir, ["config", "user.name", "zuar-portal-mcp"]); } catch { /* noop */ }
    const readme = path.join(dir, "README.md");
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        "# Zuar Portal state\n\nAuto-versioned content snapshots written by zuar-portal-mcp.\n" +
          "Each `<kind>/<id>.json` is a portal record; commits mirror MCP writes.\n"
      );
    }
  }
  repoReady = true;
}

function safe(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, "_");
}
function rel(kind: string, id: string): string {
  return `${safe(kind)}/${safe(id)}.json`; // forward slashes (also valid for `git show`)
}

// Configure the push remote + HTTPS auth from config (idempotent). The token is applied as a
// git http auth header in the repo's local config; it is NEVER logged or printed.
function ensureRemote(dir: string): void {
  const c = loadVcConfig();
  if (!c.remoteUrl) return;
  const remotes = git(dir, ["remote"]).split(/\s+/).filter(Boolean);
  if (remotes.includes(c.remote)) git(dir, ["remote", "set-url", c.remote, c.remoteUrl]);
  else git(dir, ["remote", "add", c.remote, c.remoteUrl]);
  if (c.token && /^https:\/\//i.test(c.remoteUrl)) {
    const basic = Buffer.from(`${c.username}:${c.token}`).toString("base64");
    git(dir, ["config", "http.extraHeader", `AUTHORIZATION: Basic ${basic}`]);
  }
}

// Strip any token / auth header out of a message before logging.
function redactToken(msg: string): string {
  const c = loadVcConfig();
  let out = msg || "";
  if (c.token) out = out.split(c.token).join("***");
  return out.replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic ***");
}

function maybePush(dir: string): void {
  const c = loadVcConfig();
  if (!c.push) return;
  try {
    ensureRemote(dir);
    git(dir, ["push", "-u", c.remote, "HEAD"]);
  } catch (e) {
    log("vc: push failed", redactToken((e as Error).message));
  }
}

function writeFile(dir: string, relPath: string, data: unknown): void {
  const file = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function commitIfChanged(dir: string, message: string): boolean {
  if (!git(dir, ["status", "--porcelain"]).trim()) return false;
  git(dir, ["commit", "-q", "-m", message]);
  maybePush(dir);
  return true;
}

// ── Public write hooks (best-effort) ──────────────────────────────────────────
/** Mirror a create/update of a content record and commit. */
export function recordWrite(kind: string, id: unknown, action: string, data: unknown): void {
  // Audit every content write (metadata only), independent of whether VC is enabled.
  appendAudit({ domain: "content", op: action, kind, id: id === undefined ? undefined : String(id) });
  const dir = vcDir();
  if (!dir || typeof id !== "string" || !id) return;
  try {
    ensureRepo(dir);
    const r = rel(kind, id);
    writeFile(dir, r, data);
    git(dir, ["add", r]);
    commitIfChanged(dir, `${action} ${kind} ${id}`);
  } catch (e) {
    log("vc: recordWrite failed", kind, String(id), (e as Error).message);
  }
}

/** Mirror a delete of a content record and commit. */
export function recordDelete(kind: string, id: unknown): void {
  appendAudit({ domain: "content", op: "delete", kind, id: id === undefined ? undefined : String(id) });
  const dir = vcDir();
  if (!dir || typeof id !== "string" || !id) return;
  try {
    ensureRepo(dir);
    const r = rel(kind, id);
    if (fs.existsSync(path.join(dir, r))) {
      git(dir, ["rm", "-q", r]);
      commitIfChanged(dir, `delete ${kind} ${id}`);
    }
  } catch (e) {
    log("vc: recordDelete failed", kind, String(id), (e as Error).message);
  }
}

// ── Snapshot / restore / history ──────────────────────────────────────────────
/** Stage a record without committing (for batch snapshots). */
export function stageResource(kind: string, id: unknown, data: unknown): void {
  const dir = vcDir();
  if (!dir || typeof id !== "string" || !id) return;
  try {
    ensureRepo(dir);
    writeFile(dir, rel(kind, id), data);
  } catch (e) {
    log("vc: stageResource failed", kind, String(id), (e as Error).message);
  }
}

/** Commit everything currently staged/changed under one message. Returns true if a commit was made. */
export function commitSnapshot(message: string): boolean {
  const dir = vcDir();
  if (!dir) return false;
  try {
    ensureRepo(dir);
    git(dir, ["add", "-A"]);
    return commitIfChanged(dir, message);
  } catch (e) {
    log("vc: commitSnapshot failed", (e as Error).message);
    return false;
  }
}

/** The commit hash of the change to this record just before `ref` (for "undo last change"). */
export function previousRef(kind: string, id: string, before = "HEAD"): string | null {
  const dir = vcDir();
  if (!dir) return null;
  try {
    ensureRepo(dir);
    const out = git(dir, ["log", "-n", "2", "--format=%H", before, "--", rel(kind, id)]).trim();
    const hashes = out.split("\n").filter(Boolean);
    return hashes[1] ?? null; // [0] = the change AT before; [1] = the one before that
  } catch {
    return null;
  }
}

/** Read a record's JSON as of a git ref. Returns parsed object, or null if absent. */
export function readVersion(kind: string, id: string, ref = "HEAD"): unknown | null {
  const dir = vcDir();
  if (!dir) return null;
  try {
    ensureRepo(dir);
    return JSON.parse(git(dir, ["show", `${ref}:${rel(kind, id)}`]));
  } catch (e) {
    log("vc: readVersion failed", kind, id, ref, (e as Error).message);
    return null;
  }
}

/** Commit history for a record (or the whole repo when kind/id omitted). */
export function history(
  kind?: string,
  id?: string,
  limit = 20
): { hash: string; date: string; message: string }[] {
  const dir = vcDir();
  if (!dir) return [];
  try {
    ensureRepo(dir);
    const args = ["log", `-n${limit}`, "--pretty=format:%h%x09%ad%x09%s", "--date=iso"];
    if (kind && id) args.push("--", rel(kind, id));
    const out = git(dir, args).trim();
    if (!out) return [];
    return out.split("\n").map((line) => {
      const [hash, date, ...msg] = line.split("\t");
      return { hash, date, message: msg.join("\t") };
    });
  } catch (e) {
    log("vc: history failed", (e as Error).message);
    return [];
  }
}
