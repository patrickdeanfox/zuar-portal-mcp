# 07 · Version Control `[2.2.0]`

Mirror portal **content** into a git repo and auto-commit every change the MCP makes, so any change can
be reverted — without a portal "undo" feature. Source of truth stays the portal; git is a safety
mirror.

## Enabling it
Set **`PORTAL_VC_DIR`** to a git repo path (the server runs `git init` if needed) and restart. When
unset, every VC function is a **no-op** (the feature is fully opt-in).

```bash
PORTAL_VC_DIR=~/zuar-portal-state          # enable
PORTAL_VC_PUSH=1                           # (optional) git push after each commit
PORTAL_VC_REMOTE=origin                    # (optional) remote name, default origin
```

Or configure it entirely in `config.json` (env vars override this; `config.json` is gitignored, so
secrets stay local). With `remote_url` (+ a `token` for HTTPS) the server **creates/points the remote
and configures push auth for you** — no `gh`/SSH/credential-helper setup needed, which makes
**other machines** plug-and-play `[2.3.0]`:
```json
{ "portal": { "url": "…", "apiKey": "…", "userId": "…" },
  "vc": {
    "dir": "/abs/path/zuar-portal-state",
    "push": true,
    "remote": "origin",
    "remote_url": "https://github.com/you/zuar-portal-state.git",
    "token": "<PAT with repo scope>",
    "username": "x-access-token"
  } }
```
**How the token is handled:** it's applied as a git HTTPS auth header in the state repo's **local**
`.git/config` (and read from your gitignored `config.json`) — it is **never logged**, never echoed by
`vc_status` (which shows only `tokenConfigured: true`), and never written to a tracked file. Omit
`token` to use the machine's existing git auth (gh / credential helper / SSH). Prefer a **fine-grained
PAT scoped to just the state repo**. For SSH instead, set `remote_url` to a `git@…` URL and skip the
token (key-based auth).

GitHub setup (creates the repo, clones it locally, then point `PORTAL_VC_DIR` at the clone):
```bash
gh repo create zuar-portal-state --private --clone   # creates + clones into ./zuar-portal-state
# set PORTAL_VC_DIR to that path, PORTAL_VC_PUSH=1, and restart the MCP
```

First run: **`snapshot_portal`** to seed the baseline. Confirm with **`vc_status`**.

> Like all `[2.2.0]` features, version control only runs once the **v2.2.0 build is live**
> (`npm run build` + `.mcpb` repack + restart) — see [02 · Updating](02-install-and-config.md#updating-after-code-changes).

## What gets tracked
**Content resources only** (matching the content write domain):
`block`, `layout` (pages), `query`, `theme`, `partial`, `snippet`, `translation`, `dashboard`, `tag`.

**Not tracked:** datasources/db_modifications (data domain) and users/groups/credentials/config (admin
domain) — they can contain SQL or secrets and are out of the content scope.

On disk: `<PORTAL_VC_DIR>/<kind>/<id>.json`, one pretty-printed JSON file per record, plus a `README.md`.

## Auto-commit behavior
Every successful content write commits automatically:
- `create_resource` / `update_resource` / `delete_resource` (content domain) — this also covers
  `add_block_to_page` / `remove_block_from_page` (they update the `layout`).
- `create_block` / `update_block` / `delete_block` / `bind_block_query` (and the query it auto-creates).

Commit messages read like `create block <id>`, `update layout <id>`, `delete query <id>`. Commits only
happen when the file actually changed. **Best-effort:** a git failure is logged and swallowed — it never
breaks the underlying portal write.

## Tools
| Tool | Purpose |
|------|---------|
| `vc_status` | Is VC enabled, repo path, push config. |
| `snapshot_portal` | Export **all** content (incl. blocks) and commit. Seed once; checkpoint anytime. Accepts `message`. |
| `vc_log` | Recent commits, optionally scoped to one record (`resource` + `id`). Returns hashes. |
| `restore_resource` | Revert a record to a prior version and write it back to the portal. |

## Reverting a change
```
# 1. See history for a record
vc_log { "resource": "block", "id": "<block-id>" }
#   -> [{hash, date, message}, ...]

# 2a. Undo the most recent change to it (omit ref)
restore_resource { "resource": "block", "id": "<block-id>" }

# 2b. Or restore a specific earlier version
restore_resource { "resource": "block", "id": "<block-id>", "ref": "<hash from vc_log>" }
```
`restore_resource` reads the JSON at that ref, writes it back via the normal block/resource update path
(so it's validated and re-committed as the new state). For `resource` pass `"block"` or a content key
(`layout`, `query`, `theme`, `partial`, `snippet`, `translation`, `dashboard`, `tag`). Omitting `ref`
restores the version **before the latest change** to that record (i.e. "undo last edit").

> Edge cases: if a record has only its baseline snapshot (no later edit), there's no earlier version
> to undo to — `restore_resource` returns an error; use `vc_log` to pick an explicit `ref`. Restore is
> a **content write** through the validated update path, so it's blocked by `PORTAL_READONLY=1` and a
> restored block must still pass `validateBlock`.

## Limitations & notes
- **Not retroactive:** changes made before VC was enabled (or before the v2.2.0 build is live) aren't in
  history. Run `snapshot_portal` to capture the current state as a baseline.
- **Content only** by design — see scope above.
- **The portal is the source of truth.** If someone edits a block in the portal UI (not via the MCP),
  git won't see it until the next MCP write to that record or the next `snapshot_portal`. Run periodic
  snapshots (see [11 · Loops & Automation](11-loops-and-automation.md)) to capture out-of-band edits.
- **Restore writes back** through the validated update path, so a restored block must still pass
  `validateBlock`.

## Recommended workflow
1. `snapshot_portal` to seed.
2. Work normally — every MCP content change auto-commits.
3. Before a big/risky change, `snapshot_portal { message: "before <change>" }` for a named checkpoint.
4. If something breaks, `vc_log` → `restore_resource`.
5. (Optional) schedule a daily `snapshot_portal` to capture portal-UI edits too.
