import type {
  WorkflowTaskDef,
  Category, Endpoint, Order, OrderIntent, OrderParamValue, OrderState, Run, RunTask, Service, TaskState, Workflow,
} from '@/types'
import { endpointRole } from '@/types'
import { ACCOUNTS, SITES, between, intentById, modelsForCategory, pad, pick, rnd } from './catalog'
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

function endpointFor(role: Endpoint['role'], i: number, category: Category): Endpoint {
  const site = pick(SITES)
  const dm = pick(modelsForCategory(category))
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
  /* Vendor is not negotiable: a template is a set of commands in one vendor's
     CLI, so binding an endpoint to another vendor's template would produce a
     run that could never succeed on that device. Where the estate has no
     active template for this vendor and category — a real coverage gap, and
     what the Workflows gap count exists to surface — the endpoint is left
     unbound rather than quietly mis-bound. */
  const find = (e: Endpoint) => {
    const role = endpointRole(e)
    const exact = active.filter((w) => w.category === category && w.vendor === e.vendor && (w.endpointRole === role || !w.endpointRole))
    return exact.find((w) => w.type === type && w.subtype === subtype)
      ?? exact.find((w) => w.type === type)
      ?? exact[0]
  }
  const val = (name: string) => params.find((p) => p.name === name)?.value

  /* Access domain — a CPE has no far end and no interface/VRF vocabulary;
     its placeholder set is entirely different from every Transport category,
     so it gets its own branch rather than feeding the shared base+byCat below. */
  if (category === 'Broadband') {
    return eps.map((e) => {
      const wf = find(e)
      const cpeParams: OrderParamValue[] = [
        { name: 'CPE Serial', value: val('cpe_serial') ?? `SN-${between(100000, 999999)}`, source: 'pool' },
        { name: 'SSID', value: val('ssid') ?? `HOME-${e.siteCode.split('-')[1]}-${between(100, 999)}`, source: 'user' },
        { name: 'WiFi Password', value: val('wifi_password') ?? `Wifi${between(1000, 9999)}!`, source: 'user' },
        { name: 'WAN VLAN', value: val('wan_vlan') ?? String(between(100, 900)), source: 'pool' },
        { name: 'Bandwidth', value: String(bandwidth), source: 'user' },
      ]
      return { ...e, workflowId: wf?.id, params: cpeParams }
    })
  }

  /* Radio domain — a microwave hop has no VLAN/VRF vocabulary either;
     frequency/modulation/power is its own vocabulary shared by both ends
     of the same link. */
  if (category === 'Microwave') {
    return eps.map((e) => {
      const wf = find(e)
      const radioParams: OrderParamValue[] = [
        { name: 'Frequency Channel', value: val('frequency_channel') ?? `FC-${between(1000, 9999)}`, source: 'pool' },
        { name: 'Frequency Band', value: val('frequency_band') ?? 'L7', source: 'user' },
        { name: 'Channel Bandwidth', value: val('channel_bandwidth_mhz') ?? '28', source: 'user' },
        { name: 'Modulation', value: val('modulation') ?? '256QAM', source: 'user' },
        { name: 'TX Power', value: val('tx_power_dbm') ?? '20', source: 'user' },
        { name: 'Capacity', value: val('capacity_mbps') ?? String(bandwidth), source: 'user' },
      ]
      return { ...e, workflowId: wf?.id, params: radioParams }
    })
  }

  /* Fiber domain — a DWDM lambda has no VLAN/VRF vocabulary either;
     wavelength/framing/protection is its own vocabulary shared by both
     transponders on the same circuit. */
  if (category === 'DWDM') {
    return eps.map((e) => {
      const wf = find(e)
      const dwdmParams: OrderParamValue[] = [
        { name: 'Wavelength Channel', value: val('wavelength_channel') ?? `${1529 + between(0, 40)}.${between(10, 99)}nm`, source: 'pool' },
        { name: 'OTN Framing', value: val('otn_framing') ?? 'OTU4', source: 'user' },
        { name: 'Protection', value: val('protection') ?? 'Unprotected', source: 'user' },
        { name: 'Capacity', value: val('capacity_gbps') ?? String(bandwidth), source: 'user' },
      ]
      return { ...e, workflowId: wf?.id, params: dwdmParams }
    })
  }

  /* Radio domain, RAN VNF category — a CU/DU has no VLAN/VRF vocabulary
     either; it's O-RAN interface config (F1/NG/E1), and CU vs DU carry
     entirely different placeholder sets since they're different network
     functions, not two ends of the same link. */
  if (category === 'RAN VNF') {
    return eps.map((e) => {
      const wf = find(e)
      const vnfParams: OrderParamValue[] = type === 'DU' ? [
        { name: 'CU F1 IP', value: val('cu_f1_ip') ?? `172.31.90.${between(2, 250)}`, source: 'derived' },
        { name: 'PCI', value: val('pci') ?? String(between(0, 503)), source: 'pool' },
        { name: 'Bandwidth', value: val('bandwidth_mhz') ?? '100', source: 'user' },
        { name: 'TX Power', value: val('tx_power_dbm') ?? '40', source: 'user' },
      ] : [
        { name: 'PLMN', value: val('plmn_id') ?? '404-01', source: 'user' },
        { name: 'gNB ID', value: val('gnb_id') ?? `GNB-${between(10000, 99999)}`, source: 'derived' },
        { name: 'AMF IP', value: val('amf_ip') ?? `172.31.80.${between(2, 250)}`, source: 'pool' },
        { name: 'F1 IP', value: val('f1_ip') ?? `172.31.90.${between(2, 250)}`, source: 'pool' },
        { name: 'Max UE Capacity', value: val('max_ue_capacity') ?? String(bandwidth), source: 'user' },
      ]
      return { ...e, workflowId: wf?.id, params: vnfParams }
    })
  }

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
  /* Transport-only — every other domain gets its own additive batch below
     with its own existing-service pool, so this loop (fixed at 170 Transport
     orders) never accidentally binds to a service from another domain. */
  const liveServices = services.filter((s) => s.state === 'Live'
    && !s.intentId.startsWith('INT-ACCESS') && !s.intentId.startsWith('INT-RADIO')
    && !s.intentId.startsWith('INT-FIBER') && !s.intentId.startsWith('INT-RAN'))
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
      endpointFor(intent.topology === 'Star' ? (e === 0 ? 'hub' : 'spoke') : e === 0 ? 'A' : 'Z', i * 10 + e, intent.category))

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
  /* A modify, not a create. This order is bound to SVC-L2-018842, which has
     been live for over two years and has drifted — the device is carrying
     200 Mbps against an ordered 100. A create still in progress against a
     service that old is a contradiction; a modify reconciling the drift is
     the story the pair actually tells, and completing it clears the drift. */
  featured.name = 'L2VPN Transparent · modify'
  featured.intent = 'Modify'
  featured.delta = [{ attribute: 'Bandwidth', current: '100 Mbps', requested: '200 Mbps' }]
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

  /* Access domain — additive: 28 more orders, on top of Transport's 170.
     IDs/codes use a disjoint numeric range so nothing above shifts. */
  const ACCESS_ORDER_MIX: [OrderState, number][] = [
    ['Draft', 4], ['Planned', 2], ['Validated', 5], ['Invalid', 1], ['Approved', 1],
    ['Rejected', 1], ['Queued', 1], ['In progress', 1], ['Ready', 8], ['Failed', 3], ['Reinstantiate', 1],
  ]
  const ACCESS_INTENT_MIX: [OrderIntent, number][] = [
    ['Create', 22], ['Modify', 3], ['Suspend', 1], ['Resume', 1], ['Cease', 1],
  ]
  const aStates = shuffle(expand(ACCESS_ORDER_MIX))
  const aOrderIntents = shuffle(expand(ACCESS_INTENT_MIX))
  const accessLive = services.filter((s) => s.state === 'Live' && s.intentId.startsWith('INT-ACCESS'))
  for (let i = 0; i < 28; i += 1) {
    const state = aStates[i]
    const orderIntent = aOrderIntents[i]
    const existing = orderIntent === 'Create' ? undefined : accessLive[(i * 7) % accessLive.length]
    const intentId = existing ? existing.intentId : pick(['INT-ACCESS-RESIDENTIAL', 'INT-ACCESS-BUSINESS'])
    const intent = intentById(intentId)
    const acct = existing ? ACCOUNTS.find((a) => a.id === existing.accountId)! : pick(ACCOUNTS)
    const wf = active.find((w) => w.intentId === intentId) ?? active[0]

    const eps = existing?.endpoints ?? [endpointFor('A', 40000 + i, intent.category)]
    const bandwidth = existing?.bandwidthMbps ?? pick([50, 100, 200, 300, 500])
    const params: OrderParamValue[] = intent.params.map((p) => ({
      name: p.name,
      value: p.name === 'bandwidth_mbps' ? String(bandwidth)
        : p.name === 'ssid' ? `HOME-${between(1000, 9999)}`
          : p.name === 'wifi_password' ? `Wifi${between(1000, 9999)}!`
            : p.fromPool ? (p.fromPool === 'VLAN' ? String(between(100, 900)) : `SN-${between(100000, 999999)}`)
              : p.default !== undefined ? String(p.default) : 'value',
      source: p.fromPool ? 'pool' : p.default !== undefined ? 'template' : 'user',
    }))
    const boundEps = bindEndpoints(eps, intent.category, intent.type, '', workflows, params, bandwidth)

    const ageDays = between(0, 30)
    const created = new Date(now - ageDays * 86400000)

    out.push({
      id: `ORD-2026-${pad(6000 - i * 2, 6)}`,
      code: `NS-${pad(600 + i, 6)}`,
      name: `${intent.name}${orderIntent !== 'Create' ? ` · ${orderIntent.toLowerCase()}` : ''}`,
      intent: orderIntent, intentId,
      category: intent.category,
      type: intent.type,
      subtype: intent.type === 'Business Gateway' ? 'Other' : 'FTTH',
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
          ? [{ role: 'NOC lead', by: 'Ravi K.', at: created.toISOString(), decision: 'Rejected', comment: 'CPE stock unavailable at the requested site.' }]
          : [{ role: 'NOC lead' }],
      delta: orderIntent === 'Modify'
        ? [{ attribute: 'Bandwidth plan', current: `${bandwidth} Mbps`, requested: `${bandwidth * 2} Mbps` }]
        : undefined,
      slaBreached: (state === 'Failed' || state === 'Reinstantiate') && ageDays > 10,
      notes: undefined,
    })
  }

  /* Radio domain — additive: 16 more orders, two-ended microwave links. */
  const RADIO_ORDER_MIX: [OrderState, number][] = [
    ['Draft', 2], ['Planned', 1], ['Validated', 3], ['Invalid', 1], ['Approved', 1],
    ['Rejected', 1], ['Queued', 1], ['In progress', 1], ['Ready', 4], ['Failed', 1],
  ]
  const RADIO_INTENT_MIX: [OrderIntent, number][] = [['Create', 12], ['Modify', 2], ['Suspend', 1], ['Cease', 1]]
  const rStates = shuffle(expand(RADIO_ORDER_MIX))
  const rOrderIntents = shuffle(expand(RADIO_INTENT_MIX))
  const radioLive = services.filter((s) => s.state === 'Live' && s.intentId === 'INT-RADIO-PTP')
  for (let i = 0; i < 16; i += 1) {
    const state = rStates[i]
    const orderIntent = rOrderIntents[i]
    const existing = orderIntent === 'Create' ? undefined : radioLive[i % Math.max(1, radioLive.length)]
    const intentId = 'INT-RADIO-PTP'
    const intent = intentById(intentId)
    const acct = existing ? ACCOUNTS.find((a) => a.id === existing.accountId)! : pick(ACCOUNTS)
    const wf = active.find((w) => w.intentId === intentId) ?? active[0]

    const eps = existing?.endpoints ?? [endpointFor('A', 50000 + i * 2, intent.category), endpointFor('Z', 50000 + i * 2 + 1, intent.category)]
    const bandwidth = existing?.bandwidthMbps ?? pick([50, 100, 200, 500, 1000])
    const params: OrderParamValue[] = intent.params.map((p) => ({
      name: p.name,
      value: p.name === 'capacity_mbps' ? String(bandwidth)
        : p.fromPool ? `FC-${between(1000, 9999)}`
          : p.default !== undefined ? String(p.default) : 'value',
      source: p.fromPool ? 'pool' : p.default !== undefined ? 'template' : 'user',
    }))
    const boundEps = bindEndpoints(eps, intent.category, intent.type, '', workflows, params, bandwidth)

    const ageDays = between(0, 30)
    const created = new Date(now - ageDays * 86400000)

    out.push({
      id: `ORD-2026-${pad(7000 - i * 2, 6)}`,
      code: `NS-${pad(700 + i, 6)}`,
      name: `${intent.name}${orderIntent !== 'Create' ? ` · ${orderIntent.toLowerCase()}` : ''}`,
      intent: orderIntent, intentId,
      category: intent.category,
      type: intent.type,
      subtype: pick(['All-IP', 'Hybrid', 'E-band']),
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
          ? [{ role: 'NOC lead', by: 'Ravi K.', at: created.toISOString(), decision: 'Rejected', comment: 'Frequency channel unavailable at the requested band.' }]
          : [{ role: 'NOC lead' }],
      delta: orderIntent === 'Modify'
        ? [{ attribute: 'Link capacity', current: `${bandwidth} Mbps`, requested: `${bandwidth * 2} Mbps` }]
        : undefined,
      slaBreached: (state === 'Failed' || state === 'Reinstantiate') && ageDays > 10,
      notes: undefined,
    })
  }

  /* Fiber domain — additive: 12 more orders, two-ended DWDM circuits. */
  const FIBER_ORDER_MIX: [OrderState, number][] = [
    ['Draft', 1], ['Planned', 1], ['Validated', 2], ['Approved', 1],
    ['Queued', 1], ['In progress', 1], ['Ready', 4], ['Failed', 1],
  ]
  const FIBER_INTENT_MIX: [OrderIntent, number][] = [['Create', 9], ['Modify', 2], ['Cease', 1]]
  const fStates = shuffle(expand(FIBER_ORDER_MIX))
  const fOrderIntents = shuffle(expand(FIBER_INTENT_MIX))
  const fiberLive = services.filter((s) => s.state === 'Live' && s.intentId === 'INT-FIBER-WAVELENGTH')
  for (let i = 0; i < 12; i += 1) {
    const state = fStates[i]
    const orderIntent = fOrderIntents[i]
    const existing = orderIntent === 'Create' ? undefined : fiberLive[i % Math.max(1, fiberLive.length)]
    const intentId = 'INT-FIBER-WAVELENGTH'
    const intent = intentById(intentId)
    const acct = existing ? ACCOUNTS.find((a) => a.id === existing.accountId)! : pick(ACCOUNTS)
    const wf = active.find((w) => w.intentId === intentId) ?? active[0]

    const eps = existing?.endpoints ?? [endpointFor('A', 60000 + i * 2, intent.category), endpointFor('Z', 60000 + i * 2 + 1, intent.category)]
    const bandwidth = existing?.bandwidthMbps ?? pick([10, 100, 200, 400])
    const params: OrderParamValue[] = intent.params.map((p) => ({
      name: p.name,
      value: p.name === 'capacity_gbps' ? String(bandwidth)
        : p.fromPool ? `${1529 + between(0, 40)}.${between(10, 99)}nm`
          : p.default !== undefined ? String(p.default) : 'value',
      source: p.fromPool ? 'pool' : p.default !== undefined ? 'template' : 'user',
    }))
    const boundEps = bindEndpoints(eps, intent.category, intent.type, '', workflows, params, bandwidth)

    const ageDays = between(0, 30)
    const created = new Date(now - ageDays * 86400000)

    out.push({
      id: `ORD-2026-${pad(8000 - i * 2, 6)}`,
      code: `NS-${pad(800 + i, 6)}`,
      name: `${intent.name}${orderIntent !== 'Create' ? ` · ${orderIntent.toLowerCase()}` : ''}`,
      intent: orderIntent, intentId,
      category: intent.category,
      type: intent.type,
      subtype: pick(['Unprotected', 'Protected']),
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
          ? [{ role: 'NOC lead', by: 'Ravi K.', at: created.toISOString(), decision: 'Rejected', comment: 'Wavelength channel unavailable on this span.' }]
          : [{ role: 'NOC lead' }],
      delta: orderIntent === 'Modify'
        ? [{ attribute: 'Circuit capacity', current: `${bandwidth} Gbps`, requested: `${bandwidth * 2} Gbps` }]
        : undefined,
      slaBreached: (state === 'Failed' || state === 'Reinstantiate') && ageDays > 10,
      notes: undefined,
    })
  }

  /* Radio domain, RAN VNF category — additive: 20 more orders, single-ended
     CU/DU instances (no far end — a VNF isn't a link between two devices). */
  const RAN_ORDER_MIX: [OrderState, number][] = [
    ['Draft', 2], ['Planned', 1], ['Validated', 4], ['Approved', 2], ['Rejected', 1],
    ['Queued', 1], ['In progress', 1], ['Ready', 6], ['Failed', 2],
  ]
  const RAN_INTENT_MIX: [OrderIntent, number][] = [['Create', 15], ['Modify', 3], ['Cease', 2]]
  const vStates = shuffle(expand(RAN_ORDER_MIX))
  const vOrderIntents = shuffle(expand(RAN_INTENT_MIX))
  const ranLive = services.filter((s) => s.state === 'Live' && s.intentId.startsWith('INT-RAN'))
  for (let i = 0; i < 20; i += 1) {
    const state = vStates[i]
    const orderIntent = vOrderIntents[i]
    const existing = orderIntent === 'Create' ? undefined : ranLive[i % Math.max(1, ranLive.length)]
    const intentId = existing ? existing.intentId : pick(['INT-RAN-CU', 'INT-RAN-DU'])
    const intent = intentById(intentId)
    const acct = existing ? ACCOUNTS.find((a) => a.id === existing.accountId)! : pick(ACCOUNTS)
    const wf = active.find((w) => w.intentId === intentId) ?? active[0]

    const eps = existing?.endpoints ?? [endpointFor('A', 90000 + i, intent.category)]
    const bandwidth = existing?.bandwidthMbps ?? pick([500, 1000, 2000, 5000])
    const params: OrderParamValue[] = intent.params.map((p) => ({
      name: p.name,
      value: p.fromPool === 'IP block' ? `172.31.${between(80, 95)}.${between(2, 250)}`
        : p.fromPool === 'PCI' ? String(between(0, 503))
          : p.default !== undefined ? String(p.default)
            : p.name === 'plmn_id' ? '404-01'
              : p.name === 'gnb_id' ? `GNB-${between(10000, 99999)}`
                : p.name === 'cu_f1_ip' ? `172.31.90.${between(2, 250)}`
                  : p.name === 'max_ue_capacity' ? String(bandwidth)
                    : 'value',
      source: p.fromPool ? 'pool' : p.default !== undefined ? 'template' : 'user',
    }))
    const boundEps = bindEndpoints(eps, intent.category, intent.type, '', workflows, params, bandwidth)

    const ageDays = between(0, 30)
    const created = new Date(now - ageDays * 86400000)

    out.push({
      id: `ORD-2026-${pad(9000 - i * 2, 6)}`,
      code: `NS-${pad(900 + i, 6)}`,
      name: `${intent.name}${orderIntent !== 'Create' ? ` · ${orderIntent.toLowerCase()}` : ''}`,
      intent: orderIntent, intentId,
      category: intent.category,
      type: intent.type,
      subtype: intent.type === 'CU' ? pick(['Standalone', 'Non-Standalone']) : pick(['Indoor', 'Outdoor']),
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
          ? [{ role: 'NOC lead', by: 'Ravi K.', at: created.toISOString(), decision: 'Rejected', comment: 'Compute quota for this CU/DU workload is exhausted at the target site.' }]
          : [{ role: 'NOC lead' }],
      delta: orderIntent === 'Modify'
        ? [{ attribute: 'Max UE capacity', current: `${bandwidth}`, requested: `${bandwidth * 2}` }]
        : undefined,
      slaBreached: (state === 'Failed' || state === 'Reinstantiate') && ageDays > 10,
      notes: undefined,
    })
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

/**
 * Tie the two records together once both exist.
 *
 * Services are generated before orders, so at build time a service's change
 * history has no real order to point at, and an order that completed a Create
 * has no service to claim. Reconciling both directions is what makes the
 * estate walkable: a completed create owns the service it produced, and every
 * history entry either names an order that is genuinely in the system or
 * carries no order id at all — which is the honest record for a change made
 * before this platform held the request, or made straight on the device.
 *
 * Mutates in place; called once at seed time, after buildOrders.
 */
export function linkProvenance(services: Service[], orders: Order[]): void {
  const realOrder = new Set(orders.map((o) => o.id))
  const claimed = new Set(orders.map((o) => o.serviceId).filter(Boolean) as string[])

  /* A Create that reached Ready did its work, so something in the estate is
     the result of it. Pair each with an unclaimed service built from the same
     intent, so the categories and endpoints line up rather than being a
     nominal join between unrelated rows. */
  const spare = new Map<string, Service[]>()
  services.forEach((s) => {
    if (claimed.has(s.id) || s.state === 'Ceased') return
    const arr = spare.get(s.intentId) ?? []
    arr.push(s)
    spare.set(s.intentId, arr)
  })
  orders
    .filter((o) => o.intent === 'Create' && o.state === 'Ready' && !o.serviceId)
    .forEach((o) => {
      const svc = spare.get(o.intentId)?.pop()
      if (!svc) return
      o.serviceId = svc.id
      claimed.add(svc.id)
    })

  /* Point each service's history at the orders that actually touched it, and
     strip the invented ids from everything else. */
  const bySvc = new Map<string, Order[]>()
  orders.forEach((o) => {
    if (!o.serviceId) return
    const arr = bySvc.get(o.serviceId) ?? []
    arr.push(o)
    bySvc.set(o.serviceId, arr)
  })

  services.forEach((s) => {
    const own = [...(bySvc.get(s.id) ?? [])]
    s.history = s.history.map((h) => {
      if (!h.orderId || realOrder.has(h.orderId)) return h
      const real = own.shift()
      return real ? { ...h, orderId: real.id } : { ...h, orderId: undefined }
    })
  })
}
