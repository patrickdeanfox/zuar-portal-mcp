/**
 * redact.ts
 *
 * Output filtering for secrets. Portal reads can surface password hashes, tokens,
 * API keys and connection secrets (users, credentials, api_keys, datasources). On a
 * read path those should never flow into the model's context, so we deep-clone the
 * response and replace the VALUE of any sensitive-looking field with a placeholder.
 *
 * Scope notes:
 *   - Applied to READ responses (list/get). Create/update responses are returned
 *     as-is so a freshly generated secret can be seen exactly once by the operator.
 *   - Key-name based, conservative: only fields whose name clearly denotes a secret
 *     are redacted. `*_id` is never matched (so credentials_id, api_key_id survive).
 *   - Default ON; disable with PORTAL_REDACT_SECRETS=0 (e.g. to retrieve a stored key).
 */

const PLACEHOLDER = "[redacted]";
const MAX_DEPTH = 12; // guard against pathological/cyclic structures

// A field name (already lowercased) denotes a secret. `*_id` short-circuits first so
// identifier fields are never redacted.
function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k.endsWith("_id") || k === "id") return false;
  if (
    k === "password" ||
    k === "passwd" ||
    k === "pwd" ||
    k === "salt" ||
    k === "authorization"
  ) {
    return true;
  }
  // token / secret / api key / private key / credential, with common separators.
  return /(^|_)(password|passwd|secret|token|apikey|api_key|privatekey|private_key|credential|credentials|client_secret|access_key|refresh_token)(_|$)/.test(
    k
  );
}

function redactionEnabled(): boolean {
  const v = process.env.PORTAL_REDACT_SECRETS;
  if (v === undefined) return true; // default ON
  return !["0", "false", "no", "off"].includes(v.trim().toLowerCase());
}

function walk(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      // Redact the whole field (string, number, or nested object) — don't recurse in.
      out[k] = v === null || v === undefined ? v : PLACEHOLDER;
    } else {
      out[k] = walk(v, depth + 1);
    }
  }
  return out;
}

/**
 * Return a deep copy of `value` with secret-bearing fields masked. No-op (returns the
 * original reference) when redaction is disabled or the value isn't an object/array.
 */
export function redactSecrets<T>(value: T): T {
  if (!redactionEnabled() || value === null || typeof value !== "object") return value;
  return walk(value, 0) as T;
}
