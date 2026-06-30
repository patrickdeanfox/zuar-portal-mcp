export const meta = {
  name: 'portal-block-pipeline',
  description: 'Build one Zuar Portal block through the full quality pipeline: build → style → responsive → debug → adversary (gate, loops) → visual (gate, loops) → advisor.',
  phases: [
    { title: 'Build', detail: 'discover data, author + bind the block, validate, create' },
    { title: 'Style', detail: 'apply the house design system' },
    { title: 'Responsive', detail: 'breakpoints, mobile, no overflow' },
    { title: 'Debug', detail: 'fix runtime footguns, verify live data' },
    { title: 'Adversary', detail: 'read-only red team gate (loops back to debug while blocking)' },
    { title: 'Visual', detail: 'open the rendered block in Claude for Chrome — visual gate, best-effort, loops back to debug' },
    { title: 'Advise', detail: 'business / data / UX alignment' },
  ],
}

// --- input ---------------------------------------------------------------
// Pass the spec via Workflow `args`: either a plain string, or
// { spec, page_id, tier, portal_url, visual }. tier ∈ 'fast' | 'standard' | 'max' (default 'standard').
// The Visual gate runs only when the block is placed on a page (page_id) AND visual !== false;
// pass portal_url so the agent can resolve the page URL without a round-trip. It is best-effort:
// when the Claude for Chrome extension isn't connected (or the page isn't viewable) it skips with a note.
const spec = typeof args === 'string' ? args : (args && args.spec) || ''
const pageId = args && typeof args === 'object' ? args.page_id : undefined
const portalUrl = args && typeof args === 'object' ? args.portal_url : undefined
const wantVisual = !(args && typeof args === 'object' && args.visual === false)
const doVisual = Boolean(pageId) && wantVisual
if (!spec) {
  log('No block spec provided in args. Pass args: "<what the block should show>" or { spec, page_id, tier }.')
}
const pagePart = pageId ? ` Place it on layout/page ${pageId} when complete.` : ''

// --- model / effort routing ----------------------------------------------
// Dial cost vs. quality for the WHOLE pipeline with one knob:
//   fast     — cheap iterative builds: sonnet/haiku at low effort, sonnet gates.
//   standard — balanced default: sonnet builders, haiku responsive, opus gates.
//   max      — premium complete build: opus builders/debug + xhigh judgment gates.
// These per-stage opts are set explicitly (not inherited) so routing is guaranteed
// regardless of the session/orchestrator model.
const tier = (args && typeof args === 'object' && args.tier) || 'standard'
const ROUTING = {
  fast: {
    build:      { model: 'sonnet', effort: 'low' },
    style:      { model: 'sonnet', effort: 'low' },
    responsive: { model: 'haiku',  effort: 'low' },
    debug:      { model: 'sonnet', effort: 'low' },
    adversary:  { model: 'sonnet', effort: 'medium' },
    visual:     { model: 'sonnet', effort: 'medium' },
    advisor:    { model: 'sonnet', effort: 'medium' },
  },
  standard: {
    build:      { model: 'sonnet', effort: 'medium' },
    style:      { model: 'sonnet', effort: 'medium' },
    responsive: { model: 'haiku',  effort: 'low' },
    debug:      { model: 'sonnet', effort: 'medium' },
    adversary:  { model: 'opus',   effort: 'high' },
    visual:     { model: 'opus',   effort: 'high' },
    advisor:    { model: 'opus',   effort: 'high' },
  },
  max: {
    build:      { model: 'opus',   effort: 'high' },
    style:      { model: 'opus',   effort: 'medium' },
    responsive: { model: 'sonnet', effort: 'low' },
    debug:      { model: 'opus',   effort: 'high' },
    adversary:  { model: 'opus',   effort: 'xhigh' },
    visual:     { model: 'opus',   effort: 'xhigh' },
    advisor:    { model: 'opus',   effort: 'xhigh' },
  },
}
const R = ROUTING[tier] || ROUTING.standard
log(`Routing tier: ${tier} — builders=${R.build.model}/${R.build.effort}, gates=${R.adversary.model}/${R.adversary.effort}`)

