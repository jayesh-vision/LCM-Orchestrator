import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { Activity, Boxes, ChevronRight, Download, Eye, Ghost, GitBranch, GitCompare, Plus, RefreshCcw, ShieldCheck, ShieldQuestion, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Conformance, Domain, Service, ServiceState } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Card, CardBody, CardHead, CellMain, CellSub, Chip, DataTable,
  FilterBanner, Kebab, Mono, Stat, type Column,
} from '@/components/ui'
import { BarList, CHART, Donut, FILL, type FillKey } from '@/components/charts'
import { CATEGORY_TONE, CONFORMANCE_TONE, DOMAIN_TONE, inr, relTime, SERVICE_TONE } from '@/lib/format'

const STATES: ServiceState[] = ['Live', 'Activating', 'Degraded', 'Suspended', 'Ceased']
const CONFS: Conformance[] = ['Conformant', 'Drifted', 'Never proven', 'Ghost', 'Not checked']
const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM']

export default function ServiceInventory() {
  const services = useStore((s) => s.services)
  const intents = useStore((s) => s.intents)
  const reprove = useStore((s) => s.reproveService)
  const raiseChange = useStore((s) => s.raiseChange)
  const pushToast = useStore((s) => s.pushToast)
  const nav = useNavigate()

  const [q, setQ] = useQueryState('q', '')
  const [state, setState] = useQueryState<ServiceState | 'All'>('state', 'All')
  const [conf, setConf] = useQueryState<Conformance | 'All'>('conf', 'All')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [intent, setIntent] = useQueryState('intent', 'All')
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'state', 'conf', 'domain', 'cat', 'intent'])
  const domainCats = domain === 'All' ? CATS : CATEGORIES_BY_DOMAIN[domain]
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const pickDomain = (d: Domain) => setDomainScoped(domain === d ? 'All' : d)
  const anyFilter = state !== 'All' || conf !== 'All' || domain !== 'All' || cat !== 'All' || intent !== 'All'
  const resultsRef = useScrollToResultsOnDrillIn(anyFilter)
  const intentName = intents.find((i) => i.id === intent)?.name ?? intent

  const n = {
    state: (s: ServiceState) => services.filter((x) => x.state === s).length,
    conf: (c: Conformance) => services.filter((x) => x.conformance === c).length,
    cat: (c: Category) => services.filter((x) => x.category === c).length,
  }

  const ghostValue = useMemo(
    () => services.filter((s) => s.conformance === 'Ghost').reduce((a, s) => a + s.monthlyValueInr * 12, 0),
    [services],
  )

  const confSegs: { label: string; value: number; fill: FillKey; note: string; onClick: () => void }[] = [
    { label: 'Conformant', value: n.conf('Conformant'), fill: 'good', note: 'device matches intent, proven recently', onClick: () => setConf('Conformant') },
    { label: 'Drifted', value: n.conf('Drifted'), fill: 'warn', note: 'at least one attribute differs', onClick: () => setConf('Drifted') },
    { label: 'Never proven', value: n.conf('Never proven') + n.conf('Not checked'), fill: 'none', note: 'configured, never tested end to end', onClick: () => setConf('Never proven') },
    { label: 'Ghost', value: n.conf('Ghost'), fill: 'crit', note: 'record exists, no configuration', onClick: () => setConf('Ghost') },
  ]

  const filtered = useMemo(() => services.filter((s) => {
    if (state !== 'All' && s.state !== state) return false
    if (conf !== 'All' && s.conformance !== conf) return false
    if (domain !== 'All' && domainOf(s.category) !== domain) return false
    if (cat !== 'All' && s.category !== cat) return false
    if (intent !== 'All' && s.intentId !== intent) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(s.id.toLowerCase().includes(t) || s.name.toLowerCase().includes(t)
        || s.accountName.toLowerCase().includes(t)
        || s.endpoints.some((e) => e.siteCode.toLowerCase().includes(t)))) return false
    }
    return true
  }), [services, state, conf, cat, intent, q])

  const columns: Column<Service>[] = [
    {
      key: 'svc', header: 'Service', width: '210px', sortValue: (r) => r.id,
      render: (r) => (<><CellMain><Mono>{r.id}</Mono></CellMain><CellSub>{r.name}</CellSub></>),
    },
    { key: 'acct', header: 'Customer', width: '186px', sortValue: (r) => r.accountName, render: (r) => r.accountName },
    {
      key: 'kind', header: 'Kind', width: '112px', sortValue: (r) => r.category,
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
      key: 'state', header: 'State', width: '128px', sortValue: (r) => r.state,
      render: (r) => (<><Badge tone={SERVICE_TONE[r.state]} dot>{r.state}</Badge>
        {r.state === 'Live' && <CellSub>{inr(r.monthlyValueInr)}/mo</CellSub>}</>),
    },
    {
      key: 'conf', header: 'Conformance', width: '158px', sortValue: (r) => r.conformance,
      render: (r) => (<><Badge tone={CONFORMANCE_TONE[r.conformance]}>{r.conformance}{r.driftCount ? ` ×${r.driftCount}` : ''}</Badge>
        {r.conformance === 'Ghost' && <CellSub>no configuration on device</CellSub>}</>),
    },
    { key: 'proven', header: 'Last proven', width: '116px', sortValue: (r) => r.lastProvenAt ?? '', render: (r) => <span className="text-ink-3">{relTime(r.lastProvenAt)}</span> },
    { key: 'age', header: 'Age', align: 'right', width: '86px', sortValue: (r) => new Date(r.liveSince).getTime(), render: (r) => r.ageLabel },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/inventory/${r.id}`) },
          { label: 'Re-prove now', icon: RefreshCcw, onClick: () => reprove(r.id) },
          { label: 'Life cycle operation', icon: GitBranch, onClick: () => { raiseChange(r.id, 'Modify', [{ attribute: 'Bandwidth', current: `${r.bandwidthMbps} Mbps`, requested: `${r.bandwidthMbps * 2} Mbps` }]); nav('/change') } },
          { label: 'Cease service', icon: XCircle, onClick: () => { raiseChange(r.id, 'Cease'); nav('/change') }, danger: true },
        ]} />
      ),
    },
  ]

  return (
    <>

      <FilterBanner
        count={filtered.length} noun="services" onClear={clear}
        filters={[
          ...(domain !== 'All' ? [{ key: 'domain', label: 'Domain', value: domain, onRemove: () => setDomain('All') }] : []),
          ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
          ...(state !== 'All' ? [{ key: 'state', label: 'State', value: state, onRemove: () => setState('All') }] : []),
          ...(conf !== 'All' ? [{ key: 'conf', label: 'Conformance', value: conf, onRemove: () => setConf('All') }] : []),
          ...(intent !== 'All' ? [{ key: 'intent', label: 'Intent', value: intentName, onRemove: () => setIntent('All') }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Total services" icon={Boxes} value={services.length.toLocaleString()}
          progress={(n.state('Live') / services.length) * 100}
          note={`${n.state('Live').toLocaleString()} live · ${n.state('Degraded')} degraded · ${n.state('Suspended')} suspended`}
          info="Every service record in the inventory, in any state — live, activating, degraded, suspended or ceased. The bar shows how much of the base is live."
          drillLabel="the unfiltered installed base" onClick={clear} />
        <Stat label="Conformant" icon={ShieldCheck} value={n.conf('Conformant').toLocaleString()} tone="good"
          delta={{ text: '▲ 34 this week', tone: 'good' }}
          progress={(n.conf('Conformant') / services.length) * 100}
          note={`${Math.round((n.conf('Conformant') / services.length) * 100)}% of the base — device matches intent`}
          info="Services where the configuration found on the device matches what the order asked for, and a recent end-to-end test proved traffic actually flows. This is the healthy state."
          drillLabel="conformant services" onClick={() => patch({ conf: 'Conformant', state: null })} />
        <Stat label="Never proven end to end" icon={ShieldQuestion} value={n.conf('Never proven')} tone="warn"
          delta={{ text: '▼ 22 this week', tone: 'good' }}
          progress={(n.conf('Never proven') / services.length) * 100}
          note={`${Math.round((n.conf('Never proven') / services.length) * 100)}% of the base — configured, never tested`}
          info="Services that were configured on the device but have never had an end-to-end test proving customer traffic actually moves. The config may be right — nobody has checked."
          drillLabel="services never proven end to end" onClick={() => patch({ conf: 'Never proven', state: null })} />
        <Stat label="Ghost services" icon={Ghost} value={n.conf('Ghost')} tone="crit"
          progress={(n.conf('Ghost') / services.length) * 100}
          note={`${inr(ghostValue)} billed per year, nothing on the device`}
          info="Services billed and marked live in the record, but with no matching configuration on any device — the customer is invoiced for something the network isn't delivering. The highest-priority cleanup."
          drillLabel="ghost services" onClick={() => patch({ conf: 'Ghost', state: null })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="flex flex-col">
          <CardHead title="Conformance across the base" sub="Each service holds exactly one of these verdicts"
            info="Compares what each order says the service should be (the intent) with what is actually configured on the devices. Every service holds exactly one verdict — Conformant, Drifted, Never proven or Ghost — so the four counts always add up to the whole base. Click any segment or tile to open those services." />
          <CardBody className="flex-1 flex flex-col">
            <div className="flex items-center gap-6 flex-wrap">
              <Donut
                size={158}
                segments={confSegs.map(({ label, value, fill, onClick }) => ({ label, value, fill, onClick }))}
              />
              <div className="flex-1 min-w-[280px] grid sm:grid-cols-2 gap-2.5">
                {confSegs.map((s) => (
                  <button
                    key={s.label} type="button" onClick={s.onClick}
                    aria-label={`${s.label}: ${s.value}. Open the matching services`}
                    className="flex items-start gap-2.5 border border-line rounded-lg px-3.5 py-2.5 text-left cursor-pointer
                      transition-colors hover:bg-plane hover:border-brand-200
                      focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
                  >
                    <i className="w-2.5 h-2.5 rounded-[3px] shrink-0 mt-1.5" style={{ background: FILL[s.fill] }} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[16px] font-semibold tnum text-ink-1 leading-tight">
                        {s.value.toLocaleString()}
                        <span className="text-[11px] text-ink-3 font-medium ml-1.5">{Math.round((s.value / services.length) * 100)}%</span>
                      </span>
                      <span className="block text-[12px] font-medium text-ink-2 mt-0.5">{s.label}</span>
                      <span className="block text-[11px] text-ink-3 leading-snug">{s.note}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="h-px bg-line-soft my-5" />
            <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-3">Services by intent</div>
            <BarList
              labelWidth={170}
              valueWidth={96}
              items={[...intents]
                .map((i) => ({ intent: i, count: services.filter((s) => s.intentId === i.id).length }))
                .sort((a, b) => b.count - a.count)
                .map(({ intent: i, count }, rank) => ({
                  label: i.name,
                  value: count,
                  color: [CHART.blue700, CHART.blue600, CHART.blue500, CHART.blue400, CHART.blue300, CHART.blue200][Math.min(rank, 5)],
                  valueLabel: `${count.toLocaleString()} · ${Math.round((count / services.length) * 100)}%`,
                  drillLabel: `${count} services on intent ${i.name}`,
                  onClick: () => patch({ intent: i.id, conf: null, state: null }),
                }))}
            />
          </CardBody>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Needs attention" sub="Ranked by exposure — click a row to open the matching services"
            info="The three service groups carrying operational or revenue risk right now, ranked by how much exposure each one represents. Ghost services leak revenue, degraded services break the customer experience, and drifted services no longer match their order." />
          <CardBody className="flex-1 flex flex-col gap-3">
            {([
              {
                key: 'ghost', label: 'Ghost services', count: n.conf('Ghost'), icon: Ghost,
                tint: 'bg-crit-50 text-crit-500', num: 'text-crit-500',
                why: `Billed and marked live with no configuration on any endpoint. Combined ${inr(ghostValue)} per year.`,
                go: () => patch({ conf: 'Ghost', state: null }),
              },
              {
                key: 'degraded', label: 'Degraded right now', count: n.state('Degraded'), icon: Activity,
                tint: 'bg-warn-50 text-warn-700', num: 'text-warn-700',
                why: 'Contractually live, operationally impaired.',
                go: () => patch({ state: 'Degraded', conf: null }),
              },
              {
                key: 'drifted', label: 'Drifted from intent', count: n.conf('Drifted'), icon: GitCompare,
                tint: 'bg-warn-50 text-warn-700', num: 'text-warn-700',
                why: 'At least one attribute on the device disagrees with the order.',
                go: () => patch({ conf: 'Drifted', state: null }),
              },
            ]).map((row) => (
              <button
                key={row.key} type="button" onClick={row.go}
                aria-label={`${row.label}: ${row.count}. Open the matching services`}
                className="flex-1 flex items-center gap-3.5 border border-line rounded-lg px-4 py-3 text-left cursor-pointer
                  transition-colors hover:bg-plane hover:border-brand-200 group
                  focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
              >
                <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${row.tint}`} aria-hidden>
                  <row.icon size={17} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-ink-1">{row.label}</span>
                  <span className="block text-[12px] text-ink-3 mt-0.5 leading-snug">{row.why}</span>
                </span>
                <span className="text-right shrink-0">
                  <span className={`block text-[22px] font-semibold tnum leading-tight ${row.num}`}>{row.count}</span>
                  <span className="block text-[11px] text-ink-3">{((row.count / services.length) * 100).toFixed(1)}% of base</span>
                </span>
                <ChevronRight size={16} className="text-ink-3 shrink-0 group-hover:text-brand-600 transition-colors" aria-hidden />
              </button>
            ))}
          </CardBody>
        </Card>
      </div>

      <div ref={resultsRef} />
      <DataTable
        rows={filtered} total={services.length} columns={columns} pageSize={12}
        onRowClick={(r) => nav(`/inventory/${r.id}`)}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Service, Customer, Site' },
          chips: [
            ...DOMAINS.map((d) => <Chip key={d} tone={DOMAIN_TONE[d]} active={domain === d} onClick={() => pickDomain(d)}>{d}</Chip>),
            ...domainCats.map((c) => <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>),
          ],
          filters: [
            { key: 'state', label: 'State', value: state, onChange: (v) => setState(v as ServiceState | 'All'),
              options: STATES.map((st) => ({ value: st, label: st, count: n.state(st) })) },
            { key: 'conf', label: 'Conformance', value: conf, onChange: (v) => setConf(v as Conformance | 'All'),
              options: CONFS.filter((c) => n.conf(c) > 0).map((c) => ({ value: c, label: c, count: n.conf(c) })) },
            { key: 'domain', label: 'Domain', value: domain, onChange: (v) => setDomainScoped(v as Domain | 'All'),
              options: DOMAINS.map((d) => ({ value: d, label: d, count: services.filter((s) => domainOf(s.category) === d).length })) },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: domainCats.map((c) => ({ value: c, label: c, count: n.cat(c) })) },
            { key: 'intent', label: 'Intent', value: intent, onChange: setIntent,
              options: intents.map((i) => ({ value: i.id, label: i.name, count: services.filter((s) => s.intentId === i.id).length })) },
            { key: 'q', label: 'Service / Customer / Site', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: clear,
          onRefresh: () => pushToast('info', 'Inventory refreshed.'),
          actions: [
            { label: 'New network service', icon: Plus, onClick: () => nav('/requests/new') },
            { label: 'Export to CSV', icon: Download, onClick: () => pushToast('info', 'Export queued — the file will appear in Reports.') },
            { label: 'Bulk re-prove shown', icon: RefreshCcw, onClick: () => { filtered.slice(0, 25).forEach((s) => reprove(s.id)); pushToast('good', `Re-prove queued for ${Math.min(25, filtered.length)} services.`) } },
          ],
        }}
      />
    </>
  )
}
