/**
 * website.ts
 *
 * SSRF-guarded homepage fetch + brand-color extraction for `design_intake`'s
 * "auto-suggest colors from your site" step. The URL is user-supplied, so this is
 * the one place the server makes an outbound request to an arbitrary host — it is
 * deliberately defensive:
 *   - http(s) only, no embedded credentials;
 *   - the host is DNS-resolved and REFUSED if any resolved address is private,
 *     loopback, link-local, CGNAT or otherwise reserved;
 *   - redirects are followed MANUALLY and every hop is re-validated (so a public
 *     URL can't bounce to an internal one);
 *   - the body is size-capped and the whole fetch is time-bounded.
 * It never throws — every failure path returns { ok:false, reason }.
 *
 * Residual risk: DNS rebinding between the lookup and the connect (TOCTOU) isn't
 * fully closed without a custom socket-level check; acceptable for a local,
 * single-operator tool. Disable the whole step with the tool's fetch_site=false.
 */

import dns from "node:dns/promises";
import { extractBrandColors, type BrandColors } from "./color.js";

export type HostClass = "public" | "blocked" | "invalid";

/** Classify a literal IPv4 string. Returns null if it isn't a valid IPv4. */
function ipv4Class(ip: string): HostClass | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => Number(p));
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  const [a, b] = n;
  if (a === 0) return "blocked"; // "this" network
  if (a === 10) return "blocked"; // private
  if (a === 127) return "blocked"; // loopback
  if (a === 169 && b === 254) return "blocked"; // link-local
  if (a === 172 && b >= 16 && b <= 31) return "blocked"; // private
  if (a === 192 && b === 168) return "blocked"; // private
  if (a === 100 && b >= 64 && b <= 127) return "blocked"; // CGNAT
  if (a >= 224) return "blocked"; // multicast / reserved
  return "public";
}

/** Classify a literal IPv6 string (basic), delegating IPv4-mapped forms. */
function ipv6Class(ip: string): HostClass | null {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!s.includes(":")) return null;
  if (s === "::1" || s === "::") return "blocked"; // loopback / unspecified
  if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return "blocked"; // link-local / ULA
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(s);
  if (mapped) return ipv4Class(mapped[1]) ?? "blocked";
  return "public";
}

/** Classify a literal IP address (v4 or v6); unknown shapes are treated as public. */
export function classifyAddress(ip: string): HostClass {
  return ipv4Class(ip) ?? ipv6Class(ip) ?? "public";
}

/**
 * Classify a hostname: obvious-local names are blocked outright; literal IPs are
 * classified directly; otherwise the name is DNS-resolved and blocked if ANY
 * resolved address is private/reserved.
 */
export async function classifyHost(hostname: string): Promise<HostClass> {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h) return "invalid";
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return "blocked";
  }
  const litv4 = ipv4Class(h);
  if (litv4) return litv4;
  if (h.includes(":")) return classifyAddress(h); // literal IPv6

  try {
    const addrs = await dns.lookup(h, { all: true });
    if (!addrs.length) return "invalid";
    for (const a of addrs) {
      if (classifyAddress(a.address) === "blocked") return "blocked";
    }
    return "public";
  } catch {
    return "invalid";
  }
}

export interface SiteColorsResult {
  ok: boolean;
  url: string; // the URL as given
  fetchedUrl?: string; // the final URL actually read (after redirects)
  brand?: BrandColors;
  reason?: string;
}

/** Read up to `maxBytes` of a Response body as UTF-8 (cancels the stream once capped). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(Buffer.from(value));
      total += value.length;
      if (total >= maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
    }
  }
  return Buffer.concat(chunks).slice(0, maxBytes).toString("utf8");
}

/**
 * Fetch a homepage (SSRF-guarded) and extract candidate brand colors. Best-effort:
 * returns { ok:false, reason } on any block, non-2xx, timeout or parse miss.
 */
export async function fetchSiteColors(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<SiteColorsResult> {
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 10_000;
  const maxBytes = opts.maxBytes && opts.maxBytes > 0 ? opts.maxBytes : 1_500_000;

  let candidate = (rawUrl ?? "").trim();
  if (!candidate) return { ok: false, url: rawUrl, reason: "No URL provided." };
  if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate; // default the scheme

  let current: URL;
  try {
    current = new URL(candidate);
  } catch {
    return { ok: false, url: rawUrl, reason: `Not a valid URL: ${rawUrl}` };
  }

  const MAX_HOPS = 4;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") {
      return { ok: false, url: rawUrl, reason: `Only http(s) is allowed (got ${current.protocol}).` };
    }
    if (current.username || current.password) {
      return { ok: false, url: rawUrl, reason: "URLs with embedded credentials are not allowed." };
    }
    const cls = await classifyHost(current.hostname);
    if (cls === "blocked") {
      return { ok: false, url: rawUrl, reason: `Refusing to fetch a private/loopback/link-local host (${current.hostname}).` };
    }
    if (cls === "invalid") {
      return { ok: false, url: rawUrl, reason: `Could not resolve host ${current.hostname}.` };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": "zuar-portal-mcp/design-intake", Accept: "text/html,*/*" },
      });
    } catch (e) {
      clearTimeout(timer);
      const err = e as Error;
      return {
        ok: false,
        url: rawUrl,
        reason: err?.name === "AbortError" ? `Timed out after ${timeoutMs}ms.` : err?.message ?? "network error",
      };
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, url: rawUrl, reason: `Redirect with no Location (HTTP ${res.status}).` };
      try {
        current = new URL(loc, current);
      } catch {
        return { ok: false, url: rawUrl, reason: `Bad redirect target: ${loc}` };
      }
      continue; // re-validate the new host on the next hop
    }

    if (!res.ok) {
      clearTimeout(timer);
      return { ok: false, url: rawUrl, fetchedUrl: current.toString(), reason: `Site returned HTTP ${res.status}.` };
    }

    const body = await readCapped(res, maxBytes);
    clearTimeout(timer);
    const brand = extractBrandColors(body);
    if (!brand.candidates.length && !brand.themeColor) {
      return { ok: false, url: rawUrl, fetchedUrl: current.toString(), reason: "No usable brand colors found on the page." };
    }
    return { ok: true, url: rawUrl, fetchedUrl: current.toString(), brand };
  }
  return { ok: false, url: rawUrl, reason: "Too many redirects." };
}
