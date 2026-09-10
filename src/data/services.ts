import type {
  Category, ChangeRecord, Conformance, Endpoint, HeldResource, OperState, Order,
  Service, ServiceAttribute, ServiceState,
} from '@/types'
import { ACCOUNTS, SITES, between, intentById, modelsForCategory, pad, pick, rnd } from './catalog'

/* Exact distributions — every screen's totals reconcile to these. */
const STATE_MIX: [ServiceState, number][] = [
  ['Live', 2143], ['Activating', 41], ['Degraded', 96], ['Suspended', 58], ['Ceased', 119],
]
const CONF_MIX: [Conformance, number][] = [
  ['Conformant', 1881], ['Drifted', 214], ['Never proven', 316], ['Ghost', 46],
]
const INTENT_MIX: [string, number][] = [
  ['INT-IBW-ACCESS', 1697], ['INT-L2-P2P', 431], ['INT-L2-RAILWIRE', 181],
  ['INT-L3-HUBSPOKE', 96], ['INT-L3-MESH', 52],
]

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

function makeEndpoint(role: Endpoint['role'], i: number, category: Category): Endpoint {
  const site = pick(SITES)
  const dm = pick(modelsForCategory(category))
  const port = pick(dm.ports)
  return {
    id: `EP-${pad(i, 6)}`,
    role, siteCode: site.code, deviceName: dm.model, vendor: dm.vendor,
    mgmtIp: `172.31.${between(10, 60)}.${between(2, 250)}`,
    port, subInterface: `${port}.${between(100, 900)}`,
  }
}

const OPER_FOR: Record<ServiceState, OperState> = {
  Live: 'Up', Activating: 'Unknown', Degraded: 'Degraded', Suspended: 'Down',
  Ceasing: 'Down', Ceased: 'Down', Purged: 'Unknown', Designed: 'Unknown',
}

