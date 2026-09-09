import type { Notification, PoolEntry, ReportDef, ResourcePool, Service } from '@/types'
import { SITES, between, pad, pick, rnd } from './catalog'

/* ---------- resource pools ---------- */

function entries(total: number, allocated: number, quarantined: number, label: (n: number) => string, services: Service[]): PoolEntry[] {
  const out: PoolEntry[] = []
  for (let i = 0; i < total; i += 1) {
    const state: PoolEntry['state'] = i < allocated ? 'Allocated'
      : i < allocated + quarantined ? 'Quarantined' : 'Free'
    out.push({
      value: label(i),
      state,
      serviceId: state === 'Allocated' ? services[(i * 7) % services.length]?.id : undefined,
      quarantineUntil: state === 'Quarantined'
        ? new Date(Date.now() + between(1, 30) * 86400000).toISOString() : undefined,
    })
  }
  return out
}

export function buildPools(services: Service[]): ResourcePool[] {
  const pools: ResourcePool[] = []
  // VLAN pools, one per edge port on a few key devices.
  SITES.slice(0, 6).forEach((s, i) => {
    const total = 400
    const allocated = between(120, 380)
    const quarantined = between(0, 20)
    pools.push({
      id: `POOL-VLAN-${pad(i + 1, 3)}`,
      kind: 'VLAN',
      scope: `${s.code} · xe-0/0/${i}`,
      total, allocated, quarantined, reserved: between(0, 12),
      entries: entries(total, allocated, quarantined, (n) => String(100 + n), services),
    })
  })
  pools.push({
    id: 'POOL-PWID-001', kind: 'Pseudowire ID', scope: 'global L2VPN',
    total: 1000, allocated: 612, quarantined: 18, reserved: 9,
    entries: entries(1000, 612, 18, (n) => String(4000 + n), services),
  })
  pools.push({
    id: 'POOL-RDRT-001', kind: 'RD/RT', scope: 'global route target · 65001:x',
    total: 500, allocated: 148, quarantined: 31, reserved: 4,
    entries: entries(500, 148, 31, (n) => `65001:${1000 + n}`, services),
  })
  pools.push({
    id: 'POOL-IP-001', kind: 'IP block', scope: 'WAN transit 10.244.0.0/16 · /30',
    total: 900, allocated: 838, quarantined: 22, reserved: 6,
    entries: entries(900, 838, 22, (n) => `10.244.${Math.floor(n / 64)}.${(n % 64) * 4}/30`, services),
  })
  pools.push({
    id: 'POOL-ASN-001', kind: 'ASN slot', scope: 'private ASN 64512–65534',
    total: 1023, allocated: 471, quarantined: 8, reserved: 2,
    entries: entries(1023, 471, 8, (n) => String(64512 + n), services),
  })
  // Access domain — pre-provisioned CPE stock, bound to a serial on activation.
  pools.push({
    id: 'POOL-CPESN-001', kind: 'CPE Serial', scope: 'pre-provisioned stock · Huawei/ZTE/Adtran',
    total: 400, allocated: 260, quarantined: 14, reserved: 6,
    entries: entries(400, 260, 14, (n) => `SN-${100000 + n}`, services),
  })
  // Radio domain — licensed microwave frequency channels.
  pools.push({
    id: 'POOL-FREQ-001', kind: 'Frequency Channel', scope: 'licensed bands · L6/U6/L7/L8/E-band',
    total: 200, allocated: 122, quarantined: 4, reserved: 3,
    entries: entries(200, 122, 4, (n) => `FC-${1000 + n}`, services),
  })
  // Fiber domain — ITU-T 100GHz DWDM wavelength grid.
  pools.push({
    id: 'POOL-WL-001', kind: 'Wavelength', scope: 'ITU-T 100GHz grid · C-band 1529–1569nm',
    total: 96, allocated: 84, quarantined: 3, reserved: 2,
    entries: entries(96, 84, 3, (n) => `${1529 + Math.floor(n / 2)}.${(n % 2) * 50 + 12}nm`, services),
  })
  // Radio domain, RAN VNF category — 3GPP physical cell identity plan, per DU.
  pools.push({
    id: 'POOL-PCI-001', kind: 'PCI', scope: '3GPP TS 38.211 · mod-3 / mod-30 collision-free plan',
    total: 504, allocated: 68, quarantined: 5, reserved: 3,
    entries: entries(504, 68, 5, (n) => String(n), services),
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
