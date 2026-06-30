/**
 * resources.ts
 *
 * Declarative resource registry + generic CRUD handlers for the Zuar Portal
 * REST surface. One descriptor per resource drives the generic list/get/
 * create/update/delete tools, so adding a resource is a data change, not new
 * tool code. Blocks are intentionally NOT in this registry — they keep their
 * typed, validated tools in server.ts.
 *
 * Two portal services share the configured base URL:
 *   - main API under /api  (blocks, layouts, datasources, queries, ...)
 *   - auth service under /auth (users, groups, permissions, api_keys, ...)
 * The HTTP client takes a raw path, so a descriptor just spells out the full
 * path including its service segment.
 *
 * Portal PUTs are full-replace, so updateResource fetches the current record
 * and merges the caller's fields over it before writing (the same approach the
 * typed block tool uses). Verify per-endpoint if a portal version diverges.
 */

import { request } from "./portalClient.js";
import { blockReason, log, loadRefIntegrityMode, type WriteDomain } from "./config.js";
import { recordWrite, recordDelete } from "./portalVc.js";
import { redactSecrets } from "./redact.js";
import { normalizeAndValidateForWrite } from "./structure.js";
import { referencesOf, findMissingRefs, makeExistingIdResolver, type MissingRef } from "./safety.js";

// ── Types ─────────────────────────────────────────────────────────────────────
export type Verb = "list" | "get" | "create" | "update" | "delete";

export interface ResourceDescriptor {
  key: string; // stable id used in tool enums, e.g. "datasource"
  label: string; // human description for messages/describe_resource
  collectionPath: string; // full path incl. service segment, e.g. "/api/datasources"
  idLabel: string; // what the {id} path param represents ("id", "name", ...)
  domain: WriteDomain; // gates writes via config.blockReason
  riskFields?: string[]; // fields that actually carry the domain's risk. A metadata-only
  //                        update (touching none of these — e.g. a datasource RENAME) is
  //                        gated as "content", so it doesn't need the data/admin flag.
  writeFields: string[]; // fields copied into create/update bodies (everything else dropped)
  requiredCreate: string[]; // subset of writeFields that must be present to create
  verbs: Record<Verb, boolean>; // which generic tools this resource supports
  updateMethod: "PUT" | "PATCH"; // full-replace PUT (default) vs PATCH
  notes?: string; // surfaced by describe_resource
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
function enc(id: string): string {
  return encodeURIComponent(id);
}

function itemPath(desc: ResourceDescriptor, id: string): string {
  return `${desc.collectionPath}/${enc(id)}`;
}

// Copy only the descriptor's writeFields that are actually present (defined).
function pickWriteFields(
  desc: ResourceDescriptor,
  body: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of desc.writeFields) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  return out;
}

// Build the descriptor map and the verb-support helpers from a flat list.
function partialVerbs(v: Partial<Record<Verb, boolean>>): Record<Verb, boolean> {
  return {
    list: v.list ?? false,
    get: v.get ?? false,
    create: v.create ?? false,
    update: v.update ?? false,
    delete: v.delete ?? false,
  };
}

// Compact descriptor constructor so the table below stays readable.
function res(
  key: string,
  label: string,
  collectionPath: string,
  domain: WriteDomain,
  writeFields: string[],
  requiredCreate: string[],
  verbs: Partial<Record<Verb, boolean>>,
  opts: { idLabel?: string; updateMethod?: "PUT" | "PATCH"; notes?: string; riskFields?: string[] } = {}
): ResourceDescriptor {
  return {
    key,
    label,
    collectionPath,
    domain,
    riskFields: opts.riskFields,
    writeFields,
    requiredCreate,
    verbs: partialVerbs(verbs),
    idLabel: opts.idLabel ?? "id",
    updateMethod: opts.updateMethod ?? "PUT",
    notes: opts.notes,
  };
}

// A write that touches only metadata (e.g. name/tags) on a data/admin resource
// carries none of that domain's risk — a datasource RENAME changes no SQL. When a
// descriptor declares riskFields, an update whose patch touches none of them is
// gated as "content", so renames/retags don't require PORTAL_ALLOW_DATA_WRITES.
export function effectiveUpdateDomain(
  desc: ResourceDescriptor,
  patch: Record<string, unknown>
): WriteDomain {
  if (desc.domain === "content" || !desc.riskFields) return desc.domain;
  const touchesRisk = Object.keys(patch).some((k) => desc.riskFields!.includes(k));
  return touchesRisk ? desc.domain : "content";
}

const FULL: Partial<Record<Verb, boolean>> = {
  list: true,
  get: true,
  create: true,
  update: true,
  delete: true,
};

