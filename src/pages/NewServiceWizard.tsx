import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, PlayCircle, Plus, Save, Trash2,
} from 'lucide-react'
import { useStore, type WizardDraft } from '@/store/useStore'
import { ACCOUNTS, DEVICE_MODELS, SITES, modelsForCategory } from '@/data/catalog'
import { bindEndpoints } from '@/data/orders'
import { workflowParams } from '@/data/templates'
import type { Category, Domain, EndpointRole, OrderParamValue } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, Field, KV, Mono, Note, PageHead,
  Select, Stepper, TextInput, Toggle,
} from '@/components/ui'
import { CATEGORY_TONE } from '@/lib/format'

const STEPS = [
  'Category & type', 'Source, destination & workflow', 'Parameters & values', 'Preview & validate', 'Planned',
]

interface EndpointDraft { role: 'A' | 'Z' | 'hub' | 'spoke'; siteCode: string; port: string }

const roleOfIdx = (i: number): EndpointRole => (i === 0 ? 'Source' : 'Destination')
const mgmtIpFor = (i: number) => `172.31.33.${20 + i * 80}`

/**
 * How a parameter's starting value was arrived at, and whether the operator can
 * take it from there. Only `derived` is locked: Interface and Neighbor IP are
 * the port picked in Step 2 and the far end's address, so a value typed here
 * would contradict the endpoint the request is actually reserving. Everything
 * else — including pool allocations — is a starting point, not a decision: the
 * pool offers the next free VLAN or circuit ID, and the operator overrides it
 * per endpoint when the estate needs something specific.
 */
const PARAM_ORIGIN: Record<string, { badge: string; hint: string; locked?: boolean }> = {
  pool: { badge: 'from pool', hint: 'Pre-filled with the next free value — change it if this device needs a different one.' },
  derived: { badge: 'derived', hint: 'Comes from the site and port chosen for this endpoint in Step 2.', locked: true },
  template: { badge: 'default', hint: 'Template default — change it for this endpoint only.' },
  user: { badge: '', hint: 'Rendered into this endpoint\'s commands only.' },
}

const DOMAIN_HINT: Record<Domain, string> = {
  Transport: 'Router/switch network services.',
  Access: 'Customer-premises device provisioning.',
  Radio: 'Point-to-point microwave backhaul link provisioning.',
  Fiber: 'DWDM wavelength circuit provisioning over optical transport.',
}
/* Radio's other category, RAN VNF, has its own subtype vocab — and CU vs DU
   don't even share one with each other — so it's handled separately below
   rather than folded into this domain-level map. */
const DOMAIN_SUBTYPES: Record<Domain, string[]> = {
  Transport: ['Tagged', 'Untagged', 'BGP', 'Static', 'OSPF', 'VRF', 'Other'],
  Access: ['FTTH', 'DSL', 'Other'],
  Radio: ['All-IP', 'Hybrid', 'E-band'],
  Fiber: ['Unprotected', 'Protected'],
}
const DOMAIN_PORT_LABEL: Record<Domain, string> = {
  Transport: 'Router port', Access: 'CPE port', Radio: 'Radio port', Fiber: 'Optical port',
}
function subtypeOptions(domain: Domain, category: Category, type: string): string[] {
  if (category === 'RAN VNF') return type === 'DU' ? ['Indoor', 'Outdoor'] : ['Standalone', 'Non-Standalone']
  return DOMAIN_SUBTYPES[domain]
}

/** Re-key an index-keyed map after the endpoint at `removed` is dropped. */
function reindex<T>(map: Record<number, T>, removed: number): Record<number, T> {
  const out: Record<number, T> = {}
  Object.entries(map).forEach(([k, v]) => {
    const i = Number(k)
    if (i === removed) return
    out[i > removed ? i - 1 : i] = v
  })
  return out
}

