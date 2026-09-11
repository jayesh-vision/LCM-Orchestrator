import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import {
  BarChart3, CheckCircle2, ClipboardCheck, Eye, ListChecks, PlayCircle, Plus,
  ShieldCheck, Workflow, XCircle,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Domain, Order, OrderIntent, OrderState, Vendor } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, CellMain, CellSub, Chip, DataTable, Drawer, Field,
  FieldDropdown, FilterBanner, KV, Kebab, Modal, Mono, Note, Progress, SegmentedToggle, stampColumn, type Column,
} from '@/components/ui'
import { ProvisioningInsights } from '@/components/ProvisioningInsights'
import { VENDOR_LABEL } from '@/data/workflows'
import { ageLabel, CATEGORY_TONE, clockTime, INTENT_TONE, ORDER_INTENTS, ORDER_TONE, relTime } from '@/lib/format'
import { byRaised, orderTrace } from '@/lib/traceability'

const CATEGORIES: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM', 'RAN VNF', 'GPON']

const STATE_ORDER: OrderState[] = [
  'Draft', 'Planned', 'Validated', 'Invalid', 'Approved', 'Rejected',
  'Queued', 'In progress', 'Ready', 'Failed', 'Reinstantiate',
]

/* Still waiting on design or a decision — a run cannot exist yet, so the
   execution columns (runs, live progress, failure sub-status) and the
   execution actions (verify, execute, retry) don't apply to these rows. */
const PRE_EXECUTION: OrderState[] = ['Draft', 'Planned', 'Validated', 'Invalid', 'Rejected']

/**
 * The one queue, end to end. Requests and Execution used to be two screens
 * over the same orders one stage apart; this shows the whole lifecycle in a
 * single grid — draft, approval, execution and outcome — with the
 * execution-specific columns and actions appearing on the rows that have
 * reached that stage.
 */
