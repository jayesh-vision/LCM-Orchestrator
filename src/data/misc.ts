import type {
  HeldResource, Notification, Order, PoolEntry, PoolKind, ReportDef, ReportRun, ResourcePool, Run, Service, Vendor,
} from '@/types'
import { SITES, between, pad, pick, rnd } from './catalog'
import { WAITING } from './orders'
import { VENDOR_LABEL } from './workflows'
import { EXEC_FAIL, RISK_FAIL, failureReasonFor, worstBy } from '@/lib/orderFailure'

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

/* ---------- reports ----------

   Every report answers one plain-language question about provisioning
   itself — requests raised, first-time-right rate, why failures happen,
   what's stuck, retries, SLA, pool headroom, vendor reliability, proof of
   delivery — using the exact vocabulary (EXEC_FAIL/RISK_FAIL, the failure-
   reason buckets, slaBreached, WAITING) the rest of the platform already
   uses for the same ideas, so a number here can never disagree with the same
   number on Provisioning Insights or the requests queue.

   The headline and current-period figure are always read straight off the
   live orders/runs/pools — never typed in. Where the platform genuinely has
   no history to replay (queue depth, pool headroom are a snapshot of *now*,
   not a log), the trend line is a seeded, deterministic walk that ends on
   that real figure, in the same spirit as the rest of this seeded dataset. */

const DAY = 86400000

function pad2(n: number): string { return String(n).padStart(2, '0') }

function snapshotId(at: Date, hh: string): string {
  return `SNAP-${at.getFullYear()}-${pad2(at.getMonth() + 1)}${pad2(at.getDate())}-${hh}`
}

function isoDate(at: Date): string { return at.toISOString().slice(0, 10) }

/** [start, end) bounds of the period that is `n` spans of `spanDays` back from now. */
function windowBack(now: number, n: number, spanDays: number) {
  const end = now - n * spanDays * DAY
  return { start: end - spanDays * DAY, end }
}

/** A deterministic walk trailing back from a real current value, for the
 * handful of metrics that read off current state rather than a log. */
function seededTrail(current: number, periods: number, driftFrac: number): number[] {
  const vals = [Math.max(0, Math.round(current))]
  for (let i = 1; i < periods; i += 1) {
    const prev = vals[i - 1]
    const span = Math.max(1, Math.round(prev * driftFrac))
    vals.push(Math.max(0, prev - between(-span, span)))
  }
  return vals
}

/** Turn a newest-first value series into the report's run-history rows. */
function trend(now: number, cadenceDays: number, hh: string, values: number[], headlineAt: (v: number) => string): ReportRun[] {
  return values.map((v, i) => {
    const at = new Date(now - i * cadenceDays * DAY)
    const older = values[i + 1]
    return { at: isoDate(at), snapshot: snapshotId(at, hh), headline: headlineAt(v), value: v, delta: older === undefined ? 0 : v - older }
  })
}

function trendDelta(v0: number, v1: number, opts: { unit?: string; suffix: string; higherIsBad?: boolean }): { label: string; tone: 'good' | 'bad' | 'flat' } {
  const d = v0 - v1
  if (d === 0) return { label: 'no change', tone: 'flat' }
  const higherIsBad = opts.higherIsBad ?? true
  return { label: `${d > 0 ? '+' : ''}${d}${opts.unit ?? ''} ${opts.suffix}`, tone: (d > 0) === higherIsBad ? 'bad' : 'good' }
}

/**
 * The platform's report catalog — every definition is derived here from the
 * live orders/runs/pools/services, the same way `buildPools` derives pool
 * sizing from what the estate actually consumes.
 */
