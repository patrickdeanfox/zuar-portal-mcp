# Zuar Portal Blocks — MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets Claude build and manage
**Zuar Portal (zPortal) HTML blocks** for you. Claude can discover your datasources,
preview real data, and create/update/delete HTML blocks through the Portal REST API —
with bundled authoring guidance so the blocks it produces follow zPortal conventions.

Only **HTML blocks** are created or modified. Other block types are visible via
`list_blocks` but this server will not create or change them.

## What Claude can do with it

Tools:

- `list_blocks` — list blocks (optionally by ID, or names only)
- `get_block` — fetch one block by UUID
- `create_block` — create an HTML block (full payload: name, data, css, json_data, tags, access)
- `update_block` — update an HTML block (only the fields you pass)
- `delete_block` — delete a block by UUID
- `list_datasources` — find the `__source__` UUID and name of a datasource
- `list_queries` — saved queries (Portal 1.18+)
- `fetch_sample_rows` — preview a few rows so blocks get wired to real columns

Resources (authoring guidance Claude reads before building):

- `zportal://guide/block-structure`
- `zportal://guide/currentblock`
- `zportal://guide/amcharts-loader`

Prompt: `create_zportal_block` — a guided "discover data → build → create" workflow.

## Credentials

You need three values from your portal:

| Value | Where |
|-------|-------|
| Portal URL | e.g. `https://your-portal.zuarbase.net` |
| Portal API Key | zPortal → Admin → Auth → API Keys |
| Portal User ID | zPortal → Admin → Users → your user → copy the UUID from the URL |

The server authenticates by logging in for a JWT session cookie and also sending the
API key as an `X-Api-Key` header; it re-logs in automatically if the session expires.
Credentials stay on the machine running the server and are passed in via environment
variables (or the bundle's secure config prompts).

## Install — Claude Desktop (one-click bundle)

1. Build the bundle (see "Build the .mcpb" below) or use a prebuilt `zuar-portal-mcp-server.mcpb`.
2. Open it with Claude Desktop. You'll be prompted for Portal URL, API Key, and User ID
   (the last two are stored securely).
3. Done — the tools appear in Claude.

## Install — Claude Code / npx

After publishing to npm (or from a local clone with `npm run build`), register it in your
MCP client config:

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

To run from a local clone instead of npm, use `"command": "node"` and
`"args": ["/absolute/path/to/zuar-portal-mcp/dist/index.js"]`.

## Develop

```bash
npm install
npm run build          # tsc -> dist/
PORTAL_DEBUG=1 npm start   # run locally on stdio (debug logs to stderr)
npx @modelcontextprotocol/inspector node dist/index.js   # interactive testing
```

## Build the .mcpb

```bash
npm install -g @anthropic-ai/mcpb
npm install
npm run build
npm install --omit=dev      # production node_modules for the bundle
mcpb pack                   # -> zuar-portal-mcp-server.mcpb
```

`.mcpbignore` excludes `src/`, dev files, and any local `config.json` from the bundle.

## Security notes

- Credentials are never logged. Debug logs (gated by `PORTAL_DEBUG=1`) go to stderr only,
  so they never corrupt the MCP stdio stream.
- The server talks only to the Portal URL you configure.
- `create_block`/`update_block` are restricted to `type: "html"` and reject other types
  before any portal call.

## License

MIT. See `LICENSE`.
