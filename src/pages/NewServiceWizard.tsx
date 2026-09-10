import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, PlayCircle, Pencil, Save } from 'lucide-react'
import { useStore, type WizardDraft } from '@/store/useStore'
import { ACCOUNTS, DEVICE_MODELS, SITES, modelsForCategory } from '@/data/catalog'
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

const roleOf = (i: number): EndpointRole => (i === 0 ? 'Source' : 'Destination')

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
  /** One chosen workflow per role — Source and Destination devices run different templates. */
  const [workflowByRole, setWorkflowByRole] = useState<Partial<Record<EndpointRole, string>>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [createdId, setCreatedId] = useState<string | null>(null)

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

  const endpointCount = intent.topology === 'Single-ended' ? 1 : intent.topology === 'Two-ended' ? 2 : eps.length
  const roles: EndpointRole[] = intent.topology === 'Single-ended' ? ['Source'] : ['Source', 'Destination']
  const vendorForRole = (role: EndpointRole) => {
    const i = role === 'Source' ? 0 : 1
    return DEVICE_MODELS.find((d) => d.ports.includes(eps[i]?.port ?? ''))?.vendor
  }
  const candidatesFor = (role: EndpointRole) => {
    const v = vendorForRole(role)
    return workflows.filter((w) => w.intentId === intentId && w.state === 'Active'
      && (w.endpointRole === role || !w.endpointRole) && (!v || w.vendor === v))
  }

  /* The best-performing active template for each role is preselected; the
     operator can override either side independently. */
  useEffect(() => {
    const next: Partial<Record<EndpointRole, string>> = {}
    roles.forEach((role) => {
      const best = [...candidatesFor(role)].sort((a, b) => b.firstPassRate - a.firstPassRate)[0]
      if (best) next[role] = best.id
    })
    setWorkflowByRole(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentId, eps[0]?.port, eps[1]?.port])

  /* Parameters come from the intent; pool-backed ones are allocated, not typed. */
  const params: OrderParamValue[] = useMemo(() => intent.params.map((p) => {
    if (p.fromPool) {
      const pool = pools.find((x) => x.kind === p.fromPool)
      const free = pool?.entries.find((e) => e.state === 'Free')
      return { name: p.name, value: values[p.name] ?? free?.value ?? '—', source: 'pool' as const }
    }
    if (values[p.name] !== undefined) return { name: p.name, value: values[p.name], source: 'user' as const }
    if (p.default !== undefined) return { name: p.name, value: String(p.default), source: 'template' as const }
    return { name: p.name, value: '', source: 'user' as const }
  }), [intent, values, pools])

  const endpointsOk = eps.slice(0, endpointCount).every((e) => e.siteCode && e.port)
    && (intent.topology !== 'Two-ended' || (eps[0].siteCode !== eps[1]?.siteCode))
  const workflowsOk = roles.every((r) => !!workflowByRole[r])
  const valuesOk = params.every((p) => p.value !== '' && p.value !== '—')

  const problems: string[] = []
  if (!endpointsOk) {
    problems.push(intent.topology === 'Two-ended' && eps[0]?.siteCode === eps[1]?.siteCode
      ? 'A two-ended service needs two different sites.'
      : `This intent needs ${intent.endpointArity} endpoint(s), all with a site and a port.`)
  }
  if (!workflowsOk) problems.push(`No workflow template selected for ${roles.filter((r) => !workflowByRole[r]).join(' and ')}.`)
  if (!valuesOk) problems.push('Every parameter needs a value before the request can be submitted.')

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
      intentId, workflowId: workflowByRole.Source ?? workflowByRole.Destination ?? '',
      endpoints: eps.slice(0, endpointCount).map((e, i) => {
        const dm = DEVICE_MODELS.find((d) => d.ports.includes(e.port)) ?? DEVICE_MODELS[0]
        return {
          role: e.role, siteCode: e.siteCode, deviceName: dm.model, vendor: dm.vendor,
          mgmtIp: `172.31.33.${20 + eps.indexOf(e) * 80}`, port: e.port,
          workflowId: workflowByRole[roleOf(i)],
        }
      }),
      params,
    }
    const order = createOrder(draft)
    setCreatedId(order.id)
    setStep(4)
  }

  const workflowPicker = (role: EndpointRole) => {
    const candidates = candidatesFor(role)
    const chosen = workflowByRole[role]
    return (
      <div key={role} className="border border-line rounded-lg p-3.5">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="text-[12.5px] font-semibold">{role} workflow</div>
          {vendorForRole(role) && <Badge tone="none">{vendorForRole(role)}</Badge>}
        </div>
        {candidates.length === 0 && (
          <Note tone="crit" className="!py-2 !px-2.5 text-[12px]">No active workflow matches this vendor for {intent.name}.</Note>
        )}
        <div className="flex flex-col gap-1.5">
          {candidates.slice(0, 4).map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWorkflowByRole({ ...workflowByRole, [role]: w.id })}
              className={`text-left border rounded-md px-3 py-2 transition-colors
                ${chosen === w.id ? 'border-brand-500 bg-brand-50 ring-[2px] ring-brand-100' : 'border-line hover:bg-plane'}`}
            >
              <div className="text-[12.5px] font-medium truncate">{w.name}</div>
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
            : step === 1 ? 'Pick the routers this service terminates on, and the template that runs on each.'
              : step === 2 ? 'These parameters come from the intent definition — fill in what the template needs.'
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

          {/* ---- 2 source, destination & workflow (merged) ---- */}
          {step === 1 && (
            <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
              <div className="flex flex-col gap-4">
                {Array.from({ length: endpointCount }).map((_, i) => {
                  const e = eps[i] ?? { role: 'Z' as const, siteCode: SITES[0].code, port: portsPool[0].ports[0] }
                  const label = intent.topology === 'Single-ended' ? 'Access device'
                    : intent.topology === 'Star' ? (i === 0 ? 'Hub' : `Spoke ${i}`)
                      : i === 0 ? 'Source (A-end)' : 'Destination (Z-end)'
                  return (
                    <div key={i} className="border border-line rounded-lg p-4">
                      <div className="text-[12.5px] font-semibold mb-3">{label}</div>
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
                          <TextInput readOnly value={`172.31.33.${20 + i * 80}`} className="bg-plane text-ink-3" />
                        </Field>
                      </div>
                    </div>
                  )
                })}
                {intent.topology === 'Star' && (
                  <div>
                    <Button size="sm" onClick={() => setEps([...eps, { role: 'spoke', siteCode: SITES[2].code, port: portsPool[0].ports[0] }])}>
                      Add spoke
                    </Button>
                  </div>
                )}
                {!endpointsOk && <Note tone="warn">{problems[0]}</Note>}

                <div className="border border-line rounded-lg p-4 bg-plane/50">
                  <div className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3 mb-2.5">Request so far</div>
                  <KV items={[
                    ['Category', <Badge key="c" tone={CATEGORY_TONE[category]}>{category}</Badge>],
                    ['Intent', intent.name],
                    ['Subtype', subtype],
                    ['Customer', ACCOUNTS.find((a) => a.id === accountId)?.name ?? '—'],
                    ['Service name', name || <span className="text-ink-3">{intent.name} (default)</span>],
                  ]} />
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {roles.map((r) => workflowPicker(r))}
              </div>
            </div>
          )}

          {/* ---- 3 parameters & values (merged) ---- */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              {/* These parameters come from the intent, not either endpoint's
                 workflow — the same values apply whichever router runs the
                 config. Restating both chosen workflows here (rather than
                 leaving the operator to remember them from the previous
                 step) makes that explicit instead of implied. */}
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => {
                  const wf = workflows.find((w) => w.id === workflowByRole[r])
                  return (
                    <button
                      key={r} type="button" onClick={() => setStep(1)}
                      title={wf ? wf.name : 'No workflow selected — go back and pick one'}
                      className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 hover:border-brand-300 hover:bg-plane transition-colors
                        focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-ink-3">{r}</span>
                      <span className="text-[12.5px] font-medium truncate max-w-[240px]">{wf ? wf.name : 'no workflow selected'}</span>
                      <Pencil size={12} className="text-ink-3 shrink-0" />
                    </button>
                  )
                })}
              </div>
              <Note>
                <b>{intent.params.filter((p) => p.required).length} required</b> · {intent.params.filter((p) => p.fromPool).length} pool-allocated ·
                every field below is generated from {intent.name}'s parameter definition and applies to the whole service —
                not to the {roles.join(' or ')} workflow individually.
              </Note>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {intent.params.map((p) => {
                  const v = params.find((x) => x.name === p.name)!
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
                        <Select value={v.value} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}>
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
                          onChange={(on) => setValues({ ...values, [p.name]: String(on) })}
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
                        onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                      />
                    </Field>
                  )
                })}
              </div>
            </div>
          )}

          {/* ---- 4 preview ---- */}
          {step === 3 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-5">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Service</div>
                  <KV items={[
                    ['Name', name || intent.name],
                    ['Category / type', `${category} · ${intent.type} · ${subtype}`],
                    ['Customer', ACCOUNTS.find((a) => a.id === accountId)?.name ?? '—'],
                  ]} />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Endpoints & workflows</div>
                  <div className="flex flex-col gap-2">
                    {eps.slice(0, endpointCount).map((e, i) => {
                      const role = roleOf(i)
                      const wf = workflows.find((w) => w.id === workflowByRole[role])
                      return (
                        <button
                          key={i} type="button" onClick={() => setStep(1)}
                          title="Edit this endpoint or its workflow"
                          className="text-left w-full border border-line rounded-lg px-3.5 py-2.5 text-[12.5px]
                            hover:border-brand-300 hover:bg-plane transition-colors
                            focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 min-w-0">
                              <Badge tone="none" className="shrink-0">{role}</Badge>
                              <span className="font-medium truncate">{e.siteCode}</span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              <Mono className="text-ink-3">{e.port}</Mono>
                              <Pencil size={12} className="text-ink-3" />
                            </span>
                          </div>
                          <div className="text-[11.5px] text-ink-3 mt-1 truncate">{wf ? wf.name : 'no workflow selected'}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <Note>Pre-validation starts automatically the moment this request is created — no separate step needed. Success moves it to <b>Validated</b>, ready for approval; failure moves it to <b>Invalid</b>, back with the requester.</Note>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <div className="flex items-baseline justify-between gap-2 mb-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">Parameters</div>
                    <div className="text-[11px] text-ink-3">Shared across every endpoint — not per workflow</div>
                  </div>
                  <table className="w-full text-[12.5px] border border-line rounded-lg overflow-hidden">
                    <tbody>
                      {params.map((p) => (
                        <tr key={p.name} className="border-b border-line-soft last:border-0">
                          <td className="px-3.5 py-2 font-mono text-ink-2">{p.name}</td>
                          <td className="px-3.5 py-2 font-mono font-medium">{p.value || <span className="text-crit-700">missing</span>}</td>
                          <td className="px-3.5 py-2 text-right"><Badge tone={p.source === 'pool' ? 'info' : 'none'}>{p.source}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {problems.length > 0
                  ? <Note tone="crit"><b>{problems.length} problem(s) block submission.</b><ul className="list-disc pl-5 mt-1.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></Note>
                  : <Note tone="good"><b>Validation passed.</b> All parameters resolve, endpoints are distinct, and an active workflow is bound to every endpoint.</Note>}
              </div>
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
