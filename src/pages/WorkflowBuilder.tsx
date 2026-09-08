import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Check, CheckCircle2, ChevronRight, Plus, RotateCcw,
  Save, Send, ShieldCheck, Trash2, X,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import type {
  Category, EndpointRole, StageKind, ValidationRule, ValidationType, Vendor, Workflow, WorkflowStage, WorkflowTaskDef,
} from '@/types'
import { STAGE_KINDS, VALIDATION_TYPES } from '@/types'
import { CATEGORIES, DEVICE_MODELS, PROFILE_TYPES, VENDORS } from '@/data/catalog'
import { KNOWN_PARAMS, emptyStages, newRule, newStage, newTask, paramsIn, templateFor } from '@/data/templates'
import { Badge, Button, Card, CardBody, Field, Mono, Note, Select, TextInput, Toggle } from '@/components/ui'
import { CATEGORY_TONE, WORKFLOW_TONE, shortDate } from '@/lib/format'

/* ------------------------------------------------------------------
   Workflow builder — the platform's Create/Edit workflow screen, rebuilt:
   definition strip on top, the stage flow on a dotted canvas on the
   left, and a context pane on the right that is either the selected
   stage's task table or the selected task's editor. Below: the
   parameters the commands use and the checks that gate publishing.
   ------------------------------------------------------------------ */

const VENDOR_LABEL: Record<Vendor, string> = { CISCO: 'Cisco', JUNIPER: 'Juniper', NOKIA: 'Nokia', SAMSUNG: 'Samsung' }
const KIND_CHIP: Record<StageKind, string> = { 'Pre validation': 'vw-chip--cyan', Configuration: 'vw-chip--info', 'Post validation': 'vw-chip--warning' }
const KIND_HINT: Record<StageKind, string> = {
  'Pre validation': 'Read-only checks before anything is written. A failure stops the run before the device changes.',
  Configuration: 'Commands that change the device. Each task carries its own rollback so a failure can be undone in reverse order.',
  'Post validation': 'Read-only checks after the change, proving the service is really up.',
}

/** A brand-new draft, optionally seeded from an existing workflow (clone). */
function blankWorkflow(from?: Workflow): Workflow {
  const stages = from ? from.stages.map((s) => ({ ...s })) : emptyStages()
  const category: Category = from?.category ?? 'L2VPN'
  const firstType = PROFILE_TYPES.find((p) => p.category === category)
  return {
    id: 'new',
    name: from ? from.name : '',
    displayName: from ? from.displayName : '',
    category,
    type: from?.type ?? firstType?.type ?? '',
    subtype: from?.subtype ?? firstType?.subtype ?? '',
    vendor: from?.vendor ?? 'JUNIPER',
    model: from?.model ?? '',
    models: from ? [...from.models] : [],
    osRange: from?.osRange ?? '',
    intentId: from?.intentId ?? 'INT-L2-P2P',
    endpointRole: from?.endpointRole ?? 'Source',
    state: 'Draft',
    version: from ? from.version + 1 : 1,
    modifiedOn: new Date().toISOString(),
    createdBy: 'Jayesh',
    stages,
    tasks: from ? from.tasks.map((t) => ({ ...t, validations: t.validations.map((r) => ({ ...r })), rollbackValidations: t.rollbackValidations.map((r) => ({ ...r })) })) : [],
    runs30d: 0,
    firstPassRate: 0,
  }
}

const composeName = (w: Workflow, n: number) => {
  const parts = [w.category, w.type || '…', w.subtype || '…', VENDOR_LABEL[w.vendor]]
  if (w.models.some((m) => m.startsWith('NCS'))) parts.push('NCS')
  /* Two-ended: "… | Source n"; single-ended IBW: "… | Juniper n" — the platform's own convention. */
  if (w.category !== 'IBW' && w.endpointRole) parts.push(`${w.endpointRole} ${n}`)
  else parts[parts.length - 1] += ` ${n}`
  return parts.join(' | ')
}

