import type { HeldResource, Notification, PoolEntry, PoolKind, ReportDef, ResourcePool, Service } from '@/types'
import { SITES, between, pad, pick, rnd } from './catalog'

/* ---------- resource pools ----------

   The pools are the single source of truth for who holds what. Services do
   not invent the values they claim: this module hands each one out from a
   real pool entry and writes the same value onto the service, so both sides
   of the relationship are the same fact recorded twice, and a value can
   never be held by two services or by a service the pool has never heard of.

   Pool sizes are derived from what the estate actually consumes rather than
   typed in, so the utilisation figures on screen are measured, not invented.
   Where a namespace is genuinely finite (1023 private ASNs, 504 PCIs, 96
   channels on the ITU grid) that ceiling is enforced and demand is limited
   to fit — which is the real constraint those pools are under.        */

/** A pool before any allocation: structure and free values only. */
interface PoolSeed {
  id: string
  kind: PoolKind
  scope: string
  label: (n: number) => string
  /** Fraction to leave free once every holder has been served. */
  headroom: number
  /** Hard ceiling where the namespace is finite. */
  cap?: number
}

/**
 * The pool kinds one service draws on. Mirrors the `pools` each intent
 * declares in the catalog — per-endpoint kinds are repeated per endpoint,
 * because a sub-interface and a VLAN are consumed at every end.
 */
function demandFor(intentId: string, endpointCount: number, seq: number): PoolKind[] {
  const out: PoolKind[] = []
  for (let e = 0; e < endpointCount; e += 1) out.push('Sub-interface')

  if (intentId.startsWith('INT-L2')) {
    for (let e = 0; e < endpointCount; e += 1) out.push('VLAN')
    out.push('Pseudowire ID')
  } else if (intentId.startsWith('INT-L3')) {
    out.push('RD/RT', 'IP block')
  } else if (intentId.startsWith('INT-ACCESS')) {
    out.push('VLAN', 'CPE Serial')
  } else if (intentId.startsWith('INT-RADIO')) {
    out.push('Frequency Channel')
  } else if (intentId.startsWith('INT-FIBER')) {
    out.push('Wavelength')
  } else if (intentId === 'INT-GPON-RESI' || intentId === 'INT-XGSPON-BIZ') {
    out.push('VLAN', 'ONT Serial', 'PON Port')
  } else if (intentId === 'INT-RAN-CU') {
    out.push('IP block')
  } else if (intentId === 'INT-RAN-DU') {
    out.push('PCI')
  } else {
    /* IBW. Only part of the base sits on a private ASN — the range is 1023
       wide and there are more internet-access services than that, so the
       rest peer on a public ASN the platform doesn't allocate. */
    out.push('IP block')
    if (seq % 3 === 0) out.push('ASN slot')
  }
  return out
}

const SEEDS: PoolSeed[] = [
  ...SITES.slice(0, 6).map((s, i): PoolSeed => ({
    id: `POOL-VLAN-${pad(i + 1, 3)}`, kind: 'VLAN', scope: `${s.code} · xe-0/0/${i}`,
    label: (n) => String(100 + n), headroom: 0.22 + i * 0.04,
  })),
  ...SITES.slice(0, 6).map((s, i): PoolSeed => ({
    id: `POOL-SUBIF-${pad(i + 1, 3)}`, kind: 'Sub-interface', scope: `${s.code} · sub-interface index`,
    label: (n) => `.${100 + n}`, headroom: 0.3 + i * 0.03,
  })),
  { id: 'POOL-PWID-001', kind: 'Pseudowire ID', scope: 'global L2VPN', label: (n) => String(4000 + n), headroom: 0.36 },
  { id: 'POOL-RDRT-001', kind: 'RD/RT', scope: 'global route target · 65001:x', label: (n) => `65001:${1000 + n}`, headroom: 0.55 },
  /* Deliberately the tightest pool in the estate — an exhausted transit range
     blocks new internet access orders before anything else fails. */
  { id: 'POOL-IP-001', kind: 'IP block', scope: 'WAN transit 10.244.0.0/16 · /30', label: (n) => `10.244.${Math.floor(n / 64)}.${(n % 64) * 4}/30`, headroom: 0.05 },
  { id: 'POOL-ASN-001', kind: 'ASN slot', scope: 'private ASN 64512–65534', label: (n) => String(64512 + n), headroom: 0.4, cap: 1023 },
  { id: 'POOL-CPESN-001', kind: 'CPE Serial', scope: 'pre-provisioned stock · Huawei/ZTE/Adtran', label: (n) => `SN-${100000 + n}`, headroom: 0.3 },
  { id: 'POOL-FREQ-001', kind: 'Frequency Channel', scope: 'licensed bands · L6/U6/L7/L8/E-band', label: (n) => `FC-${1000 + n}`, headroom: 0.36 },
  /* The C-band grid is 96 channels. It cannot be widened by ordering more. */
  { id: 'POOL-WL-001', kind: 'Wavelength', scope: 'ITU-T 100GHz grid · C-band 1529–1569nm', label: (n) => `${1529 + Math.floor(n / 2)}.${(n % 2) * 50 + 12}nm`, headroom: 0.08, cap: 96 },
  { id: 'POOL-PCI-001', kind: 'PCI', scope: '3GPP TS 38.211 · mod-3 / mod-30 collision-free plan', label: (n) => String(n), headroom: 0.6, cap: 504 },
  { id: 'POOL-ONTSN-001', kind: 'ONT Serial', scope: 'pre-provisioned stock · Nokia/Huawei/ZTE', label: (n) => `ONT-${100000 + n}`, headroom: 0.3 },
  { id: 'POOL-PONPORT-001', kind: 'PON Port', scope: 'GPON OLT estate · PON port + ONU-ID slot', label: (n) => `PON 1/1/${1 + (n % 8)}:${1 + Math.floor(n / 8)}`, headroom: 0.25 },
]

