import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { CheckCircle2, Clock, Copy, Download, Eye, Grid3x3, ListChecks, Pencil, Plus, Router, Send, ShieldCheck, Trash2, Network as SwitchIcon, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Vendor, Workflow, WorkflowState } from '@/types'
import {
  Badge, Card, CardBody, CardHead, CellMain, Chip, DataTable,
  FilterBanner, Kebab, Mono, Note, Stat, type Column,
} from '@/components/ui'
import { CoverageMatrix, type CoverageCol } from '@/components/charts'
import { ROUTER_VENDORS, SWITCH_VENDORS } from '@/data/catalog'
import { VENDOR_LABEL } from '@/data/workflows'
import { CATEGORY_TONE, WORKFLOW_TONE } from '@/lib/format'

const STATES: WorkflowState[] = ['Draft', 'Assigned', 'Awaiting approval', 'Active', 'Rejected', 'Retired']
const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW']
/* Router vendors first (they can carry any intent), then Switch vendors
   (L2VPN only — a switch has no BGP/VRF to run an L3VPN or IBW intent with). */
const VENDOR_COLS: Vendor[] = [...ROUTER_VENDORS, ...SWITCH_VENDORS]
const VENDOR_COVER_COLS: CoverageCol[] = VENDOR_COLS.map((v) => ({
  key: v, label: VENDOR_LABEL[v], sub: SWITCH_VENDORS.includes(v) ? 'Switch' : 'Router',
  icon: SWITCH_VENDORS.includes(v) ? SwitchIcon : Router,
}))

