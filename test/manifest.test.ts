/**
 * manifest.test.ts — versioning/compatibility guard.
 *
 * The MCPB manifest advertises the tool surface to clients; it must not drift from
 * what the server actually registers. This test fails if a tool is added/removed
 * without updating manifest.json, and checks the manifest version tracks package.json.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { connect, toolNames } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

test("manifest tool list exactly matches the registered tool surface", async () => {
  const { client, close } = await connect();
  try {
    const live = new Set(await toolNames(client));
    const declared = new Set<string>((manifest.tools ?? []).map((t: { name: string }) => t.name));

    const missingFromManifest = [...live].filter((n) => !declared.has(n)).sort();
    const notRegistered = [...declared].filter((n) => !live.has(n)).sort();

    assert.deepEqual(missingFromManifest, [], `tools registered but missing from manifest.json: ${missingFromManifest.join(", ")}`);
    assert.deepEqual(notRegistered, [], `tools in manifest.json that are not registered: ${notRegistered.join(", ")}`);
  } finally {
    await close();
  }
});

test("manifest version tracks package.json version", () => {
  assert.equal(manifest.version, pkg.version, "bump manifest.json and package.json together");
});

test("every manifest tool entry has a non-empty description", () => {
  for (const t of manifest.tools ?? []) {
    assert.ok(t.name && t.description && t.description.length > 0, `manifest tool ${t.name} needs a description`);
  }
});
