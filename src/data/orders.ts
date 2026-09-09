import type {
  WorkflowTaskDef,
  Endpoint, Order, OrderIntent, OrderParamValue, OrderState, Run, RunTask, Service, TaskState, Workflow,
} from '@/types'
import { endpointRole } from '@/types'
import { ACCOUNTS, DEVICE_MODELS, SITES, between, intentById, pad, pick, rnd } from './catalog'
import { renderCommand } from './templates'

/* Order-state distribution. Sums to exactly 170. */
const ORDER_MIX: [OrderState, number][] = [
  ['Draft', 31], ['Planned', 10], ['Validated', 35], ['Invalid', 7], ['Approved', 9],
  ['Rejected', 3], ['Queued', 3], ['In progress', 3], ['Ready', 47], ['Failed', 20],
  ['Reinstantiate', 2],
]
const INTENT_MIX: [OrderIntent, number][] = [
  ['Create', 143], ['Modify', 18], ['Suspend', 4], ['Resume', 2], ['Cease', 3],
]

const OWNERS = ['Priya S.', 'Ravi K.', 'Anil M.', 'Nikhil D.']

function expand<T>(mix: [T, number][]): T[] {
  const out: T[] = []
  for (const [v, n] of mix) for (let i = 0; i < n; i += 1) out.push(v)
  return out
}
function shuffle<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

function endpointFor(role: Endpoint['role'], i: number): Endpoint {
  const site = pick(SITES)
  const dm = pick(DEVICE_MODELS)
  const port = pick(dm.ports)
  return {
    id: `EP-O${pad(i, 5)}`, role, siteCode: site.code, deviceName: dm.model, vendor: dm.vendor,
    mgmtIp: `172.31.${between(10, 60)}.${between(2, 250)}`, port,
    subInterface: `${port}.${between(100, 900)}`,
  }
}

/**
 * Bind each endpoint to the workflow that runs on THAT device, and render the
 * parameters that device needs. Source and Destination get different templates
 * — that is the whole point of having two.
 */
export function bindEndpoints(
  eps: Endpoint[], category: string, type: string, subtype: string, workflows: Workflow[],
  params: OrderParamValue[], bandwidth: number,
): Endpoint[] {
  const active = workflows.filter((w) => w.state === 'Active')
  const find = (e: Endpoint) => {
    const role = endpointRole(e)
    const exact = active.filter((w) => w.category === category && w.vendor === e.vendor && (w.endpointRole === role || !w.endpointRole))
    return exact.find((w) => w.type === type && w.subtype === subtype)
      ?? exact.find((w) => w.type === type)
      ?? exact[0]
      ?? active.find((w) => w.category === category)
  }
  const val = (name: string) => params.find((p) => p.name === name)?.value
  const vlan = val('vlan') ?? String(between(100, 900))
  const vcId = val('pw_id') ?? String(between(90000, 99999))
  const rd = val('rd') ?? `65001:${between(100, 900)}`
  const stamp = new Date().toDateString().replace(/ \d{4}$/, '')
  return eps.map((e, i) => {
    const other = eps[(i + 1) % eps.length]
    const wf = find(e)
    /* Parameter names are exactly the `${Placeholder}` names the workflow
       templates use, so a task command renders from this list alone. */
    const base: OrderParamValue[] = [
      { name: 'Interface', value: e.port, source: 'derived' },
      { name: 'Vlan-ID', value: vlan, source: 'pool' },
      { name: 'Neighbor IP', value: other?.mgmtIp ?? e.mgmtIp, source: 'derived' },
      { name: 'Description', value: `${category} OSS ${e.siteCode.split('-')[1]} - ${other?.siteCode.split('-')[1] ?? ''} ERP ID-${between(100, 400)} B/W:${bandwidth} DOP- ${stamp}`, source: 'user' },
      { name: 'Bandwidth', value: String(bandwidth), source: 'user' },
    ]
    const ifIp = `10.${between(200, 250)}.${between(1, 250)}.${i === 0 ? 1 : 2}/30`
    const byCat: OrderParamValue[] =
      category === 'L2VPN' ? [
        { name: 'Xconnect group', value: `XG${1 + (i % 3)}`, source: 'template' },
        { name: 'VC ID', value: vcId, source: 'pool' },
      ] : category === 'L3VPN' ? [
        { name: 'VRF', value: `VRF-${e.siteCode.split('-')[1]}-${vlan}`, source: 'derived' },
        { name: 'RD', value: rd, source: 'pool' },
        { name: 'RT', value: rd, source: 'pool' },
        { name: 'Interface IP', value: ifIp, source: 'pool' },
        { name: 'Peer AS', value: val('customer_asn') ?? String(between(64500, 65400)), source: 'user' },
      ] : [
        { name: 'VRF', value: `IBW-${e.siteCode.split('-')[1]}-${vlan}`, source: 'derived' },
        { name: 'Interface IP', value: ifIp, source: 'pool' },
        { name: 'Customer prefix', value: val('customer_prefix') ?? `10.244.${between(1, 250)}.0/30`, source: 'pool' },
        { name: 'Peer AS', value: val('customer_asn') ?? String(between(64500, 65400)), source: 'user' },
      ]
    return { ...e, workflowId: wf?.id, params: [...base, ...byCat] }
  })
}