export default function NewServiceWizard() {
  const nav = useNavigate()
  const intents = useStore((s) => s.intents)
  const workflows = useStore((s) => s.workflows)
  const pools = useStore((s) => s.pools)
  const createOrder = useStore((s) => s.createOrder)

  const [step, setStep] = useState(0)
  const [domain, setDomain] = useState<Domain>('Transport')
  const [category, setCategory] = useState<Category>('L2VPN')
  const [intentId, setIntentId] = useState('INT-L2-P2P')
  const [subtype, setSubtype] = useState('Tagged')
  const [accountId, setAccountId] = useState(ACCOUNTS[0].id)
  const [name, setName] = useState('')
  const [eps, setEps] = useState<EndpointDraft[]>([
    { role: 'A', siteCode: SITES[0].code, port: DEVICE_MODELS[2].ports[0] },
    { role: 'Z', siteCode: SITES[1].code, port: DEVICE_MODELS[2].ports[2] },
  ])
  /** One template per ENDPOINT, not per role — every destination picks its own. */
  const [wfByEp, setWfByEp] = useState<Record<number, string>>({})
  /** Per-endpoint parameter values: endpoint index → parameter name → value. */
  const [valsByEp, setValsByEp] = useState<Record<number, Record<string, string>>>({})
  /** Service-level settings from the intent — the defaults each endpoint starts from. */
  const [svc, setSvc] = useState<Record<string, string>>({})
  const [createdId, setCreatedId] = useState<string | null>(null)
  /* Collapse is per step: an endpoint folded away on Step 2 because its devices
     are settled shouldn't also hide its parameter fields on Step 3. */
  const [shut2, setShut2] = useState<Record<number, boolean>>({})
  const [shut3, setShut3] = useState<Record<number, boolean>>({})
  const [shutSvc, setShutSvc] = useState(false)
  const toggle = (set: typeof setShut2, i: number) => set((p) => ({ ...p, [i]: !p[i] }))

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

  /* A single-ended intent (CPE activation, a RAN VNF) provisions one device and
     has no far end; everything else terminates on a source plus one or more
     destinations, which the operator adds and removes below. */
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
  const vendorOfIdx = (i: number) => DEVICE_MODELS.find((d) => d.ports.includes(activeEps[i]?.port ?? ''))?.vendor
  const candidatesForIdx = (i: number) => {
    const role = roleOfIdx(i)
    const v = vendorOfIdx(i)
    return workflows.filter((w) => w.intentId === intentId && w.state === 'Active'
      && (w.endpointRole === role || !w.endpointRole) && (!v || w.vendor === v))
  }

  /* Preselect the best-performing active template per endpoint, keeping any
     choice the operator already made that is still valid for that endpoint's
     vendor — adding a destination must not silently reshuffle the others. */
  const portSig = activeEps.map((e) => e.port).join('|')
  /* Site drives the derived values (description, VRF name), port drives the
     vendor match — the bound-endpoint memo has to see both change. */
  const epSig = activeEps.map((e) => `${e.siteCode}@${e.port}`).join('|')
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

  /* Service-level settings: the intent's own parameters, which describe the
     circuit rather than either end of it. Pool-backed ones are allocated once
     and must be identical everywhere, or the circuit simply will not come up. */
  const svcParams: OrderParamValue[] = useMemo(() => intent.params.map((p) => {
    if (p.fromPool) {
      const pool = pools.find((x) => x.kind === p.fromPool)
      const free = pool?.entries.find((e) => e.state === 'Free')
      return { name: p.name, value: svc[p.name] ?? free?.value ?? '—', source: 'pool' as const }
    }
    if (svc[p.name] !== undefined) return { name: p.name, value: svc[p.name], source: 'user' as const }
    if (p.default !== undefined) return { name: p.name, value: String(p.default), source: 'template' as const }
    return { name: p.name, value: '', source: 'user' as const }
  }), [intent, svc, pools])

  const overArity = intent.topology === 'Two-ended' && endpointCount > 2
  const sitesDistinct = new Set(activeEps.map((e) => e.siteCode)).size === activeEps.length
  const endpointsOk = activeEps.every((e) => e.siteCode && e.port) && (single || sitesDistinct)
  const workflowsOk = activeEps.every((_, i) => !!wfByEp[i])

  /* The derived and pool-allocated values each endpoint's template will render
     — the same function `createOrder` runs on submit, so what Step 3 shows is
     what the device is actually sent, not a parallel guess at it. */
  const boundEps = useMemo(() => {
    if (!endpointsOk) return []
    const draftEps = activeEps.map((e, i) => {
      const dm = DEVICE_MODELS.find((d) => d.ports.includes(e.port)) ?? DEVICE_MODELS[0]
      return {
        id: `EP-W${i}`, role: e.role, siteCode: e.siteCode, deviceName: dm.model,
        vendor: dm.vendor, mgmtIp: mgmtIpFor(i), port: e.port,
      }
    })
    const bw = Number(svcParams.find((p) => p.name === 'bandwidth_mbps')?.value ?? 100)
    return bindEndpoints(draftEps, category, intent.type, subtype, workflows, svcParams, bw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epSig, endpointCount, endpointsOk, category, intent.type, subtype, workflows, svcParams])

  /**
   * The parameter set ONE endpoint's chosen template renders, with the value it
   * currently holds. The names come from that template's own tasks, so two
   * endpoints running different templates genuinely list different parameters —
   * and each keeps its own value for the ones they share.
   */
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

  const addDestination = () => setEps((prev) => {
    const free = SITES.find((s) => !prev.some((p) => p.siteCode === s.code)) ?? SITES[0]
    return [...prev, { role: star ? 'spoke' : 'Z', siteCode: free.code, port: portsPool[0].ports[0] }]
  })
  const removeEndpoint = (i: number) => {
    setEps((prev) => prev.filter((_, x) => x !== i))
    setWfByEp((prev) => reindex(prev, i))
    setValsByEp((prev) => reindex(prev, i))
  }

  const problems: string[] = []
  if (!endpointsOk) {
    problems.push(!sitesDistinct && !single
      ? 'Every endpoint must sit on a different site.'
      : `This intent needs ${intent.endpointArity} endpoint(s), all with a site and a port.`)
  }
  if (!workflowsOk) {
    const missing = activeEps.map((_, i) => i).filter((i) => !wfByEp[i]).map(labelOfIdx)
    problems.push(`No workflow template selected for ${missing.join(' and ')}.`)
  }
  if (!svcOk) problems.push('Every service setting needs a value before the request can be submitted.')
  if (!epValuesOk) problems.push('Every endpoint needs a value for each parameter its template renders.')

  const canNext = () => {
    if (step === 0) return !!intentId && !!accountId
    if (step === 1) return endpointsOk && workflowsOk
    if (step === 2) return valuesOk
    if (step === 3) return problems.length === 0
    return true
  }

  const submit = () => {
    const acct = ACCOUNTS.find((a) => a.id === accountId)!
    const draft: WizardDraft = {
      category, type: intent.type, subtype,
      accountId: acct.id, accountName: acct.name,
      name: name || `${intent.name}`,
      intentId, workflowId: wfByEp[0] ?? '',
      endpoints: activeEps.map((e, i) => {
        const dm = DEVICE_MODELS.find((d) => d.ports.includes(e.port)) ?? DEVICE_MODELS[0]
        return {
          role: e.role, siteCode: e.siteCode, deviceName: dm.model, vendor: dm.vendor,
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

  /**
   * The template chooser for one endpoint. Laid out as a wide grid under that
   * endpoint's device fields rather than beside them — a scrolling column of
   * templates next to three short inputs leaves most of the card empty, and
   * with a destination per site there can be a lot of those cards.
   */
  const workflowPicker = (i: number) => {
    const candidates = candidatesForIdx(i)
    const chosen = wfByEp[i]
    return (
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">Workflow template</div>
          {vendorOfIdx(i) && <Badge tone="none">{vendorOfIdx(i)}</Badge>}
          <span className="text-[11px] text-ink-3">{candidates.length} available for this vendor</span>
        </div>
        {candidates.length === 0 && (
          <Note tone="crit" className="!py-2 !px-2.5 text-[12px]">No active workflow matches this vendor for {intent.name}.</Note>
        )}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 max-h-[168px] overflow-y-auto">
          {candidates.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWfByEp({ ...wfByEp, [i]: w.id })}
              className={`text-left border rounded-md px-3 py-2 transition-colors h-fit
                ${chosen === w.id ? 'border-brand-500 bg-brand-50 ring-[2px] ring-brand-100' : 'border-line hover:bg-plane'}`}
            >
              <div className="text-[12px] font-medium truncate" title={w.name}>{w.name}</div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Mono className="text-[10.5px] text-ink-3">{w.model}</Mono>
                <Badge tone={w.firstPassRate >= 80 ? 'good' : 'warn'} className="!text-[10px] !py-0">{w.firstPassRate}% first-pass</Badge>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  /** Shared collapsible header used by the endpoint cards on Steps 2 and 3. */
  const sectionHead = (open: boolean, onToggle: () => void, left: ReactNode, right?: ReactNode) => (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-plane/50 border-b border-line-soft">
      <button type="button" onClick={onToggle}
        className="flex items-center gap-2 min-w-0 text-left flex-1 rounded
          focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
        aria-expanded={open}>
        {open ? <ChevronDown size={15} className="text-ink-3 shrink-0" /> : <ChevronRight size={15} className="text-ink-3 shrink-0" />}
        {left}
      </button>
      {right}
    </div>
  )

  /** One endpoint's parameter card on Step 3 — its own template, its own values. */
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
              {activeEps[i]?.siteCode} · {wf ? wf.name : 'no template selected'}
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
                  <Field key={p.name} label={label} hint={origin.hint}>
                    <TextInput readOnly value={p.value} className="bg-plane font-mono text-ink-3" />
                  </Field>
                )
              }
              return (
                <Field key={p.name} label={label} required hint={origin.hint}>
                  <TextInput
                    className="font-mono"
                    value={p.value}
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
        title="New network service"
        sub="Five steps from category to a planned service. Pre-validation runs automatically once the request is created."
        actions={<Button onClick={() => nav('/requests')}>Cancel</Button>}
      />

      <Card>
        <CardBody className="pb-4"><Stepper steps={STEPS} current={step} /></CardBody>
      </Card>

      {/* Plain vw-card-section, not <Card> — Card clips with overflow-hidden,
         which breaks the footer's position:sticky. Content scrolls with the
         page as normal; only the footer pins to the viewport bottom. */}
      <div className="vw-card-section p-0 flex flex-col">
        <CardHead title={`Step ${Math.min(step + 1, 5)} · ${STEPS[step]}`} sub={
          step === 0 ? 'Choose the service category and the intent it is built from.'
            : step === 1 ? 'Pick the devices this service terminates on, and the template that runs on each.'
              : step === 2 ? 'Each endpoint runs its own template, so each one gets its own parameter values.'
                : step === 3 ? 'Everything is validated before submission.'
                  : 'The service exists and pre-validation has been triggered.'
        } />
        <CardBody>

          {/* ---- 1 category & type ---- */}
          {step === 0 && (
            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Domain" required hint={DOMAIN_HINT[domain]}>
                  <Select value={domain} onChange={(e) => setDomainCascade(e.target.value as Domain)}>
                    {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
                <Field label="Service category" required>
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
                <Field label="Type" required hint={`${intent.topology} · ${intent.endpointArity}`}>
                  <Select value={intentId} onChange={(e) => {
                    const next = e.target.value
                    setIntentId(next)
                    const nextType = intents.find((i) => i.id === next)?.type ?? intent.type
                    setSubtype(subtypeOptions(domain, category, nextType)[0])
                  }}>
                    {catIntents.map((i) => <option key={i.id} value={i.id}>{i.type} — {i.name}</option>)}
                  </Select>
                </Field>
                <Field label="Catalog subtype">
                  <Select value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                    {subtypeOptions(domain, category, intent.type).map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
                <Field label="Customer" required hint="A reference to the account master, not free text.">
                  <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    {ACCOUNTS.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.id}</option>)}
                  </Select>
                </Field>
                <Field label="Network service name" hint="Leave blank to use the intent name.">
                  <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={intent.name} maxLength={100} />
                </Field>
              </div>

              <div className="border border-line rounded-lg p-4 bg-plane/50 flex flex-col gap-4 h-fit">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3 mb-1.5">This intent</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone={CATEGORY_TONE[category]}>{category}</Badge>
                    <span className="text-[13.5px] font-semibold text-ink-1">{intent.name}</span>
                  </div>
                  <div className="text-[12px] text-ink-3 mt-1.5">{intent.topology} topology · {intent.endpointArity} endpoint(s)</div>
                </div>
                <div className="h-px bg-line-soft" />
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3 mb-1.5">Resource pools used</div>
                  <div className="flex flex-wrap gap-1.5">
                    {intent.pools.map((p) => <Badge key={p} tone="info">{p}</Badge>)}
                  </div>
                </div>
                <div className="h-px bg-line-soft" />
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3 mb-1.5">Acceptance criteria · {intent.acceptance.length}</div>
                  <div className="flex flex-col gap-1.5">
                    {(['device', 'network', 'service'] as const).map((layer) => {
                      const n = intent.acceptance.filter((a) => a.layer === layer).length
                      if (!n) return null
                      return (
                        <div key={layer} className="flex items-center justify-between text-[12px]">
                          <span className="text-ink-2 capitalize">{layer} layer</span>
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
              {activeEps.map((e, i) => {
                const open = !shut2[i]
                const wf = workflows.find((w) => w.id === wfByEp[i])
                return (
                  <div key={i} className="border border-line rounded-lg overflow-hidden">
                    {sectionHead(open, () => toggle(setShut2, i),
                      <>
                        <Badge tone={i === 0 ? 'info' : 'none'}>{labelOfIdx(i)}</Badge>
                        <span className="text-[12px] text-ink-3 truncate">
                          {open ? 'runs its own template' : `${e.siteCode} · ${e.port} · ${wf ? wf.name : 'no template selected'}`}
                        </span>
                      </>,
                      /* A source is mandatory, and a service needs at least one
                         far end — only destinations beyond the first can go. */
                      !single && i > 1 ? (
                        <Button size="sm" variant="danger" onClick={() => removeEndpoint(i)}>
                          <Trash2 size={14} />Remove
                        </Button>
                      ) : undefined,
                    )}
                    {open && (
                      <div className="p-4 flex flex-col gap-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <Field label="Site" required>
                            <Select value={e.siteCode} onChange={(ev) => {
                              const next = [...eps]; next[i] = { ...e, siteCode: ev.target.value }; setEps(next)
                            }}>
                              {SITES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.city}</option>)}
                            </Select>
                          </Field>
                          <Field label={DOMAIN_PORT_LABEL[domain]} required>
                            <Select value={e.port} onChange={(ev) => {
                              const next = [...eps]; next[i] = { ...e, port: ev.target.value }; setEps(next)
                            }}>
                              {portsPool.flatMap((d) => d.ports).map((p) => <option key={p} value={p}>{p}</option>)}
                            </Select>
                          </Field>
                          <Field label="Management IP" hint="Derived from the site and port you chose.">
                            <TextInput readOnly value={mgmtIpFor(i)} className="bg-plane text-ink-3" />
                          </Field>
                        </div>
                        {workflowPicker(i)}
                      </div>
                    )}
                  </div>
                )
              })}

              {!single && (
                <div>
                  <Button size="sm" onClick={addDestination}>
                    <Plus size={14} />Add destination
                  </Button>
                </div>
              )}
              {/* Star and full-mesh intents are built for many far ends; a
                 two-ended one is not. Adding anyway is allowed — the operator
                 knows the estate — but the mismatch is surfaced rather than
                 quietly accepted. */}
              {overArity && (
                <Note tone="warn">
                  <b>{intent.name}</b> is a {intent.topology.toLowerCase()} intent — it expects {intent.endpointArity} endpoint(s),
                  and this request now has {endpointCount}. A multipoint intent models extra far ends properly; carry on if the
                  estate really does terminate this service on all of them.
                </Note>
              )}
              {!endpointsOk && <Note tone="warn">{problems[0]}</Note>}

              <div className="border border-line rounded-lg p-4 bg-plane/50">
                <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3 mb-2.5">Request so far</div>
                <KV items={[
                  ['Category', <Badge key="c" tone={CATEGORY_TONE[category]}>{category}</Badge>],
                  ['Intent', intent.name],
                  ['Subtype', subtype],
                  ['Customer', ACCOUNTS.find((a) => a.id === accountId)?.name ?? '—'],
                  ['Endpoints', single ? '1 device' : `1 source · ${endpointCount - 1} destination(s)`],
                  ['Service name', name || <span className="text-ink-3">{intent.name} (default)</span>],
                ]} />
              </div>
            </div>
          )}

          {/* ---- 3 parameters & values ---- */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <div className="border border-line rounded-lg overflow-hidden">
                {sectionHead(!shutSvc, () => setShutSvc((v) => !v),
                  <>
                    <span className="text-[12.5px] font-semibold">Service design defaults</span>
                    <span className="text-[12px] text-ink-3 truncate">
                      {shutSvc
                        ? svcParams.map((p) => `${p.name} ${p.value}`).join(' · ')
                        : 'optional — these only pre-fill the endpoints below'}
                    </span>
                  </>,
                )}
                {!shutSvc && (
                <div className="p-4">
                <Note className="mb-3.5">
                  {intent.name} describes the circuit as a whole, and these are the values it starts every endpoint
                  from — the VLAN and circuit ID come off the resource pools, the rest are the intent's own defaults.
                  <b> Nothing here is final:</b> each endpoint's parameters are edited below, and a value changed
                  there applies to that device alone.
                </Note>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {intent.params.map((p) => {
                    const v = svcParams.find((x) => x.name === p.name)!
                    const modTone = p.modifiable === 'hitless' ? 'good' : p.modifiable === 'bounce' ? 'warn' : 'crit'
                    const label = (
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono">{p.name}</span>
                        <Badge tone={modTone} className="!text-[9.5px] !py-0">{p.modifiable}</Badge>
                      </span>
                    )
                    const hint = `${p.type} · ${p.constraint}`
                    if (p.fromPool) {
                      return (
                        <Field key={p.name} label={label} hint={`Allocated from the ${p.fromPool} pool and held for 72 hours.`}>
                          <div className="flex items-center gap-2">
                            <TextInput readOnly value={v.value} className="bg-plane font-mono" />
                            <Badge tone="info">reserved</Badge>
                          </div>
                        </Field>
                      )
                    }
                    if (p.options) {
                      return (
                        <Field key={p.name} label={label} required={p.required} hint={hint}>
                          <Select value={v.value} onChange={(e) => setSvc({ ...svc, [p.name]: e.target.value })}>
                            {p.options.map((o) => <option key={o}>{o}</option>)}
                          </Select>
                        </Field>
                      )
                    }
                    if (p.type === 'boolean') {
                      return (
                        <div key={p.name} className="pt-6">
                          <Toggle
                            checked={v.value === 'true'}
                            onChange={(on) => setSvc({ ...svc, [p.name]: String(on) })}
                            label={p.name} hint={hint}
                          />
                        </div>
                      )
                    }
                    return (
                      <Field key={p.name} label={label} required={p.required} hint={hint}>
                        <TextInput
                          value={v.value}
                          type={p.type === 'integer' ? 'number' : 'text'}
                          min={p.min} max={p.max}
                          onChange={(e) => setSvc({ ...svc, [p.name]: e.target.value })}
                        />
                      </Field>
                    )
                  })}
                </div>
                </div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">
                  Per-endpoint parameters · {endpointCount} endpoint{endpointCount === 1 ? '' : 's'}
                </div>
                <Note className="mb-3.5">
                  Each endpoint runs its own workflow template, and each template renders its own set of parameters —
                  so the fields below differ per endpoint. Every value is editable and belongs to that device alone:
                  the pool-allocated ones arrive pre-filled but you can type your own, and nothing entered on one
                  endpoint is copied to another. Only Interface and Neighbor IP stay fixed, because they are the port
                  and far end already chosen in Step 2.
                </Note>
                <div className="flex flex-col gap-4">
                  {activeEps.map((_, i) => paramCard(i))}
                </div>
              </div>
            </div>
          )}

          {/* ---- 4 preview ---- */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              {/* One full-width strip rather than a half-width block with an
                 empty column beside it — the service identity is four short
                 facts, not a column's worth of content. */}
              <div className="border border-line rounded-lg bg-plane/40 px-4 py-3.5">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {([
                    ['Name', name || intent.name],
                    ['Category / type', `${category} · ${intent.type} · ${subtype}`],
                    ['Customer', ACCOUNTS.find((a) => a.id === accountId)?.name ?? '—'],
                    ['Endpoints', single ? '1 device' : `1 source · ${endpointCount - 1} destination(s)`],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-1">{k}</div>
                      <div className="text-[13px] font-medium text-ink-1 truncate" title={v}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-3 mb-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">
                    What each endpoint's workflow receives
                  </div>
                  <div className="text-[11px] text-ink-3">Click a card to go back and edit that endpoint</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {activeEps.map((e, i) => {
                    const wf = workflows.find((w) => w.id === wfByEp[i])
                    const list = epParams[i] ?? []
                    const changed = Object.keys(valsByEp[i] ?? {}).length
                    return (
                      /* h-full + flex, with the footer pushed down by mt-auto:
                         templates render different numbers of parameters, and
                         these cards sit side by side, so they have to end level
                         rather than each stopping at its own last row. */
                      <div key={i} className="border border-line rounded-lg overflow-hidden flex flex-col h-full">
                        <button
                          type="button" onClick={() => setStep(1)}
                          title="Edit this endpoint or its workflow"
                          className="w-full text-left px-3.5 py-2.5 border-b border-line-soft bg-plane/50 shrink-0
                            hover:bg-plane transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge tone={i === 0 ? 'info' : 'none'}>{labelOfIdx(i)}</Badge>
                            <Mono className="text-[11px] text-ink-3">{e.siteCode} · {e.port}</Mono>
                          </div>
                          <div className="text-[12px] font-medium mt-1 truncate" title={wf?.name}>
                            {wf ? wf.name : <span className="text-crit-700">no workflow selected</span>}
                          </div>
                        </button>
                        <table className="w-full text-[11.5px] table-fixed">
                          <tbody>
                            {list.map((p) => (
                              <tr key={p.name} className="border-b border-line-soft last:border-0">
                                <td className="w-[44%] px-3 py-1.5 font-mono text-ink-3 truncate" title={p.name}>{p.name}</td>
                                <td className="w-[56%] px-3 py-1.5 font-mono font-medium text-right truncate" title={p.value}>
                                  {p.value || <span className="text-crit-700">missing</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mt-auto px-3 py-1.5 border-t border-line-soft bg-plane/30 text-[11px] text-ink-3">
                          {list.length} parameter{list.length === 1 ? '' : 's'}
                          {changed > 0 ? ` · ${changed} changed from the default` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {problems.length > 0
                ? <Note tone="crit"><b>{problems.length} problem(s) block submission.</b><ul className="list-disc pl-5 mt-1.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>
                : <Note tone="good"><b>Validation passed.</b> Every endpoint sits on a distinct site, is bound to an active workflow, and has a value for every parameter that workflow renders.</Note>}
              <Note>Pre-validation starts automatically the moment this request is created — no separate step needed. Success moves it to <b>Validated</b>, ready for approval; failure moves it to <b>Invalid</b>, back with the requester.</Note>
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
              <Button onClick={() => nav('/requests')}><Save size={15} />Save as draft</Button>
              {step < 3
                ? <Button variant="primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>Next<ArrowRight size={15} /></Button>
                : <Button variant="primary" disabled={!canNext()} onClick={submit}><CheckCircle2 size={15} />Create service</Button>}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
