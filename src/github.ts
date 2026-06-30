/**
 * github.ts
 *
 * Parse a GitHub remote URL into {host, owner, repo} and validate that a Personal
 * Access Token can actually reach that repo — so `setup_portal` fails fast on a bad
 * token or wrong repo instead of silently at the first git push.
 *
 * No new dependency: uses the global `fetch` (Node 18+) with an AbortController
 * timeout. The token is sent ONLY in the Authorization header and is never logged
 * or returned in any message.
 */

export interface GithubRepoRef {
  host: string; // "github.com", "www.github.com", or an Enterprise host
  owner: string;
  repo: string; // without a trailing ".git"
  isGithubCom: boolean;
  apiBase: string; // "https://api.github.com" (cloud) or "https://<host>/api/v3" (Enterprise)
}

/**
 * Parse the common GitHub remote shapes into an owner/repo reference, or null when
 * the string isn't a recognisable repo URL. Handles:
 *   - https://github.com/owner/repo(.git)(/)
 *   - https://x-access-token:TOKEN@github.com/owner/repo.git   (userinfo stripped)
 *   - git@github.com:owner/repo.git                            (scp-like ssh)
 *   - ssh://git@github.com/owner/repo.git
 *   - https://github.example.com/owner/repo.git                (Enterprise → /api/v3)
 */
export function parseGithubRepo(remoteUrl: string): GithubRepoRef | null {
  if (typeof remoteUrl !== "string") return null;
  const s = remoteUrl.trim();
  if (!s) return null;

  let host = "";
  let pathPart = "";

  // scp-like ssh syntax: user@host:owner/repo(.git) — has no "://".
  const scp = /^[A-Za-z0-9._-]+@([^:/]+):(.+)$/.exec(s);
  if (scp && !s.includes("://")) {
    host = scp[1];
    pathPart = scp[2];
  } else {
    try {
      const u = new URL(s); // handles http(s), ssh://, git:// and strips any userinfo
      host = u.hostname;
      pathPart = u.pathname;
    } catch {
      return null;
    }
  }

  const segs = pathPart
    .replace(/^\/+/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  if (segs.length < 2) return null;

  const owner = segs[0];
  const repo = segs[1];
  if (!host || !owner || !repo) return null;

  const lower = host.toLowerCase();
  const isGithubCom = lower === "github.com" || lower === "www.github.com";
  const apiBase = isGithubCom ? "https://api.github.com" : `https://${host}/api/v3`;
  return { host, owner, repo, isGithubCom, apiBase };
}

export interface GithubValidation {
  ok: boolean; // token can reach the repo (push-capable when can_push !== false)
  checked: boolean; // false = we skipped (unparseable URL, or no token to check with)
  reason?: string; // human-readable explanation (never contains the token)
  login?: string; // authenticated GitHub user, when the token was accepted
  repoFullName?: string; // "owner/repo"
  canPush?: boolean; // repo push permission, when GitHub reports it
}

interface GhResponse {
  status: number;
  json: Record<string, unknown> | null;
}

/**
 * Verify a PAT against the GitHub API: it confirms the token is accepted and that
 * the named repo is reachable (and, when GitHub reports it, push-capable). Returns
 * a structured result rather than throwing; network/timeout failures become
 * `{ ok:false, checked:true, reason }`. Validation is best-effort and informational
 * — the caller decides what to do with a failure.
 */
export async function validateGithubAccess(opts: {
  remoteUrl: string;
  token?: string | null;
  timeoutMs?: number;
}): Promise<GithubValidation> {
  const ref = parseGithubRepo(opts.remoteUrl);
  if (!ref) {
    return { ok: false, checked: false, reason: `Could not parse a GitHub owner/repo from '${opts.remoteUrl}'.` };
  }
  const repoFullName = `${ref.owner}/${ref.repo}`;
  const token = opts.token?.trim();
  if (!token) {
    return {
      ok: false,
      checked: false,
      repoFullName,
      reason: "No token provided — skipped GitHub API validation (git push will rely on your existing credentials).",
    };
  }
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 15_000;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "zuar-portal-mcp",
  };

  async function gh(url: string): Promise<GhResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      let json: Record<string, unknown> | null = null;
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        /* non-JSON body — leave null */
      }
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    // 1. Token validity + identity.
    const who = await gh(`${ref.apiBase}/user`);
    if (who.status === 401) {
      return { ok: false, checked: true, repoFullName, reason: "GitHub rejected the token (401). Check the PAT and that it has repo access." };
    }
    const login = who.status === 200 ? (who.json?.login as string | undefined) : undefined;

    // 2. Repo reachability + push permission.
    const repoRes = await gh(`${ref.apiBase}/repos/${ref.owner}/${ref.repo}`);
    if (repoRes.status === 200) {
      const perms = repoRes.json?.permissions as Record<string, unknown> | undefined;
      const canPush = typeof perms?.push === "boolean" ? (perms.push as boolean) : undefined;
      return {
        ok: true,
        checked: true,
        login,
        repoFullName: (repoRes.json?.full_name as string | undefined) ?? repoFullName,
        canPush,
        reason: canPush === false ? "Token can read the repo but lacks push permission — pushes will fail." : undefined,
      };
    }
    if (repoRes.status === 404) {
      return {
        ok: false,
        checked: true,
        login,
        repoFullName,
        reason: "Repo not found, or the token can't see it (404). Create the repo or grant the token access.",
      };
    }
    if (repoRes.status === 401) {
      return { ok: false, checked: true, repoFullName, reason: "GitHub rejected the token (401) for the repo. Check the PAT scopes." };
    }
    if (repoRes.status === 403) {
      return { ok: false, checked: true, login, repoFullName, reason: "GitHub returned 403 (forbidden or rate-limited). Check token scopes, then retry." };
    }
    return { ok: false, checked: true, login, repoFullName, reason: `Unexpected GitHub response (HTTP ${repoRes.status}).` };
  } catch (e) {
    const err = e as Error;
    const reason = err?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : err?.message ?? "network error";
    return { ok: false, checked: true, repoFullName, reason: `GitHub validation failed: ${reason}.` };
  }
}
