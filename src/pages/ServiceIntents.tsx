import { useMemo, useState } from 'react'
import {
  Archive, ArrowDown, ArrowUp, CheckCircle2, ChevronRight, CircleAlert, Eye, GitBranch, History,
  Layers, Pencil, Plus, SlidersHorizontal, Trash2,
} from 'lucide-react'
import { useQueryState } from '@/lib/useQueryState'
import { useStore } from '@/store/useStore'
import type { Category, Domain, IntentParam, PoolKind, ServiceIntent, ServiceIntentState } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, CellMain, CellSub, DataTable, Drawer,
  Field, FieldDropdown, Kebab, Modal, Mono, Note, Select, Stat, TextInput, Toggle, type Column,
} from '@/components/ui'
import { CATEGORY_TONE, WORKFLOW_TONE } from '@/lib/format'

const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'VLAN', 'Microwave', 'DWDM', 'RAN VNF', 'GPON']
const TOPOLOGIES: ServiceIntent['topology'][] = ['Single-ended', 'Two-ended', 'Star', 'Full mesh']
const STATES: ServiceIntentState[] = ['Draft', 'Active', 'Retired']
const PARAM_TYPES: IntentParam['type'][] = ['string', 'integer', 'boolean', 'enum', 'ipv4']
const MODIFIABLE: IntentParam['modifiable'][] = ['no', 'hitless', 'bounce', 'recreate']
const POOL_KINDS: PoolKind[] = [
  'VLAN', 'RD/RT', 'Pseudowire ID', 'IP block', 'Sub-interface', 'ASN slot', 'CPE Serial',
  'Frequency Channel', 'Wavelength', 'PCI', 'ONT Serial', 'PON Port',
]

interface IntentForm { profileTypeId: string; name: string; topology: ServiceIntent['topology']; endpointArity: string }
const blankIntentForm = (): IntentForm => ({ profileTypeId: '', name: '', topology: 'Two-ended', endpointArity: 'exactly 2' })

interface ParamForm {
  mode: 'add' | 'edit'; original?: string
  name: string; type: IntentParam['type']; optionsCsv: string; min: string; max: string
  default: string; required: boolean; modifiable: IntentParam['modifiable']; fromPool: PoolKind | ''; constraint: string
}
const blankParamForm = (): ParamForm => ({
  mode: 'add', name: '', type: 'string', optionsCsv: '', min: '', max: '',
  default: '', required: true, modifiable: 'hitless', fromPool: '', constraint: '',
})
const paramFormFrom = (p: IntentParam): ParamForm => ({
  mode: 'edit', original: p.name, name: p.name, type: p.type, optionsCsv: (p.options ?? []).join(', '),
  min: p.min !== undefined ? String(p.min) : '', max: p.max !== undefined ? String(p.max) : '',
  default: p.default !== undefined ? String(p.default) : '', required: p.required, modifiable: p.modifiable,
  fromPool: p.fromPool ?? '', constraint: p.constraint,
})

/** Which version of a family is its "published" row: the current Active one;
 *  failing that, the newest Retired one (a fresh, never-activated family is
 *  handled separately below, since it has no such row at all). */
const pickPublished = (versions: ServiceIntent[]): ServiceIntent | undefined => {
  const active = versions.find((v) => v.state === 'Active')
  if (active) return active
  const retired = versions.filter((v) => v.state === 'Retired').sort((a, b) => b.version - a.version)
  return retired[0]
}

/** One row per family for its published version, PLUS a separate row for
 *  every pending Draft — editing an Active intent's parameters forks a new
 *  Draft rather than overwriting it (see `applyParamChange` in the store),
 *  and that Draft needs its own row with its own row-level Activate action
 *  rather than staying invisible behind the published row until someone
 *  happens to open its version history. */