/**
 * Allocate every service's resources from real pool entries.
 *
 * Mutates `services`, replacing whatever `resources` they were built with by
 * the values actually handed out — that is the point: one allocation, written
 * to both sides, so Service Inventory and Resource Pools can never disagree.
 */
export function buildPools(services: Service[]): ResourcePool[] {
  /* Pass 1 — how much of each kind the estate consumes, so pools can be
     sized from real demand instead of a guess. A per-kind counter also lets
     the finite namespaces cap demand rather than overflow. */
  const demand = new Map<PoolKind, number>()
  const perService = services.map((s, i) => {
    const kinds = demandFor(s.intentId, s.endpoints.length, i)
    kinds.forEach((k) => demand.set(k, (demand.get(k) ?? 0) + 1))
    return kinds
  })

  /* Split per-kind demand across the pools that serve that kind. */
  const seedsByKind = new Map<PoolKind, PoolSeed[]>()
  SEEDS.forEach((sd) => {
    if (!seedsByKind.has(sd.kind)) seedsByKind.set(sd.kind, [])
    seedsByKind.get(sd.kind)!.push(sd)
  })

  const pools: ResourcePool[] = []
  const cursor = new Map<string, number>()      // pool id → next free index
  const byId = new Map<string, ResourcePool>()

  SEEDS.forEach((sd) => {
    const share = Math.ceil((demand.get(sd.kind) ?? 0) / seedsByKind.get(sd.kind)!.length)
    const sized = Math.max(24, Math.ceil(share / Math.max(0.05, 1 - sd.headroom)))
    /* A capped pool IS its namespace: the C-band grid has 96 channels and the
       private ASN range 1023 slots whether the estate uses five or all of them.
       Sizing those to demand would invent a ceiling that doesn't exist. */
    const total = sd.cap ?? sized
    const pool: ResourcePool = {
      id: sd.id, kind: sd.kind, scope: sd.scope,
      total, allocated: 0, quarantined: 0, reserved: 0,
      entries: Array.from({ length: total }, (_, n) => ({ value: sd.label(n), state: 'Free' as const })),
    }
    pools.push(pool)
    byId.set(sd.id, pool)
    cursor.set(sd.id, 0)
  })

  /** Take the next free entry of `kind`, preferring the pool for this site. */
  const take = (kind: PoolKind, siteIdx: number): { pool: ResourcePool; entry: PoolEntry } | undefined => {
    const candidates = seedsByKind.get(kind)!.map((sd) => byId.get(sd.id)!)
    const start = candidates.length > 1 ? siteIdx % candidates.length : 0
    for (let hop = 0; hop < candidates.length; hop += 1) {
      const pool = candidates[(start + hop) % candidates.length]
      let n = cursor.get(pool.id)!
      while (n < pool.entries.length && pool.entries[n].state !== 'Free') n += 1
      cursor.set(pool.id, n)
      if (n < pool.entries.length) return { pool, entry: pool.entries[n] }
    }
    return undefined      // genuinely exhausted; the service goes without
  }

  /* Pass 2 — hand values out, writing the same fact to both sides. */
  services.forEach((s, i) => {
    const held: HeldResource[] = []
    const ceased = s.state === 'Ceased'
    const siteIdx = SITES.findIndex((x) => x.code === s.endpoints[0]?.siteCode)

    perService[i].forEach((kind) => {
      const got = take(kind, siteIdx < 0 ? i : siteIdx)
      if (!got) return
      const { pool, entry } = got
      entry.state = ceased ? 'Quarantined' : 'Allocated'
      entry.serviceId = s.id
      if (ceased) {
        entry.releasedAt = new Date(Date.now() - between(1, 25) * 86400000).toISOString()
        entry.quarantineUntil = new Date(Date.now() + between(1, 30) * 86400000).toISOString()
      }
      held.push({ kind, value: entry.value, pool: pool.scope, state: entry.state === 'Quarantined' ? 'Quarantined' : 'Allocated' })
    })

    s.resources = held
  })

  /* Pass 3 — a little of the remaining headroom is reserved (held for an
     approved order that hasn't run) or in quarantine from an older cease
     this dataset doesn't otherwise model, then recount from the entries so
     the headline figures can't drift from what the table shows. */
  pools.forEach((p) => {
    const free = p.entries.filter((e) => e.state === 'Free')
    const reserve = Math.min(free.length, between(0, Math.max(1, Math.floor(free.length * 0.04))))
    for (let n = 0; n < reserve; n += 1) free[n].state = 'Reserved'
    const stillFree = free.slice(reserve)
    const quar = Math.min(stillFree.length, between(0, Math.max(1, Math.floor(stillFree.length * 0.05))))
    for (let n = 0; n < quar; n += 1) {
      stillFree[n].state = 'Quarantined'
      stillFree[n].quarantineUntil = new Date(Date.now() + between(1, 30) * 86400000).toISOString()
    }
    p.allocated = p.entries.filter((e) => e.state === 'Allocated').length
    p.quarantined = p.entries.filter((e) => e.state === 'Quarantined').length
    p.reserved = p.entries.filter((e) => e.state === 'Reserved').length
  })

  return pools
}

