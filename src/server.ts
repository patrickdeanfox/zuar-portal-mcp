/**
 * server.ts
 *
 * Builds the Zuar Portal MCP server.
 *
 * Tool surface (production layout):
 *   - Typed block tools (validated authoring): list/get/create/update/delete_block,
 *     plus bind_block_query (datasource/query binding) and add/remove_block_from_page
 *     (page-grid placement).
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
import { getDesign } from "./design.js";
import {
  recordWrite,
  recordDelete,
  stageResource,
  commitSnapshot,
  readVersion,
  previousRef,
  history,
  vcStatus,
  isVcEnabled,
} from "./portalVc.js";
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
const SERVER_VERSION = "2.2.0";
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
// `ui_queries` is the block's real query/datasource binding (the portal BlockRequest
// schema has no `data` field) and MUST be carried through: update_block does a
// full-replace PUT of buildBlockBody(existing) merged with the edits, so dropping
// ui_queries here would silently wipe the bound datasource on every edit.
function buildBlockBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { type: ONLY_BLOCK_TYPE };
  for (const key of ["name", "data", "css", "json_data", "ui_queries", "tags", "access"] as const) {
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

// ── Page-grid helpers (layout.json_data.grid block placement) ─────────────────
// A layout (page) places blocks via grid.blocks (the id list) plus
// grid.block_layouts.{lg,md,sm}[blockId] = { left, top, width, height, sizingUnit, zIndex }.
// These pure helpers keep that bookkeeping in one place for the placement tools.
const GRID_BREAKPOINTS = ["lg", "md", "sm"] as const;

// Largest (top + height) among a breakpoint's existing blocks — so a new block can
// stack below current content instead of overlapping it.
function gridStackTop(blockLayouts: Record<string, any>): number {
  let maxBottom = 0;
  for (const key of Object.keys(blockLayouts || {})) {
    const p = (blockLayouts[key] || {}) as Record<string, unknown>;
    const bottom = (Number(p.top) || 0) + (Number(p.height) || 0);
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return maxBottom;
}

// Resolve a placement box for one breakpoint: caller's per-breakpoint box, a single
// box applied to all breakpoints, else a full-width slot stacked below existing blocks.
function resolvePlacement(
  grid: Record<string, any>,
  bp: string,
  position: Record<string, any> | undefined,
  height: number
): Record<string, number | string> {
  const fullWidth = bp === "md" ? 102 : 100;
  let box: Record<string, any> | undefined;
  if (position && position[bp] && typeof position[bp] === "object") box = position[bp];
  else if (position && typeof position.left === "number") box = position;
  if (!box) {
    const existing = grid.block_layouts ? grid.block_layouts[bp] : {};
    box = { left: 0, top: gridStackTop(existing), width: fullWidth, height };
  }
  return {
    left: Number(box.left) || 0,
    top: Number(box.top) || 0,
    width: Number(box.width) || fullWidth,
    height: Number(box.height) || height,
    sizingUnit: typeof box.sizingUnit === "string" ? box.sizingUnit : "%",
    zIndex: Number(box.zIndex) || 0,
  };
}

// Insert/replace a block in the grid (blocks[] + block_layouts.{lg,md,sm}).
function addBlockToGrid(
  grid: Record<string, any>,
  blockId: string,
  position: Record<string, any> | undefined,
  height: number
): void {
  if (!Array.isArray(grid.blocks)) grid.blocks = [];
  if (grid.blocks.indexOf(blockId) === -1) grid.blocks.push(blockId);
  if (!grid.block_layouts || typeof grid.block_layouts !== "object") grid.block_layouts = {};
  for (const bp of GRID_BREAKPOINTS) {
    if (!grid.block_layouts[bp] || typeof grid.block_layouts[bp] !== "object") grid.block_layouts[bp] = {};
    grid.block_layouts[bp][blockId] = resolvePlacement(grid, bp, position, height);
  }
}

// Remove a block from the grid everywhere it is referenced. Returns whether it was present.
function removeBlockFromGrid(grid: Record<string, any>, blockId: string): boolean {
  let removed = false;
  if (Array.isArray(grid.blocks)) {
    const before = grid.blocks.length;
    grid.blocks = grid.blocks.filter((b: unknown) => b !== blockId);
    if (grid.blocks.length !== before) removed = true;
  }
  if (grid.block_layouts && typeof grid.block_layouts === "object") {
    for (const bp of GRID_BREAKPOINTS) {
      const bl = grid.block_layouts[bp];
      if (bl && typeof bl === "object" && bl[blockId] !== undefined) {
        delete bl[blockId];
        removed = true;
      }
    }
  }
  if (Array.isArray(grid.block_hidden)) {
    grid.block_hidden = grid.block_hidden.filter((b: unknown) => b !== blockId);
  }
  return removed;
}

// ── Shared zod fragments ──────────────────────────────────────────────────────
const htmlType = z
  .literal(ONLY_BLOCK_TYPE)
  .default(ONLY_BLOCK_TYPE)
  .describe(`Block type. This server only handles HTML blocks, so it must be "${ONLY_BLOCK_TYPE}".`);

// The block's real query/datasource binding. Each entry's query_id points to a saved
// `query` resource (which holds the datasource + SQL); queryResults[n] maps to ui_queries[n].
const uiQueriesField = z
  .array(z.record(z.string(), z.any()))
  .optional()
  .describe(
    "Query/datasource binding (this is how a block gets data — the portal has no `data` " +
      'field). Array of { enabled, page_size, query_id, filter_strategy }, e.g. ' +
      '[{ "enabled": true, "page_size": 50, "query_id": "<query-uuid>", ' +
      '"filter_strategy": { "type": "blacklist", "value": [] } }]. The query_id must ' +
      "reference a saved query that already has a datasource attached. On update_block, " +
      "the existing ui_queries is preserved automatically unless you pass a new value."
  );

const blockPayloadShape = {
  name: z.string().min(1).describe("Display name of the block."),
  type: htmlType,
  data: z
    .record(z.string(), z.any())
    .optional()
    .describe(
      "Legacy query-config object. Ignored by current portal versions — bind data via " +
        "`ui_queries` instead. Kept only for backward compatibility."
    ),
  ui_queries: uiQueriesField,
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
  registerVcTools(server);
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
        recordWrite("block", (res as Record<string, unknown>)?.id, "create", res);
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
        data: z
          .record(z.string(), z.any())
          .optional()
          .describe("Legacy query-config object — ignored by current portals; use ui_queries."),
        ui_queries: uiQueriesField.describe(
          "Replacement query/datasource binding. Omit to keep the block's existing binding " +
            "(it is preserved automatically); pass [] to explicitly unbind all queries."
        ),
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
        recordWrite("block", block_id, "update", res);
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
        recordDelete("block", args.block_id);
        return ok(r ?? { deleted: args.block_id });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // bind_block_query — give a block its datasource binding (ui_queries) in one call.
  server.registerTool(
    "bind_block_query",
    {
      title: "Bind a block to a datasource/query",
      description:
        "Give an existing block its data binding so currentBlock.queryResults[0] is populated. " +
        "Pass an existing query_id, OR a datasource_id (a `SELECT *` query is auto-created against " +
        "it and linked). Sets the block's ui_queries while preserving its html/css/name. The bound " +
        'query must have a datasource (auto-created ones do) or the portal rejects it.',
      inputSchema: {
        block_id: z.string().min(1).describe("Block UUID to bind."),
        query_id: z
          .string()
          .optional()
          .describe("Existing saved query UUID. Mutually exclusive with datasource_id."),
        datasource_id: z
          .string()
          .optional()
          .describe("Datasource UUID — auto-creates a SELECT * query against it. Mutually exclusive with query_id."),
        sql: z
          .string()
          .optional()
          .describe('Optional raw SQL for the auto-created query (use alias `datasource` as the table). Only with datasource_id; default is SELECT *.'),
        page_size: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Rows fetched into queryResults. Omit for the default null = ALL rows (preferred — the block sees the full dataset). Set a positive number only to cap intentionally (e.g. a small preview); a low cap truncates the data the block sees."),
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
        const reason = blockReason(BLOCK_DOMAIN);
        if (reason) return fail(reason);
        if (!args.query_id && !args.datasource_id) return fail("Provide either query_id or datasource_id.");
        if (args.query_id && args.datasource_id) return fail("Provide only one of query_id / datasource_id.");

        let queryId = args.query_id;
        let createdQuery: string | null = null;
        if (!queryId) {
          const qbody: Record<string, unknown> = {
            datasources: [{ id: args.datasource_id, alias: "datasource" }],
          };
          if (args.sql) qbody.raw_sql = args.sql;
          else qbody.sql_form = { columns: ["*"] };
          const q = await request<Record<string, any>>("POST", "/api/queries", qbody);
          queryId = q.id as string;
          createdQuery = queryId;
          recordWrite("query", q.id, "create", q);
        } else {
          const q = await request<Record<string, any>>("GET", `/api/queries/${encodeURIComponent(queryId)}`);
          const dss = (q && q.datasources) || [];
          if (!Array.isArray(dss) || dss.length === 0) {
            return fail(`Query ${queryId} has no datasource ("a query must have a datasource"). Attach one before binding.`);
          }
        }

        // Default page_size to null = all rows (preferred). Only cap when explicitly asked.
        const pageSize = args.page_size ?? null;
        const uiQueries = [
          { enabled: true, page_size: pageSize, query_id: queryId, filter_strategy: { type: "blacklist", value: [] } },
        ];

        const existing = await request<Record<string, unknown>>(
          "GET",
          `/api/blocks/${encodeURIComponent(args.block_id)}`
        );
        const merged: Record<string, unknown> = { ...buildBlockBody(existing), ui_queries: uiQueries };
        if (merged.css === undefined || merged.css === null) merged.css = [];
        const res = await request<Record<string, any>>(
          "PUT",
          `/api/blocks/${encodeURIComponent(args.block_id)}`,
          merged
        );
        recordWrite("block", args.block_id, "bind", res);
        return ok({
          block_id: args.block_id,
          query_id: queryId,
          created_query: createdQuery,
          page_size: pageSize,
          ui_queries: res.ui_queries,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // add_block_to_page — place an existing block on a page (layout grid).
  server.registerTool(
    "add_block_to_page",
    {
      title: "Add a block to a page",
      description:
        "Place an existing block on a page (layout) by inserting it into the page grid " +
        "(grid.blocks + block_layouts for lg/md/sm). Idempotent — re-adding updates its position. " +
        'Does not create the block; create_block first, then add it here. Find layouts with ' +
        'list_resource resource="layout".',
      inputSchema: {
        layout_id: z.string().min(1).describe("Layout (page) UUID."),
        block_id: z.string().min(1).describe("Block UUID to place on the page."),
        height: z
          .number()
          .positive()
          .optional()
          .describe("Block height as % of the page when auto-placing (default 50). Ignored when `position` is given."),
        position: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            "Optional placement (units %). Either one box { left, top, width, height } applied to all " +
              "breakpoints, or per-breakpoint { lg:{...}, md:{...}, sm:{...} }. Omit to stack full-width below existing content."
          ),
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
        const desc = getDescriptor("layout");
        if (!desc) return fail("Layout resource not available on this server.");
        const layout = await request<Record<string, any>>(
          "GET",
          `/api/layouts/${encodeURIComponent(args.layout_id)}`
        );
        const jd: Record<string, any> = layout.json_data && typeof layout.json_data === "object" ? layout.json_data : {};
        const grid: Record<string, any> = jd.grid && typeof jd.grid === "object" ? jd.grid : {};
        addBlockToGrid(grid, args.block_id, args.position, args.height ?? 50);
        jd.grid = grid;
        await updateResource(desc, args.layout_id, { json_data: jd });
        return ok({ layout_id: args.layout_id, block_id: args.block_id, placed: true, blocks: grid.blocks });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // remove_block_from_page — take a block off a page without deleting the block.
  server.registerTool(
    "remove_block_from_page",
    {
      title: "Remove a block from a page",
      description:
        "Remove a block from a page (layout) grid — grid.blocks + block_layouts (lg/md/sm) + " +
        "block_hidden. The block object itself is NOT deleted (use delete_block for that). " +
        "Idempotent: a no-op if the block isn't on the page.",
      inputSchema: {
        layout_id: z.string().min(1).describe("Layout (page) UUID."),
        block_id: z.string().min(1).describe("Block UUID to remove from the page."),
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
        const desc = getDescriptor("layout");
        if (!desc) return fail("Layout resource not available on this server.");
        const layout = await request<Record<string, any>>(
          "GET",
          `/api/layouts/${encodeURIComponent(args.layout_id)}`
        );
        const jd: Record<string, any> = layout.json_data && typeof layout.json_data === "object" ? layout.json_data : {};
        const grid: Record<string, any> = jd.grid && typeof jd.grid === "object" ? jd.grid : {};
        const removed = removeBlockFromGrid(grid, args.block_id);
        if (!removed) {
          return ok({
            layout_id: args.layout_id,
            block_id: args.block_id,
            removed: false,
            note: "Block was not on this page.",
            blocks: grid.blocks ?? [],
          });
        }
        jd.grid = grid;
        await updateResource(desc, args.layout_id, { json_data: jd });
        return ok({ layout_id: args.layout_id, block_id: args.block_id, removed: true, blocks: grid.blocks });
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

// ── Version-control tools (optional; enabled by PORTAL_VC_DIR) ─────────────────
function registerVcTools(server: McpServer): void {
  // vc_status — is version control on, and where.
  server.registerTool(
    "vc_status",
    {
      title: "Version-control status",
      description:
        "Report whether portal version control is enabled (set PORTAL_VC_DIR to a git repo path), " +
        "the repo location, and push config (PORTAL_VC_PUSH / PORTAL_VC_REMOTE). When enabled, every " +
        "content write (blocks, layouts, queries, themes, partials, snippets, translations, dashboards, " +
        "tags) is auto-committed so it can be reverted with restore_resource.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(vcStatus());
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // snapshot_portal — seed/refresh the repo with all content as of now.
  server.registerTool(
    "snapshot_portal",
    {
      title: "Snapshot portal content to git",
      description:
        "Export every content resource (blocks + layouts/queries/themes/partials/snippets/" +
        "translations/dashboards/tags) to the version-control repo and commit. Run once to seed " +
        "history, or anytime to capture a checkpoint. Requires PORTAL_VC_DIR.",
      inputSchema: {
        message: z.string().optional().describe("Commit message (default: 'snapshot')."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        if (!isVcEnabled()) {
          return fail("Version control is off. Set PORTAL_VC_DIR to a git repo path to enable it.");
        }
        const counts: Record<string, number> = {};
        for (const key of RESOURCE_KEYS) {
          const desc = getDescriptor(key);
          if (!desc || desc.domain !== "content" || !desc.verbs.list) continue;
          let list: unknown;
          try {
            list = await listResource(desc);
          } catch {
            continue;
          }
          const recs = Array.isArray(list)
            ? list
            : ((list as Record<string, unknown>)?.result as unknown[]) ?? [];
          let n = 0;
          for (const rec of recs) {
            const r = rec as Record<string, unknown>;
            const id = r?.[desc.idLabel] ?? r?.id;
            if (id != null) {
              stageResource(desc.key, String(id), rec);
              n++;
            }
          }
          counts[desc.key] = n;
        }
        try {
          const blocks = await request<unknown>("GET", "/api/blocks");
          const arr = Array.isArray(blocks)
            ? blocks
            : ((blocks as Record<string, unknown>)?.result as unknown[]) ?? [];
          let n = 0;
          for (const b of arr) {
            const id = (b as Record<string, unknown>)?.id;
            if (id != null) {
              stageResource("block", String(id), b);
              n++;
            }
          }
          counts.block = n;
        } catch {
          /* blocks endpoint optional */
        }
        const committed = commitSnapshot(args.message || "snapshot");
        return ok({ committed, counts, ...vcStatus() });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // vc_log — recent commits (optionally for one record).
  server.registerTool(
    "vc_log",
    {
      title: "Version-control history",
      description:
        "List recent commits, optionally scoped to one record. Use a returned hash with " +
        "restore_resource to revert to that version. Requires PORTAL_VC_DIR.",
      inputSchema: {
        resource: z.string().optional().describe("Record kind, e.g. 'block' or 'layout'."),
        id: z.string().optional().describe("Record id (requires resource)."),
        limit: z.number().int().positive().optional().describe("Max commits (default 20)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        if (!isVcEnabled()) return fail("Version control is off (set PORTAL_VC_DIR).");
        return ok({ commits: history(args.resource, args.id, args.limit ?? 20) });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // restore_resource — revert a record to a prior committed version and write it back.
  server.registerTool(
    "restore_resource",
    {
      title: "Restore a record to a previous version",
      description:
        "Revert a content record to a prior committed version and write it back to the portal. Omit " +
        "`ref` to undo the most recent change to this record, or pass a commit hash from vc_log. The " +
        "restore is itself committed. Requires PORTAL_VC_DIR.",
      inputSchema: {
        resource: z
          .string()
          .min(1)
          .describe("Record kind: 'block' or a content resource key (layout, query, theme, partial, snippet, translation, dashboard, tag)."),
        id: z.string().min(1).describe("Record id."),
        ref: z
          .string()
          .optional()
          .describe("Git commit hash/ref to restore from. Default: the version before the latest change to this record."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        if (!isVcEnabled()) return fail("Version control is off (set PORTAL_VC_DIR).");
        const ref = args.ref ?? previousRef(args.resource, args.id) ?? undefined;
        if (!ref) {
          return fail(`No prior version found for ${args.resource} ${args.id}. Run vc_log to see commits.`);
        }
        const snap = readVersion(args.resource, args.id, ref) as Record<string, unknown> | null;
        if (!snap) return fail(`Could not read ${args.resource} ${args.id} at ${ref}.`);

        if (args.resource === "block") {
          const merged = buildBlockBody(snap);
          if (merged.css === undefined || merged.css === null) merged.css = [];
          const res = await request("PUT", `/api/blocks/${encodeURIComponent(args.id)}`, merged);
          recordWrite("block", args.id, `restore ${ref}`, res);
          return ok({ restored: "block", id: args.id, from: ref });
        }

        const desc = getDescriptor(args.resource);
        if (!desc) return fail(`Unknown resource "${args.resource}".`);
        if (desc.domain !== "content") {
          return fail(`restore_resource only handles content resources; "${args.resource}" is ${desc.domain}.`);
        }
        await updateResource(desc, args.id, snap); // updateResource records the restore commit
        return ok({ restored: args.resource, id: args.id, from: ref });
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

  // House visual design system (configurable via assets/design.md / PORTAL_DESIGN_FILE).
  server.registerResource(
    "design-system",
    "zportal://guide/design-system",
    {
      title: "House visual design system",
      description:
        "The portal's house style — palette, typography, spacing, chart styling, and component " +
        "patterns. Apply it when authoring or restyling blocks so surfaces stay consistent.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: getDesign() }],
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
          "zportal://guide/zportal-api (filters, modals, block APIs), " +
          "zportal://guide/conventions (the active always/never rules), and " +
          "zportal://guide/design-system (the house visual style — palette, typography, spacing, " +
          "components, chart styling) — and zportal://guide/charting if the block needs a chart " +
          "(ECharts for complex, Chart.js/vanilla for simple; amCharts only if the user explicitly asks).",
        `2. ${dsLine} Call list_resource with resource=\"datasource\" and resource=\"query\" to ` +
          "find the datasource and the saved query to bind. Verify the query's REAL output " +
          "columns with execute_query (or fetch_sample_rows on the datasource) and match the " +
          "block's column-name constants to them exactly. Bind data via `ui_queries` " +
          "([{ enabled, page_size, query_id, filter_strategy }]) whose query_id points to a " +
          "query that already has a datasource — there is no `data`/`__source__` field, and a " +
          'query with no datasource fails with "a query must have a datasource". Do any ' +
          "GROUP BY/COUNT/SUM aggregation in the query's SQL, not in the block JS.",
        "3. Author two fields:",
        '   - HTML+JS (body-level only: no <!DOCTYPE>/<html>/<head>/<body>/<style>). Wrap ' +
          'markup in a single <div class="wrapper"> and scope all CSS under .wrapper (suffix ' +
          "ids/classes/vars when several similar blocks share a page).",
        "   - CSS (no <style> tags), with every selector scoped under .wrapper.",
        "   Structure the <script> wrapped in an IIFE: top-level config (a DEBUG/verboseLogging " +
          "flag + gated logger, column-name constants matching the query aliases, selectors, " +
          "thresholds) -> getQueryData(index) helper (read currentBlock.queryResults[n]; the " +
          "currentBlock.data/.columns aliases are the deprecated v1.18 shape) -> pure render " +
          "helpers that dispose any prior render first -> a single bottom-level init() called " +
          "last. For ASYNC blocks (library load, fetch, deferred render) obtain " +
          "currentBlock.getOnLoadedCallback() early and call it once after render (in a finally) " +
          "or the loader can hang; sync blocks don't need it.",
        "4. Apply the house design system (zportal://guide/design-system) — palette, type scale, " +
          "spacing, component + chart styling. Use theme variables (var(--color-primary, fallback), " +
          "--body-bg-color, etc.) — never hardcode hex/fonts. Don't author loading states (Portal " +
          "has a skeleton loader). Avoid " +
          "AngularJS $compile footguns: {{ }} is evaluated (escape or set via JS); format currency " +
          "with value.toLocaleString('en-US',{style:'currency',currency:'USD'}) to dodge the $ issue. " +
          "Prefer addEventListener over inline on* handlers; external <script src> is stripped, so " +
          "load libs via zPortal.resources.load or AMCHARTS_LOADER. Use zPortal.modal.show for modals " +
          "and zPortal.dataSource.setFilters/clearFilters for filtering. No eval/new Function()/document.write.",
        "5. QA self-review before shipping: (a) keys read off queryResults match the query " +
          "column aliases and null/empty rows are handled; (b) no <html>/<head>/<body>/<style>, " +
          "CSS scoped to .wrapper, async paths call the loaded callback, prior render disposed on " +
          "re-run; (c) no unsafe JS. Fix issues, then create with create_block (type is html) and " +
          "report the new block id.",
      ].join("\n");
      return {
        messages: [{ role: "user", content: { type: "text", text } }],
      };
    }
  );
}
