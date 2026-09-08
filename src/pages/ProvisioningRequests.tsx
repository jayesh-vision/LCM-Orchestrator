import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { Download, Eye, ListChecks, Plus, SlidersHorizontal, Workflow } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Order, OrderState } from '@/types'
import {
  Badge, CellMain, CellSub, Chip, DataTable,
  FilterBanner, Kebab, Mono, Progress, type Column,
} from '@/components/ui'
import { CategoryCard } from '@/components/charts'
import { ageLabel, CATEGORY_TONE, INTENT_TONE, ORDER_TONE } from '@/lib/format'

const CATEGORIES: Category[] = ['L2VPN', 'L3VPN', 'IBW']

const STATE_ORDER: OrderState[] = [
  'Draft', 'Designed', 'Awaiting approval', 'Approved', 'Queued',
  'Executing', 'Activated', 'Failed', 'Rejected', 'Unrouted',
]

export default function ProvisioningRequests() {
  const orders = useStore((s) => s.orders)
  const nav = useNavigate()
  const [q, setQ] = useQueryState('q', '')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  /* `state` may carry several stages, e.g. state=Failed,Rejected,Unrouted */
  const [state, setState] = useQueryState<OrderState | 'All' | string>('state', 'All')
  const stateList = state === 'All' ? [] : state.split(',')
  const [intent, setIntent] = useQueryState('intent', 'All')
  const [owner, setOwner] = useQueryState('owner', 'All')
  const [customer, setCustomer] = useQueryState('customer', '')
  const pushToast = useStore((st) => st.pushToast)
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'cat', 'state', 'intent', 'owner', 'customer'])
  const resultsRef = useScrollToResultsOnDrillIn(cat !== 'All' || state !== 'All' || intent !== 'All' || owner !== 'All')

  const byCategory = useMemo(() => {
    const m = new Map<Category, Order[]>()
    CATEGORIES.forEach((c) => m.set(c, []))
    orders.forEach((o) => m.get(o.category)?.push(o))
    return m
  }, [orders])

  const filtered = useMemo(() => orders.filter((o) => {
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
  }), [orders, cat, state, intent, owner, customer, q]) // eslint-disable-line react-hooks/exhaustive-deps


  const columns: Column<Order>[] = [
    {
      key: 'order', header: 'Request', width: '168px',
      sortValue: (r) => r.id,
      render: (r) => (<><CellMain><Mono>{r.id}</Mono></CellMain><CellSub>{r.code}</CellSub></>),
    },
    {
      key: 'name', header: 'Name', width: '190px',
      sortValue: (r) => r.name,
      render: (r) => (<><CellMain>{r.name}</CellMain><CellSub>{r.type} · {r.subtype}</CellSub></>),
    },
    {
      key: 'category', header: 'Category', width: '110px',
      sortValue: (r) => r.category,
      render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge>,
    },
    {
      key: 'intent', header: 'Intent', width: '106px',
      sortValue: (r) => r.intent,
      render: (r) => <Badge tone={INTENT_TONE[r.intent]}>{r.intent}</Badge>,
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
      key: 'state', header: 'Status', width: '170px',
      sortValue: (r) => STATE_ORDER.indexOf(r.state),
      render: (r) => (
        <>
          <Badge tone={ORDER_TONE[r.state]} dot>{r.state}</Badge>
          {r.state === 'Executing' && <Progress value={45} className="mt-2 w-24" />}
          {r.slaBreached && <CellSub><span className="text-crit-700">SLA breached</span></CellSub>}
        </>
      ),
    },
    { key: 'age', header: 'Age', align: 'right', width: '76px', sortValue: (r) => r.ageDays, render: (r) => ageLabel(r.ageDays) },
    { key: 'owner', header: 'Owner', width: '116px', sortValue: (r) => r.owner ?? '', render: (r) => r.owner ?? <span className="text-ink-3">unassigned</span> },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/requests/${r.id}`) },
          { label: 'Life cycle operation', icon: Workflow, onClick: () => nav(`/requests/${r.id}?tab=lifecycle`) },
          { label: 'View jobs', icon: ListChecks, onClick: () => nav(`/requests/${r.id}?tab=runs`) },
        ]} />
      ),
    },
  ]

  return (
    <>

      <FilterBanner
        count={filtered.length} noun="requests" onClear={clear}
        filters={[
          ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
          ...(state !== 'All' ? [{ key: 'state', label: 'Status', value: stateList.join(' or '), onRemove: () => setState('All') }] : []),
          ...(intent !== 'All' ? [{ key: 'intent', label: 'Intent', value: intent, onRemove: () => setIntent('All') }] : []),
          ...(owner !== 'All' ? [{ key: 'owner', label: 'Owner', value: owner, onRemove: () => setOwner('All') }] : []),
          ...(customer ? [{ key: 'customer', label: 'Customer', value: customer, onRemove: () => setCustomer('') }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      {/* category summary cards, one per service type */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        {CATEGORIES.map((c) => {
          const list = byCategory.get(c) ?? []
          const count = (st: OrderState) => list.filter((o) => o.state === st).length
          const seg = (label: string, value: number, fill: 'good' | 'brand' | 'none' | 'crit', states: string) =>
            ({ label, value, fill, onClick: () => patch({ cat: c, state: states }) })
          return (
            <CategoryCard
              key={c}
              chip={<Badge tone={CATEGORY_TONE[c]}>{c}</Badge>}
              total={list.length} noun="requests"
              onOpen={() => patch({ cat: c, state: null })}
              segments={[
                seg('Activated', count('Activated'), 'good', 'Activated'),
                seg('In flight', count('Executing') + count('Queued') + count('Approved'), 'brand', 'Executing,Queued,Approved'),
                seg('Awaiting', count('Designed') + count('Awaiting approval') + count('Draft'), 'none', 'Draft,Designed,Awaiting approval'),
                seg('Failed', count('Failed') + count('Rejected') + count('Unrouted'), 'crit', 'Failed,Rejected,Unrouted'),
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
        rowTone={(r) => (r.state === 'Failed' ? 'crit' : r.state === 'Unrouted' || r.slaBreached ? 'warn' : undefined)}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Name, Code' },
          /* Quick chips are categories only — every other filter lives in the popover. */
          chips: CATEGORIES.map((c) => (
            <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} count={(byCategory.get(c) ?? []).length} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>
          )),
          filters: [
            {
              key: 'state', label: 'Status', value: state, onChange: (v) => setState(v),
              options: [
                ...STATE_ORDER.filter((st) => orders.some((o) => o.state === st))
                  .map((st) => ({ value: st, label: st, count: orders.filter((o) => o.state === st).length })),
                { value: 'Designed,Awaiting approval', label: 'Waiting for approval' },
                { value: 'Approved,Queued', label: 'Ready to run' },
                { value: 'Failed,Rejected,Unrouted', label: 'Blocked' },
              ],
            },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: CATEGORIES.map((c) => ({ value: c, label: c, count: (byCategory.get(c) ?? []).length })) },
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
    </>
  )
}