/**
 * Hand one service its resources from the live pools, at runtime.
 *
 * The seed path above allocates for the whole estate at once; this is the same
 * act for a single service coming into existence because a Create request
 * completed. Returns new pool objects rather than mutating, so it can be used
 * inside a store update.
 */
export function allocateForService(
  pools: ResourcePool[], intentId: string, serviceId: string, endpointCount: number, seq: number,
): { pools: ResourcePool[]; held: HeldResource[] } {
  const next = pools.map((p) => ({ ...p, entries: p.entries.map((e) => ({ ...e })) }))
  const held: HeldResource[] = []

  demandFor(intentId, endpointCount, seq).forEach((kind) => {
    const pool = next.find((p) => p.kind === kind && p.entries.some((e) => e.state === 'Free'))
    if (!pool) return                          // pool exhausted — nothing to hand out
    const entry = pool.entries.find((e) => e.state === 'Free')!
    entry.state = 'Allocated'
    entry.serviceId = serviceId
    held.push({ kind, value: entry.value, pool: pool.scope, state: 'Allocated' })
  })

  return { pools: recount(next), held }
}

/**
 * Give one service's holdings back on cease. They go to quarantine rather than
 * straight to Free — reissuing a route target a peer still advertises would
 * leak one customer's routes into another's VRF.
 */
export function releaseForService(pools: ResourcePool[], serviceId: string): ResourcePool[] {
  const next = pools.map((p) => ({
    ...p,
    entries: p.entries.map((e) => (e.serviceId === serviceId && e.state === 'Allocated'
      ? {
        ...e,
        state: 'Quarantined' as const,
        releasedAt: new Date().toISOString(),
        quarantineUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      }
      : e)),
  }))
  return recount(next)
}

/** Headline counters are always recomputed from the entries, never tracked. */
function recount(pools: ResourcePool[]): ResourcePool[] {
  pools.forEach((p) => {
    p.allocated = p.entries.filter((e) => e.state === 'Allocated').length
    p.quarantined = p.entries.filter((e) => e.state === 'Quarantined').length
    p.reserved = p.entries.filter((e) => e.state === 'Reserved').length
  })
  return pools
}

/* ---------- reports ---------- */

