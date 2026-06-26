# Zuar Portal MCP — Autonomous Automation Patterns

The MCP turns a Zuar Portal into a **closed-loop control surface** an AI can drive unattended. Every loop is the same four primitives, and the server provides all of them:

1. **Discover** — `list_blocks` / `get_block` / `list_resource` / `describe_resource` / `fetch_sample_rows` / `execute_query`
2. **Act** — `create_block` / `update_block` / `bind_block_query` / `add_block_to_page` / `create_resource` / `update_resource`
3. **Verify** — block validation (the 17 authoring rules run on every write), `execute_query` (do the columns match the block's constants?), plus live render + console checks via a browser MCP
4. **Checkpoint / revert** — `snapshot_portal`, `vc_log`, `restore_resource` (git-backed, one-call undo)

Because *act* is validated and *checkpoint* is automatic, an agent can iterate without a human babysitting it — and roll back cleanly when a step regresses.

## The automation building blocks

| Layer | Role |
|-------|------|
| **MCP tools** | The hands — read/write the portal deterministically over the REST API |
| **Custom agents / subagents** | Parallel workers — fan one job across many blocks/pages at once, each in its own context |
| **Workflows** | Deterministic orchestration — `pipeline`/`parallel` fan-out, loop-until-clean, find→fix→verify stages |
| **Schedules (cron)** | Unattended runs — nightly QA sweeps, weekly doc regen, post-deploy canaries |
| **Version control** | The safety net + audit trail — snapshot before a run, revert any bad change, diff what the AI did |

## Patterns (each is a loop)

**Autonomous build loop** — *spec → working block.*
`fetch_sample_rows`/`execute_query` to learn real columns → `create_block` (validation gate) → `bind_block_query` → `add_block_to_page` → render & screenshot via browser MCP → if empty/errored, diagnose and `update_block` → repeat until the page renders clean. `snapshot_portal` at the end.

**Debug & QA loop (existing blocks)** — *sweep → diagnose → fix → re-verify.*
`list_blocks` → for each, `get_block` + run its bound `execute_query` and assert the returned columns match the block's column constants (the #1 cause of empty blocks) → re-validate the HTML against the rules → load the page in a browser MCP and read the console for runtime errors → `update_block` fixes, then re-verify only the touched blocks. Run it **nightly on a schedule**; revert any fix that regresses with `restore_resource`.

**Bulk style changes** — *one rule, every block, in parallel.*
`list_blocks` → fan out with subagents/`parallel`: each rewrites hardcoded hex to `var(--token,…)`, scopes CSS under `.wrapper`, or swaps a chart palette → `update_block` (validation blocks anything unsafe) → loop-until the theme-var rule reports zero violations. `snapshot_portal` first so the whole batch is one revertible checkpoint.

**Theming a portal** — *tokens → consistent surfaces.*
`create_resource`/`update_resource` (resource `theme`) to set palette/typography tokens in `json_data` → fan a restyle agent across blocks to consume the new `var(--…)` tokens and the house design system → verify visually via browser MCP across breakpoints (lg/md/sm) → commit.

**Documentation & user guides** — *portal state → published docs.*
`list_resource` over `layout`, `datasource`, `query`, `theme`, plus `list_blocks`/`get_block`, to read the live portal → an agent generates Markdown/PDF admin docs and end-user guides (what each page shows, which datasource feeds it, how filters cascade) → optionally publish them back as `markdown`/`text-area` blocks. **Schedule it** so the docs regenerate whenever the portal changes.

## Guardrails for unattended runs

- **Scope the blast radius**: leave `data`/`admin` writes off (default) so loops touch only content; flip on per-run when needed.
- **Validation is the pre-commit gate**: bad blocks are rejected *before* they reach the portal — agents iterate against the error list.
- **Checkpoint then act**: `snapshot_portal` before a batch; `restore_resource` reverts any single bad change without unwinding the good ones.
- **Portable**: the same loops run under Claude Code, a scheduled cloud agent, or any MCP client — no portal-side code to maintain.
