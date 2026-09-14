import type { Endpoint, Order, OrderState, Run, RunTask, StageKind } from '@/types'
import { endpointRole } from '@/types'

/* ============================================================
   Journey model — the BPMN view of one provisioning request.

   Two graphs come out of here. The request process is the fixed
   lifecycle every request walks (raised → pre-validated → reviewed →
   queued → executed → landed), with the alternate paths — invalid,
   rejected, failed, retried — drawn alongside. The execution
   sub-process is what one attempt actually did on each device:
   every task of the bound workflow as a BPMN task, the point where
   the run broke marked as an error boundary event, and the path it
   took from there (roll back, abort the far end, wait for the
   Source) drawn as the alternate flow it really was.

   Nothing here renders. The component decides how a node looks;
   this decides what the nodes are, where they sit, and which of
   them the request actually visited.
   ============================================================ */

export type JTone = 'brand' | 'good' | 'warn' | 'crit' | 'plum' | 'teal' | 'none'
export type JShape =
  | 'start' | 'end' | 'end-error' | 'task' | 'user' | 'service' | 'gateway'
  | 'subprocess' | 'data' | 'compensate'
export type JVisit = 'done' | 'current' | 'off'
export type JPort = 'left' | 'right' | 'top' | 'bottom'

export interface JDetail {
  title: string
  facts: [string, string][]
  note?: string
  noteTone?: 'info' | 'warn' | 'crit' | 'good'
  /** A task node carries the run task behind it so the panel can open the transcript. */
  task?: RunTask
  runId?: string
  endpointId?: string
  link?: { to: string; label: string }
}

export interface JNode {
  id: string
  shape: JShape
  label: string
  sub?: string
  /** Centre of the shape. */
  x: number
  y: number
  w: number
  h: number
  visit: JVisit
  tone: JTone
  /** Step at which the token reaches this node — drives the light-up animation. */
  step?: number
  /** Attached boundary event, drawn on the bottom-right corner. */
  boundary?: 'error' | 'compensate'
  /** Small marker text, e.g. "×2" for a loop taken twice. */
  marker?: string
  /** Where an event's or gateway's label sits; below unless a branch leaves downward. */
  labelPos?: 'above' | 'below'
  detail: JDetail
}

export interface JEdge {
  id: string
  from: string
  to: string
  fromPort?: JPort
  toPort?: JPort
  /** Waypoints, absolute. A partial point takes its missing coordinate from the previous one. */
  via?: { x?: number; y?: number }[]
  label?: string
  kind: 'seq' | 'msg' | 'assoc'
  taken: boolean
  tone: JTone
  /** How many times the request went down this edge, when more than once. */
  count?: number
  /** Position in the animation sequence. */
  step?: number
}

export interface JLane {
  id: string
  label: string
  sub?: string
  y: number
  h: number
  tone: JTone
  endpointId?: string
  runId?: string
  detail: JDetail
}

export interface JGroup {
  id: string
  label: string
  kind: StageKind
  x: number
  y: number
  w: number
  h: number
}

export interface JGraph {
  nodes: JNode[]
  edges: JEdge[]
  lanes: JLane[]
  groups: JGroup[]
  width: number
  height: number
  /** Edge ids in the order the token travels them — the replay path. */
  story: string[]
}

