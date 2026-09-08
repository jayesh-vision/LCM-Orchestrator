import type {
  WorkflowTaskDef,
  Endpoint, Order, OrderIntent, OrderParamValue, OrderState, Run, RunTask, Service, Workflow,
} from '@/types'
import { endpointRole } from '@/types'
import { ACCOUNTS, DEVICE_MODELS, SITES, between, intentById, pad, pick, rnd } from './catalog'
import { renderCommand } from './templates'

/* Order-state distribution. Sums to exactly 170. */
const ORDER_MIX: [OrderState, number][] = [
  ['Draft', 31], ['Designed', 39], ['Awaiting approval', 12], ['Approved', 9],
  ['Queued', 3], ['Executing', 3], ['Activated', 47], ['Failed', 22],
  ['Rejected', 3], ['Unrouted', 1],
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

const WAITING: Partial<Record<OrderState, string>> = {
  Draft: 'Design engineer',
  Designed: 'NOC lead',
  'Awaiting approval': 'NOC lead',
  Approved: 'Change window',
  Queued: 'Execution queue',
  Failed: 'Assigned engineer',
  Rejected: 'Requester',
  Unrouted: 'Unassigned',
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
    let orderIntent = intents[i]
    if (state === 'Unrouted') orderIntent = 'Create'

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
    const boundEps = state === 'Unrouted' ? [] : bindEndpoints(eps, intent.category, intent.type, subtype, workflows, params, bandwidth)

    const ageDays = state === 'Unrouted' ? 293 : between(0, 42)
    const created = new Date(now - ageDays * 86400000)

    out.push({
      id: `ORD-2026-${pad(4417 - i * 2, 6)}`,
      code: `NS-${pad(114 + i, 6)}`,
      name: `${intent.name}${orderIntent !== 'Create' ? ` · ${orderIntent.toLowerCase()}` : ''}`,
      intent: orderIntent, intentId,
      category: state === 'Unrouted' ? intent.category : intent.category,
      type: intent.type,
      subtype,
      accountId: acct.id, accountName: acct.name,
      serviceId: existing?.id,
      state,
      workflowId: state === 'Draft' || state === 'Unrouted' ? undefined : (boundEps[0]?.workflowId ?? wf?.id),
      endpoints: boundEps,
      params: state === 'Unrouted' ? [] : params,
      createdAt: created.toISOString(),
      updatedAt: new Date(now - between(0, ageDays) * 86400000).toISOString(),
      ageDays,
      owner: state === 'Unrouted' ? undefined : pick(OWNERS),
      waitingOn: WAITING[state],
      runIds: [],
      approvals: state === 'Activated' || state === 'Approved' || state === 'Executing' || state === 'Queued'
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
      slaBreached: state === 'Failed' && ageDays > 14,
      notes: state === 'Unrouted' ? 'Draft saved before a category was chosen. Category is nullable in the current schema.' : undefined,
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
  featured.state = 'Executing'
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

  const orphan = out.find((o) => o.state === 'Unrouted')
  if (orphan) {
    orphan.id = 'ORD-2026-003118'
    orphan.code = 'NS-000000'
    orphan.name = 'Unclassified draft'
    orphan.accountName = '—'
    orphan.accountId = '—'
    orphan.owner = undefined
    orphan.ageDays = 293
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

function runTasksFor(wf: Workflow, outcome: 'pass' | 'fail', failAt: number, ep: Endpoint): RunTask[] {
  const t0 = Date.now() - 1000 * 60 * 12
  let cursor = t0
  const values = Object.fromEntries((ep.params ?? []).map((p) => [p.name, p.value]))
  return orderedTasks(wf).map((td, i) => {
    const dur = between(700, 3200)
    const failed = outcome === 'fail' && i === failAt
    const after = outcome === 'fail' && i > failAt
    const started = cursor
    if (!after) cursor += dur
    const success = `Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms`
    return {
      taskDefId: td.id,
      name: td.name,
      stage: td.stage,
      stageKind: td.stageKind,
      sequence: i + 1,
      state: after ? 'Blocked' : failed ? 'Failed' : 'Passed',
      direction: 'forward',
      claim: claimFor(td, values),
      command: renderCommand(td.setCommand, values),
      requestPayload: JSON.stringify({ device: ep.mgmtIp, transport: 'ssh', commands: renderCommand(td.setCommand, values).split('\n') }, null, 2),
      responsePayload: failed
        ? JSON.stringify({ transportExit: 0, output: ['error: configuration check-out failed', 'Last error: hold timer expired'] }, null, 2)
        : JSON.stringify({ transportExit: 0, output: td.kind === 'read' ? [success] : ['commit complete'] }, null, 2),
      transportExit: 0,
      parsed: undefined,
      expected: claimFor(td, values),
      actual: failed ? 'output contains "error"' : 'every rule satisfied',
      startedAt: after ? undefined : new Date(started).toISOString(),
      endedAt: after ? undefined : new Date(started + dur).toISOString(),
      durationMs: after ? undefined : dur,
      failureReason: failed ? `Validation failed: output contains "error" — rule "${td.validations[0]?.type ?? 'Not contains'} ${td.validations[0]?.text ?? ''}" was not satisfied.` : undefined,
      blockedBy: after ? orderedTasks(wf)[failAt].name : undefined,
    }
  })
}

export function buildRuns(orders: Order[], workflows: Workflow[]): Run[] {
  const runs: Run[] = []
  let n = 0
  for (const o of orders) {
    /* A run exists only once execution has actually started. An Approved or
       Queued order is waiting for a change window and has no run yet. */
    if (['Draft', 'Unrouted', 'Designed', 'Awaiting approval', 'Approved', 'Queued', 'Rejected'].includes(o.state)) continue
    /* Some activations only succeed on a retry — that is what first-pass yield measures. */
    const attempts = o.state === 'Failed' ? between(1, 3) : (o.state === 'Activated' && rnd() > 0.78 ? 2 : 1)
    for (let a = 1; a <= attempts; a += 1) {
      const last = a === attempts
      const running = o.state === 'Executing' && last
      const start = Date.now() - (attempts - a + 1) * 3600000
      /* One run per endpoint: each device runs its own template. On a failed
         attempt only one end fails; the other end completes or is skipped. */
      o.endpoints.forEach((ep, ei) => {
        const wf = workflows.find((w) => w.id === ep.workflowId) ?? workflows.find((w) => w.id === o.workflowId) ?? workflows[0]
        const failed = o.state === 'Failed' && last && ei === 0
        const failAt = between(4, Math.max(5, wf.tasks.length - 3))
        const tasks = runTasksFor(wf, failed || (!last && ei === 0) ? 'fail' : 'pass', failAt, ep)
        if (running) {
          tasks.forEach((t, i) => {
            const cut = 4 + ei * 2
            t.state = i < cut ? 'Passed' : i === cut ? 'Running' : 'Not started'
            if (i > cut) { t.startedAt = undefined; t.endedAt = undefined; t.durationMs = undefined; t.blockedBy = undefined }
          })
        }
        n += 1
        const id = `RUN-${pad(n, 6)}`
        runs.push({
          id, attempt: a, orderId: o.id, endpointId: ep.id, workflowId: wf.id, direction: 'forward',
          outcome: running ? 'Running' : failed ? 'Failed' : (!last && ei === 0) ? 'Rolled back' : 'Accepted',
          startedAt: new Date(start + ei * 4000).toISOString(),
          endedAt: running ? undefined : new Date(start + between(60000, 300000)).toISOString(),
          durationMs: running ? undefined : between(60000, 300000),
          orchestratorClock: new Date(start).toISOString(),
          deviceClock: new Date(start - 3100).toISOString(),
          clockSkewMs: -3100,
          tasks,
          residue: failed && rnd() > 0.65 ? ['RD 65001:4189 still marked allocated in the pool'] : undefined,
        })
        o.runIds.push(id)
      })
    }
  }
  return runs
}
