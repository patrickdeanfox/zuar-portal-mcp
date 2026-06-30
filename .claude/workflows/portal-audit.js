export const meta = {
  name: 'portal-audit',
  description: 'Audit existing Zuar Portal blocks for bugs, silent-data traps, a11y, responsiveness, and design/business fit. Read-only; produces a ranked report.',
  phases: [
    { title: 'Discover', detail: 'list the blocks in scope' },
    { title: 'Review', detail: 'adversary (bugs/traps) + advisor (fit) per block, in parallel' },
    { title: 'Synthesize', detail: 'rank findings and summarize' },
  ],
}

// Optional filter via args: a string name/prefix, or { filter, limit, tier }.
const filter = typeof args === 'string' ? args : (args && args.filter) || ''
const MAX = (args && typeof args === 'object' && args.limit) || 40

// --- model / effort routing ----------------------------------------------
// The auditors ARE the product here, so the review gates carry the weight.
//   fast     — cheap sweep: sonnet reviewers, sonnet summary.
//   standard — balanced default: opus reviewers, sonnet summary.
//   max       — deepest audit: opus/xhigh reviewers, opus summary.
// Discovery is a mechanical list_blocks call — always cheap.
const tier = (args && typeof args === 'object' && args.tier) || 'standard'
const ROUTING = {
  fast:     { discover: { model: 'haiku', effort: 'low' }, review: { model: 'sonnet', effort: 'medium' }, summary: { model: 'sonnet', effort: 'low' } },
  standard: { discover: { model: 'haiku', effort: 'low' }, review: { model: 'opus',   effort: 'high' },   summary: { model: 'sonnet', effort: 'medium' } },
  max:      { discover: { model: 'haiku', effort: 'low' }, review: { model: 'opus',   effort: 'xhigh' },  summary: { model: 'opus',   effort: 'high' } },
}
const R = ROUTING[tier] || ROUTING.standard
log(`Routing tier: ${tier} — reviewers=${R.review.model}/${R.review.effort}, summary=${R.summary.model}/${R.summary.effort}`)

// --- schemas -------------------------------------------------------------
const LIST = {
  type: 'object',
  required: ['blocks'],
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { block_id: { type: 'string' }, name: { type: 'string' } },
        required: ['block_id'],
      },
    },
    total: { type: 'integer' },
  },
}
const ADVERSARY = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['ship', 'needs-fixes'] },
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
  properties: {
    verdict: { type: 'string' },
    must: { type: 'array', items: { type: 'string' } },
    nice: { type: 'array', items: { type: 'string' } },
  },
}

// --- discover ------------------------------------------------------------
phase('Discover')
const listing = await agent(
  `List the portal's blocks with list_blocks. ${filter ? `Only those whose name matches/contains "${filter}". ` : ''}` +
    `Return up to ${MAX} as {block_id, name} pairs and the total count. Use get_block only if you need an id you can't get from list_blocks.`,
  { ...R.discover, schema: LIST, label: 'discover', phase: 'Discover' }
)
const blocks = ((listing && listing.blocks) || []).slice(0, MAX)
if (!blocks.length) {
  log('No blocks matched — nothing to audit.')
  return { ok: true, audited: 0, blocks: [] }
}
if (listing.total && listing.total > blocks.length) {
  log(`Auditing ${blocks.length} of ${listing.total} blocks (capped at ${MAX}). Pass args:{limit} to widen.`)
}

// --- review (each block: adversary + advisor in parallel) ----------------
phase('Review')
const reviewed = await pipeline(
  blocks,
  (b) =>
    parallel([
      () =>
        agent(
          `Adversarially review block ${b.block_id} ("${b.name || ''}") read-only: hunt the silent-data traps ` +
            `(column mismatch / fallback, page_size truncation), the $ trap, unscoped CSS, missing loaded-callback, ` +
            `re-render leaks, edge cases, a11y, unsafe JS. Verify with execute_query/validate_block. Return findings + verdict.`,
          { agentType: 'portal-block-adversary', ...R.review, schema: ADVERSARY, label: `bug:${b.name || b.block_id}`, phase: 'Review' }
        ),
      () =>
        agent(
          `Advise on block ${b.block_id} ("${b.name || ''}") read-only: business/data/UX fit — right question, correct ` +
            `metric, best viz for the data shape, right altitude, what's missing. Return verdict + must/nice.`,
          { agentType: 'portal-block-advisor', ...R.review, schema: ADVISOR, label: `fit:${b.name || b.block_id}`, phase: 'Review' }
        ),
    ]).then(([adversary, advisor]) => ({ block: b, adversary, advisor }))
)

// --- synthesize ----------------------------------------------------------
phase('Synthesize')
const clean = reviewed.filter(Boolean)
const flat = []
for (const r of clean) {
  for (const f of (r.adversary && r.adversary.findings) || []) {
    flat.push({ block_id: r.block.block_id, name: r.block.name, ...f })
  }
}
const order = { blocking: 0, major: 1, minor: 2, nit: 3 }
flat.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
const blockingCount = flat.filter((f) => f.blocking).length
log(`Audited ${clean.length} blocks — ${flat.length} findings, ${blockingCount} blocking.`)

const summary = await agent(
  `Write a concise audit report for ${clean.length} Zuar Portal blocks. Group the findings by severity (blocking first), ` +
    `call out the systemic patterns (e.g. the same footgun across many blocks), and end with a prioritized fix list that ` +
    `maps each blocking/major item to the block id and the suggested fix (these can be sent through /portal-build's debugger stage). ` +
    `Findings JSON: ${JSON.stringify(flat).slice(0, 12000)}`,
  { ...R.summary, label: 'synthesize', phase: 'Synthesize' }
)

return {
  ok: true,
  tier,
  audited: clean.length,
  findings: flat.length,
  blocking: blockingCount,
  report: summary,
  per_block: clean.map((r) => ({
    block_id: r.block.block_id,
    name: r.block.name,
    adversary_verdict: r.adversary && r.adversary.verdict,
    advisor_verdict: r.advisor && r.advisor.verdict,
  })),
}
