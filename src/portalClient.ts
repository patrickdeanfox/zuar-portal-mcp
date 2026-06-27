/**
 * portalClient.ts
 *
 * Minimal, resilient Zuar Portal HTTP client.
 *
 * Auth flow:
 *   1. GET /auth/login?api_key=KEY&user_id=USER_ID -> JWT session cookie.
 *   2. Every request forwards that cookie AND an X-Api-Key header.
 *   3. On 401, re-login once and retry.
 *
 * Resilience (config.loadNetworkConfig):
 *   - Per-attempt timeout via AbortController.
 *   - Exponential backoff + jitter on transient failures (network errors, 429, 5xx),
 *     honouring a Retry-After header when present.
 *   - A circuit breaker that fails fast while the upstream is clearly down, so a
 *     flaky/offline portal doesn't make every tool call hang for the full timeout.
 *   - Retry safety: GET (idempotent) retries on any transient signal; writes
 *     (POST/PUT/DELETE) retry only on a pre-response network error or an explicit
 *     429/503 "try again later" — never on an ambiguous 502/504 that may have applied.
 *
 * One portal per process (session cookie + breaker state are module-scoped).
 */

import { loadPortalConfig, loadNetworkConfig, log } from "./config.js";

// ── Module state ──────────────────────────────────────────────────────────────
let sessionCookie: string | null = null;

// Circuit-breaker state. "closed" = normal; "open" = failing fast until openedAt+cooldown,
// after which the next call is a half-open probe that closes the breaker on success or
// re-opens it on failure.
interface BreakerState {
  consecutiveFailures: number;
  openedAt: number | null; // epoch ms when the breaker opened, or null when closed
}
const breaker: BreakerState = { consecutiveFailures: 0, openedAt: null };

/**
 * Drop the cached session so the next request logs in fresh. Call after the
 * active portal config changes (e.g. init_project_config) so a stale cookie from
 * a previous portal isn't reused. Also resets the circuit breaker.
 */
export function resetSession(): void {
  sessionCookie = null;
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
}

/** Inspect the circuit-breaker state (for diagnostics/metrics). Pure. */
export function breakerStatus(): { state: "closed" | "open"; consecutiveFailures: number } {
  const open = breaker.openedAt !== null && Date.now() - breaker.openedAt < loadNetworkConfig().breakerCooldownMs;
  return { state: open ? "open" : "closed", consecutiveFailures: breaker.consecutiveFailures };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
function buildCookieHeader(setCookie: string[]): string {
  if (!setCookie || setCookie.length === 0) return "";
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Transient HTTP statuses that justify a retry. 408 = request timeout, 425 = too early,
// 429 = rate limited, 5xx = upstream trouble.
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// A write is only safe to auto-retry on signals that mean "definitely not applied":
// a pre-response network throw, or an explicit 429/503 back-pressure. An ambiguous
// 502/504 may have mutated state, so we don't retry non-idempotent methods on those.
function isIdempotent(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
}

// Backoff for `attempt` (0-based): exponential with full jitter, capped. A Retry-After
// header (seconds, or an HTTP-date) takes precedence when the server provides one.
function backoffDelay(attempt: number, retryAfter: string | null): number {
  const { backoffBaseMs, backoffMaxMs } = loadNetworkConfig();
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, backoffMaxMs);
    const when = Date.parse(retryAfter);
    if (!Number.isNaN(when)) return Math.min(Math.max(0, when - Date.now()), backoffMaxMs);
  }
  const exp = Math.min(backoffBaseMs * 2 ** attempt, backoffMaxMs);
  // Full jitter: a uniform draw in [0, exp]. Math.random is fine here (no crypto need),
  // but avoid it in unit tests by clamping when base is 0.
  return exp === 0 ? 0 : Math.floor(Math.random() * exp);
}

// ── IO ──────────────────────────────────────────────────────────────────────
export async function login(): Promise<string> {
  const { url, apiKey, userId } = loadPortalConfig();
  const { timeoutMs } = loadNetworkConfig();
  const loginUrl =
    `${url}/auth/login?api_key=${encodeURIComponent(apiKey)}` +
    `&user_id=${encodeURIComponent(userId)}`;

  log("login ->", url);
  const res = await fetchWithTimeout(loginUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "manual",
  }, timeoutMs);

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
  retryAfter: string | null;
}