// ── The registry ──────────────────────────────────────────────────────────────
// Field lists are taken from the portal OpenAPI specs (create/update request
// bodies). Blocks are handled by dedicated typed tools and are absent here.
export const DESCRIPTORS: ResourceDescriptor[] = [
  // ── Content (low-risk; writes on by default) ──
  res(
    "layout",
    "Page / layout. json_data.grid holds block placement on the page.",
    "/api/layouts",
    "content",
    ["name", "user_id", "order", "icon", "json_data", "tags", "access"],
    ["name"],
    FULL,
    { notes: "A layout is a page. Update merges over the existing grid; read it first with get." }
  ),
  res(
    "partial",
    "Reusable partial (shared markup/config fragment).",
    "/api/partials",
    "content",
    ["name", "json_data"],
    ["name"],
    FULL
  ),
  res(
    "theme",
    "Portal theme (colors, fonts, tokens in json_data).",
    "/api/themes",
    "content",
    ["name", "user_id", "json_data", "access"],
    ["name"],
    FULL
  ),
  res(
    "query",
    "Saved query (Portal 1.18+). Execute via the execute_query tool, not update.",
    "/api/queries",
    "content",
    ["name", "datasources", "default_params", "raw_sql", "sql_form"],
    [],
    FULL,
    { notes: "raw_sql + datasources define the query. Use execute_query to run it." }
  ),
  res(
    "snippet",
    "JavaScript snippet injected into the portal.",
    "/api/snippets",
    "content",
    ["name", "snippet"],
    ["name", "snippet"],
    FULL
  ),
  res(
    "translation",
    "Localization entry.",
    "/api/translations",
    "content",
    ["code", "name", "json_data"],
    ["code", "name"],
    FULL
  ),
  res(
    "dashboard",
    "Embedded dashboard reference (external BI URL).",
    "/api/dashboards",
    "content",
    ["name", "url", "order", "icon"],
    ["name", "url"],
    FULL
  ),
  res(
    "tag",
    "Content tag. Deleted by name, not id.",
    "/api/tags",
    "content",
    ["name"],
    ["name"],
    { list: true, create: true, delete: true },
    { idLabel: "name", notes: "No get/update; delete uses the tag name as the path id." }
  ),

  // ── Data (SQL-bearing; needs PORTAL_ALLOW_DATA_WRITES) ──
  res(
    "datasource",
    "Data source (SQL + connection). Preview rows with fetch_sample_rows.",
    "/api/datasources",
    "data",
    ["name", "sql", "json_data", "tags", "default_params", "database_connection"],
    ["name"],
    FULL,
    {
      riskFields: ["sql", "json_data", "default_params", "database_connection"],
      notes: "Creating/updating SQL is a data-domain write; a name/tags-only change is treated as content (no data flag needed).",
    }
  ),
  res(
    "db_modification",
    "Saved DB write (INSERT/UPDATE/DELETE). Execute via run_db_modification.",
    "/api/db_modifications",
    "data",
    ["name", "sql", "credentials_id", "default_params", "access"],
    ["name", "sql"],
    FULL,
    {
      riskFields: ["sql", "credentials_id", "default_params", "access"],
      notes: "get accepts id OR name. Running it is a separate, gated tool. A name-only change is treated as content.",
    }
  ),

  // ── Admin (users/security/config; needs PORTAL_ALLOW_ADMIN_WRITES) ──
  res(
    "user",
    "Portal user. Password changes go through change_password.",
    "/auth/users",
    "admin",
    ["username", "fullname", "password", "email", "admin", "source"],
    ["username", "fullname", "password"],
    FULL,
    { notes: "Create requires username+fullname+password. Manage membership with set_user_groups/set_user_permissions." }
  ),
  res(
    "group",
    "User group.",
    "/auth/groups",
    "admin",
    ["name", "source"],
    ["name"],
    FULL
  ),
  res(
    "permission",
    "Named permission.",
    "/auth/permissions",
    "admin",
    ["name", "alias"],
    ["name"],
    FULL
  ),
  res(
    "access_policy",
    "Access policy rule. Body uses a nested `data` object.",
    "/auth/access_policies",
    "admin",
    ["data"],
    ["data"],
    FULL,
    { notes: "Create/update body = { data: { project*, subject, resource, action, access_decision, ... } }." }
  ),
  res(
    "api_key",
    "API key. Create body uses a nested `data` object; no update.",
    "/auth/api_keys",
    "admin",
    ["data"],
    ["data"],
    { list: true, create: true, delete: true },
    { notes: "Create body = { data: { user_id*, name } }. No get/update; delete by id." }
  ),
  res(
    "credential",
    "Named credential (connection secret). No item get.",
    "/api/credentials",
    "admin",
    ["type", "data", "name", "tags"],
    ["type", "data", "name"],
    { list: true, create: true, update: true, delete: true },
    { notes: "List credential types via the credentials API in the portal UI; secrets are write-only." }
  ),
  res(
    "system",
    "System key/value record.",
    "/api/system",
    "admin",
    ["name", "value"],
    ["name", "value"],
    FULL
  ),
];

