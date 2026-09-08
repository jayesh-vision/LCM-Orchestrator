import type { Vendor, Workflow, WorkflowState } from '@/types'
import { DEVICE_MODELS, PROFILE_TYPES, between, pad, rnd } from './catalog'
import { templateFor } from './templates'

/* Vendor as it appears in a workflow name on the platform. */
const VENDOR_LABEL: Record<Vendor, string> = { CISCO: 'Cisco', JUNIPER: 'Juniper', NOKIA: 'Nokia', SAMSUNG: 'Samsung' }

/**
 * Workflow templates, named the way the platform names them:
 *   Category | Type | Subtype | Vendor [| NCS] [| Source n | Destination n]
 * One template per profile type × vendor × end of the service. Two-ended
 * services (L2VPN, L3VPN) carry a Source and a Destination template because
 * the two devices get different configuration; single-ended IBW carries one.
 * Active counts match the platform: L2VPN 74 · L3VPN 26 · IBW 38.
 */
export function buildWorkflows(): Workflow[] {
  const out: Workflow[] = []
  const TARGET: Record<string, number> = { L2VPN: 74, L3VPN: 26, IBW: 38 }
  const activeCount: Record<string, number> = { L2VPN: 0, L3VPN: 0, IBW: 0 }
  const VENDOR_MODELS = DEVICE_MODELS.filter((d) => d.vendor === 'CISCO' || d.vendor === 'JUNIPER')
  let n = 0

  const push = (pt: typeof PROFILE_TYPES[number], dm: typeof DEVICE_MODELS[number], role: 'Source' | 'Destination' | undefined, state: WorkflowState, suffix: string) => {
    const isNcs = dm.model.startsWith('NCS')
    const base = [pt.category, pt.type, pt.subtype, VENDOR_LABEL[dm.vendor]]
    if (isNcs) base.push('NCS')
    /* Two-ended: "… | Source n"; single-ended (IBW): "… | Juniper n", as the platform writes it.
       Names are unique on the platform, so bump the trailing number until this one is. */
    const compose = (k: string) => (role ? [...base, `${role} ${k}`].join(' | ') : [...base.slice(0, -1), `${base[base.length - 1]}${k ? ' ' + k : ''}`].join(' | '))
    let name = compose(suffix)
    let bump = 2
    while (out.some((w) => w.name === name)) { name = compose(String(bump)); bump += 1 }
    const intentId =
      pt.category === 'IBW' ? 'INT-IBW-ACCESS'
        : pt.category === 'L2VPN' ? (pt.type === 'Railwire' ? 'INT-L2-RAILWIRE' : 'INT-L2-P2P')
          : (pt.type.startsWith('Hub') ? 'INT-L3-HUBSPOKE' : 'INT-L3-MESH')
    const version = state === 'Active' ? between(1, 5) : 1
    n += 1
    const { stages, tasks } = templateFor(pt.category, dm.vendor, pt.type, role, pt.subtype)
    /* Most templates cover one model; every fourth covers both models of its vendor. */
    const siblings = VENDOR_MODELS.filter((m) => m.vendor === dm.vendor).map((m) => m.model)
    const models = n % 4 === 0 ? siblings : [dm.model]
    out.push({
      id: `CF-${pad(400 - n, 6)}`,
      name, displayName: name,
      category: pt.category, type: pt.type, subtype: pt.subtype,
      vendor: dm.vendor, model: dm.model, models, osRange: dm.osRange,
      intentId, endpointRole: role, state, version,
      modifiedOn: new Date(2025, 11 - (n % 12), 1 + (n % 27)).toISOString(),
      createdBy: n % 4 === 0 ? 'Priya S.' : n % 3 === 0 ? 'Ravi K.' : 'Jayesh',
      stages, tasks,
      runs30d: state === 'Active' ? between(4, 420) : 0,
      firstPassRate: state === 'Active' ? Math.round((0.62 + rnd() * 0.34) * 100) : 0,
    })
    if (state === 'Active') activeCount[pt.category] += 1
  }

  /* The workflows Jayesh's lifecycle screenshots show, seeded first so the
     prototype's requests bind to the very templates the platform runs. */
  const find = (cat: string, type: string, subtype: string) => PROFILE_TYPES.find((p) => p.category === cat && p.type === type && p.subtype === subtype)!
  const model = (m: string) => VENDOR_MODELS.find((d) => d.model === m)!
  const PLATFORM: Array<[string, string, string, string, boolean]> = [
    ['L2VPN', 'Transparent', 'Untagged', 'NCS-540', true],
    ['L2VPN', 'Transparent', 'Tagged', 'MX204', true],
    ['L3VPN', 'Fully-Mesh VRF', 'VRF', 'MX204', true],
    ['L3VPN', 'Hub & Spoke VRF', 'VRF', 'MX204', true],
    ['IBW', 'BGP', 'Other', 'MX204', false],
    ['IBW', 'Static', 'Other', 'ACX2200', false],
  ]
  PLATFORM.forEach(([cat, type, subtype, m, twoEnded]) => {
    const pt = find(cat, type, subtype); const dm = model(m)
    if (twoEnded) { push(pt, dm, 'Source', 'Active', '1'); push(pt, dm, 'Destination', 'Active', '1') }
    else push(pt, dm, undefined, 'Active', '1')
  })

  /* Active templates: cycle profile types × vendor models × ends until each
     category hits its platform count. */
  for (const cat of ['L2VPN', 'L3VPN', 'IBW'] as const) {
    const pts = PROFILE_TYPES.filter((p) => p.category === cat)
    let i = 0
    while (activeCount[cat] < TARGET[cat]) {
      const pt = pts[i % pts.length]
      /* Vendor/model rotates with every profile type, so both vendors are covered
         for every category from the first generation on. */
      const pass = Math.floor(i / pts.length)
      const dm = VENDOR_MODELS[(i + pass) % VENDOR_MODELS.length]
      const gen = Math.floor(pass / VENDOR_MODELS.length) + 1
      if (cat === 'IBW') {
        push(pt, dm, undefined, 'Active', gen > 1 ? String(gen) : '')
      } else {
        push(pt, dm, 'Source', 'Active', String(gen))
        if (activeCount[cat] < TARGET[cat]) push(pt, dm, 'Destination', 'Active', String(gen))
      }
      i += 1
    }
  }

  /* The non-active tail: drafts, awaiting approval, assigned, retired, rejected. */
  const TAIL: WorkflowState[] = [
    ...Array(24).fill('Draft'), ...Array(9).fill('Awaiting approval'),
    ...Array(6).fill('Assigned'), ...Array(5).fill('Retired'), ...Array(2).fill('Rejected'),
  ]
  TAIL.forEach((state, k) => {
    const pt = PROFILE_TYPES[(k * 5) % PROFILE_TYPES.length]
    const dm = VENDOR_MODELS[k % VENDOR_MODELS.length]
    const role = pt.category === 'IBW' ? undefined : (k % 2 ? 'Destination' : 'Source')
    push(pt, dm, role, state, String(2 + (k % 3)))
  })

  /* Back-fill the profile-type usage counter. */
  PROFILE_TYPES.forEach((pt) => {
    pt.usedByWorkflows = out.filter((w) => w.category === pt.category && w.type === pt.type && w.subtype === pt.subtype).length
  })
  return out
}