const fmt = (iso?: string) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, `
    + d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })
}
const dur = (ms?: number) => {
  if (ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

/* ------------------------------------------------------------------
   Attempts — the unit the request process loops on.
   ------------------------------------------------------------------ */

export interface Attempt {
  n: number
  runs: Run[]
  outcome: 'accepted' | 'failed' | 'running'
  startedAt?: string
  endedAt?: string
}

/** Runs grouped by attempt number, oldest first, each judged as a whole. */
export function attemptsOf(runs: Run[]): Attempt[] {
  const byN = new Map<number, Run[]>()
  runs.forEach((r) => byN.set(r.attempt, [...(byN.get(r.attempt) ?? []), r]))
  return [...byN.entries()].sort((a, b) => a[0] - b[0]).map(([n, rs]) => {
    const starts = rs.map((r) => Date.parse(r.startedAt)).filter((x) => !Number.isNaN(x))
    const ends = rs.map((r) => (r.endedAt ? Date.parse(r.endedAt) : NaN)).filter((x) => !Number.isNaN(x))
    return {
      n, runs: rs,
      outcome: rs.some((r) => r.outcome === 'Running') ? 'running'
        : rs.every((r) => r.outcome === 'Accepted') ? 'accepted' : 'failed',
      startedAt: starts.length ? new Date(Math.min(...starts)).toISOString() : undefined,
      endedAt: ends.length === rs.length && ends.length ? new Date(Math.max(...ends)).toISOString() : undefined,
    }
  })
}

/* ------------------------------------------------------------------
   Request process
   ------------------------------------------------------------------ */

const ROW = { top: 72, mid: 192, low: 312, low2: 400 }
const X = {
  start: 44, draft: 142, pre: 268, gv: 380, review: 490, ga: 602, approved: 714,
  queued: 838, execute: 984, gout: 1116, ready: 1214, service: 1330,
}

const AFTER: Record<OrderState, number> = {
  Draft: 0, Planned: 1, Invalid: 2, Validated: 2, Rejected: 3, Approved: 3,
  Queued: 4, 'In progress': 5, Failed: 6, Ready: 6, Reinstantiate: 7,
}

export function buildRequestGraph(order: Order, runs: Run[]): JGraph {
  const s = order.state
  const rank = AFTER[s]
  const attempts = attemptsOf(runs)
  /* An archived request whose log aged out still executed — the state says
     so even though no run is left to show for it. */
  const executed = rank >= 5 || attempts.length > 0
  const attemptCount = Math.max(attempts.length, executed ? 1 : 0)
  const failedBefore = attempts.filter((a) => a.outcome === 'failed').length
  /* The retry loop was walked once per attempt after the first, plus once
     more if the request is standing in Reinstantiate right now. */
  const loopCount = Math.max(0, attemptCount - 1) + (s === 'Reinstantiate' ? 1 : 0)
  const loopTaken = loopCount > 0

  const decision = order.approvals.find((a) => a.decision)
  const latest = attempts[attempts.length - 1]
  const firstStart = attempts[0]?.startedAt
  const cur = (id: string) => currentNode(order) === id

  const reached = new Set<string>(['start'])
  const add = (...ids: string[]) => ids.forEach((id) => reached.add(id))
  add('draft')
  if (rank >= 1) add('pre')
  if (rank >= 2) add('gv')
  if (s === 'Invalid') add('invalid')
  if (rank >= 2 && s !== 'Invalid') add('review')
  if (rank >= 3) add('ga')
  if (s === 'Rejected') add('rejected')
  if (rank >= 3 && s !== 'Rejected') add('approved')
  if (rank >= 4 || attempts.length > 0) add('queued')
  if (executed) add('execute')
  if (rank >= 6 || attempts.some((a) => a.outcome !== 'running')) add('gout')
  if (s === 'Ready') add('ready')
  if (s === 'Ready' && order.serviceId) add('service')
  if (s === 'Failed' || s === 'Reinstantiate' || failedBefore > 0) add('rollback', 'failed')
  if (loopTaken) add('gretry', 'reinstantiate')

  const visit = (id: string): JVisit => (cur(id) ? 'current' : reached.has(id) ? 'done' : 'off')
  /* A gateway takes the colour of the branch it sent the request down. */
  const toneOf = (id: string, branch: JTone): JTone => (reached.has(id) ? branch : 'none')

  const lastRun = latest?.runs[0]
  const stoppedAt = latest?.runs.map((r) => r.tasks.find((t) => t.state === 'Failed')).find(Boolean)
  const written = latest ? latest.runs.reduce((n, r) => n + r.tasks.filter((t) => t.state === 'Passed' && t.stageKind === 'Configuration').length, 0) : 0
  const outcomeLabel = latest
    ? latest.outcome === 'running' ? 'still running'
      : latest.outcome === 'accepted' ? 'every device accepted' : `${latest.runs.filter((r) => r.outcome !== 'Accepted').length} of ${latest.runs.length} device(s) did not accept`
    : executed ? 'log not retained' : 'not executed yet'

  const nodes: JNode[] = [
    {
      id: 'start', shape: 'start', label: 'Request raised', sub: fmt(order.createdAt),
      x: X.start, y: ROW.mid, w: 36, h: 36, visit: visit('start'), tone: 'brand',
      detail: { title: 'Request raised', facts: [['When', fmt(order.createdAt)], ['By', order.owner ?? '—'], ['Intent', order.intent], ['Customer', order.accountName]] },
    },
    {
      id: 'draft', shape: 'user', label: 'Design request', sub: `${order.endpoints.length} endpoint${order.endpoints.length === 1 ? '' : 's'} · ${order.params.length} params`,
      x: X.draft, y: ROW.mid, w: 112, h: 50, visit: visit('draft'), tone: 'brand',
      detail: {
        title: 'Design request',
        facts: [['Service type', `${order.category} · ${order.type}`], ['Endpoints', order.endpoints.map((e) => `${endpointRole(e)} ${e.mgmtIp}`).join(', ') || 'none'], ['Parameters', String(order.params.length)]],
        note: s === 'Draft' ? 'Still being designed — nothing has been checked against the network yet.' : undefined,
      },
    },
    {
      id: 'pre', shape: 'service', label: 'Pre-validation', sub: 'automatic',
      x: X.pre, y: ROW.mid, w: 118, h: 50, visit: visit('pre'), tone: 'brand',
      detail: {
        title: 'Pre-validation',
        facts: [['Runs', 'automatically, once the design is complete'], ['Checks', 'parameters, pools, device reachability, workflow coverage']],
        note: s === 'Planned' ? 'Running now.' : s === 'Invalid' ? (order.notes ?? 'Pre-validation failed.') : undefined,
        noteTone: s === 'Invalid' ? 'crit' : 'info',
      },
    },
    {
      id: 'gv', shape: 'gateway', label: 'Valid?', x: X.gv, y: ROW.mid, w: 40, h: 40, visit: visit('gv'), tone: toneOf('gv', s === 'Invalid' ? 'crit' : 'brand'),
      detail: { title: 'Valid?', facts: [['Outcome', s === 'Invalid' ? 'No — Invalid' : reached.has('review') ? 'Yes — Validated' : 'not decided yet']] },
    },
    {
      id: 'invalid', shape: 'user', label: 'Invalid', sub: 'back to requester',
      x: X.gv, y: ROW.top, w: 112, h: 46, visit: visit('invalid'), tone: reached.has('invalid') ? 'crit' : 'none',
      detail: { title: 'Invalid', facts: [['Waiting on', order.waitingOn ?? 'Requester']], note: order.notes, noteTone: 'crit' },
    },
    {
      id: 'review', shape: 'user', label: 'NOC lead review', sub: decision ? `${decision.by} · ${fmt(decision.at)}` : order.approvals[0]?.role ?? 'approval',
      x: X.review, y: ROW.mid, w: 118, h: 50, visit: visit('review'), tone: 'brand',
      detail: {
        title: 'NOC lead review',
        facts: [['Role', order.approvals[0]?.role ?? '—'], ['Decision', decision ? `${decision.decision} by ${decision.by}` : 'pending'], ['When', fmt(decision?.at)]],
        note: decision?.comment, noteTone: 'crit',
      },
    },
    {
      id: 'ga', shape: 'gateway', label: 'Approved?', labelPos: 'above', x: X.ga, y: ROW.mid, w: 40, h: 40, visit: visit('ga'), tone: toneOf('ga', s === 'Rejected' ? 'crit' : 'brand'),
      detail: { title: 'Approved?', facts: [['Outcome', decision ? decision.decision ?? '—' : 'not decided yet']] },
    },
    {
      id: 'rejected', shape: 'end-error', label: 'Rejected', sub: decision?.decision === 'Rejected' ? fmt(decision.at) : undefined,
      x: X.ga, y: ROW.low, w: 36, h: 36, visit: visit('rejected'), tone: reached.has('rejected') ? 'crit' : 'none',
      detail: { title: 'Rejected', facts: [['By', decision?.by ?? '—'], ['When', fmt(decision?.at)]], note: decision?.comment, noteTone: 'crit' },
    },
    {
      id: 'approved', shape: 'task', label: 'Approved', sub: 'awaiting change window',
      x: X.approved, y: ROW.mid, w: 112, h: 50, visit: visit('approved'), tone: 'good',
      detail: { title: 'Approved', facts: [['Cleared', fmt(decision?.at)], ['By', decision?.by ?? '—'], ['Then', 'released into the execution queue at the change window']] },
    },
    {
      id: 'queued', shape: 'task', label: 'Queued', sub: 'execution queue', marker: loopTaken ? `×${loopCount + 1}` : undefined,
      x: X.queued, y: ROW.mid, w: 112, h: 50, visit: visit('queued'), tone: 'brand',
      detail: { title: 'Queued', facts: [['Entered', s === 'Queued' ? 'now' : firstStart ? `before ${fmt(firstStart)}` : '—'], ['Times', String(loopTaken ? loopCount + 1 : executed || s === 'Queued' ? 1 : 0)]] },
    },
    {
      id: 'execute', shape: 'subprocess', label: 'Execute workflow', sub: `${order.endpoints.length || 1} device${order.endpoints.length === 1 ? '' : 's'} · ${attemptCount || 'no'} attempt${attemptCount === 1 ? '' : 's'}`,
      x: X.execute, y: ROW.mid, w: 152, h: 56, visit: visit('execute'), tone: 'brand',
      detail: {
        title: 'Execute workflow',
        facts: [
          ['Devices', String(order.endpoints.length || 1)],
          ['Attempts', String(attemptCount)],
          ['Started', fmt(firstStart)],
          ['Latest', outcomeLabel],
        ],
        note: 'Expanded below — every stage and task of the bound workflow, per device, with the path this attempt actually took.',
        noteTone: 'info',
        runId: lastRun?.id,
      },
    },
    {
      id: 'gout', shape: 'gateway', label: 'All devices accepted?', labelPos: 'above', x: X.gout, y: ROW.mid, w: 40, h: 40, visit: visit('gout'),
      tone: toneOf('gout', reached.has('failed') && s !== 'Ready' ? 'crit' : 'brand'),
      detail: { title: 'All devices accepted?', facts: [['Outcome', latest ? outcomeLabel : executed ? 'accepted' : 'not reached']] },
    },
    {
      id: 'ready', shape: 'end', label: 'Ready', sub: s === 'Ready' ? fmt(order.updatedAt) : undefined,
      x: X.ready, y: ROW.mid, w: 36, h: 36, visit: visit('ready'), tone: reached.has('ready') ? 'good' : 'none',
      detail: { title: 'Ready', facts: [['Closed', fmt(order.updatedAt)], ['Proof', 'every acceptance criterion passed on every device']] },
    },
    {
      id: 'service', shape: 'data', label: serviceLabel(order), sub: order.serviceId ?? 'in inventory',
      x: X.service, y: ROW.mid, w: 124, h: 54, visit: visit('service'), tone: reached.has('service') ? 'good' : 'none',
      detail: {
        title: serviceLabel(order),
        facts: [['Service', order.serviceId ?? 'not landed yet'], ['Effect', serviceEffect(order)]],
        link: order.serviceId ? { to: `/inventory/${order.serviceId}?tab=lifecycle`, label: 'Open service lifecycle' } : undefined,
      },
    },
    {
      id: 'rollback', shape: 'compensate', label: 'Stop & roll back', sub: lastRun ? rollbackSub(lastRun, written) : undefined,
      x: X.gout, y: ROW.low, w: 118, h: 50, visit: visit('rollback'), tone: reached.has('rollback') ? 'crit' : 'none',
      detail: {
        title: 'Stop & roll back',
        facts: [
          ['Broke at', stoppedAt ? `${stoppedAt.stage} · ${stoppedAt.name}` : lastRun?.outcome === 'Rolled back' ? 'aborted by operator' : '—'],
          ['Written before stop', `${written} command${written === 1 ? '' : 's'}`],
          ['Residue', lastRun?.residue?.join('; ') ?? 'none'],
        ],
        note: stoppedAt?.failureReason, noteTone: 'crit',
      },
    },
    {
      id: 'failed', shape: 'user', label: 'Failed', sub: 'assigned engineer',
      x: X.execute, y: ROW.low, w: 118, h: 50, visit: visit('failed'), tone: reached.has('failed') ? 'crit' : 'none',
      detail: { title: 'Failed', facts: [['Waiting on', 'Assigned engineer'], ['Failed attempts', String(failedBefore)], ['SLA', order.slaBreached ? 'breached' : 'within']] },
    },
    {
      id: 'gretry', shape: 'gateway', label: 'Retry?', labelPos: 'above', x: X.queued, y: ROW.low, w: 40, h: 40, visit: visit('gretry'), tone: reached.has('gretry') ? 'plum' : 'none',
      detail: { title: 'Retry?', facts: [['Decision', loopTaken ? `Yes — reinstantiated ${loopCount} time${loopCount === 1 ? '' : 's'}` : s === 'Failed' ? 'pending' : 'not reached']] },
    },
    {
      id: 'reinstantiate', shape: 'task', label: 'Reinstantiate', sub: 're-enter the queue', marker: loopCount > 1 ? `×${loopCount}` : undefined,
      x: X.approved, y: ROW.low, w: 118, h: 50, visit: visit('reinstantiate'), tone: reached.has('reinstantiate') ? 'plum' : 'none',
      detail: { title: 'Reinstantiate', facts: [['What', 'the failed request goes back into the execution queue for another attempt'], ['Times', String(loopCount)]] },
    },
    {
      id: 'closed', shape: 'end-error', label: 'Closed', sub: 'no retry',
      x: X.queued, y: ROW.low2, w: 36, h: 36, visit: 'off', tone: 'none',
      detail: { title: 'Closed without retry', facts: [['State', 'not a path this request has taken']] },
    },
  ]

  const on = (id: string) => reached.has(id) || cur(id)
  const okTone: JTone = 'brand'
  const edges: JEdge[] = [
    seq('start-draft', 'start', 'draft', on('draft'), okTone),
    seq('draft-pre', 'draft', 'pre', on('pre'), okTone),
    seq('pre-gv', 'pre', 'gv', on('gv'), okTone),
    { ...seq('gv-invalid', 'gv', 'invalid', on('invalid'), 'crit'), fromPort: 'top', toPort: 'bottom', label: 'No' },
    { ...seq('invalid-draft', 'invalid', 'draft', false, 'none'), fromPort: 'left', toPort: 'top', label: 'Rework' },
    { ...seq('gv-review', 'gv', 'review', on('review'), okTone), label: 'Yes' },
    seq('review-ga', 'review', 'ga', on('ga'), okTone),
    { ...seq('ga-rejected', 'ga', 'rejected', on('rejected'), 'crit'), fromPort: 'bottom', toPort: 'top', label: 'No' },
    { ...seq('ga-approved', 'ga', 'approved', on('approved'), 'good'), label: 'Yes' },
    seq('approved-queued', 'approved', 'queued', on('queued'), okTone),
    seq('queued-execute', 'queued', 'execute', on('execute'), okTone),
    seq('execute-gout', 'execute', 'gout', on('gout'), okTone),
    { ...seq('gout-ready', 'gout', 'ready', on('ready'), 'good'), label: 'Yes' },
    seq('ready-service', 'ready', 'service', on('service'), 'good'),
    { ...seq('gout-rollback', 'gout', 'rollback', on('rollback'), 'crit'), fromPort: 'bottom', toPort: 'top', label: 'No' },
    { ...seq('rollback-failed', 'rollback', 'failed', on('failed'), 'crit'), fromPort: 'left', toPort: 'right' },
    { ...seq('failed-gretry', 'failed', 'gretry', on('gretry'), 'plum'), fromPort: 'left', toPort: 'right' },
    { ...seq('gretry-reinstantiate', 'gretry', 'reinstantiate', on('reinstantiate'), 'plum'), fromPort: 'left', toPort: 'right', label: 'Yes' },
    { ...seq('reinstantiate-queued', 'reinstantiate', 'queued', on('reinstantiate'), 'plum'), fromPort: 'top', toPort: 'bottom', via: [{ y: 252 }, { x: X.queued }] },
    { ...seq('gretry-closed', 'gretry', 'closed', false, 'none'), fromPort: 'bottom', toPort: 'top', label: 'No' },
  ]
  if (loopTaken && loopCount > 1) edges.find((e) => e.id === 'reinstantiate-queued')!.count = loopCount

  /* The story: the edges in the order the token walks them, loops included. */
  const story: string[] = ['start-draft']
  if (on('pre')) story.push('draft-pre')
  if (on('gv')) story.push('pre-gv')
  if (on('invalid')) story.push('gv-invalid')
  if (on('review')) story.push('gv-review')
  if (on('ga')) story.push('review-ga')
  if (on('rejected')) story.push('ga-rejected')
  if (on('approved')) story.push('ga-approved')
  if (on('queued')) story.push('approved-queued')
  const walked = attempts.length ? attempts : executed ? [{ n: 1, runs: [], outcome: 'accepted' as const }] : []
  walked.forEach((a, i) => {
    story.push('queued-execute')
    if (a.outcome === 'running') return
    story.push('execute-gout')
    if (a.outcome === 'accepted') {
      if (on('ready')) story.push('gout-ready')
      if (on('service')) story.push('ready-service')
      return
    }
    story.push('gout-rollback', 'rollback-failed')
    const retried = i < walked.length - 1 || s === 'Reinstantiate'
    if (retried) story.push('failed-gretry', 'gretry-reinstantiate', 'reinstantiate-queued')
  })

  /* Steps: first time an edge appears in the story is when it animates in;
     a node lights up when its incoming edge lands. */
  const stepOf = new Map<string, number>()
  story.forEach((id, i) => { if (!stepOf.has(id)) stepOf.set(id, i) })
  edges.forEach((e) => { e.step = stepOf.get(e.id) })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  byId.get('start')!.step = -1
  edges.forEach((e) => {
    const st = stepOf.get(e.id)
    const n = byId.get(e.to)
    if (st !== undefined && n && (n.step === undefined || st < n.step)) n.step = st
  })

  return { nodes, edges, lanes: [], groups: [], width: 1408, height: 440, story }
}

function seq(id: string, from: string, to: string, taken: boolean, tone: JTone): JEdge {
  return { id, from, to, kind: 'seq', taken, tone: taken ? tone : 'none' }
}

/** Which node the request is standing on right now. */
export function currentNode(order: Order): string {
  switch (order.state) {
    case 'Draft': return 'draft'
    case 'Planned': return 'pre'
    case 'Invalid': return 'invalid'
    case 'Validated': return 'review'
    case 'Rejected': return 'rejected'
    case 'Approved': return 'approved'
    case 'Queued': return 'queued'
    case 'In progress': return 'execute'
    case 'Ready': return order.serviceId ? 'service' : 'ready'
    case 'Failed': return 'failed'
    case 'Reinstantiate': return 'reinstantiate'
  }
}

function serviceLabel(o: Order): string {
  switch (o.intent) {
    case 'Create': return 'Service created'
    case 'Modify': return 'Service modified'
    case 'Suspend': return 'Service suspended'
    case 'Resume': return 'Service resumed'
    case 'Cease': return 'Service ceased'
    case 'Re-prove': return 'Service re-proven'
  }
}
function serviceEffect(o: Order): string {
  switch (o.intent) {
    case 'Create': return 'a new service appears in inventory with the resources it drew'
    case 'Modify': return o.delta?.map((d) => `${d.attribute} ${d.current} → ${d.requested}`).join(', ') || 'attributes updated on the live service'
    case 'Suspend': return 'service stops carrying traffic; configuration and resources retained'
    case 'Resume': return 'service returns to Live'
    case 'Cease': return 'service removed; resources return to quarantine'
    case 'Re-prove': return 'read-only — acceptance criteria re-run, nothing written'
  }
}
function rollbackSub(r: Run, written: number): string {
  if (r.outcome === 'Rolled back with residue') return 'rolled back · residue left'
  if (r.outcome === 'Rolled back') return 'rolled back cleanly'
  if (r.outcome === 'Aborted') return 'aborted'
  return written ? `${written} command${written === 1 ? '' : 's'} undone` : 'nothing written'
}

/* ------------------------------------------------------------------
   Execution sub-process — one attempt, one lane per device
   ------------------------------------------------------------------ */

const LANE_H = 248
const POOL_X = 36
const TASK_W = 118
const TASK_H = 54
const GAP = 16
const GROUP_PAD = 14
const GROUP_TOP = 28
const TASK_ROW = 100
const LOW_ROW = 190

const TASK_TONE: Record<RunTask['state'], JTone> = {
  'Not started': 'none', Queued: 'warn', Running: 'brand', Passed: 'good', Failed: 'crit', Blocked: 'none', Skipped: 'warn',
}

export function buildExecutionGraph(
  order: Order, runs: Run[], workflowName: (id: string) => string | undefined,
): JGraph {
  const nodes: JNode[] = []
  const edges: JEdge[] = []
  const lanes: JLane[] = []
  const groups: JGroup[] = []
  let width = 0

  /* Source first — it is the lane every other lane waits on. */
  const epOf = (r: Run) => order.endpoints.find((e) => e.id === r.endpointId)
  const ordered = [...runs].sort((a, b) => {
    const ra = epOf(a) ? (endpointRole(epOf(a)!) === 'Source' ? 0 : 1) : 0
    const rb = epOf(b) ? (endpointRole(epOf(b)!) === 'Source' ? 0 : 1) : 0
    return ra - rb
  })

  type LaneInfo = { run: Run; ep?: Endpoint; laneY: number; endId: string; firstCfgId?: string; failId?: string; rollbackId?: string; lastPreId?: string }
  const info: LaneInfo[] = []

  ordered.forEach((run, li) => {
    const ep = epOf(run)
    const laneY = 40 + li * LANE_H
    const rowY = laneY + TASK_ROW
    const lowY = laneY + LOW_ROW
    const role = ep ? endpointRole(ep) : 'Source'
    const laneTone: JTone = run.outcome === 'Accepted' ? 'good' : run.outcome === 'Running' ? 'brand' : run.outcome === 'Aborted' ? 'none' : run.outcome === 'Failed' ? 'crit' : 'warn'
    const passed = run.tasks.filter((t) => t.state === 'Passed').length
    lanes.push({
      id: `lane-${run.id}`, label: role, sub: ep ? `${ep.mgmtIp} · ${ep.vendor} ${ep.deviceName}` : run.workflowId,
      y: laneY, h: LANE_H, tone: laneTone, endpointId: ep?.id, runId: run.id,
      detail: {
        title: `${role} · ${ep?.mgmtIp ?? run.workflowId}`,
        facts: [
          ['Run', `${run.id} · attempt ${run.attempt}`],
          ['Workflow', workflowName(run.workflowId) ?? run.workflowId],
          ['Outcome', run.outcome],
          ['Started', fmt(run.startedAt)],
          ['Duration', dur(run.durationMs)],
          ['Tasks', `${passed} of ${run.tasks.length} passed`],
        ],
        note: run.residue ? `Residue: ${run.residue.join('; ')}` : undefined, noteTone: 'warn',
        runId: run.id, endpointId: ep?.id,
      },
    })

    const startId = `${run.id}-start`
    nodes.push({
      id: startId, shape: 'start', label: 'Start', x: POOL_X + 46, y: rowY, w: 30, h: 30, visit: 'done', tone: 'brand', step: 0,
      detail: { title: `Run ${run.attempt} started`, facts: [['When', fmt(run.startedAt)], ['Device', ep?.mgmtIp ?? '—']] },
    })

    /* Tasks in stage groups, left to right. */
    let cursor = POOL_X + 46 + 15 + 26
    const failIdx = run.tasks.findIndex((t) => t.state === 'Failed')
    const firstSkipIdx = run.tasks.findIndex((t) => t.state === 'Skipped')
    const stageRuns: { name: string; kind: StageKind; tasks: { t: RunTask; i: number }[] }[] = []
    run.tasks.forEach((t, i) => {
      const last = stageRuns[stageRuns.length - 1]
      if (last && last.name === t.stage) last.tasks.push({ t, i })
      else stageRuns.push({ name: t.stage, kind: t.stageKind, tasks: [{ t, i }] })
    })
    const taskIds: string[] = []
    let firstCfgId: string | undefined
    let lastPreId: string | undefined
    stageRuns.forEach((sg, si) => {
      const n = sg.tasks.length
      const gw = GROUP_PAD * 2 + n * TASK_W + (n - 1) * GAP
      groups.push({ id: `${run.id}-g${si}`, label: sg.name, kind: sg.kind, x: cursor, y: rowY - TASK_H / 2 - GROUP_TOP, w: gw, h: GROUP_TOP + TASK_H + 14 })
      sg.tasks.forEach(({ t, i }, k) => {
        const id = `${run.id}-t${i}`
        const x = cursor + GROUP_PAD + TASK_W / 2 + k * (TASK_W + GAP)
        const executed = t.state === 'Passed' || t.state === 'Failed'
        const visit: JVisit = t.state === 'Running' ? 'current' : executed ? 'done' : 'off'
        const rollbackDone = t.direction === 'rollback'
        nodes.push({
          id, shape: t.stageKind === 'Configuration' ? 'task' : 'service',
          label: t.name, sub: taskSub(t),
          x, y: rowY, w: TASK_W, h: TASK_H, visit,
          tone: rollbackDone ? 'warn' : TASK_TONE[t.state],
          step: i + 1,
          boundary: t.state === 'Failed' ? 'error' : rollbackDone ? 'compensate' : undefined,
          detail: {
            title: t.name,
            facts: [
              ['State', t.state + (rollbackDone ? ' · rolled back' : '')],
              ['Stage', `${t.stage} (${t.stageKind})`],
              ['Started', fmt(t.startedAt)],
              ['Duration', dur(t.durationMs)],
              ['Asserts', t.claim],
            ],
            note: t.failureReason ?? (t.blockedBy ? `Blocked — ${t.blockedBy}` : undefined),
            noteTone: t.failureReason ? 'crit' : 'warn',
            task: t, runId: run.id, endpointId: ep?.id,
          },
        })
        if (t.stageKind !== 'Pre validation' && !firstCfgId) firstCfgId = id
        if (t.stageKind === 'Pre validation') lastPreId = id
        taskIds.push(id)
      })
      cursor += gw + 34
    })

    const endId = `${run.id}-end`
    const accepted = run.outcome === 'Accepted'
    nodes.push({
      id: endId, shape: 'end', label: 'Accepted', sub: accepted ? fmt(run.endedAt) : undefined,
      x: cursor + 4, y: rowY, w: 32, h: 32, visit: accepted ? 'done' : 'off', tone: accepted ? 'good' : 'none', step: run.tasks.length + 1,
      detail: { title: 'Accepted', facts: [['Ended', fmt(run.endedAt)], ['Duration', dur(run.durationMs)]] },
    })
    width = Math.max(width, cursor + 60)

    /* Sequence flow along the lane. */
    const stepTaken = (a: RunTask, b?: RunTask) => (a.state === 'Passed') && (!!b && (b.state === 'Passed' || b.state === 'Failed' || b.state === 'Running'))
    edges.push({ id: `${startId}-e`, from: startId, to: taskIds[0], kind: 'seq', taken: run.tasks.length > 0, tone: 'brand', step: 0 })
    run.tasks.forEach((t, i) => {
      const next = run.tasks[i + 1]
      if (!next) {
        edges.push({ id: `${taskIds[i]}-end`, from: taskIds[i], to: endId, kind: 'seq', taken: accepted, tone: accepted ? 'good' : 'none', step: i + 1 })
        return
      }
      const taken = stepTaken(t, next)
      edges.push({
        id: `${taskIds[i]}-n`, from: taskIds[i], to: taskIds[i + 1], kind: 'seq', taken,
        tone: !taken ? 'none' : next.state === 'Failed' ? 'crit' : next.state === 'Running' ? 'brand' : 'good', step: i + 1,
      })
    })

    /* Where it broke, and the path from there. */
    let failId: string | undefined
    let rollbackId: string | undefined
    if (failIdx >= 0) {
      const ft = run.tasks[failIdx]
      const fx = nodes.find((n) => n.id === taskIds[failIdx])!.x
      const writtenBefore = run.tasks.filter((t, i) => i < failIdx && t.state === 'Passed' && t.stageKind === 'Configuration').length
      rollbackId = `${run.id}-rollback`
      failId = `${run.id}-failed`
      nodes.push({
        id: rollbackId, shape: 'compensate', label: 'Roll back', sub: writtenBefore ? `${writtenBefore} command${writtenBefore === 1 ? '' : 's'} undone` : 'nothing to undo',
        x: fx, y: lowY, w: TASK_W, h: 40, visit: 'done', tone: 'crit', step: failIdx + 2,
        detail: {
          title: 'Roll back',
          facts: [['Trigger', `${ft.name} failed its validation`], ['Undone', `${writtenBefore} configuration command${writtenBefore === 1 ? '' : 's'}, in reverse order`], ['Residue', run.residue?.join('; ') ?? 'none']],
          note: ft.failureReason, noteTone: 'crit',
        },
      })
      nodes.push({
        id: failId, shape: 'end-error', label: run.outcome === 'Failed' ? 'Failed' : run.outcome, sub: fmt(run.endedAt),
        x: fx + TASK_W / 2 + 52, y: lowY, w: 32, h: 32, visit: 'done', tone: 'crit', step: failIdx + 3,
        detail: { title: run.outcome, facts: [['Ended', fmt(run.endedAt)], ['Broke at', `${ft.stage} · ${ft.name}`]], note: ft.failureReason, noteTone: 'crit' },
      })
      edges.push({ id: `${taskIds[failIdx]}-rb`, from: taskIds[failIdx], to: rollbackId, kind: 'seq', taken: true, tone: 'crit', fromPort: 'bottom', toPort: 'top', label: 'validation failed', step: failIdx + 1 })
      edges.push({ id: `${rollbackId}-f`, from: rollbackId, to: failId, kind: 'seq', taken: true, tone: 'crit', step: failIdx + 2 })
      if (writtenBefore && firstCfgId) {
        edges.push({ id: `${rollbackId}-undo`, from: rollbackId, to: firstCfgId, kind: 'assoc', taken: true, tone: 'crit', fromPort: 'left', toPort: 'bottom', label: 'undo in reverse order', step: failIdx + 2 })
      }
    } else if (run.outcome === 'Rolled back' || run.outcome === 'Rolled back with residue') {
      /* Aborted by an operator mid-run: no task failed, the run was stopped
         and everything already written was undone. */
      const at = firstSkipIdx >= 0 ? firstSkipIdx : Math.max(0, run.tasks.findIndex((t) => t.state !== 'Passed'))
      const ax = nodes.find((n) => n.id === taskIds[at])?.x ?? cursor
      const undone = run.tasks.filter((t) => t.direction === 'rollback').length
      rollbackId = `${run.id}-rollback`
      failId = `${run.id}-failed`
      nodes.push({
        id: rollbackId, shape: 'compensate', label: 'Roll back', sub: `${undone} task${undone === 1 ? '' : 's'} undone`,
        x: ax, y: lowY, w: TASK_W, h: 40, visit: 'done', tone: 'warn', step: at + 2,
        detail: { title: 'Roll back', facts: [['Trigger', 'aborted by operator'], ['Undone', `${undone} task${undone === 1 ? '' : 's'}, in reverse order`], ['Residue', run.residue?.join('; ') ?? 'none']] },
      })
      nodes.push({
        id: failId, shape: 'end-error', label: run.outcome, sub: fmt(run.endedAt),
        x: ax + TASK_W / 2 + 52, y: lowY, w: 32, h: 32, visit: 'done', tone: 'warn', step: at + 3,
        detail: { title: run.outcome, facts: [['Ended', fmt(run.endedAt)]] },
      })
      if (taskIds[at]) edges.push({ id: `${taskIds[at]}-rb`, from: taskIds[at], to: rollbackId, kind: 'seq', taken: true, tone: 'warn', fromPort: 'bottom', toPort: 'top', label: 'aborted by operator', step: at + 1 })
      edges.push({ id: `${rollbackId}-f`, from: rollbackId, to: failId, kind: 'seq', taken: true, tone: 'warn', step: at + 2 })
    } else if (run.outcome === 'Aborted') {
      /* The far end never got past its own pre-validation: the Source failed
         first, so Configuration was never attempted here. */
      const from = lastPreId ?? startId
      const fx = nodes.find((n) => n.id === (firstCfgId ?? from))!.x
      failId = `${run.id}-failed`
      nodes.push({
        id: failId, shape: 'end-error', label: 'Aborted', sub: 'Source failed',
        x: fx, y: lowY, w: 32, h: 32, visit: 'done', tone: 'none', step: (run.tasks.findIndex((t) => t.stageKind !== 'Pre validation') + 1) || 1,
        detail: { title: 'Aborted', facts: [['Why', 'the Source endpoint failed — configuration on this device was never attempted'], ['Pre-validation', 'passed']] },
      })
      edges.push({ id: `${from}-ab`, from, to: failId, kind: 'seq', taken: true, tone: 'none', fromPort: 'bottom', toPort: 'left', label: 'never started', step: 1 })
    }

    info.push({ run, ep, laneY, endId, firstCfgId, failId, rollbackId, lastPreId })
  })

  /* The gate between lanes: a Destination's Configuration waits on the
     Source's whole run. Drawn as the message flow it is. */
  const src = info[0]
  info.slice(1).forEach((d) => {
    if (!d.firstCfgId) return
    const dRun = d.run
    const firstCfg = dRun.tasks.find((t) => t.stageKind !== 'Pre validation')
    if (dRun.outcome === 'Aborted' && src.failId) {
      edges.push({ id: `${src.run.id}-${dRun.id}-abort`, from: src.rollbackId ?? src.failId, to: d.firstCfgId, kind: 'msg', taken: true, tone: 'crit', fromPort: 'bottom', toPort: 'top', label: 'Source failed — abort', via: [{ y: d.laneY + 12 }] })
      return
    }
    const waiting = firstCfg?.state === 'Queued'
    edges.push({
      id: `${src.run.id}-${dRun.id}-gate`, from: src.endId, to: d.firstCfgId, kind: 'msg', taken: !waiting, tone: waiting ? 'warn' : 'teal',
      fromPort: 'bottom', toPort: 'top', label: waiting ? 'waiting for Source to finish' : 'starts after Source completes', via: [{ y: d.laneY + 12 }],
    })
  })

  return { nodes, edges, lanes, groups, width: Math.max(width, 600), height: 40 + info.length * LANE_H + 8, story: [] }
}

function taskSub(t: RunTask): string | undefined {
  switch (t.state) {
    case 'Passed': return dur(t.durationMs)
    case 'Failed': return 'validation failed'
    case 'Running': return 'running…'
    case 'Queued': return 'waiting'
    case 'Blocked': return t.blockedBy?.startsWith('Source') ? 'never started' : 'blocked'
    case 'Skipped': return 'skipped'
    default: return undefined
  }
}
