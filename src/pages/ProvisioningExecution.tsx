import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { BarChart3, Download, Eye, ListChecks, PlayCircle, Plus, ShieldCheck, Workflow } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Domain, Order, OrderState, Vendor } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, CellMain, CellSub, Chip, DataTable, Drawer,
  FilterBanner, KV, Kebab, Modal, Mono, Note, Progress, SegmentedToggle, type Column,
} from '@/components/ui'
import { ProvisioningInsights } from '@/components/ProvisioningInsights'
import { VENDOR_LABEL } from '@/data/workflows'
import { ageLabel, CATEGORY_TONE, clockTime, DOMAIN_TONE, ORDER_TONE, relTime } from '@/lib/format'

const EXEC_STATES: OrderState[] = [
  'Approved', 'Rejected', 'Queued', 'In progress', 'Ready', 'Failed', 'Reinstantiate',
]
const CATEGORIES: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM', 'RAN VNF']

export default function ProvisioningExecution() {
  const orders = useStore((s) => s.orders)
  const runs = useStore((s) => s.runs)
  const runsForOrder = useStore((s) => s.runsForOrder)
  const startRun = useStore((s) => s.startRun)
  const retryOrder = useStore((s) => s.retryOrder)
  const pushToast = useStore((s) => s.pushToast)
  const nav = useNavigate()

  const [q, setQ] = useQueryState('q', '')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [state, setState] = useQueryState<OrderState | 'All' | string>('state', 'All')
  const stateList = state === 'All' ? [] : state.split(',')
  const [vendor, setVendor] = useQueryState<Vendor | 'All'>('vendor', 'All')
  const [view, setView] = useQueryState<'listing' | 'insights'>('view', 'listing')
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'domain', 'cat', 'state', 'vendor'])
  const domainCats = domain === 'All' ? CATEGORIES : CATEGORIES_BY_DOMAIN[domain]
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const pickDomain = (d: Domain) => setDomainScoped(domain === d ? 'All' : d)
  const resultsRef = useScrollToResultsOnDrillIn(domain !== 'All' || cat !== 'All' || state !== 'All' || vendor !== 'All')
  const [verify, setVerify] = useState<Order | null>(null)
  const [creds, setCreds] = useState<Order | null>(null)
  /* The Requests⟷Execution toggle is a real navigation — the two screens'
     state vocabularies differ, so only domain/cat/q/view carry across. */
  const switchMode = (m: 'requests' | 'execution') => {
    if (m === 'execution') return
    const p = new URLSearchParams()
    if (domain !== 'All') p.set('domain', domain)
    if (cat !== 'All') p.set('cat', cat)
    if (q) p.set('q', q)
    p.set('view', view)
    nav(`/requests${p.toString() ? `?${p}` : ''}`)
  }

  /* Execution is the post-decision queue: drafts and anything still mid
     pre-validation (Planned) or awaiting a decision (Validated, Invalid)
     are worked from Provisioning Requests, not here. */
  const pool = useMemo(() => orders.filter((o) => !['Draft', 'Planned', 'Validated', 'Invalid'].includes(o.state)), [orders])

  const filtered = useMemo(() => pool.filter((o) => {
    if (domain !== 'All' && domainOf(o.category) !== domain) return false
    if (cat !== 'All' && o.category !== cat) return false
    if (stateList.length && !stateList.includes(o.state)) return false
    if (vendor !== 'All' && o.endpoints[0]?.vendor !== vendor) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(o.id.toLowerCase().includes(t) || o.name.toLowerCase().includes(t) || o.accountName.toLowerCase().includes(t)
        || o.endpoints.some((e) => e.deviceName.toLowerCase().includes(t)))) return false
    }
    return true
  }), [pool, domain, cat, state, vendor, q]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Same scope as `filtered` but ignoring the status filter itself — the
     Insights view breaks orders down BY status, so it needs the full
     domain/category/search selection regardless of which status slice
     Listing currently has open. */
  const scoped = useMemo(() => pool.filter((o) => {
    if (domain !== 'All' && domainOf(o.category) !== domain) return false
    if (cat !== 'All' && o.category !== cat) return false
    if (vendor !== 'All' && o.endpoints[0]?.vendor !== vendor) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(o.id.toLowerCase().includes(t) || o.name.toLowerCase().includes(t) || o.accountName.toLowerCase().includes(t)
        || o.endpoints.some((e) => e.deviceName.toLowerCase().includes(t)))) return false
    }
    return true
  }), [pool, domain, cat, vendor, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const n = (s: OrderState) => pool.filter((o) => o.state === s).length

  const runCredentialsThenExecute = (o: Order) => { setCreds(null); startRun(o.id); nav(`/execution/${o.id}?tab=lifecycle`) }

  const columns: Column<Order>[] = [
    {
      key: 'state', header: 'Status', width: '186px', sortValue: (r) => EXEC_STATES.indexOf(r.state),
      render: (r) => {
        const runs = runsForOrder(r.id)
        const live = runs.find((x) => x.outcome === 'Running')
        const done = live ? live.tasks.filter((t) => t.state === 'Passed').length : 0
        return (
          <>
            <Badge tone={ORDER_TONE[r.state]} dot>{r.state}</Badge>
            {live && (<><Progress value={(done / live.tasks.length) * 100} className="mt-2 w-28" />
              <CellSub>task {done + 1} of {live.tasks.length}</CellSub></>)}
            {r.state === 'Failed' && runs[0] && <CellSub>{runs[0].tasks.find((t) => t.state === 'Failed')?.name ?? 'see lifecycle log'}</CellSub>}
          </>
        )
      },
    },
    {
      key: 'order', header: 'Service', width: '180px', sortValue: (r) => r.id,
      render: (r) => (<><CellMain>{r.name}</CellMain><CellSub><Mono>{r.id}</Mono></CellSub></>),
    },
    { key: 'category', header: 'Category', width: '104px', sortValue: (r) => r.category, render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge> },
    {
      key: 'customer', header: 'Customer', width: '186px', sortValue: (r) => r.accountName,
      render: (r) => (<><CellMain>{r.accountName}</CellMain><CellSub><Mono>{r.accountId}</Mono></CellSub></>),
    },
    {
      key: 'workflow', header: 'Workflow', width: '150px',
      render: (r) => (r.workflowId ? <Mono className="text-ink-2">{r.workflowId}</Mono> : <span className="text-ink-3">not bound</span>),
    },
    { key: 'runs', header: 'Runs', align: 'right', width: '70px', sortValue: (r) => new Set(runsForOrder(r.id).map((x) => x.attempt)).size, render: (r) => new Set(runsForOrder(r.id).map((x) => x.attempt)).size },
    { key: 'age', header: 'Age', align: 'right', width: '74px', sortValue: (r) => r.ageDays, render: (r) => ageLabel(r.ageDays) },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => setVerify(r) },
          { label: 'Life cycle operation', icon: Workflow, onClick: () => nav(`/execution/${r.id}?tab=lifecycle`) },
          { label: 'View jobs', icon: ListChecks, onClick: () => nav(`/execution/${r.id}?tab=runs`) },
          ...(r.state === 'Approved' ? [{ label: 'Validate credentials & execute', icon: ShieldCheck, onClick: () => setCreds(r) }] : []),
          ...(r.state === 'Failed' ? [{ label: 'Retry', icon: PlayCircle, onClick: () => retryOrder(r.id) }] : []),
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="flex items-center justify-between vw-wrap gap-3">
        <SegmentedToggle
          options={[{ value: 'requests', label: 'Requests' }, { value: 'execution', label: 'Execution' }]}
          value="execution" onChange={switchMode} />
        <SegmentedToggle
          options={[{ value: 'listing', label: 'Listing', icon: ListChecks }, { value: 'insights', label: 'Insights', icon: BarChart3 }]}
          value={view} onChange={setView} />
      </div>

      <FilterBanner
        count={filtered.length} noun="requests" onClear={clear}
        filters={[
          ...(domain !== 'All' ? [{ key: 'domain', label: 'Domain', value: domain, onRemove: () => setDomain('All') }] : []),
          ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
          ...(state !== 'All' ? [{ key: 'state', label: 'Status', value: stateList.join(' or '), onRemove: () => setState('All') }] : []),
          ...(vendor !== 'All' ? [{ key: 'vendor', label: 'Vendor', value: VENDOR_LABEL[vendor], onRemove: () => setVendor('All') }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      <div className="flex items-center gap-1.5">
        {DOMAINS.map((d) => (
          <Chip key={d} tone={DOMAIN_TONE[d]} active={domain === d} onClick={() => pickDomain(d)}>{d}</Chip>
        ))}
      </div>

      {view === 'insights' ? (
        <ProvisioningInsights mode="execution" orders={scoped} runs={runs} onDrill={(p) => patch({ ...p, view: 'listing' })} />
      ) : (
        <>
          <div ref={resultsRef} />
          <DataTable
            rows={filtered} total={pool.length} columns={columns} pageSize={12}
            onRowClick={(r) => nav(`/execution/${r.id}?tab=lifecycle`)}
            toolbar={{
              search: { value: q, onChange: setQ, placeholder: 'Name, Code, Model' },
              chips: [
                ...DOMAINS.map((d) => <Chip key={d} tone={DOMAIN_TONE[d]} active={domain === d} onClick={() => pickDomain(d)}>{d}</Chip>),
                ...domainCats.map((c) => (
                  <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>
                )),
              ],
              filters: [
                { key: 'domain', label: 'Domain', value: domain, onChange: (v) => setDomainScoped(v as Domain | 'All'),
                  options: DOMAINS.map((d) => ({ value: d, label: d, count: pool.filter((o) => domainOf(o.category) === d).length })) },
                { key: 'state', label: 'Status', value: state, onChange: (v) => setState(v),
                  options: [
                    ...EXEC_STATES.filter((st) => n(st) > 0).map((st) => ({ value: st, label: st, count: n(st) })),
                    { value: 'Approved,Queued', label: 'Ready to run' },
                  ] },
                { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
                  options: domainCats.map((c) => ({ value: c, label: c, count: pool.filter((o) => o.category === c).length })) },
                { key: 'vendor', label: 'Vendor', value: vendor, onChange: (v) => setVendor(v as Vendor | 'All'),
                  options: [...new Set(pool.map((o) => o.endpoints[0]?.vendor).filter((v): v is Vendor => v !== undefined))].sort()
                    .map((v) => ({ value: v, label: VENDOR_LABEL[v], count: pool.filter((o) => o.endpoints[0]?.vendor === v).length })) },
                { key: 'q', label: 'Name / Code / Model', type: 'text', value: q, onChange: setQ },
              ],
              onResetFilters: clear,
              onRefresh: () => pushToast('info', 'Execution queue refreshed.'),
              actions: [{ label: 'New network service', icon: Plus, onClick: () => nav('/requests/new') }, { label: 'Export to CSV', icon: Download, onClick: () => pushToast('info', 'Export queued — the file will appear in Reports.') }],
            }}
          />
        </>
      )}

      {/* -------- verify details -------- */}
      <Drawer
        open={!!verify} onClose={() => setVerify(null)}
        title={verify ? `Verify details · ${verify.id}` : ''}
        sub={verify ? `${verify.name} · ${verify.accountName}` : ''}
        width={660}
        footer={verify && (
          verify.state === 'Approved' ? (
            <Button variant="primary" onClick={() => { setCreds(verify); setVerify(null) }}>
              <ShieldCheck size={15} />Validate credentials & execute
            </Button>
          ) : verify.state === 'Failed' ? (
            <Button variant="primary" onClick={() => { retryOrder(verify.id); setVerify(null) }}>
              <PlayCircle size={15} />Retry
            </Button>
          ) : undefined
        )}
      >
        {verify && (
          <div className="flex flex-col gap-5">
            <Note>Every parameter below was populated during service creation.</Note>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Request</div>
              <KV items={[
                ['Order', <Mono key="o">{verify.id}</Mono>],
                ['Code', <Mono key="c">{verify.code}</Mono>],
                ['Category / type', `${verify.category} · ${verify.type} · ${verify.subtype}`],
                ['Customer', `${verify.accountName} (${verify.accountId})`],
                ['Workflow', <Mono key="w">{verify.workflowId ?? 'not bound'}</Mono>],
                ['Created', relTime(verify.createdAt)],
              ]} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Endpoints</div>
              <div className="flex flex-col gap-2">
                {verify.endpoints.map((e) => (
                  <div key={e.id} className="border border-line rounded-lg px-3.5 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[12.5px] font-medium">{e.siteCode} <span className="text-ink-3 font-normal">· {e.deviceName}</span></div>
                      <div className="text-[11.5px] text-ink-3 font-mono">{e.port} · {e.mgmtIp}</div>
                    </div>
                    <Badge tone="none">{e.role}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Parameters</div>
              <table className="w-full text-[12.5px] border border-line rounded-lg overflow-hidden">
                <thead><tr className="bg-plane">
                  <th scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Name</th>
                  <th scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Value</th>
                  <th scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Source</th>
                </tr></thead>
                <tbody>
                  {verify.params.map((p) => (
                    <tr key={p.name} className="border-t border-line-soft">
                      <td className="px-3.5 py-2 font-mono">{p.name}</td>
                      <td className="px-3.5 py-2 font-mono font-medium">{p.value}</td>
                      <td className="px-3.5 py-2">
                        <Badge tone={p.source === 'pool' ? 'info' : p.source === 'user' ? 'none' : 'teal'}>{p.source}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>

      {/* -------- credential validation -------- */}
      <Modal
        open={!!creds} onClose={() => setCreds(null)}
        title="Validate device credentials" sub={creds ? `${creds.id} · ${creds.endpoints.length} endpoint(s)` : ''}
        footer={
          <>
            <Button onClick={() => setCreds(null)}>Later</Button>
            <Button variant="primary" onClick={() => creds && runCredentialsThenExecute(creds)}>
              <PlayCircle size={15} />Execute workflow
            </Button>
          </>
        }
      >
        {creds && (
          <div className="flex flex-col gap-3">
            {creds.endpoints.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 border border-line rounded-lg px-3.5 py-3">
                <div>
                  <div className="text-[13px] font-medium">{e.siteCode}</div>
                  <div className="text-[11.5px] text-ink-3 font-mono">{e.mgmtIp} · ssh · profile NST-EDGE</div>
                </div>
                <Badge tone="good" dot><ShieldCheck size={12} className="mr-0.5" />Reachable</Badge>
              </div>
            ))}
            <Note>Credentials are checked immediately before execution, not at design time — a profile that worked yesterday can be rotated overnight. Validated at {clockTime(new Date().toISOString())} IST.</Note>
          </div>
        )}
      </Modal>
    </>
  )
}
