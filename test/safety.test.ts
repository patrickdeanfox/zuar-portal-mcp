/**
 * safety.test.ts — unit tests for cross-record + operation safety.
 *
 * All functions under test are pure (the resolver is injected), so these run with
 * no network. They cover: referential reference-extraction, missing-ref detection,
 * pre-delete dependents, SQL write-blast detection, and admin/lockout protection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  referencesOf,
  findMissingRefs,
  dependentsOf,
  dependentsNeed,
  sqlWriteRisks,
  secretInName,
  adminMutationRisk,
} from "../src/safety.js";

// ── secretInName ──
test("secretInName flags a connection string with embedded password", () => {
  const r = secretInName("postgresql://root:s0secret@db/portal");
  assert.ok(r && /password/i.test(r));
});

test("secretInName flags a password=… connection string", () => {
  assert.ok(secretInName("host=db user=root password=hunter2"));
});

test("secretInName flags a bare connection URI used as a name", () => {
  assert.ok(secretInName("mysql://reporting@analytics.internal/warehouse"));
});

test("secretInName passes clean human names", () => {
  assert.equal(secretInName("DW · Dim Customer"), null);
  assert.equal(secretInName("CRM · Sales Bookings — Sample"), null);
  assert.equal(secretInName("Failed Logins"), null);
  assert.equal(secretInName(""), null);
  assert.equal(secretInName(undefined), null);
});

// ── referencesOf ──
test("referencesOf: layout grid.blocks -> block", () => {
  const specs = referencesOf("layout", { json_data: { grid: { blocks: ["b1", "b2"] } } });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].kind, "block");
  assert.deepEqual(specs[0].ids, ["b1", "b2"]);
});

test("referencesOf: partial json_data.blocks -> block", () => {
  const specs = referencesOf("partial", { json_data: { blocks: ["b1"] } });
  assert.equal(specs[0].kind, "block");
});

test("referencesOf: query datasources[].id -> datasource", () => {
  const specs = referencesOf("query", { datasources: [{ id: "ds1", alias: "datasource" }, { id: "ds2" }] });
  assert.equal(specs[0].kind, "datasource");
  assert.deepEqual(specs[0].ids, ["ds1", "ds2"]);
});

test("referencesOf: block ui_queries[].query_id -> query", () => {
  const specs = referencesOf("block", { ui_queries: [{ query_id: "q1", enabled: true }] });
  assert.equal(specs[0].kind, "query");
  assert.deepEqual(specs[0].ids, ["q1"]);
});

test("referencesOf: system default_dashboard/theme_id", () => {
  assert.equal(referencesOf("system", { name: "default_dashboard", value: "lay1" })[0].kind, "layout");
  assert.equal(referencesOf("system", { name: "theme_id", value: "th1" })[0].kind, "theme");
  assert.deepEqual(referencesOf("system", { name: "something_else", value: "x" }), []);
});

test("referencesOf: empty/absent refs yield no specs", () => {
  assert.deepEqual(referencesOf("layout", { json_data: { grid: { blocks: [] } } }), []);
  assert.deepEqual(referencesOf("layout", { name: "x" }), []);
});

// ── findMissingRefs ──
test("findMissingRefs flags ids the resolver doesn't know", async () => {
  const resolver = async (kind: string) => new Set(kind === "block" ? ["b1"] : []);
  const missing = await findMissingRefs([{ kind: "block", field: "f", ids: ["b1", "b2"] }], resolver);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, "b2");
});

test("findMissingRefs returns nothing when all refs exist", async () => {
  const resolver = async () => new Set(["b1", "b2"]);
  const missing = await findMissingRefs([{ kind: "block", field: "f", ids: ["b1", "b2"] }], resolver);
  assert.deepEqual(missing, []);
});

// ── dependentsOf ──
test("dependentsOf: a block used on a page and a partial", () => {
  const deps = dependentsOf("block", "b1", {
    layouts: [{ id: "L1", name: "Page A", json_data: { grid: { blocks: ["b1"] } } }, { id: "L2", json_data: { grid: { blocks: ["bX"] } } }],
    partials: [{ id: "P1", name: "header", json_data: { blocks: ["b1"] } }],
  });
  assert.equal(deps.length, 2);
  assert.ok(deps.some((d) => d.kind === "layout" && d.id === "L1"));
  assert.ok(deps.some((d) => d.kind === "partial" && d.id === "P1"));
});

test("dependentsOf: a datasource used by queries", () => {
  const deps = dependentsOf("datasource", "ds1", {
    queries: [{ id: "Q1", datasources: [{ id: "ds1" }] }, { id: "Q2", datasources: [{ id: "dsX" }] }],
  });
  assert.deepEqual(deps.map((d) => d.id), ["Q1"]);
});

test("dependentsOf: a query bound to blocks", () => {
  const deps = dependentsOf("query", "q1", {
    blocks: [{ id: "B1", ui_queries: [{ query_id: "q1" }] }, { id: "B2", ui_queries: [] }],
  });
  assert.deepEqual(deps.map((d) => d.id), ["B1"]);
});

test("dependentsOf: a layout that is the default dashboard", () => {
  const deps = dependentsOf("layout", "L1", { system: [{ name: "default_dashboard", value: "L1" }] });
  assert.equal(deps.length, 1);
  assert.equal(deps[0].via, "this is the portal default dashboard");
});

test("dependentsOf: nothing depends -> empty", () => {
  assert.deepEqual(dependentsOf("block", "ghost", { layouts: [], partials: [] }), []);
});

test("dependentsNeed maps kinds to the collections to fetch", () => {
  assert.deepEqual(dependentsNeed("block"), ["layouts", "partials"]);
  assert.deepEqual(dependentsNeed("datasource"), ["queries"]);
  assert.deepEqual(dependentsNeed("query"), ["blocks"]);
  assert.deepEqual(dependentsNeed("layout"), ["system"]);
  assert.deepEqual(dependentsNeed("user"), []);
});

// ── sqlWriteRisks ──
test("sqlWriteRisks: UPDATE without WHERE is flagged", () => {
  const risks = sqlWriteRisks("UPDATE orders SET status = 'x'");
  assert.equal(risks[0].kind, "no_where_update");
});

test("sqlWriteRisks: DELETE without WHERE is flagged", () => {
  const risks = sqlWriteRisks("DELETE FROM orders");
  assert.equal(risks[0].kind, "no_where_delete");
});

test("sqlWriteRisks: scoped UPDATE/DELETE are safe", () => {
  assert.deepEqual(sqlWriteRisks("UPDATE orders SET status='x' WHERE id = :id"), []);
  assert.deepEqual(sqlWriteRisks("DELETE FROM orders WHERE id = 1"), []);
});

test("sqlWriteRisks: TRUNCATE and DROP always flagged", () => {
  assert.equal(sqlWriteRisks("TRUNCATE TABLE orders")[0].kind, "truncate");
  assert.equal(sqlWriteRisks("DROP TABLE orders")[0].kind, "drop");
});

test("sqlWriteRisks: a WHERE inside a string literal does NOT count as scoped", () => {
  const risks = sqlWriteRisks("UPDATE t SET note = 'no where here'");
  assert.equal(risks[0].kind, "no_where_update", "literal 'where' must be stripped before keyword check");
});

test("sqlWriteRisks: multiple statements are each checked", () => {
  const risks = sqlWriteRisks("UPDATE a SET x=1 WHERE id=1; DELETE FROM b");
  assert.equal(risks.length, 1);
  assert.equal(risks[0].kind, "no_where_delete");
});

// ── adminMutationRisk ──
const USERS = [
  { id: "admin1", admin: true },
  { id: "admin2", admin: true },
  { id: "user1", admin: false },
];

test("adminMutationRisk: deleting your own account is refused", () => {
  const msg = adminMutationRisk("delete", "admin1", undefined, { users: USERS, selfUserId: "admin1" });
  assert.ok(msg && /own account/i.test(msg));
});

test("adminMutationRisk: deleting the last admin is refused", () => {
  const oneAdmin = [{ id: "admin1", admin: true }, { id: "user1", admin: false }];
  const msg = adminMutationRisk("delete", "admin1", undefined, { users: oneAdmin, selfUserId: "user1" });
  assert.ok(msg && /last admin/i.test(msg));
});

test("adminMutationRisk: deleting a non-last admin (not self) is allowed", () => {
  const msg = adminMutationRisk("delete", "admin2", undefined, { users: USERS, selfUserId: "admin1" });
  assert.equal(msg, null);
});

test("adminMutationRisk: demoting yourself is refused", () => {
  const msg = adminMutationRisk("update", "admin1", { admin: false }, { users: USERS, selfUserId: "admin1" });
  assert.ok(msg && /own account/i.test(msg));
});

test("adminMutationRisk: demoting the last admin is refused", () => {
  const oneAdmin = [{ id: "admin1", admin: true }, { id: "user1", admin: false }];
  const msg = adminMutationRisk("update", "admin1", { admin: false }, { users: oneAdmin, selfUserId: "user1" });
  assert.ok(msg && /last admin/i.test(msg));
});

test("adminMutationRisk: a normal profile update is allowed", () => {
  const msg = adminMutationRisk("update", "admin1", { fullname: "New Name" }, { users: USERS, selfUserId: "admin2" });
  assert.equal(msg, null);
});