function attributes(intentId: string, conformance: Conformance, bandwidth: number, vlan: number): ServiceAttribute[] {
  const drift = conformance === 'Drifted'
  const ghost = conformance === 'Ghost'
  const dev = (v: string) => (ghost ? 'not present' : v)
  const verdict = (d: boolean): ServiceAttribute['verdict'] => (ghost ? 'Absent' : d ? 'Drift' : 'Match')
  const verified = ghost ? undefined : `${between(1, 22)} h ago`
  const base: ServiceAttribute[] = [
    { name: 'Service type', intent: intentById(intentId).name, onDevice: dev(intentById(intentId).type), source: 'Order', verifiedAt: verified, verdict: verdict(false) },
    { name: 'Bandwidth', intent: `${bandwidth} Mbps`, onDevice: dev(drift ? `${bandwidth * 2} Mbps` : `${bandwidth} Mbps`), source: drift ? 'Manual' : 'Order', verifiedAt: verified, verdict: verdict(drift) },
    { name: 'MTU', intent: '1500', onDevice: dev('1500'), source: 'Order', verifiedAt: verified, verdict: verdict(false) },
  ]
  if (intentId.startsWith('INT-L2')) {
    base.splice(1, 0,
      { name: 'VLAN', intent: String(vlan), onDevice: dev(String(vlan)), source: 'Reserved', verifiedAt: verified, verdict: verdict(false) },
      { name: 'Pseudowire ID', intent: String(4000 + vlan), onDevice: dev(String(4000 + vlan)), source: 'Reserved', verifiedAt: verified, verdict: verdict(false) },
    )
  } else if (intentId.startsWith('INT-L3')) {
    base.splice(1, 0,
      { name: 'Route distinguisher', intent: `65001:${vlan}`, onDevice: dev(`65001:${vlan}`), source: 'Reserved', verifiedAt: verified, verdict: verdict(false) },
      { name: 'PE-CE protocol', intent: 'BGP', onDevice: dev('BGP'), source: 'Order', verifiedAt: verified, verdict: verdict(false) },
    )
  } else if (intentId.startsWith('INT-ACCESS')) {
    base.splice(1, 0,
      { name: 'WAN VLAN', intent: String(vlan), onDevice: dev(String(vlan)), source: 'Reserved', verifiedAt: verified, verdict: verdict(false) },
      { name: 'SSID broadcasting', intent: 'true', onDevice: dev(drift ? 'false' : 'true'), source: 'Order', verifiedAt: verified, verdict: verdict(drift) },
    )
  } else if (intentId.startsWith('INT-RADIO')) {
    base.splice(1, 0,
      { name: 'Frequency channel', intent: `FC-${1000 + vlan}`, onDevice: dev(`FC-${1000 + vlan}`), source: 'Reserved', verifiedAt: verified, verdict: verdict(false) },
      { name: 'Received signal level', intent: 'within budget', onDevice: dev(drift ? 'out of range' : 'within budget'), source: 'Manual', verifiedAt: verified, verdict: verdict(drift) },
    )
  } else if (intentId.startsWith('INT-FIBER')) {
    base.splice(1, 0,
      { name: 'Wavelength channel', intent: `${1529 + (vlan % 40)}.${10 + (vlan % 90)}nm`, onDevice: dev(`${1529 + (vlan % 40)}.${10 + (vlan % 90)}nm`), source: 'Reserved', verifiedAt: verified, verdict: verdict(false) },
      { name: 'OTN FEC lock', intent: 'locked', onDevice: dev(drift ? 'unlocked' : 'locked'), source: 'Manual', verifiedAt: verified, verdict: verdict(drift) },
    )
  } else if (intentId === 'INT-RAN-CU') {
    base.splice(1, 0,
      { name: 'PLMN', intent: '404-01', onDevice: dev('404-01'), source: 'Order', verifiedAt: verified, verdict: verdict(false) },
      { name: 'NG-C interface state', intent: 'Connected', onDevice: dev(drift ? 'Disconnected' : 'Connected'), source: 'Manual', verifiedAt: verified, verdict: verdict(drift) },
    )
  } else if (intentId === 'INT-RAN-DU') {
    base.splice(1, 0,
      { name: 'PCI', intent: String(vlan % 504), onDevice: dev(String(vlan % 504)), source: 'Reserved', verifiedAt: verified, verdict: verdict(false) },
      { name: 'Cell state', intent: 'Active', onDevice: dev(drift ? 'Inactive' : 'Active'), source: 'Manual', verifiedAt: verified, verdict: verdict(drift) },
    )
  } else {
    base.splice(1, 0,
      { name: 'Customer ASN', intent: String(64500 + between(1, 900)), onDevice: dev(String(64500 + between(1, 900))), source: 'Order', verifiedAt: verified, verdict: verdict(false) },
      { name: 'Prefix limit', intent: '500', onDevice: dev('500'), source: 'Order', verifiedAt: verified, verdict: verdict(false) },
    )
  }
  base.push({ name: 'Purchase order', intent: '—', onDevice: 'n/a', source: 'No source system', verdict: 'Not sourced' })
  return base
}

/* A service's held resources are no longer invented here. buildPools() hands
   each one out from a real pool entry and writes the value onto the service,
   so the two records are the same allocation seen from both ends. Services
   are therefore built with an empty `resources` list and filled in there. */

function history(id: string, liveSince: Date, conformance: Conformance): ChangeRecord[] {
  /* Days of runway between activation and now — every change below is
     placed inside it, so nothing is stamped in the future. */
  const sinceDays = Math.max(1, Math.floor((Date.now() - liveSince.getTime()) / 86400000))
  const out: ChangeRecord[] = [{
    at: liveSince.toISOString(), orderId: `ORD-2026-${pad(between(1000, 4400), 6)}`,
    change: 'Created · service went Live', by: pick(['Priya S.', 'Ravi K.', 'Anil M.']), outOfBand: false,
  }]
  if (conformance === 'Drifted') {
    out.unshift({
      at: new Date(liveSince.getTime() + 86400000 * between(1, Math.min(200, sinceDays))).toISOString(),
      change: 'Bandwidth changed on the device', by: 'ops-nikhil', outOfBand: true,
    })
  }
  if (rnd() > 0.6) {
    out.unshift({
      at: new Date(liveSince.getTime() + 86400000 * between(1, Math.min(160, sinceDays))).toISOString(),
      orderId: `ORD-2026-${pad(between(1000, 4400), 6)}`,
      change: pick(['MTU 1400 → 1500', 'Bandwidth 100 → 200 Mbps', 'Prefix limit 300 → 500', 'Added spoke site']),
      by: pick(['Priya S.', 'Ravi K.']), outOfBand: false,
    })
  }
  void id
  return out
}