const listRows = (allIntents: ServiceIntent[]): ServiceIntent[] => {
  const groups = new Map<string, ServiceIntent[]>()
  allIntents.forEach((i) => groups.set(i.familyId, [...(groups.get(i.familyId) ?? []), i]))
  const rows: ServiceIntent[] = []
  groups.forEach((versions) => {
    const published = pickPublished(versions)
    const drafts = versions.filter((v) => v.state === 'Draft').sort((a, b) => b.version - a.version)
    if (published) rows.push(published)
    /* A brand-new, never-activated family has no published row — its sole
       Draft is that family's only row, already covered by this loop. */
    drafts.forEach((d) => rows.push(d))
  })
  return rows
}

export default function ServiceIntents() {
  const intents = useStore((s) => s.intents)
  const profileTypes = useStore((s) => s.profileTypes)
  const workflows = useStore((s) => s.workflows)
  const addIntent = useStore((s) => s.addIntent)
  const addIntentParam = useStore((s) => s.addIntentParam)
  const updateIntentParam = useStore((s) => s.updateIntentParam)
  const removeIntentParam = useStore((s) => s.removeIntentParam)
  const reorderIntentParam = useStore((s) => s.reorderIntentParam)
  const deleteIntent = useStore((s) => s.deleteIntent)
  const setIntentState = useStore((s) => s.setIntentState)
  const pushToast = useStore((s) => s.pushToast)

  const [q, setQ] = useQueryState('q', '')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [topology, setTopology] = useQueryState<ServiceIntent['topology'] | 'All'>('topology', 'All')
  const [state, setState] = useQueryState<ServiceIntentState | 'All'>('state', 'All')
  const domainCats = domain === 'All' ? CATS : CATEGORIES_BY_DOMAIN[domain]
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<IntentForm>(blankIntentForm())
  const [manageId, setManageId] = useState<string | null>(null)
  const [paramForm, setParamForm] = useState<ParamForm | null>(null)

  const manageIntent = manageId ? intents.find((i) => i.id === manageId) ?? null : null
  const linkedProfileType = manageIntent?.profileTypeId ? profileTypes.find((p) => p.id === manageIntent.profileTypeId) : undefined
  const versionHistory = useMemo(
    () => (manageIntent ? intents.filter((i) => i.familyId === manageIntent.familyId).sort((a, b) => b.version - a.version) : []),
    [intents, manageIntent],
  )

  /* Every id-returning mutation follows the edit to wherever it landed —
     itself, if the open version is already a Draft; a freshly forked Draft
     otherwise — so the drawer always shows the row that now holds the change. */
  const follow = (id: string) => setManageId(id)

  const usage = useMemo(() => {
    const m = new Map<string, number>()
    workflows.forEach((w) => m.set(w.intentId, (m.get(w.intentId) ?? 0) + 1))
    return m
  }, [workflows])

  const families = useMemo(() => listRows(intents), [intents])
  /* One representative per family (its published version, or its sole Draft
     if never activated) — for the aggregate stats below, so a pending Draft
     showing up as its own extra row in `families` doesn't double-count. */
  const familyReps = useMemo(() => {
    const groups = new Map<string, ServiceIntent[]>()
    intents.forEach((i) => groups.set(i.familyId, [...(groups.get(i.familyId) ?? []), i]))
    return [...groups.values()].map((versions) => pickPublished(versions) ?? [...versions].sort((a, b) => b.version - a.version)[0])
  }, [intents])
  const familyUsage = useMemo(() => {
    const m = new Map<string, number>()
    intents.forEach((i) => m.set(i.familyId, (m.get(i.familyId) ?? 0) + (usage.get(i.id) ?? 0)))
    return m
  }, [intents, usage])

  const filtered = useMemo(() => families.filter((i) => {
    if (domain !== 'All' && domainOf(i.category) !== domain) return false
    if (cat !== 'All' && i.category !== cat) return false
    if (topology !== 'All' && i.topology !== topology) return false
    if (state !== 'All' && i.state !== state) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(i.id.toLowerCase().includes(t) || i.name.toLowerCase().includes(t) || i.type.toLowerCase().includes(t))) return false
    }
    return true
  }), [families, domain, cat, topology, state, q])

  const totalParams = useMemo(() => familyReps.reduce((n, i) => n + i.params.length, 0), [familyReps])
  const distinctTopologies = useMemo(() => new Set(familyReps.map((i) => i.topology)).size, [familyReps])
  const unused = useMemo(() => familyReps.filter((i) => !(familyUsage.get(i.familyId) ?? 0)).length, [familyReps, familyUsage])

  const submitParam = () => {
    if (!manageIntent || !paramForm) return
    const name = paramForm.name.trim()
    if (!name) return
    const param: IntentParam = {
      name, type: paramForm.type, constraint: paramForm.constraint.trim(), modifiable: paramForm.modifiable, required: paramForm.required,
      ...(paramForm.type === 'enum' && paramForm.optionsCsv.trim()
        ? { options: paramForm.optionsCsv.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      ...(paramForm.type === 'integer' && paramForm.min !== '' ? { min: Number(paramForm.min) } : {}),
      ...(paramForm.type === 'integer' && paramForm.max !== '' ? { max: Number(paramForm.max) } : {}),
      ...(paramForm.fromPool ? { fromPool: paramForm.fromPool } : {}),
      ...(paramForm.default !== '' ? { default: paramForm.type === 'boolean' ? paramForm.default === 'true' : paramForm.default } : {}),
    }
    if (paramForm.mode === 'add') {
      follow(addIntentParam(manageIntent.id, param))
    } else if (paramForm.original) {
      if (paramForm.original === name) {
        follow(updateIntentParam(manageIntent.id, paramForm.original, param))
      } else {
        /* A rename is a remove + an add. If this version isn't a Draft, the
           remove forks a new one — chain the add onto *that* returned id
           rather than the original, or it would fork a second, separate
           draft instead of landing both halves of the rename on the same one. */
        const afterRemove = removeIntentParam(manageIntent.id, paramForm.original)
        follow(addIntentParam(afterRemove, param))
      }
    }
    setParamForm(null)
  }
  /* Covers both a brand-new name and an edit that renames onto an existing
     one — excluding the row being edited itself. */
  const duplicateParamName = !!manageIntent && !!paramForm
    && manageIntent.params.some((p) => p.name === paramForm.name.trim() && p.name !== paramForm.original)

  const handleDeleteVersion = (id: string) => {
    deleteIntent(id)
    if (id === manageId) setManageId(null)
  }

  const columns: Column<ServiceIntent>[] = [
    { key: 'id', header: 'Code', width: '160px', sortValue: (r) => r.id, render: (r) => <Mono className="text-[12px]">{r.id}</Mono> },
    {
      key: 'name', header: 'Name', sortValue: (r) => r.name,
      render: (r) => (
        <>
          <CellMain>{r.name}</CellMain>
          {r.state === 'Draft' && intents.some((x) => x.familyId === r.familyId && x.id !== r.id) && (
            <CellSub>Pending update to v{r.version} — not yet activated</CellSub>
          )}
        </>
      ),
    },
    {
      key: 'state', header: 'State', width: '124px', sortValue: (r) => r.state,
      render: (r) => <Badge tone={WORKFLOW_TONE[r.state]} dot={r.state === 'Active'}>{r.state} · v{r.version}</Badge>,
    },
    { key: 'cat', header: 'Category', width: '110px', sortValue: (r) => r.category, render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge> },
    { key: 'topology', header: 'Topology', width: '130px', sortValue: (r) => r.topology, render: (r) => r.topology },
    { key: 'params', header: 'Params', align: 'center', width: '80px', sortValue: (r) => r.params.length, render: (r) => <span className="tnum">{r.params.length}</span> },
    {
      key: 'used', header: 'Workflows', align: 'center', width: '100px',
      sortValue: (r) => familyUsage.get(r.familyId) ?? 0,
      render: (r) => { const n = familyUsage.get(r.familyId) ?? 0; return n ? <span className="font-medium tnum">{n}</span> : <Badge tone="none">unused</Badge> },
    },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'Manage parameters', icon: SlidersHorizontal, onClick: () => setManageId(r.id) },
          ...(r.state !== 'Active' ? [{ label: 'Activate', icon: CheckCircle2, onClick: () => setIntentState(r.id, 'Active') }] : []),
          ...(r.state === 'Active' ? [{ label: 'Retire', icon: Archive, onClick: () => setIntentState(r.id, 'Retired'), danger: true }] : []),
          ...(r.state === 'Draft' ? [{ label: 'Delete draft', icon: Trash2, onClick: () => handleDeleteVersion(r.id), danger: true }] : []),
        ]} />
      ),
    },
  ]

  return (
    <>
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Service intents" icon={Layers} value={familyReps.length} note="Blueprint contracts across every domain"
          info="Every Service Intent is the architectural contract a workflow implements — its topology, endpoint arity and the parameters a request for it can supply."
          drillLabel="every service intent" onClick={() => setCat('All')} />
        <Stat label="Topologies" icon={GitBranch} value={distinctTopologies} note="Single-ended, Two-ended, Star, Full mesh"
          info="The shapes a Service Intent's topology can take — how many endpoints a circuit built from it has, and how they relate."
          drillLabel="every topology" onClick={() => setTopology('All')} />
        <Stat label="Total parameters" icon={SlidersHorizontal} value={totalParams} note="On each intent's current version"
          info="Every parameter each intent's current version defines — the full vocabulary a workflow's commands and a request's form can draw from."
          drillLabel="every parameter" onClick={() => setCat('All')} />
        <Stat label="Unused" icon={CircleAlert} value={unused} tone={unused > 0 ? 'warn' : 'good'}
          note={unused > 0 ? 'No workflow implements these yet' : 'Every intent has a workflow'}
          info="Service Intents no workflow — at any version — references yet. An order that selects one of these can't be fulfilled until a workflow is built for it."
          drillLabel="every unused intent" onClick={() => setCat('All')} />
      </div>

      <DataTable
        rows={filtered} total={families.length} columns={columns} minWidth={960}
        fillHeight
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Code, Name, Type' },
          /* Transport / Access / Radio / Fiber as options inside one Domain
             dropdown, rather than a pill per value. */
          chips: [
            <FieldDropdown key="domain" label="Domain" value={domain} onChange={(v) => setDomainScoped(v as Domain | 'All')}
              options={DOMAINS.map((d) => ({ value: d, label: d, count: intents.filter((i) => domainOf(i.category) === d).length }))} />,
          ],
          filters: [
            { key: 'state', label: 'State', value: state, onChange: (v) => setState(v as ServiceIntentState | 'All'),
              options: STATES.map((s) => ({ value: s, label: s, count: families.filter((i) => i.state === s).length })) },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: domainCats.map((c) => ({ value: c, label: c, count: families.filter((i) => i.category === c).length })) },
            { key: 'topology', label: 'Topology', value: topology, onChange: (v) => setTopology(v as ServiceIntent['topology'] | 'All'),
              options: TOPOLOGIES.map((t) => ({ value: t, label: t, count: families.filter((i) => i.topology === t).length })) },
          ],
          onResetFilters: () => { setDomain('All'); setCat('All'); setTopology('All'); setState('All'); setQ('') },
          onRefresh: () => pushToast('info', 'Service intents refreshed.'),
          actions: [{ label: 'Create service intent', icon: Plus, onClick: () => { setForm(blankIntentForm()); setOpen(true) } }],
        }}
      />

      {/* -------- create -------- */}
      <Modal
        open={open} onClose={() => setOpen(false)}
        title="Create service intent" sub="Starts as Draft — activate it from the list once its parameters are defined"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.profileTypeId || !form.name.trim() || !form.endpointArity.trim()}
              onClick={() => { addIntent(form); setForm(blankIntentForm()); setOpen(false) }}
            >Create</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Profile Type" required hint="Category → Type → Subtype this intent is built from.">
            <Select value={form.profileTypeId} onChange={(e) => setForm({ ...form, profileTypeId: e.target.value })}>
              <option value="">Select a profile type</option>
              {profileTypes.map((p) => <option key={p.id} value={p.id}>{p.category} · {p.type} · {p.subtype}</option>)}
            </Select>
          </Field>
          <Field label="Name" required>
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="L3VPN Hub & Spoke" />
          </Field>
          <Field label="Topology" required>
            <Select value={form.topology} onChange={(e) => setForm({ ...form, topology: e.target.value as ServiceIntent['topology'] })}>
              {TOPOLOGIES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Endpoint arity" required hint="For example exactly 2, exactly 1, or 1 hub + 1…n spokes.">
            <TextInput value={form.endpointArity} onChange={(e) => setForm({ ...form, endpointArity: e.target.value })} placeholder="exactly 2" />
          </Field>
          <Note tone="info">
            Profile Type, name, topology and endpoint arity are permanent once created — there's no edit for them afterwards.
            Only the parameter catalog can change later, and every change to it opens as a new Draft version rather than
            overwriting this one.
          </Note>
        </div>
      </Modal>

      {/* -------- manage -------- */}
      <Drawer
        open={!!manageIntent} onClose={() => { setManageId(null); setParamForm(null) }}
        title={manageIntent?.name ?? ''} sub={manageIntent?.id} width={680}
        footer={manageIntent && (
          <>
            {manageIntent.state !== 'Active' && (
              <Button onClick={() => setIntentState(manageIntent.id, 'Active')}><CheckCircle2 size={15} />Activate</Button>
            )}
            {manageIntent.state === 'Active' && (
              <Button onClick={() => setIntentState(manageIntent.id, 'Retired')}><Archive size={15} />Retire</Button>
            )}
            {manageIntent.state === 'Draft' && (
              <Button variant="danger" onClick={() => handleDeleteVersion(manageIntent.id)}><Trash2 size={15} />Delete draft</Button>
            )}
          </>
        )}
      >
        {manageIntent && (
          <div className="flex flex-col gap-5">
            <div className="border border-line rounded-lg px-4 py-4 bg-plane/50">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">Topology</div>
                <Badge tone={WORKFLOW_TONE[manageIntent.state]} dot={manageIntent.state === 'Active'}>{manageIntent.state} · v{manageIntent.version}</Badge>
              </div>
              <div className="flex items-center flex-wrap gap-x-2.5 gap-y-2 mb-3">
                <Badge tone={CATEGORY_TONE[manageIntent.category]}>{manageIntent.category}</Badge>
                <ChevronRight size={15} className="text-ink-3 shrink-0" aria-hidden />
                <span className="text-[14px] font-medium text-ink-1">{manageIntent.type}</span>
                {linkedProfileType && (
                  <>
                    <ChevronRight size={15} className="text-ink-3 shrink-0" aria-hidden />
                    <span className="text-[14px] font-semibold text-ink-1">{linkedProfileType.subtype}</span>
                  </>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><div className="vw-label mb-1">Topology</div><div className="vw-value font-medium">{manageIntent.topology}</div></div>
                <div><div className="vw-label mb-1">Endpoint arity</div><div className="vw-value font-medium">{manageIntent.endpointArity}</div></div>
                <div><div className="vw-label mb-1">Live services</div><div className="vw-value font-medium tnum">{manageIntent.liveServices}</div></div>
              </div>
              {manageIntent.state !== 'Active' && (
                <Note tone={manageIntent.state === 'Draft' ? 'info' : 'warn'} className="mt-3">
                  {manageIntent.state === 'Draft'
                    ? 'Draft — not yet selectable in the Workflow Builder. Activate it once its parameters are ready.'
                    : 'Retired — no longer selectable for new workflows. Existing workflows built against it are unaffected.'}
                </Note>
              )}
            </div>

            {versionHistory.length > 1 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">
                  <History size={13} />Version history
                </div>
                <div className="flex flex-col gap-1.5" aria-label="Version history">
                  {versionHistory.map((v) => (
                    <div key={v.id} className={`flex items-center justify-between gap-3 rounded-[var(--vw-radius-sm)] border px-3 py-2 ${v.id === manageIntent.id ? 'border-brand-300 bg-brand-50' : 'border-line'}`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Badge tone={WORKFLOW_TONE[v.state]} dot={v.state === 'Active'}>v{v.version} · {v.state}</Badge>
                        <span className="text-[12px] text-ink-3 tnum">{v.params.length} param{v.params.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {v.id !== manageIntent.id && (
                          <button aria-label={`View version ${v.version}`} onClick={() => setManageId(v.id)} className="nst-icon-btn w-7 h-7"><Eye size={13} /></button>
                        )}
                        {v.state === 'Draft' && (
                          <button aria-label={`Delete version ${v.version}`} onClick={() => handleDeleteVersion(v.id)} className="nst-icon-btn w-7 h-7 text-crit-500"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">Parameters</div>
                {!paramForm && (
                  <button type="button" onClick={() => setParamForm(blankParamForm())} className="nst-btn nst-btn--xs nst-btn--ghost text-brand-600">
                    <Plus size={13} />Add parameter
                  </button>
                )}
              </div>
              {manageIntent.state !== 'Draft' && (
                <Note tone="info" className="mb-2">
                  This version is {manageIntent.state.toLowerCase()} and frozen. Adding, editing, deleting or reordering a
                  parameter opens a new Draft version with that change — this one stays exactly as published.
                </Note>
              )}

              {manageIntent.params.length ? (
                <div className="nst-table-card border-0 rounded-none shadow-none">
                  {/* `.nst-table-card`'s overflow: hidden only clips corners — without this inner
                      scroll wrapper (and a table wider than the drawer) a 9-column row runs off the
                      edge of a 680px drawer with no way to reach the Edit/Delete buttons at all. */}
                  <div className="overflow-x-auto">
                  <table className="nst-table" style={{ minWidth: 860 }}>
                    <thead><tr>
                      <th className="w-[52px]"></th><th>Name</th><th className="w-[76px]">Type</th><th className="w-[64px]">Min</th><th className="w-[64px]">Max</th>
                      <th className="w-[90px]">Default</th><th className="w-[76px]">Required</th><th>Description</th><th className="w-[76px]"></th>
                    </tr></thead>
                    <tbody>
                      {manageIntent.params.map((p, i, arr) => (
                        <tr key={p.name}>
                          <td>
                            <div className="flex gap-0.5">
                              <button aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => follow(reorderIntentParam(manageIntent.id, p.name, -1))} className="nst-icon-btn w-6 h-6 disabled:opacity-25"><ArrowUp size={12} /></button>
                              <button aria-label={`Move ${p.name} down`} disabled={i === arr.length - 1} onClick={() => follow(reorderIntentParam(manageIntent.id, p.name, 1))} className="nst-icon-btn w-6 h-6 disabled:opacity-25"><ArrowDown size={12} /></button>
                            </div>
                          </td>
                          <td><Mono className="text-[12px]">{p.name}</Mono></td>
                          <td className="text-[12px] text-ink-3">{p.type}</td>
                          <td className="text-[12px] text-ink-3 tnum">{p.min ?? '—'}</td>
                          <td className="text-[12px] text-ink-3 tnum">{p.max ?? '—'}</td>
                          <td className="text-[12px] text-ink-3">{p.default !== undefined ? String(p.default) : '—'}</td>
                          <td className="text-[12px] text-ink-3">{p.required ? 'Yes' : 'No'}</td>
                          <td className="text-[12px] text-ink-2 truncate max-w-[160px]" title={p.constraint}>{p.constraint || '—'}</td>
                          <td>
                            <div className="flex gap-1 justify-end">
                              <button aria-label={`Edit ${p.name}`} onClick={() => setParamForm(paramFormFrom(p))} className="nst-icon-btn w-7 h-7"><Pencil size={13} /></button>
                              <button aria-label={`Delete ${p.name}`} onClick={() => follow(removeIntentParam(manageIntent.id, p.name))} className="nst-icon-btn w-7 h-7 text-crit-500"><Trash2 size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              ) : <p className="text-[13px] text-ink-3 m-0">No parameters defined yet.</p>}

              {manageIntent.liveServices > 0 && (
                <Note tone="warn" className="mt-2">
                  {manageIntent.liveServices} live service(s) already use this version — a parameter change here only
                  ever lands on a new Draft, so nothing already deployed is affected.
                </Note>
              )}

              {paramForm && (
                <div className="vw-card-section mt-3 p-3.5 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name" required>
                      <TextInput value={paramForm.name} onChange={(e) => setParamForm({ ...paramForm, name: e.target.value })} placeholder="bandwidth_mbps" className="font-mono" />
                    </Field>
                    <Field label="Type" required>
                      <Select value={paramForm.type} onChange={(e) => setParamForm({ ...paramForm, type: e.target.value as IntentParam['type'] })}>
                        {PARAM_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </Select>
                    </Field>
                  </div>
                  {paramForm.type === 'enum' && (
                    <Field label="Options" hint="Comma-separated">
                      <TextInput value={paramForm.optionsCsv} onChange={(e) => setParamForm({ ...paramForm, optionsCsv: e.target.value })} placeholder="tagged, transparent" />
                    </Field>
                  )}
                  {paramForm.type === 'integer' && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Min"><TextInput type="number" value={paramForm.min} onChange={(e) => setParamForm({ ...paramForm, min: e.target.value })} /></Field>
                      <Field label="Max"><TextInput type="number" value={paramForm.max} onChange={(e) => setParamForm({ ...paramForm, max: e.target.value })} /></Field>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Default"><TextInput value={paramForm.default} onChange={(e) => setParamForm({ ...paramForm, default: e.target.value })} /></Field>
                    <Field label="Modifiable">
                      <Select value={paramForm.modifiable} onChange={(e) => setParamForm({ ...paramForm, modifiable: e.target.value as IntentParam['modifiable'] })}>
                        {MODIFIABLE.map((m) => <option key={m}>{m}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3 items-end">
                    <Field label="From pool">
                      <Select value={paramForm.fromPool} onChange={(e) => setParamForm({ ...paramForm, fromPool: e.target.value as PoolKind | '' })}>
                        <option value="">None</option>
                        {POOL_KINDS.map((k) => <option key={k}>{k}</option>)}
                      </Select>
                    </Field>
                    <Toggle checked={paramForm.required} onChange={(v) => setParamForm({ ...paramForm, required: v })} label="Mandatory field" />
                  </div>
                  <Field label="Description" hint="Shown as the field's validation hint">
                    <TextInput value={paramForm.constraint} onChange={(e) => setParamForm({ ...paramForm, constraint: e.target.value })} placeholder="10-10000 Mbps" />
                  </Field>
                  {duplicateParamName && <Note tone="warn">A parameter named "{paramForm.name.trim()}" already exists on this intent.</Note>}
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" onClick={() => setParamForm(null)}>Cancel</Button>
                    <Button size="sm" variant="primary" disabled={!paramForm.name.trim() || duplicateParamName} onClick={submitParam}>
                      {paramForm.mode === 'add' ? 'Add' : 'Save'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </>
  )
}
