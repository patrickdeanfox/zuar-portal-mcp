# 11 · Loops & Automation

The MCP provides the **tools**; your client's **loop/schedule** features drive them repeatedly for
automation and data exploration. In Claude Code that's **`/loop`** (run a prompt/command on an interval
or self-paced) and **`/schedule`** (cron-style cloud routines / one-off scheduled runs). This doc shows
patterns; the loop machinery itself is a client capability, not an MCP tool.

> **Safety first.** Loops amplify whatever they do. Keep these in mind:
> - **Reads are safe** — `list_resource`, `get_*`, `fetch_sample_rows`, `execute_query`, `vc_log`,
>   `describe_resource` never write. Data-exploration loops should use only these.
> - **Write loops** respect the [safety domains](02-install-and-config.md) — data/admin stay off unless
>   enabled, and `run_db_modification` still needs `confirm:true`.
> - With [version control](07-version-control.md) on, every content write a loop makes is committed, so
>   a runaway authoring loop is **revertible** (`vc_log` → `restore_resource`, or `git reset` in the VC
>   repo). Snapshot before a big automated batch.

## Data exploration patterns (read-only, safe)

**Profile every datasource.** Loop over `list_resource datasource`, and for each run
`fetch_sample_rows` (or `execute_query` on a profiling query) to collect distinct categorical values
and numeric ranges — the inputs for designing filters, KPIs, and charts. One pass turns "what's in this
portal?" into a structured map.

**Iterative discovery.** A self-paced loop that keeps asking "what datasource/column haven't I
characterized yet?" until coverage is complete — useful before a large build.

**Metric watch (read).** On a schedule, `execute_query` a KPI query and compare to a threshold; surface
a summary. Pure observation — no writes.

## Automation patterns (writes — use the safety net)

**Scheduled portal backup `[2.2.0]`.** A `/schedule` routine that runs `snapshot_portal` daily commits
the current portal state — capturing even edits made in the portal UI (which auto-commit can't see). A
cheap, durable safety net; push to GitHub with `PORTAL_VC_PUSH=1`.

**Bulk / templated build.** Drive [recipe 9](10-recipes.md) over a work-list: for each target
(datasource + labels + accent), create+bind+place its blocks. Build and verify **one** target first,
then loop the rest. Snapshot before, so the whole batch is one revertible range.

**Refresh / reconcile.** Periodically reconcile a set of blocks against changed query columns: read the
query's real columns (`execute_query`), and where they drift from a block's constants, `update_block`.

**Post-change verification loop.** After a batch, loop a quick check (e.g. `execute_query` per page's
query returns rows; `get_block` shows expected `ui_queries`) and report anything off.

## Choosing the cadence (Claude Code `/loop`)
- **Actively polling external state** (a deploy, a CI run, a slowly-changing metric): short intervals.
- **Idle/periodic** (daily snapshot, nightly reconcile): use `/schedule` (cron) rather than a tight loop.
- **Self-paced exploration**: let the model decide when it's "done" (coverage reached) rather than a
  fixed count.

## A worked example: nightly backup + drift report
1. `/schedule` a nightly routine.
2. Routine body: `snapshot_portal { message:"nightly" }`, then `vc_log { limit: 50 }` to summarize what
   changed in the last day, then (optional) `execute_query` a few KPIs and note anomalies.
3. With `PORTAL_VC_PUSH=1`, the snapshot is pushed to GitHub — off-box history you can diff/revert.

## Guardrails checklist for any write loop
- [ ] `snapshot_portal` first (named checkpoint).
- [ ] Only the domains you need are enabled; everything else stays off.
- [ ] Verify one iteration before unleashing the rest.
- [ ] A stop condition (count, coverage, or budget) — don't loop unbounded.
- [ ] A post-loop verification + `vc_log` review; revert with `restore_resource` if needed.