const BY_KEY = new Map(DESCRIPTORS.map((d) => [d.key, d]));

export const RESOURCE_KEYS = DESCRIPTORS.map((d) => d.key) as [string, ...string[]];

export function getDescriptor(key: string): ResourceDescriptor | undefined {
  return BY_KEY.get(key);
}

// Plain-data view for describe_resource.
export function describeResource(desc: ResourceDescriptor): Record<string, unknown> {
  const verbs = (Object.keys(desc.verbs) as Verb[]).filter((v) => desc.verbs[v]);
  return {
    resource: desc.key,
    label: desc.label,
    path: desc.collectionPath,
    domain: desc.domain,
    id_param: desc.idLabel,
    supported_verbs: verbs,
    create_fields: desc.writeFields,
    required_to_create: desc.requiredCreate,
    update_method: desc.updateMethod,
    notes: desc.notes ?? null,
  };
}

// ── Errors that map to clean tool failures (not stack traces) ────────────────
export class ResourceError extends Error {}

function ensureVerb(desc: ResourceDescriptor, verb: Verb): void {
  if (!desc.verbs[verb]) {
    const supported = (Object.keys(desc.verbs) as Verb[])
      .filter((v) => desc.verbs[v])
      .join(", ");
    throw new ResourceError(
      `Resource "${desc.key}" does not support "${verb}". Supported: ${supported || "none"}.`
    );
  }
}

// Hard structural gate: normalise safe defaults and refuse a write whose shape
// would break the portal renderer. Runs on the FINAL body (post field-pick, and
// for PUT post-merge) so it reflects exactly what lands in the DB. This is the
// last line of defence and cannot be bypassed by any tool or agent — every
// create/update path funnels through here.
function gateStructure(
  desc: ResourceDescriptor,
  verb: "create" | "update",
  body: Record<string, unknown>
): Record<string, unknown> {
  const { body: normalized, repairs, errors } = normalizeAndValidateForWrite(desc.key, body);
  if (errors.length > 0) {
    throw new ResourceError(
      `Refusing to ${verb} ${desc.key}: structurally incompatible with the portal and would break it.\n- ` +
        errors.join("\n- ")
    );
  }
  if (repairs.length > 0) {
    log(`[structure] auto-repaired ${desc.key} on ${verb}: ${repairs.join("; ")}`);
  }
  return normalized;
}

// Referential-integrity gate: refuse (or warn on) a write that points at records
// which don't exist. Checks only the CALLER-PROVIDED body, so editing a record
// that already had a dangling ref doesn't get blocked for an unrelated change.
async function gateReferences(desc: ResourceDescriptor, body: Record<string, unknown>): Promise<void> {
  const mode = loadRefIntegrityMode();
  if (mode === "off") return;
  const specs = referencesOf(desc.key, body);
  if (specs.length === 0) return;
  let missing: MissingRef[];
  try {
    missing = await findMissingRefs(specs, makeExistingIdResolver());
  } catch (e) {
    // A lookup failure must not silently pass a bad write nor hard-fail a good one:
    // log and continue (the structural gate + portal still apply).
    log(`[refs] lookup failed for ${desc.key}; skipping referential check: ${(e as Error).message}`);
    return;
  }
  if (missing.length === 0) return;
  const detail = missing.map((m) => `${m.field} -> ${m.kind} ${m.id} (not found)`).join("\n- ");
  if (mode === "warn") {
    log(`[refs] ${desc.key} references missing records (allowed by PORTAL_REF_INTEGRITY=warn):\n- ${detail}`);
    return;
  }
  throw new ResourceError(
    `Refusing to write ${desc.key}: it references record(s) that do not exist, which would render broken.\n- ` +
      detail +
      `\nCreate the referenced record first, fix the id, or set PORTAL_REF_INTEGRITY=warn to allow it.`
  );
}

