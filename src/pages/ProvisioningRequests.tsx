import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { CheckCircle2, Download, Eye, ListChecks, Plus, SlidersHorizontal, Workflow, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Domain, Order, OrderState } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, CellMain, CellSub, Chip, DataTable, Field,
  FilterBanner, Kebab, Modal, Mono, Progress, type Column,
} from '@/components/ui'
import { CategoryCard } from '@/components/charts'
import { CATEGORY_TONE, DOMAIN_TONE, ORDER_TONE } from '@/lib/format'

const CATEGORIES: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM']

const STATE_ORDER: OrderState[] = [
  'Draft', 'Planned', 'Validated', 'Invalid', 'Approved', 'Rejected',
  'Queued', 'In progress', 'Ready', 'Failed', 'Reinstantiate',
]

export default function ProvisioningRequests() {
  const orders = useStore((s) => s.orders)
  const approveOrder = useStore((s) => s.approveOrder)
  const rejectOrder = useStore((s) => s.rejectOrder)
  const nav = useNavigate()
  const [q, setQ] = useQueryState('q', '')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  /* `state` may carry several stages, e.g. state=Failed,Rejected,Invalid */
  const [state, setState] = useQueryState<OrderState | 'All' | string>('state', 'All')
  const stateList = state === 'All' ? [] : state.split(',')
  const [intent, setIntent] = useQueryState('intent', 'All')
  const [owner, setOwner] = useQueryState('owner', 'All')
  const [customer, setCustomer] = useQueryState('customer', '')
  const pushToast = useStore((st) => st.pushToast)
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'domain', 'cat', 'state', 'intent', 'owner', 'customer'])
  const domainCats = domain === 'All' ? CATEGORIES : CATEGORIES_BY_DOMAIN[domain]
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const pickDomain = (d: Domain) => setDomainScoped(domain === d ? 'All' : d)
  const resultsRef = useScrollToResultsOnDrillIn(domain !== 'All' || cat !== 'All' || state !== 'All' || intent !== 'All' || owner !== 'All')
  const [reject, setReject] = useState<Order | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const doApprove = (o: Order) => { approveOrder(o.id, 'Ravi K.'); pushToast('good', `${o.id} approved — ready to run in Provisioning Execution.`) }

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
    if (intent !== 'All' && o.intent !== intent) return false
    if (owner !== 'All' && o.owner !== owner) return false
    if (customer && !o.accountName.toLowerCase().includes(customer.toLowerCase())) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(o.id.toLowerCase().includes(t) || o.code.toLowerCase().includes(t)
        || o.name.toLowerCase().includes(t) || o.accountName.toLowerCase().includes(t))) return false
    }
    return true
  }), [orders, domain, cat, state, intent, owner, customer, q]) // eslint-disable-line react-hooks/exhaustive-deps


  const columns: Column<Order>[] = [
    {
      key: 'state', header: 'Status', width: '170px',
      sortValue: (r) => STATE_ORDER.indexOf(r.state),
      render: (r) => (
        <>
          <Badge tone={ORDER_TONE[r.state]} dot>{r.state}</Badge>
          {r.state === 'In progress' && <Progress value={45} className="mt-2 w-24" />}
          {r.slaBreached && <CellSub><span className="text-crit-700">SLA breached</span></CellSub>}
        </>
      ),
    },
    {
      key: 'order', header: 'Request', width: '168px',
      sortValue: (r) => r.id,
      render: (r) => (<><CellMain><Mono>{r.id}</Mono></CellMain><CellSub>{r.code}</CellSub></>),
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

      <FilterBanner
        count={filtered.length} noun="requests" onClear={clear}
        filters={[
          ...(domain !== 'All' ? [{ key: 'domain', label: 'Domain', value: domain, onRemove: () => setDomain('All') }] : []),
          ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
          ...(state !== 'All' ? [{ key: 'state', label: 'Status', value: stateList.join(' or '), onRemove: () => setState('All') }] : []),
          ...(intent !== 'All' ? [{ key: 'intent', label: 'Intent', value: intent, onRemove: () => setIntent('All') }] : []),
          ...(owner !== 'All' ? [{ key: 'owner', label: 'Owner', value: owner, onRemove: () => setOwner('All') }] : []),
          ...(customer ? [{ key: 'customer', label: 'Customer', value: customer, onRemove: () => setCustomer('') }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      <div className="flex items-center gap-1.5">
        {DOMAINS.map((d) => (
          <Chip key={d} tone={DOMAIN_TONE[d]} active={domain === d} onClick={() => pickDomain(d)}>{d}</Chip>
        ))}
      </div>

      {/* category summary cards, one per service type — column count tracks
         how many categories the selected domain actually has, so a single-
         category domain doesn't leave empty grid columns beside its card. */}
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(domainCats.length, 4)}, minmax(240px, 1fr))` }}>
        {domainCats.map((c) => {
          const list = byCategory.get(c) ?? []
          const count = (st: OrderState) => list.filter((o) => o.state === st).length
          const seg = (label: string, value: number, fill: 'good' | 'brand' | 'none' | 'crit', states: string) =>
            ({ label, value, fill, onClick: () => patch({ cat: c, state: states }) })
          return (
            <CategoryCard
              key={c}
              chip={<Badge tone={CATEGORY_TONE[c]}>{c}</Badge>}
              total={list.length} noun="requests"
              info={`All ${c} requests grouped by where they stand. Ready went live, In progress is executing or queued, Waiting has not yet been approved, Failed needs intervention. Click a legend row to open exactly those requests.`}
              onOpen={() => patch({ cat: c, state: null })}
              segments={[
                seg('Ready', count('Ready'), 'good', 'Ready'),
                seg('In progress', count('In progress') + count('Queued') + count('Approved'), 'brand', 'In progress,Queued,Approved'),
                seg('Waiting', count('Draft') + count('Planned') + count('Validated'), 'none', 'Draft,Planned,Validated'),
                seg('Failed', count('Failed') + count('Rejected') + count('Invalid') + count('Reinstantiate'), 'crit', 'Failed,Rejected,Invalid,Reinstantiate'),
              ]}
            />
          )
        })}
      </div>

      <div ref={resultsRef} />
      <DataTable
        rows={filtered}
        total={orders.length}
        columns={columns}
        pageSize={12}
        onRowClick={(r) => nav(`/requests/${r.id}`)}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Name, Code' },
          /* Quick chips are domain + category — every other filter lives in the popover. */
          chips: [
            ...DOMAINS.map((d) => <Chip key={d} tone={DOMAIN_TONE[d]} active={domain === d} onClick={() => pickDomain(d)}>{d}</Chip>),
            ...domainCats.map((c) => (
              <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>
            )),
          ],
          filters: [
            { key: 'domain', label: 'Domain', value: domain, onChange: (v) => setDomainScoped(v as Domain | 'All'),
              options: DOMAINS.map((d) => ({ value: d, label: d, count: orders.filter((o) => domainOf(o.category) === d).length })) },
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
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: domainCats.map((c) => ({ value: c, label: c, count: (byCategory.get(c) ?? []).length })) },
            { key: 'intent', label: 'Intent', value: intent, onChange: setIntent,
              options: ['Create', 'Modify', 'Suspend', 'Resume', 'Cease', 'Re-prove']
                .filter((i) => orders.some((o) => o.intent === i))
                .map((i) => ({ value: i, label: i, count: orders.filter((o) => o.intent === i).length })) },
            { key: 'owner', label: 'Owner', value: owner, onChange: setOwner,
              options: [...new Set(orders.map((o) => o.owner).filter(Boolean))].sort()
                .map((o) => ({ value: o as string, label: o as string, count: orders.filter((x) => x.owner === o).length })) },
            { key: 'customer', label: 'Customer Name', type: 'text', value: customer, onChange: setCustomer },
            { key: 'q', label: 'Name / Code', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: clear,
          onRefresh: () => pushToast('info', 'Request list refreshed.'),
          actions: [
            { label: 'New network service', icon: Plus, onClick: () => nav('/requests/new') },
            { label: 'Export to CSV', icon: Download, onClick: () => pushToast('info', 'Export queued — the file will appear in Reports.') },
            { label: 'Column settings', icon: SlidersHorizontal, onClick: () => pushToast('info', 'Column settings are not wired in this prototype.') },
          ],
        }}
      />

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