export const REPORTS: ReportDef[] = [
  {
    id: 'RPT-001', name: 'Ghost service register',
    question: 'Which services are billed but have no configuration on any endpoint?',
    cadence: 'Weekly · Mon 06:00', audience: 'Finance + NOC lead · restricted · 14 d expiry',
    state: 'Current', lastRunAt: '2026-08-31T06:00:00Z', snapshot: 'SNAP-2026-0831-06',
    headline: '46 services', deltaLabel: '+7 this week', deltaTone: 'bad',
    history: [
      { at: '2026-08-31', snapshot: 'SNAP-2026-0831-06', headline: '46 services', value: 46, delta: 7 },
      { at: '2026-08-24', snapshot: 'SNAP-2026-0824-06', headline: '39 services', value: 39, delta: 5 },
      { at: '2026-08-17', snapshot: 'SNAP-2026-0817-06', headline: '34 services', value: 34, delta: 4 },
      { at: '2026-08-10', snapshot: 'SNAP-2026-0810-06', headline: '30 services', value: 30, delta: 0 },
    ],
  },
  {
    id: 'RPT-002', name: 'Never-proven services',
    question: 'Which live services have no end-to-end evidence, ever?',
    cadence: 'Weekly · Mon 06:00', audience: 'NOC',
    state: 'Current', lastRunAt: '2026-08-31T06:00:00Z', snapshot: 'SNAP-2026-0831-06',
    headline: '316 services', deltaLabel: '−22 this week', deltaTone: 'good',
    history: [
      { at: '2026-08-31', snapshot: 'SNAP-2026-0831-06', headline: '316', value: 316, delta: -22 },
      { at: '2026-08-24', snapshot: 'SNAP-2026-0824-06', headline: '338', value: 338, delta: -14 },
      { at: '2026-08-17', snapshot: 'SNAP-2026-0817-06', headline: '352', value: 352, delta: -9 },
      { at: '2026-08-10', snapshot: 'SNAP-2026-0810-06', headline: '361', value: 361, delta: 0 },
    ],
  },
  {
    id: 'RPT-003', name: 'Drift ageing',
    question: 'How long has each open drift been open, and who owns it?',
    cadence: 'Daily · 07:00', audience: 'NOC',
    state: 'Stale', lastRunAt: '2026-09-02T07:00:00Z', snapshot: 'SNAP-2026-0902-07',
    headline: '214 open · 31 over 30 days', deltaLabel: '+9 since yesterday', deltaTone: 'bad',
    history: [
      { at: '2026-09-02', snapshot: 'SNAP-2026-0902-07', headline: '214', value: 214, delta: 9 },
      { at: '2026-09-01', snapshot: 'SNAP-2026-0901-07', headline: '205', value: 205, delta: -3 },
      { at: '2026-08-31', snapshot: 'SNAP-2026-0831-07', headline: '208', value: 208, delta: 6 },
      { at: '2026-08-30', snapshot: 'SNAP-2026-0830-07', headline: '202', value: 202, delta: 0 },
    ],
  },
  {
    id: 'RPT-004', name: 'First-attempt success',
    question: 'Which workflows fail on the first run, and at which task?',
    cadence: 'Weekly · Mon 06:00', audience: 'Engineering',
    state: 'Current', lastRunAt: '2026-08-31T06:00:00Z', snapshot: 'SNAP-2026-0831-06',
    headline: '68% · worst renderer 67%', deltaLabel: '+4 pts this month', deltaTone: 'good',
    history: [
      { at: '2026-08-31', snapshot: 'SNAP-2026-0831-06', headline: '68%', value: 68, delta: 4 },
      { at: '2026-08-24', snapshot: 'SNAP-2026-0824-06', headline: '64%', value: 64, delta: 2 },
      { at: '2026-08-17', snapshot: 'SNAP-2026-0817-06', headline: '62%', value: 62, delta: 1 },
      { at: '2026-08-10', snapshot: 'SNAP-2026-0810-06', headline: '61%', value: 61, delta: 0 },
    ],
  },
  {
    id: 'RPT-005', name: 'Rollback residue',
    question: 'Which rollbacks ran but left something behind?',
    cadence: 'Daily · 07:00', audience: 'NOC + Engineering',
    state: 'Current', lastRunAt: '2026-09-02T07:00:00Z', snapshot: 'SNAP-2026-0902-07',
    headline: '4 of 11 this month', deltaLabel: 'no change', deltaTone: 'flat',
    history: [
      { at: '2026-09-02', snapshot: 'SNAP-2026-0902-07', headline: '4', value: 4, delta: 0 },
      { at: '2026-09-01', snapshot: 'SNAP-2026-0901-07', headline: '4', value: 4, delta: 1 },
      { at: '2026-08-31', snapshot: 'SNAP-2026-0831-07', headline: '3', value: 3, delta: 0 },
      { at: '2026-08-30', snapshot: 'SNAP-2026-0830-07', headline: '3', value: 3, delta: 0 },
    ],
  },
  {
    id: 'RPT-006', name: 'Resource pool utilisation',
    question: 'Which pools will run out, and when?',
    cadence: 'Daily · 07:00', audience: 'Planning',
    state: 'Running', lastRunAt: '2026-09-02T07:00:00Z', snapshot: 'SNAP-2026-0902-07',
    headline: '2 pools under 10% free', deltaLabel: '+1 this week', deltaTone: 'bad',
    history: [
      { at: '2026-09-02', snapshot: 'SNAP-2026-0902-07', headline: '2', value: 2, delta: 1 },
      { at: '2026-09-01', snapshot: 'SNAP-2026-0901-07', headline: '1', value: 1, delta: 0 },
      { at: '2026-08-31', snapshot: 'SNAP-2026-0831-07', headline: '1', value: 1, delta: 0 },
      { at: '2026-08-30', snapshot: 'SNAP-2026-0830-07', headline: '1', value: 1, delta: 0 },
    ],
  },
  {
    id: 'RPT-007', name: 'Unclaimed network configuration',
    question: 'What customer configuration exists that no service record owns?',
    cadence: 'Weekly · Mon 06:00', audience: 'NOC + Finance',
    state: 'Stale', lastRunAt: '2026-08-31T06:00:00Z', snapshot: 'SNAP-2026-0831-06',
    headline: '88 constructs', deltaLabel: '−4 this week', deltaTone: 'good',
    history: [
      { at: '2026-08-31', snapshot: 'SNAP-2026-0831-06', headline: '88', value: 88, delta: -4 },
      { at: '2026-08-24', snapshot: 'SNAP-2026-0824-06', headline: '92', value: 92, delta: -3 },
      { at: '2026-08-17', snapshot: 'SNAP-2026-0817-06', headline: '95', value: 95, delta: 2 },
      { at: '2026-08-10', snapshot: 'SNAP-2026-0810-06', headline: '93', value: 93, delta: 0 },
    ],
  },
  {
    id: 'RPT-008', name: 'Assertion audit',
    question: 'Which validation rules cannot evaluate false?',
    cadence: 'On demand', audience: 'Engineering · internal only',
    state: 'Failed', lastRunAt: '2026-09-01T15:42:00Z', snapshot: 'SNAP-2026-0901-15',
    headline: '187 tautological · 431 unasserted', deltaLabel: 'first run', deltaTone: 'flat',
    failureReason: 'Parse timeout while reading 63 draft workflows. Retry queued.',
    history: [{ at: '2026-09-01', snapshot: 'SNAP-2026-0901-15', headline: '187 / 431', value: 187, delta: 0 }],
  },
  {
    id: 'RPT-009', name: 'Acceptance certificate',
    question: 'What evidence proves this service was delivered as ordered?',
    cadence: 'On demand · per service', audience: 'Customer-facing · watermarked · 30 d expiry',
    state: 'Current', lastRunAt: '2026-09-02T01:07:00Z', snapshot: 'ORD-2026-004417 run 3',
    headline: '5 of 5 criteria', deltaLabel: '—', deltaTone: 'flat',
    history: [{ at: '2026-09-02', snapshot: 'ORD-2026-004417 run 3', headline: '5 of 5', value: 5, delta: 0 }],
  },
]

