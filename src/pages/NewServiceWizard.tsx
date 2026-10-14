import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleOff, Lock, PauseCircle, Pencil, PlayCircle, Plus, RotateCcw, Save, Search,
  ShieldCheck, Trash2, Unlock, Workflow as WorkflowIcon,
} from 'lucide-react'
import { useStore, type WizardDraft } from '@/store/useStore'
import { ACCOUNTS, DEVICE_MODELS, SITES, modelsForCategory } from '@/data/catalog'
import { bindEndpoints } from '@/data/orders'
import { workflowParams } from '@/data/templates'
import { VENDOR_LABEL } from '@/data/workflows'
import type { Category, Domain, EndpointRole, OrderIntent, OrderParamValue, Vendor } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, Field, InfoTip, Mono, Note, PageHead,
  Select, Stepper, TextInput,
} from '@/components/ui'
import { CATEGORY_TONE, CONFORMANCE_TONE, inr, relTime, SERVICE_TONE, shortDate } from '@/lib/format'

const STEPS_CREATE = [
  'Domain & profile type', 'Source, destination & workflow', 'Parameters & values', 'Preview & validate', 'Planned',
]

const STEPS_DAY2 = [
  'Select service', 'Workflow & parameters', 'Planned',
]

interface EndpointDraft {
  role: 'A' | 'Z' | 'hub' | 'spoke'
  vendor?: Vendor | ''
  model?: string
  siteCode: string
  port: string
}

const roleOfIdx = (i: number): EndpointRole => (i === 0 ? 'Source' : 'Destination')
const mgmtIpFor = (i: number) => `172.31.33.${20 + i * 80}`

const PARAM_ORIGIN: Record<string, { badge: string; hint: string; locked?: boolean }> = {
  pool: { badge: 'from pool', hint: 'Pre-filled with the next free value — change it if this device needs a different one.' },
  derived: { badge: 'derived', hint: 'Comes from the site and port chosen for this endpoint in Step 2.', locked: true },
  template: { badge: 'default', hint: 'Template default — change it for this endpoint only.' },
  user: { badge: '', hint: 'Rendered into this endpoint\'s commands only.' },
}


const DOMAIN_SUBTYPES: Record<Domain, string[]> = {
  Transport: ['Tagged', 'Untagged', 'BGP', 'Static', 'OSPF', 'VRF', 'Other'],
  Access: ['FTTH', 'DSL', 'Other'],
  Radio: ['All-IP', 'Hybrid', 'E-band'],
  Fiber: ['Residential', 'Business'],
}
const DWDM_SUBTYPES = ['Unprotected', 'Protected']
const DOMAIN_PORT_LABEL: Record<Domain, string> = {
  Transport: 'Router port', Access: 'CPE port', Radio: 'Radio port', Fiber: 'ONT port',
}
function subtypeOptions(domain: Domain, category: Category, type: string): string[] {
  if (category === 'RAN VNF') return type === 'DU' ? ['Indoor', 'Outdoor'] : ['Standalone', 'Non-Standalone']
  if (category === 'DWDM') return DWDM_SUBTYPES
  return DOMAIN_SUBTYPES[domain]
}
function portLabelFor(domain: Domain, category: Category): string {
  if (category === 'DWDM') return 'Optical port'
  return DOMAIN_PORT_LABEL[domain]
}

function reindex<T>(map: Record<number, T>, removed: number): Record<number, T> {
  const out: Record<number, T> = {}
  Object.entries(map).forEach(([k, v]) => {
    const i = Number(k)
    if (i === removed) return
    out[i > removed ? i - 1 : i] = v
  })
  return out
}

const INTENT_CONFIG: {
  id: OrderIntent
  label: string
  desc: string
  icon: typeof Plus
  tone: 'brand' | 'info' | 'warn' | 'good' | 'crit'
}[] = [
  { id: 'Create', label: 'Create new service', desc: 'Provision new network service across topology endpoints', icon: Plus, tone: 'brand' },
  { id: 'Modify', label: 'Modify service', desc: 'Change bandwidth or parameters on an existing service', icon: Pencil, tone: 'info' },
  { id: 'Suspend', label: 'Suspend service', desc: 'Administratively pause traffic on an active service', icon: PauseCircle, tone: 'warn' },
  { id: 'Resume', label: 'Resume service', desc: 'Restore traffic flow on a previously suspended service', icon: PlayCircle, tone: 'good' },
  { id: 'Cease', label: 'Cease service', desc: 'Decommission service and quarantine allocated resources', icon: CircleOff, tone: 'crit' },
  { id: 'Re-prove', label: 'Re-prove service', desc: 'Run end-to-end telemetry probe & audit conformance', icon: ShieldCheck, tone: 'info' },
]

const DAY2_PRESETS: Record<OrderIntent, string[]> = {
  Create: [],
  Modify: [
    'Customer requested bandwidth upgrade for traffic expansion',
    'Service policy and QoS adjustment',
    'Contract renewal bandwidth adjustment',
    'Temporary event capacity surge',
  ],
  Suspend: [
    'Scheduled customer maintenance window',
    'Commercial suspension (billing arrears)',
    'Security investigation / DDoS mitigation',
    'Emergency network re-grooming',
  ],
  Resume: [
    'Maintenance window concluded — restore traffic',
    'Account cleared and in good standing',
    'Security audit resolved',
    'Administrative un-hold',
  ],
  Cease: [
    'Customer contract expired — churn',
    'Service migration to next-gen optical ring',
    'Customer premises closed',
    'Decommissioning legacy circuit',
  ],
  'Re-prove': [
    'Scheduled periodic conformance audit',
    'Post-maintenance path verification',
    'Resolving detected configuration drift',
    'Customer SLA verification request',
  ],
}

const REPROVE_SCOPES = [
  'Full end-to-end conformance (L1-L3 telemetry + intent audit)',
  'Synthetic SLA latency & packet loss probe only',
  'Running configuration drift verification only',
]

const TEXTAREA_CLS = 'w-full px-3 py-2.5 border border-line rounded-md text-[13px] outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 resize-y bg-white'

const ELIGIBLE_STATES_BY_INTENT: Partial<Record<OrderIntent, string[]>> = {
  Modify: ['Live'],
  Suspend: ['Live'],
  Resume: ['Suspended'],
  Cease: ['Live', 'Suspended', 'Degraded'],
  'Re-prove': ['Live', 'Degraded'],
}