export default function WorkflowBuilder() {
  const { id = 'new' } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const workflows = useStore((s) => s.workflows)
  const saveWorkflow = useStore((s) => s.saveWorkflow)
  const setWorkflowState = useStore((s) => s.setWorkflowState)
  const pushToast = useStore((s) => s.pushToast)

  const source = id === 'new' ? workflows.find((w) => w.id === sp.get('from')) : workflows.find((w) => w.id === id)
  const [wf, setWf] = useState<Workflow>(() => (id === 'new' ? blankWorkflow(source) : source ? structuredClone(source) : blankWorkflow()))
  const [dirty, setDirty] = useState(false)
  const [autoName, setAutoName] = useState(id === 'new' && !sp.get('from'))
  const [selStage, setSelStage] = useState<string | null>(wf.stages[0]?.id ?? null)
  const [selTask, setSelTask] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageKind, setNewStageKind] = useState<StageKind>('Configuration')

  const patch = (p: Partial<Workflow>) => { setWf((w) => ({ ...w, ...p })); setDirty(true) }

  /* -------- definition helpers -------- */
  const types = useMemo(() => [...new Set(PROFILE_TYPES.filter((p) => p.category === wf.category).map((p) => p.type))], [wf.category])
  const subtypes = useMemo(() => [...new Set(PROFILE_TYPES.filter((p) => p.category === wf.category && p.type === wf.type).map((p) => p.subtype))], [wf.category, wf.type])
  const vendorModels = DEVICE_MODELS.filter((d) => d.vendor === wf.vendor)
  const siblings = workflows.filter((w) => w.id !== wf.id && w.category === wf.category && w.type === wf.type && w.subtype === wf.subtype && w.vendor === wf.vendor && w.endpointRole === wf.endpointRole)
  const suggested = composeName(wf, siblings.length + 1)
  useEffect(() => { if (autoName) setWf((w) => (w.name === suggested ? w : { ...w, name: suggested })) }, [autoName, suggested])

  const setCategory = (category: Category) => {
    const t = [...new Set(PROFILE_TYPES.filter((p) => p.category === category).map((p) => p.type))]
    const st = [...new Set(PROFILE_TYPES.filter((p) => p.category === category && p.type === t[0]).map((p) => p.subtype))]
    patch({ category, type: t[0] ?? '', subtype: st[0] ?? '', endpointRole: category === 'IBW' ? undefined : (wf.endpointRole ?? 'Source'), intentId: category === 'IBW' ? 'INT-IBW-ACCESS' : category === 'L2VPN' ? 'INT-L2-P2P' : 'INT-L3-MESH' })
  }
  const setType = (type: string) => {
    const st = [...new Set(PROFILE_TYPES.filter((p) => p.category === wf.category && p.type === type).map((p) => p.subtype))]
    patch({ type, subtype: st[0] ?? '' })
  }
  const setVendor = (vendor: Vendor) => patch({ vendor, models: [], model: '' })
  const addModel = (m: string) => {
    if (!m || wf.models.includes(m)) return
    const dm = DEVICE_MODELS.find((d) => d.model === m)
    const models = [...wf.models, m]
    patch({ models, model: models[0], osRange: wf.osRange || dm?.osRange || '' })
  }
  const removeModel = (m: string) => { const models = wf.models.filter((x) => x !== m); patch({ models, model: models[0] ?? '' }) }

  /* -------- stages -------- */
  const stages = useMemo(() => [...wf.stages].sort((a, b) => a.sequence - b.sequence), [wf.stages])
  const tasksOf = (sid: string) => wf.tasks.filter((t) => t.stageId === sid).sort((a, b) => a.sequence - b.sequence)
  const stage = stages.find((s) => s.id === selStage) ?? stages[0]
  const task = wf.tasks.find((t) => t.id === selTask)

  const addStage = () => {
    const name = newStageName.trim()
    if (!name) return
    const s = newStage(name, newStageKind, stages.length + 1)
    patch({ stages: [...wf.stages, s] })
    setSelStage(s.id); setSelTask(null); setAdding(false); setNewStageName('')
  }
  const removeStage = (sid: string) => {
    const rest = wf.stages.filter((s) => s.id !== sid).sort((a, b) => a.sequence - b.sequence).map((s, i) => ({ ...s, sequence: i + 1 }))
    patch({ stages: rest, tasks: wf.tasks.filter((t) => t.stageId !== sid) })
    if (selStage === sid) { setSelStage(rest[0]?.id ?? null); setSelTask(null) }
  }
  const moveStage = (sid: string, dir: -1 | 1) => {
    const i = stages.findIndex((s) => s.id === sid); const j = i + dir
    if (j < 0 || j >= stages.length) return
    const arr = [...stages]; [arr[i], arr[j]] = [arr[j], arr[i]]
    patch({ stages: arr.map((s, k) => ({ ...s, sequence: k + 1 })) })
  }
  const renameStage = (sid: string, name: string) => patch({
    stages: wf.stages.map((s) => (s.id === sid ? { ...s, name, displayName: name } : s)),
    tasks: wf.tasks.map((t) => (t.stageId === sid ? { ...t, stage: name } : t)),
  })
  const rekindStage = (sid: string, kind: StageKind) => patch({
    stages: wf.stages.map((s) => (s.id === sid ? { ...s, kind } : s)),
    tasks: wf.tasks.map((t) => (t.stageId === sid ? { ...t, stageKind: kind, kind: kind === 'Configuration' ? 'write' : 'read' } : t)),
  })

  /* -------- tasks -------- */
  const addTask = (s: WorkflowStage) => {
    const t = newTask(s, tasksOf(s.id).length + 1)
    patch({ tasks: [...wf.tasks, t] })
    setSelStage(s.id); setSelTask(t.id)
  }
  const patchTask = (tid: string, p: Partial<WorkflowTaskDef>) => patch({ tasks: wf.tasks.map((t) => (t.id === tid ? { ...t, ...p } : t)) })
  const removeTask = (tid: string) => {
    const victim = wf.tasks.find((t) => t.id === tid); if (!victim) return
    const rest = wf.tasks.filter((t) => t.id !== tid)
    let n = 0
    patch({ tasks: rest.sort((a, b) => a.sequence - b.sequence).map((t) => (t.stageId === victim.stageId ? { ...t, sequence: ++n } : t)) })
    if (selTask === tid) setSelTask(null)
  }
  const moveTask = (tid: string, dir: -1 | 1) => {
    const t = wf.tasks.find((x) => x.id === tid); if (!t) return
    const list = tasksOf(t.stageId); const i = list.findIndex((x) => x.id === tid); const j = i + dir
    if (j < 0 || j >= list.length) return
    const arr = [...list]; [arr[i], arr[j]] = [arr[j], arr[i]]
    const seq = new Map(arr.map((x, k) => [x.id, k + 1]))
    patch({ tasks: wf.tasks.map((x) => (seq.has(x.id) ? { ...x, sequence: seq.get(x.id)! } : x)) })
  }
  const loadTemplate = () => {
    const { stages: st, tasks } = templateFor(wf.category, wf.vendor, wf.type, wf.endpointRole, wf.subtype)
    patch({ stages: st, tasks }); setSelStage(st[0].id); setSelTask(null)
    pushToast('info', `Loaded the ${wf.category} ${VENDOR_LABEL[wf.vendor]} template — ${tasks.length} tasks in ${st.length} stages.`)
  }

  /* -------- parameters and checks -------- */
  const params = useMemo(() => {
    const m = new Map<string, number>()
    wf.tasks.forEach((t) => paramsIn(t.setCommand + '\n' + (t.inverseCommand ?? '')).forEach((p) => m.set(p, (m.get(p) ?? 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [wf.tasks])
  const known = KNOWN_PARAMS[wf.category]
  const unknown = params.filter(([p]) => !known.includes(p))

  const checks = useMemo(() => {
    const out: { ok: boolean; text: string; where?: string }[] = []
    out.push({ ok: !!wf.type && !!wf.subtype && wf.models.length > 0 && !!wf.displayName.trim(), text: 'Category, type, subtype, at least one model and a display name are set' })
    out.push({ ok: !workflows.some((w) => w.id !== wf.id && w.name === wf.name && w.state !== 'Retired'), text: 'Name is unique among live workflows' })
    out.push({ ok: stages.some((s) => s.kind === 'Configuration'), text: 'At least one Configuration stage' })
    stages.forEach((s) => { if (!tasksOf(s.id).length) out.push({ ok: false, text: 'Stage has no tasks', where: s.name }) })
    if (stages.every((s) => tasksOf(s.id).length)) out.push({ ok: true, text: 'Every stage has at least one task' })
    const nameless = wf.tasks.filter((t) => !t.name.trim() || !t.setCommand.trim())
    out.push({ ok: nameless.length === 0, text: nameless.length ? `${nameless.length} task(s) missing a name or set command` : 'Every task has a name and a set command', where: nameless[0]?.stage })
    const unruled = wf.tasks.filter((t) => !t.validations.length || t.validations.some((r) => r.type !== 'Not empty' && !r.text.trim()))
    out.push({ ok: unruled.length === 0, text: unruled.length ? `${unruled.length} task(s) with an empty validation rule` : 'Every task judges its output with at least one rule', where: unruled[0]?.name })
    const noRb = wf.tasks.filter((t) => t.rollbackEnabled && !t.inverseCommand?.trim())
    out.push({ ok: noRb.length === 0, text: noRb.length ? `${noRb.length} task(s) have rollback enabled but no rollback command` : 'Every rollback-enabled task has a rollback command', where: noRb[0]?.name })
    const breakerOff = wf.tasks.filter((t) => t.rollbackBreaker && !t.rollbackEnabled)
    out.push({ ok: breakerOff.length === 0, text: breakerOff.length ? `${breakerOff.length} task(s) carry a rollback breaker while rollback is disabled` : 'No rollback breaker on a task whose rollback is disabled', where: breakerOff[0]?.name })
    out.push({ ok: unknown.length === 0, text: unknown.length ? `Unknown parameter${unknown.length > 1 ? 's' : ''}: ${unknown.map(([p]) => `\${${p}}`).join(', ')}` : 'Every ${Parameter} is one the request can supply' })
    return out
  }, [wf, stages, workflows, unknown]) // eslint-disable-line react-hooks/exhaustive-deps
  const blockers = checks.filter((c) => !c.ok).length

  /* -------- actions -------- */
  const persist = (state: Workflow['state'], note?: string) => {
    const stored = { ...wf, state, version: wf.id !== 'new' && source?.state === 'Active' && state === 'Active' ? wf.version + 1 : wf.version }
    const newId = saveWorkflow(stored, note)
    setWf({ ...stored, id: newId }); setDirty(false)
    if (newId !== id) nav(`/workflows/${newId}`, { replace: true })
  }

  if (id !== 'new' && !source) {
    return (
      <Card><CardBody className="py-14 text-center">
        <div className="text-[16px] font-semibold mb-1">Workflow not found</div>
        <Link to="/workflows" className="text-brand-600 text-[13px] font-medium">Back to Workflows</Link>
      </CardBody></Card>
    )
  }

  const isNew = wf.id === 'new'
  const taskCount = wf.tasks.length

  return (
    <>
      {/* ---------------- header + definition ---------------- */}
      <Card>
        <CardBody className="pb-4">
          <button onClick={() => nav(-1)} className="text-[12.5px] text-ink-3 hover:text-ink-1 flex items-center gap-1.5 mb-3">
            <ArrowLeft size={14} />Back
          </button>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                <h1 className="text-[21px] font-semibold tracking-[-.4px] m-0 truncate max-w-[60vw]">{wf.displayName || (isNew ? 'New workflow' : wf.name)}</h1>
                <Badge tone={WORKFLOW_TONE[wf.state]} dot={wf.state === 'Active'}>{wf.state} · v{wf.version}</Badge>
                <Badge tone={CATEGORY_TONE[wf.category]}>{wf.category}</Badge>
                {dirty && <Badge tone="warn">Unsaved changes</Badge>}
              </div>
              <p className="text-[13px] text-ink-2 m-0">
                {isNew ? <span>Not saved yet</span> : <><Mono>{wf.id}</Mono> · modified {shortDate(wf.modifiedOn)} by {wf.createdBy}</>}
                {' '}· {stages.length} stages · {taskCount} tasks
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => nav('/workflows')}>Cancel</Button>
              <Button onClick={() => persist(wf.state === 'Active' ? 'Active' : 'Draft', wf.state === 'Active' ? `${wf.id} saved as version ${wf.version + 1}.` : undefined)} disabled={!wf.type || !wf.models.length || !wf.displayName.trim()}>
                <Save size={15} />{wf.state === 'Active' ? `Save as v${wf.version + 1}` : 'Save draft'}
              </Button>
              {(wf.state === 'Draft' || wf.state === 'Assigned' || wf.state === 'Rejected') && (
                <Button variant="primary" disabled={blockers > 0} onClick={() => persist('Awaiting approval', `${wf.displayName} submitted for approval.`)} title={blockers ? `${blockers} checks to clear first` : undefined}>
                  <Send size={15} />{blockers ? `Submit · ${blockers} to fix` : 'Submit for approval'}
                </Button>
              )}
              {wf.state === 'Awaiting approval' && !isNew && (
                <Button variant="primary" disabled={blockers > 0 || dirty} onClick={() => setWorkflowState(wf.id, 'Active')}>
                  <ShieldCheck size={15} />Approve & activate
                </Button>
              )}
            </div>
          </div>
        </CardBody>

        <div className="px-5 pb-5 border-t border-line-soft pt-4">
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Category" required>
              <Select value={wf.category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Type" required>
              <Select value={wf.type} onChange={(e) => setType(e.target.value)}>
                {types.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Catalog subtype" required>
              <Select value={wf.subtype} onChange={(e) => patch({ subtype: e.target.value })}>
                {subtypes.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Vendor" required>
              <Select value={wf.vendor} onChange={(e) => setVendor(e.target.value as Vendor)}>
                {VENDORS.map((v) => <option key={v} value={v}>{VENDOR_LABEL[v]}</option>)}
              </Select>
            </Field>
            <Field label="Model" required hint={wf.models.length ? undefined : 'Pick every model this template may run on.'}>
              <div className="nst-input w-full !h-auto min-h-[38px] flex items-center gap-1.5 flex-wrap py-1">
                {wf.models.map((m) => (
                  <span key={m} className="vw-chip vw-chip--neutral gap-1 pr-1">
                    {m}
                    <button aria-label={`Remove ${m}`} onClick={() => removeModel(m)} className="text-ink-3 hover:text-ink-1 grid place-items-center"><X size={12} /></button>
                  </span>
                ))}
                <select aria-label="Add model" value="" onChange={(e) => addModel(e.target.value)}
                  className="bg-transparent text-[12.5px] text-ink-3 outline-none min-w-[90px] flex-1">
                  <option value="">{wf.models.length ? '+ add' : 'Select model'}</option>
                  {vendorModels.filter((d) => !wf.models.includes(d.model)).map((d) => <option key={d.model} value={d.model}>{d.model} · {d.os}</option>)}
                </select>
              </div>
            </Field>
            <Field label="Location" required hint={wf.category === 'IBW' ? 'IBW is single-ended — the template runs on the access device.' : undefined}>
              <div className="flex gap-1.5">
                {(['Source', 'Destination'] as EndpointRole[]).map((r) => (
                  <button key={r} type="button" aria-pressed={wf.endpointRole === r} disabled={wf.category === 'IBW'}
                    onClick={() => patch({ endpointRole: r })}
                    className={`vw-chip is-clickable flex-1 justify-center py-[7px] ${wf.endpointRole === r ? 'vw-chip--info-solid is-strong' : 'vw-chip--neutral hover:brightness-95'} disabled:opacity-50`}>
                    {r}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2 mt-3">
            <Field label="Name" required hint={autoName ? 'Composed from the selections above in the platform convention. Switch it off to type your own.' : 'Typed manually.'}>
              <div className="flex gap-2">
                <TextInput value={wf.name} readOnly={autoName} onChange={(e) => patch({ name: e.target.value })} className={autoName ? 'bg-plane font-mono text-[12.5px]' : 'font-mono text-[12.5px]'} maxLength={100} />
                <button type="button" onClick={() => setAutoName(!autoName)} aria-pressed={autoName}
                  className={`nst-btn nst-btn--sm whitespace-nowrap ${autoName ? 'nst-btn--filled' : ''}`}>Auto</button>
              </div>
            </Field>
            <Field label="Display name" required hint={`${wf.displayName.length} / 100`}>
              <TextInput value={wf.displayName} maxLength={100} placeholder="How the workflow appears in lists, e.g. IBW | Static | Other | Juniper"
                onChange={(e) => patch({ displayName: e.target.value })} />
            </Field>
          </div>
        </div>
      </Card>

      {/* ---------------- canvas + context pane ---------------- */}
      <div className="grid gap-4 xl:grid-cols-[372px_1fr] items-start">
        {/* stage flow */}
        <Card>
          <div className="px-4 py-3 border-b border-line-soft flex items-center justify-between gap-2">
            <div>
              <div className="vw-card-title-sm">Stages</div>
              <div className="vw-card-description">Top to bottom on the device</div>
            </div>
            {taskCount === 0 && <Button size="sm" onClick={loadTemplate}><RotateCcw size={13} />Start from template</Button>}
          </div>
          <div className="p-4 rounded-b-[inherit]" style={{ backgroundColor: 'var(--vw-color-gray-50)', backgroundImage: 'radial-gradient(var(--vw-color-gray-300) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
            <ol className="m-0 p-0 list-none flex flex-col items-stretch" aria-label="Stage flow">
              {stages.map((s, i) => {
                const list = tasksOf(s.id)
                const on = stage?.id === s.id && !task
                return (
                  <li key={s.id} className="flex flex-col">
                    <div role="button" tabIndex={0} aria-label={`Stage ${s.name}`} aria-current={on ? 'true' : undefined}
                      onClick={() => { setSelStage(s.id); setSelTask(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setSelStage(s.id); setSelTask(null) } }}
                      className={`vw-card-section bg-white cursor-pointer transition-shadow ${on ? 'ring-2 ring-brand-200 border-brand-200' : 'hover:shadow-md'}`}>
                      <div className="px-3.5 pt-3 pb-2.5">
                        <div className="flex items-start gap-2">
                          <div className="text-[13.5px] font-semibold leading-snug flex-1 min-w-0">{s.name}</div>
                          <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button aria-label={`Add task to ${s.name}`} onClick={() => addTask(s)} className="nst-icon-btn w-7 h-7"><Plus size={14} /></button>
                            <button aria-label={`Delete stage ${s.name}`} onClick={() => removeStage(s.id)} className="nst-icon-btn w-7 h-7 text-crit-500"><Trash2 size={13} /></button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`vw-chip ${KIND_CHIP[s.kind]} text-[11px]`}>{s.kind}</span>
                          <span className="text-[11.5px] text-ink-3 tnum">{list.length} task{list.length === 1 ? '' : 's'}</span>
                          <span className="ml-auto flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                            <button aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => moveStage(s.id, -1)} className="w-6 h-6 grid place-items-center rounded text-ink-3 hover:bg-plane hover:text-ink-1 disabled:opacity-25"><ArrowUp size={13} /></button>
                            <button aria-label={`Move ${s.name} down`} disabled={i === stages.length - 1} onClick={() => moveStage(s.id, 1)} className="w-6 h-6 grid place-items-center rounded text-ink-3 hover:bg-plane hover:text-ink-1 disabled:opacity-25"><ArrowDown size={13} /></button>
                          </span>
                        </div>
                      </div>
                      <div className="px-3 pb-3 flex flex-col gap-1.5">
                        {list.map((t) => (
                          <button key={t.id} onClick={(e) => { e.stopPropagation(); setSelStage(s.id); setSelTask(t.id) }}
                            aria-label={`Task ${t.name || 'untitled'}`} aria-current={task?.id === t.id ? 'true' : undefined}
                            className={`text-left rounded-[var(--vw-radius-sm)] border px-2.5 py-2 flex items-center gap-2 transition-colors
                              ${task?.id === t.id ? 'border-brand-300 bg-brand-50' : 'border-line bg-white hover:bg-plane'}`}>
                            <span className="text-[11px] font-mono text-ink-3 w-4 shrink-0 text-right">{t.sequence}</span>
                            <span className={`text-[12.5px] truncate flex-1 ${t.name ? 'text-ink-1' : 'text-ink-3 italic'}`}>{t.name || 'Untitled task'}</span>
                            {t.rollbackEnabled && <span className="vw-chip vw-chip--neutral text-[10px] shrink-0">rollback</span>}
                            {(!t.name || !t.setCommand || !t.validations.length) && <AlertTriangle size={12} className="text-warn-500 shrink-0" aria-label="Incomplete" />}
                          </button>
                        ))}
                        {list.length === 0 && (
                          <button onClick={(e) => { e.stopPropagation(); addTask(s) }} className="text-left rounded-[var(--vw-radius-sm)] border border-dashed border-line px-2.5 py-2 text-[12px] text-ink-3 hover:bg-plane">
                            + Add the first task
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="self-center w-px h-5 bg-[var(--vw-color-gray-400)]" aria-hidden />
                  </li>
                )
              })}
              <li className="flex flex-col items-stretch">
                {adding ? (
                  <div className="vw-card-section bg-white p-3.5 flex flex-col gap-2.5" aria-label="New stage">
                    <TextInput autoFocus placeholder="Stage name, e.g. Set service configuration" value={newStageName} maxLength={50}
                      onChange={(e) => setNewStageName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addStage(); if (e.key === 'Escape') setAdding(false) }} />
                    <Select value={newStageKind} onChange={(e) => setNewStageKind(e.target.value as StageKind)} aria-label="Stage kind">
                      {STAGE_KINDS.map((k) => <option key={k}>{k}</option>)}
                    </Select>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" onClick={() => setAdding(false)}><X size={13} />Cancel</Button>
                      <Button size="sm" variant="primary" onClick={addStage} disabled={!newStageName.trim()}><Check size={13} />Add stage</Button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAdding(true)} className="self-center nst-btn nst-btn--sm bg-white" aria-label="Add stage"><Plus size={14} />Add stage</button>
                )}
              </li>
            </ol>
          </div>
        </Card>

        {/* context pane */}
        {task && stage ? (
          <TaskEditor
            task={task} stage={stage} known={known}
            onChange={(p) => patchTask(task.id, p)}
            onDelete={() => removeTask(task.id)}
            onDone={() => setSelTask(null)}
          />
        ) : stage ? (
          <Card>
            <div className="px-5 pt-4 pb-3 border-b border-line-soft flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <input aria-label="Stage name" value={stage.name} maxLength={50} onChange={(e) => renameStage(stage.id, e.target.value)}
                    className="text-[16px] font-semibold bg-transparent border-b border-transparent hover:border-line focus:border-brand-500 outline-none min-w-[240px]" />
                  <Select value={stage.kind} onChange={(e) => rekindStage(stage.id, e.target.value as StageKind)} aria-label="Stage kind" className="!h-[30px] !py-0 text-[12.5px] w-[170px]">
                    {STAGE_KINDS.map((k) => <option key={k}>{k}</option>)}
                  </Select>
                </div>
                <div className="vw-card-description mt-1">{KIND_HINT[stage.kind]}</div>
              </div>
              <Button variant="primary" size="sm" onClick={() => addTask(stage)}><Plus size={14} />Add task</Button>
            </div>
            {tasksOf(stage.id).length ? (
              <div className="nst-table-card border-0 rounded-none shadow-none">
                <table className="nst-table w-full table-fixed">
                  <thead><tr>
                    <th className="w-[44px]">#</th><th className="w-[200px]">Task</th><th>Set command</th><th className="w-[56px]">Rules</th><th className="w-[86px]">Rollback</th><th className="w-[136px]"></th>
                  </tr></thead>
                  <tbody>
                    {tasksOf(stage.id).map((t, i, arr) => (
                      <tr key={t.id} className="cursor-pointer" onClick={() => setSelTask(t.id)}>
                        <td className="font-mono text-ink-3">{t.sequence}</td>
                        <td>
                          <div className={`font-medium truncate ${t.name ? '' : 'text-ink-3 italic'}`}>{t.name || 'Untitled task'}</div>
                          {t.displayName && t.displayName !== t.name && <div className="text-[11.5px] text-ink-3">{t.displayName}</div>}
                        </td>
                        <td><Mono className="text-[11.5px] text-ink-2 block truncate">{t.setCommand.split('\n')[0] || <span className="text-warn-600 not-italic">missing</span>}</Mono>
                          {t.setCommand.includes('\n') && <span className="text-[11px] text-ink-3">+{t.setCommand.split('\n').length - 1} more lines</span>}</td>
                        <td className="tnum">{t.validations.length}</td>
                        <td>{t.rollbackEnabled ? <Badge tone={t.inverseCommand ? 'good' : 'crit'}>{t.inverseCommand ? 'Enabled' : 'Missing'}</Badge> : <span className="text-ink-3">—</span>}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1 justify-end">
                            <button aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => moveTask(t.id, -1)} className="nst-icon-btn w-7 h-7 disabled:opacity-30"><ArrowUp size={13} /></button>
                            <button aria-label={`Move ${t.name} down`} disabled={i === arr.length - 1} onClick={() => moveTask(t.id, 1)} className="nst-icon-btn w-7 h-7 disabled:opacity-30"><ArrowDown size={13} /></button>
                            <button aria-label={`Edit ${t.name}`} onClick={() => setSelTask(t.id)} className="nst-icon-btn w-7 h-7"><ChevronRight size={14} /></button>
                            <button aria-label={`Delete ${t.name}`} onClick={() => removeTask(t.id)} className="nst-icon-btn w-7 h-7 text-crit-500"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <CardBody className="py-12 text-center">
                <div className="text-[14px] font-semibold mb-1">No tasks in {stage.name} yet</div>
                <p className="text-[13px] text-ink-3 mb-4 max-w-[52ch] mx-auto">{KIND_HINT[stage.kind]}</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="primary" onClick={() => addTask(stage)}><Plus size={14} />Add task</Button>
                  {taskCount === 0 && <Button onClick={loadTemplate}><RotateCcw size={14} />Start from the {VENDOR_LABEL[wf.vendor]} template</Button>}
                </div>
              </CardBody>
            )}
          </Card>
        ) : (
          <Card><CardBody className="py-14 text-center">
            <div className="text-[14px] font-semibold mb-1">No stages</div>
            <p className="text-[13px] text-ink-3">Add a stage on the left, or start from the vendor template.</p>
          </CardBody></Card>
        )}
      </div>

      {/* ---------------- parameters + checks ---------------- */}
      <div className="grid gap-4 xl:grid-cols-2 items-start">
        <Card>
          <div className="px-5 pt-4 pb-3 border-b border-line-soft">
            <div className="vw-card-title-sm">Parameters this workflow needs</div>
            <div className="vw-card-description">Every <Mono>{'${Parameter}'}</Mono> found in a command. The request supplies these per device — the ones in grey are not something a request carries for {wf.category}.</div>
          </div>
          <CardBody>
            {params.length ? (
              <div className="flex gap-2 flex-wrap" aria-label="Parameters used">
                {params.map(([p, n]) => (
                  <span key={p} className={`vw-chip gap-1.5 ${known.includes(p) ? 'vw-chip--info' : 'vw-chip--neutral line-through'}`} title={known.includes(p) ? `Used by ${n} task(s)` : 'Not a parameter the request supplies'}>
                    <Mono className="text-[12px]">{'${' + p + '}'}</Mono><span className="text-[11px] opacity-70 tnum">{n}</span>
                  </span>
                ))}
              </div>
            ) : <p className="text-[13px] text-ink-3 m-0">No parameters yet — write a command with a <Mono>{'${Vlan-ID}'}</Mono>-style placeholder and it appears here.</p>}
            <div className="mt-3 text-[12px] text-ink-3">Available for {wf.category}: {known.map((k) => <Mono key={k} className="text-[11.5px] mr-1.5">{'${' + k + '}'}</Mono>)}</div>
          </CardBody>
        </Card>
        <Card>
          <div className="px-5 pt-4 pb-3 border-b border-line-soft flex items-center justify-between gap-3">
            <div>
              <div className="vw-card-title-sm">Checks before publish</div>
              <div className="vw-card-description">Submit stays disabled until every check passes</div>
            </div>
            <Badge tone={blockers ? 'crit' : 'good'}>{blockers ? `${blockers} to fix` : 'Ready'}</Badge>
          </div>
          <ul className="m-0 p-0 list-none divide-y divide-line-soft" aria-label="Publish checks">
            {checks.map((c, i) => (
              <li key={i} className="px-5 py-2.5 flex items-start gap-2.5 text-[13px]">
                {c.ok ? <CheckCircle2 size={15} className="text-good-500 mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="text-crit-500 mt-0.5 shrink-0" />}
                <span className={c.ok ? 'text-ink-2' : 'text-ink-1 font-medium'}>{c.text}{c.where && !c.ok && <span className="text-ink-3 font-normal"> · {c.where}</span>}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------
   Task editor — the platform's "Task create" pane, laid out in four
   groups: identity, set command + rules, rollback, behaviour.
   ------------------------------------------------------------------ */

function TaskEditor({ task, stage, known, onChange, onDelete, onDone }: {
  task: WorkflowTaskDef; stage: WorkflowStage; known: string[]
  onChange: (p: Partial<WorkflowTaskDef>) => void; onDelete: () => void; onDone: () => void
}) {
  const used = paramsIn(task.setCommand)
  const setRules = (validations: ValidationRule[]) => onChange({ validations })
  const setRb = (rollbackValidations: ValidationRule[]) => onChange({ rollbackValidations })

  return (
    <Card>
      <div className="px-5 pt-4 pb-3 border-b border-line-soft flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11.5px] text-ink-3 flex items-center gap-1"><span>{stage.name}</span><ChevronRight size={12} /><span className={`vw-chip ${KIND_CHIP[stage.kind]} text-[10.5px]`}>{stage.kind}</span></div>
          <div className="text-[16px] font-semibold mt-0.5">{task.name || 'New task'}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="danger" size="sm" onClick={onDelete}><Trash2 size={13} />Delete task</Button>
          <Button variant="primary" size="sm" onClick={onDone}><Check size={14} />Done</Button>
        </div>
      </div>
      <CardBody className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" required hint="Short, unique inside the stage">
            <TextInput value={task.name} maxLength={100} placeholder="e.g. Check interface configuration" onChange={(e) => onChange({ name: e.target.value, displayName: task.displayName === task.name ? e.target.value : task.displayName })} />
          </Field>
          <Field label="Display name" required hint={`${task.displayName.length} / 100`}>
            <TextInput value={task.displayName} maxLength={100} onChange={(e) => onChange({ displayName: e.target.value })} />
          </Field>
        </div>

        {/* set command */}
        <section aria-label="Set command">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="nst-input-label">Set command <span className="text-crit-500">*</span></span>
            <span className="text-[11.5px] text-ink-3">Sent to the device as typed. One command per line.</span>
          </div>
          <CommandBox value={task.setCommand} onChange={(v) => onChange({ setCommand: v })} placeholder={stage.kind === 'Configuration' ? 'set interfaces ${Interface} unit ${Vlan-ID} vlan-id ${Vlan-ID}' : 'show configuration interfaces ${Interface} | display set'} known={known} />
          {used.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2" aria-label="Parameters in this command">
              {used.map((p) => (
                <span key={p} className={`vw-chip text-[11px] ${known.includes(p) ? 'vw-chip--info' : 'vw-chip--error'}`} title={known.includes(p) ? 'Supplied by the request' : 'Not a parameter the request supplies'}>
                  {'${' + p + '}'}{!known.includes(p) && ' · unknown'}
                </span>
              ))}
            </div>
          )}
          <Rules label="Output is accepted when" rules={task.validations} onChange={setRules} />
        </section>

        {/* rollback */}
        <section aria-label="Rollback" className={`vw-card-section p-4 ${task.rollbackEnabled ? '' : 'bg-plane'}`}>
          <Toggle checked={task.rollbackEnabled} onChange={(v) => onChange({ rollbackEnabled: v, rollbackBreaker: v ? task.rollbackBreaker : false, rollbackValidations: v && !task.rollbackValidations.length ? [newRule('And', 'Not contains', 'error')] : task.rollbackValidations })}
            label="Rollback enabled" hint={stage.kind === 'Configuration' ? 'This task changes the device — give it a command that undoes the change.' : 'Read-only tasks rarely need a rollback.'} />
          {task.rollbackEnabled && (
            <div className="mt-3">
              <span className="nst-input-label block mb-1.5">Rollback command <span className="text-crit-500">*</span></span>
              <CommandBox value={task.inverseCommand ?? ''} onChange={(v) => onChange({ inverseCommand: v })} placeholder="delete interfaces ${Interface} unit ${Vlan-ID}" known={known} />
              <Rules label="Rollback is accepted when" rules={task.rollbackValidations} onChange={setRb} />
              <div className="mt-3">
                <Toggle checked={task.rollbackBreaker} onChange={(v) => onChange({ rollbackBreaker: v })} label="Rollback breaker" hint="When the rollback pass reaches this task it stops here — earlier tasks are left as they are." />
              </div>
            </div>
          )}
        </section>

        {/* behaviour */}
        <section aria-label="Behaviour">
          <div className="nst-input-label mb-2">Behaviour</div>
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <Toggle checked={task.skipAllowed} onChange={(v) => onChange({ skipAllowed: v })} label="Can be skipped" hint="An engineer may skip this task during a run without failing it." />
            <Toggle checked={task.manualCompleteAllowed} onChange={(v) => onChange({ manualCompleteAllowed: v })} label="Manual completion" hint="The run pauses here until an engineer marks it complete." />
            <Toggle checked={task.retryAllowed} onChange={(v) => onChange({ retryAllowed: v })} label="Retry on failure" hint="Re-run the command before failing the task — useful for checks that need the device to converge." />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Timeout (ms)" hint={task.timeoutMs === undefined ? 'Platform default' : `${(task.timeoutMs / 1000).toFixed(0)} s`}>
                <TextInput type="number" min={1000} step={1000} value={task.timeoutMs ?? ''} placeholder="50000" className="font-mono"
                  onChange={(e) => onChange({ timeoutMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </Field>
              <Field label="Delay before (ms)" hint={task.delayMs ? `${(task.delayMs / 1000).toFixed(0)} s` : 'None'}>
                <TextInput type="number" min={0} step={500} value={task.delayMs ?? ''} placeholder="0" className="font-mono"
                  onChange={(e) => onChange({ delayMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </Field>
            </div>
          </div>
        </section>
      </CardBody>
    </Card>
  )
}

/** Mono textarea that highlights `${Parameter}` placeholders behind the text. */
function CommandBox({ value, onChange, placeholder, known }: { value: string; onChange: (v: string) => void; placeholder?: string; known: string[] }) {
  const lines = Math.min(10, Math.max(3, value.split('\n').length + 1))
  const parts = value.split(/(\$\{[^}]+\})/g)
  return (
    <div className="nst-textarea-wrap relative !h-auto font-mono text-[12.5px]" style={{ minHeight: `${lines * 20 + 16}px` }}>
      <div aria-hidden className="absolute inset-0 px-2 pt-2 whitespace-pre-wrap break-words pointer-events-none leading-[20px] text-transparent">
        {parts.map((p, i) => /^\$\{[^}]+\}$/.test(p)
          ? <mark key={i} className={`rounded-[3px] text-transparent ${known.includes(p.slice(2, -1)) ? 'bg-brand-50' : 'bg-crit-50'}`}>{p}</mark>
          : <span key={i}>{p}</span>)}
        {'\n'}
      </div>
      <textarea
        value={value} placeholder={placeholder} spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="nst-textarea relative !font-mono !text-[12.5px] !leading-[20px] !p-2 w-full bg-transparent"
        style={{ minHeight: `${lines * 20 + 16}px` }}
      />
    </div>
  )
}

/** Validation rules, top to bottom, each joined to the one above with And / Or. */
function Rules({ label, rules, onChange }: { label: string; rules: ValidationRule[]; onChange: (r: ValidationRule[]) => void }) {
  const upd = (id: string, p: Partial<ValidationRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...p } : r)))
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        <button type="button" onClick={() => onChange([...rules, newRule('And', 'Contains', '')])} className="nst-btn nst-btn--xs nst-btn--ghost text-brand-600"><Plus size={13} />Add rule</button>
      </div>
      {rules.length === 0 && <Note tone="warn">No rule — the task would pass on the transport exit code alone. Add at least one.</Note>}
      <div className="flex flex-col gap-1.5" aria-label={label}>
        {rules.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[84px_1fr_150px_32px] gap-2 items-center">
            {i === 0 ? <span className="text-[11.5px] text-ink-3 text-right pr-1">output</span> : (
              <div className="flex rounded-[var(--vw-radius-sm)] border border-line overflow-hidden h-[32px]" role="radiogroup" aria-label={`Join for rule ${i + 1}`}>
                {(['And', 'Or'] as const).map((j) => (
                  <button key={j} type="button" role="radio" aria-checked={r.join === j} onClick={() => upd(r.id, { join: j })}
                    className={`flex-1 text-[12px] font-medium ${r.join === j ? 'bg-ink-1 text-white' : 'bg-white text-ink-2 hover:bg-plane'}`}>{j}</button>
                ))}
              </div>
            )}
            <input aria-label={`Rule ${i + 1} text`} value={r.text} disabled={r.type === 'Not empty'} placeholder={r.type === 'Not empty' ? '(no text needed)' : 'text to look for, e.g. error'}
              onChange={(e) => upd(r.id, { text: e.target.value })} className="nst-input w-full !h-[32px] font-mono text-[12px]" />
            <div className="relative">
              <select aria-label={`Rule ${i + 1} type`} value={r.type} onChange={(e) => upd(r.id, { type: e.target.value as ValidationType })} className="nst-input w-full !h-[32px] appearance-none pr-7 text-[12.5px]">
                {VALIDATION_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <ChevronRight size={13} className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-ink-3 pointer-events-none" />
            </div>
            <button type="button" aria-label={`Remove rule ${i + 1}`} onClick={() => onChange(rules.filter((x) => x.id !== r.id))} className="nst-icon-btn w-8 h-8 text-crit-500"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
