import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { Copy, Download, Eye, Pencil, Plus, Send, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Vendor, Workflow, WorkflowState } from '@/types'
import {
  Badge, Card, CardBody, CardHead, CellMain, Chip, DataTable,
  FilterBanner, Kebab, Mono, Note, Stat, type Column,
} from '@/components/ui'
import { CoverageMatrix } from '@/components/charts'
import { CATEGORY_TONE, WORKFLOW_TONE } from '@/lib/format'

const STATES: WorkflowState[] = ['Draft', 'Assigned', 'Awaiting approval', 'Active', 'Rejected', 'Retired']
const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW']
const VENDOR_COLS = ['CISCO', 'JUNIPER'] as Vendor[]

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

  const built = [...coverage.values()].filter((v) => v.built > 0).length
  const gaps = intents.length * VENDOR_COLS.length - built

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
    { key: 'vendor', header: 'Vendor', width: '110px', sortValue: (r) => r.vendor, render: (r) => r.vendor },
    { key: 'version', header: 'Version', align: 'right', width: '84px', sortValue: (r) => r.version, render: (r) => r.version },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/workflows/${r.id}`) },
          { label: 'Edit workflow', icon: Pencil, onClick: () => nav(`/workflows/${r.id}?edit=1`) },
          { label: 'Clone as new version', icon: Copy, onClick: () => nav(`/workflows/new?from=${r.id}`) },
          ...(r.state === 'Draft' ? [{ label: 'Send for approval', icon: Send, onClick: () => setState(r.id, 'Awaiting approval') }] : []),
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
        <Stat label="Total workflows" value={workflows.length} note={`${n.state('Active')} active · ${n.state('Draft')} draft`}
          drillLabel="every workflow, unfiltered" onClick={clear} />
        <Stat label="Active" value={n.state('Active')} tone="good" note="Only Active workflows can be executed"
          drillLabel="active workflows" onClick={() => setSt('Active')} />
        <Stat label="Awaiting approval" value={n.state('Awaiting approval') + n.state('Assigned')} accent="var(--vw-color-purple-600)"
          note="Draft → Assigned → Awaiting approval → Active"
          drillLabel="workflows waiting on approval" onClick={() => setSt('Assigned,Awaiting approval')} />
        <Stat label="Coverage gaps" value={gaps} tone="warn" note="Intent × vendor combinations with no active workflow"
          drillLabel="draft workflows behind the gaps" onClick={() => setSt('Draft')} />
      </div>

      <Card>
        <CardHead title="Coverage — intent by vendor" sub="Where an active workflow exists, and what it is worth"
          right={<><Badge tone="good">Built {built}</Badge><Badge tone="none">Gap {gaps}</Badge></>} />
        <CardBody>
          <CoverageMatrix
            cols={VENDOR_COLS}
            rows={intents.map((i) => ({
              key: i.id,
              label: i.name,
              trailing: services(i.id),
            }))}
            onCellClick={(r, c) => patch({ intent: r, vendor: c, state: null, cat: null })}
            onTrailingClick={(r) => nav(`/inventory?intent=${encodeURIComponent(r)}`)}
            cell={(r, c) => {
              const v = coverage.get(`${r}|${c}`)
              if (v?.built) return { text: `${v.built}`, state: 'built' as const }
              if (v?.draft) return { text: 'Draft', state: 'draft' as const }
              return { text: 'Gap', state: 'gap' as const }
            }}
          />
          <Note>
            A workflow is bound to <b>category, type, subtype, vendor and model</b>. Adding a vendor means one workflow per
            intent, not one per combination — the tasks, assertions and acceptance criteria come from the intent.
          </Note>
        </CardBody>
      </Card>

      <div ref={resultsRef} />
      <DataTable
        rows={filtered} total={workflows.length} columns={columns} pageSize={12}
        onRowClick={(r) => nav(`/workflows/${r.id}`)}
        rowTone={(r) => (r.state === 'Draft' ? 'warn' : undefined)}
        minWidth={1180}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Name, Code, Vendor' },
          chips: CATS.map((c) => <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} count={n.cat(c)} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>),
          filters: [
            { key: 'state', label: 'Status', value: st, onChange: (v) => setSt(v),
              options: STATES.filter((x) => n.state(x) > 0).map((x) => ({ value: x, label: x, count: n.state(x) })) },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: CATS.map((c) => ({ value: c, label: c, count: n.cat(c) })) },
            { key: 'vendor', label: 'Vendor', value: vendor, onChange: (v) => setVendor(v as Vendor | 'All'),
              options: VENDOR_COLS.map((v) => ({ value: v, label: v, count: workflows.filter((w) => w.vendor === v).length })) },
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

  function services(intentId: string) {
    return useStore.getState().services.filter((s) => s.intentId === intentId).length.toLocaleString()
  }
}