/* Access domain — additive batch, appended after Transport's fixed 2457 so
   none of the reconciled Transport totals above shift. Sums to 260. */
const ACCESS_STATE_MIX: [ServiceState, number][] = [
  ['Live', 224], ['Activating', 6], ['Degraded', 10], ['Suspended', 8], ['Ceased', 12],
]
const ACCESS_CONF_MIX: [Conformance, number][] = [
  ['Conformant', 205], ['Drifted', 22], ['Never proven', 28], ['Ghost', 5],
]
const ACCESS_INTENT_MIX: [string, number][] = [
  ['INT-ACCESS-RESIDENTIAL', 200], ['INT-ACCESS-BUSINESS', 60],
]

/* Radio domain — additive batch. Sums to 120. */
const RADIO_STATE_MIX: [ServiceState, number][] = [
  ['Live', 100], ['Activating', 3], ['Degraded', 6], ['Suspended', 4], ['Ceased', 7],
]
const RADIO_CONF_MIX: [Conformance, number][] = [
  ['Conformant', 92], ['Drifted', 12], ['Never proven', 13], ['Ghost', 3],
]

/* Fiber domain — additive batch. Sums to 80. */
const FIBER_STATE_MIX: [ServiceState, number][] = [
  ['Live', 68], ['Activating', 2], ['Degraded', 4], ['Suspended', 2], ['Ceased', 4],
]
const FIBER_CONF_MIX: [Conformance, number][] = [
  ['Conformant', 62], ['Drifted', 8], ['Never proven', 8], ['Ghost', 2],
]

/* Radio domain, RAN VNF category — additive batch. Sums to 110. */
const RAN_STATE_MIX: [ServiceState, number][] = [
  ['Live', 92], ['Activating', 4], ['Degraded', 5], ['Suspended', 3], ['Ceased', 6],
]
const RAN_CONF_MIX: [Conformance, number][] = [
  ['Conformant', 84], ['Drifted', 10], ['Never proven', 13], ['Ghost', 3],
]
const RAN_INTENT_MIX: [string, number][] = [
  ['INT-RAN-CU', 42], ['INT-RAN-DU', 68],
]

