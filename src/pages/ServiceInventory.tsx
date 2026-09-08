import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { Download, Eye, GitBranch, Plus, RefreshCcw, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Conformance, Service, ServiceState } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellMain, CellSub, Chip, DataTable,
  FilterBanner, Kebab, Mono, Stat, type Column,
} from '@/components/ui'
import { BarList, StackedBar } from '@/components/charts'
import { CATEGORY_TONE, CONFORMANCE_TONE, inr, relTime, SERVICE_TONE } from '@/lib/format'

const STATES: ServiceState[] = ['Live', 'Activating', 'Degraded', 'Suspended', 'Ceased']
const CONFS: Conformance[] = ['Conformant', 'Drifted', 'Never proven', 'Ghost', 'Not checked']
const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW']

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
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [intent, setIntent] = useQueryState('intent', 'All')
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'state', 'conf', 'cat', 'intent'])
  const anyFilter = state !== 'All' || conf !== 'All' || cat !== 'All' || intent !== 'All'
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

  const filtered = useMemo(() => services.filter((s) => {
    if (state !== 'All' && s.state !== state) return false
    if (conf !== 'All' && s.conformance !== conf) return false
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
          ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
          ...(state !== 'All' ? [{ key: 'state', label: 'State', value: state, onRemove: () => setState('All') }] : []),
          ...(conf !== 'All' ? [{ key: 'conf', label: 'Conformance', value: conf, onRemove: () => setConf('All') }] : []),
          ...(intent !== 'All' ? [{ key: 'intent', label: 'Intent', value: intentName, onRemove: () => setIntent('All') }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Total services" value={services.length.toLocaleString()}
          note={`${n.state('Live').toLocaleString()} live · ${n.state('Degraded')} degraded · ${n.state('Suspended')} suspended`}
          drillLabel="the unfiltered installed base" onClick={clear} />
        <Stat label="Conformant" value={n.conf('Conformant').toLocaleString()} tone="good"
          delta={{ text: '▲ 34 this week', tone: 'good' }}
          drillLabel="conformant services" onClick={() => patch({ conf: 'Conformant', state: null })} />
        <Stat label="Never proven end to end" value={n.conf('Never proven')} tone="warn"
          delta={{ text: '▼ 22 this week', tone: 'good' }}
          drillLabel="services never proven end to end" onClick={() => patch({ conf: 'Never proven', state: null })} />
        <Stat label="Ghost services" value={n.conf('Ghost')} tone="crit"
          note={`${inr(ghostValue)} billed per year with no configuration on the device`}
          drillLabel="ghost services" onClick={() => patch({ conf: 'Ghost', state: null })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHead title="Conformance across the base" sub="Each service holds exactly one of these verdicts" />
          <CardBody>
            <StackedBar
              ariaLabel="Conformance split across the installed base"
              segments={[
                { label: 'Conformant', value: n.conf('Conformant'), fill: 'good', note: 'device matches intent, proven recently', onClick: () => setConf('Conformant') },
                { label: 'Drifted', value: n.conf('Drifted'), fill: 'warn', note: 'at least one attribute differs', onClick: () => setConf('Drifted') },
                { label: 'Never proven', value: n.conf('Never proven') + n.conf('Not checked'), fill: 'none', note: 'configured, never tested end to end', onClick: () => setConf('Never proven') },
                { label: 'Ghost', value: n.conf('Ghost'), fill: 'crit', note: 'record exists, no configuration', onClick: () => setConf('Ghost') },
              ]}
            />
            <div className="h-px bg-line-soft my-5" />
            <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-3">Services by intent</div>
            <BarList
              labelWidth={170}
              items={intents.map((i) => ({
                label: i.name,
                value: services.filter((s) => s.intentId === i.id).length,
                tone: 'brand' as const,
                drillLabel: `${services.filter((s) => s.intentId === i.id).length} services on intent ${i.name}`,
                onClick: () => patch({ intent: i.id, conf: null, state: null }),
              }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Needs attention" sub="Ranked by exposure" />
          <CardBody className="flex flex-col gap-4">
            <div>
              <div className="text-[12px] text-ink-3 font-medium">Ghost services</div>
              <div className="text-[23px] font-semibold text-crit-500 tnum">{n.conf('Ghost')}</div>
              <p className="text-[12px] text-ink-3 mt-1 leading-snug">
                Billed and marked live with no matching configuration on any endpoint. Combined {inr(ghostValue)} per year.
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" onClick={() => patch({ conf: 'Ghost', state: null })}>Show them</Button>
              </div>
            </div>
            <div className="h-px bg-line-soft" />
            <div>
              <div className="text-[12px] text-ink-3 font-medium">Degraded right now</div>
              <div className="text-[23px] font-semibold text-warn-700 tnum">{n.state('Degraded')}</div>
              <p className="text-[12px] text-ink-3 mt-1 leading-snug">Contractually live, operationally impaired.</p>
              <div className="mt-2.5"><Button size="sm" onClick={() => patch({ state: 'Degraded', conf: null })}>Show them</Button></div>
            </div>
            <div className="h-px bg-line-soft" />
            <div>
              <div className="text-[12px] text-ink-3 font-medium">Drifted from intent</div>
              <div className="text-[23px] font-semibold text-warn-700 tnum">{n.conf('Drifted')}</div>
              <p className="text-[12px] text-ink-3 mt-1 leading-snug">At least one attribute on the device disagrees with the order.</p>
              <div className="mt-2.5"><Button size="sm" onClick={() => patch({ conf: 'Drifted', state: null })}>Show them</Button></div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div ref={resultsRef} />
      <DataTable
        rows={filtered} total={services.length} columns={columns} pageSize={12}
        onRowClick={(r) => nav(`/inventory/${r.id}`)}
        rowTone={(r) => (r.conformance === 'Ghost' ? 'crit' : r.conformance === 'Drifted' || r.state === 'Degraded' ? 'warn' : undefined)}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Service, Customer, Site' },
          chips: CATS.map((c) => <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} count={n.cat(c)} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>),
          filters: [
            { key: 'state', label: 'State', value: state, onChange: (v) => setState(v as ServiceState | 'All'),
              options: STATES.map((st) => ({ value: st, label: st, count: n.state(st) })) },
            { key: 'conf', label: 'Conformance', value: conf, onChange: (v) => setConf(v as Conformance | 'All'),
              options: CONFS.filter((c) => n.conf(c) > 0).map((c) => ({ value: c, label: c, count: n.conf(c) })) },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: CATS.map((c) => ({ value: c, label: c, count: n.cat(c) })) },
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