/* ---------- notifications ---------- */

export function buildNotifications(): Notification[] {
  const now = Date.now()
  const raw: Array<[Notification['tone'], string, string, string | undefined]> = [
    ['crit', 'Ghost services up 7 this week', '46 services are billed with no configuration on the device. Combined value ₹58.2 L per year.', '/reports'],
    ['warn', '4 reservations expire today', 'Orders in Awaiting approval will lose their held VLAN and pseudowire IDs at 18:00 IST.', '/requests'],
    ['crit', 'ORD-2026-004389 failed at task 7', 'BGP session never reached Established. Rollback completed with residue.', '/execution'],
    ['info', 'Change window opens at 01:00 IST', '12 approved orders are scheduled for tonight.', '/change'],
    ['good', 'SVC-L2-018842 accepted', 'All 5 acceptance criteria passed. Certificate generated.', '/inventory'],
    ['warn', 'IP block pool under 10% free', 'WAN transit 10.244.0.0/16 has 40 of 900 blocks free.', '/pools'],
  ]
  return raw.map(([tone, title, body, link], i) => ({
    id: `NTF-${pad(i + 1, 3)}`,
    at: new Date(now - (i + 1) * between(20, 200) * 60000).toISOString(),
    tone, title, body, read: i > 2, link,
  }))
}

export const randomLabel = () => pick(['Priya S.', 'Ravi K.', 'Anil M.'], rnd)