export function buildServices(): Service[] {
  const states = shuffle(expand(STATE_MIX))
  const confs = shuffle(expand(CONF_MIX))
  const intents = shuffle(expand(INTENT_MIX))
  const now = Date.now()
  const out: Service[] = []

  for (let i = 0; i < 2457; i += 1) {
    const intentId = intents[i]
    const intent = intentById(intentId)
    let state = states[i]
    let conformance = confs[i]
    // Keep the two axes coherent: a ceased service is not "drifted",
    // and an activating service has not been proven yet.
    if (state === 'Ceased') conformance = 'Not checked'
    if (state === 'Activating' && conformance === 'Drifted') conformance = 'Not checked'

    const acct = pick(ACCOUNTS)
    const vlan = between(100, 900)
    const nEnd = intent.topology === 'Single-ended' ? 1
      : intent.topology === 'Two-ended' ? 2 : between(3, 6)
    const eps: Endpoint[] = []
    for (let e = 0; e < nEnd; e += 1) {
      eps.push(makeEndpoint(
        intent.topology === 'Star' ? (e === 0 ? 'hub' : 'spoke') : e === 0 ? 'A' : 'Z',
        i * 10 + e, intent.category,
      ))
    }
    const bandwidth = pick([10, 20, 50, 100, 200, 500, 1000])
    const ageDays = between(3, 1400)
    const liveSince = new Date(now - ageDays * 86400000)
    liveSince.setHours(between(0, 23), between(0, 59), 0, 0)
    if (liveSince.getTime() > now) liveSince.setTime(now - between(5, 180) * 60000)
    const proven = conformance === 'Never proven' || conformance === 'Ghost'
      ? undefined
      : new Date(now - between(1, 40) * 3600000).toISOString()
    const prefix = intent.category === 'IBW' ? 'IBW' : intent.category === 'L2VPN' ? 'L2' : 'L3'
    const years = Math.floor(ageDays / 365)
    const months = Math.floor((ageDays % 365) / 30)

    out.push({
      id: `SVC-${prefix}-${pad(100000 + i * 7, 6)}`,
      name: `${acct.name.split(' ')[0]} ${pick(SITES).city} ${intent.category === 'IBW' ? 'DIA' : 'link'}`,
      category: intent.category, type: intent.type, intentId,
      accountId: acct.id, accountName: acct.name,
      state, operState: OPER_FOR[state], conformance,
      endpoints: eps,
      attributes: attributes(intentId, conformance, bandwidth, vlan),
      resources: [],
      history: history(`s${i}`, liveSince, conformance),
      bandwidthMbps: bandwidth,
      monthlyValueInr: bandwidth * between(900, 1800),
      liveSince: liveSince.toISOString(),
      lastProvenAt: proven,
      ageLabel: years > 0 ? `${years} y ${months} m` : `${Math.max(1, months)} m`,
      driftCount: conformance === 'Drifted' ? between(1, 3) : 0,
      acceptanceEvidence: conformance === 'Conformant'
        ? intent.acceptance.map((a) => ({
          criterion: a.claim, layer: a.layer, expected: a.expected,
          actual: a.layer === 'service' ? `${(bandwidth * (0.96 + rnd() * 0.06)).toFixed(1)} Mbps · 0/20 loss` : 'up / Established',
          passed: true,
        }))
        : undefined,
    })
  }

  /* One hand-authored service so the detail screen always has a rich example. */
  const featured = out.find((s) => s.intentId === 'INT-L2-P2P' && s.conformance === 'Drifted')
  if (featured) {
    featured.id = 'SVC-L2-018842'
    featured.name = 'Excitel BLR ring — east leg'
    featured.accountId = 'ACC-04417'
    featured.accountName = 'Excitel Business Solutions'
    featured.state = 'Live'
    featured.operState = 'Up'
    featured.bandwidthMbps = 100
    featured.driftCount = 1
    featured.endpoints = [
      { id: 'EP-A', role: 'A', siteCode: 'DL-BLR-0412', deviceName: 'MX204', vendor: 'JUNIPER', mgmtIp: '172.31.33.20', port: 'xe-0/0/3', subInterface: 'xe-0/0/3.104' },
      { id: 'EP-Z', role: 'Z', siteCode: 'DL-BLR-0977', deviceName: 'MX204', vendor: 'JUNIPER', mgmtIp: '172.31.33.100', port: 'xe-1/1/0', subInterface: 'xe-1/1/0.104' },
    ]
    featured.attributes = attributes('INT-L2-P2P', 'Drifted', 100, 104)

    featured.lastProvenAt = new Date(now - 4 * 3600000).toISOString()
    featured.acceptanceEvidence = [
      { criterion: 'Both sub-interfaces admin-up and oper-up', layer: 'device', expected: 'admin=up, link=up ×2', actual: 'up/up · up/up', passed: true },
      { criterion: 'Pseudowire 4104 Up at both ends, matching vc-id', layer: 'device', expected: 'state=Up, vc-id=4104', actual: 'Up/Up · 4104/4104', passed: true },
      { criterion: 'MPLS LSP to 172.31.33.100 resolves', layer: 'network', expected: 'received >= 4', actual: '5', passed: true },
      { criterion: '1500-byte frame crosses CE to CE, 0 loss over 20', layer: 'service', expected: 'loss = 0/20, mtu = 1500', actual: '0/20 · 1500 · avg 3.8 ms', passed: true },
      { criterion: 'Throughput within ±5% of ordered 100 Mbps', layer: 'service', expected: '95 – 105 Mbps', actual: '98.4 Mbps', passed: true },
    ]
  }

  /* Access domain — additive: 260 more services, on top of Transport's 2457. */
  const aStates = shuffle(expand(ACCESS_STATE_MIX))
  const aConfs = shuffle(expand(ACCESS_CONF_MIX))
  const aIntents = shuffle(expand(ACCESS_INTENT_MIX))
  for (let i = 0; i < 260; i += 1) {
    const intentId = aIntents[i]
    const intent = intentById(intentId)
    let state = aStates[i]
    let conformance = aConfs[i]
    if (state === 'Ceased') conformance = 'Not checked'
    if (state === 'Activating' && conformance === 'Drifted') conformance = 'Not checked'

    const acct = pick(ACCOUNTS)
    const vlan = between(100, 900)
    const eps: Endpoint[] = [makeEndpoint('A', 30000 + i, intent.category)]
    const bandwidth = pick([50, 100, 200, 300, 500])
    const ageDays = between(3, 900)
    const liveSince = new Date(now - ageDays * 86400000)
    liveSince.setHours(between(0, 23), between(0, 59), 0, 0)
    if (liveSince.getTime() > now) liveSince.setTime(now - between(5, 180) * 60000)
    const proven = conformance === 'Never proven' || conformance === 'Ghost'
      ? undefined
      : new Date(now - between(1, 40) * 3600000).toISOString()
    const years = Math.floor(ageDays / 365)
    const months = Math.floor((ageDays % 365) / 30)

    out.push({
      id: `SVC-ACC-${pad(200000 + i * 3, 6)}`,
      name: `${acct.name.split(' ')[0]} ${pick(SITES).city} broadband`,
      category: intent.category, type: intent.type, intentId,
      accountId: acct.id, accountName: acct.name,
      state, operState: OPER_FOR[state], conformance,
      endpoints: eps,
      attributes: attributes(intentId, conformance, bandwidth, vlan),
      resources: [],
      history: history(`a${i}`, liveSince, conformance),
      bandwidthMbps: bandwidth,
      monthlyValueInr: between(499, 2999),
      liveSince: liveSince.toISOString(),
      lastProvenAt: proven,
      ageLabel: years > 0 ? `${years} y ${months} m` : `${Math.max(1, months)} m`,
      driftCount: conformance === 'Drifted' ? between(1, 2) : 0,
      acceptanceEvidence: conformance === 'Conformant'
        ? intent.acceptance.map((a) => ({
          criterion: a.claim, layer: a.layer, expected: a.expected,
          actual: a.layer === 'service' ? `${(bandwidth * (0.9 + rnd() * 0.1)).toFixed(1)} Mbps` : 'Online / broadcasting',
          passed: true,
        }))
        : undefined,
    })
  }

  /* Radio domain — additive: 120 more services, two-ended microwave links. */
  const rStates = shuffle(expand(RADIO_STATE_MIX))
  const rConfs = shuffle(expand(RADIO_CONF_MIX))
  for (let i = 0; i < 120; i += 1) {
    const intentId = 'INT-RADIO-PTP'
    const intent = intentById(intentId)
    let state = rStates[i]
    let conformance = rConfs[i]
    if (state === 'Ceased') conformance = 'Not checked'
    if (state === 'Activating' && conformance === 'Drifted') conformance = 'Not checked'

    const acct = pick(ACCOUNTS)
    const vlan = between(100, 900)
    const eps: Endpoint[] = [makeEndpoint('A', 300000 + i * 2, intent.category), makeEndpoint('Z', 300000 + i * 2 + 1, intent.category)]
    const bandwidth = pick([50, 100, 200, 500, 1000])
    const ageDays = between(3, 1200)
    const liveSince = new Date(now - ageDays * 86400000)
    liveSince.setHours(between(0, 23), between(0, 59), 0, 0)
    if (liveSince.getTime() > now) liveSince.setTime(now - between(5, 180) * 60000)
    const proven = conformance === 'Never proven' || conformance === 'Ghost'
      ? undefined
      : new Date(now - between(1, 40) * 3600000).toISOString()
    const years = Math.floor(ageDays / 365)
    const months = Math.floor((ageDays % 365) / 30)

    out.push({
      id: `SVC-RAD-${pad(300000 + i * 3, 6)}`,
      name: `${acct.name.split(' ')[0]} ${pick(SITES).city} microwave hop`,
      category: intent.category, type: intent.type, intentId,
      accountId: acct.id, accountName: acct.name,
      state, operState: OPER_FOR[state], conformance,
      endpoints: eps,
      attributes: attributes(intentId, conformance, bandwidth, vlan),
      resources: [],
      history: history(`r${i}`, liveSince, conformance),
      bandwidthMbps: bandwidth,
      monthlyValueInr: between(20000, 80000),
      liveSince: liveSince.toISOString(),
      lastProvenAt: proven,
      ageLabel: years > 0 ? `${years} y ${months} m` : `${Math.max(1, months)} m`,
      driftCount: conformance === 'Drifted' ? between(1, 2) : 0,
      acceptanceEvidence: conformance === 'Conformant'
        ? intent.acceptance.map((a) => ({
          criterion: a.claim, layer: a.layer, expected: a.expected,
          actual: a.layer === 'service' ? `${(bandwidth * (0.95 + rnd() * 0.05)).toFixed(1)} Mbps` : 'up / within budget',
          passed: true,
        }))
        : undefined,
    })
  }

  /* Fiber domain — additive: 80 more services, two-ended DWDM circuits. */
  const fStates = shuffle(expand(FIBER_STATE_MIX))
  const fConfs = shuffle(expand(FIBER_CONF_MIX))
  for (let i = 0; i < 80; i += 1) {
    const intentId = 'INT-FIBER-WAVELENGTH'
    const intent = intentById(intentId)
    let state = fStates[i]
    let conformance = fConfs[i]
    if (state === 'Ceased') conformance = 'Not checked'
    if (state === 'Activating' && conformance === 'Drifted') conformance = 'Not checked'

    const acct = pick(ACCOUNTS)
    const vlan = between(100, 900)
    const eps: Endpoint[] = [makeEndpoint('A', 400000 + i * 2, intent.category), makeEndpoint('Z', 400000 + i * 2 + 1, intent.category)]
    const bandwidth = pick([10, 100, 200, 400])
    const ageDays = between(3, 1200)
    const liveSince = new Date(now - ageDays * 86400000)
    liveSince.setHours(between(0, 23), between(0, 59), 0, 0)
    if (liveSince.getTime() > now) liveSince.setTime(now - between(5, 180) * 60000)
    const proven = conformance === 'Never proven' || conformance === 'Ghost'
      ? undefined
      : new Date(now - between(1, 40) * 3600000).toISOString()
    const years = Math.floor(ageDays / 365)
    const months = Math.floor((ageDays % 365) / 30)

    out.push({
      id: `SVC-FIB-${pad(400000 + i * 3, 6)}`,
      name: `${acct.name.split(' ')[0]} ${pick(SITES).city} DWDM circuit`,
      category: intent.category, type: intent.type, intentId,
      accountId: acct.id, accountName: acct.name,
      state, operState: OPER_FOR[state], conformance,
      endpoints: eps,
      attributes: attributes(intentId, conformance, bandwidth, vlan),
      resources: [],
      history: history(`f${i}`, liveSince, conformance),
      bandwidthMbps: bandwidth,
      monthlyValueInr: between(50000, 300000),
      liveSince: liveSince.toISOString(),
      lastProvenAt: proven,
      ageLabel: years > 0 ? `${years} y ${months} m` : `${Math.max(1, months)} m`,
      driftCount: conformance === 'Drifted' ? between(1, 2) : 0,
      acceptanceEvidence: conformance === 'Conformant'
        ? intent.acceptance.map((a) => ({
          criterion: a.claim, layer: a.layer, expected: a.expected,
          actual: a.layer === 'service' ? `${(bandwidth * (0.98 + rnd() * 0.02)).toFixed(1)} Gbps` : 'up / locked',
          passed: true,
        }))
        : undefined,
    })
  }

  /* Radio domain, RAN VNF category — additive: 110 more services, single-ended
     CU/DU instances (no far end — a VNF isn't a link between two devices). */
  const vStates = shuffle(expand(RAN_STATE_MIX))
  const vConfs = shuffle(expand(RAN_CONF_MIX))
  const vIntents = shuffle(expand(RAN_INTENT_MIX))
  for (let i = 0; i < 110; i += 1) {
    const intentId = vIntents[i]
    const intent = intentById(intentId)
    let state = vStates[i]
    let conformance = vConfs[i]
    if (state === 'Ceased') conformance = 'Not checked'
    if (state === 'Activating' && conformance === 'Drifted') conformance = 'Not checked'

    const acct = pick(ACCOUNTS)
    const vlan = between(100, 900)
    const eps: Endpoint[] = [makeEndpoint('A', 500000 + i, intent.category)]
    const bandwidth = pick([500, 1000, 2000, 5000])
    const ageDays = between(3, 700)
    const liveSince = new Date(now - ageDays * 86400000)
    liveSince.setHours(between(0, 23), between(0, 59), 0, 0)
    if (liveSince.getTime() > now) liveSince.setTime(now - between(5, 180) * 60000)
    const proven = conformance === 'Never proven' || conformance === 'Ghost'
      ? undefined
      : new Date(now - between(1, 40) * 3600000).toISOString()
    const years = Math.floor(ageDays / 365)
    const months = Math.floor((ageDays % 365) / 30)

    out.push({
      id: `SVC-RAN-${pad(500000 + i * 3, 6)}`,
      name: `${acct.name.split(' ')[0]} ${pick(SITES).city} ${intent.type === 'DU' ? 'gNB-DU' : 'gNB-CU'}`,
      category: intent.category, type: intent.type, intentId,
      accountId: acct.id, accountName: acct.name,
      state, operState: OPER_FOR[state], conformance,
      endpoints: eps,
      attributes: attributes(intentId, conformance, bandwidth, vlan),
      resources: [],
      history: history(`v${i}`, liveSince, conformance),
      bandwidthMbps: bandwidth,
      monthlyValueInr: between(40000, 150000),
      liveSince: liveSince.toISOString(),
      lastProvenAt: proven,
      ageLabel: years > 0 ? `${years} y ${months} m` : `${Math.max(1, months)} m`,
      driftCount: conformance === 'Drifted' ? between(1, 2) : 0,
      acceptanceEvidence: conformance === 'Conformant'
        ? intent.acceptance.map((a) => ({
          criterion: a.claim, layer: a.layer, expected: a.expected,
          actual: a.layer === 'service' ? `${(bandwidth * (0.95 + rnd() * 0.05)).toFixed(1)} UEs / cell` : 'running / healthy',
          passed: true,
        }))
        : undefined,
    })
  }

  return out
}