export const WAITING: Partial<Record<OrderState, string>> = {
  Draft: 'Design engineer',
  Planned: 'Pre-validation',
  Validated: 'NOC lead',
  Invalid: 'Requester',
  Approved: 'Change window',
  Queued: 'Execution queue',
  Failed: 'Assigned engineer',
  Rejected: 'Requester',
  Reinstantiate: 'Execution queue',
}

export function buildOrders(services: Service[], workflows: Workflow[]): Order[] {
  const states = shuffle(expand(ORDER_MIX))
  const intents = shuffle(expand(INTENT_MIX))
  const active = workflows.filter((w) => w.state === 'Active')
  const liveServices = services.filter((s) => s.state === 'Live')
  const now = Date.now()
  const out: Order[] = []

  for (let i = 0; i < 170; i += 1) {
    const state = states[i]
    const orderIntent = intents[i]

    const existing = orderIntent === 'Create' ? undefined : liveServices[(i * 13) % liveServices.length]
    const intentId = existing ? existing.intentId : pick(['INT-IBW-ACCESS', 'INT-L2-P2P', 'INT-L2-RAILWIRE', 'INT-L3-HUBSPOKE', 'INT-L3-MESH'])
    const intent = intentById(intentId)
    const acct = existing
      ? ACCOUNTS.find((a) => a.id === existing.accountId)!
      : pick(ACCOUNTS)
    const wf = active.find((w) => w.intentId === intentId) ?? active[0]

    const nEnd = intent.topology === 'Single-ended' ? 1 : intent.topology === 'Two-ended' ? 2 : between(2, 5)
    const eps = existing?.endpoints ?? Array.from({ length: nEnd }, (_, e) =>
      endpointFor(intent.topology === 'Star' ? (e === 0 ? 'hub' : 'spoke') : e === 0 ? 'A' : 'Z', i * 10 + e))

    const bandwidth = existing?.bandwidthMbps ?? pick([10, 50, 100, 200, 500, 1000])
    const params: OrderParamValue[] = intent.params.map((p) => ({
      name: p.name,
      value: p.name === 'bandwidth_mbps' ? String(bandwidth)
        : p.fromPool ? `${p.fromPool === 'VLAN' ? between(100, 900) : p.fromPool === 'Pseudowire ID' ? between(4100, 4900) : p.fromPool === 'RD/RT' ? `65001:${between(100, 900)}` : `10.244.${between(1, 250)}.0/30`}`
          : p.default !== undefined ? String(p.default)
            : p.type === 'integer' ? String(between(64500, 65400)) : 'tagged',
      source: p.fromPool ? 'pool' : p.default !== undefined ? 'template' : 'user',
    }))

    const subtype = pick(['Tagged', 'Untagged', 'Other', 'BGP', 'Static'])
    const boundEps = bindEndpoints(eps, intent.category, intent.type, subtype, workflows, params, bandwidth)

    const ageDays = between(0, 42)
    const created = new Date(now - ageDays * 86400000)

    out.push({
      id: `ORD-2026-${pad(4417 - i * 2, 6)}`,
      code: `NS-${pad(114 + i, 6)}`,
      name: `${intent.name}${orderIntent !== 'Create' ? ` · ${orderIntent.toLowerCase()}` : ''}`,
      intent: orderIntent, intentId,
      category: intent.category,
      type: intent.type,
      subtype,
      accountId: acct.id, accountName: acct.name,
      serviceId: existing?.id,
      state,
      workflowId: state === 'Draft' ? undefined : (boundEps[0]?.workflowId ?? wf?.id),
      endpoints: boundEps,
      params,
      createdAt: created.toISOString(),
      updatedAt: new Date(now - between(0, ageDays) * 86400000).toISOString(),
      ageDays,
      owner: pick(OWNERS),
      waitingOn: WAITING[state],
      runIds: [],
      approvals: ['Ready', 'Approved', 'In progress', 'Queued', 'Reinstantiate', 'Failed'].includes(state)
        ? [{ role: 'NOC lead', by: 'Ravi K.', at: created.toISOString(), decision: 'Approved' }]
        : state === 'Rejected'
          ? [{ role: 'NOC lead', by: 'Ravi K.', at: created.toISOString(), decision: 'Rejected', comment: 'Uplink headroom insufficient at the A-end.' }]
          : [{ role: 'NOC lead' }],
      delta: orderIntent === 'Modify'
        ? [
          { attribute: 'Ingress policer', current: `${bandwidth} Mbps`, requested: `${bandwidth * 5} Mbps` },
          { attribute: 'Egress shaper', current: `${bandwidth} Mbps`, requested: `${bandwidth * 5} Mbps` },
        ]
        : undefined,
      slaBreached: (state === 'Failed' || state === 'Reinstantiate') && ageDays > 14,
      notes: undefined,
    })
  }

  /* Hand-authored orders so the demo always opens on something legible. */
  const featured = out[0]
  featured.id = 'ORD-2026-004417'
  featured.code = 'NS-000114'
  featured.name = 'L2VPN Transparent'
  featured.intent = 'Create'
  featured.intentId = 'INT-L2-P2P'
  featured.category = 'L2VPN'
  featured.type = 'Transparent'
  featured.subtype = 'Tagged'
  featured.accountId = 'ACC-04417'
  featured.accountName = 'Excitel Business Solutions'
  featured.state = 'In progress'
  featured.serviceId = 'SVC-L2-018842'
  featured.owner = 'Priya S.'
  featured.ageDays = 2
  /* A on a Cisco NCS, Z on a Juniper MX — the two ends run different templates. */
  featured.endpoints = [
    { id: 'EP-A', role: 'A', siteCode: 'DL-BLR-0412', deviceName: 'NCS-540', vendor: 'CISCO', mgmtIp: '172.31.63.20', port: 'TenGigE0/0/0/1', subInterface: 'TenGigE0/0/0/1.104' },
    { id: 'EP-Z', role: 'Z', siteCode: 'DL-BLR-0977', deviceName: 'MX204', vendor: 'JUNIPER', mgmtIp: '172.31.33.100', port: 'xe-1/1/0', subInterface: 'xe-1/1/0.104' },
  ]
  featured.params = [
    { name: 'encapsulation', value: 'transparent', source: 'user' },
    { name: 'vlan', value: '104', source: 'pool' },
    { name: 'mtu', value: '1500', source: 'template' },
    { name: 'bandwidth_mbps', value: '100', source: 'user' },
    { name: 'control_word', value: 'true', source: 'template' },
    { name: 'pw_id', value: '4104', source: 'pool' },
  ]
  featured.type = 'Transparent'
  featured.subtype = 'Untagged'
  featured.endpoints = bindEndpoints(featured.endpoints, 'L2VPN', 'Transparent', 'Untagged', workflows, featured.params, 100)
  featured.workflowId = featured.endpoints[0].workflowId

  /* One Invalid record keeps the flavour the old "Unrouted" example carried —
     pre-validation couldn't even find a category to check against — instead
     of just looking like every other Invalid row. */
  const orphan = out.find((o) => o.state === 'Invalid')
  if (orphan) {
    orphan.id = 'ORD-2026-003118'
    orphan.code = 'NS-000000'
    orphan.name = 'Unclassified draft'
    orphan.accountName = '—'
    orphan.accountId = '—'
    orphan.owner = undefined
    orphan.ageDays = 293
    orphan.workflowId = undefined
    orphan.endpoints = []
    orphan.params = []
    orphan.waitingOn = 'Unassigned'
    orphan.notes = 'Pre-validation could not resolve a category to check against. Category is nullable in the current schema.'
  }
  return out
}

