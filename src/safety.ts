/**
 * safety.ts
 *
 * Cross-record + operation safety checks — the "is this operation safe given the
 * REST of the portal?" layer, complementing structure.ts (which asks "does this
 * one record's shape fit?"). Three concerns live here:
 *
 *   1. Referential integrity — a write must not point at records that don't exist
 *      (a layout referencing a deleted block, a query a deleted datasource, a
 *      block a deleted query). A dangling reference renders blank/broken.
 *   2. Pre-delete impact — a delete must surface who DEPENDS on the target so a
 *      destructive action is never taken blind (delete a block that's on 3 pages,
 *      a datasource 6 queries use, the layout that is the default dashboard).
 *   3. Write-blast guards — SQL that mutates a DB with no WHERE (mass update/
 *      delete, truncate, drop), and admin mutations that would remove the last
 *      admin or lock the operator out of their own account.
 *
 * The pure functions take plain data so they are trivially unit-testable; the one
 * impure helper (makeExistingIdResolver) wraps the HTTP client to answer "which
 * ids of kind K currently exist?", cached per call.
 */

import { request } from "./portalClient.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(res: unknown): unknown[] {
  if (Array.isArray(res)) return res;
  if (isPlainObject(res)) {
    for (const k of ["result", "items", "data", "results", "records"]) {
      if (Array.isArray(res[k])) return res[k] as unknown[];
    }
  }
  return [];
}

function recId(rec: unknown): string | null {
  if (!isPlainObject(rec)) return null;
  const id = rec.id ?? rec.name;
  return typeof id === "string" ? id : null;
}

function recName(rec: unknown): string | null {
  if (!isPlainObject(rec)) return null;
  return typeof rec.name === "string" ? rec.name : null;
}

function strs(arr: unknown): string[] {
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
}

// ── 1. Referential integrity ──────────────────────────────────────────────────

export interface RefSpec {
  kind: string; // referenced resource kind: "block" | "datasource" | "query" | "layout" | "theme"
  field: string; // where in the body the reference lives (for the error message)
  ids: string[]; // referenced ids
}

export interface MissingRef {
  kind: string;
  field: string;
  id: string;
}

/**
 * Enumerate the cross-record references a CALLER-PROVIDED body makes. Operates on
 * the body the caller passed (never the merged record) so an unrelated edit to a
 * record that already had a dangling ref isn't penalised.
 */
export function referencesOf(resourceKey: string, body: Record<string, unknown>): RefSpec[] {
  const specs: RefSpec[] = [];
  const jd = isPlainObject(body.json_data) ? (body.json_data as Record<string, unknown>) : null;

  if (resourceKey === "layout" && jd && isPlainObject(jd.grid)) {
    const ids = strs((jd.grid as Record<string, unknown>).blocks);
    if (ids.length) specs.push({ kind: "block", field: "json_data.grid.blocks", ids });
  }
  if (resourceKey === "partial" && jd) {
    const ids = strs(jd.blocks);
    if (ids.length) specs.push({ kind: "block", field: "json_data.blocks", ids });
  }
  if (resourceKey === "query" && Array.isArray(body.datasources)) {
    const ids = body.datasources
      .map((d) => (isPlainObject(d) ? (typeof d.id === "string" ? d.id : null) : null))
      .filter((x): x is string => x !== null);
    if (ids.length) specs.push({ kind: "datasource", field: "datasources", ids });
  }
  if (resourceKey === "block" && Array.isArray(body.ui_queries)) {
    const ids = body.ui_queries
      .map((q) => (isPlainObject(q) ? (typeof q.query_id === "string" ? q.query_id : null) : null))
      .filter((x): x is string => x !== null);
    if (ids.length) specs.push({ kind: "query", field: "ui_queries[].query_id", ids });
  }
  if (resourceKey === "system" && typeof body.name === "string" && typeof body.value === "string") {
    if (body.name === "default_dashboard") specs.push({ kind: "layout", field: "value", ids: [body.value] });
    if (body.name === "theme_id") specs.push({ kind: "theme", field: "value", ids: [body.value] });
  }
  return specs;
}