/**
 * The service a completed Create request leaves behind.
 *
 * This is the step the platform's whole story builds towards: the request
 * carried the design, a workflow configured each endpoint, the pools handed
 * over the values, and the run proved traffic actually moved — so the estate
 * has one more service in it, traceable back to all four. It is born Live and
 * Conformant with the run's acceptance criteria as its first proof, which is
 * the only moment in a service's life when those things are true by
 * construction rather than by re-checking.
 */
export function serviceFromOrder(order: Order, held: HeldResource[], seq: number): Service {
  const intent = intentById(order.intentId)
  const now = new Date()
  const num = (name: string, fallback: number) =>
    Number(order.params.find((p) => p.name === name)?.value ?? fallback) || fallback
  const bandwidth = num('bandwidth_mbps', num('capacity_mbps', 100))
  const vlan = num('vlan', 100)
  const prefix = order.category === 'IBW' ? 'IBW'
    : order.category === 'L2VPN' ? 'L2'
      : order.category === 'L3VPN' ? 'L3' : 'NS'

  return {
    id: `SVC-${prefix}-${pad(900000 + seq, 6)}`,
    name: order.name,
    category: order.category,
    type: order.type,
    intentId: order.intentId,
    accountId: order.accountId,
    accountName: order.accountName,
    state: 'Live',
    operState: 'Up',
    conformance: 'Conformant',
    endpoints: order.endpoints,
    attributes: attributes(order.intentId, 'Conformant', bandwidth, vlan),
    resources: held,
    history: [{
      at: now.toISOString(),
      orderId: order.id,
      change: 'Created · service went Live',
      by: order.owner ?? 'Orchestrator',
      outOfBand: false,
    }],
    bandwidthMbps: bandwidth,
    monthlyValueInr: bandwidth * between(900, 1800),
    liveSince: now.toISOString(),
    lastProvenAt: now.toISOString(),
    ageLabel: '0 m',
    driftCount: 0,
    acceptanceEvidence: intent.acceptance.map((a) => ({
      criterion: a.claim,
      layer: a.layer,
      expected: a.expected,
      actual: a.layer === 'service' ? `${bandwidth.toFixed(1)} Mbps · 0/20 loss` : 'up / Established',
      passed: true,
    })),
  }
}
