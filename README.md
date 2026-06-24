# Zuar Portal Blocks — MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets **Claude build and manage Zuar Portal (zPortal) HTML blocks** for you. Claude can discover your datasources, preview real data, and create / update / delete HTML blocks through the Portal REST API — with bundled authoring guidance so the blocks it produces follow zPortal conventions.

> **⬇️ Quick install (Claude Desktop):** download **`zuar-portal-mcp.mcpb`** from the [latest release](https://github.com/patrickdeanfox/zuar-portal-mcp/releases/latest) and double-click it, or drag it onto Claude Desktop. You'll be asked for three portal values (below) and that's it — no terminal, no config files.

Only **HTML blocks** are created or modified. Other block types are visible via `list_blocks`, but this server will never create or change them.

---

## Contents

- [What Claude can do with it](#what-claude-can-do-with-it)
- [Requirements](#requirements)
- [Getting your portal credentials](#getting-your-portal-credentials)
- [Install — Claude Desktop (one-click bundle)](#install--claude-desktop-one-click-bundle)
- [Install — Claude Code & other MCP clients](#install--claude-code--other-mcp-clients)
- [Getting started](#getting-started)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Building the .mcpb bundle](#building-the-mcpb-bundle)
- [Security](#security)
- [License](#license)

---

## What Claude can do with it

**Tools**

| Tool | What it does |
|------|--------------|
| `list_blocks` | List blocks on the portal (optionally by ID, or names only). |
| `get_block` | Fetch one block by UUID, including its HTML/CSS and query config. |
| `create_block` | Create an HTML block (full payload: name, data, css, json_data, tags, access). |
| `update_block` | Update an HTML block — only the fields you pass are sent. |
| `delete_block` | Delete a block by UUID. |
| `list_datasources` | Find the `__source__` UUID and name of a datasource. |
| `list_queries` | List saved queries (Portal 1.18+). |
| `fetch_sample_rows` | Preview a few rows so blocks get wired to real column names. |

**Resources** — authoring guidance Claude reads before building, so blocks follow zPortal conventions even if you've never set up a zPortal skill:

- `zportal://guide/block-structure` — the two-field HTML/CSS structure and theme variables
- `zportal://guide/currentblock` — reading query data inside a block and reacting to filters
- `zportal://guide/amcharts-loader` — the amCharts 5 two-block loader pattern

**Prompt** — `create_zportal_block`: a guided "discover data → build → create" workflow you can invoke from your MCP client.

---

## Requirements

- A **Zuar Portal** you can reach over HTTPS, with an account that has permission to manage blocks (admin recommended).
- **Claude Desktop** (for the one-click `.mcpb`) — Node.js ships with it, so there's nothing else to install.
- For the developer / `npx` path instead: **Node.js 18+**.

---

## Getting your portal credentials

You need three values. All three are entered once, during install.

### 1. Portal URL

The base URL of your portal, with no trailing path — for example:

```
https://your-portal.zuarbase.net
```

### 2. Portal API Key

1. Sign in to your portal as an admin.
2. Go to **Admin → Auth → API Keys**.
3. Create a new API key (or copy an existing one).
4. Copy the key string.

The API key inherits the permissions of the user it's associated with, so make sure that user can create, edit, and delete blocks.

### 3. Portal User ID

1. Go to **Admin → Users**.
2. Click your user.
3. Copy the **UUID** from the page URL (the long `xxxxxxxx-xxxx-...` segment).

> Keep the API Key and User ID private. In the Claude Desktop bundle they're stored as **sensitive** fields (masked and stored securely). They never leave the machine running the server.

---

## Install — Claude Desktop (one-click bundle)

1. Download **`zuar-portal-mcp.mcpb`** from the [latest release](https://github.com/patrickdeanfox/zuar-portal-mcp/releases/latest).
2. Double-click the file, or drag it onto the Claude Desktop window. An install dialog appears.
3. Fill in the three fields when prompted:
   - **Portal URL** — e.g. `https://your-portal.zuarbase.net`
   - **Portal API Key** — from Admin → Auth → API Keys
   - **Portal User ID** — your user UUID
4. Confirm. The tools, resources, and prompt are now available to Claude.

To update later, download the newer `.mcpb` from the releases page and install it over the old one.

---

## Install — Claude Code & other MCP clients

This server speaks MCP over **stdio**, so any MCP-capable client can use it. Provide the three values as environment variables.

### From a local clone (works today)

```bash
git clone https://github.com/patrickdeanfox/zuar-portal-mcp.git
cd zuar-portal-mcp
npm install
npm run build      # compiles TypeScript -> dist/
```

Then register it in your client's MCP config (e.g. `claude_desktop_config.json`, or `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "zuar-portal-blocks": {
      "command": "node",
      "args": ["/absolute/path/to/zuar-portal-mcp/dist/index.js"],
      "env": {
        "PORTAL_URL": "https://your-portal.zuarbase.net",
        "PORTAL_API_KEY": "your-portal-api-key",
        "PORTAL_USER_ID": "your-portal-user-uuid"
      }
    }
  }
}
```

### Via npx (once published to npm)

```json
{
  "mcpServers": {
    "zuar-portal-blocks": {
      "command": "npx",
      "args": ["-y", "zuar-portal-mcp-server"],
      "env": {
        "PORTAL_URL": "https://your-portal.zuarbase.net",
        "PORTAL_API_KEY": "your-portal-api-key",
        "PORTAL_USER_ID": "your-portal-user-uuid"
      }
    }
  }
}
```

---

## Getting started

Once installed, just talk to Claude. A good first session looks like this:

1. **Confirm the connection**

   > "List the datasources on my portal."

   Claude calls `list_datasources` and shows what's available. If you get a credentials error, re-check the three values (see [Troubleshooting](#troubleshooting)).

2. **Look at real data**

   > "Show me a few sample rows from the Sales datasource."

   Claude calls `fetch_sample_rows` so it can see the actual column names before building anything.

3. **Create a block**

   > "Create an HTML stat-card block called 'Total Orders' that shows the order count from the Sales datasource."

   Claude reads the `zportal://guide/*` resources, builds the two-field block, and calls `create_block`. It reports the new block's UUID.

4. **Iterate**

   > "Make the number bigger and use the portal's primary color."
   > "Now turn it into a bar chart of orders by state."

   Claude calls `update_block`. For charts it follows the amCharts loader pattern from the bundled guidance.

**Tip:** invoke the **`create_zportal_block`** prompt for a structured, end-to-end flow — give it a goal (and optionally a datasource name) and it walks discovery → build → create for you.

After Claude creates a block, add it to a page in the zPortal page editor as usual. (This server manages blocks, not page layout.)

---

## How it works

- On first request the server logs in to your portal (`GET /auth/login?api_key=…&user_id=…`) to get a JWT session cookie, and also sends the API key as an `X-Api-Key` header on every call.
- If the session expires, it re-logs in automatically and retries once.
- Block reads/writes go through the Portal REST API under `/api/blocks`, `/api/datasources`, and `/api/queries`.
- `create_block` and `update_block` always set `type: "html"` and reject any other type **before** contacting the portal.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| "Missing portal credentials: …" | One of `PORTAL_URL` / `PORTAL_API_KEY` / `PORTAL_USER_ID` is blank. Re-enter it in the bundle's settings (or your client's `env`). |
| "Portal login failed: HTTP 401/403" | Wrong API key or user ID, or the user lacks permission. Regenerate the key and confirm the user can manage blocks. |
| `list_queries` says "pre-1.18 … use list_datasources" | Your portal predates the saved-queries API. Use `list_datasources` instead — this is expected, not an error. |
| Tools don't appear in Claude | Reinstall the `.mcpb`, or restart Claude Desktop. For the clone path, make sure `npm run build` succeeded and the `args` path points at `dist/index.js`. |
| Want to see what it's doing | Set `PORTAL_DEBUG=1` in the server's environment. Debug logs go to **stderr** only. |

---

## Development

```bash
npm install
npm run build                 # tsc -> dist/
PORTAL_DEBUG=1 npm start       # run locally on stdio (debug logs to stderr)

# Interactive testing with the MCP Inspector:
npx @modelcontextprotocol/inspector node dist/index.js
```

Project layout:

```
src/
  index.ts         # stdio entrypoint
  server.ts        # tools, resources, prompts
  portalClient.ts  # auth + request (login, X-Api-Key, 401 retry)
  config.ts        # credential resolution (env, then config.json)
  guidance.ts      # bundled authoring guidance (the zportal://guide resources)
manifest.json      # MCPB bundle manifest (Claude Desktop install + config prompts)
```

For local development you can also drop a `config.json` next to the project with a `portal` section instead of using env vars:

```json
{ "portal": { "url": "https://your-portal.zuarbase.net", "apiKey": "…", "userId": "…" } }
```

`config.json` is gitignored — never commit it.

---

## Building the .mcpb bundle

```bash
npm install -g @anthropic-ai/mcpb   # or use: npx @anthropic-ai/mcpb <cmd>
npm install
npm run build
npm prune --omit=dev                # production node_modules only
mcpb validate manifest.json
mcpb pack                           # -> zuar-portal-mcp.mcpb
```

`.mcpbignore` excludes `src/`, dev files, and any local `config.json` from the bundle. Attach the resulting `.mcpb` to a GitHub Release so non-developers can one-click install it.

---

## Security

- Credentials are **never logged**. Debug output (gated by `PORTAL_DEBUG=1`) goes to stderr only, so it never corrupts the MCP stdio stream.
- The API Key and User ID are declared **sensitive** in the bundle manifest — masked in the UI and stored securely by Claude Desktop.
- The server talks only to the Portal URL you configure.
- `create_block` / `update_block` are restricted to `type: "html"` and reject other types before any portal call.

---

## License

MIT. See [`LICENSE`](LICENSE).