// --- schemas -------------------------------------------------------------
const BUILD = {
  type: 'object',
  required: ['block_id', 'validate'],
  properties: {
    block_id: { type: 'string' },
    name: { type: 'string' },
    query_id: { type: ['string', 'null'] },
    columns: { type: 'array', items: { type: 'string' } },
    validate: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
}
const STAGE = {
  type: 'object',
  required: ['changed'],
  properties: {
    block_id: { type: 'string' },
    changed: { type: 'string', description: 'what this stage changed' },
    notes: { type: 'string', description: 'hand-off notes for the next stage' },
  },
}
const ADVERSARY = {
  type: 'object',
  required: ['verdict', 'blocking_count', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['ship', 'needs-fixes'] },
    blocking_count: { type: 'integer' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
          issue: { type: 'string' },
          evidence: { type: 'string' },
          blocking: { type: 'boolean' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}
const VISUAL = {
  type: 'object',
  required: ['verdict', 'blocking_count', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['ship', 'needs-fixes'] },
    blocking_count: { type: 'integer' },
    skipped: { type: 'boolean', description: 'true when the block could not be viewed (extension off / not on a page / login screen)' },
    rendered: { type: ['boolean', 'null'] },
    live_data: { type: ['boolean', 'null'], description: 'shows live query data, not the hardcoded sample fallback' },
    console_clean: { type: ['boolean', 'null'] },
    no_overflow: { type: ['boolean', 'null'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
          issue: { type: 'string' },
          evidence: { type: 'string' },
          blocking: { type: 'boolean' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}
const ADVISOR = {
  type: 'object',
  required: ['verdict'],
  properties: {
    verdict: { type: 'string' },
    must: { type: 'array', items: { type: 'string' } },
    nice: { type: 'array', items: { type: 'string' } },
  },
}

// --- pipeline ------------------------------------------------------------
// These stages all mutate ONE block, so they run sequentially (never parallel
// update_block on the same block).
phase('Build')
const build = await agent(
  `Build a Zuar Portal block for this spec: ${spec}.${pagePart} Discover the datasource, verify the real ` +
    `columns, author the two-field block, bind via ui_queries (page_size null), validate_block, and create it. ` +
    `Return the block_id, the bound query_id + exact columns, the validate result, and hand-off notes.`,
  { agentType: 'portal-block-builder', ...R.build, schema: BUILD, label: 'build', phase: 'Build' }
)
if (!build || !build.block_id) {
  log('Builder did not return a block_id — stopping. ' + (build && build.open_questions ? JSON.stringify(build.open_questions) : ''))
  return { ok: false, reason: 'build_failed', build }
}
const blockId = build.block_id
log(`Built block ${blockId} (${build.name || 'unnamed'}). validate.valid=${build.validate && build.validate.valid}`)

phase('Style')
const styled = await agent(
  `Apply the house design system to block ${blockId}. Builder notes: ${build.notes || '(none)'}. ` +
    `Restyle the css and refine markup for executive-grade UI/UX WITHOUT breaking the JS or the binding ` +
    `(get_block first, re-send ui_queries on update_block). validate_block, then update.`,
  { agentType: 'portal-block-stylist', ...R.style, schema: STAGE, label: 'style', phase: 'Style' }
)

phase('Responsive')
const responsive = await agent(
  `Make block ${blockId} responsive across breakpoints (KPI/grid collapse, charts stack, table scroll, ` +
    `touch targets, no overflow). Preserve the binding (re-send ui_queries). Stylist notes: ${styled && styled.notes || '(none)'}.`,
  { agentType: 'portal-responsive-specialist', ...R.responsive, schema: STAGE, label: 'responsive', phase: 'Responsive' }
)

phase('Debug')
let debug = await agent(
  `Debug and verify block ${blockId}: confirm column constants match the bound query's real aliases (the #1 ` +
    `blank-block cause), no $ trap, page_size correct, async loaded-callback present if needed, dispose-on-reload, ` +
    `live rows actually flow. Fix minimally, re-validate, update preserving ui_queries. Style/responsive notes: ` +
    `${[styled && styled.notes, responsive && responsive.notes].filter(Boolean).join(' | ') || '(none)'}.`,
  { agentType: 'portal-block-debugger', ...R.debug, schema: STAGE, label: 'debug', phase: 'Debug' }
)

phase('Adversary')
let adversary = await agent(
  `Adversarially review block ${blockId} (read-only). Hunt the silent-data traps, the $ trap, unscoped-CSS ` +
    `collisions, missing loaded-callback, re-render leaks, edge cases (empty/null/huge data), a11y, and unsafe JS. ` +
    `Verify with execute_query/validate_block. Return findings with severity + evidence + blocking, a blocking_count, and a verdict.`,
  { agentType: 'portal-block-adversary', ...R.adversary, schema: ADVERSARY, label: 'adversary', phase: 'Adversary' }
)

// Loop: while the gate finds blocking issues, send them back to the debugger (max 2 rounds).
let round = 0
while (adversary && adversary.verdict === 'needs-fixes' && adversary.blocking_count > 0 && round < 2) {
  round++
  const blockers = (adversary.findings || []).filter((f) => f.blocking)
  log(`Adversary flagged ${adversary.blocking_count} blocking issue(s) — fix round ${round}.`)
  debug = await agent(
    `Fix ONLY these blocking findings on block ${blockId}, then re-validate and update preserving ui_queries: ` +
      JSON.stringify(blockers),
    { agentType: 'portal-block-debugger', ...R.debug, schema: STAGE, label: `fix-r${round}`, phase: 'Debug' }
  )
  adversary = await agent(
    `Re-review block ${blockId} after the round-${round} fixes. Same hunt list; confirm the previously-blocking issues are resolved.`,
    { agentType: 'portal-block-adversary', ...R.adversary, schema: ADVERSARY, label: `adversary-r${round}`, phase: 'Adversary' }
  )
}

// Visual gate — open the rendered block and SEE it. Runs only when the block is on a page
// (it needs a URL) and visual isn't disabled. Best-effort: the adversary (now eyes-equipped)
// returns verdict:'ship' with skipped:true when the extension isn't connected or the page
// isn't viewable, so it never hard-blocks. A blocking visual failure loops back to the debugger.
let visual = null
if (doVisual) {
  phase('Visual')
  const visualPrompt =
    `VISUAL gate for block ${blockId} (read-only) — the block is placed on page ${pageId}. Read ` +
    `zportal://guide/visual-verification first, then open the live portal in Claude for Chrome and SEE it ` +
    `render: ${portalUrl ? `portal base ${portalUrl}; ` : ''}resolve the page URL (active_config for the base, ` +
    `the layout/page slug; pages route as <base>/p/<slug>), navigate, screenshot the block's grid cell, read the ` +
    `console, and read the network if data looks empty. Confirm it RENDERS, shows LIVE data (not the hardcoded ` +
    `sample — cross-check one value with execute_query), the console is CLEAN, and nothing OVERFLOWS. If the ` +
    `Chrome tools aren't connected or the page isn't viewable (e.g. a login screen), DO NOT fail: return ` +
    `verdict:'ship' with skipped:true and a finding noting why. Otherwise a clear visual failure is a blocking ` +
    `finding. Return rendered/live_data/console_clean/no_overflow, findings (severity+evidence+blocking), ` +
    `blocking_count, and a verdict.`
  visual = await agent(visualPrompt, { agentType: 'portal-block-adversary', ...R.visual, schema: VISUAL, label: 'visual', phase: 'Visual' })
  if (visual && visual.skipped) {
    log('Visual gate skipped (block not viewable / extension not connected) — code-only gates stand.')
  }

  // Loop: a blocking VISUAL failure goes back to the debugger (who can also reproduce visually).
  let vround = 0
  while (visual && visual.verdict === 'needs-fixes' && visual.blocking_count > 0 && !visual.skipped && vround < 2) {
    vround++
    const vblockers = (visual.findings || []).filter((f) => f.blocking)
    log(`Visual gate flagged ${visual.blocking_count} blocking issue(s) — fix round ${vround}.`)
    debug = await agent(
      `Fix ONLY these VISUAL blocking findings on block ${blockId} (it renders on page ${pageId}); reproduce with ` +
        `Claude for Chrome if available, fix minimally, re-validate, and update preserving ui_queries: ` +
        JSON.stringify(vblockers),
      { agentType: 'portal-block-debugger', ...R.debug, schema: STAGE, label: `visual-fix-r${vround}`, phase: 'Debug' }
    )
    visual = await agent(
      `Re-run the VISUAL gate for block ${blockId} after the round-${vround} fixes: re-navigate, re-screenshot, ` +
        `re-read the console; confirm the previously-blocking visual issues are resolved. Same skip-don't-fail rule.`,
      { agentType: 'portal-block-adversary', ...R.visual, schema: VISUAL, label: `visual-r${vround}`, phase: 'Visual' }
    )
  }
}

phase('Advise')
const advisor = await agent(
  `Advise on block ${blockId} (read-only): does it answer the business question, is the metric/SQL correct, is the ` +
    `viz the best fit for the data shape, is the altitude right, what's missing? Return a verdict + prioritized must/nice improvements.`,
  { agentType: 'portal-block-advisor', ...R.advisor, schema: ADVISOR, label: 'advisor', phase: 'Advise' }
)

return {
  ok: true,
  tier,
  block_id: blockId,
  name: build.name,
  bound_query: build.query_id,
  fix_rounds: round,
  adversary_verdict: adversary && adversary.verdict,
  open_blocking: adversary && adversary.blocking_count,
  visual_ran: doVisual,
  visual_verdict: visual && visual.verdict,
  visual_skipped: visual ? Boolean(visual.skipped) : null,
  visual_findings: visual && visual.findings,
  advisor,
  build,
}
