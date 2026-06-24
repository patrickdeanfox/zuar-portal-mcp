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

// ── Logger (stderr only — stdout is reserved for MCP JSON-RPC framing) ────────
export function log(...args: unknown[]): void {
  if (DEBUG) console.error("[zuar-portal-mcp]", ...args);
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
function readConfigFile(): Partial<PortalConfig> {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    // dist/config.js -> look for config.json one level up (project root) and beside it
    const candidates = [
      path.join(dir, CONFIG_FILENAME),
      path.join(dir, "..", CONFIG_FILENAME),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return parsed.portal ?? parsed ?? {};
      }
    }
  } catch {
    /* fall through to empty */
  }
  return {};
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
