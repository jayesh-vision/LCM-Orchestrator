import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleOff, Link2, Lock, PauseCircle, Pencil, PlayCircle, Plus,
  RotateCcw, Save, Search, Server, ShieldCheck, Sliders, Trash2, Unlock, Workflow as WorkflowIcon,
} from 'lucide-react'
import { useStore, type WizardDraft } from '@/store/useStore'
import { ACCOUNTS, DEVICE_MODELS, SITES, modelsForCategory } from '@/data/catalog'
import { bindEndpoints } from '@/data/orders'
import { workflowParams } from '@/data/templates'
import { VENDOR_LABEL } from '@/data/workflows'
import type { Category, Domain, Endpoint, EndpointRole, OrderIntent, OrderParamValue, Vendor, Workflow } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, Field, Mono, Note, PageHead,
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
function subtypeOptions(domain: Domain, category: Category, type: string): string[] {
  if (category === 'RAN VNF') return type === 'DU' ? ['Indoor', 'Outdoor'] : ['Standalone', 'Non-Standalone']
  if (category === 'DWDM') return DWDM_SUBTYPES
  return DOMAIN_SUBTYPES[domain]
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
  Modify: ['Live', 'Degraded'],
  Suspend: ['Live', 'Degraded'],
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
  const [svc] = useState<Record<string, string>>({})
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [shut2, setShut2] = useState<Record<number, boolean>>({})
  const toggle = (set: typeof setShut2, i: number) => set((p) => ({ ...p, [i]: !p[i] }))

  // Day-2 search & selection state
  const [svcSearch, setSvcSearch] = useState('')
  const [svcDomain, setSvcDomain] = useState<Domain | 'All'>('All')
  const [svcCategory, setSvcCategory] = useState<Category | 'All'>('All')
  const [svcState, setSvcState] = useState<string>('All')

  // Day-2 workflow & parameter state
  const [day2Reason, setDay2Reason] = useState('')
  const [day2PresetReason, setDay2PresetReason] = useState('')
  const [ceaseConfirmed, setCeaseConfirmed] = useState(false)
  const [reproveScope, setReproveScope] = useState(REPROVE_SCOPES[0])

  // Day-2 per-endpoint operational workflow selection: endpoint index -> workflowId
  const [day2WfByEp, setDay2WfByEp] = useState<Record<number, string>>({})
  // Day-2 per-endpoint parameter values: endpoint index -> paramName -> value
  const [day2ParamValuesByEp, setDay2ParamValuesByEp] = useState<Record<number, Record<string, string>>>({})
  // Day-2 per-endpoint parameter modification toggle: endpoint index -> paramName -> isEnabled
  const [day2EnabledParamsByEp, setDay2EnabledParamsByEp] = useState<Record<number, Record<string, boolean>>>({})
  // Synchronize common bandwidth changes across all endpoints by default
  const [syncCommonParams, setSyncCommonParams] = useState<boolean>(true)
  // Active device view: 'all' or specific device index (0, 1, etc.)
  const [activeDeviceTab, setActiveDeviceTab] = useState<'all' | number>('all')

  const selectedService = useMemo(() => services.find((s) => s.id === selectedServiceId) ?? null, [services, selectedServiceId])

  // Filter candidate workflows strictly for a specific endpoint/device
  // Matching device vendor, device model, service category, and current operation check
  const candidatesForEndpoint = useCallback((ep: Endpoint) => {
    if (!ep || !selectedService) return []
    const base = workflows.filter((w) => {
      if (w.state !== 'Active') return false
      // 1. Strict operation match: Modify workflows for Modify, Suspend for Suspend, etc.
      const wfOp = w.operation ?? 'Create'
      if (wfOp !== requestIntent) return false
      // 2. Service category match
      if (w.category !== selectedService.category) return false
      // 3. Vendor match
      if (w.vendor !== ep.vendor) return false
      return true
    })
    if (ep.deviceName) {
      const modelMatched = base.filter((w) => w.models?.includes(ep.deviceName) || w.model === ep.deviceName)
      if (modelMatched.length > 0) return modelMatched.sort((a, b) => b.firstPassRate - a.firstPassRate)
    }
    return base.sort((a, b) => b.firstPassRate - a.firstPassRate)
  }, [workflows, selectedService, requestIntent])

  // Helper to add a workflow for an endpoint
  // Selected workflow for a specific endpoint (strictly single workflow per device)
  const getSelectedWfForEndpoint = useCallback((epIdx: number): Workflow | null => {
    const id = day2WfByEp[epIdx]
    if (!id) return null
    return workflows.find((w) => w.id === id && (w.operation ?? 'Create') === requestIntent) ?? null
  }, [day2WfByEp, workflows, requestIntent])

  // Extract parameters demanded strictly by the selected workflow for a specific endpoint
  const getParamsForEndpoint = useCallback((epIdx: number) => {
    if (!selectedService) return []
    const ep = selectedService.endpoints[epIdx]
    if (!ep) return []
    const chosenWf = getSelectedWfForEndpoint(epIdx)
    if (!chosenWf) return []

    // Peer endpoint for peer IP / neighbor IP reference
    const peerEp = selectedService.endpoints.find((_, i) => i !== epIdx) ?? ep

    // Parameters demanded by this single workflow
    const needed = workflowParams(chosenWf.tasks)
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
        const port = ep.port || 'Ethernet4'
        list.push({
          name: 'Interface',
          current: port,
          source: `${ep.deviceName || 'Device'} Port`,
          modifiable: false,
          defaultValue: port,
          hint: `Device port bound to topology (${ep.deviceName})`,
        })
      } else if (name === 'Neighbor IP') {
        const peerIp = peerEp.mgmtIp || ep.mgmtIp || '172.31.48.110'
        list.push({
          name: 'Neighbor IP',
          current: peerIp,
          source: `${peerEp.deviceName || 'Peer'} Management IP`,
          modifiable: false,
          defaultValue: peerIp,
          hint: `Neighbor BGP / PE peer address (${peerEp.deviceName})`,
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
      } else if (name === 'Description') {
        list.push({
          name: 'Description',
          current: selectedService.name,
          source: 'Service Description',
          modifiable: true,
          defaultValue: selectedService.name,
          hint: 'Interface description',
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

    return list.sort((a, b) => {
      if (a.modifiable !== b.modifiable) return a.modifiable ? -1 : 1
      if (a.isBandwidth) return -1
      if (b.isBandwidth) return 1
      return a.name.localeCompare(b.name)
    })
  }, [selectedService, getSelectedWfForEndpoint])

  // Primary selected workflow (for general card / backward compatibility)
  const selectedDay2Workflow = useMemo(() => {
    return getSelectedWfForEndpoint(0)
  }, [getSelectedWfForEndpoint])

  // Backward-compatible single list of params (from primary endpoint)
  const serviceParamsList = useMemo(() => {
    return getParamsForEndpoint(0)
  }, [getParamsForEndpoint])

  // Auto-preselect best workflow template matching each device's vendor, model, and category for current operation
  useEffect(() => {
    if (selectedService && selectedService.endpoints.length > 0) {
      setDay2WfByEp((prev) => {
        const next: Record<number, string> = {}
        selectedService.endpoints.forEach((ep, epIdx) => {
          const candidates = candidatesForEndpoint(ep)
          const currentValid = prev[epIdx] && candidates.some((c) => c.id === prev[epIdx])
          next[epIdx] = currentValid ? prev[epIdx] : (candidates[0]?.id || '')
        })
        return next
      })
      setDay2Reason('')
      setDay2PresetReason(DAY2_PRESETS[requestIntent][0] ?? '')
      setCeaseConfirmed(false)
    }
  }, [selectedService, requestIntent, candidatesForEndpoint])

  // Initialize parameter values dynamically per endpoint based on what each device's workflow demands
  useEffect(() => {
    if (!selectedService) return

    selectedService.endpoints.forEach((_, epIdx) => {
      const paramsList = getParamsForEndpoint(epIdx)
      if (paramsList.length > 0) {
        setDay2ParamValuesByEp((prev) => {
          const curValues = prev[epIdx] ? { ...prev[epIdx] } : {}
          let changed = false
          paramsList.forEach((p) => {
            if (curValues[p.name] === undefined) {
              curValues[p.name] = p.defaultValue
              changed = true
            }
          })
          if (!changed && prev[epIdx]) return prev
          return { ...prev, [epIdx]: curValues }
        })

        setDay2EnabledParamsByEp((prev) => {
          const curEnabled = prev[epIdx] ? { ...prev[epIdx] } : {}
          let changed = false
          paramsList.forEach((p) => {
            if (curEnabled[p.name] === undefined) {
              curEnabled[p.name] = p.modifiable && p.isBandwidth ? (requestIntent === 'Modify') : false
              changed = true
            }
          })
          if (!changed && prev[epIdx]) return prev
          return { ...prev, [epIdx]: curEnabled }
        })
      }
    })
  }, [selectedService, day2WfByEp, requestIntent, getParamsForEndpoint])

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
    setDay2WfByEp({})
    setDay2ParamValuesByEp({})
    setDay2EnabledParamsByEp({})
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
    setDay2WfByEp({})
    setDay2ParamValuesByEp({})
    setDay2EnabledParamsByEp({})
    setSearchParams({ intent: requestIntent, serviceId: sId }, { replace: true })
  }

  const handleClearSelectedService = () => {
    setSelectedServiceId('')
    setDay2WfByEp({})
    setDay2ParamValuesByEp({})
    setDay2EnabledParamsByEp({})
    setSearchParams({ intent: requestIntent }, { replace: true })
  }

  // Handle per-endpoint parameter modification toggle
  const handleEpToggleParam = (epIdx: number, name: string) => {
    setDay2EnabledParamsByEp((prev) => {
      const current = prev[epIdx]?.[name] ?? false
      const nextVal = !current
      const updated = { ...prev, [epIdx]: { ...(prev[epIdx] || {}), [name]: nextVal } }

      if (syncCommonParams && name === 'Bandwidth' && selectedService) {
        selectedService.endpoints.forEach((_, idx) => {
          if (idx !== epIdx) {
            updated[idx] = { ...(updated[idx] || {}), [name]: nextVal }
          }
        })
      }
      return updated
    })
  }

  // Handle per-endpoint parameter value change
  const handleEpParamChange = (epIdx: number, name: string, value: string) => {
    setDay2ParamValuesByEp((prev) => {
      const nextEpValues = { ...(prev[epIdx] || {}), [name]: value }
      const updated = { ...prev, [epIdx]: nextEpValues }

      if (syncCommonParams && name === 'Bandwidth' && selectedService) {
        selectedService.endpoints.forEach((_, idx) => {
          if (idx !== epIdx) {
            updated[idx] = { ...(updated[idx] || {}), [name]: value }
          }
        })
      }
      return updated
    })

    setDay2EnabledParamsByEp((prev) => {
      const nextEpEnabled = { ...(prev[epIdx] || {}), [name]: true }
      const updated = { ...prev, [epIdx]: nextEpEnabled }

      if (syncCommonParams && name === 'Bandwidth' && selectedService) {
        selectedService.endpoints.forEach((_, idx) => {
          if (idx !== epIdx) {
            updated[idx] = { ...(updated[idx] || {}), [name]: true }
          }
        })
      }
      return updated
    })
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
    const ep = activeEps[i]
    const v = vendorOfIdx(i)
    if (!v) return []

    // 1. Must be Active, operation Create, category match, vendor match
    const activeCandidates = workflows.filter((w) => {
      if (w.state !== 'Active') return false
      if ((w.operation ?? 'Create') !== 'Create') return false
      if (w.category !== category) return false
      if (w.vendor !== v) return false
      if (!single && !star && w.endpointRole && w.endpointRole !== role) return false
      // Device model filter: if device model selected, workflow must support this model
      if (ep?.model) {
        const matchesModel = w.models?.includes(ep.model) || w.model === ep.model
        if (!matchesModel) return false
      }
      return true
    })

    // 2. Strict type & subtype match (matching Step 1 selections)
    const exactSubtypeMatches = activeCandidates.filter((w) => {
      const matchType = !intent.type || w.type === intent.type
      const matchSubtype = !subtype || w.subtype === subtype
      return matchType && matchSubtype
    })
    if (exactSubtypeMatches.length > 0) {
      return exactSubtypeMatches.sort((a, b) => b.firstPassRate - a.firstPassRate)
    }

    // 3. Fallback: match type
    const typeMatches = activeCandidates.filter((w) => !intent.type || w.type === intent.type)
    if (typeMatches.length > 0) {
      return typeMatches.sort((a, b) => b.firstPassRate - a.firstPassRate)
    }

    // 4. Fallback: all active candidates for this category, vendor & model
    return activeCandidates.sort((a, b) => b.firstPassRate - a.firstPassRate)
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
  }, [intentId, portSig, endpointCount, category, subtype])

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
  const endpointsOk = activeEps.every((e) => e.vendor && e.model && e.siteCode)
  const workflowsOk = activeEps.every((_, i) => !!wfByEp[i])

  const boundEps = useMemo(() => {
    if (!endpointsOk) return []
    const draftEps = activeEps.map((e, i) => {
      const dm = (e.model ? DEVICE_MODELS.find((d) => d.model === e.model) : undefined)
        ?? DEVICE_MODELS.find((d) => d.ports.includes(e.port))
        ?? DEVICE_MODELS[0]
      const port = e.port || dm.ports[i % dm.ports.length] || 'Ethernet1'
      return {
        id: `EP-W${i}`, role: e.role, siteCode: e.siteCode, deviceName: dm.model,
        vendor: (e.vendor || dm.vendor) as Vendor, mgmtIp: mgmtIpFor(i), port,
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

  const epValuesOk = epParams.length > 0
    && epParams.every((list) => list.length > 0 && list.every((p) => p.value !== '' && p.value !== '—'))
  const valuesOk = epValuesOk

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
    problems.push(`This intent needs ${intent.endpointArity} endpoint(s), all with vendor, device, and site selected.`)
  }
  if (!workflowsOk) {
    const missing = activeEps.map((_, i) => i).filter((i) => !wfByEp[i]).map(labelOfIdx)
    problems.push(`No workflow template selected for ${missing.join(' and ')}.`)
  }
  if (!epValuesOk) problems.push('Every endpoint needs a value for each parameter its template renders.')

  const nextDisabledReason = useMemo(() => {
    if (step === 0) {
      if (!intentId) return 'Select a profile type'
      if (!accountId) return 'Select a customer'
    }
    if (step === 1) {
      const unconfigured = activeEps.some((e) => !e.vendor || !e.model || !e.siteCode)
      if (unconfigured) return 'Complete all fields for each endpoint'
      if (!workflowsOk) return 'Select a workflow template for each endpoint'
    }
    if (step === 2 && !valuesOk) return 'Fill all required parameters'
    if (step === 3 && problems.length > 0) return problems[0]
    return null
  }, [step, intentId, accountId, activeEps, workflowsOk, valuesOk, problems])

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

  // Calculate changed parameters for Modify across all endpoints
  const changedParamsSummary = useMemo(() => {
    if (!selectedService || requestIntent !== 'Modify') return []
    const changes: {
      epIdx: number
      epName: string
      vendor: string
      name: string
      current: string
      requested: string
      isBw?: boolean
    }[] = []

    selectedService.endpoints.forEach((ep, epIdx) => {
      const paramsList = getParamsForEndpoint(epIdx)
      const epVals = day2ParamValuesByEp[epIdx] || {}
      const epEnabled = day2EnabledParamsByEp[epIdx] || {}

      paramsList.forEach((p) => {
        if (!p.modifiable) return
        if (!epEnabled[p.name]) return
        const val = epVals[p.name] ?? p.defaultValue
        const isBw = p.isBandwidth

        if (isBw) {
          const num = Number(val) || selectedService.bandwidthMbps
          if (num !== selectedService.bandwidthMbps) {
            changes.push({
              epIdx,
              epName: ep.deviceName || `Endpoint ${epIdx + 1}`,
              vendor: ep.vendor,
              name: p.name,
              current: `${selectedService.bandwidthMbps} Mbps`,
              requested: `${num} Mbps`,
              isBw: true,
            })
          }
        } else {
          if (val.trim() && val.trim() !== p.current) {
            changes.push({
              epIdx,
              epName: ep.deviceName || `Endpoint ${epIdx + 1}`,
              vendor: ep.vendor,
              name: p.name,
              current: p.current,
              requested: val.trim(),
              isBw: false,
            })
          }
        }
      })
    })

    return changes
  }, [selectedService, requestIntent, getParamsForEndpoint, day2ParamValuesByEp, day2EnabledParamsByEp])

  // Day-2 submit validation & handler
  const canSubmitDay2 = useMemo(() => {
    if (!selectedService) return false
    const hasReason = !!day2Reason.trim() || !!day2PresetReason
    // All endpoints must have a selected workflow
    const allEndpointsHaveWf = selectedService.endpoints.length > 0
      && selectedService.endpoints.every((_, idx) => !!day2WfByEp[idx])

    if (!allEndpointsHaveWf) return false

    if (requestIntent === 'Modify') {
      return changedParamsSummary.length > 0 && hasReason
    }
    if (requestIntent === 'Suspend') return hasReason
    if (requestIntent === 'Resume') return hasReason
    if (requestIntent === 'Cease') return ceaseConfirmed && hasReason
    if (requestIntent === 'Re-prove') return true
    return false
  }, [selectedService, requestIntent, day2WfByEp, changedParamsSummary, day2Reason, day2PresetReason, ceaseConfirmed])

  const submitDay2 = () => {
    if (!selectedService) return
    const finalNotes = [day2PresetReason, day2Reason.trim()].filter(Boolean).join(' · ')
    const primaryWfId = day2WfByEp[0] || ''

    let delta: { attribute: string; current: string; requested: string }[] | undefined
    let params: OrderParamValue[] | undefined

    if (requestIntent === 'Modify') {
      delta = changedParamsSummary.map((c) => ({
        attribute: `${c.name} (${c.epName})`,
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

    // Endpoint specific params and workflows
    const endpointParams: Record<number, OrderParamValue[]> = {}
    const endpointWorkflows: Record<number, string> = {}
    selectedService.endpoints.forEach((_, epIdx) => {
      const epParamList = getParamsForEndpoint(epIdx)
      const epVals = day2ParamValuesByEp[epIdx] || {}
      endpointParams[epIdx] = epParamList.map((p) => ({
        name: p.name,
        value: epVals[p.name] ?? p.current,
        source: p.modifiable ? 'user' as const : 'derived' as const,
      }))
      const wfId = day2WfByEp[epIdx]
      if (wfId) {
        endpointWorkflows[epIdx] = wfId
      }
    })

    const order = raiseChange(
      selectedService.id,
      requestIntent,
      delta,
      params,
      finalNotes,
      primaryWfId,
      endpointWorkflows,
      endpointParams,
    )
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
    const ep = activeEps[i]
    const v = vendorOfIdx(i)
    const candidates = candidatesForIdx(i)
    const chosen = wfByEp[i]
    const chosenWf = workflows.find((w) => w.id === chosen)
    return (
      <div className="flex flex-col gap-2 pt-2 border-t border-line-soft">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12px] font-semibold text-ink-2 flex items-center gap-1.5">
            <WorkflowIcon size={13} className="text-brand-600" />
            <span>Workflow template</span>
            {v && <Badge tone="none">{VENDOR_LABEL[v] ?? v}</Badge>}
            {ep?.model && <Badge tone="info" className="!text-[10px] font-mono">{ep.model}</Badge>}
          </div>
          {chosenWf && (
            <Badge tone="good" className="!text-[10px]">
              Active: {chosenWf.name} ({chosenWf.id}) · {chosenWf.firstPassRate}% FPR
            </Badge>
          )}
        </div>
        {!v ? (
          <Note tone="info" className="!py-2 !px-3 text-[12px] text-ink-3">
            Select a vendor and device above to view available workflow templates.
          </Note>
        ) : !ep?.model ? (
          <Note tone="info" className="!py-2 !px-3 text-[12px] text-ink-3">
            Select a device above to view available workflow templates matching its model.
          </Note>
        ) : candidates.length === 0 ? (
          <Note tone="crit" className="!py-2 !px-3 text-[12px]">
            No active workflow matches {ep.model} ({VENDOR_LABEL[v] ?? v}) for {category} ({intent.type}{subtype ? ` · ${subtype}` : ''}).
          </Note>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              value={chosen || ''}
              onChange={(e) => setWfByEp((p) => ({ ...p, [i]: e.target.value }))}
              className="w-full text-[12.5px]"
            >
              <option value="">Select workflow template for {ep.model}...</option>
              {candidates.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.id}) · {w.tasks.length} tasks · {w.firstPassRate}% FPR
                </option>
              ))}
            </Select>
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

    return (
      <div key={i} className="border border-line rounded-lg overflow-hidden bg-white shadow-2xs">
        {sectionHead(open, () => toggle(setShut2, i),
          <>
            <Badge tone={isSource ? 'info' : 'none'}>{labelOfIdx(i)}</Badge>
            <span className="text-[12px] text-ink-3 truncate">
              {ep?.siteCode && ep?.model ? `${ep.siteCode} · ${ep.model}` : 'Not configured'}
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
            <div className="grid gap-3 sm:grid-cols-3">
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
                    const dm = modelsForVendor.find((x) => x.model === m)
                    const defaultPort = dm?.ports[0] || 'Ethernet1'
                    setEps((prev) => prev.map((x, idx) => (idx === i ? { ...x, model: m, port: defaultPort } : x)))
                  }}
                >
                  <option value="">Select device</option>
                  {modelsForVendor.map((m) => (
                    <option key={m.model} value={m.model}>{m.model} ({m.kind})</option>
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
    const ep = activeEps[i]
    const wf = workflows.find((w) => w.id === wfByEp[i])
    const list = epParams[i] ?? []
    const roleLabel = labelOfIdx(i)

    return (
      <div key={i} className="border border-line rounded-lg overflow-hidden bg-white shadow-2xs">
        <div className="px-4 py-3 bg-plane/60 border-b border-line flex flex-col gap-2.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink-1 text-[13.5px]">
                Device {i + 1}: {ep?.model || 'Device'}
              </span>
              <Badge tone={i === 0 ? 'info' : 'none'} className="!text-[11px]">{roleLabel}</Badge>
              {ep?.vendor && <Badge tone="none" className="!text-[11px]">{VENDOR_LABEL[ep.vendor as Vendor] ?? ep.vendor}</Badge>}
            </div>
            {wf && (
              <Badge tone="good" className="!text-[10.5px]">
                Active Workflow: {wf.name} ({wf.id})
              </Badge>
            )}
          </div>

          {/* Clean 3-item specification strip: Vendor, Model, Role */}
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3 p-2.5 rounded-md bg-white border border-line-soft text-[12px]">
            <div>
              <span className="text-[11px] text-ink-3">Hardware Vendor:</span>
              <span className="font-semibold text-ink-1 ml-1.5">{VENDOR_LABEL[ep?.vendor as Vendor] ?? ep?.vendor ?? '—'}</span>
            </div>
            <div>
              <span className="text-[11px] text-ink-3">Device Model:</span>
              <Mono className="font-semibold text-ink-1 ml-1.5">{ep?.model || '—'}</Mono>
            </div>
            <div>
              <span className="text-[11px] text-ink-3">Endpoint Role:</span>
              <span className="font-semibold text-ink-1 ml-1.5">{roleLabel}</span>
            </div>
          </div>
        </div>

        {/* Demanded Parameters table/grid */}
        <div className="p-4">
          <div className="text-[12.5px] font-semibold text-ink-2 mb-3">
            Parameters Demanded by Workflow ({list.length} parameter{list.length === 1 ? '' : 's'})
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
                  <Field key={p.name} label={label} tooltip={origin.hint || 'Auto-derived from topology'}>
                    <TextInput readOnly value={p.value} placeholder="Derived from topology" className="bg-plane font-mono text-ink-3" />
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
                No parameters demanded by this template.
              </div>
            )}
          </div>
        </div>
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
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
            )}

            {/* ---- 2 source, destinations & workflow ---- */}
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-[12.5px] text-ink-2">
                    {single
                      ? 'Single-ended topology: provisions one source endpoint (A-end).'
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

              {/* ========================================================================= */}
              {/* PER-DEVICE TERMINATION, WORKFLOW & PARAMETER CONFIGURATION                */}
              {/* ========================================================================= */}
              <div className="flex flex-col gap-4">
                {/* Section Header with Device Tabs & Sync Toggle */}
                <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-3.5 rounded-lg border border-line">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-brand-50 border border-brand-200 grid place-items-center text-brand-700">
                      <Server size={17} />
                    </div>
                    <div>
                      <div className="text-[13.5px] font-semibold text-ink-1 flex items-center gap-2">
                        <span>Device Topology &amp; Operational Workflows</span>
                        <Badge tone="info" className="!text-[10px]">
                          {selectedService.endpoints.length} Device{selectedService.endpoints.length === 1 ? '' : 's'}
                        </Badge>
                      </div>
                      <div className="text-[11.5px] text-ink-3">
                        Each device terminates its own vendor-matched workflow and parameter policies for {requestIntent}.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* View Switcher Tabs */}
                    <div className="inline-flex rounded-md border border-line p-0.5 bg-plane/50 text-[11.5px]">
                      <button
                        type="button"
                        onClick={() => setActiveDeviceTab('all')}
                        className={`px-2.5 py-1 rounded transition-colors ${
                          activeDeviceTab === 'all'
                            ? 'bg-white shadow-xs font-semibold text-brand-700'
                            : 'text-ink-2 hover:text-ink-1'
                        }`}
                      >
                        All Devices ({selectedService.endpoints.length})
                      </button>
                      {selectedService.endpoints.map((ep, idx) => (
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() => setActiveDeviceTab(idx)}
                          className={`px-2.5 py-1 rounded transition-colors ${
                            activeDeviceTab === idx
                              ? 'bg-white shadow-xs font-semibold text-brand-700'
                              : 'text-ink-2 hover:text-ink-1'
                          }`}
                        >
                          Device {idx + 1}: {ep.deviceName || ep.siteCode}
                        </button>
                      ))}
                    </div>

                    {/* Bandwidth Sync Checkbox for Modify */}
                    {requestIntent === 'Modify' && (
                      <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2 cursor-pointer bg-plane/40 px-2.5 py-1 rounded border border-line hover:bg-plane">
                        <input
                          type="checkbox"
                          checked={syncCommonParams}
                          onChange={(e) => setSyncCommonParams(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-line text-brand-600 focus:ring-brand-500 cursor-pointer"
                        />
                        <Link2 size={12} className={syncCommonParams ? 'text-brand-600' : 'text-ink-3'} />
                        <span>Sync Bandwidth across devices</span>
                      </label>
                    )}
                  </div>
                </div>

                {/* Device Cards */}
                {selectedService.endpoints.map((ep, epIdx) => {
                  if (activeDeviceTab !== 'all' && activeDeviceTab !== epIdx) return null

                  const roleLabel = epIdx === 0 ? 'Source (A-end)' : epIdx === 1 ? 'Destination (Z-end)' : ep.role
                  const deviceModel = DEVICE_MODELS.find((d) => d.model === ep.deviceName || d.ports.includes(ep.port))
                  const candidates = candidatesForEndpoint(ep)
                  const chosenWf = getSelectedWfForEndpoint(epIdx)
                  const epParamsList = getParamsForEndpoint(epIdx)
                  const epVals = day2ParamValuesByEp[epIdx] || {}
                  const epEnabled = day2EnabledParamsByEp[epIdx] || {}

                  return (
                    <Card key={ep.id} className="border-brand-100 shadow-xs">
                      {/* 1. Device Header */}
                      <CardHead
                        title={
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[14.5px] font-semibold text-ink-1">
                              Device {epIdx + 1}: {ep.deviceName}
                            </span>
                            <Badge tone={epIdx === 0 ? 'info' : 'none'} className="!text-[11px]">
                              {roleLabel}
                            </Badge>
                            <Badge tone="none" className="!text-[11px]">
                              {VENDOR_LABEL[ep.vendor] ?? ep.vendor}
                            </Badge>
                            <Badge tone="none" className="!text-[11px]">
                              {deviceModel?.kind ?? 'Router'}
                            </Badge>
                            <Badge tone="good" dot className="!text-[10px]">
                              Up (Active)
                            </Badge>
                          </div>
                        }
                        sub={`Endpoint ${ep.id} · ${roleLabel}`}
                        right={
                          chosenWf && (
                            <Badge tone="good" className="!text-[10px]">
                              Active: {chosenWf.name} ({chosenWf.id})
                            </Badge>
                          )
                        }
                      />

                      <CardBody className="flex flex-col gap-4">
                        {/* Device Specifications: Vendor, Model, Role */}
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 p-3.5 rounded-lg bg-plane/50 border border-line-soft text-[12.5px]">
                          <div>
                            <div className="text-[11px] font-medium text-ink-3">Hardware Vendor</div>
                            <div className="font-semibold text-ink-1 text-[13.5px] mt-0.5">{VENDOR_LABEL[ep.vendor] ?? ep.vendor}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium text-ink-3">Device Model</div>
                            <Mono className="font-semibold text-ink-1 text-[13.5px] mt-0.5 block">{ep.deviceName}</Mono>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium text-ink-3">Endpoint Role</div>
                            <div className="font-semibold text-ink-1 text-[13.5px] mt-0.5">{roleLabel}</div>
                          </div>
                        </div>

                        {/* 2. Workflow Template Selection for THIS Device via Dropdown */}
                        <div className="flex flex-col gap-2.5 pt-2 border-t border-line-soft">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div>
                              <div className="text-[12.5px] font-semibold text-ink-1 flex items-center gap-1.5">
                                <WorkflowIcon size={14} className="text-brand-600" />
                                <span>Workflow Template for Device {epIdx + 1} ({ep.deviceName})</span>
                                <Badge tone="none" className="!text-[10px]">{VENDOR_LABEL[ep.vendor] ?? ep.vendor}</Badge>
                              </div>
                              <div className="text-[11.5px] text-ink-3">
                                Select operational workflow template matching vendor <b>{VENDOR_LABEL[ep.vendor] ?? ep.vendor}</b>, category <b>{selectedService.category}</b>, and operation <b>{requestIntent}</b>:
                              </div>
                            </div>
                            {chosenWf && (
                              <Badge tone="good" className="!text-[10px]">
                                Active: {chosenWf.name} ({chosenWf.id}) · {chosenWf.firstPassRate}% FPR
                              </Badge>
                            )}
                          </div>

                          {/* Dropdown to select workflow */}
                          {candidates.length === 0 ? (
                            <Note tone="crit">
                              No operational workflow templates found for vendor {VENDOR_LABEL[ep.vendor] ?? ep.vendor} and operation {requestIntent}.
                            </Note>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Select
                                value={day2WfByEp[epIdx] || ''}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setDay2WfByEp((p) => ({ ...p, [epIdx]: val }))
                                }}
                                className="w-full text-[13px]"
                              >
                                <option value="">Select workflow template for {ep.deviceName}...</option>
                                {candidates.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.name} ({w.id}) · {w.tasks.length} tasks · {w.firstPassRate}% FPR
                                  </option>
                                ))}
                              </Select>
                            </div>
                          )}

                          {!chosenWf && candidates.length > 0 && (
                            <Note tone="crit">
                              Please select an operational workflow for Device {epIdx + 1} ({ep.deviceName}) from the dropdown above to continue.
                            </Note>
                          )}
                        </div>

                        {/* 3. Parameters demanded by THIS Device's Workflow */}
                        <div className="flex flex-col gap-3 pt-2 border-t border-line-soft">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="text-[12.5px] font-semibold text-ink-1 flex items-center gap-1.5">
                              <Sliders size={14} className="text-brand-600" />
                              <span>
                                {chosenWf
                                  ? `${ep.deviceName} Parameters & Values (${chosenWf.name})`
                                  : `${ep.deviceName} Parameters & Values`}
                              </span>
                            </div>
                            {chosenWf && (
                              <div className="flex items-center gap-2">
                                <Badge tone="info" className="!text-[10px]">
                                  {epParamsList.filter((p) => p.modifiable).length} Modifiable · {epParamsList.filter((p) => !p.modifiable).length} Bound
                                </Badge>
                              </div>
                            )}
                          </div>

                          {!chosenWf ? (
                            <div className="p-5 text-center border border-dashed border-line rounded-lg bg-plane/20">
                              <WorkflowIcon size={24} className="mx-auto text-ink-3 mb-1.5" />
                              <div className="text-[12.5px] font-medium text-ink-2">No Workflow Template Selected for {ep.deviceName}</div>
                              <div className="text-[11.5px] text-ink-3 mt-0.5">
                                Select an operational workflow template above to view and configure the parameters demanded on this device.
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* Workflow demands banner */}
                              <div className="flex items-center justify-between gap-3 bg-brand-50/50 border border-brand-200 p-2.5 rounded-lg text-[12px]">
                                <div className="flex items-center gap-2 text-brand-900">
                                  <CheckCircle2 size={15} className="text-brand-600 shrink-0" />
                                  <span>
                                    Active on <b>{ep.deviceName}</b>: <b>{chosenWf.name}</b> · Demands: <b>{epParamsList.map((p) => p.name).join(', ')}</b>.
                                  </span>
                                </div>
                                <Badge tone="info" className="!text-[10px] shrink-0">
                                  Device {epIdx + 1}
                                </Badge>
                              </div>

                              {/* Parameter Table for Modify */}
                              {requestIntent === 'Modify' && (
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
                                      {epParamsList.map((p) => {
                                        const isChecked = !!epEnabled[p.name]
                                        const currentVal = p.current
                                        const rawInput = epVals[p.name] ?? (p.isBandwidth ? String(selectedService.bandwidthMbps) : p.current)
                                        const isBw = p.isBandwidth

                                        // Determine delta badge
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
                                            const rawStr = String(rawInput ?? '')
                                            if (rawStr.trim() && rawStr.trim() !== currentVal) {
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
                                            {/* Checkbox */}
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
                                                  onChange={() => handleEpToggleParam(epIdx, p.name)}
                                                  className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500 cursor-pointer"
                                                  title={`Toggle modification for ${p.name}`}
                                                />
                                              )}
                                            </td>

                                            {/* Name */}
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

                                            {/* Current Value */}
                                            <td className="px-3.5 py-2.5 font-mono text-ink-2 bg-plane/30">
                                              <Mono className="px-2 py-0.5 rounded bg-slate-100 border border-line-soft font-semibold">
                                                {currentVal}
                                              </Mono>
                                            </td>

                                            {/* Requested Value */}
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
                                                          onChange={(e) => handleEpParamChange(epIdx, 'Bandwidth', e.target.value)}
                                                          className="w-full px-2.5 py-1.5 border border-brand-300 rounded font-mono text-[13px] bg-white outline-none focus:ring-2 focus:ring-brand-200"
                                                          placeholder="Enter CIR in Mbps..."
                                                        />
                                                        <span className="text-[12px] text-ink-3 font-medium">Mbps</span>
                                                      </div>
                                                      <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                                        <button
                                                          type="button"
                                                          onClick={() => handleEpParamChange(epIdx, 'Bandwidth', String(selectedService.bandwidthMbps + 50))}
                                                          className="text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-line hover:border-brand-300 hover:text-brand-700"
                                                        >
                                                          +50M
                                                        </button>
                                                        <button
                                                          type="button"
                                                          onClick={() => handleEpParamChange(epIdx, 'Bandwidth', String(selectedService.bandwidthMbps + 100))}
                                                          className="text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-line hover:border-brand-300 hover:text-brand-700"
                                                        >
                                                          +100M
                                                        </button>
                                                        <button
                                                          type="button"
                                                          onClick={() => handleEpParamChange(epIdx, 'Bandwidth', String(selectedService.bandwidthMbps * 2))}
                                                          className="text-[10.5px] px-1.5 py-0.5 rounded bg-white border border-line hover:border-brand-300 hover:text-brand-700"
                                                        >
                                                          2× ({selectedService.bandwidthMbps * 2}M)
                                                        </button>
                                                        <button
                                                          type="button"
                                                          onClick={() => handleEpParamChange(epIdx, 'Bandwidth', '1000')}
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
                                                        onChange={(e) => handleEpParamChange(epIdx, 'Burst size', e.target.value)}
                                                        className="w-full px-2.5 py-1.5 border border-brand-300 rounded font-mono text-[12.5px] bg-white outline-none focus:ring-2 focus:ring-brand-200"
                                                        placeholder="e.g. 625 KB, 1250 KB..."
                                                      />
                                                      <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                                        {['625 KB', '1250 KB', '2500 KB', '5000 KB'].map((b) => (
                                                          <button
                                                            key={b}
                                                            type="button"
                                                            onClick={() => handleEpParamChange(epIdx, 'Burst size', b)}
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
                                                      onChange={(e) => handleEpParamChange(epIdx, 'Policer action', e.target.value)}
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
                                                      onChange={(e) => handleEpParamChange(epIdx, p.name, e.target.value)}
                                                      className="w-full px-2.5 py-1.5 border border-brand-300 rounded font-mono text-[12.5px] bg-white outline-none focus:ring-2 focus:ring-brand-200"
                                                      placeholder={`Enter new ${p.name}...`}
                                                    />
                                                  )}
                                                </div>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => handleEpToggleParam(epIdx, p.name)}
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
                              )}

                              {/* Parameter Grid for Other Operations (Suspend, Resume, Cease, Re-prove) */}
                              {requestIntent !== 'Modify' && (
                                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                                  {epParamsList.map((p) => (
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
                              )}
                            </>
                          )}
                        </div>
                      </CardBody>
                    </Card>
                  )
                })}

                {/* Combined Review of Parameter Changes (for Modify) */}
                {requestIntent === 'Modify' && changedParamsSummary.length > 0 && (
                  <div className="border border-brand-200 bg-brand-50/40 rounded-lg p-4 flex flex-col gap-2.5">
                    <div className="text-[12.5px] font-semibold text-brand-900 flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-brand-600" />
                      <span>Review of requested parameter changes across devices ({changedParamsSummary.length}):</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {changedParamsSummary.map((c, idx) => (
                        <div key={`${c.epIdx}-${c.name}-${idx}`} className="p-2.5 rounded border border-brand-200 bg-white text-[12px] shadow-xs">
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-semibold text-ink-1">{c.name}</span>
                            <Badge tone="info" className="!text-[9.5px]">
                              {c.epName} ({VENDOR_LABEL[c.vendor as Vendor] ?? c.vendor})
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5 font-mono text-[11.5px]">
                            <span className="text-ink-3 line-through">{c.current}</span>
                            <span className="text-brand-600 font-bold">➔ {c.requested}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

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