export default function NewServiceWizard() {
  const nav = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const intents = useStore((s) => s.intents)
  const workflows = useStore((s) => s.workflows)
  const pools = useStore((s) => s.pools)
  const services = useStore((s) => s.services)
  const createOrder = useStore((s) => s.createOrder)
  const raiseChange = useStore((s) => s.raiseChange)

  const rawIntentParam = searchParams.get('intent') as OrderIntent | null
  const initialIntent: OrderIntent = rawIntentParam && ['Create', 'Modify', 'Suspend', 'Resume', 'Cease', 'Re-prove'].includes(rawIntentParam)
    ? rawIntentParam
    : 'Create'
  const initialServiceId = searchParams.get('serviceId') || ''

  const [requestIntent, setRequestIntent] = useState<OrderIntent>(initialIntent)
  const [selectedServiceId, setSelectedServiceId] = useState<string>(initialServiceId)
  // Lock other intents to prevent accidental clicks
  const [isIntentLocked, setIsIntentLocked] = useState<boolean>(true)

  // Step state for Create
  const [step, setStep] = useState(0)
  const [domain, setDomain] = useState<Domain>('Transport')
  const [category, setCategory] = useState<Category>('L2VPN')
  const [intentId, setIntentId] = useState('INT-L2-P2P')
  const [subtype, setSubtype] = useState('Tagged')
  const [accountId, setAccountId] = useState(ACCOUNTS[0].id)
  const [name, setName] = useState('')
  const [eps, setEps] = useState<EndpointDraft[]>([
    { role: 'A', vendor: '', model: '', siteCode: '', port: '' },
    { role: 'Z', vendor: '', model: '', siteCode: '', port: '' },
  ])
  const [wfByEp, setWfByEp] = useState<Record<number, string>>({})
  const [valsByEp, setValsByEp] = useState<Record<number, Record<string, string>>>({})
  const [svc, setSvc] = useState<Record<string, string>>({})
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [shut2, setShut2] = useState<Record<number, boolean>>({})
  const [shut3, setShut3] = useState<Record<number, boolean>>({})
  const [shutSvc, setShutSvc] = useState(false)
  const toggle = (set: typeof setShut2, i: number) => set((p) => ({ ...p, [i]: !p[i] }))

  // Day-2 search & selection state
  const [svcSearch, setSvcSearch] = useState('')
  const [svcDomain, setSvcDomain] = useState<Domain | 'All'>('All')
  const [svcCategory, setSvcCategory] = useState<Category | 'All'>('All')
  const [svcState, setSvcState] = useState<string>('All')

  // Day-2 workflow & parameter state
  const [day2WorkflowId, setDay2WorkflowId] = useState<string>('')
  const [day2Reason, setDay2Reason] = useState('')
  const [day2PresetReason, setDay2PresetReason] = useState('')
  const [ceaseConfirmed, setCeaseConfirmed] = useState(false)
  const [reproveScope, setReproveScope] = useState(REPROVE_SCOPES[0])

  // Parameter modification state: which params are enabled for change & their new values
  const [enabledParams, setEnabledParams] = useState<Record<string, boolean>>({})
  const [paramValues, setParamValues] = useState<Record<string, string>>({})

  const selectedService = useMemo(() => services.find((s) => s.id === selectedServiceId) ?? null, [services, selectedServiceId])

  const endpointVendorsLabel = useMemo(() => {
    if (!selectedService) return ''
    return [...new Set(selectedService.endpoints.map((e) => e.vendor).filter(Boolean))].join(', ')
  }, [selectedService])

  // Filter workflows matching the selected service strictly for the current Day-2 operation
  const serviceWorkflows = useMemo(() => {
    if (!selectedService) return []
    const epVendors = new Set(selectedService.endpoints.map((e) => e.vendor).filter(Boolean))

    // Strict operation match: Modify workflows for Modify, Suspend for Suspend, etc.
    const list = workflows.filter((w) => {
      if (w.state !== 'Active') return false
      const wfOp = w.operation ?? 'Create'
      if (wfOp !== requestIntent) return false
      if (w.category !== selectedService.category) return false
      // Only include workflows matching the target device vendor of the service endpoints
      if (epVendors.size > 0 && !epVendors.has(w.vendor)) return false
      return true
    })

    return list.sort((a, b) => b.firstPassRate - a.firstPassRate)
  }, [workflows, selectedService, requestIntent])

  // Active selected Day-2 workflow strictly matching current operation
  const selectedDay2Workflow = useMemo(() => {
    const wf = workflows.find((w) => w.id === day2WorkflowId)
    if (!wf) return null
    if ((wf.operation ?? 'Create') !== requestIntent) return null
    return wf
  }, [workflows, day2WorkflowId, requestIntent])

  // Extract parameters demanded strictly by the selected workflow
  const serviceParamsList = useMemo(() => {
    if (!selectedService) return []

    // When an operational workflow is selected, ask ONLY the parameters that this workflow requires
    if (selectedDay2Workflow) {
      const needed = workflowParams(selectedDay2Workflow.tasks)
      const neededSet = new Set(needed.length > 0 ? needed : ['Bandwidth'])

      const list: {
        name: string
        current: string
        source: string
        isBandwidth?: boolean
        modifiable: boolean
        defaultValue: string
        hint?: string
      }[] = []

      neededSet.forEach((name) => {
        if (name === 'Bandwidth') {
          list.push({
            name: 'Bandwidth',
            current: `${selectedService.bandwidthMbps} Mbps`,
            source: 'Catalog Intent',
            isBandwidth: true,
            modifiable: true,
            defaultValue: String(selectedService.bandwidthMbps),
            hint: 'Committed Information Rate (CIR)',
          })
        } else if (name === 'Burst size') {
          const existing = selectedService.attributes.find((a) => a.name === 'Burst size')?.intent
          list.push({
            name: 'Burst size',
            current: existing || '625 KB',
            source: 'QoS Profile',
            modifiable: true,
            defaultValue: existing || '625 KB',
            hint: 'Committed Burst Size (CBS / MBS)',
          })
        } else if (name === 'Policer action') {
          const existing = selectedService.attributes.find((a) => a.name === 'Policer action')?.intent
          list.push({
            name: 'Policer action',
            current: existing || 'loss-priority high',
            source: 'SLA Policy',
            modifiable: true,
            defaultValue: existing || 'loss-priority high',
            hint: 'Action applied when exceeding rate limit',
          })
        } else if (name === 'Interface') {
          const port = selectedService.endpoints[0]?.port || 'xe-0/0/3'
          list.push({
            name: 'Interface',
            current: port,
            source: `${selectedService.endpoints[0]?.deviceName || 'Device'} Port`,
            modifiable: false,
            defaultValue: port,
            hint: 'Device port bound to topology (fixed)',
          })
        } else if (name === 'Neighbor IP') {
          const nIp = selectedService.endpoints[1]?.mgmtIp || selectedService.endpoints[0]?.mgmtIp || '172.31.24.12'
          list.push({
            name: 'Neighbor IP',
            current: nIp,
            source: 'Topology Peer',
            modifiable: false,
            defaultValue: nIp,
            hint: 'Neighbor BGP / PE peer address (fixed)',
          })
        } else if (name === 'category') {
          list.push({
            name: 'category',
            current: selectedService.category,
            source: 'Service Category',
            modifiable: false,
            defaultValue: selectedService.category,
            hint: 'Service category (fixed)',
          })
        } else if (name === 'Vlan-ID') {
          const existing = selectedService.attributes.find((a) => a.name === 'Vlan-ID')?.intent
          list.push({
            name: 'Vlan-ID',
            current: existing || '104',
            source: 'Service VLAN',
            modifiable: true,
            defaultValue: existing || '104',
          })
        } else if (name === 'Description') {
          list.push({
            name: 'Description',
            current: selectedService.name,
            source: 'Service Description',
            modifiable: true,
            defaultValue: selectedService.name,
          })
        } else {
          const attr = selectedService.attributes.find((a) => a.name === name)
          list.push({
            name,
            current: attr?.intent || '—',
            source: attr?.source || 'Device Config',
            modifiable: true,
            defaultValue: attr?.intent || '',
          })
        }
      })
      // Sort modifiable parameters first with Bandwidth at top, followed by fixed parameters
      return list.sort((a, b) => {
        if (a.modifiable !== b.modifiable) return a.modifiable ? -1 : 1
        if (a.isBandwidth) return -1
        if (b.isBandwidth) return 1
        return a.name.localeCompare(b.name)
      })
    }

    return []
  }, [selectedService, selectedDay2Workflow])

  // Initialize form state when selected service, workflow, or intent changes
  useEffect(() => {
    if (selectedService) {
      // Auto-preselect best workflow template matching the exact current operation and endpoint vendor
      if (serviceWorkflows.length > 0) {
        const currentValid = serviceWorkflows.some((w) => w.id === day2WorkflowId)
        if (!currentValid) {
          const best = serviceWorkflows[0]
          setDay2WorkflowId(best?.id || '')
        }
      } else {
        setDay2WorkflowId('')
      }

      setDay2Reason('')
      setDay2PresetReason(DAY2_PRESETS[requestIntent][0] ?? '')
      setCeaseConfirmed(false)
    }
  }, [selectedService, requestIntent, serviceWorkflows, day2WorkflowId])

  // Initialize parameter values dynamically based on what the workflow demands
  useEffect(() => {
    if (selectedService && serviceParamsList.length > 0) {
      setParamValues((prev) => {
        const next = { ...prev }
        serviceParamsList.forEach((p) => {
          if (next[p.name] === undefined) {
            next[p.name] = p.defaultValue
          }
        })
        return next
      })
      setEnabledParams((prev) => {
        const next = { ...prev }
        serviceParamsList.forEach((p) => {
          if (next[p.name] === undefined) {
            next[p.name] = p.modifiable && p.isBandwidth ? (requestIntent === 'Modify') : false
          }
        })
        return next
      })
    }
  }, [selectedService, serviceParamsList, requestIntent])

  // Eligible states for the active Day-2 operational intent
  const eligibleStates = ELIGIBLE_STATES_BY_INTENT[requestIntent]

  // Filter services for Day-2 selection
  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      // Operation eligibility: Modify only shows Live services, Resume only shows Suspended, etc.
      if (eligibleStates && !eligibleStates.includes(s.state)) return false

      if (svcDomain !== 'All' && domainOf(s.category) !== svcDomain) return false
      if (svcCategory !== 'All' && s.category !== svcCategory) return false
      if (svcState !== 'All' && s.state !== svcState) return false
      if (svcSearch) {
        const q = svcSearch.toLowerCase().trim()
        const match = s.id.toLowerCase().includes(q)
          || s.name.toLowerCase().includes(q)
          || s.accountName.toLowerCase().includes(q)
          || s.category.toLowerCase().includes(q)
          || s.endpoints.some((e) => e.siteCode.toLowerCase().includes(q) || e.deviceName.toLowerCase().includes(q))
        if (!match) return false
      }
      return true
    })
  }, [services, eligibleStates, svcDomain, svcCategory, svcState, svcSearch])

  // Deselect service if current intent does not permit its state
  useEffect(() => {
    if (selectedService && eligibleStates && !eligibleStates.includes(selectedService.state)) {
      setSelectedServiceId('')
    }
  }, [selectedService, eligibleStates])

  // Switch request intent
  const handleSelectIntent = (next: OrderIntent) => {
    setRequestIntent(next)
    setDay2WorkflowId('')
    setSvcState('All')
    setSearchParams({ intent: next, ...(selectedServiceId ? { serviceId: selectedServiceId } : {}) }, { replace: true })
    if (next === 'Create') {
      setStep(0)
    } else {
      setDay2PresetReason(DAY2_PRESETS[next][0] ?? '')
    }
    setCreatedId(null)
    setIsIntentLocked(true) // Lock intent to prevent accidental clicks
  }

  // Handle Day-2 service selection
  const handlePickService = (sId: string) => {
    setSelectedServiceId(sId)
    setSearchParams({ intent: requestIntent, serviceId: sId }, { replace: true })
  }

  const handleClearSelectedService = () => {
    setSelectedServiceId('')
    setDay2WorkflowId('')
    setSearchParams({ intent: requestIntent }, { replace: true })
  }

  // Toggle modification of a parameter
  const handleToggleParam = (name: string) => {
    setEnabledParams((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  const handleParamValueChange = (name: string, value: string) => {
    setParamValues((prev) => ({ ...prev, [name]: value }))
    setEnabledParams((prev) => ({ ...prev, [name]: true }))
  }

  // ---- Create wizard memoized logic ----
  const intent = intents.find((i) => i.id === intentId)!
  const catIntents = intents.filter((i) => i.category === category)
  const portsPool = useMemo(() => modelsForCategory(category), [category])
  const domainCats = CATEGORIES_BY_DOMAIN[domain]
  const setDomainCascade = (d: Domain) => {
    setDomain(d)
    const c = CATEGORIES_BY_DOMAIN[d][0]
    setCategory(c)
    const first = intents.find((i) => i.category === c)!
    setIntentId(first.id)
    setSubtype(subtypeOptions(d, c, first.type)[0])
  }

  const single = intent.topology === 'Single-ended'
  const star = intent.topology === 'Star'
  const activeEps = single ? eps.slice(0, 1) : eps
  const endpointCount = activeEps.length

  const labelOfIdx = (i: number) => {
    if (single) return 'Access device'
    if (star) return i === 0 ? 'Hub' : `Spoke ${i}`
    if (i === 0) return 'Source (A-end)'
    return endpointCount > 2 ? `Destination ${i}` : 'Destination (Z-end)'
  }
  const vendorOfIdx = (i: number): Vendor | undefined => {
    const ep = activeEps[i]
    if (ep?.vendor) return ep.vendor as Vendor
    return DEVICE_MODELS.find((d) => d.ports.includes(ep?.port ?? ''))?.vendor
  }
  const candidatesForIdx = (i: number) => {
    const role = roleOfIdx(i)
    const v = vendorOfIdx(i)
    if (!v) return []
    return workflows.filter((w) => (w.operation ?? 'Create') === 'Create' && w.intentId === intentId && w.state === 'Active'
      && (w.endpointRole === role || !w.endpointRole) && w.vendor === v)
  }

  const portSig = activeEps.map((e) => `${e.vendor}@${e.model}@${e.port}`).join('|')
  const epSig = activeEps.map((e) => `${e.siteCode}@${e.model}@${e.port}`).join('|')
  useEffect(() => {
    setWfByEp((prev) => {
      const next: Record<number, string> = {}
      activeEps.forEach((_, i) => {
        const cands = candidatesForIdx(i)
        const kept = prev[i] && cands.some((c) => c.id === prev[i]) ? prev[i] : undefined
        const best = [...cands].sort((a, b) => b.firstPassRate - a.firstPassRate)[0]
        const chosen = kept ?? best?.id
        if (chosen) next[i] = chosen
      })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId, portSig, endpointCount])

  const endpointWorkflowParamNames = useMemo(() => {
    const set = new Set<string>()
    // Include parameters from any workflow assigned to an endpoint or candidate for this intent/category
    activeEps.forEach((_, i) => {
      const wf = workflows.find((w) => w.id === wfByEp[i])
      if (wf) {
        workflowParams(wf.tasks).forEach((name) => set.add(name.toLowerCase()))
      }
    })
    workflows
      .filter((w) => w.intentId === intentId || w.category === category)
      .forEach((w) => {
        workflowParams(w.tasks).forEach((name) => set.add(name.toLowerCase()))
      })
    // Also include parameters backfilled from legacy workflow commands (which are strictly endpoint CLI parameters)
    intent.params.forEach((p) => {
      if (p.constraint?.includes('Backfilled from legacy workflow commands')) {
        set.add(p.name.toLowerCase())
      }
    })
    // Also include standard endpoint-derived fields so they never duplicate in Circuit-wide
    const standardEndpointFields = [
      'interface', 'neighbor ip', 'description', 'interface ip', 'vrf', 'peer as',
      'vlan-id', 'vlan', 'customer prefix', 'customer_prefix', 'rd', 'rt', 'rt_import', 'rt_export',
      'vc id', 'vc_id', 'xconnect group', 'bandwidth', 'cpe serial', 'cpe_serial', 'ssid', 'wifi password',
      'wan vlan', 'wan_vlan', 'frequency channel', 'frequency_channel', 'frequency band', 'frequency_band',
      'channel bandwidth', 'channel_bandwidth_mhz', 'modulation', 'tx power', 'tx_power_dbm', 'capacity',
      'capacity_mbps', 'capacity_gbps', 'wavelength channel', 'wavelength_channel', 'otn framing', 'otn_framing',
      'protection', 'olt id', 'olt_id', 'pon port', 'pon_port', 'ont serial', 'ont_serial',
      'bandwidth profile', 'bandwidth_profile', 'rx power', 'rx_power_dbm', 'cu f1 ip', 'cu_f1_ip',
      'pci', 'plmn', 'plmn_id', 'gnb id', 'gnb_id', 'amf ip', 'amf_ip', 'f1 ip', 'f1_ip', 'max ue capacity', 'max_ue_capacity',
    ]
    standardEndpointFields.forEach((f) => set.add(f.toLowerCase()))
    return set
  }, [activeEps, workflows, wfByEp, intentId, category, intent.params])

  const svcParams: OrderParamValue[] = useMemo(() => {
    return intent.params
      .filter((p) => !endpointWorkflowParamNames.has(p.name.toLowerCase()))
      .map((p) => {
        if (p.fromPool) {
          const pool = pools.find((x) => x.kind === p.fromPool)
          const free = pool?.entries.find((e) => e.state === 'Free')
          return { name: p.name, value: svc[p.name] ?? free?.value ?? '—', source: 'pool' as const }
        }
        if (svc[p.name] !== undefined) return { name: p.name, value: svc[p.name], source: 'user' as const }
        if (p.default !== undefined) return { name: p.name, value: String(p.default), source: 'template' as const }
        return { name: p.name, value: '', source: 'user' as const }
      })
  }, [intent, svc, pools, endpointWorkflowParamNames])

  const overArity = intent.topology === 'Two-ended' && endpointCount > 2
  const portsDistinct = new Set(activeEps.map((e) => `${e.siteCode}@${e.port}`).filter((x) => !x.endsWith('@'))).size === activeEps.length
  const endpointsOk = activeEps.every((e) => e.vendor && e.model && e.siteCode && e.port) && (single || portsDistinct)
  const workflowsOk = activeEps.every((_, i) => !!wfByEp[i])

  const boundEps = useMemo(() => {
    if (!endpointsOk) return []
    const draftEps = activeEps.map((e, i) => {
      const dm = (e.model ? DEVICE_MODELS.find((d) => d.model === e.model) : undefined)
        ?? DEVICE_MODELS.find((d) => d.ports.includes(e.port))
        ?? DEVICE_MODELS[0]
      return {
        id: `EP-W${i}`, role: e.role, siteCode: e.siteCode, deviceName: dm.model,
        vendor: (e.vendor || dm.vendor) as Vendor, mgmtIp: mgmtIpFor(i), port: e.port,
      }
    })
    const bw = Number(svcParams.find((p) => p.name === 'bandwidth_mbps')?.value ?? 100)
    return bindEndpoints(draftEps, category, intent.type, subtype, workflows, svcParams, bw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epSig, portSig, endpointCount, endpointsOk, category, intent.type, subtype, workflows, svcParams])

  const epParams = useMemo(() => activeEps.map((_, i): OrderParamValue[] => {
    const wf = workflows.find((w) => w.id === wfByEp[i])
    const bound = boundEps[i]?.params ?? []
    const byName = new Map(bound.map((p) => [p.name, p]))
    const names = wf ? workflowParams(wf.tasks) : bound.map((p) => p.name)
    return names.map((n) => {
      const base = byName.get(n)
      const typed = valsByEp[i]?.[n]
      return {
        name: n,
        value: typed ?? base?.value ?? '',
        source: base?.source ?? ('user' as const),
      }
    })
  }), [activeEps, workflows, wfByEp, boundEps, valsByEp])

  const setEpValue = (i: number, param: string, value: string) =>
    setValsByEp((prev) => ({ ...prev, [i]: { ...(prev[i] ?? {}), [param]: value } }))

  const svcOk = svcParams.every((p) => p.value !== '' && p.value !== '—')
  const epValuesOk = epParams.length > 0
    && epParams.every((list) => list.length > 0 && list.every((p) => p.value !== '' && p.value !== '—'))
  const valuesOk = svcOk && epValuesOk

  const addDestination = () => setEps((prev) => [
    ...prev,
    { role: star ? 'spoke' : 'Z', vendor: '' as any, model: '', siteCode: '', port: '' },
  ])
  const removeEndpoint = (i: number) => {
    setEps((prev) => prev.filter((_, x) => x !== i))
    setWfByEp((prev) => reindex(prev, i))
    setValsByEp((prev) => reindex(prev, i))
  }

  const problems: string[] = []
  if (!endpointsOk) {
    if (!portsDistinct && !single) {
      problems.push('Every endpoint must terminate on a distinct port.')
    } else {
      problems.push(`This intent needs ${intent.endpointArity} endpoint(s), all with vendor, device, port, and site selected.`)
    }
  }
  if (!workflowsOk) {
    const missing = activeEps.map((_, i) => i).filter((i) => !wfByEp[i]).map(labelOfIdx)
    problems.push(`No workflow template selected for ${missing.join(' and ')}.`)
  }
  if (!svcOk) problems.push('Every service setting needs a value before the request can be submitted.')
  if (!epValuesOk) problems.push('Every endpoint needs a value for each parameter its template renders.')

  const nextDisabledReason = useMemo(() => {
    if (step === 0) {
      if (!intentId) return 'Select a profile type'
      if (!accountId) return 'Select a customer'
    }
    if (step === 1) {
      const unconfigured = activeEps.some((e) => !e.vendor || !e.model || !e.port || !e.siteCode)
      if (unconfigured) return 'Complete all fields for each endpoint'
      if (!portsDistinct && !single) return 'Every endpoint must use a distinct port'
      if (!workflowsOk) return 'Select a workflow template for each endpoint'
    }
    if (step === 2 && !valuesOk) return 'Fill all required parameters'
    if (step === 3 && problems.length > 0) return problems[0]
    return null
  }, [step, intentId, accountId, activeEps, portsDistinct, single, workflowsOk, valuesOk, problems])

  const canNext = () => {
    if (step === 0) return !!intentId && !!accountId
    if (step === 1) return endpointsOk && workflowsOk
    if (step === 2) return valuesOk
    if (step === 3) return problems.length === 0
    return true
  }

  const submitCreate = () => {
    const acct = ACCOUNTS.find((a) => a.id === accountId)!
    const draft: WizardDraft = {
      category, type: intent.type, subtype,
      accountId: acct.id, accountName: acct.name,
      name: name || `${intent.name}`,
      intentId, workflowId: wfByEp[0] ?? '',
      endpoints: activeEps.map((e, i) => {
        const dm = (e.model ? DEVICE_MODELS.find((d) => d.model === e.model) : undefined)
          ?? DEVICE_MODELS.find((d) => d.ports.includes(e.port))
          ?? DEVICE_MODELS[0]
        return {
          role: e.role, siteCode: e.siteCode, deviceName: dm.model,
          vendor: (e.vendor || dm.vendor) as Vendor,
          mgmtIp: mgmtIpFor(i), port: e.port,
          workflowId: wfByEp[i],
          params: epParams[i],
        }
      }),
      params: svcParams,
    }
    const order = createOrder(draft)
    setCreatedId(order.id)
    setStep(4)
  }

  // Calculate changed parameters for Modify
  const changedParamsSummary = useMemo(() => {
    if (!selectedService || requestIntent !== 'Modify') return []
    const changes: { name: string; current: string; requested: string; isBw?: boolean }[] = []

    serviceParamsList.forEach((p) => {
      if (p.modifiable === false) return
      if (enabledParams[p.name]) {
        if (p.isBandwidth) {
          const newBw = Number(paramValues.Bandwidth) || selectedService.bandwidthMbps
          if (newBw !== selectedService.bandwidthMbps) {
            changes.push({
              name: 'Bandwidth',
              current: `${selectedService.bandwidthMbps} Mbps`,
              requested: `${newBw} Mbps`,
              isBw: true,
            })
          }
        } else {
          const val = paramValues[p.name]?.trim()
          if (val && val !== p.current) {
            changes.push({
              name: p.name,
              current: p.current,
              requested: val,
            })
          }
        }
      }
    })
    return changes
  }, [selectedService, requestIntent, serviceParamsList, enabledParams, paramValues])

  // Day-2 submit validation & handler
  const canSubmitDay2 = useMemo(() => {
    if (!selectedService) return false
    const hasReason = !!day2Reason.trim() || !!day2PresetReason
    const hasWorkflow = !!day2WorkflowId

    if (requestIntent === 'Modify') {
      return changedParamsSummary.length > 0 && hasReason && hasWorkflow
    }
    if (requestIntent === 'Suspend') return hasReason && hasWorkflow
    if (requestIntent === 'Resume') return hasReason && hasWorkflow
    if (requestIntent === 'Cease') return ceaseConfirmed && hasReason && hasWorkflow
    if (requestIntent === 'Re-prove') return hasWorkflow
    return false
  }, [selectedService, requestIntent, changedParamsSummary, day2Reason, day2PresetReason, day2WorkflowId, ceaseConfirmed])

  const submitDay2 = () => {
    if (!selectedService) return
    let delta: { attribute: string; current: string; requested: string }[] | undefined
    let params: OrderParamValue[] | undefined
    const finalNotes = [day2PresetReason, day2Reason.trim()].filter(Boolean).join(' · ')

    if (requestIntent === 'Modify') {
      delta = changedParamsSummary.map((c) => ({
        attribute: c.name,
        current: c.current,
        requested: c.requested,
      }))
      params = [
        ...changedParamsSummary.map((c) => ({
          name: c.name,
          value: c.isBw ? String(parseInt(c.requested, 10)) : c.requested,
          source: 'user' as const,
        })),
        ...serviceParamsList
          .filter((p) => !p.modifiable)
          .map((p) => ({
            name: p.name,
            value: p.current,
            source: 'derived' as const,
          })),
      ]
    } else if (requestIntent === 'Re-prove') {
      params = [{ name: 'Audit Scope', value: reproveScope, source: 'user' as const }]
    } else {
      params = serviceParamsList.map((p) => ({
        name: p.name,
        value: p.current,
        source: 'derived' as const,
      }))
    }

    const order = raiseChange(selectedService.id, requestIntent, delta, params, finalNotes, day2WorkflowId)
    setCreatedId(order.id)
  }

  const sectionHead = (open: boolean, onToggle: () => void, left: ReactNode, right?: ReactNode) => (
    <button
      type="button" onClick={onToggle}
      className="w-full flex items-center justify-between px-3.5 py-2.5 bg-plane border-b border-line text-left hover:bg-plane/80 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">{open ? <ChevronDown size={14} className="text-ink-3 shrink-0" /> : <ChevronRight size={14} className="text-ink-3 shrink-0" />}{left}</div>
      {right}
    </button>
  )

  const workflowPicker = (i: number) => {
    const v = vendorOfIdx(i)
    const candidates = candidatesForIdx(i)
    const chosen = wfByEp[i]
    return (
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[12px] font-semibold text-ink-2">Workflow template</div>
          {v && <Badge tone="none">{VENDOR_LABEL[v] ?? v}</Badge>}
          {v && <span className="text-[11px] text-ink-3">{candidates.length} available for this vendor</span>}
        </div>
        {!v ? (
          <Note tone="info" className="!py-2.5 !px-3 text-[12px] text-ink-3">
            Select a vendor and device above to view available workflow templates.
          </Note>
        ) : candidates.length === 0 ? (
          <Note tone="crit" className="!py-2.5 !px-3 text-[12px]">
            No active workflow matches this vendor for {intent.name}.
          </Note>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 max-h-[168px] overflow-y-auto">
            {candidates.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWfByEp((p) => ({ ...p, [i]: w.id }))}
                className={`p-2.5 rounded-lg border text-left transition-colors ${
                  chosen === w.id
                    ? 'border-brand-500 bg-brand-50/40 ring-1 ring-brand-500'
                    : 'border-line hover:border-brand-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[12px] font-medium text-ink-2 truncate" title={w.name}>{w.name}</span>
                  <Badge tone="good" className="!text-[9.5px] !py-0 shrink-0">{w.firstPassRate}% FPR</Badge>
                </div>
                <div className="text-[11px] text-ink-3 truncate">{w.tasks.length} tasks · {w.version}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const endpointCard = (i: number) => {
    const ep = activeEps[i]
    const open = !shut2[i]
    const isSource = i === 0
    const categoryVendors = [...new Set(portsPool.map((m) => m.vendor))]
    const modelsForVendor = ep?.vendor ? portsPool.filter((m) => m.vendor === ep.vendor) : []
    const currentModel = modelsForVendor.find((m) => m.model === ep?.model)
    const portsForModel = currentModel ? currentModel.ports : []

    return (
      <div key={i} className="border border-line rounded-lg overflow-hidden">
        {sectionHead(open, () => toggle(setShut2, i),
          <>
            <Badge tone={isSource ? 'info' : 'none'}>{labelOfIdx(i)}</Badge>
            <span className="text-[12px] text-ink-3 truncate">
              {ep?.siteCode && ep?.port ? `${ep.siteCode} · ${ep.model ?? ''} · ${ep.port}` : 'Not configured'}
            </span>
          </>,
          !isSource && !single && (
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeEndpoint(i) }} aria-label={`Remove endpoint ${labelOfIdx(i)}`}>
              <Trash2 size={13} className="text-crit-500" />Remove
            </Button>
          ),
        )}
        {open && (
          <div className="p-4 flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vendor" required tooltip="Select the hardware or VNF vendor for this endpoint.">
                <Select
                  value={ep?.vendor ?? ''}
                  onChange={(e) => {
                    const v = e.target.value as Vendor | ''
                    setEps((prev) => prev.map((x, idx) => (idx === i ? { ...x, vendor: v, model: '', port: '' } : x)))
                    setWfByEp((prev) => {
                      const next = { ...prev }
                      delete next[i]
                      return next
                    })
                  }}
                >
                  <option value="">Select vendor</option>
                  {categoryVendors.map((v) => (
                    <option key={v} value={v}>{VENDOR_LABEL[v] ?? v}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Device" required tooltip="Select the device model from the selected vendor estate.">
                <Select
                  value={ep?.model ?? ''}
                  disabled={!ep?.vendor}
                  onChange={(e) => {
                    const m = e.target.value
                    setEps((prev) => prev.map((x, idx) => (idx === i ? { ...x, model: m, port: '' } : x)))
                  }}
                >
                  <option value="">Select device</option>
                  {modelsForVendor.map((m) => (
                    <option key={m.model} value={m.model}>{m.model} ({m.kind})</option>
                  ))}
                </Select>
              </Field>

              <Field label={portLabelFor(domain, category)} required tooltip="Select the interface or router port.">
                <Select
                  value={ep?.port ?? ''}
                  disabled={!ep?.model}
                  onChange={(e) => {
                    const p = e.target.value
                    setEps((prev) => prev.map((x, idx) => (idx === i ? { ...x, port: p } : x)))
                  }}
                >
                  <option value="">Select interface</option>
                  {portsForModel.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Site" required tooltip="Select the POP or data center site location.">
                <Select
                  value={ep?.siteCode ?? ''}
                  onChange={(e) => {
                    const sc = e.target.value
                    setEps((prev) => prev.map((x, idx) => (idx === i ? { ...x, siteCode: sc } : x)))
                  }}
                >
                  <option value="">Select site</option>
                  {SITES.map((s) => (
                    <option key={s.code} value={s.code}>{s.city} ({s.code})</option>
                  ))}
                </Select>
              </Field>
            </div>
            {workflowPicker(i)}
          </div>
        )}
      </div>
    )
  }

  const paramCard = (i: number) => {
    const wf = workflows.find((w) => w.id === wfByEp[i])
    const list = epParams[i] ?? []
    const open = !shut3[i]
    const edited = Object.keys(valsByEp[i] ?? {}).length
    return (
      <div key={i} className="border border-line rounded-lg overflow-hidden">
        {sectionHead(open, () => toggle(setShut3, i),
          <>
            <Badge tone={i === 0 ? 'info' : 'none'}>{labelOfIdx(i)}</Badge>
            <span className="text-[12px] text-ink-3 truncate" title={wf?.name}>
              {activeEps[i]?.siteCode || 'No site'} · {wf ? wf.name : 'No template selected'}
            </span>
          </>,
          <span className="text-[11px] text-ink-3 whitespace-nowrap">
            {list.length} parameter{list.length === 1 ? '' : 's'}{edited > 0 ? ` · ${edited} changed` : ''}
          </span>,
        )}
        {open && (
          <div className="p-4 grid gap-4 sm:grid-cols-2">
            {list.map((p) => {
              const origin = PARAM_ORIGIN[p.source] ?? PARAM_ORIGIN.user
              const overridden = valsByEp[i]?.[p.name] !== undefined
              const label = (
                <span className="flex items-center gap-1.5">
                  <span className="font-mono">{p.name}</span>
                  {origin.badge && (
                    <Badge tone={overridden ? 'good' : p.source === 'pool' ? 'info' : 'none'} className="!text-[9.5px] !py-0">
                      {overridden ? 'changed' : origin.badge}
                    </Badge>
                  )}
                </span>
              )
              if (origin.locked) {
                return (
                  <Field key={p.name} label={label} tooltip={origin.hint || 'Auto-derived from site and port'}>
                    <TextInput readOnly value={p.value} placeholder="Derived from site and port" className="bg-plane font-mono text-ink-3" />
                  </Field>
                )
              }
              return (
                <Field key={p.name} label={label} required tooltip={origin.hint || `Enter ${p.name}`}>
                  <TextInput
                    className="font-mono"
                    value={p.value}
                    placeholder={`Enter ${p.name}...`}
                    onChange={(e) => setEpValue(i, p.name, e.target.value)}
                  />
                </Field>
              )
            })}
            {list.length === 0 && (
              <div className="sm:col-span-2 text-[12.5px] text-ink-3">
                Pick a workflow template for this endpoint to see the parameters it renders.
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <PageHead
        title="Provisioning request"
        sub={
          requestIntent === 'Create'
            ? 'Five steps from category to a planned service. Pre-validation runs automatically once the request is created.'
            : `Select an existing service from the Service Inventory, configure workflow & parameters for ${requestIntent}.`
        }
        actions={<Button onClick={() => nav('/requests')}>Cancel</Button>}
      />

      {/* Top Request Intent selector with explicit Lock / Unlock */}
      <Card>
        <CardBody className="py-3">
          <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
            <div className="text-[12px] font-semibold text-ink-2 flex items-center gap-2">
              <span>Request type &amp; intent</span>
              {isIntentLocked && (
                <Badge tone="info" className="!text-[10px] !py-0.5 flex items-center gap-1">
                  <Lock size={11} /> Locked to {requestIntent}
                </Badge>
              )}
            </div>
            {isIntentLocked ? (
              <Button size="sm" variant="ghost" onClick={() => setIsIntentLocked(false)} className="!text-[12px] !py-1">
                <Unlock size={13} className="text-brand-600" /> Change operation type
              </Button>
            ) : (
              <span className="text-[11.5px] text-ink-3">
                Click an operation to switch. Other options will lock once selected.
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
            {INTENT_CONFIG.map((item) => {
              const active = requestIntent === item.id
              const isOtherDisabled = isIntentLocked && !active
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isOtherDisabled}
                  onClick={() => handleSelectIntent(item.id)}
                  title={isOtherDisabled ? 'Click "Change operation type" to switch options' : item.label}
                  className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                    active
                      ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-200 shadow-sm'
                      : isOtherDisabled
                        ? 'border-line/60 bg-plane/40 opacity-40 cursor-not-allowed pointer-events-none'
                        : 'border-line bg-white hover:bg-plane/70 hover:border-line-soft'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1 w-full">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className={`w-5 h-5 rounded-md grid place-items-center shrink-0 ${
                        active ? 'bg-brand-600 text-white' : 'bg-plane text-ink-2'
                      }`}>
                        <Icon size={12} />
                      </div>
                      <span className={`text-[12.5px] font-semibold truncate ${active ? 'text-brand-700' : 'text-ink-1'}`}>
                        {item.label}
                      </span>
                    </div>
                    {active && <Check size={13} className="text-brand-600 shrink-0" />}
                  </div>
                  <span className="text-[11px] text-ink-3 leading-snug line-clamp-2">
                    {item.desc}
                  </span>
                </button>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* Stepper display */}
      <Card>
        <CardBody className="pb-4">
          <Stepper
            steps={requestIntent === 'Create' ? STEPS_CREATE : STEPS_DAY2}
            current={requestIntent === 'Create' ? step : (createdId ? 2 : selectedService ? 1 : 0)}
          />
        </CardBody>
      </Card>

      {/* ========================================================================= */}
      {/* CASE 1: Day-0/1 CREATE INTENT FLOW                                        */}
      {/* ========================================================================= */}
      {requestIntent === 'Create' && (
        <div className="vw-card-section p-0 flex flex-col">
          <CardHead title={`Step ${Math.min(step + 1, 5)} · ${STEPS_CREATE[step]}`} sub={
            step === 0 ? 'Select the domain, profile type, and customer for this provisioning request.'
              : step === 1 ? 'Pick the devices this service terminates on, and the template that runs on each.'
                : step === 2 ? 'Each endpoint runs its own template, so each one gets its own parameter values.'
                  : step === 3 ? 'Everything is validated before submission.'
                    : 'The service exists and pre-validation has been triggered.'
          } />
          <CardBody>
            {/* ---- 1 domain, category & type ---- */}
            {step === 0 && (
              <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Domain" required tooltip="Select the network domain.">
                    <Select value={domain} onChange={(e) => setDomainCascade(e.target.value as Domain)}>
                      {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </Select>
                  </Field>
                  <Field label="Service category" required tooltip="Select the service category.">
                    <Select value={category} onChange={(e) => {
                      const c = e.target.value as Category
                      setCategory(c)
                      const first = intents.find((i) => i.category === c)!
                      setIntentId(first.id)
                      setSubtype(subtypeOptions(domain, c, first.type)[0])
                    }}>
                      {domainCats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </Field>
                  <Field label="Type" required tooltip="Select the profile type.">
                    <Select value={intentId} onChange={(e) => {
                      const next = e.target.value
                      setIntentId(next)
                      const nextType = intents.find((i) => i.id === next)?.type ?? intent.type
                      setSubtype(subtypeOptions(domain, category, nextType)[0])
                    }}>
                      {catIntents.map((i) => <option key={i.id} value={i.id}>{i.type} — {i.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Subtype" tooltip="Select the profile subtype.">
                    <Select value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                      {subtypeOptions(domain, category, intent.type).map((s) => <option key={s}>{s}</option>)}
                    </Select>
                  </Field>
                  <Field label="Customer" required tooltip="Select the customer account.">
                    <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      {ACCOUNTS.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.id}</option>)}
                    </Select>
                  </Field>
                  <Field label="Network service name" tooltip="Enter the network service name, or leave blank for default.">
                    <TextInput
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={100}
                      placeholder="Enter network service name"
                    />
                  </Field>
                </div>

                <div className="border border-line rounded-lg p-4 bg-plane/50 flex flex-col gap-4 h-fit">
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <div className="text-[12px] font-semibold text-ink-2">Intent specification</div>
                      <InfoTip width={280}>
                        Blueprint specifications, auto-allocated resource pools, and automated acceptance tests defined for this service intent.
                      </InfoTip>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={CATEGORY_TONE[category]}>{category}</Badge>
                      <span className="text-[13.5px] font-semibold text-ink-1">{intent.name}</span>
                    </div>
                    <div className="text-[12px] text-ink-3 mt-1.5">{intent.topology} topology · {intent.endpointArity} endpoint(s)</div>
                  </div>
                  <div className="h-px bg-line-soft" />
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <div className="text-[12px] font-semibold text-ink-2">Resource pools used</div>
                      <InfoTip width={260}>
                        Network resource pools from which identifiers (VLANs, IPs, VCs) are dynamically allocated.
                      </InfoTip>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {intent.pools.map((p) => <Badge key={p} tone="info">{p}</Badge>)}
                    </div>
                  </div>
                  <div className="h-px bg-line-soft" />
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <div className="text-[12px] font-semibold text-ink-2">Acceptance criteria · {intent.acceptance.length}</div>
                      <InfoTip width={270}>
                        Automated validation checks executed before and after provisioning across devices, network routing, and end-to-end service layers.
                      </InfoTip>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {(['device', 'network', 'service'] as const).map((layer) => {
                        const n = intent.acceptance.filter((a) => a.layer === layer).length
                        if (!n) return null
                        const layerLabel = layer === 'device' ? 'Device layer' : layer === 'network' ? 'Network layer' : 'Service layer'
                        return (
                          <div key={layer} className="flex items-center justify-between text-[12px]">
                            <span className="text-ink-2">{layerLabel}</span>
                            <span className="font-semibold tnum text-ink-1">{n}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ---- 2 source, destinations & workflow ---- */}
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-[12.5px] text-ink-2">
                    {single
                      ? 'Single-ended topology: provisions one access device.'
                      : star
                        ? 'Star topology: terminates on a central hub and spoke sites.'
                        : 'Two-ended topology: terminates on a source (A-end) and destination (Z-end).'}
                  </div>
                  {!single && (
                    <Button size="sm" onClick={addDestination} disabled={overArity}>
                      <Plus size={14} />Add destination endpoint
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  {activeEps.map((_, i) => endpointCard(i))}
                </div>
              </div>
            )}

            {/* ---- 3 parameters & values ---- */}
            {step === 2 && (
              <div className="flex flex-col gap-4">
                {svcParams.length > 0 && (
                  <div className="border border-line rounded-lg overflow-hidden">
                    {sectionHead(!shutSvc, () => setShutSvc((p) => !p),
                      <>
                        <Badge tone="info">Circuit-wide</Badge>
                        <span className="text-[12px] text-ink-3">Shared across all endpoints</span>
                      </>,
                      <span className="text-[11px] text-ink-3">{svcParams.length} parameter{svcParams.length === 1 ? '' : 's'}</span>,
                    )}
                    {!shutSvc && (
                      <div className="p-4 grid gap-4 sm:grid-cols-2">
                        {svcParams.map((p) => {
                          const origin = PARAM_ORIGIN[p.source] ?? PARAM_ORIGIN.user
                          const overridden = svc[p.name] !== undefined
                          const tooltipText = p.source === 'pool'
                            ? 'Allocated from resource pool and shared across all endpoints.'
                            : p.source === 'template'
                              ? 'Default circuit-wide parameter value.'
                              : origin.hint || `Enter ${p.name}`
                          return (
                            <Field
                              key={p.name}
                              label={
                                <span className="flex items-center gap-1.5">
                                  <span className="font-mono">{p.name}</span>
                                  {origin.badge && (
                                    <Badge tone={overridden ? 'good' : p.source === 'pool' ? 'info' : 'none'} className="!text-[9.5px] !py-0">
                                      {overridden ? 'changed' : origin.badge}
                                    </Badge>
                                  )}
                                </span>
                              }
                              required
                              tooltip={tooltipText}
                            >
                              <TextInput
                                className="font-mono"
                                value={p.value}
                                placeholder={`Enter ${p.name}...`}
                                onChange={(e) => setSvc((prev) => ({ ...prev, [p.name]: e.target.value }))}
                              />
                            </Field>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
                {activeEps.map((_, i) => paramCard(i))}
              </div>
            )}

            {/* ---- 4 preview & validate ---- */}
            {step === 3 && (
              <div className="flex flex-col gap-5">
                {/* Top Service Specification Summary Cards */}
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {/* Card 1: Service Intent & Profile */}
                  <div className="border border-line rounded-lg p-3.5 bg-plane/50 flex flex-col justify-between shadow-2xs">
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className="text-[11.5px] font-medium text-ink-3">Service intent &amp; profile</span>
                        <Badge tone={CATEGORY_TONE[category]} className="!text-[10px] !py-0.5">{category}</Badge>
                      </div>
                      <div className="font-medium text-[13.5px] text-ink-2 leading-snug">{intent.name}</div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2.5 text-[12px] text-ink-3">
                      <span className="px-1.5 py-0.5 rounded bg-white border border-line-soft font-medium text-ink-2 text-[11px]">{domain}</span>
                      <span>·</span>
                      <span className="font-medium text-ink-2">{subtype}</span>
                    </div>
                  </div>

                  {/* Card 2: Customer Account */}
                  <div className="border border-line rounded-lg p-3.5 bg-plane/50 flex flex-col justify-between shadow-2xs">
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className="text-[11.5px] font-medium text-ink-3">Customer</span>
                        <Badge tone="none" className="font-mono !text-[10px] !py-0.5">{accountId}</Badge>
                      </div>
                      <div className="font-medium text-[13.5px] text-ink-2 leading-snug">
                        {ACCOUNTS.find((a) => a.id === accountId)?.name ?? accountId}
                      </div>
                    </div>
                    <div className="text-[12px] text-ink-3 mt-2.5 truncate" title={name || intent.name}>
                      Service: <span className="font-medium text-ink-2">{name || intent.name}</span>
                    </div>
                  </div>

                  {/* Card 3: Topology & Endpoints */}
                  <div className="border border-line rounded-lg p-3.5 bg-plane/50 flex flex-col justify-between shadow-2xs">
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className="text-[11.5px] font-medium text-ink-3">Topology</span>
                        <Badge tone="info" className="!text-[10px] !py-0.5">{intent.topology}</Badge>
                      </div>
                      <div className="font-medium text-[13.5px] text-ink-2 leading-snug">
                        {activeEps.length} endpoint{activeEps.length === 1 ? '' : 's'} provisioned
                      </div>
                    </div>
                    <div className="text-[12px] text-ink-3 mt-2.5 flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-good-500" />
                      <span>{single ? 'Single device' : star ? 'Hub & spoke' : 'A-end to Z-end'}</span>
                    </div>
                  </div>
                </div>

                {/* Circuit-wide parameters preview (When present) */}
                {svcParams.length > 0 && (
                  <div className="border border-line rounded-lg overflow-hidden bg-white shadow-2xs">
                    <div className="px-4 py-2.5 bg-plane/60 border-b border-line flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge tone="info">Circuit-wide</Badge>
                        <span className="text-[12px] font-medium text-ink-2">Service-level parameters</span>
                        <span className="text-[11.5px] text-ink-3 hidden sm:inline">(shared across all endpoints)</span>
                      </div>
                      <span className="text-[11px] text-ink-3 font-medium">
                        {svcParams.length} parameter{svcParams.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="p-3.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {svcParams.map((p) => {
                        const origin = PARAM_ORIGIN[p.source] ?? PARAM_ORIGIN.user
                        const overridden = svc[p.name] !== undefined
                        return (
                          <div
                            key={p.name}
                            className="p-2.5 rounded-md border border-line-soft bg-white hover:border-line transition-colors flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-[11px] text-ink-3 font-medium truncate" title={p.name}>
                                {p.name}
                              </div>
                              <div className="font-mono text-[12.5px] font-medium text-ink-2 truncate" title={p.value}>
                                {p.value || <span className="text-crit-600 font-normal">empty</span>}
                              </div>
                            </div>
                            {origin.badge && (
                              <Badge tone={overridden ? 'good' : p.source === 'pool' ? 'info' : 'none'} className="!text-[9px] !py-0 shrink-0">
                                {overridden ? 'changed' : origin.badge}
                              </Badge>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Endpoint configurations */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[12.5px] font-medium text-ink-2">Endpoint configurations</div>
                    <span className="text-[11.5px] text-ink-3">{activeEps.length} device{activeEps.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className={`grid gap-3.5 ${activeEps.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                    {activeEps.map((e, i) => {
                      const wf = workflows.find((w) => w.id === wfByEp[i])
                      const list = epParams[i] ?? []
                      const changed = Object.keys(valsByEp[i] ?? {}).length
                      const siteObj = SITES.find((s) => s.code === e.siteCode)
                      return (
                        <div key={i} className="border border-line rounded-lg overflow-hidden bg-white shadow-2xs flex flex-col">
                          {/* Endpoint Head */}
                          <div className="px-4 py-3 bg-plane/60 border-b border-line flex flex-col gap-1.5">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-1.5">
                                <Badge tone={i === 0 ? 'info' : 'none'} className="font-medium">
                                  {labelOfIdx(i)}
                                </Badge>
                                <span className="font-mono text-[12px] font-medium text-ink-2">
                                  {e.siteCode || 'No site'}{siteObj ? ` (${siteObj.city})` : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {e.vendor && <Badge tone="none">{VENDOR_LABEL[e.vendor] ?? e.vendor}</Badge>}
                                <Badge tone="none" className="font-mono">{e.port || 'No port'}</Badge>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                              <WorkflowIcon size={12} className="text-ink-3 shrink-0" />
                              <span className="truncate" title={wf?.name}>
                                Template: <span className="font-medium text-ink-2">{wf ? wf.name : 'No workflow template selected'}</span>
                              </span>
                            </div>
                          </div>

                          {/* Endpoint Parameters Table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="border-b border-line-soft bg-plane/30 text-[11.5px] font-medium text-ink-3">
                                  <th className="text-left px-4 py-2 font-medium">Parameter</th>
                                  <th className="text-right px-4 py-2 font-medium">Configured value</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line-soft">
                                {list.map((p) => {
                                  const origin = PARAM_ORIGIN[p.source] ?? PARAM_ORIGIN.user
                                  const overridden = valsByEp[i]?.[p.name] !== undefined
                                  return (
                                    <tr key={p.name} className="hover:bg-plane/40 transition-colors">
                                      <td className="px-4 py-2 text-ink-2">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-mono text-[11.5px]">{p.name}</span>
                                          {origin.badge && (
                                            <Badge tone={overridden ? 'good' : p.source === 'pool' ? 'info' : 'none'} className="!text-[9px] !py-0">
                                              {overridden ? 'changed' : origin.badge}
                                            </Badge>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-4 py-2 text-right">
                                        {p.value ? (
                                          <span className="font-mono text-[11.5px] text-ink-2 bg-plane/60 px-1.5 py-0.5 rounded border border-line-soft">
                                            {p.value}
                                          </span>
                                        ) : (
                                          <Badge tone="crit" className="!text-[9.5px]">missing</Badge>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Endpoint Foot */}
                          <div className="mt-auto px-4 py-2 border-t border-line-soft bg-plane/30 flex items-center justify-between text-[11.5px] text-ink-3">
                            <span className="flex items-center gap-1 text-good-700 font-medium">
                              <CheckCircle2 size={13} className="text-good-600" />
                              {list.length} parameter{list.length === 1 ? '' : 's'} defined
                            </span>
                            {changed > 0 && <span>{changed} customized</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Pre-validation readiness banner */}
                {problems.length > 0 ? (
                  <div className="rounded-lg border border-crit-200 bg-crit-50 p-4 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-crit-100 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertTriangle size={16} className="text-crit-600" />
                    </div>
                    <div>
                      <div className="font-medium text-[13px] text-crit-800">
                        {problems.length} issue(s) block request submission
                      </div>
                      <ul className="list-disc pl-5 mt-1.5 text-[12px] text-crit-700 space-y-0.5">
                        {problems.map((p) => <li key={p}>{p}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-good-200 bg-good-50/70 p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-good-100 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={14} className="text-good-700" />
                        </div>
                        <span className="font-medium text-[13px] text-good-800">
                          Pre-validation ready — request can be submitted
                        </span>
                      </div>
                      <Badge tone="good">All criteria met</Badge>
                    </div>
                    <p className="text-[12px] text-ink-2 pl-8">
                      Once you click <span className="font-medium text-ink-1">Create service</span>, the request is recorded and our automated pre-validation engine immediately verifies router CLI syntax, interface headroom, and routing paths before moving to <span className="font-medium text-ink-1">Validated</span>.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ---- 5 planned ---- */}
            {step === 4 && createdId && (
              <div className="py-8 text-center max-w-[560px] mx-auto">
                <div className="w-14 h-14 rounded-full bg-good-50 border border-good-200 grid place-items-center mx-auto mb-4">
                  <CheckCircle2 size={26} className="text-good-500" />
                </div>
                <div className="text-[18px] font-semibold mb-1.5">Service created</div>
                <p className="text-[13px] text-ink-2 mb-5">
                  <Mono className="font-semibold">{createdId}</Mono> is in <b>Draft</b>, with its resources reserved.
                  Pre-validation starts automatically and moves it to <b>Validated</b> (or <b>Invalid</b>) within moments.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Button onClick={() => nav('/requests')}>Back to requests</Button>
                  <Button variant="primary" onClick={() => nav(`/requests/${createdId}?tab=lifecycle`)}>
                    <PlayCircle size={15} />Open lifecycle operations
                  </Button>
                </div>
              </div>
            )}
          </CardBody>

          {step < 4 && (
            <div
              className="sticky bottom-0 z-10 bg-white px-5 py-3.5 border-t border-line-soft flex items-center justify-between gap-3 shadow-[0_-6px_12px_-8px_rgba(15,23,42,0.12)]"
              style={{ borderRadius: '0 0 var(--radius-card) var(--radius-card)' }}
            >
              <Button disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={15} />Back</Button>
              <div className="flex items-center gap-2">
                {nextDisabledReason && (
                  <span className="text-[12px] text-ink-3 mr-1">{nextDisabledReason}</span>
                )}
                <Button onClick={() => nav('/requests')}><Save size={15} />Save as draft</Button>
                {step < 3
                  ? <Button variant="primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>Next<ArrowRight size={15} /></Button>
                  : <Button variant="primary" disabled={!canNext()} onClick={submitCreate}><CheckCircle2 size={15} />Create service</Button>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* CASE 2: Day-2 OPERATIONS FLOW (Modify, Suspend, Resume, Cease, Re-prove)   */}
      {/* ========================================================================= */}
      {requestIntent !== 'Create' && (
        <div className="flex flex-col gap-4">
          {/* Confirmed Day-2 Order View */}
          {createdId ? (
            <Card>
              <CardBody className="py-10 text-center max-w-[620px] mx-auto">
                <div className={`w-16 h-16 rounded-full ${
                  requestIntent === 'Cease'
                    ? 'bg-crit-50 border-crit-200 text-crit-500'
                    : 'bg-good-50 border-good-200 text-good-500'
                } border grid place-items-center mx-auto mb-4`}>
                  <CheckCircle2 size={30} />
                </div>
                <div className="text-[20px] font-semibold mb-2">
                  {requestIntent} request submitted
                </div>
                <p className="text-[13.5px] text-ink-2 mb-4 leading-relaxed">
                  Order <Mono className="font-semibold text-brand-700">{createdId}</Mono> has been raised against service{' '}
                  <b>{selectedService?.name}</b> (<Mono>{selectedService?.id}</Mono>).
                </p>

                {selectedDay2Workflow && (
                  <div className="mb-6 p-3 rounded-lg border border-line bg-plane/50 text-[12.5px] text-left flex items-start gap-2.5">
                    <WorkflowIcon size={16} className="text-brand-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-ink-1">
                        Bound Workflow: {selectedDay2Workflow.name} (<Mono>{selectedDay2Workflow.id}</Mono>)
                      </div>
                      <div className="text-[11.5px] text-ink-3 mt-0.5">
                        {selectedDay2Workflow.vendor} · {selectedDay2Workflow.tasks.length} tasks · {selectedDay2Workflow.firstPassRate}% FPR. Pre-validation has started.
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-center gap-3">
                  <Button onClick={() => nav('/requests')}>Back to requests</Button>
                  <Button variant="primary" onClick={() => nav(`/requests/${createdId}?tab=lifecycle`)}>
                    <PlayCircle size={15} />Open lifecycle operations
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : !selectedService ? (
            /* Sub-step A: Select Service from Service Inventory */
            <Card>
              <CardHead
                title="Select service from Service Inventory"
                sub={
                  requestIntent === 'Modify'
                    ? 'Only active Live services can be modified. Choose a live service to update bandwidth or parameters.'
                    : requestIntent === 'Resume'
                      ? 'Only Suspended services can be resumed. Choose a suspended service to restore traffic flow.'
                      : requestIntent === 'Suspend'
                        ? 'Choose an active Live service to administratively pause traffic flow.'
                        : requestIntent === 'Cease'
                          ? 'Choose an active or suspended service to decommission and quarantine allocated resources.'
                          : `Choose an active service to run end-to-end telemetry probe audit.`
                }
              />
              <CardBody className="flex flex-col gap-4">
                {/* Search & Filter Toolbar */}
                <div className="flex flex-wrap items-center gap-3 bg-plane/60 p-3 rounded-lg border border-line-soft">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                    <input
                      type="text"
                      value={svcSearch}
                      onChange={(e) => setSvcSearch(e.target.value)}
                      placeholder="Search by Service ID, name, customer, site..."
                      className="w-full pl-9 pr-3 py-1.5 border border-line rounded-md text-[13px] bg-white outline-none focus:border-brand-500"
                    />
                  </div>
                  <Select
                    value={svcDomain}
                    onChange={(e) => setSvcDomain(e.target.value as Domain | 'All')}
                    className="w-auto !py-1.5 !text-[12.5px]"
                  >
                    <option value="All">All Domains</option>
                    {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                  <Select
                    value={svcCategory}
                    onChange={(e) => setSvcCategory(e.target.value as Category | 'All')}
                    className="w-auto !py-1.5 !text-[12.5px]"
                  >
                    <option value="All">All Categories</option>
                    {(svcDomain === 'All' ? DOMAINS.flatMap((d) => CATEGORIES_BY_DOMAIN[d]) : CATEGORIES_BY_DOMAIN[svcDomain]).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                  {eligibleStates && eligibleStates.length === 1 ? (
                    <div className="px-3 py-1.5 rounded-md bg-good-50 text-good-700 text-[12px] font-medium border border-good-200/80 flex items-center gap-1.5 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-good-500" />
                      {eligibleStates[0]} services only
                    </div>
                  ) : (
                    <Select
                      value={svcState}
                      onChange={(e) => setSvcState(e.target.value)}
                      className="w-auto !py-1.5 !text-[12.5px]"
                    >
                      <option value="All">All {eligibleStates ? 'Eligible' : ''} States</option>
                      {(eligibleStates ?? ['Live', 'Suspended', 'Degraded', 'Ceased']).map((st) => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </Select>
                  )}
                </div>

                {/* Table of services */}
                <div className="border border-line rounded-lg overflow-hidden">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="bg-plane border-b border-line text-ink-2 text-[12px] font-medium">
                        <th className="px-3.5 py-2.5 text-left font-medium">Service ID</th>
                        <th className="px-3.5 py-2.5 text-left font-medium">Name &amp; Customer</th>
                        <th className="px-3.5 py-2.5 text-left font-medium">Category</th>
                        <th className="px-3.5 py-2.5 text-left font-medium">Endpoints</th>
                        <th className="px-3.5 py-2.5 text-left font-medium">Bandwidth</th>
                        <th className="px-3.5 py-2.5 text-left font-medium">State</th>
                        <th className="px-3.5 py-2.5 text-left font-medium">Conformance</th>
                        <th className="px-3.5 py-2.5 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-soft">
                      {filteredServices.slice(0, 25).map((s) => (
                        <tr
                          key={s.id}
                          className="hover:bg-plane/50 transition-colors cursor-pointer"
                          onClick={() => handlePickService(s.id)}
                        >
                          <td className="px-3.5 py-2.5 font-mono font-medium text-brand-700 whitespace-nowrap">
                            {s.id}
                          </td>
                          <td className="px-3.5 py-2.5 min-w-[200px]">
                            <div className="font-semibold text-ink-1 leading-tight">{s.name}</div>
                            <div className="text-[11.5px] text-ink-3 mt-0.5">{s.accountName}</div>
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            <Badge tone={CATEGORY_TONE[s.category]}>{s.category}</Badge>
                          </td>
                          <td className="px-3.5 py-2.5 text-[11.5px] font-mono text-ink-2 whitespace-nowrap">
                            {s.endpoints[0]?.siteCode || '—'} ⇄ {s.endpoints[1]?.siteCode || s.endpoints[0]?.siteCode || '—'}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono whitespace-nowrap font-medium text-ink-1">
                            {s.bandwidthMbps} Mbps
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            <Badge tone={SERVICE_TONE[s.state]} dot>{s.state}</Badge>
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            <Badge tone={CONFORMANCE_TONE[s.conformance]}>{s.conformance}</Badge>
                          </td>
                          <td className="px-3.5 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="primary" onClick={() => handlePickService(s.id)}>
                              Select
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {filteredServices.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-ink-3 text-[13px]">
                            No services found matching your filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {filteredServices.length > 25 && (
                    <div className="px-4 py-2 bg-plane/50 border-t border-line-soft text-[12px] text-ink-3 text-center">
                      Showing 25 of {filteredServices.length} matching services. Refine your search to find specific records.
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ) : (
            /* Sub-step B: Configure Day-2 Operation with Workflow and Parameters */
            <div className="flex flex-col gap-4">
              {/* Selected Service Card */}
              <Card>
                <CardHead
                  title="Target service"
                  sub="Selected service from Service Inventory for this provisioning request"
                  right={
                    <Button size="sm" variant="ghost" onClick={handleClearSelectedService}>
                      <RotateCcw size={13} />Change service
                    </Button>
                  }
                />
                <CardBody className="flex flex-col gap-4">
                  <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-line-soft">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[16px] font-semibold text-ink-1">{selectedService.name}</span>
                        <Mono className="text-[12px] font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                          {selectedService.id}
                        </Mono>
                      </div>
                      <div className="text-[12.5px] text-ink-2">
                        {selectedService.accountName} · <Mono className="text-ink-3">{selectedService.accountId}</Mono> · Live since {shortDate(selectedService.liveSince)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={CATEGORY_TONE[selectedService.category]}>{selectedService.category} · {selectedService.type}</Badge>
                      <Badge tone={SERVICE_TONE[selectedService.state]} dot>{selectedService.state}</Badge>
                      <Badge tone={CONFORMANCE_TONE[selectedService.conformance]}>{selectedService.conformance}</Badge>
                    </div>
                  </div>

                  {/* Endpoints and Key Specs */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="border border-line rounded-lg p-3 bg-plane/30">
                      <div className="text-[11.5px] font-medium text-ink-3 mb-1">Current Bandwidth</div>
                      <div className="text-[15px] font-medium text-ink-1">{selectedService.bandwidthMbps} Mbps</div>
                      <div className="text-[11.5px] text-ink-3 mt-0.5">Committed information rate</div>
                    </div>
                    <div className="border border-line rounded-lg p-3 bg-plane/30">
                      <div className="text-[11.5px] font-medium text-ink-3 mb-1">Monthly Billing</div>
                      <div className="text-[15px] font-medium text-ink-1">{inr(selectedService.monthlyValueInr)}/mo</div>
                      <div className="text-[11.5px] text-ink-3 mt-0.5">Recurring revenue</div>
                    </div>
                    <div className="border border-line rounded-lg p-3 bg-plane/30">
                      <div className="text-[11.5px] font-medium text-ink-3 mb-1">Topology Endpoints</div>
                      <div className="text-[13px] font-medium text-ink-1 truncate">
                        {selectedService.endpoints[0]?.siteCode} ⇄ {selectedService.endpoints[1]?.siteCode || 'Single-ended'}
                      </div>
                      <div className="text-[11.5px] text-ink-3 mt-0.5">{selectedService.endpoints.length} active port(s)</div>
                    </div>
                    <div className="border border-line rounded-lg p-3 bg-plane/30">
                      <div className="text-[11.5px] font-medium text-ink-3 mb-1">Conformance Drift</div>
                      <div className="text-[15px] font-medium text-ink-1">
                        {selectedService.driftCount === 0 ? '0 drifts' : `${selectedService.driftCount} open drift(s)`}
                      </div>
                      <div className="text-[11.5px] text-ink-3 mt-0.5">
                        {selectedService.lastProvenAt ? `Proven ${relTime(selectedService.lastProvenAt)}` : 'Never proven'}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* 1. OPERATIONAL WORKFLOW TEMPLATE SELECTION (Required for ALL Day-2 operations) */}
              <Card>
                <CardHead
                  title="Workflow Template"
                  sub={`Automation workflow tailored for ${selectedService.category} services on ${endpointVendorsLabel || 'target'} hardware.`}
                  right={
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedDay2Workflow && (
                        <Badge tone="good" className="!text-[10.5px]">
                          Selected: {selectedDay2Workflow.name} ({selectedDay2Workflow.id})
                        </Badge>
                      )}
                    </div>
                  }
                />
                <CardBody className="flex flex-col gap-3">
                  <div className="text-[12px] text-ink-2">
                    Showing <b>{serviceWorkflows.length}</b> workflow template{serviceWorkflows.length === 1 ? '' : 's'} matching category <b>{selectedService.category}</b>
                    {endpointVendorsLabel ? ` and target endpoint vendor ${endpointVendorsLabel}` : ''}:
                  </div>

                  {serviceWorkflows.length === 0 ? (
                    <div className="p-4 text-center text-[12.5px] text-ink-3 border border-line rounded-lg bg-plane/30">
                      No operational workflow templates found for vendor {endpointVendorsLabel || 'matching endpoints'}.
                    </div>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 max-h-[240px] overflow-y-auto pr-1">
                      {serviceWorkflows.map((w) => {
                        const isChosen = day2WorkflowId === w.id
                        return (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => setDay2WorkflowId(w.id)}
                            className={`p-3 rounded-lg border text-left transition-all ${
                              isChosen
                                ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-200 shadow-sm'
                                : 'border-line hover:border-brand-200 bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className="text-[12.5px] font-medium text-ink-2 truncate" title={w.name}>
                                {w.name}
                              </span>
                              <Badge tone="good" className="!text-[9.5px] shrink-0">
                                {w.firstPassRate}% FPR
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-ink-3 mb-1.5 flex-wrap">
                              <Badge tone="info" className="!text-[9px]">
                                {w.operation ?? 'Create'}
                              </Badge>
                              <Badge tone="none">{w.vendor}</Badge>
                              <span>{w.tasks.length} tasks · {w.stages.length} stages</span>
                            </div>
                            <div className="flex items-center justify-between gap-1 text-[10.5px] text-ink-3">
                              <span className="truncate"><Mono>{w.id}</Mono> · v{w.version}</span>
                              {isChosen && (
                                <span className="font-semibold text-brand-600 flex items-center gap-0.5 shrink-0">
                                  <Check size={11} /> Selected
                                </span>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {!selectedDay2Workflow && (
                    <Note tone="crit">
                      Please select an operational workflow to trigger for this {requestIntent} operation.
                    </Note>
                  )}
                </CardBody>
              </Card>

              {/* 2. PARAMETER COMPARISON & MODIFICATION MATRIX */}
              {requestIntent === 'Modify' && (
                <Card>
                  <CardHead
                    title={
                      selectedDay2Workflow
                        ? `${selectedDay2Workflow.name} Parameters & Values`
                        : 'Service Parameters & Values (Current vs Requested)'
                    }
                    sub={
                      selectedDay2Workflow
                        ? `Displaying only the ${serviceParamsList.length} parameter${serviceParamsList.length === 1 ? '' : 's'} required by workflow ${selectedDay2Workflow.id}. Unchecked parameters remain unchanged.`
                        : 'Select an operational workflow template above to load required parameters.'
                    }
                    right={
                      <div className="flex items-center gap-2">
                        {selectedDay2Workflow && (
                          <Badge tone="info" className="!text-[10px]">
                            {serviceParamsList.filter((p) => p.modifiable).length} Modifiable · {serviceParamsList.filter((p) => !p.modifiable).length} Bound
                          </Badge>
                        )}
                        <Badge tone={changedParamsSummary.length > 0 ? 'good' : 'none'}>
                          {changedParamsSummary.length} parameter{changedParamsSummary.length === 1 ? '' : 's'} to change
                        </Badge>
                      </div>
                    }
                  />
                  <CardBody className="flex flex-col gap-4">
                    {!selectedDay2Workflow ? (
                      <div className="p-6 text-center border border-dashed border-line rounded-lg bg-plane/30">
                        <WorkflowIcon size={28} className="mx-auto text-ink-3 mb-2" />
                        <div className="text-[13px] font-medium text-ink-1">No Operational Workflow Selected</div>
                        <div className="text-[12px] text-ink-3 mt-1 max-w-md mx-auto">
                          Please select an operational workflow template above to view and configure the parameters demanded by that workflow.
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3 bg-brand-50/60 border border-brand-200 p-2.5 rounded-lg text-[12px]">
                          <div className="flex items-center gap-2 text-brand-900">
                            <CheckCircle2 size={16} className="text-brand-600 shrink-0" />
                            <span>
                              Active Workflow: <b>{selectedDay2Workflow.name}</b> (<Mono className="text-[11px]">{selectedDay2Workflow.id}</Mono>) · Demands only <b>{serviceParamsList.map((p) => p.name).join(', ')}</b>.
                            </span>
                          </div>
                          <Badge tone="info" className="!text-[10px] shrink-0">
                            Hitless Policer Change
                          </Badge>
                        </div>

                        {/* Full Parameters Table */}
                        <div className="border border-line rounded-lg overflow-hidden">
                          <table className="w-full text-[12.5px]">
                            <thead>
                              <tr className="bg-plane border-b border-line text-ink-2 text-[12px] font-medium">
                                <th className="px-3.5 py-2.5 text-center w-14 font-medium" title="Select parameters to modify">Modify</th>
                                <th className="px-3.5 py-2.5 text-left font-medium">Parameter name</th>
                                <th className="px-3.5 py-2.5 text-left font-medium">Current value (realised)</th>
                                <th className="px-3.5 py-2.5 text-left font-medium">Requested value (target)</th>
                                <th className="px-3.5 py-2.5 text-right font-medium">Status / Delta</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line-soft">
                              {serviceParamsList.map((p) => {
                                const isChecked = !!enabledParams[p.name]
                                const currentVal = p.current
                                const rawInput = paramValues[p.name] ?? (p.isBandwidth ? String(selectedService.bandwidthMbps) : p.current)
                                const isBw = p.isBandwidth

                                // Determine if value was actually modified
                                let isModified = false
                                let deltaBadge: ReactNode = <Badge tone="none">Unchanged</Badge>

                                if (p.modifiable === false) {
                                  deltaBadge = <Badge tone="none">Bound (Fixed)</Badge>
                                } else if (isChecked) {
                                  if (isBw) {
                                    const newBw = Number(rawInput) || selectedService.bandwidthMbps
                                    if (newBw !== selectedService.bandwidthMbps) {
                                      isModified = true
                                      const diff = newBw - selectedService.bandwidthMbps
                                      deltaBadge = (
                                        <Badge tone={diff > 0 ? 'good' : 'warn'}>
                                          {diff > 0 ? `▲ +${diff} Mbps` : `▼ ${diff} Mbps`}
                                        </Badge>
                                      )
                                    }
                                  } else {
                                    if (rawInput.trim() && rawInput.trim() !== currentVal) {
                                      isModified = true
                                      deltaBadge = <Badge tone="good">▲ Modified</Badge>
                                    }
                                  }
                                }

                                return (
                                  <tr
                                    key={p.name}
                                    className={`transition-colors ${
                                      p.modifiable === false
                                        ? 'bg-plane/25'
                                        : isModified
                                          ? 'bg-brand-50/40'
                                          : isChecked
                                            ? 'bg-plane/60'
                                            : 'hover:bg-plane/40'
                                    }`}
                                  >
                                    {/* Checkbox column */}
                                    <td className="px-3.5 py-2.5 text-center">
                                      {p.modifiable === false ? (
                                        <div
                                          className="flex items-center justify-center text-ink-3"
                                          title="Parameter is locked and bound to topology context"
                                        >
                                          <Lock size={13} className="text-slate-400" />
                                        </div>
                                      ) : (
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => handleToggleParam(p.name)}
                                          className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500 cursor-pointer"
                                          title={`Toggle modification for ${p.name}`}
                                        />
                                      )}
                                    </td>

                                    {/* Parameter Name */}
                                    <td className="px-3.5 py-2.5">
                                      <div className="flex items-center gap-1.5 font-medium text-ink-1">
                                        <span>{p.name}</span>
                                        {p.modifiable === false && (
                                          <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-slate-100 text-ink-3 font-normal border border-line-soft">
                                            Topology Bound
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10.5px] text-ink-3">{p.hint || p.source}</div>
                                    </td>

                                    {/* Current Value (Realised) */}
                                    <td className="px-3.5 py-2.5 font-mono text-ink-2 bg-plane/30">
                                      <Mono className="px-2 py-0.5 rounded bg-slate-100 border border-line-soft font-semibold">
                                        {currentVal}
                                      </Mono>
                                    </td>

                                    {/* Requested Value (Target) */}
                                    <td className="px-3.5 py-2.5">
                                      {p.modifiable === false ? (
                                        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3 bg-plane/50 px-2.5 py-1.5 rounded border border-line-soft font-mono max-w-[340px]">
                                          <Lock size={12} className="text-slate-400 shrink-0" />
                                          <span>Fixed: <b>{currentVal}</b> ({p.source})</span>
                                        </div>
                                      ) : isChecked ? (
                                        <div className="flex flex-col gap-1.5 max-w-[340px]">
                                          {isBw ? (
                                            <>
                                              <div className="flex items-center gap-2">
                                                <input
                                                  type="number"
                                                  min={10}
                                                  max={100000}
                                                  step={10}
                                                  value={rawInput}
                                                  onChange={(e) => handleParamValueChange('Bandwidth', e.target.value)}
                                                  className="w-full px-2.5 py-1.5 border border-brand-300 rounded font-mono text-[13px] bg-white outline-none focus:ring-2 focus:ring-brand-200"
                                                  placeholder="Enter CIR in Mbps..."
                                                />
                                                <span className="text-[12px] text-ink-3 font-medium">Mbps</span>
                                              </div>
                                              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                                <button
                                                  type="button"
                                                  onClick={() => handleParamValueChange('Bandwidth', String(selectedService.bandwidthMbps + 50))}
                                                  className="text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-line hover:border-brand-300 hover:text-brand-700"
                                                >
                                                  +50M
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleParamValueChange('Bandwidth', String(selectedService.bandwidthMbps + 100))}
                                                  className="text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-line hover:border-brand-300 hover:text-brand-700"
                                                >
                                                  +100M
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleParamValueChange('Bandwidth', String(selectedService.bandwidthMbps * 2))}
                                                  className="text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-line hover:border-brand-300 hover:text-brand-700"
                                                >
                                                  2× ({selectedService.bandwidthMbps * 2}M)
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleParamValueChange('Bandwidth', '1000')}
                                                  className="text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-line hover:border-brand-300 hover:text-brand-700"
                                                >
                                                  1 Gbps
                                                </button>
                                              </div>
                                            </>
                                          ) : p.name === 'Burst size' ? (
                                            <>
                                              <input
                                                type="text"
                                                value={rawInput}
                                                onChange={(e) => handleParamValueChange('Burst size', e.target.value)}
                                                className="w-full px-2.5 py-1.5 border border-brand-300 rounded font-mono text-[12.5px] bg-white outline-none focus:ring-2 focus:ring-brand-200"
                                                placeholder="e.g. 625 KB, 1250 KB..."
                                              />
                                              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                                {['625 KB', '1250 KB', '2500 KB', '5000 KB'].map((b) => (
                                                  <button
                                                    key={b}
                                                    type="button"
                                                    onClick={() => handleParamValueChange('Burst size', b)}
                                                    className={`text-[10.5px] px-1.5 py-0.5 rounded border transition-colors ${
                                                      rawInput === b
                                                        ? 'bg-brand-50 border-brand-400 text-brand-700 font-semibold'
                                                        : 'bg-white border-line hover:border-brand-300 text-ink-2'
                                                    }`}
                                                  >
                                                    {b}
                                                  </button>
                                                ))}
                                              </div>
                                            </>
                                          ) : p.name === 'Policer action' ? (
                                            <select
                                              value={rawInput}
                                              onChange={(e) => handleParamValueChange('Policer action', e.target.value)}
                                              className="w-full px-2.5 py-1.5 border border-brand-300 rounded font-mono text-[12px] bg-white outline-none focus:ring-2 focus:ring-brand-200 text-ink-1"
                                            >
                                              <option value="loss-priority high">loss-priority high (Remark drop precedence)</option>
                                              <option value="discard">discard (Hard drop exceeding packets)</option>
                                              <option value="drop">drop (Drop violation traffic)</option>
                                              <option value="transmit">transmit (Transmit best-effort)</option>
                                            </select>
                                          ) : (
                                            <input
                                              type="text"
                                              value={rawInput}
                                              onChange={(e) => handleParamValueChange(p.name, e.target.value)}
                                              className="w-full px-2.5 py-1.5 border border-brand-300 rounded font-mono text-[12.5px] bg-white outline-none focus:ring-2 focus:ring-brand-200"
                                              placeholder={`Enter new ${p.name}...`}
                                            />
                                          )}
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleToggleParam(p.name)}
                                          className="text-[11.5px] text-ink-3 italic hover:text-brand-600 text-left transition-colors flex items-center gap-1.5"
                                        >
                                          <span>Unchanged (keeping current: {currentVal})</span>
                                          <span className="text-brand-600 text-[10.5px] not-italic underline font-medium">Edit</span>
                                        </button>
                                      )}
                                    </td>

                                    {/* Status / Delta */}
                                    <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                                      {deltaBadge}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Review of Parameter Changes */}
                        {changedParamsSummary.length > 0 && (
                          <div className="border border-brand-200 bg-brand-50/30 rounded-lg p-3.5 flex flex-col gap-2">
                            <div className="text-[12px] font-semibold text-brand-900">
                              Review of requested parameter changes ({changedParamsSummary.length}):
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {changedParamsSummary.map((c) => (
                                <div key={c.name} className="p-2.5 rounded border border-brand-200 bg-white text-[12px]">
                                  <div className="font-semibold text-ink-1 mb-1">{c.name}</div>
                                  <div className="flex items-center gap-1.5 font-mono text-[11.5px]">
                                    <span className="text-ink-3 line-through">{c.current}</span>
                                    <span className="text-brand-600 font-bold">➔ {c.requested}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </CardBody>
                </Card>
              )}

              {/* Parameter view for other operations (Suspend, Resume, Cease, Re-prove) */}
              {requestIntent !== 'Modify' && (
                <Card>
                  <CardHead
                    title="Workflow Parameters"
                    sub={
                      selectedDay2Workflow
                        ? `Parameters evaluated and bound by workflow ${selectedDay2Workflow.id} during this ${requestIntent} operation.`
                        : 'Parameters currently realised on this service.'
                    }
                    right={
                      <div className="flex items-center gap-2">
                        {selectedDay2Workflow && (
                          <Badge tone="info" className="!text-[10px]">
                            {serviceParamsList.length} Bound Parameter{serviceParamsList.length === 1 ? '' : 's'}
                          </Badge>
                        )}
                      </div>
                    }
                  />
                  <CardBody className="py-3">
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {serviceParamsList.map((p) => (
                        <div key={p.name} className="p-3 rounded-lg border border-line bg-plane/30 flex flex-col justify-between gap-1 text-[12px]">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-ink-3 text-[11.5px] font-medium">{p.name}</span>
                            <span className="text-[10px] text-ink-3 bg-white px-1.5 py-0.5 rounded border border-line-soft font-mono">
                              {p.source}
                            </span>
                          </div>
                          <div className="font-mono font-medium text-ink-1 text-[13.5px] mt-0.5">{p.current}</div>
                          {p.hint && <div className="text-[10.5px] text-ink-3">{p.hint}</div>}
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Operation-specific inputs & notes */}
              <Card>
                <CardHead
                  title={`${requestIntent} Details & Justification`}
                  sub={`Specify reasons for this ${requestIntent}`}
                />
                <CardBody className="flex flex-col gap-4">
                  {/* ---- Suspend Form ---- */}
                  {requestIntent === 'Suspend' && (
                    <div className="flex flex-col gap-4">
                      <Note tone="warn">
                        <b>Traffic disruption notice.</b> Interface traffic across all endpoints will be administratively halted. Billing and underlying configurations remain reserved for rapid resumption.
                      </Note>
                      <Field label="Suspension Category / Reason" required>
                        <Select value={day2PresetReason} onChange={(e) => setDay2PresetReason(e.target.value)}>
                          {DAY2_PRESETS.Suspend.map((p) => <option key={p} value={p}>{p}</option>)}
                        </Select>
                      </Field>
                    </div>
                  )}

                  {/* ---- Resume Form ---- */}
                  {requestIntent === 'Resume' && (
                    <div className="flex flex-col gap-4">
                      <Note tone="good">
                        <b>Restoration notice.</b> Administrative shutdown will be lifted on device interfaces. Telemetry verification probes will run immediately upon execution.
                      </Note>
                      <Field label="Resumption Category / Reason" required>
                        <Select value={day2PresetReason} onChange={(e) => setDay2PresetReason(e.target.value)}>
                          {DAY2_PRESETS.Resume.map((p) => <option key={p} value={p}>{p}</option>)}
                        </Select>
                      </Field>
                    </div>
                  )}

                  {/* ---- Cease Form ---- */}
                  {requestIntent === 'Cease' && (
                    <div className="flex flex-col gap-4">
                      <Note tone="crit">
                        <b>Permanent decommissioning notice.</b> Service configuration will be wiped from edge routers. Allocated resources (IPs, VLANs) enter a mandatory 30-day quarantine period.
                      </Note>
                      <Field label="Cease Justification / Churn Category" required>
                        <Select value={day2PresetReason} onChange={(e) => setDay2PresetReason(e.target.value)}>
                          {DAY2_PRESETS.Cease.map((p) => <option key={p} value={p}>{p}</option>)}
                        </Select>
                      </Field>
                    </div>
                  )}

                  {/* ---- Re-prove Form ---- */}
                  {requestIntent === 'Re-prove' && (
                    <div className="flex flex-col gap-4">
                      <Note tone="good">
                        <b>Non-disruptive telemetry audit.</b> Sends synthetic probe packets and verifies router CLI configuration against catalog intent. Safe to execute at any time.
                      </Note>
                      <Field label="Verification Scope" required>
                        <Select value={reproveScope} onChange={(e) => setReproveScope(e.target.value)}>
                          {REPROVE_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      </Field>
                      <Field label="Audit Reason Preset">
                        <Select value={day2PresetReason} onChange={(e) => setDay2PresetReason(e.target.value)}>
                          {DAY2_PRESETS['Re-prove'].map((p) => <option key={p} value={p}>{p}</option>)}
                        </Select>
                      </Field>
                    </div>
                  )}

                  {/* Operational Notes / Ticket input */}
                  <Field
                    label="Operation Notes"
                    required={requestIntent !== 'Re-prove'}
                  >
                    <textarea
                      value={day2Reason}
                      onChange={(e) => setDay2Reason(e.target.value)}
                      rows={3}
                      placeholder="Enter operational notes..."
                      className={TEXTAREA_CLS}
                    />
                  </Field>

                  {/* Cease Decommissioning Confirmation Checkbox (after Operation Notes) */}
                  {requestIntent === 'Cease' && (
                    <div className="p-3 rounded-lg border border-crit-200 bg-crit-50/50 flex items-start gap-2.5">
                      <input
                        id="confirm-cease-cb"
                        type="checkbox"
                        checked={ceaseConfirmed}
                        onChange={(e) => setCeaseConfirmed(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-crit-300 text-crit-600 focus:ring-crit-500 cursor-pointer"
                      />
                      <label htmlFor="confirm-cease-cb" className="text-[12.5px] font-medium text-crit-900 cursor-pointer">
                        I confirm that customer decommissioning approval has been verified and this service should be permanently torn down.
                      </label>
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* Sticky Action Footer */}
              <div
                className="sticky bottom-0 z-10 bg-white px-5 py-3.5 border border-line rounded-lg flex items-center justify-between gap-3 shadow-[0_-6px_12px_-8px_rgba(15,23,42,0.12)]"
              >
                <Button onClick={() => nav('/requests')}>
                  <ArrowLeft size={15} />Back to requests
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={handleClearSelectedService}>
                    Clear selection
                  </Button>
                  <Button
                    variant={requestIntent === 'Cease' ? 'danger' : 'primary'}
                    disabled={!canSubmitDay2}
                    onClick={submitDay2}
                  >
                    <CheckCircle2 size={15} />
                    Submit {requestIntent} request
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