/* ------------------------------------------------------------------
   Runs — one per order that has reached execution.
   ------------------------------------------------------------------ */

/** Human sentence for a task's validation rules: `output not contains "error" and contains "Up"`. */
export function claimFor(td: Pick<WorkflowTaskDef, 'validations' | 'name'>, values: Record<string, string> = {}): string {
  if (!td.validations.length) return `${td.name} completes`
  return 'output ' + td.validations.map((r, i) => `${i ? r.join.toLowerCase() + ' ' : ''}${r.type.toLowerCase()}${r.type === 'Not empty' ? '' : ` "${renderCommand(r.text, values)}"`}`).join(' ')
}

/** Tasks in workflow order: stage sequence, then task sequence. */
export function orderedTasks(wf: Pick<Workflow, 'stages' | 'tasks'>): WorkflowTaskDef[] {
  const idx = new Map(wf.stages.map((s, i) => [s.id, i]))
  return [...wf.tasks].sort((a, b) => (idx.get(a.stageId) ?? 99) - (idx.get(b.stageId) ?? 99) || a.sequence - b.sequence)
}

/** Index of the first task that isn't Pre validation — i.e. where Configuration begins. */
function firstConfigIndex(wf: Pick<Workflow, 'stages' | 'tasks'>): number {
  const ordered = orderedTasks(wf)
  const i = ordered.findIndex((t) => t.stageKind !== 'Pre validation')
  return i === -1 ? ordered.length : i
}

