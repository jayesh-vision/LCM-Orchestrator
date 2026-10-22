import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { Boxes, Eye, Ghost, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Conformance, Domain, Order, Service, ServiceState } from '@/types'
import { domainOf } from '@/types'
import {
  Badge, Card, CardBody, CardHead, CellMain, CellSub, DataTable,
  FieldDropdown, Kebab, Mono, Stat, stampColumn, type Column,
} from '@/components/ui'
import { CHART } from '@/components/charts'
import { CATEGORY_TONE, CONFORMANCE_TONE, inr, relTime, SERVICE_TONE } from '@/lib/format'
import { byTraceability, serviceTrace, serviceOrigins, ORIGIN_LABEL, ORIGIN_BLURB, type ServiceOrigin } from '@/lib/traceability'

const STATES: ServiceState[] = ['Live', 'Activating', 'Degraded', 'Suspended', 'Ceased']
const CONFS: Conformance[] = ['Conformant', 'Drifted', 'Never proven', 'Ghost', 'Not checked']

/**
 * When this service was last changed. Unlike an order, a service carries no
 * `updatedAt` of its own — and it shouldn't, because a service is only ever
 * changed by something: an executed modify, suspend, resume or cease, or an
 * out-of-band edit the platform detected. Every one of those writes a record
 * into `history`, so the latest of those records IS the modified time, and
 * deriving it here means the column can never disagree with the change log on
 * the service's own detail page.
 *
 * Scanned rather than read off `history[0]` — the store prepends, so index 0
 * is newest for anything raised in-session, but the seeded history is not
 * guaranteed to be sorted and one unsorted row would silently show the wrong
 * date.
 */
function lastChangedAt(s: Service): string | undefined {
  let latest: string | undefined
  s.history.forEach((h) => { if (!latest || Date.parse(h.at) > Date.parse(latest)) latest = h.at })
  return latest
}

/**
 * How often this service has been changed since it was built, counted two ways.
 *
 * "Created · service went Live" is the service arriving, not a change to it, so
 * it is excluded — a service nobody has touched should read as untouched.
 *
 * The split matters more than the total. A change with a request behind it was
 * asked for, approved and executed, and the lifecycle tab can show all three.
 * A change made straight on the device has none of that, and no amount of
 * scrolling the request queue will ever surface it. Counting them together
 * would hide exactly the thing worth looking at.
 */
function changeStats(s: Service): { total: number; tracked: number; outOfBand: number } {
  const changes = s.history.filter((h) => !h.change.startsWith('Created'))
  const outOfBand = changes.filter((h) => h.outOfBand).length
  return { total: changes.length, tracked: changes.length - outOfBand, outOfBand }
}

