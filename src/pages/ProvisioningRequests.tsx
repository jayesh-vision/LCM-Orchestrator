import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { BarChart3, CheckCircle2, Eye, ListChecks, Plus, Workflow, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Domain, Order, OrderIntent, OrderState, Vendor } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, CellMain, CellSub, Chip, DataTable, Field,
  FieldDropdown, FilterBanner, Kebab, Modal, Mono, Progress, SegmentedToggle, type Column,
} from '@/components/ui'
import { ProvisioningInsights } from '@/components/ProvisioningInsights'
import { VENDOR_LABEL } from '@/data/workflows'
import { CATEGORY_TONE, INTENT_TONE, ORDER_TONE } from '@/lib/format'
import { byTraceability, orderTrace } from '@/lib/traceability'

const CATEGORIES: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM', 'RAN VNF']

const STATE_ORDER: OrderState[] = [
  'Draft', 'Planned', 'Validated', 'Invalid', 'Approved', 'Rejected',
  'Queued', 'In progress', 'Ready', 'Failed', 'Reinstantiate',
]

export default function ProvisioningRequests() {
  const allOrders = useStore((s) => s.orders)
  const runs = useStore((s) => s.runs)
  const approveOrder = useStore((s) => s.approveOrder)
  const rejectOrder = useStore((s) => s.rejectOrder)
  const nav = useNavigate()
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
  const pushToast = useStore((st) => st.pushToast)
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
  /* The Requests⟷Execution toggle is a real navigation — the two screens'
     state vocabularies differ (Requests has Draft/Planned/Validated/Invalid,
     Execution doesn't), so only domain/cat/q/view carry across. */
  const switchMode = (m: 'requests' | 'execution') => {
    if (m === 'requests') return
    const p = new URLSearchParams()
    if (domain !== 'All') p.set('domain', domain)
    if (cat !== 'All') p.set('cat', cat)
    if (q) p.set('q', q)
    p.set('view', view)
    nav(`/execution${p.toString() ? `?${p}` : ''}`)
  }
  const [reject, setReject] = useState<Order | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const doApprove = (o: Order) => { approveOrder(o.id, 'Ravi K.'); pushToast('good', `${o.id} approved — ready to run in Provisioning Execution.`) }

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

  /* Requests that can actually be followed — through to the service they
     produced, the run that executed them and the template on each endpoint —
     lead the list, so the first page is the part of the estate that holds up
     when someone opens it. Sorting a column still overrides this. */
  const ranked = useMemo(() => {
    const withRun = new Set(runs.map((r) => r.orderId))
    return byTraceability(filtered, (o) => orderTrace(o, (id) => withRun.has(id)))
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
      key: 'state', header: 'Status', width: '170px',
      sortValue: (r) => STATE_ORDER.indexOf(r.state),
      render: (r) => (
        <>
          <Badge tone={ORDER_TONE[r.state]} dot>{r.state}</Badge>
          {r.state === 'In progress' && <Progress value={45} className="mt-2 w-24" />}
        </>
      ),
    },
    {
      key: 'order', header: 'Request', width: '168px',
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
      key: 'name', header: 'Name', width: '190px',
      sortValue: (r) => r.name,
      render: (r) => (<><CellMain>{r.name}</CellMain><CellSub>{r.subtype}</CellSub></>),
    },
    {
      key: 'category', header: 'Category / Type', width: '132px',
      sortValue: (r) => r.category,
      render: (r) => (
        <div className="text-center">
          <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge>
          <CellSub>{r.type}</CellSub>
        </div>
      ),
    },
    {
      key: 'customer', header: 'Customer', width: '190px',
      sortValue: (r) => r.accountName,
      render: (r) => (<><CellMain>{r.accountName}</CellMain><CellSub><Mono>{r.accountId}</Mono></CellSub></>),
    },
    {
      key: 'endpoints', header: 'Endpoints', width: '208px',
      render: (r) => (r.endpoints.length === 0
        ? <span className="text-ink-3">not set</span>
        : (<><CellMain><Mono className="whitespace-nowrap">{r.endpoints.map((e) => e.siteCode).slice(0, 2).join(' ↔ ')}</Mono></CellMain>
          <CellSub>{r.endpoints.length > 2 ? `+${r.endpoints.length - 2} more sites` : r.endpoints.map((e) => e.port).join(' · ')}</CellSub></>)),
    },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/requests/${r.id}`) },
          { label: 'Life cycle operation', icon: Workflow, onClick: () => nav(`/requests/${r.id}?tab=lifecycle`) },
          { label: 'View jobs', icon: ListChecks, onClick: () => nav(`/requests/${r.id}?tab=runs`) },
          ...(r.state === 'Validated'
            ? [{ label: 'Approve', icon: CheckCircle2, onClick: () => doApprove(r) },
              { label: 'Reject', icon: XCircle, onClick: () => { setReject(r); setRejectNote('') }, danger: true }]
            : []),
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="flex items-center justify-between vw-wrap gap-3">
        <SegmentedToggle
          options={[{ value: 'requests', label: 'Requests' }, { value: 'execution', label: 'Execution' }]}
          value="requests" onChange={switchMode} />
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
        <ProvisioningInsights mode="requests" orders={scoped} onDrill={(p) => patch({ ...p, view: 'listing' })} />
      ) : (
        <>
          <div ref={resultsRef} />
          <DataTable
            rows={ranked}
            total={orders.length}
            columns={columns}
            pageSize={12}
            onRowClick={(r) => nav(`/requests/${r.id}`)}
            toolbar={{
              search: { value: q, onChange: setQ, placeholder: 'Name, Code, Model' },
              /* Domain, Vendor and Category are common enough to earn their own
                 dropdown right in the toolbar, instead of a click-through to the
                 filter icon — everything else stays in the popover. */
              chips: [
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
                { key: 'intent', label: 'Request type', value: intent, onChange: (v) => setIntent(v as OrderIntent | 'All'),
                  options: (['Create', 'Modify', 'Suspend', 'Resume', 'Cease', 'Re-prove'] as OrderIntent[])
                    .filter((i) => orders.some((o) => o.intent === i))
                    .map((i) => ({ value: i, label: i, count: orders.filter((o) => o.intent === i).length })) },
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
    </>
  )
}