/**
 * Builds one endpoint's task list for one run, honouring the platform's
 * execution order: Pre validation runs on every endpoint in parallel, but
 * Configuration and Post validation run on the Source first — a Destination
 * only starts its own Configuration once the Source's finished, and never
 * starts it at all if the Source failed.
 *
 *   startAt        when this endpoint's Pre validation begins (same instant
 *                  for every endpoint on the order — that stage is parallel).
 *   configGateAt   earliest instant this endpoint's Configuration stage may
 *                  begin. Pass the Source run's `endAt` for a Destination;
 *                  leave undefined for the Source itself.
 *   aborted        Source failed this attempt, so this Destination's
 *                  Configuration/Post validation are never attempted.
 *   failAt         ordered-task index (always inside Configuration or Post
 *                  validation) where this endpoint's own run fails.
 *   runningUpTo    for an order still In progress: how many of this
 *                  endpoint's own tasks have completed so far. The next task
 *                  shows Running; anything after is Not started (already
 *                  reached its gate) or Queued (still waiting on the gate).
 */
function runTasksFor(wf: Workflow, ep: Endpoint, startAt: number, opts: {
  configGateAt?: number; aborted?: boolean; failAt?: number; runningUpTo?: number
}): { tasks: RunTask[]; preEndAt: number; endAt: number } {
  const values = Object.fromEntries((ep.params ?? []).map((p) => [p.name, p.value]))
  const ordered = orderedTasks(wf)
  const success = 'Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms'
  const inFlight = opts.runningUpTo !== undefined
  const gateReached = inFlight && opts.configGateAt !== undefined && opts.configGateAt <= startAt
  let cursor = startAt
  let preEndAt = startAt
  let gateApplied = false
  const tasks = ordered.map((td, i) => {
    const dur = between(700, 3200)
    const isPre = td.stageKind === 'Pre validation'
    if (!isPre && !gateApplied) {
      gateApplied = true
      if (opts.configGateAt !== undefined) cursor = Math.max(cursor, opts.configGateAt)
    }

    if (inFlight) {
      /* Mid-execution: Pre validation for every endpoint already ran (it's
         parallel and quick); Configuration/Post validation only proceeds
         past what runningUpTo says, and only once the gate is reached. */
      const started = cursor
      if (isPre || i < opts.runningUpTo!) cursor += dur
      const waitingOnGate = !isPre && !gateReached
      const state: TaskState = isPre ? 'Passed'
        : waitingOnGate ? 'Queued'
          : i < opts.runningUpTo! ? 'Passed'
            : i === opts.runningUpTo! ? 'Running' : 'Not started'
      const done = state === 'Passed'
      return {
        taskDefId: td.id, name: td.name, stage: td.stage, stageKind: td.stageKind, sequence: i + 1,
        state, direction: 'forward' as const,
        claim: claimFor(td, values),
        command: renderCommand(td.setCommand, values),
        requestPayload: JSON.stringify({ device: ep.mgmtIp, transport: 'ssh', commands: renderCommand(td.setCommand, values).split('\n') }, null, 2),
        responsePayload: done ? JSON.stringify({ transportExit: 0, output: td.kind === 'read' ? [success] : ['commit complete'] }, null, 2) : '',
        transportExit: 0,
        expected: claimFor(td, values),
        actual: done ? 'every rule satisfied' : undefined,
        startedAt: done || state === 'Running' ? new Date(started).toISOString() : undefined,
        endedAt: done ? new Date(started + dur).toISOString() : undefined,
        durationMs: done ? dur : undefined,
        blockedBy: waitingOnGate ? 'Waiting for the Source endpoint to finish' : undefined,
      }
    }

    const failedHere = opts.failAt === i
    const afterFail = opts.failAt !== undefined && i > opts.failAt
    const neverRuns = !isPre && !!opts.aborted
    const skip = afterFail || neverRuns
    const started = cursor
    if (!skip) cursor += dur
    if (isPre) preEndAt = started + dur
    return {
      taskDefId: td.id,
      name: td.name,
      stage: td.stage,
      stageKind: td.stageKind,
      sequence: i + 1,
      state: (skip ? 'Blocked' : failedHere ? 'Failed' : 'Passed') as TaskState,
      direction: 'forward' as const,
      claim: claimFor(td, values),
      command: renderCommand(td.setCommand, values),
      requestPayload: JSON.stringify({ device: ep.mgmtIp, transport: 'ssh', commands: renderCommand(td.setCommand, values).split('\n') }, null, 2),
      responsePayload: failedHere
        ? JSON.stringify({ transportExit: 0, output: ['error: configuration check-out failed', 'Last error: hold timer expired'] }, null, 2)
        : skip ? '' : JSON.stringify({ transportExit: 0, output: td.kind === 'read' ? [success] : ['commit complete'] }, null, 2),
      transportExit: 0,
      parsed: undefined,
      expected: claimFor(td, values),
      actual: failedHere ? 'output contains "error"' : skip ? undefined : 'every rule satisfied',
      startedAt: skip ? undefined : new Date(started).toISOString(),
      endedAt: skip ? undefined : new Date(started + dur).toISOString(),
      durationMs: skip ? undefined : dur,
      failureReason: failedHere ? `Validation failed: output contains "error" — rule "${td.validations[0]?.type ?? 'Not contains'} ${td.validations[0]?.text ?? ''}" was not satisfied.` : undefined,
      blockedBy: neverRuns
        ? 'Source endpoint failed — Destination configuration was never attempted.'
        : afterFail ? ordered[opts.failAt!].name : undefined,
    }
  })
  return { tasks, preEndAt, endAt: cursor }
}