export default function ServiceInventory() {
  const services = useStore((s) => s.services)
  const orders = useStore((s) => s.orders)
  const intents = useStore((s) => s.intents)
  const pushToast = useStore((s) => s.pushToast)
  const nav = useNavigate()

  const [q, setQ] = useQueryState('q', '')
  const [qservice, setQservice] = useQueryState('service', '')
  const [qorder, setQorder] = useQueryState('order', '')
  const [qcustomer, setQcustomer] = useQueryState('customer', '')
  const [qkind, setQkind] = useQueryState('kind', '')
  const [state, setState] = useQueryState<ServiceState | 'All'>('state', 'All')
  const [conf, setConf] = useQueryState<Conformance | 'All'>('conf', 'All')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [intent, setIntent] = useQueryState('intent', 'All')
  const [origin, setOrigin] = useQueryState<ServiceOrigin | 'All'>('origin', 'All')
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'service', 'order', 'customer', 'kind', 'state', 'conf', 'domain', 'cat', 'intent', 'origin'])
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const anyFilter = state !== 'All' || conf !== 'All' || domain !== 'All' || cat !== 'All' || intent !== 'All' || origin !== 'All'
    || !!qservice || !!qorder || !!qcustomer || !!qkind
  const { ref: resultsRef, scrollToResults } = useScrollToResultsOnDrillIn(
    anyFilter ? `s=${state}|cf=${conf}|d=${domain}|c=${cat}|i=${intent}|o=${origin}|svc=${qservice}|ord=${qorder}|cust=${qcustomer}|kind=${qkind}` : '',
  )
  const intentName = intents.find((i) => i.id === intent)?.name ?? intent

  const n = {
    state: (s: ServiceState) => services.filter((x) => x.state === s).length,
    conf: (c: Conformance) => services.filter((x) => x.conformance === c).length,
  }

  const ghostValue = useMemo(
    () => services.filter((s) => s.conformance === 'Ghost').reduce((a, s) => a + s.monthlyValueInr * 12, 0),
    [services],
  )

  /* Ranked, biggest first — the intent list has no fixed size (it grows with
     every new template), so this reads as a ranked grid of tiles rather than
     a vertical list that would only ever get longer. Rank, not the intent's
     own identity, picks the colour, so the shade always says "how big" the
     same way the old bar list did. */
  const intentItems = [...intents]
    .map((i) => ({ intent: i, count: services.filter((s) => s.intentId === i.id).length }))
    .sort((a, b) => b.count - a.count)
    .map(({ intent: i, count }, rank) => ({
      id: i.id,
      label: i.name,
      value: count,
      color: [CHART.blue700, CHART.blue600, CHART.blue500, CHART.blue400, CHART.blue300, CHART.blue200][Math.min(rank, 5)],
      pct: Math.round((count / Math.max(1, services.length)) * 100),
      onClick: () => patch({ intent: i.id, conf: null, state: null }),
    }))

  /* Where each service came from. Most of this base predates the platform,
     so saying so on the row stops a service with no request behind it from
     reading as missing data. */
  const originOf = useMemo(() => serviceOrigins(orders), [orders])
  const origins = (id: string): ServiceOrigin => originOf.get(id) ?? 'inherited'

  /* The request behind each service. Where several touched it, the create
     wins — that is the one that brought the service into existence. */
  const orderForService = useMemo(() => {
    const m = new Map<string, Order>()
    orders.forEach((o) => {
      if (!o.serviceId) return
      const held = m.get(o.serviceId)
      if (!held || (held.intent !== 'Create' && o.intent === 'Create')) m.set(o.serviceId, o)
    })
    return m
  }, [orders])

  const filtered = useMemo(() => services.filter((s) => {
    if (state !== 'All' && s.state !== state) return false
    if (conf !== 'All' && s.conformance !== conf) return false
    if (domain !== 'All' && domainOf(s.category) !== domain) return false
    if (cat !== 'All' && s.category !== cat) return false
    if (intent !== 'All' && s.intentId !== intent) return false
    if (origin !== 'All' && origins(s.id) !== origin) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(s.id.toLowerCase().includes(t) || s.name.toLowerCase().includes(t)
        || s.accountName.toLowerCase().includes(t))) return false
    }
    if (qservice) {
      const t = qservice.toLowerCase()
      if (!(s.id.toLowerCase().includes(t) || s.name.toLowerCase().includes(t))) return false
    }
    if (qcustomer && !s.accountName.toLowerCase().includes(qcustomer.toLowerCase())) return false
    if (qorder) {
      const order = orderForService.get(s.id)
      const orderText = order
        ? `${order.id} ${order.code} ${order.intent} ${order.state}`.toLowerCase()
        : ORIGIN_LABEL.inherited.toLowerCase()
      if (!orderText.includes(qorder.toLowerCase())) return false
    }
    if (qkind && !`${s.category} ${s.type}`.toLowerCase().includes(qkind.toLowerCase())) return false
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [services, state, conf, cat, intent, origin, q, qservice, qorder, qcustomer, qkind, originOf, orderForService])

  /* Services the platform can account for — provisioned through a request in
     the system, holding pool resources, with the evidence that proved them —
     lead the list, ahead of inherited records that can only be taken at face
     value. Sorting a column still overrides this. */
  const ranked = useMemo(() => {
    const referenced = new Set(orders.map((o) => o.serviceId).filter(Boolean) as string[])
    return byTraceability(filtered, (s) => serviceTrace(s, referenced))
  }, [filtered, orders])

  const columns: Column<Service>[] = [
    {
      key: 'svc', header: 'Service', width: '210px', sortValue: (r) => r.id,
      render: (r) => (<><CellMain><Mono>{r.id}</Mono></CellMain><CellSub>{r.name}</CellSub></>),
    },
    {
      /* Sits next to the service id because it explains where that id came
         from. Blank on the inherited estate, which is itself worth seeing:
         a row with no order is one the platform cannot account for. */
      key: 'order', header: 'Order', width: '158px',
      sortValue: (r) => orderForService.get(r.id)?.id ?? '',
      render: (r) => {
        const o = orderForService.get(r.id)
        if (!o) {
          return (
            <span title={ORIGIN_BLURB.inherited}>
              <Badge tone="none">{ORIGIN_LABEL.inherited}</Badge>
            </span>
          )
        }
        return (
          <>
            <CellMain>
              <Link
                to={`/requests/${o.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-brand-600 hover:underline"
              >
                <Mono>{o.id}</Mono>
              </Link>
            </CellMain>
            {/* The state matters as much as the intent here: a live service
                with a Modify sitting at Validated has a change waiting on
                approval, which reads very differently from the order that
                built it. Showing only the intent invites that misreading. */}
            <CellSub>{o.intent} · {o.state}</CellSub>
          </>
        )
      },
    },
    { key: 'acct', header: 'Customer', width: '186px', sortValue: (r) => r.accountName, render: (r) => r.accountName },
    {
      key: 'kind', header: 'Kind', width: '112px', align: 'center', sortValue: (r) => r.category,
      render: (r) => (<><Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge><CellSub>{r.type}</CellSub></>),
    },
    {
      key: 'ends', header: 'Endpoints', width: '216px',
      render: (r) => (
        <>
          <Mono className="whitespace-nowrap text-[12px]">{r.endpoints.slice(0, 2).map((e) => e.siteCode).join(' ↔ ')}</Mono>
          {r.endpoints.length > 2 && <CellSub>+{r.endpoints.length - 2} more sites</CellSub>}
        </>
      ),
    },
    {
      key: 'state', header: 'State', width: '128px', align: 'center', sortValue: (r) => r.state,
      render: (r) => (<><Badge tone={SERVICE_TONE[r.state]} dot>{r.state}</Badge>
        {r.state === 'Live' && <CellSub>{inr(r.monthlyValueInr)}/mo</CellSub>}</>),
    },
    {
      key: 'conf', header: 'Conformance', width: '158px', sortValue: (r) => r.conformance,
      render: (r) => (<><Badge tone={CONFORMANCE_TONE[r.conformance]}>{r.conformance}{r.driftCount ? ` ×${r.driftCount}` : ''}</Badge>
        {r.conformance === 'Ghost' && <CellSub>no configuration on device</CellSub>}</>),
    },
    { key: 'proven', header: 'Last proven', width: '116px', sortValue: (r) => r.lastProvenAt ?? '', render: (r) => <span className="text-ink-3">{relTime(r.lastProvenAt)}</span> },
    { key: 'age', header: 'Age', align: 'center', width: '86px', sortValue: (r) => new Date(r.liveSince).getTime(), render: (r) => r.ageLabel },
    {
      /* Next to Created / Modified on purpose: that column says when the
         service last moved, this one says how often and whether anyone
         approved it. Sortable, so "what has been churned most" is one click. */
      key: 'changes', header: 'Changes', width: '156px',
      sortValue: (r) => changeStats(r).total,
      render: (r) => {
        const { total, tracked, outOfBand } = changeStats(r)
        if (total === 0) return <span className="text-ink-3">Never modified</span>
        return (
          <>
            <CellMain>
              {/* Straight to the trail rather than the overview. Out-of-band
                  changes never reach the Lifecycle tab — no request exists for
                  them — so a service changed only outside the platform opens
                  on the change log instead, where its changes actually are. */}
              <Link
                to={`/inventory/${r.id}?tab=${tracked > 0 ? 'lifecycle' : 'history'}`}
                onClick={(e) => e.stopPropagation()}
                className="text-brand-600 hover:underline"
              >
                {total} change{total === 1 ? '' : 's'}
              </Link>
            </CellMain>
            <CellSub>
              {tracked > 0 && <span>{tracked} by request</span>}
              {tracked > 0 && outOfBand > 0 && ' · '}
              {outOfBand > 0 && <span className="text-warn-700">{outOfBand} out of band</span>}
            </CellSub>
          </>
        )
      },
    },
    stampColumn<Service>((r) => r.liveSince, (r) => lastChangedAt(r)),
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/inventory/${r.id}`) },
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Total services" icon={Boxes} value={services.length.toLocaleString()}
          progress={(n.state('Live') / services.length) * 100}
          note={`${n.state('Live').toLocaleString()} live · ${n.state('Degraded')} degraded · ${n.state('Suspended')} suspended`}
          info="All services in the inventory. The bar shows the live share."
          drillLabel="the unfiltered installed base" onClick={() => { clear(); scrollToResults() }} />
        <Stat label="Conformant" icon={ShieldCheck} value={n.conf('Conformant').toLocaleString()} tone="good"
          delta={{ text: '▲ 34 this week', tone: 'good' }}
          progress={(n.conf('Conformant') / services.length) * 100}
          note={`${Math.round((n.conf('Conformant') / services.length) * 100)}% of the base — device matches intent`}
          info="Configuration matches the request and a recent test confirmed traffic flows."
          drillLabel="conformant services" onClick={() => patch({ conf: 'Conformant', state: null })} />
        <Stat label="Never proven end to end" icon={ShieldQuestion} value={n.conf('Never proven')} tone="warn"
          delta={{ text: '▼ 22 this week', tone: 'good' }}
          progress={(n.conf('Never proven') / services.length) * 100}
          note={`${Math.round((n.conf('Never proven') / services.length) * 100)}% of the base — configured, never tested`}
          info="Configured services without a successful end-to-end traffic test."
          drillLabel="services never proven end to end" onClick={() => patch({ conf: 'Never proven', state: null })} />
        <Stat label="Ghost services" icon={Ghost} value={n.conf('Ghost')} tone="crit"
          progress={(n.conf('Ghost') / services.length) * 100}
          note={`${inr(ghostValue)} billed per year, nothing on the device`}
          info="Marked live and billed, but missing configuration on the device."
          drillLabel="ghost services" onClick={() => patch({ conf: 'Ghost', state: null })} />
      </div>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col">
          <CardHead title="Services by intent" sub="Volume by provisioning intent, ranked biggest first"
            info="Services grouped by workflow and ranked by volume. Select a tile to view that intent." />
          <CardBody className="vw-scroll-hint grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 max-h-[360px] overflow-y-auto">
            {intentItems.map((it) => (
              <button
                key={it.id} type="button" onClick={it.onClick}
                aria-label={`${it.value} services on intent ${it.label}. Open them`}
                className="flex flex-col gap-2 border border-line rounded-lg px-3 py-2.5 text-left cursor-pointer
                  transition-colors hover:bg-plane hover:border-brand-200
                  focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <i className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: it.color }} aria-hidden />
                  <span className="text-[11.5px] font-medium text-ink-2 truncate">{it.label}</span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[17px] font-semibold tnum text-ink-1 leading-none">{it.value.toLocaleString()}</span>
                  <span className="text-[11px] text-ink-3">{it.pct}%</span>
                </span>
                <div className="h-1.5 rounded-full bg-line-soft overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${it.pct}%`, background: it.color }} />
                </div>
              </button>
            ))}
          </CardBody>
        </Card>
      </div>

      <div ref={resultsRef} />
      <DataTable
        rows={ranked} total={services.length} columns={columns}
        onRowClick={(r) => nav(`/inventory/${r.id}`)}
        fillHeight
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Service, Customer' },
          /* State and conformance are visible columns and the most useful
             one-click cuts for an inventory list. */
          chips: [
            <FieldDropdown key="state" label="State" value={state} onChange={(v) => setState(v as ServiceState | 'All')}
              options={STATES.filter((st) => n.state(st) > 0).map((st) => ({ value: st, label: st, count: n.state(st) }))} />,
            <FieldDropdown key="conf" label="Conformance" value={conf} onChange={(v) => setConf(v as Conformance | 'All')}
              options={CONFS.filter((c) => n.conf(c) > 0).map((c) => ({ value: c, label: c, count: n.conf(c) }))} />,
          ],
          filters: [
            { key: 'service', label: 'Service', type: 'text', value: qservice, onChange: setQservice },
            { key: 'order', label: 'Order', type: 'text', value: qorder, onChange: setQorder },
            { key: 'customer', label: 'Customer', type: 'text', value: qcustomer, onChange: setQcustomer },
            { key: 'kind', label: 'Kind', type: 'text', value: qkind, onChange: setQkind },
            { key: 'state', label: 'State', value: state, onChange: (v) => setState(v as ServiceState | 'All'),
              options: STATES.filter((st) => n.state(st) > 0).map((st) => ({ value: st, label: st, count: n.state(st) })) },
            { key: 'conf', label: 'Conformance', value: conf, onChange: (v) => setConf(v as Conformance | 'All'),
              options: CONFS.filter((c) => n.conf(c) > 0).map((c) => ({ value: c, label: c, count: n.conf(c) })) },
          ],
          activeFilterChips: [
            ...(domain !== 'All' ? [{ key: 'domain', label: 'Domain', value: domain, onRemove: () => setDomainScoped('All') }] : []),
            ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
            ...(state !== 'All' ? [{ key: 'state', label: 'State', value: state, onRemove: () => setState('All') }] : []),
            ...(conf !== 'All' ? [{ key: 'conf', label: 'Conformance', value: conf, onRemove: () => setConf('All') }] : []),
            ...(intent !== 'All' ? [{ key: 'intent', label: 'Intent', value: intentName, onRemove: () => setIntent('All') }] : []),
            ...(origin !== 'All' ? [{ key: 'origin', label: 'Origin', value: ORIGIN_LABEL[origin], onRemove: () => setOrigin('All') }] : []),
            ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
            ...(qservice ? [{ key: 'service', label: 'Service', value: qservice, onRemove: () => setQservice('') }] : []),
            ...(qorder ? [{ key: 'order', label: 'Order', value: qorder, onRemove: () => setQorder('') }] : []),
            ...(qcustomer ? [{ key: 'customer', label: 'Customer', value: qcustomer, onRemove: () => setQcustomer('') }] : []),
            ...(qkind ? [{ key: 'kind', label: 'Kind', value: qkind, onRemove: () => setQkind('') }] : []),
          ],
          onResetFilters: clear,
        }}
      />
    </>
  )
}