// Turn a portal 404 on a collection into a capability hint instead of a raw error.
function rethrowFriendly(desc: ResourceDescriptor, e: unknown): never {
  const msg = (e as Error).message ?? String(e);
  if (msg.includes("HTTP 404")) {
    throw new ResourceError(
      `No endpoint for "${desc.key}" at ${desc.collectionPath} — this portal version may not ` +
        `expose it, or the path differs. Check get_version / the portal's Swagger.`
    );
  }
  throw new ResourceError(msg);
}

// ── Generic handlers (server wraps these in ok()/fail()) ─────────────────────
export async function listResource(
  desc: ResourceDescriptor,
  query?: Record<string, unknown>
): Promise<unknown> {
  ensureVerb(desc, "list");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, String(item)));
    else qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    // Read path: mask secret-bearing fields before they reach the client/model.
    return redactSecrets(await request("GET", `${desc.collectionPath}${suffix}`));
  } catch (e) {
    rethrowFriendly(desc, e);
  }
}

export async function getResource(desc: ResourceDescriptor, id: string): Promise<unknown> {
  ensureVerb(desc, "get");
  try {
    return redactSecrets(await request("GET", itemPath(desc, id)));
  } catch (e) {
    rethrowFriendly(desc, e);
  }
}

// Which resources are mirrored to version control: all CONTENT resources plus
// datasources (the data model — SQL + tags, no raw secrets). Admin resources
// (users/groups/credentials) are deliberately excluded — they can carry secrets.
function mirrorsToVc(desc: ResourceDescriptor): boolean {
  return desc.domain === "content" || desc.key === "datasource";
}

export async function createResource(
  desc: ResourceDescriptor,
  body: Record<string, unknown>
): Promise<unknown> {
  ensureVerb(desc, "create");
  const reason = blockReason(desc.domain);
  if (reason) throw new ResourceError(reason);

  const picked = pickWriteFields(desc, body);
  const missing = desc.requiredCreate.filter((f) => picked[f] === undefined);
  if (missing.length > 0) {
    throw new ResourceError(
      `Cannot create ${desc.key}: missing required field(s) ${missing.join(", ")}. ` +
        `Run describe_resource for the full field list.`
    );
  }
  const payload = gateStructure(desc, "create", picked);
  await gateReferences(desc, payload);
  try {
    const out = await request("POST", desc.collectionPath, payload);
    if (mirrorsToVc(desc)) {
      const rec = out as Record<string, unknown> | null;
      recordWrite(desc.key, rec?.[desc.idLabel] ?? rec?.id, "create", out);
    }
    return out;
  } catch (e) {
    rethrowFriendly(desc, e);
  }
}

export async function updateResource(
  desc: ResourceDescriptor,
  id: string,
  body: Record<string, unknown>
): Promise<unknown> {
  ensureVerb(desc, "update");
  const patch = pickWriteFields(desc, body);
  if (Object.keys(patch).length === 0) {
    throw new ResourceError(
      `No updatable fields provided for ${desc.key}. Allowed: ${desc.writeFields.join(", ")}.`
    );
  }
  // Gate on the EFFECTIVE domain: a metadata-only change (e.g. name/tags) to a
  // data/admin resource is content-risk, so a rename doesn't need the data/admin flag.
  const reason = blockReason(effectiveUpdateDomain(desc, patch));
  if (reason) throw new ResourceError(reason);
  // Referential check on the caller's patch (not the merged record) so an unrelated
  // edit to a record with a pre-existing dangling ref isn't blocked.
  await gateReferences(desc, patch);
  try {
    // Full-replace PUT: merge the patch over the current record so untouched
    // fields aren't nulled. PATCH endpoints accept the partial directly.
    let merged = patch;
    if (desc.updateMethod === "PUT") {
      const existing = (await request<Record<string, unknown>>("GET", itemPath(desc, id))) ?? {};
      merged = { ...pickWriteFields(desc, existing), ...patch };
    }
    // Final structural check on exactly what will be written.
    merged = gateStructure(desc, "update", merged);
    const out = await request(desc.updateMethod, itemPath(desc, id), merged);
    if (mirrorsToVc(desc)) recordWrite(desc.key, id, "update", out);
    return out;
  } catch (e) {
    rethrowFriendly(desc, e);
  }
}

export async function deleteResource(desc: ResourceDescriptor, id: string): Promise<unknown> {
  ensureVerb(desc, "delete");
  const reason = blockReason(desc.domain);
  if (reason) throw new ResourceError(reason);
  try {
    const r = await request("DELETE", itemPath(desc, id));
    if (mirrorsToVc(desc)) recordDelete(desc.key, id);
    return r ?? { deleted: id, resource: desc.key };
  } catch (e) {
    rethrowFriendly(desc, e);
  }
}
