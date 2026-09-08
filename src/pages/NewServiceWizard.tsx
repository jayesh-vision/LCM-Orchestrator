import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, PlayCircle, Save } from 'lucide-react'
import { useStore, type WizardDraft } from '@/store/useStore'
import { ACCOUNTS, DEVICE_MODELS, SITES } from '@/data/catalog'
import type { Category, OrderParamValue } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, Field, KV, Mono, Note, PageHead,
  Select, Stepper, TextInput, Toggle,
} from '@/components/ui'

const STEPS = [
  'Category & type', 'Source & destination', 'Workflow template',
  'Parameters', 'Values', 'Preview & validate', 'Planned',
]

interface EndpointDraft { role: 'A' | 'Z' | 'hub' | 'spoke'; siteCode: string; port: string }

export default function NewServiceWizard() {
  const nav = useNavigate()
  const intents = useStore((s) => s.intents)
  const workflows = useStore((s) => s.workflows)
  const pools = useStore((s) => s.pools)
  const createOrder = useStore((s) => s.createOrder)
  const startRun = useStore((s) => s.startRun)

  const [step, setStep] = useState(0)
  const [category, setCategory] = useState<Category>('L2VPN')
  const [intentId, setIntentId] = useState('INT-L2-P2P')
  const [subtype, setSubtype] = useState('Tagged')
  const [accountId, setAccountId] = useState(ACCOUNTS[0].id)
  const [name, setName] = useState('')
  const [eps, setEps] = useState<EndpointDraft[]>([
    { role: 'A', siteCode: SITES[0].code, port: DEVICE_MODELS[2].ports[0] },
    { role: 'Z', siteCode: SITES[1].code, port: DEVICE_MODELS[2].ports[2] },
  ])
  const [workflowId, setWorkflowId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [autoExecute, setAutoExecute] = useState(true)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const intent = intents.find((i) => i.id === intentId)!
  const catIntents = intents.filter((i) => i.category === category)

  const candidateWorkflows = useMemo(
    () => workflows.filter((w) => w.intentId === intentId && w.state === 'Active'),
    [workflows, intentId],
  )

  /* Templates are auto-populated from the inputs: the best-performing active
     workflow for this intent is preselected, and the operator can override. */
  useEffect(() => {
    const best = [...candidateWorkflows].sort((a, b) => b.firstPassRate - a.firstPassRate)[0]
    setWorkflowId(best?.id ?? '')
  }, [candidateWorkflows])

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

  const endpointCount = intent.topology === 'Single-ended' ? 1 : intent.topology === 'Two-ended' ? 2 : eps.length
  const endpointsOk = eps.slice(0, endpointCount).every((e) => e.siteCode && e.port)
    && (intent.topology !== 'Two-ended' || (eps[0].siteCode !== eps[1]?.siteCode))
  const valuesOk = params.every((p) => p.value !== '' && p.value !== '—')

  const problems: string[] = []
  if (!endpointsOk) {
    problems.push(intent.topology === 'Two-ended' && eps[0]?.siteCode === eps[1]?.siteCode
      ? 'A two-ended service needs two different sites.'
      : `This intent needs ${intent.endpointArity} endpoint(s), all with a site and a port.`)
  }
  if (!workflowId) problems.push('No workflow template selected.')
  if (!valuesOk) problems.push('Every parameter needs a value before the request can be submitted.')

  const canNext = () => {
    if (step === 0) return !!intentId && !!accountId
    if (step === 1) return endpointsOk
    if (step === 2) return !!workflowId
    if (step === 4) return valuesOk
    if (step === 5) return problems.length === 0
    return true
  }

  const submit = () => {
    const acct = ACCOUNTS.find((a) => a.id === accountId)!
    const draft: WizardDraft = {
      category, type: intent.type, subtype,
      accountId: acct.id, accountName: acct.name,
      name: name || `${intent.name}`,
      intentId, workflowId,
      endpoints: eps.slice(0, endpointCount).map((e) => {
        const dm = DEVICE_MODELS.find((d) => d.ports.includes(e.port)) ?? DEVICE_MODELS[0]
        return {
          role: e.role, siteCode: e.siteCode, deviceName: dm.model, vendor: dm.vendor,
          mgmtIp: `172.31.33.${20 + eps.indexOf(e) * 80}`, port: e.port,
        }
      }),
      params,
    }
    const order = createOrder(draft)
    setCreatedId(order.id)
    setStep(6)
    if (autoExecute) setTimeout(() => startRun(order.id), 700)
  }

  return (
    <>
      <PageHead
        title="New network service"
        sub="Seven steps from category to a planned service. Pre-validation runs automatically once the request is created."
        actions={<Button onClick={() => nav('/requests')}>Cancel</Button>}
      />

      <Card>
        <CardBody className="pb-4"><Stepper steps={STEPS} current={step} /></CardBody>
      </Card>

      <Card>
        <CardHead title={`Step ${Math.min(step + 1, 7)} · ${STEPS[step]}`} sub={
          step === 0 ? 'Choose the service category and the intent it is built from.'
            : step === 1 ? 'Pick the routers this service terminates on.'
              : step === 2 ? 'Workflow templates are filtered by the intent you chose.'
                : step === 3 ? 'These parameters come from the intent definition, not from the form.'
                  : step === 4 ? 'Pool-backed values are allocated for you and held by a reservation.'
                    : step === 5 ? 'Everything is validated before submission.'
                      : 'The service exists and pre-validation has been triggered.'
        } />
        <CardBody>

          {/* ---- 1 category & type ---- */}
          {step === 0 && (
            <div className="grid gap-5 md:grid-cols-2 max-w-[880px]">
              <Field label="Service category" required>
                <Select value={category} onChange={(e) => {
                  const c = e.target.value as Category
                  setCategory(c)
                  const first = intents.find((i) => i.category === c)!
                  setIntentId(first.id)
                }}>
                  {(['L2VPN', 'L3VPN', 'IBW'] as Category[]).map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Type" required hint={`${intent.topology} · ${intent.endpointArity}`}>
                <Select value={intentId} onChange={(e) => setIntentId(e.target.value)}>
                  {catIntents.map((i) => <option key={i.id} value={i.id}>{i.type} — {i.name}</option>)}
                </Select>
              </Field>
              <Field label="Catalog subtype">
                <Select value={subtype} onChange={(e) => setSubtype(e.target.value)}>
                  {['Tagged', 'Untagged', 'BGP', 'Static', 'OSPF', 'VRF', 'Other'].map((s) => <option key={s}>{s}</option>)}
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
              <div className="md:col-span-2">
                <Note>
                  <b>{intent.name}</b> draws from {intent.pools.join(', ')} and is accepted only when
                  all {intent.acceptance.length} criteria pass, {intent.acceptance.filter((a) => a.layer === 'service').length} of them at the service layer.
                </Note>
              </div>
            </div>
          )}

          {/* ---- 2 source & destination ---- */}
          {step === 1 && (
            <div className="flex flex-col gap-4 max-w-[880px]">
              {Array.from({ length: endpointCount }).map((_, i) => {
                const e = eps[i] ?? { role: 'Z' as const, siteCode: SITES[0].code, port: DEVICE_MODELS[0].ports[0] }
                const label = intent.topology === 'Star' ? (i === 0 ? 'Hub' : `Spoke ${i}`) : i === 0 ? 'Source (A-end)' : 'Destination (Z-end)'
                return (
                  <div key={i} className="border border-line rounded-lg p-4">
                    <div className="text-[12.5px] font-semibold mb-3">{label}</div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Site" required>
                        <Select value={e.siteCode} onChange={(ev) => {
                          const next = [...eps]; next[i] = { ...e, siteCode: ev.target.value }; setEps(next)
                        }}>
                          {SITES.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.city}</option>)}
                        </Select>
                      </Field>
                      <Field label="Router port" required>
                        <Select value={e.port} onChange={(ev) => {
                          const next = [...eps]; next[i] = { ...e, port: ev.target.value }; setEps(next)
                        }}>
                          {DEVICE_MODELS.flatMap((d) => d.ports).map((p) => <option key={p} value={p}>{p}</option>)}
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
                  <Button size="sm" onClick={() => setEps([...eps, { role: 'spoke', siteCode: SITES[2].code, port: DEVICE_MODELS[0].ports[0] }])}>
                    Add spoke
                  </Button>
                </div>
              )}
              {!endpointsOk && <Note tone="warn">{problems[0]}</Note>}
            </div>
          )}

          {/* ---- 3 workflow template ---- */}
          {step === 2 && (
            <div className="max-w-[880px] flex flex-col gap-3">
              {candidateWorkflows.length === 0 && (
                <Note tone="crit">No active workflow is bound to {intent.name}. A request cannot be created until one is published.</Note>
              )}
              {candidateWorkflows.slice(0, 6).map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWorkflowId(w.id)}
                  className={`text-left border rounded-lg px-4 py-3.5 flex items-center justify-between gap-4 transition-colors
                    ${workflowId === w.id ? 'border-brand-500 bg-brand-50 ring-[3px] ring-brand-100' : 'border-line hover:bg-plane'}`}
                >
                  <div>
                    <div className="text-[13px] font-medium">{w.name}</div>
                    <div className="text-[11.5px] text-ink-3 font-mono mt-0.5">{w.id} · v{w.version} · {w.model} · {w.osRange}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone="none">{w.tasks.length} tasks</Badge>
                    <Badge tone={w.firstPassRate >= 80 ? 'good' : 'warn'}>{w.firstPassRate}% first-pass</Badge>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ---- 4 parameters ---- */}
          {step === 3 && (
            <div className="max-w-[980px]">
              <table className="w-full text-[13px] border border-line rounded-lg overflow-hidden">
                <thead><tr className="bg-plane">
                  {['Parameter', 'Type', 'Constraint', 'Source', 'Modifiable later'].map((h) => (
                    <th key={h} scope="col" className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {intent.params.map((p) => (
                    <tr key={p.name} className="border-t border-line-soft">
                      <td className="px-4 py-2.5 font-mono">{p.name}{p.required && <span className="text-crit-500">*</span>}</td>
                      <td className="px-4 py-2.5 text-ink-3">{p.type}</td>
                      <td className="px-4 py-2.5 text-ink-3">{p.constraint}</td>
                      <td className="px-4 py-2.5">{p.fromPool ? <Badge tone="info">{p.fromPool} pool</Badge> : <Badge tone="none">operator</Badge>}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={p.modifiable === 'hitless' ? 'good' : p.modifiable === 'bounce' ? 'warn' : 'crit'}>{p.modifiable}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note><b>The form on the next step is generated from this table.</b> A parameter cannot appear in the form and be missing from validation, or carry different bounds in the two places.</Note>
            </div>
          )}

          {/* ---- 5 values ---- */}
          {step === 4 && (
            <div className="grid gap-5 md:grid-cols-2 max-w-[880px]">
              {intent.params.map((p) => {
                const v = params.find((x) => x.name === p.name)!
                if (p.fromPool) {
                  return (
                    <Field key={p.name} label={p.name} hint={`Allocated from the ${p.fromPool} pool and held for 72 hours.`}>
                      <div className="flex items-center gap-2">
                        <TextInput readOnly value={v.value} className="bg-plane font-mono" />
                        <Badge tone="info">reserved</Badge>
                      </div>
                    </Field>
                  )
                }
                if (p.options) {
                  return (
                    <Field key={p.name} label={p.name} required={p.required} hint={p.constraint}>
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
                        label={p.name} hint={p.constraint}
                      />
                    </div>
                  )
                }
                return (
                  <Field key={p.name} label={p.name} required={p.required} hint={p.constraint}>
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
          )}

          {/* ---- 6 preview ---- */}
          {step === 5 && (
            <div className="grid gap-5 lg:grid-cols-2 max-w-[1080px]">
              <div className="flex flex-col gap-5">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Service</div>
                  <KV items={[
                    ['Name', name || intent.name],
                    ['Category / type', `${category} · ${intent.type} · ${subtype}`],
                    ['Customer', ACCOUNTS.find((a) => a.id === accountId)?.name ?? '—'],
                    ['Workflow', <Mono key="w">{workflowId || 'none'}</Mono>],
                  ]} />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Endpoints</div>
                  <div className="flex flex-col gap-2">
                    {eps.slice(0, endpointCount).map((e, i) => (
                      <div key={i} className="border border-line rounded-lg px-3.5 py-2.5 text-[12.5px] flex items-center justify-between">
                        <span className="font-medium">{e.siteCode}</span>
                        <Mono className="text-ink-3">{e.port}</Mono>
                      </div>
                    ))}
                  </div>
                </div>
                <Toggle checked={autoExecute} onChange={setAutoExecute}
                  label="Run pre-validation immediately"
                  hint="Auto-triggered validation tasks execute on the device. Success moves the request to Validated; failure rolls back and reports why." />
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Parameters</div>
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
                  : <Note tone="good"><b>Validation passed.</b> All parameters resolve, endpoints are distinct, and an active workflow is bound.</Note>}
              </div>
            </div>
          )}

          {/* ---- 7 planned ---- */}
          {step === 6 && createdId && (
            <div className="py-8 text-center max-w-[560px] mx-auto">
              <div className="w-14 h-14 rounded-full bg-good-50 border border-good-200 grid place-items-center mx-auto mb-4">
                <CheckCircle2 size={26} className="text-good-500" />
              </div>
              <div className="text-[18px] font-semibold mb-1.5">Service created</div>
              <p className="text-[13px] text-ink-2 mb-5">
                <Mono className="font-semibold">{createdId}</Mono> is in <b>Designed</b> state with its resources reserved.
                {autoExecute ? ' Pre-validation is running on the device now.' : ' Approve it to begin execution.'}
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

        {step < 6 && (
          <div className="px-5 py-3.5 border-t border-line-soft flex items-center justify-between gap-3">
            <Button disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={15} />Back</Button>
            <div className="flex items-center gap-2">
              <Button onClick={() => nav('/requests')}><Save size={15} />Save as draft</Button>
              {step < 5
                ? <Button variant="primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>Next<ArrowRight size={15} /></Button>
                : <Button variant="primary" disabled={!canNext()} onClick={submit}><CheckCircle2 size={15} />Create service</Button>}
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
