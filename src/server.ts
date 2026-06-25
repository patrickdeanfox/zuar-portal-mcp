/**
 * server.ts
 *
 * Builds the Zuar Portal MCP server.
 *
 * Tool surface (production layout):
 *   - Typed block tools (validated authoring): list/get/create/update/delete_block.
 *   - Generic resource tools over a declarative registry (resources.ts):
 *     list/get/create/update/delete_resource + describe_resource. These cover
 *     layouts, datasources, queries, db_modifications, partials, themes, users,
 *     groups, permissions, access_policies, api_keys, credentials, snippets,
 *     translations, dashboards, tags, system.
 *   - Action tools for non-CRUD operations: fetch_sample_rows, execute_query,
 *     run_db_modification, change_password, user group/permission assignment,
 *     get/update_me, get/update_config, get_version.
 *
 * Write safety: every write is tagged with a risk domain (content/data/admin)
 * and gated by config.blockReason. Content writes are on by default; data and
 * admin writes are opt-in via env flags.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request } from "./portalClient.js";
import { blockReason } from "./config.js";
import { GUIDES } from "./guidance.js";
import { getRules, validateBlock, type ValidationResult } from "./rules.js";
import {
  DESCRIPTORS,
  RESOURCE_KEYS,
  getDescriptor,
  describeResource,
  listResource,
  getResource,
  createResource,
  updateResource,
  deleteResource,
} from "./resources.js";

// ── Top-level config ────────────────────────────────────────────────────────
const SERVER_NAME = "zuar-portal-mcp-server";
const SERVER_VERSION = "2.0.0";
const ONLY_BLOCK_TYPE = "html";
const SAMPLE_ROW_LIMIT_DEFAULT = 5;
const SAMPLE_ROW_LIMIT_MAX = 50;
const BLOCK_DOMAIN = "content" as const; // block writes are content-risk

// ── Pure helpers ──────────────────────────────────────────────────────────────
type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  const structured =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : { result: payload };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: structured,
  };
}

function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Convert a {name: value} map to the portal's [{name, value}] SQLParameter list.
function toSqlParams(
  params?: Record<string, unknown>
): { name: string; value: unknown }[] | undefined {
  if (!params) return undefined;
  return Object.entries(params).map(([name, value]) => ({ name, value }));
}

// Build an /api/blocks body from validated args, forcing html type.
// The portal requires `css` to be a list; a raw string is wrapped into one.
function buildBlockBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { type: ONLY_BLOCK_TYPE };
  for (const key of ["name", "data", "css", "json_data", "tags", "access"] as const) {
    if (args[key] !== undefined) body[key] = args[key];
  }
  if (typeof body.css === "string") body.css = [body.css];
  return body;
}

// Format a hard-reject message listing the rule violations (errors first).
function formatViolations(v: ValidationResult): string {
  const lines = ["Block rejected by authoring rules:"];
  for (const e of v.errors) lines.push(`  ERROR  ${e}`);
  for (const w of v.warnings) lines.push(`  warn   ${w}`);
  lines.push('Fix the ERROR items, or set their severity to "warn"/"off" in rules.json.');
  return lines.join("\n");
}

// Attach non-blocking warnings to a successful tool payload.
function withWarnings(payload: unknown, warnings: string[]): unknown {
  if (warnings.length === 0) return payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>), _warnings: warnings };
  }
  return { result: payload, _warnings: warnings };
}

// ── Shared zod fragments ──────────────────────────────────────────────────────
const htmlType = z
  .literal(ONLY_BLOCK_TYPE)
  .default(ONLY_BLOCK_TYPE)
  .describe(`Block type. This server only handles HTML blocks, so it must be "${ONLY_BLOCK_TYPE}".`);

const blockPayloadShape = {
  name: z.string().min(1).describe("Display name of the block."),
  type: htmlType,
  data: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      'Query config object, e.g. { "__source__": "<datasource-uuid>", "columns": ["*"], "limit": 500 }.'
    ),
  css: z
    .union([z.string(), z.array(z.any())])
    .optional()
    .describe("Block CSS. Array form per the portal API; a raw CSS string is also accepted."),
  json_data: z.record(z.string(), z.any()).optional().describe("Widget/extra config object."),
  tags: z.array(z.string()).optional().describe("Tag names to attach."),
  access: z
    .record(z.string(), z.any())
    .optional()
    .describe('Access control, e.g. { "groups": ["group-name"] }.'),
};

const resourceEnum = z
  .enum(RESOURCE_KEYS)
  .describe("Resource type. Call describe_resource for fields and supported verbs.");

// ── Server construction ───────────────────────────────────────────────────────
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerBlockTools(server);
  registerResourceTools(server);
  registerActionTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

// ── Block tools (typed + validated) ───────────────────────────────────────────
function registerBlockTools(server: McpServer): void {
  // list_blocks
  server.registerTool(
    "list_blocks",
    {
      title: "List portal blocks",
      description:
        "List blocks on the portal. Optionally restrict to specific block IDs, or return names only.",
      inputSchema: {
        block_ids: z.array(z.string()).optional().describe("Filter to these block UUIDs."),
        only_names: z.boolean().optional().describe("Return only id+name pairs."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const qs = new URLSearchParams();
        (args.block_ids ?? []).forEach((id) => qs.append("block_ids[]", id));
        if (args.only_names) qs.set("only_names", "true");
        const suffix = qs.toString() ? `?${qs.toString()}` : "";
        return ok(await request("GET", `/api/blocks${suffix}`));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // get_block
  server.registerTool(
    "get_block",
    {
      title: "Get a block",
      description: "Fetch a single block by UUID, including its HTML/CSS and query config.",
      inputSchema: { block_id: z.string().min(1).describe("Block UUID.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(await request("GET", `/api/blocks/${encodeURIComponent(args.block_id)}`));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // create_block
  server.registerTool(
    "create_block",
    {
      title: "Create an HTML block",
      description:
        "Create a new HTML block. Accepts the full block payload (name, data, css, json_data, " +
        "tags, access). Type is always html. Read the zportal://guide/* resources first to " +
        "produce a correct two-field block.",
      inputSchema: blockPayloadShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason(BLOCK_DOMAIN);
        if (reason) return fail(reason);
        const body = buildBlockBody(args);
        // Portal scopeCss crashes on a null css; never create a block without a css list.
        if (body.css === undefined) body.css = [];
        const v = validateBlock(body);
        if (v.errors.length > 0) return fail(formatViolations(v));
        const res = await request("POST", "/api/blocks", body);
        return ok(withWarnings(res, v.warnings));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // update_block
  server.registerTool(
    "update_block",
    {
      title: "Update an HTML block",
      description:
        "Update an existing HTML block by UUID. Only the fields you pass are sent. Type stays html.",
      inputSchema: {
        block_id: z.string().min(1).describe("Block UUID to update."),
        name: z.string().min(1).optional().describe("New display name."),
        type: htmlType.optional(),
        data: z.record(z.string(), z.any()).optional().describe("New query config object."),
        css: z.union([z.string(), z.array(z.any())]).optional().describe("New CSS."),
        json_data: z.record(z.string(), z.any()).optional().describe("New widget/extra config."),
        tags: z.array(z.string()).optional().describe("Replacement tag list."),
        access: z.record(z.string(), z.any()).optional().describe("New access control object."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason(BLOCK_DOMAIN);
        if (reason) return fail(reason);
        const { block_id, ...rest } = args;
        // The portal PUT is a full replace (and requires `name`). Fetch the current
        // block and merge the provided fields over it so untouched fields aren't nulled.
        const existing = await request<Record<string, unknown>>(
          "GET",
          `/api/blocks/${encodeURIComponent(block_id)}`
        );
        const merged = { ...buildBlockBody(existing), ...buildBlockBody(rest) };
        if (merged.css === undefined || merged.css === null) merged.css = [];
        const v = validateBlock(merged);
        if (v.errors.length > 0) return fail(formatViolations(v));
        const res = await request("PUT", `/api/blocks/${encodeURIComponent(block_id)}`, merged);
        return ok(withWarnings(res, v.warnings));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // delete_block
  server.registerTool(
    "delete_block",
    {
      title: "Delete a block",
      description: "Delete a block by UUID. This cannot be undone from this server.",
      inputSchema: { block_id: z.string().min(1).describe("Block UUID to delete.") },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason(BLOCK_DOMAIN);
        if (reason) return fail(reason);
        const r = await request("DELETE", `/api/blocks/${encodeURIComponent(args.block_id)}`);
        return ok(r ?? { deleted: args.block_id });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );
}

// ── Generic resource tools (driven by the registry) ───────────────────────────
function registerResourceTools(server: McpServer): void {
  // describe_resource
  server.registerTool(
    "describe_resource",
    {
      title: "Describe a portal resource",
      description:
        "Show a resource's path, write fields, required-to-create fields, supported verbs, and " +
        "risk domain. Omit `resource` to list every resource this server manages. Call this " +
        "before create_resource/update_resource so the body matches the portal schema.",
      inputSchema: {
        resource: resourceEnum.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      if (!args.resource) {
        return ok({ resources: DESCRIPTORS.map(describeResource) });
      }
      const desc = getDescriptor(args.resource);
      if (!desc) return fail(`Unknown resource "${args.resource}".`);
      return ok(describeResource(desc));
    }
  );

  // list_resource
  server.registerTool(
    "list_resource",
    {
      title: "List a resource collection",
      description:
        "List records of a resource (datasource, layout, query, theme, partial, user, group, " +
        "db_modification, etc.). Use this for discovery — e.g. find a datasource UUID before " +
        "authoring a block. Optional `query` adds URL query params for filtering.",
      inputSchema: {
        resource: resourceEnum,
        query: z
          .record(z.string(), z.any())
          .optional()
          .describe("Optional query-string params, e.g. { only_names: true }."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const desc = getDescriptor(args.resource);
        if (!desc) return fail(`Unknown resource "${args.resource}".`);
        return ok(await listResource(desc, args.query));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // get_resource
  server.registerTool(
    "get_resource",
    {
      title: "Get one resource record",
      description: "Fetch a single record of a resource by its id (or name, for tags).",
      inputSchema: {
        resource: resourceEnum,
        id: z.string().min(1).describe("Record id (the resource's id_param from describe_resource)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const desc = getDescriptor(args.resource);
        if (!desc) return fail(`Unknown resource "${args.resource}".`);
        return ok(await getResource(desc, args.id));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // create_resource
  server.registerTool(
    "create_resource",
    {
      title: "Create a resource record",
      description:
        "Create a record. `body` carries the resource's fields (see describe_resource). Writes are " +
        "gated by risk domain: content is on by default; data (datasources/db_modifications) needs " +
        "PORTAL_ALLOW_DATA_WRITES; admin (users/groups/etc.) needs PORTAL_ALLOW_ADMIN_WRITES.",
      inputSchema: {
        resource: resourceEnum,
        body: z
          .record(z.string(), z.any())
          .describe("Field values for the new record. Unknown fields are dropped."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const desc = getDescriptor(args.resource);
        if (!desc) return fail(`Unknown resource "${args.resource}".`);
        return ok(await createResource(desc, args.body));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // update_resource
  server.registerTool(
    "update_resource",
    {
      title: "Update a resource record",
      description:
        "Update a record by id. Only the fields in `body` change; the server merges them over the " +
        "current record (portal PUT is full-replace) so untouched fields are preserved. Same write " +
        "gating as create_resource.",
      inputSchema: {
        resource: resourceEnum,
        id: z.string().min(1).describe("Record id to update."),
        body: z.record(z.string(), z.any()).describe("Fields to change. Unknown fields are dropped."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const desc = getDescriptor(args.resource);
        if (!desc) return fail(`Unknown resource "${args.resource}".`);
        return ok(await updateResource(desc, args.id, args.body));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // delete_resource
  server.registerTool(
    "delete_resource",
    {
      title: "Delete a resource record",
      description:
        "Delete a record by id (or name, for tags). Cannot be undone. Same write gating as " +
        "create_resource — the record's risk domain must be enabled.",
      inputSchema: {
        resource: resourceEnum,
        id: z.string().min(1).describe("Record id to delete."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const desc = getDescriptor(args.resource);
        if (!desc) return fail(`Unknown resource "${args.resource}".`);
        return ok(await deleteResource(desc, args.id));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );
}

// ── Action tools (non-CRUD) ───────────────────────────────────────────────────
function registerActionTools(server: McpServer): void {
  // get_rules
  server.registerTool(
    "get_rules",
    {
      title: "Get active authoring rules",
      description:
        "Return the active block-authoring rules: per-rule enforcement severities and the " +
        "conventions text. Read this to see what create_block/update_block will enforce.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(getRules());
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // get_version
  server.registerTool(
    "get_version",
    {
      title: "Get portal version / capabilities",
      description:
        "Fetch the portal version and about info. Use it to confirm connectivity and to gate " +
        "version-specific endpoints (e.g. saved queries are 1.18+).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const version = await request("GET", "/api/version").catch(() => null);
        const about = await request("GET", "/api/about").catch(() => null);
        return ok({ version, about });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // fetch_sample_rows
  server.registerTool(
    "fetch_sample_rows",
    {
      title: "Fetch sample rows from a datasource",
      description:
        "Fetch a few rows from a datasource so you can see real column names and values before " +
        "authoring a block. Returns columns and row arrays.",
      inputSchema: {
        datasource_id: z.string().min(1).describe("Datasource UUID."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(SAMPLE_ROW_LIMIT_MAX)
          .optional()
          .describe(`Rows to fetch (default ${SAMPLE_ROW_LIMIT_DEFAULT}, max ${SAMPLE_ROW_LIMIT_MAX}).`),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const limit = args.limit ?? SAMPLE_ROW_LIMIT_DEFAULT;
        const body = { queries: [{ columns: ["*"], limit }] };
        const res = await request<{ results?: unknown[] }>(
          "POST",
          `/api/datasources/${encodeURIComponent(args.datasource_id)}/data`,
          body
        );
        const first = (res?.results?.[0] ?? {}) as Record<string, unknown>;
        return ok({
          datasource_id: args.datasource_id,
          columns: first.columns ?? [],
          rows: first.data ?? [],
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // execute_query (saved query by id)
  server.registerTool(
    "execute_query",
    {
      title: "Execute a saved query",
      description:
        "Run a saved query by id and return its results. Pass `params` as a { name: value } map " +
        "for parameterized queries. Read-only data retrieval.",
      inputSchema: {
        query_id: z.string().min(1).describe("Saved query UUID."),
        params: z
          .record(z.string(), z.any())
          .optional()
          .describe("Query parameters as a { name: value } map."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = { query_id: args.query_id };
        const params = toSqlParams(args.params);
        if (params) body.params = params;
        return ok(
          await request("POST", `/api/queries/${encodeURIComponent(args.query_id)}/execute`, body)
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // run_db_modification (data write, confirm-gated)
  server.registerTool(
    "run_db_modification",
    {
      title: "Run a database modification",
      description:
        "Execute a saved db_modification (INSERT/UPDATE/DELETE) by name. This WRITES to a database. " +
        "Requires data writes enabled (PORTAL_ALLOW_DATA_WRITES=1) and confirm=true. Pass `params` " +
        "as a { name: value } map, or `params_list` for bulk rows.",
      inputSchema: {
        name: z.string().min(1).describe("db_modification name to run."),
        params: z
          .record(z.string(), z.any())
          .optional()
          .describe("Single-row parameters as a { name: value } map."),
        params_list: z
          .array(z.record(z.string(), z.any()))
          .optional()
          .describe("Bulk parameters: a list of { name: value } maps, one per row."),
        autocommit: z.boolean().optional().describe("Commit each statement (default portal behavior)."),
        ignore_sql_errors: z.boolean().optional().describe("Continue past SQL errors."),
        confirm: z
          .boolean()
          .describe("Must be true to actually run — guards against accidental DB writes."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason("data");
        if (reason) return fail(reason);
        if (args.confirm !== true) {
          return fail("Refusing to run: set confirm=true to execute this database modification.");
        }
        const mod: Record<string, unknown> = { name: args.name };
        if (args.params) mod.params = args.params;
        if (args.params_list) mod.params_list = args.params_list;
        const body: Record<string, unknown> = { db_modifications: [mod] };
        if (args.autocommit !== undefined) body.autocommit = args.autocommit;
        if (args.ignore_sql_errors !== undefined) body.ignore_sql_errors = args.ignore_sql_errors;
        return ok(await request("POST", "/api/db_modifications/run", body));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // change_password (admin write; secrets never echoed)
  server.registerTool(
    "change_password",
    {
      title: "Change the current user's password",
      description:
        "Change the authenticated user's password. Requires admin writes enabled " +
        "(PORTAL_ALLOW_ADMIN_WRITES=1). Passwords are never logged or echoed back.",
      inputSchema: {
        old_password: z.string().min(1).describe("Current password."),
        new_password: z.string().min(1).describe("New password."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason("admin");
        if (reason) return fail(reason);
        await request("POST", "/auth/passwd", {
          old_password: args.old_password,
          new_password: args.new_password,
        });
        return ok({ status: "password changed" });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // get_user_groups
  server.registerTool(
    "get_user_groups",
    {
      title: "Get a user's groups",
      description: "List the groups a user belongs to.",
      inputSchema: { user_id: z.string().min(1).describe("User UUID.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(await request("GET", `/auth/users/${encodeURIComponent(args.user_id)}/groups`));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // set_user_groups (admin write — full replace of membership)
  server.registerTool(
    "set_user_groups",
    {
      title: "Set a user's groups",
      description:
        "Replace the full set of groups for a user. Requires admin writes enabled " +
        "(PORTAL_ALLOW_ADMIN_WRITES=1).",
      inputSchema: {
        user_id: z.string().min(1).describe("User UUID."),
        group_ids: z.array(z.string()).describe("Complete list of group ids the user should have."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason("admin");
        if (reason) return fail(reason);
        return ok(
          await request("PUT", `/auth/users/${encodeURIComponent(args.user_id)}/groups`, {
            groups: args.group_ids,
          })
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // get_user_permissions
  server.registerTool(
    "get_user_permissions",
    {
      title: "Get a user's permissions",
      description: "List the permissions granted to a user.",
      inputSchema: { user_id: z.string().min(1).describe("User UUID.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(
          await request("GET", `/auth/users/${encodeURIComponent(args.user_id)}/permissions`)
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // set_user_permissions (admin write — full replace)
  server.registerTool(
    "set_user_permissions",
    {
      title: "Set a user's permissions",
      description:
        "Replace the full set of permissions for a user. Requires admin writes enabled " +
        "(PORTAL_ALLOW_ADMIN_WRITES=1).",
      inputSchema: {
        user_id: z.string().min(1).describe("User UUID."),
        permission_ids: z
          .array(z.string())
          .describe("Complete list of permission ids the user should have."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason("admin");
        if (reason) return fail(reason);
        return ok(
          await request("PUT", `/auth/users/${encodeURIComponent(args.user_id)}/permissions`, {
            permissions: args.permission_ids,
          })
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // get_me
  server.registerTool(
    "get_me",
    {
      title: "Get the current user",
      description: "Return the authenticated user's profile (from the auth service).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await request("GET", "/auth/me"));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // update_me (admin write — account mutation)
  server.registerTool(
    "update_me",
    {
      title: "Update the current user",
      description:
        "Update the authenticated user's own fullname/email. Requires admin writes enabled " +
        "(PORTAL_ALLOW_ADMIN_WRITES=1).",
      inputSchema: {
        fullname: z.string().optional().describe("New full name."),
        email: z.string().optional().describe("New email."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason("admin");
        if (reason) return fail(reason);
        const body: Record<string, unknown> = {};
        if (args.fullname !== undefined) body.fullname = args.fullname;
        if (args.email !== undefined) body.email = args.email;
        if (Object.keys(body).length === 0) return fail("Provide fullname and/or email to update.");
        return ok(await request("PATCH", "/auth/me", body));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // get_config
  server.registerTool(
    "get_config",
    {
      title: "Get portal config",
      description: "Fetch the portal's configuration document.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await request("GET", "/api/config"));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // update_config (admin write — path/value model)
  server.registerTool(
    "update_config",
    {
      title: "Update portal config",
      description:
        "Set a value at a config path. `path` is the key path (array of strings); `value` is the new " +
        "value; `merge` merges into an existing object instead of replacing. Requires admin writes " +
        "enabled (PORTAL_ALLOW_ADMIN_WRITES=1).",
      inputSchema: {
        path: z.array(z.string()).min(1).describe('Config key path, e.g. ["branding","title"].'),
        value: z.any().describe("New value (object, array, string, number, or boolean)."),
        merge: z.boolean().optional().describe("Merge into an existing object instead of replacing."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const reason = blockReason("admin");
        if (reason) return fail(reason);
        const body: Record<string, unknown> = { path: args.path, value: args.value };
        if (args.merge !== undefined) body.merge = args.merge;
        return ok(await request("PUT", "/api/config", body));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );
}

// ── Resources (bundled authoring guidance) ────────────────────────────────────
function registerResources(server: McpServer): void {
  for (const g of GUIDES) {
    server.registerResource(
      g.name,
      g.uri,
      { title: g.title, description: g.description, mimeType: "text/markdown" },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: g.text }],
      })
    );
  }

  // Active authoring conventions (configurable via rules.json / PORTAL_BLOCK_RULES_FILE).
  server.registerResource(
    "conventions",
    "zportal://guide/conventions",
    {
      title: "Block authoring conventions (active rules)",
      description:
        "The always/never rules and code-style conventions enforced by create_block/update_block.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: getRules().conventions }],
    })
  );
}

// ── Prompts ───────────────────────────────────────────────────────────────────
function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "create_zportal_block",
    {
      title: "Create a zPortal HTML block",
      description:
        "Guided workflow to build a correct Zuar Portal HTML block: discover data, follow the " +
        "two-field structure, then create the block.",
      argsSchema: {
        goal: z.string().describe("What the block should show or do."),
        datasource_hint: z
          .string()
          .optional()
          .describe("Name or UUID of the datasource, if known."),
      },
    },
    ({ goal, datasource_hint }) => {
      const dsLine = datasource_hint
        ? `The user mentioned this datasource: "${datasource_hint}".`
        : "The datasource is not specified yet.";
      const text = [
        "Act as a senior front-end engineer fluent in Zuar Portal. Build a finished,",
        `themed HTML block for this goal: ${goal}`,
        "",
        "Follow this order:",
        "1. Read the resources zportal://guide/block-structure, zportal://guide/currentblock, " +
          "and zportal://guide/conventions (the active always/never rules) — and " +
          "zportal://guide/amcharts-loader if the block needs a chart.",
        `2. ${dsLine} Call list_resource with resource=\"datasource\" (and resource=\"query\" on ` +
          "1.18+) to find the right __source__ UUID, then fetch_sample_rows to see the real " +
          "column aliases and values.",
        "3. Author two fields:",
        '   - HTML+JS (body-level only: no <!DOCTYPE>/<html>/<head>/<body>/<style>). Wrap ' +
          'markup in <div id="zuar-block-root"> (the established convention).',
        "   - CSS (no <style> tags), with every selector scoped under #zuar-block-root.",
        "   Structure the <script> as: top-level config (DEBUG flag, DEBUG-gated logger, " +
          "QUERY_INDEX + column-name constants matching the query aliases, selectors, thresholds) " +
          "-> getQueryData(index) helper (read currentBlock.queryResults[n]; never the deprecated " +
          "currentBlock.data/.columns, zPortal.dataSource, or fetchResults) -> pure render helpers " +
          "-> a single bottom-level init() called last. Obtain currentBlock.getOnLoadedCallback() " +
          "early and call it exactly once after render (in a finally for async) or the loader hangs.",
        "4. Use theme variables (var(--color-*, fallback)) — never hardcode hex/fonts. Don't " +
          "author loading states (Portal has a skeleton loader). Avoid AngularJS $compile " +
          "footguns: {{ }} is evaluated (escape or set via JS); format currency with " +
          "Intl.NumberFormat to dodge the $ issue. Wire interactions with addEventListener / " +
          "data-zuar-action — inline on* handlers and external <script src> are stripped. No " +
          "eval/new Function()/document.write.",
        "5. QA self-review before shipping: (a) keys read off queryResults match the query " +
          "column aliases and null/empty rows are handled; (b) no <html>/<head>/<body>/<style>, " +
          "CSS scoped, async calls the loaded callback; (c) no unsafe JS. Fix issues, then create " +
          "with create_block (type is html) and report the new block id.",
      ].join("\n");
      return {
        messages: [{ role: "user", content: { type: "text", text } }],
      };
    }
  );
}
