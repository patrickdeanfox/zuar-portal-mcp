/**
 * portalClient.ts
 *
 * Minimal Zuar Portal HTTP client.
 * Auth flow:
 *   1. GET /auth/login?api_key=KEY&user_id=USER_ID -> JWT session cookie.
 *   2. Every request forwards that cookie AND an X-Api-Key header.
 *   3. On 401, re-login once and retry.
 *
 * One portal per process (session cookie is module-scoped).
 */

import { loadPortalConfig, log } from "./config.js";

// ── Module state ──────────────────────────────────────────────────────────────
let sessionCookie: string | null = null;

// ── Pure helpers ──────────────────────────────────────────────────────────────
function buildCookieHeader(setCookie: string[]): string {
  if (!setCookie || setCookie.length === 0) return "";
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

// ── IO ──────────────────────────────────────────────────────────────────────
export async function login(): Promise<string> {
  const { url, apiKey, userId } = loadPortalConfig();
  const loginUrl =
    `${url}/auth/login?api_key=${encodeURIComponent(apiKey)}` +
    `&user_id=${encodeURIComponent(userId)}`;

  log("login ->", url);
  const res = await fetch(loginUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "manual",
  });

  if (res.status >= 400) {
    const body = await res.text().catch(() => "");
    throw new Error(`Portal login failed: HTTP ${res.status} - ${body.slice(0, 200)}`);
  }

  sessionCookie = buildCookieHeader(res.headers.getSetCookie?.() ?? []);
  log("login <-", res.status, sessionCookie ? "cookie cached" : "no cookie");
  return sessionCookie;
}

interface RawResponse {
  status: number;
  body: string;
}

async function attempt(
  method: string,
  fullUrl: string,
  body?: unknown
): Promise<RawResponse> {
  const { apiKey } = loadPortalConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (sessionCookie) headers.Cookie = sessionCookie;
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const res = await fetch(fullUrl, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

/**
 * Perform an authenticated portal request.
 * @param method HTTP verb
 * @param apiPath portal-relative path beginning with "/" (e.g. "/api/blocks")
 * @param body optional JSON body
 * @returns parsed JSON (or raw text / null) on 2xx
 * @throws Error with an actionable message on any non-2xx
 */
export async function request<T = unknown>(
  method: string,
  apiPath: string,
  body?: unknown
): Promise<T> {
  const { url } = loadPortalConfig();
  const fullUrl = `${url}${apiPath}`;

  if (sessionCookie === null) await login();

  let res = await attempt(method, fullUrl, body);

  if (res.status === 401) {
    log("401 - re-logging in and retrying", apiPath);
    await login();
    res = await attempt(method, fullUrl, body);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Portal ${method} ${apiPath} failed: HTTP ${res.status} - ${res.body.slice(0, 300)}`
    );
  }

  if (!res.body) return null as T;
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return res.body as unknown as T;
  }
}