/** Resolve specs against existing ids; return the references that don't exist. */
export async function findMissingRefs(
  specs: RefSpec[],
  resolver: (kind: string) => Promise<Set<string>>
): Promise<MissingRef[]> {
  const missing: MissingRef[] = [];
  for (const spec of specs) {
    const existing = await resolver(spec.kind);
    for (const id of new Set(spec.ids)) {
      if (!existing.has(id)) missing.push({ kind: spec.kind, field: spec.field, id });
    }
  }
  return missing;
}

// Map a referenced kind to its portal list endpoint (read-only).
const KIND_PATHS: Record<string, string> = {
  block: "/api/blocks",
  datasource: "/api/datasources",
  query: "/api/queries",
  layout: "/api/layouts",
  theme: "/api/themes",
};

/**
 * A per-call resolver answering "which ids of kind K exist?", fetching each
 * collection at most once and caching it for the life of the closure.
 */
export function makeExistingIdResolver(): (kind: string) => Promise<Set<string>> {
  const cache = new Map<string, Set<string>>();
  return async (kind: string): Promise<Set<string>> => {
    const hit = cache.get(kind);
    if (hit) return hit;
    const path = KIND_PATHS[kind];
    if (!path) {
      const empty = new Set<string>();
      cache.set(kind, empty);
      return empty;
    }
    const res = await request("GET", path);
    const ids = new Set<string>();
    for (const rec of asArray(res)) {
      const id = recId(rec);
      if (id) ids.add(id);
    }
    cache.set(kind, ids);
    return ids;
  };
}

// ── 2. Pre-delete impact (dependents) ─────────────────────────────────────────

export interface Dependent {
  kind: string; // the dependent record's kind
  id: string | null;
  name: string | null;
  via: string; // how it depends on the target
}

export interface DependentsCtx {
  layouts?: unknown[];
  partials?: unknown[];
  queries?: unknown[];
  blocks?: unknown[];
  system?: unknown[];
}

/**
 * Who depends on the record about to be deleted? Pure — the caller fetches only
 * the collections relevant to `targetKind` and passes them in.
 */
export function dependentsOf(targetKind: string, targetId: string, ctx: DependentsCtx): Dependent[] {
  const deps: Dependent[] = [];

  if (targetKind === "block") {
    for (const lay of ctx.layouts ?? []) {
      const grid = isPlainObject(lay) && isPlainObject(lay.json_data) ? (lay.json_data as any).grid : null;
      if (isPlainObject(grid) && strs(grid.blocks).includes(targetId)) {
        deps.push({ kind: "layout", id: recId(lay), name: recName(lay), via: "page places this block" });
      }
    }
    for (const par of ctx.partials ?? []) {
      const jd = isPlainObject(par) ? (par as any).json_data : null;
      if (isPlainObject(jd) && strs(jd.blocks).includes(targetId)) {
        deps.push({ kind: "partial", id: recId(par), name: recName(par), via: "partial places this block" });
      }
    }
  }

  if (targetKind === "datasource") {
    for (const q of ctx.queries ?? []) {
      const dss = isPlainObject(q) ? (q as any).datasources : null;
      const ids = Array.isArray(dss)
        ? dss.map((d) => (isPlainObject(d) && typeof d.id === "string" ? d.id : null))
        : [];
      if (ids.includes(targetId)) {
        deps.push({ kind: "query", id: recId(q), name: recName(q), via: "query reads this datasource" });
      }
    }
  }

  if (targetKind === "query") {
    for (const b of ctx.blocks ?? []) {
      const uq = isPlainObject(b) ? (b as any).ui_queries : null;
      const ids = Array.isArray(uq)
        ? uq.map((q) => (isPlainObject(q) && typeof q.query_id === "string" ? q.query_id : null))
        : [];
      if (ids.includes(targetId)) {
        deps.push({ kind: "block", id: recId(b), name: recName(b), via: "block is bound to this query" });
      }
    }
  }

  if (targetKind === "layout") {
    for (const s of ctx.system ?? []) {
      if (isPlainObject(s) && s.name === "default_dashboard" && s.value === targetId) {
        deps.push({ kind: "system", id: "default_dashboard", name: "default_dashboard", via: "this is the portal default dashboard" });
      }
    }
  }

  if (targetKind === "theme") {
    for (const s of ctx.system ?? []) {
      if (isPlainObject(s) && s.name === "theme_id" && s.value === targetId) {
        deps.push({ kind: "system", id: "theme_id", name: "theme_id", via: "this is the portal's active theme" });
      }
    }
  }

  return deps;
}