// fetch() with a per-attempt timeout. Translates an abort into a clear, classifiable error.
async function fetchWithTimeout(
  fullUrl: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(fullUrl, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(`Portal request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function attempt(
  method: string,
  fullUrl: string,
  body?: unknown
): Promise<RawResponse> {
  const { apiKey } = loadPortalConfig();
  const { timeoutMs } = loadNetworkConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (sessionCookie) headers.Cookie = sessionCookie;
  if (apiKey) headers["X-Api-Key"] = apiKey;

  const res = await fetchWithTimeout(
    fullUrl,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    },
    timeoutMs
  );
  const text = await res.text();
  return { status: res.status, body: text, retryAfter: res.headers.get("retry-after") };
}

// ── Circuit breaker ───────────────────────────────────────────────────────────
function breakerIsOpen(): boolean {
  if (breaker.openedAt === null) return false;
  const { breakerCooldownMs } = loadNetworkConfig();
  if (Date.now() - breaker.openedAt >= breakerCooldownMs) {
    // Cooldown elapsed → allow a single half-open probe (leave openedAt set; a success
    // closes it, a failure re-stamps openedAt to extend the open window).
    return false;
  }
  return true;
}

function recordSuccess(): void {
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
}

function recordFailure(): void {
  breaker.consecutiveFailures += 1;
  const { breakerThreshold } = loadNetworkConfig();
  if (breaker.consecutiveFailures >= breakerThreshold) {
    breaker.openedAt = Date.now();
    log("circuit breaker OPEN after", breaker.consecutiveFailures, "consecutive failures");
  }
}

/**
 * Perform an authenticated, resilient portal request.
 * @param method HTTP verb
 * @param apiPath portal-relative path beginning with "/" (e.g. "/api/blocks")
 * @param body optional JSON body
 * @returns parsed JSON (or raw text / null) on 2xx
 * @throws Error with an actionable message on any non-2xx (after retries) or when the
 *         circuit breaker is open.
 */
export async function request<T = unknown>(
  method: string,
  apiPath: string,
  body?: unknown
): Promise<T> {
  const { url } = loadPortalConfig();
  const net = loadNetworkConfig();
  const fullUrl = `${url}${apiPath}`;

  // Input hardening: reject oversized bodies before they hit the wire.
  if (body !== undefined) {
    const size = Buffer.byteLength(JSON.stringify(body), "utf8");
    if (size > net.maxBodyBytes) {
      throw new Error(
        `Portal ${method} ${apiPath} rejected: request body ${size} bytes exceeds the ` +
          `${net.maxBodyBytes}-byte limit (PORTAL_MAX_BODY_BYTES).`
      );
    }
  }

  if (breakerIsOpen()) {
    throw new Error(
      `Portal upstream circuit breaker is open after repeated failures — failing fast. ` +
        `It will retry automatically after a short cooldown.`
    );
  }

  if (sessionCookie === null) await login();

  const idempotent = isIdempotent(method);
  let lastErr: Error | null = null;

  for (let i = 0; i <= net.maxRetries; i++) {
    let networkError: Error | null = null;
    let res: RawResponse | null = null;
    try {
      res = await attempt(method, fullUrl, body);
    } catch (e) {
      networkError = e as Error;
    }

    // One transparent re-login on 401, then re-evaluate this same attempt.
    if (res && res.status === 401) {
      log("401 - re-logging in and retrying", apiPath);
      await login();
      try {
        res = await attempt(method, fullUrl, body);
      } catch (e) {
        networkError = e as Error;
        res = null;
      }
    }

    if (res && res.status >= 200 && res.status < 300) {
      recordSuccess();
      if (!res.body) return null as T;
      try {
        return JSON.parse(res.body) as T;
      } catch {
        return res.body as unknown as T;
      }
    }

    // Classify the failure and decide whether to retry.
    const status = res?.status;
    const retryAfter = res?.retryAfter ?? null;
    lastErr = networkError
      ? new Error(`Portal ${method} ${apiPath} failed: ${networkError.message}`)
      : new Error(`Portal ${method} ${apiPath} failed: HTTP ${status} - ${(res?.body ?? "").slice(0, 300)}`);

    const transient = networkError !== null || (status !== undefined && isTransientStatus(status));
    // Writes retry only on a pre-response network error or explicit back-pressure (429/503).
    const writeRetryable = networkError !== null || status === 429 || status === 503;
    const shouldRetry = i < net.maxRetries && transient && (idempotent || writeRetryable);

    if (!shouldRetry) {
      recordFailure();
      throw lastErr;
    }

    recordFailure();
    const delay = backoffDelay(i, retryAfter);
    log(`transient failure (${status ?? networkError?.message}); retry ${i + 1}/${net.maxRetries} in ${delay}ms`);
    await sleep(delay);
  }

  // Exhausted retries.
  throw lastErr ?? new Error(`Portal ${method} ${apiPath} failed after ${net.maxRetries} retries`);
}
