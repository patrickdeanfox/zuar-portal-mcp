/**
 * server.ts
 *
 * Builds the Zuar Portal MCP server: HTML-block CRUD tools, read-only
 * discovery tools (so the model can wire blocks to real data), bundled
 * authoring guidance as resources, and a guided create-block prompt.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { request } from "./portalClient.js";
import { GUIDES } from "./guidance.js";
import { getRules, validateBlock, type ValidationResult } from "./rules.js";

// ── Top-level config ────────────────────────────────────────────────────────
const SERVER_NAME = "zuar-portal-mcp-server";
const SERVER_VERSION = "1.0.0";
const ONLY_BLOCK_TYPE = "html";
const SAMPLE_ROW_LIMIT_DEFAULT = 5;
const SAMPLE_ROW_LIMIT_MAX = 50;

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
  lines.push("Fix the ERROR items, or set their severity to \"warn\"/\"off\" in rules.json.");
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

// ── Server construction ───────────────────────────────────────────────────────
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

// ── Tools ─────────────────────────────────────────────────────────────────────
function registerTools(server: McpServer): void {
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
        const body = buildBlockBody(args);
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
        const { block_id, ...rest } = args;
        const body = buildBlockBody(rest);
        const v = validateBlock(body);
        if (v.errors.length > 0) return fail(formatViolations(v));
        const res = await request("PUT", `/api/blocks/${encodeURIComponent(block_id)}`, body);
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
        const r = await request("DELETE", `/api/blocks/${encodeURIComponent(args.block_id)}`);
        return ok(r ?? { deleted: args.block_id });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // list_datasources
  server.registerTool(
    "list_datasources",
    {
      title: "List datasources",
      description:
        "List datasources on the portal. Use this to find the __source__ UUID and the name of " +
        "the datasource a new block should query.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await request("GET", "/api/datasources"));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // list_queries (1.18+)
  server.registerTool(
    "list_queries",
    {
      title: "List saved queries",
      description:
        "List saved queries (Portal 1.18+). On older portals this endpoint does not exist; the " +
        "tool reports that clearly so you can fall back to datasources.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await request("GET", "/api/queries"));
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("HTTP 404")) {
          return fail(
            "No /api/queries endpoint — this portal is likely pre-1.18. Use list_datasources instead."
          );
        }
        return fail(msg);
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

  // list_layouts
  server.registerTool(
    "list_layouts",
    {
      title: "List portal layouts (pages)",
      description:
        "List layouts on the portal. A layout is a page; its json_data.grid holds which blocks " +
        "are placed on the page and where. Use this to find the UUID of the page you want to edit.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return ok(await request("GET", "/api/layouts"));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // get_layout
  server.registerTool(
    "get_layout",
    {
      title: "Get a layout (page)",
      description:
        "Fetch a single layout by UUID, including its json_data.grid (block placement and sizes). " +
        "Read this before changing a page's block layout so writes are based on the real grid shape.",
      inputSchema: { layout_id: z.string().min(1).describe("Layout (page) UUID.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return ok(await request("GET", `/api/layouts/${encodeURIComponent(args.layout_id)}`));
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

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
        `Build a Zuar Portal HTML block for this goal: ${goal}`,
        "",
        "Follow this order:",
        "1. Read the resources zportal://guide/block-structure, zportal://guide/currentblock, " +
          "and zportal://guide/conventions (the active always/never rules) — and " +
          "zportal://guide/amcharts-loader if the block needs a chart.",
        `2. ${dsLine} Call list_datasources (and list_queries on 1.18+) to find the right __source__ ` +
          "UUID, then fetch_sample_rows to see real columns and values.",
        "3. Produce the block as two fields: HTML+JS (no <html>/<head>/<body>) and CSS (no <style>). " +
          "Use the CONFIG/log/init scaffold and theme CSS variables.",
        "4. Create it with create_block (type is html). Report the new block id.",
      ].join("\n");
      return {
        messages: [{ role: "user", content: { type: "text", text } }],
      };
    }
  );
}