export function buildReports(orders: Order[], runs: Run[], services: Service[], pools: ResourcePool[]): ReportDef[] {
  const now = Date.now()
  const lastWeeklyRun = (hh: string) => {
    const d = new Date(now)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    d.setHours(Number(hh), 0, 0, 0)
    if (d.getTime() > now) d.setDate(d.getDate() - 7)
    return d.toISOString()
  }
  const lastDailyRun = (hh: string) => {
    const d = new Date(now)
    d.setHours(Number(hh), 0, 0, 0)
    if (d.getTime() > now) d.setDate(d.getDate() - 1)
    return d.toISOString()
  }

  /* ---- requests raised vs. completed ---- */
  const rc = Array.from({ length: 4 }, (_, i) => {
    const { start, end } = windowBack(now, i, 7)
    const raised = orders.filter((o) => { const t = Date.parse(o.createdAt); return t > start && t <= end }).length
    const completed = orders.filter((o) => { if (o.state !== 'Ready') return false; const t = Date.parse(o.updatedAt); return t > start && t <= end }).length
    return { raised, completed, gap: raised - completed }
  })
  const rcHistory = rc.map((p, i) => {
    const at = new Date(now - i * 7 * DAY)
    const older = rc[i + 1]
    return {
      at: isoDate(at), snapshot: snapshotId(at, '06'), headline: `${p.raised} raised · ${p.completed} completed`,
      value: p.gap, delta: older === undefined ? 0 : p.gap - older.gap,
    }
  })
  const rcDelta = trendDelta(rc[0].gap, rc[1].gap, { suffix: 'this week' })

  /* ---- first-time-right rate ---- */
  const attempt1 = runs.filter((r) => r.attempt === 1)
  const ftr = Array.from({ length: 4 }, (_, i) => {
    const { start, end } = windowBack(now, i, 7)
    const inWindow = attempt1.filter((r) => { const t = Date.parse(r.startedAt); return t > start && t <= end })
    return inWindow.length ? Math.round((inWindow.filter((r) => r.outcome === 'Accepted').length / inWindow.length) * 100) : 0
  })
  const ftrHistory = trend(now, 7, '06', ftr, (v) => `${v}%`)
  const ftrDelta = trendDelta(ftr[0], ftr[1], { unit: ' pts', suffix: 'this week', higherIsBad: false })

  /* ---- why provisioning fails ---- */
  const failedOrderIds = new Set(orders.filter((o) => EXEC_FAIL.includes(o.state)).map((o) => o.id))
  const latestAttempt = new Map<string, number>()
  runs.forEach((r) => { if (failedOrderIds.has(r.orderId)) latestAttempt.set(r.orderId, Math.max(latestAttempt.get(r.orderId) ?? 0, r.attempt)) })
  const reasonCounts = new Map<string, number>()
  let totalFailedTasks = 0
  runs.forEach((r) => {
    if (!failedOrderIds.has(r.orderId) || r.attempt !== latestAttempt.get(r.orderId)) return
    r.tasks.forEach((t) => {
      if (t.state !== 'Failed') return
      totalFailedTasks += 1
      const reason = failureReasonFor(r.id, t.taskDefId, t.stageKind)
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
    })
  })
  let topReason = ''; let topCount = 0
  reasonCounts.forEach((c, reason) => { if (c > topCount) { topCount = c; topReason = reason } })
  const topPct = totalFailedTasks ? Math.round((topCount / totalFailedTasks) * 100) : 0
  const whyTrail = Array.from({ length: 4 }, (_, i) => {
    const { start, end } = windowBack(now, i, 7)
    let c = 0
    runs.forEach((r) => {
      const t = Date.parse(r.startedAt)
      if (t <= start || t > end) return
      r.tasks.forEach((tk) => { if (tk.state === 'Failed' && failureReasonFor(r.id, tk.taskDefId, tk.stageKind) === topReason) c += 1 })
    })
    return c
  })
  const whyHistory = trend(now, 7, '06', whyTrail, (v) => `${v} failures`)
  const whyDelta = trendDelta(whyTrail[0], whyTrail[1], { suffix: 'this week' })

  /* ---- requests stuck in the queue ---- */
  const waitingStates = Object.keys(WAITING)
  const stuckThreshold = 5
  const stuck = orders.filter((o) => !o.archived && waitingStates.includes(o.state) && o.ageDays > stuckThreshold)
    .sort((a, b) => b.ageDays - a.ageDays)
  const oldestStuck = stuck[0]
  const stuckTrail = seededTrail(stuck.length, 4, 0.22)
  const stuckHistory = trend(now, 1, '07', stuckTrail, (v) => `${v} waiting`)
  const stuckDelta = trendDelta(stuckTrail[0], stuckTrail[1], { suffix: 'since yesterday' })

  /* ---- retry outcomes ---- */
  const maxAttemptByOrder = new Map<string, number>()
  runs.forEach((r) => maxAttemptByOrder.set(r.orderId, Math.max(maxAttemptByOrder.get(r.orderId) ?? 0, r.attempt)))
  const retriedIds = [...maxAttemptByOrder.entries()].filter(([, m]) => m >= 2).map(([id]) => id)
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const retriedSucceeded = retriedIds.filter((id) => orderById.get(id)?.state === 'Ready').length
  const secondAttemptStart = new Map<string, string>()
  runs.forEach((r) => { if (r.attempt === 2) secondAttemptStart.set(r.orderId, r.startedAt) })
  /* Cumulative — how many retries had started by each cutoff — rather than a
     per-day count, which would mostly read zero against this sample size. */
  const retryTrail = Array.from({ length: 4 }, (_, i) => {
    const cutoff = now - i * DAY
    return retriedIds.filter((id) => { const s = secondAttemptStart.get(id); return s && Date.parse(s) <= cutoff }).length
  })
  const retryHistory = trend(now, 1, '07', retryTrail, (v) => `${v} retried`)
  const retryDelta = trendDelta(retryTrail[0], retryTrail[1], { suffix: 'since yesterday' })

  /* ---- SLA breaches ---- */
  const slaTrail = Array.from({ length: 4 }, (_, i) => {
    const { start, end } = windowBack(now, i, 7)
    return orders.filter((o) => { if (!o.slaBreached) return false; const t = Date.parse(o.createdAt); return t > start && t <= end }).length
  })
  const slaCount = orders.filter((o) => !o.archived && o.slaBreached).length
  const slaHistory = trend(now, 7, '06', slaTrail, (v) => `${v} breaches`)
  const slaDelta = trendDelta(slaTrail[0], slaTrail[1], { suffix: 'this week' })

  /* ---- resource pool utilisation ---- */
  const poolFree = pools.map((p) => ({ p, free: p.total > 0 ? (p.total - p.allocated - p.quarantined) / p.total : 1 }))
  const lowPools = poolFree.filter((x) => x.free < 0.1)
  const tightestPool = [...poolFree].sort((a, b) => a.free - b.free)[0]
  const poolTrail = seededTrail(lowPools.length, 4, 0.4)
  const poolHistory = trend(now, 1, '07', poolTrail, (v) => `${v} pools`)
  const poolDelta = trendDelta(poolTrail[0], poolTrail[1], { suffix: 'since yesterday' })

  /* ---- vendor reliability ---- */
  const worstVendor = worstBy(orders, (o) => o.endpoints[0]?.vendor, RISK_FAIL, 3)
  const vendorTrail = worstVendor
    ? Array.from({ length: 4 }, (_, i) => {
      const { start, end } = windowBack(now, i, 7)
      const inWindow = orders.filter((o) => o.endpoints[0]?.vendor === worstVendor.key && (() => { const t = Date.parse(o.createdAt); return t > start && t <= end })())
      return inWindow.length ? Math.round((inWindow.filter((o) => RISK_FAIL.includes(o.state)).length / inWindow.length) * 100) : 0
    })
    : [0, 0, 0, 0]
  const vendorHistory = trend(now, 7, '06', vendorTrail, (v) => `${v}%`)
  const vendorDelta = trendDelta(vendorTrail[0], vendorTrail[1], { unit: ' pts', suffix: 'this week' })
  const vendorLabel = worstVendor ? (VENDOR_LABEL[worstVendor.key as Vendor] ?? worstVendor.key) : undefined

  /* ---- acceptance certificate — most recently proven service on record ---- */
  const withEvidence = services.filter((s) => (s.acceptanceEvidence?.length ?? 0) > 0)
  const provenService = [...withEvidence].sort((a, b) => Date.parse(b.liveSince ?? '1970-01-01') - Date.parse(a.liveSince ?? '1970-01-01'))[0]
  const provenOrder = provenService
    ? orders.find((o) => o.serviceId === provenService.id && o.intent === 'Create') ?? orders.find((o) => o.serviceId === provenService.id)
    : undefined
  const provenAttempt = provenOrder ? Math.max(1, ...runs.filter((r) => r.orderId === provenOrder.id).map((r) => r.attempt)) : 1
  const evidence = provenService?.acceptanceEvidence ?? []
  const evidencePassed = evidence.filter((e) => e.passed).length
  const provenSnapshot = provenOrder ? `${provenOrder.id} run ${provenAttempt}` : 'No order on record'

  return [
    {
      id: 'RPT-001', name: 'Requests raised vs. completed',
      question: 'How many provisioning requests came in this week, and how many went live?',
      cadence: 'Weekly · Mon 06:00', audience: 'Planning + Leadership',
      state: 'Current', lastRunAt: lastWeeklyRun('06'), snapshot: rcHistory[0].snapshot,
      headline: `${rc[0].raised} raised · ${rc[0].completed} completed`,
      deltaLabel: rcDelta.label, deltaTone: rcDelta.tone, history: rcHistory,
    },
    {
      id: 'RPT-002', name: 'First-time-right rate',
      question: 'What share of provisioning requests succeed on the very first attempt, with no retry needed?',
      cadence: 'Weekly · Mon 06:00', audience: 'Engineering + NOC',
      state: 'Current', lastRunAt: lastWeeklyRun('06'), snapshot: ftrHistory[0].snapshot,
      headline: `${ftr[0]}% succeed on the first try, no retry needed`,
      deltaLabel: ftrDelta.label, deltaTone: ftrDelta.tone, history: ftrHistory,
    },
    {
      id: 'RPT-003', name: 'Why provisioning fails',
      question: 'Which single reason costs the most failed provisioning attempts, and how often?',
      cadence: 'Weekly · Mon 06:00', audience: 'NOC + Engineering',
      state: 'Current', lastRunAt: lastWeeklyRun('06'), snapshot: whyHistory[0].snapshot,
      headline: totalFailedTasks ? `${topReason} · ${topCount} of ${totalFailedTasks} failed tasks (${topPct}%)` : 'No failed tasks in the current estate',
      deltaLabel: whyDelta.label, deltaTone: whyDelta.tone, history: whyHistory,
    },
    {
      id: 'RPT-004', name: 'Requests stuck in the queue',
      question: 'Which in-flight requests have been waiting longest, and on whom?',
      cadence: 'Daily · 07:00', audience: 'NOC',
      state: 'Stale', lastRunAt: lastDailyRun('07'), snapshot: stuckHistory[0].snapshot,
      headline: oldestStuck
        ? `${stuck.length} waiting over ${stuckThreshold} days · oldest ${oldestStuck.ageDays} days, waiting on ${oldestStuck.waitingOn ?? oldestStuck.state}`
        : `Nothing has waited over ${stuckThreshold} days`,
      deltaLabel: stuckDelta.label, deltaTone: stuckDelta.tone, history: stuckHistory,
    },
    {
      id: 'RPT-005', name: 'Retry outcomes',
      question: 'When a failed request is retried, does the retry actually succeed?',
      cadence: 'Daily · 07:00', audience: 'Engineering',
      state: 'Failed', lastRunAt: lastDailyRun('07'), snapshot: retryHistory[0].snapshot,
      headline: `${retriedIds.length} requests retried · ${retriedSucceeded} now Ready`,
      deltaLabel: retryDelta.label, deltaTone: retryDelta.tone,
      failureReason: 'Timed out correlating attempt-2+ runs against archived orders outside the retained-log window. Retry queued.',
      history: retryHistory,
    },
    {
      id: 'RPT-006', name: 'SLA breaches',
      question: 'Which requests have missed their promised turnaround time?',
      cadence: 'Weekly · Mon 06:00', audience: 'Planning + Finance',
      state: 'Current', lastRunAt: lastWeeklyRun('06'), snapshot: slaHistory[0].snapshot,
      headline: `${slaCount} request${slaCount === 1 ? '' : 's'} past commitment`,
      deltaLabel: slaDelta.label, deltaTone: slaDelta.tone, history: slaHistory,
    },
    {
      id: 'RPT-007', name: 'Resource pool utilisation',
      question: 'Which resource pools are closest to running out, and by how much?',
      cadence: 'Daily · 07:00', audience: 'Planning',
      state: 'Running', lastRunAt: lastDailyRun('07'), snapshot: poolHistory[0].snapshot,
      headline: tightestPool
        ? `${lowPools.length} pool${lowPools.length === 1 ? '' : 's'} under 10% free · tightest is ${tightestPool.p.scope} at ${Math.round(tightestPool.free * 100)}%`
        : 'No pool is under 10% free',
      deltaLabel: poolDelta.label, deltaTone: poolDelta.tone, history: poolHistory,
    },
    {
      id: 'RPT-008', name: 'Vendor reliability',
      question: "Which vendor's equipment fails configuration most often?",
      cadence: 'Weekly · Mon 06:00', audience: 'Engineering + Vendor management',
      state: 'Stale', lastRunAt: lastWeeklyRun('06'), snapshot: vendorHistory[0].snapshot,
      headline: worstVendor
        ? `${vendorLabel} fails ${Math.round(worstVendor.rate * 100)}% of its ${worstVendor.total} requests, worst in the estate`
        : 'No vendor has enough volume yet to compare',
      deltaLabel: vendorDelta.label, deltaTone: vendorDelta.tone, history: vendorHistory,
    },
    {
      id: 'RPT-009', name: 'Acceptance certificate',
      question: 'What evidence proves this service was delivered as ordered, and did it all pass?',
      cadence: 'On demand · per service', audience: 'Customer-facing · watermarked · 30 d expiry',
      state: 'Current', lastRunAt: provenOrder?.updatedAt ?? new Date(now).toISOString(), snapshot: provenSnapshot,
      headline: evidence.length ? `${evidencePassed} of ${evidence.length} criteria passed` : 'No acceptance evidence on record',
      deltaLabel: '—', deltaTone: 'flat',
      history: [{ at: isoDate(new Date(now)), snapshot: provenSnapshot, headline: evidence.length ? `${evidencePassed} of ${evidence.length}` : '0 of 0', value: evidencePassed, delta: 0 }],
    },
  ]
}

/* ---------- notifications ---------- */

export function buildNotifications(): Notification[] {
  const now = Date.now()
  const raw: Array<[Notification['tone'], string, string, string | undefined]> = [
    ['crit', 'SLA breaches climbing', 'More requests missed their promised turnaround time this week. See the SLA breaches report for the full list.', '/reports'],
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