export default function Workflows() {
  const workflows = useStore((s) => s.workflows)
  const intents = useStore((s) => s.intents)
  const setState = useStore((s) => s.setWorkflowState)
  const pushToast = useStore((s) => s.pushToast)
  const nav = useNavigate()

  const [q, setQ] = useQueryState('q', '')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [st, setSt] = useQueryState<WorkflowState | 'All' | string>('state', 'All')
  const [intentId, setIntentId] = useQueryState('intent', 'All')
  const [vendor, setVendor] = useQueryState<Vendor | 'All'>('vendor', 'All')
  const stList = st === 'All' ? [] : st.split(',')
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'cat', 'state', 'intent', 'vendor'])
  const anyFilter = cat !== 'All' || st !== 'All' || intentId !== 'All' || vendor !== 'All'
  const resultsRef = useScrollToResultsOnDrillIn(anyFilter)

  const n = {
    state: (s: WorkflowState) => workflows.filter((w) => w.state === s).length,
    cat: (c: Category) => workflows.filter((w) => w.category === c).length,
  }

  const filtered = useMemo(() => workflows.filter((w) => {
    if (cat !== 'All' && w.category !== cat) return false
    if (stList.length && !stList.includes(w.state)) return false
    if (intentId !== 'All' && w.intentId !== intentId) return false
    if (vendor !== 'All' && w.vendor !== vendor) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(w.id.toLowerCase().includes(t) || w.name.toLowerCase().includes(t) || w.vendor.toLowerCase().includes(t) || w.model.toLowerCase().includes(t))) return false
    }
    return true
  }), [workflows, cat, st, intentId, vendor, q]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Coverage: which intent × vendor combinations actually have an active workflow. */
  const coverage = useMemo(() => {
    const map = new Map<string, { built: number; draft: number }>()
    workflows.forEach((w) => {
      const k = `${w.intentId}|${w.vendor}`
      const cur = map.get(k) ?? { built: 0, draft: 0 }
      if (w.state === 'Active') cur.built += 1
      else if (w.state === 'Draft' || w.state === 'Assigned') cur.draft += 1
      map.set(k, cur)
    })
    return map
  }, [workflows])

  /* A Switch vendor has no BGP/VRF, so it can only ever cover an L2VPN
     intent — those cells are "not applicable", not a real gap, and must be
     excluded from the denominator or Coverage% would be permanently deflated
     by combinations that can never be built. */
  const applicablePairs = useMemo(() => intents.flatMap((i) => VENDOR_COLS
    .filter((v) => i.category === 'L2VPN' || !SWITCH_VENDORS.includes(v))
    .map((v) => `${i.id}|${v}`)), [intents]) // eslint-disable-line react-hooks/exhaustive-deps
  const built = applicablePairs.filter((k) => (coverage.get(k)?.built ?? 0) > 0).length
  const draftCombos = applicablePairs.filter((k) => (coverage.get(k)?.built ?? 0) === 0 && (coverage.get(k)?.draft ?? 0) > 0).length
  const combinations = applicablePairs.length
  const gaps = combinations - built
  const coveragePct = combinations > 0 ? Math.round((built / combinations) * 100) : 100

  const columns: Column<Workflow>[] = [
    {
      key: 'state', header: 'Status', width: '120px', sortValue: (r) => r.state,
      render: (r) => <Badge tone={WORKFLOW_TONE[r.state]}>{r.state}</Badge>,
    },
    {
      key: 'wf', header: 'Name', width: '340px', sortValue: (r) => r.name,
      render: (r) => <CellMain><span className="block truncate max-w-[330px]" title={r.name}>{r.name}</span></CellMain>,
    },
    { key: 'code', header: 'Code', width: '110px', sortValue: (r) => r.id, render: (r) => <Mono>{r.id}</Mono> },
    { key: 'cat', header: 'Category', width: '110px', sortValue: (r) => r.category, render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge> },
    { key: 'type', header: 'Type', width: '140px', sortValue: (r) => r.type, render: (r) => r.type },
    { key: 'sub', header: 'Subtype', width: '110px', sortValue: (r) => r.subtype, render: (r) => r.subtype },
    { key: 'vendor', header: 'Vendor', width: '110px', sortValue: (r) => r.vendor, render: (r) => VENDOR_LABEL[r.vendor] },
    { key: 'version', header: 'Version', align: 'right', width: '84px', sortValue: (r) => r.version, render: (r) => r.version },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/workflows/${r.id}`) },
          { label: 'Edit workflow', icon: Pencil, onClick: () => nav(`/workflows/${r.id}?edit=1`) },
          { label: 'Clone as new version', icon: Copy, onClick: () => nav(`/workflows/new?from=${r.id}`) },
          ...(r.state === 'Draft' || r.state === 'Assigned' || r.state === 'Rejected'
            ? [{ label: 'Send for approval', icon: Send, onClick: () => setState(r.id, 'Awaiting approval') }]
            : []),
          ...(r.state === 'Awaiting approval' ? [{ label: 'Approve & activate', icon: ShieldCheck, onClick: () => setState(r.id, 'Active') },
            { label: 'Reject', icon: XCircle, onClick: () => setState(r.id, 'Rejected'), danger: true }] : []),
          ...(r.state === 'Active' ? [{ label: 'Retire', icon: Trash2, onClick: () => setState(r.id, 'Retired'), danger: true }] : []),
        ]} />
      ),
    },
  ]

  return (
    <>

      <FilterBanner
        count={filtered.length} noun="workflows" onClear={clear}
        filters={[
          ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
          ...(st !== 'All' ? [{ key: 'state', label: 'State', value: stList.join(' or '), onRemove: () => setSt('All') }] : []),
          ...(intentId !== 'All' ? [{ key: 'intent', label: 'Intent', value: intents.find((i) => i.id === intentId)?.name ?? intentId, onRemove: () => setIntentId('All') }] : []),
          ...(vendor !== 'All' ? [{ key: 'vendor', label: 'Vendor', value: vendor, onRemove: () => setVendor('All') }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Total workflows" icon={ListChecks} value={workflows.length}
          progress={(n.state('Active') / Math.max(1, workflows.length)) * 100}
          note={`${n.state('Active')} active · ${n.state('Draft')} draft`}
          info="Every workflow definition in the library, in any state. A workflow is the executable recipe — tasks, assertions and acceptance criteria — that provisioning runs for one intent on one vendor and model."
          drillLabel="every workflow, unfiltered" onClick={clear} />
        <Stat label="Active" icon={CheckCircle2} value={n.state('Active')} tone="good"
          progress={(n.state('Active') / Math.max(1, workflows.length)) * 100}
          note="Only Active workflows can be executed"
          info="Workflows that have been approved and published. Only these can be picked up by a provisioning request — everything else is still being authored or reviewed."
          drillLabel="active workflows" onClick={() => setSt('Active')} />
        <Stat label="Awaiting approval" icon={Clock} value={n.state('Awaiting approval') + n.state('Assigned')} tone="plum"
          progress={((n.state('Awaiting approval') + n.state('Assigned')) / Math.max(1, workflows.length)) * 100}
          note="Draft → Assigned → Awaiting approval → Active"
          info="Workflows sitting in the review queue: assigned to a reviewer or already submitted for approval. They cannot run until someone approves them."
          drillLabel="workflows waiting on approval" onClick={() => setSt('Assigned,Awaiting approval')} />
        <Stat label="Coverage" icon={Grid3x3} value={`${coveragePct}%`} tone={gaps === 0 ? 'good' : gaps > combinations / 2 ? 'crit' : 'warn'}
          progress={coveragePct}
          note={gaps === 0 ? `All ${combinations} intent × vendor combinations are covered` : `${gaps} of ${combinations} combinations have no active workflow`}
          info="The share of intent × vendor combinations that have at least one Active workflow. A gap means orders for that combination cannot be provisioned until a workflow is built and approved."
          drillLabel="draft workflows behind the remaining gaps" onClick={() => setSt('Draft')} />
      </div>

      <Card>
        <CardHead title="Coverage — intent by vendor" sub="Where an active workflow exists, and how much of the installed base rides on it"
          info="Each tile shows whether an Active workflow exists for that intent on that vendor: a green count = that many active workflows, amber Draft = authoring has started but nothing is approved, a dashed tile = nothing exists, so orders for that combination cannot run. A vendor column is marked Router or Switch — a Switch has no BGP/VRF, so it only ever appears under L2VPN; L3VPN and IBW show a plain dash (—) in that column, not a gap, because that combination can never be built. The bar on the right is the live services riding on that intent — the bigger the bar, the more revenue depends on that row's coverage. Click a tile to filter the list below, or the bar to open those services."
          right={<>
            <Badge tone="good">Built {built}</Badge>
            {draftCombos > 0 && <Badge tone="warn">Draft {draftCombos}</Badge>}
            <Badge tone={gaps > 0 ? 'crit' : 'none'}>Gap {gaps}</Badge>
          </>} />
        <CardBody>
          <CoverageMatrix
            cols={VENDOR_COVER_COLS}
            rows={intents.map((i) => ({
              key: i.id,
              label: i.name,
              sub: `${workflows.filter((w) => w.intentId === i.id).length} workflows · v${i.version}`,
              trailing: serviceCount(i.id),
            }))}
            onCellClick={(r, c) => patch({ intent: r, vendor: c, state: null, cat: null })}
            onTrailingClick={(r) => nav(`/inventory?intent=${encodeURIComponent(r)}`)}
            cell={(r, c) => {
              const i = intents.find((x) => x.id === r)
              if (i && i.category !== 'L2VPN' && SWITCH_VENDORS.includes(c as Vendor)) return { state: 'na' as const }
              const v = coverage.get(`${r}|${c}`)
              if (v?.built) return { count: v.built, state: 'built' as const }
              if (v?.draft) return { state: 'draft' as const }
              return { state: 'gap' as const }
            }}
          />
          <Note className="mt-4">
            A workflow is bound to <b>category, type, subtype, vendor and model</b>. Adding a vendor means one workflow per
            intent, not one per combination — the tasks, assertions and acceptance criteria come from the intent.
          </Note>
        </CardBody>
      </Card>

      <div ref={resultsRef} />
      <DataTable
        rows={filtered} total={workflows.length} columns={columns} pageSize={12}
        onRowClick={(r) => nav(`/workflows/${r.id}`)}
        minWidth={1180}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Name, Code, Vendor' },
          chips: CATS.map((c) => <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>),
          filters: [
            { key: 'state', label: 'Status', value: st, onChange: (v) => setSt(v),
              options: STATES.filter((x) => n.state(x) > 0).map((x) => ({ value: x, label: x, count: n.state(x) })) },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: CATS.map((c) => ({ value: c, label: c, count: n.cat(c) })) },
            { key: 'vendor', label: 'Vendor', value: vendor, onChange: (v) => setVendor(v as Vendor | 'All'),
              options: VENDOR_COLS.map((v) => ({ value: v, label: VENDOR_LABEL[v], count: workflows.filter((w) => w.vendor === v).length })) },
            { key: 'intent', label: 'Intent', value: intentId, onChange: setIntentId,
              options: intents.map((i) => ({ value: i.id, label: i.name, count: workflows.filter((w) => w.intentId === i.id).length })) },
            { key: 'q', label: 'Name / Code / Vendor', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: clear,
          onRefresh: () => pushToast('info', 'Workflow list refreshed.'),
          actions: [{ label: 'New workflow', icon: Plus, onClick: () => nav('/workflows/new') }, { label: 'Export to CSV', icon: Download, onClick: () => pushToast('info', 'Export queued — the file will appear in Reports.') }],
        }}
      />
    </>
  )

  function serviceCount(intentId: string) {
    return useStore.getState().services.filter((s) => s.intentId === intentId).length
  }
}