// Which collections does a delete of `kind` need in order to compute dependents?
export function dependentsNeed(targetKind: string): Array<keyof DependentsCtx> {
  switch (targetKind) {
    case "block":
      return ["layouts", "partials"];
    case "datasource":
      return ["queries"];
    case "query":
      return ["blocks"];
    case "layout":
    case "theme":
      return ["system"];
    default:
      return [];
  }
}

// ── 3a. SQL write-blast safety ────────────────────────────────────────────────

export interface SqlRisk {
  kind: "no_where_update" | "no_where_delete" | "truncate" | "drop";
  statement: string;
}

// Strip line/block comments and string/identifier literals so keyword detection
// doesn't trip on a WHERE inside a quoted string or a comment.
function stripSqlNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
}

/**
 * Detect unscoped, high-blast SQL writes. Heuristic (not a full parser): an
 * UPDATE or DELETE statement with no WHERE token anywhere in it is treated as
 * unscoped; TRUNCATE/DROP are always flagged. Parameterised statements are fine —
 * a WHERE with a placeholder still counts as scoped.
 */
export function sqlWriteRisks(sql: string): SqlRisk[] {
  if (typeof sql !== "string" || !sql.trim()) return [];
  const risks: SqlRisk[] = [];
  const statements = stripSqlNoise(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const st of statements) {
    const hasWhere = /\bwhere\b/i.test(st);
    if (/^\s*update\b/i.test(st) && !hasWhere) risks.push({ kind: "no_where_update", statement: st.slice(0, 200) });
    else if (/^\s*delete\s+from\b/i.test(st) && !hasWhere) risks.push({ kind: "no_where_delete", statement: st.slice(0, 200) });
    if (/\btruncate\b/i.test(st)) risks.push({ kind: "truncate", statement: st.slice(0, 200) });
    if (/\bdrop\s+(table|database|schema|view|index)\b/i.test(st)) risks.push({ kind: "drop", statement: st.slice(0, 200) });
  }
  return risks;
}

export function describeSqlRisk(r: SqlRisk): string {
  switch (r.kind) {
    case "no_where_update":
      return "UPDATE with no WHERE — rewrites EVERY row";
    case "no_where_delete":
      return "DELETE with no WHERE — removes EVERY row";
    case "truncate":
      return "TRUNCATE — empties the table";
    case "drop":
      return "DROP — destroys the object";
  }
}

// ── 3b. Admin / lockout safety ────────────────────────────────────────────────

export interface AdminCtx {
  users: unknown[]; // every user record ({ id, admin })
  selfUserId: string; // the authenticated user's id
}

function isAdmin(u: unknown): boolean {
  return isPlainObject(u) && (u.admin === true || u.is_admin === true);
}

/**
 * Returns a refusal message if a user mutation would (a) remove/demote the LAST
 * admin, or (b) delete or de-admin the operator's OWN account — else null.
 * `verb` is "delete" or "update"; for update, `body` may carry admin:false.
 */
export function adminMutationRisk(
  verb: "delete" | "update",
  targetUserId: string,
  body: Record<string, unknown> | undefined,
  ctx: AdminCtx
): string | null {
  const admins = ctx.users.filter(isAdmin);
  const target = ctx.users.find((u) => recId(u) === targetUserId);
  const targetIsAdmin = target ? isAdmin(target) : false;
  const isSelf = targetUserId === ctx.selfUserId;

  if (verb === "delete") {
    if (isSelf) return "Refusing to delete your OWN account — you would lose access. Use a different admin to do this.";
    if (targetIsAdmin && admins.length <= 1) {
      return "Refusing to delete the LAST admin — the portal would be left with no administrator.";
    }
  }

  if (verb === "update") {
    const demoting = body !== undefined && body.admin === false;
    if (demoting && targetIsAdmin) {
      if (isSelf) return "Refusing to remove admin from your OWN account — you would lose admin access.";
      if (admins.length <= 1) return "Refusing to demote the LAST admin — the portal would be left with no administrator.";
    }
  }

  return null;
}