export function buildRuns(orders: Order[], workflows: Workflow[]): Run[] {
  const runs: Run[] = []
  let n = 0
  for (const o of orders) {
    /* A run exists only once execution has actually started — Draft through
       Queued are all still waiting for that to happen and have no run yet. */
    if (['Draft', 'Planned', 'Validated', 'Invalid', 'Approved', 'Rejected', 'Queued'].includes(o.state)) continue
    if (o.endpoints.length === 0) continue
    /* Reinstantiate carries the failed run it's about to retry. */
    const stateFailed = o.state === 'Failed' || o.state === 'Reinstantiate'
    /* Some activations only succeed on a retry — that is what first-pass yield measures. */
    const attempts = stateFailed ? between(1, 3) : (o.state === 'Ready' && rnd() > 0.78 ? 2 : 1)
    /* Endpoint 0 is always Source (A / hub); everything after is Destination
       (Z / spokes) — true for every construction path in this codebase. */
    const sourceEp = o.endpoints[0]
    const destEps = o.endpoints.slice(1)

    for (let a = 1; a <= attempts; a += 1) {
      const last = a === attempts
      const running = o.state === 'In progress' && last
      const start = Date.now() - (attempts - a + 1) * 3600000
      const srcWf = workflows.find((w) => w.id === sourceEp.workflowId) ?? workflows.find((w) => w.id === o.workflowId) ?? workflows[0]

      const push = (ep: Endpoint, wf: Workflow, tasks: RunTask[], outcome: Run['outcome'], endAt: number | undefined, residue?: string[]) => {
        n += 1
        const id = `RUN-${pad(n, 6)}`
        runs.push({
          id, attempt: a, orderId: o.id, endpointId: ep.id, workflowId: wf.id, direction: 'forward',
          outcome,
          startedAt: new Date(start).toISOString(),
          endedAt: endAt === undefined ? undefined : new Date(endAt).toISOString(),
          durationMs: endAt === undefined ? undefined : endAt - start,
          orchestratorClock: new Date(start).toISOString(),
          deviceClock: new Date(start - 3100).toISOString(),
          clockSkewMs: -3100,
          tasks,
          residue,
        })
        o.runIds.push(id)
      }

      if (running) {
        /* Mid-flight: either the Source is still working through Configuration
           (every Destination is parked at Queued, having already cleared its
           own parallel Pre validation), or the Source has fully finished and
           one or more Destinations are now executing. Never both moving at
           once — that is the rule being modelled. */
        const sourceDone = rnd() > 0.5
        const srcOrdered = orderedTasks(srcWf)
        const srcCfgStart = firstConfigIndex(srcWf)
        const srcUpTo = sourceDone ? srcOrdered.length : between(Math.max(1, srcCfgStart - 1), Math.max(srcCfgStart, srcOrdered.length - 2))
        const src = runTasksFor(srcWf, sourceEp, start, { runningUpTo: srcUpTo })
        push(sourceEp, srcWf, src.tasks, 'Running', undefined)

        destEps.forEach((ep) => {
          const wf = workflows.find((w) => w.id === ep.workflowId) ?? srcWf
          const ordered = orderedTasks(wf)
          const destUpTo = sourceDone ? between(0, Math.max(0, ordered.length - 1)) : 0
          const dest = runTasksFor(wf, ep, start, { configGateAt: src.endAt, runningUpTo: destUpTo })
          push(ep, wf, dest.tasks, 'Running', undefined)
        })
        continue
      }

      /* Terminal attempt: the Source either passes clean or fails partway
         through Configuration/Post validation. When it fails, every
         Destination is Aborted — its own Pre validation ran (and passed),
         but Configuration never starts. */
      const srcFails = !last || stateFailed
      const srcOrdered = orderedTasks(srcWf)
      const srcCfgStart = firstConfigIndex(srcWf)
      const failAt = srcFails ? between(srcCfgStart, Math.max(srcCfgStart, srcOrdered.length - 1)) : undefined
      const src = runTasksFor(srcWf, sourceEp, start, { failAt })
      push(sourceEp, srcWf, src.tasks, srcFails ? 'Failed' : 'Accepted', src.endAt,
        srcFails && rnd() > 0.65 ? ['RD 65001:4189 still marked allocated in the pool'] : undefined)

      destEps.forEach((ep) => {
        const wf = workflows.find((w) => w.id === ep.workflowId) ?? srcWf
        const dest = runTasksFor(wf, ep, start, { configGateAt: src.endAt, aborted: srcFails })
        push(ep, wf, dest.tasks, srcFails ? 'Aborted' : 'Accepted', dest.endAt)
      })
    }
  }
  return runs
}
