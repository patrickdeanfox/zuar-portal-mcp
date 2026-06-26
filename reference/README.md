# reference/

Reference material the MCP server does **not** load at runtime. Kept in the repo
for authoring, debugging, and grounding agents — excluded from the `.mcpb` bundle
(see `.mcpbignore`) so it never bloats the shipped server.

| Path | What it is |
|------|------------|
| `portal_swagger_docs.json` | Zuar Portal main REST API (Swagger 2.0, "ZUAR Embedded Analytics"). The full `/api/*` surface. |
| `portal_swagger_auth_docs.json` | Auth service (OpenAPI 3.1, "ZUAR WAF — Authentication"). The `/auth/*` surface. |
| `corpus/portal_block_eaxamples*.json` | ~510 real exported portal blocks across portal versions. Ground truth for block conventions and the v1.18/v1.19 `queryResults` shape. **Gitignored** (may contain customer data) — local only. |

These are the primary sources behind `src/rules.ts` (authoring conventions),
`assets/conventions.md`, and the agent playbooks under `.claude/`. When the portal
API or block shape is in question, check the swagger + corpus here rather than
guessing.
