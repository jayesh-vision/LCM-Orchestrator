import type { Vendor, Workflow, WorkflowState } from '@/types'
import { DEVICE_MODELS, PROFILE_TYPES, between, modelsForCategory, pad, rnd } from './catalog'
import { templateFor } from './templates'

/* Vendor as it appears in a workflow name on the platform. */
export const VENDOR_LABEL: Record<Vendor, string> = {
  CISCO: 'Cisco', JUNIPER: 'Juniper', NOKIA: 'Nokia', ADVA: 'Adva', TEJAS: 'Tejas',
  TECHROUTE: 'TechRoute', EDGECORE: 'EdgeCore', DLINK: 'D-Link',
  HUAWEI: 'Huawei', ZTE: 'ZTE', ADTRAN: 'Adtran',
  CERAGON: 'Ceragon', AVIAT: 'Aviat', NEC: 'NEC',
  CIENA: 'Ciena', INFINERA: 'Infinera', ECI: 'ECI',
}

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
  /* Doubled from the platform's original 2-vendor counts (74/26/38) now that
     eight vendors — six Router, two Switch — share the same coverage grid;
     otherwise each vendor's slice would read as near-empty. Broadband,
     Microwave and DWDM are the newer, narrower domains — each a handful of
     intents on a 3-vendor estate, deliberately smaller than Transport's. */
  const TARGET: Record<string, number> = { L2VPN: 148, L3VPN: 52, IBW: 76, Broadband: 24, Microwave: 18, DWDM: 15 }
  const activeCount: Record<string, number> = { L2VPN: 0, L3VPN: 0, IBW: 0, Broadband: 0, Microwave: 0, DWDM: 0 }

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
        : pt.category === 'Broadband' ? (pt.type === 'Business Gateway' ? 'INT-ACCESS-BUSINESS' : 'INT-ACCESS-RESIDENTIAL')
          : pt.category === 'Microwave' ? 'INT-RADIO-PTP'
            : pt.category === 'DWDM' ? 'INT-FIBER-WAVELENGTH'
              : pt.category === 'L2VPN' ? (pt.type === 'Railwire' ? 'INT-L2-RAILWIRE' : 'INT-L2-P2P')
                : (pt.type.startsWith('Hub') ? 'INT-L3-HUBSPOKE' : 'INT-L3-MESH')
    const version = state === 'Active' ? between(1, 5) : 1
    n += 1
    const { stages, tasks } = templateFor(pt.category, dm.vendor, pt.type, role, pt.subtype)
    /* Most templates cover one model; every fourth covers every model of its vendor. */
    const siblings = DEVICE_MODELS.filter((m) => m.vendor === dm.vendor).map((m) => m.model)
    const models = n % 4 === 0 ? siblings : [dm.model]
    out.push({
      id: `CF-${pad(400 - n, 6)}`,
      name, displayName: name,
      category: pt.category, type: pt.type, subtype: pt.subtype,
      vendor: dm.vendor, kind: dm.kind, model: dm.model, models, osRange: dm.osRange,
      intentId, endpointRole: role, state, version,
      modifiedOn: new Date(2025, 11 - (n % 12), 1 + (n % 27)).toISOString(),
      createdBy: n % 4 === 0 ? 'Priya S.' : n % 3 === 0 ? 'Ravi K.' : 'Jayesh',
      stages, tasks,
      runs30d: state === 'Active' ? between(4, 420) : 0,
      firstPassRate: state === 'Active' ? Math.round((0.62 + rnd() * 0.34) * 100) : 0,
    })
    if (state === 'Active') activeCount[pt.category] += 1
  }
  let n = 0

  /* The workflows Jayesh's lifecycle screenshots show, seeded first so the
     prototype's requests bind to the very templates the platform runs. */
  const find = (cat: string, type: string, subtype: string) => PROFILE_TYPES.find((p) => p.category === cat && p.type === type && p.subtype === subtype)!
  const model = (m: string) => DEVICE_MODELS.find((d) => d.model === m)!
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
     category hits its platform count. Router vendors cover every Transport
     category; Switch vendors (EdgeCore, D-Link) only ever carry L2VPN — a
     switch has no BGP/VRF to run an L3VPN or IBW intent with. Broadband is
     single-ended, same as IBW — a CPE has no far end to configure. */
  for (const cat of ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM'] as const) {
    const pts = PROFILE_TYPES.filter((p) => p.category === cat)
    const models = modelsForCategory(cat)
    const singleEnded = cat === 'IBW' || cat === 'Broadband'
    let i = 0
    while (activeCount[cat] < TARGET[cat]) {
      const pt = pts[i % pts.length]
      /* Vendor/model rotates with every profile type, so every eligible
         vendor is covered for every category from the first generation on. */
      const pass = Math.floor(i / pts.length)
      const dm = models[(i + pass) % models.length]
      const gen = Math.floor(pass / models.length) + 1
      if (singleEnded) {
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
    const models = modelsForCategory(pt.category)
    const dm = models[k % models.length]
    const role = (pt.category === 'IBW' || pt.category === 'Broadband') ? undefined : (k % 2 ? 'Destination' : 'Source')
    push(pt, dm, role, state, String(2 + (k % 3)))
  })

  /* Back-fill the profile-type usage counter. */
  PROFILE_TYPES.forEach((pt) => {
    pt.usedByWorkflows = out.filter((w) => w.category === pt.category && w.type === pt.type && w.subtype === pt.subtype).length
  })
  return out
}