export default function ProvisioningRequests() {
  const allOrders = useStore((s) => s.orders)
  const runs = useStore((s) => s.runs)
  const runsForOrder = useStore((s) => s.runsForOrder)
  const approveOrder = useStore((s) => s.approveOrder)
  const rejectOrder = useStore((s) => s.rejectOrder)
  const startRun = useStore((s) => s.startRun)
  const retryOrder = useStore((s) => s.retryOrder)
  const pushToast = useStore((st) => st.pushToast)
  const nav = useNavigate()
  const loc = useLocation()
  const [q, setQ] = useQueryState('q', '')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  /* `state` may carry several stages, e.g. state=Failed,Rejected,Invalid */
  const [state, setState] = useQueryState<OrderState | 'All' | string>('state', 'All')
  const stateList = state === 'All' ? [] : state.split(',')
  const [vendor, setVendor] = useQueryState<Vendor | 'All'>('vendor', 'All')
  const [intent, setIntent] = useQueryState<OrderIntent | 'All'>('intent', 'All')
  /* Off by default: this screen is a queue of work in flight. The archive is
     every create this platform has ever completed, which is provenance for
     Service Inventory rather than something anyone is working on. */
  const [history, setHistory] = useQueryState('history', 'off')
  const [customer, setCustomer] = useQueryState('customer', '')
  /* Independent name/code/model filters for the popover — separate from
     the toolbar's broad `q` search box, which still matches across all
     three at once for a quick look-up. */
  const [qname, setQname] = useQueryState('name', '')
  const [qcode, setQcode] = useQueryState('code', '')
  const [qmodel, setQmodel] = useQueryState('model', '')
  const [view, setView] = useQueryState<'listing' | 'insights'>('view', 'insights')
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'domain', 'cat', 'state', 'vendor', 'intent', 'customer', 'name', 'code', 'model', 'history'])
  const domainCats = domain === 'All' ? CATEGORIES : CATEGORIES_BY_DOMAIN[domain]
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const drill = [domain, cat, state, vendor, intent].every((v) => v === 'All')
    ? '' : `d=${domain}|c=${cat}|s=${state}|v=${vendor}|i=${intent}`
  const { ref: resultsRef } = useScrollToResultsOnDrillIn(drill)
  /* Carried into every row detail this grid opens, so its Back button returns
     to this grid with the same filters still applied and on the Listing tab
     it was clicked from — rather than to a bare path that reopens the
     default view and drops the selection. */
  const fromList = useMemo(() => {
    const p = new URLSearchParams(loc.search)
    p.set('view', 'listing')
    return { state: { fromList: `?${p}` } }
  }, [loc.search])

  const [reject, setReject] = useState<Order | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [verify, setVerify] = useState<Order | null>(null)
  const [creds, setCreds] = useState<Order | null>(null)

  const doApprove = (o: Order) => { approveOrder(o.id, 'Ravi K.'); pushToast('good', `${o.id} approved — ready to run once credentials are validated.`) }
  const runCredentialsThenExecute = (o: Order) => { setCreds(null); startRun(o.id); nav(`/requests/${o.id}?tab=lifecycle`, fromList) }

  const orders = useMemo(
    () => (history === 'on' ? allOrders : allOrders.filter((o) => !o.archived)),
    [allOrders, history],
  )
  const archivedCount = useMemo(() => allOrders.filter((o) => o.archived).length, [allOrders])

  const byCategory = useMemo(() => {
    const m = new Map<Category, Order[]>()
    CATEGORIES.forEach((c) => m.set(c, []))
    orders.forEach((o) => m.get(o.category)?.push(o))
    return m
  }, [orders])

  const filtered = useMemo(() => orders.filter((o) => {
    if (domain !== 'All' && domainOf(o.category) !== domain) return false
    if (cat !== 'All' && o.category !== cat) return false
    if (stateList.length && !stateList.includes(o.state)) return false
    if (vendor !== 'All' && o.endpoints[0]?.vendor !== vendor) return false
    if (intent !== 'All' && o.intent !== intent) return false
    if (customer && !o.accountName.toLowerCase().includes(customer.toLowerCase())) return false
    if (qname && !o.name.toLowerCase().includes(qname.toLowerCase())) return false
    if (qcode && !o.code.toLowerCase().includes(qcode.toLowerCase())) return false
    if (qmodel && !o.endpoints.some((e) => e.deviceName.toLowerCase().includes(qmodel.toLowerCase()))) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(o.id.toLowerCase().includes(t) || o.code.toLowerCase().includes(t)
        || o.name.toLowerCase().includes(t) || o.accountName.toLowerCase().includes(t)
        || o.endpoints.some((e) => e.deviceName.toLowerCase().includes(t)))) return false
    }
    return true
  }), [orders, domain, cat, state, vendor, intent, customer, qname, qcode, qmodel, q]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Newest first — raise a change against a service and the request for it is
     the top row here, which is where someone goes looking for it. Within the
     same moment, requests that can actually be followed — through to the
     service they produced, the run that executed them and the template on each
     endpoint — lead. Sorting a column still overrides both. */
  const ranked = useMemo(() => {
    const withRun = new Set(runs.map((r) => r.orderId))
    return byRaised(filtered, (o) => o.createdAt, (o) => orderTrace(o, (id) => withRun.has(id)))
  }, [filtered, runs])

  /* Same scope as `filtered` but ignoring the status filter itself — the
     Insights view breaks requests down BY status, so it needs the full
     domain/category/search selection regardless of which status slice
     Listing currently has open. */
  const scoped = useMemo(() => orders.filter((o) => {
    if (domain !== 'All' && domainOf(o.category) !== domain) return false
    if (cat !== 'All' && o.category !== cat) return false
    if (vendor !== 'All' && o.endpoints[0]?.vendor !== vendor) return false
    if (intent !== 'All' && o.intent !== intent) return false
    if (customer && !o.accountName.toLowerCase().includes(customer.toLowerCase())) return false
    if (qname && !o.name.toLowerCase().includes(qname.toLowerCase())) return false
    if (qcode && !o.code.toLowerCase().includes(qcode.toLowerCase())) return false
    if (qmodel && !o.endpoints.some((e) => e.deviceName.toLowerCase().includes(qmodel.toLowerCase()))) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(o.id.toLowerCase().includes(t) || o.code.toLowerCase().includes(t)
        || o.name.toLowerCase().includes(t) || o.accountName.toLowerCase().includes(t)
        || o.endpoints.some((e) => e.deviceName.toLowerCase().includes(t)))) return false
    }
    return true
  }), [orders, domain, cat, vendor, intent, customer, qname, qcode, qmodel, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const columns: Column<Order>[] = [
    {
      /* One status cell for the whole lifecycle: the badge for every row,
         plus what execution adds once it exists — live task progress while a
         run is on a device, and the failed task's name when one failed. */
      key: 'state', header: 'Status', width: '186px',
      sortValue: (r) => STATE_ORDER.indexOf(r.state),
      render: (r) => {
        const rr = runsForOrder(r.id)
        const live = rr.find((x) => x.outcome === 'Running')
        const done = live ? live.tasks.filter((t) => t.state === 'Passed').length : 0
        return (
          <>
            <Badge tone={ORDER_TONE[r.state]} dot>{r.state}</Badge>
            {live && (<><Progress value={(done / live.tasks.length) * 100} className="mt-2 w-28" />
              <CellSub>task {done + 1} of {live.tasks.length}</CellSub></>)}
            {r.state === 'Failed' && rr[0] && <CellSub>{rr[0].tasks.find((t) => t.state === 'Failed')?.name ?? 'see lifecycle log'}</CellSub>}
          </>
        )
      },
    },
    {
      key: 'order', header: 'Request', width: '160px',
      sortValue: (r) => r.id,
      render: (r) => (<><CellMain><Mono>{r.id}</Mono></CellMain><CellSub>{r.code}</CellSub></>),
    },
    {
      /* Why this request exists, as a field rather than a suffix on the name.
         Create builds a new service; everything else acts on one that is
         already carrying traffic — which is the distinction someone scanning
         this list is actually trying to make. */
      key: 'intent', header: 'Request type', width: '132px',
      sortValue: (r) => r.intent,
      render: (r) => (
        <>
          <Badge tone={INTENT_TONE[r.intent]}>{r.intent}</Badge>
          <CellSub>{r.intent === 'Create' ? 'new build' : 'change request'}</CellSub>
        </>
      ),
    },
    {
      key: 'name', header: 'Name', width: '180px',
      sortValue: (r) => r.name,
      render: (r) => (<><CellMain>{r.name}</CellMain><CellSub>{r.subtype}</CellSub></>),
    },
    {
      key: 'category', header: 'Category / Type', width: '126px',
      sortValue: (r) => r.category,
      render: (r) => (
        <div className="text-center">
          <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge>
          <CellSub>{r.type}</CellSub>
        </div>
      ),
    },
    {
      key: 'customer', header: 'Customer', width: '176px',
      sortValue: (r) => r.accountName,
      render: (r) => (<><CellMain>{r.accountName}</CellMain><CellSub><Mono>{r.accountId}</Mono></CellSub></>),
    },
    {
      key: 'endpoints', header: 'Endpoints', width: '190px',
      render: (r) => (r.endpoints.length === 0
        ? <span className="text-ink-3">not set</span>
        : (<><CellMain><Mono className="whitespace-nowrap">{r.endpoints.map((e) => e.siteCode).slice(0, 2).join(' ↔ ')}</Mono></CellMain>
          <CellSub>{r.endpoints.length > 2 ? `+${r.endpoints.length - 2} more sites` : r.endpoints.map((e) => e.port).join(' · ')}</CellSub></>)),
    },
    {
      /* Execution attempts. A dash rather than 0 for rows that haven't
         reached the device yet — nothing was attempted, not zero-of-many. */
      key: 'runs', header: 'Runs', align: 'center', width: '70px',
      sortValue: (r) => new Set(runsForOrder(r.id).map((x) => x.attempt)).size,
      render: (r) => {
        const n = new Set(runsForOrder(r.id).map((x) => x.attempt)).size
        return n ? n : <span className="text-ink-3">—</span>
      },
    },
    { key: 'age', header: 'Age', align: 'right', width: '74px', sortValue: (r) => r.ageDays, render: (r) => ageLabel(r.ageDays) },
    stampColumn<Order>((r) => r.createdAt, (r) => r.updatedAt),
    {
      /* Dynamic per lifecycle stage: approve/reject on a Validated request,
         verify + credentials + execute on an Approved one, retry on a Failed
         one; the navigation items are common to every row. */
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/requests/${r.id}`, fromList) },
          ...(!PRE_EXECUTION.includes(r.state)
            ? [{ label: 'Verify details', icon: ClipboardCheck, onClick: () => setVerify(r) }]
            : []),
          { label: 'Life cycle operation', icon: Workflow, onClick: () => nav(`/requests/${r.id}?tab=lifecycle`, fromList) },
          { label: 'View jobs', icon: ListChecks, onClick: () => nav(`/requests/${r.id}?tab=runs`, fromList) },
          ...(r.state === 'Validated'
            ? [{ label: 'Approve', icon: CheckCircle2, onClick: () => doApprove(r) },
              { label: 'Reject', icon: XCircle, onClick: () => { setReject(r); setRejectNote('') }, danger: true }]
            : []),
          ...(r.state === 'Approved' ? [{ label: 'Validate credentials & execute', icon: ShieldCheck, onClick: () => setCreds(r) }] : []),
          ...(r.state === 'Failed' ? [{ label: 'Retry', icon: PlayCircle, onClick: () => retryOrder(r.id) }] : []),
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="flex items-center justify-end vw-wrap gap-3">
        <SegmentedToggle
          options={[{ value: 'listing', label: 'Listing', icon: ListChecks }, { value: 'insights', label: 'Insights', icon: BarChart3 }]}
          value={view} onChange={setView} />
      </div>

      {/* Domain, Vendor and Category each have their own dropdown in the
         toolbar below, which already shows the selected value — no need to
         say it twice up here. */}
      <FilterBanner
        count={filtered.length} noun="requests" onClear={clear}
        filters={[
          ...(state !== 'All' ? [{ key: 'state', label: 'Status', value: stateList.join(' or '), onRemove: () => setState('All') }] : []),
          ...(history === 'on' ? [{ key: 'history', label: 'Scope', value: 'Including completed history', onRemove: () => setHistory('off') }] : []),
          ...(intent !== 'All' ? [{ key: 'intent', label: 'Request type', value: intent, onRemove: () => setIntent('All') }] : []),
          ...(customer ? [{ key: 'customer', label: 'Customer', value: customer, onRemove: () => setCustomer('') }] : []),
          ...(qname ? [{ key: 'name', label: 'Name', value: qname, onRemove: () => setQname('') }] : []),
          ...(qcode ? [{ key: 'code', label: 'Code', value: qcode, onRemove: () => setQcode('') }] : []),
          ...(qmodel ? [{ key: 'model', label: 'Model', value: qmodel, onRemove: () => setQmodel('') }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      {view === 'insights' ? (
        <ProvisioningInsights orders={scoped} runs={runs} onDrill={(p) => patch({ ...p, view: 'listing' })} />
      ) : (
        <>
          <div ref={resultsRef} />
          <DataTable
            rows={ranked}
            total={orders.length}
            columns={columns}
            pageSize={12}
            onRowClick={(r) => nav(`/requests/${r.id}`, fromList)}
            toolbar={{
              search: { value: q, onChange: setQ, placeholder: 'Name, Code, Model' },
              /* Request type, Domain, Vendor and Category are common enough to
                 earn their own dropdown right in the toolbar, instead of a
                 click-through to the filter icon — everything else stays in
                 the popover. */
              chips: [
                <FieldDropdown key="intent" label="Request type" value={intent} onChange={(v) => setIntent(v as OrderIntent | 'All')}
                  options={ORDER_INTENTS.filter((i) => orders.some((o) => o.intent === i))
                    .map((i) => ({ value: i, label: i, count: orders.filter((o) => o.intent === i).length }))} />,
                <FieldDropdown key="domain" label="Domain" value={domain} onChange={(v) => setDomainScoped(v as Domain | 'All')}
                  options={DOMAINS.map((d) => ({ value: d, label: d, count: orders.filter((o) => domainOf(o.category) === d).length }))} />,
                <FieldDropdown key="vendor" label="Vendor" value={vendor} onChange={(v) => setVendor(v as Vendor | 'All')}
                  options={[...new Set(orders.map((o) => o.endpoints[0]?.vendor).filter((v): v is Vendor => v !== undefined))].sort()
                    .map((v) => ({ value: v, label: VENDOR_LABEL[v], count: orders.filter((o) => o.endpoints[0]?.vendor === v).length }))} />,
                <FieldDropdown key="cat" label="Category" value={cat} onChange={(v) => setCat(v as Category | 'All')}
                  options={domainCats.map((c) => ({ value: c, label: c, count: (byCategory.get(c) ?? []).length }))} />,
                <Chip key="history" active={history === 'on'} onClick={() => setHistory(history === 'on' ? 'off' : 'on')}>
                  Include history
                  <span className="tnum opacity-70">{archivedCount.toLocaleString()}</span>
                </Chip>,
              ],
              filters: [
                {
                  key: 'state', label: 'Status', value: state, onChange: (v) => setState(v),
                  options: [
                    ...STATE_ORDER.filter((st) => orders.some((o) => o.state === st))
                      .map((st) => ({ value: st, label: st, count: orders.filter((o) => o.state === st).length })),
                    { value: 'Validated', label: 'Waiting for approval' },
                    { value: 'Approved,Queued', label: 'Ready to run' },
                    { value: 'Failed,Rejected,Invalid,Reinstantiate', label: 'Blocked' },
                  ],
                },
                { key: 'customer', label: 'Customer Name', type: 'text', value: customer, onChange: setCustomer },
                { key: 'name', label: 'Name', type: 'text', value: qname, onChange: setQname },
                { key: 'code', label: 'Code', type: 'text', value: qcode, onChange: setQcode },
                { key: 'model', label: 'Model', type: 'text', value: qmodel, onChange: setQmodel },
              ],
              onResetFilters: clear,
              onRefresh: () => pushToast('info', 'Request list refreshed.'),
              actions: [
                { label: 'New network service', icon: Plus, onClick: () => nav('/requests/new') },
              ],
            }}
          />
        </>
      )}

      {/* -------- reject -------- */}
      <Modal
        open={!!reject} onClose={() => setReject(null)}
        title="Reject request" sub={reject?.id}
        footer={
          <>
            <Button onClick={() => setReject(null)}>Cancel</Button>
            <Button variant="danger" disabled={!rejectNote.trim()}
              onClick={() => { if (reject) rejectOrder(reject.id, 'Ravi K.', rejectNote); setReject(null) }}>
              Reject request
            </Button>
          </>
        }
      >
        <Field label="Reason" required hint="Recorded on the approval trail and shown to the requester.">
          <textarea
            value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={4}
            placeholder="Uplink headroom insufficient at the A-end…"
            className="w-full px-3 py-2.5 border border-line rounded-md text-[13px] outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 resize-y"
          />
        </Field>
      </Modal>

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
