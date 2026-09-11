import { useMemo, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, Boxes, Gauge, Globe, Server, Timer } from 'lucide-react'
import type { Category, Order, OrderIntent, OrderState, Run, Vendor } from '@/types'
import { domainOf } from '@/types'
import { Badge, Card, CardBody, CardHead, type StatTone } from '@/components/ui'
import { BarList, ColumnChart, Donut, DonutLegend, SOFT, StackedBar, TrendChart } from '@/components/charts'
import { VENDOR_LABEL } from '@/data/workflows'
import { CATEGORY_TONE, dur } from '@/lib/format'

const DAY = 86400000

/** Count per calendar day over the last `days`, oldest first. */
function perDay(dates: string[], days: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const out = new Array(days).fill(0)
  dates.forEach((d) => {
    const i = days - 1 - Math.floor((today.getTime() - new Date(new Date(d).setHours(0, 0, 0, 0)).getTime()) / DAY)
    if (i >= 0 && i < days) out[i] += 1
  })
  return out
}

/** Highest failure rate among keys with at least `minSample` orders, so one
 * unlucky order out of one doesn't read as a 100% trend. */
function worstBy(orders: Order[], keyOf: (o: Order) => string | undefined, failStates: OrderState[], minSample: number) {
  const m = new Map<string, { total: number; failed: number }>()
  orders.forEach((o) => {
    const k = keyOf(o)
    if (k === undefined) return
    const e = m.get(k) ?? { total: 0, failed: 0 }
    e.total += 1
    if (failStates.includes(o.state)) e.failed += 1
    m.set(k, e)
  })
  let worst: { key: string; total: number; failed: number; rate: number } | undefined
  m.forEach((v, k) => {
    if (v.total < minSample) return
    const rate = v.failed / v.total
    if (!worst || rate > worst.rate || (rate === worst.rate && v.failed > worst.failed)) worst = { key: k, total: v.total, failed: v.failed, rate }
  })
  return worst
}
const riskTone = (rate: number): StatTone => (rate >= 0.25 ? 'crit' : rate >= 0.1 ? 'warn' : 'good')
/** Raw hex counterpart of `riskTone`, for components that take a colour
 * instead of a tone name (BarList). */
const riskColor = (rate: number) => (rate >= 0.25 ? SOFT.crit : rate >= 0.1 ? SOFT.warn : SOFT.brand)

type Patch = Record<string, string | null | undefined>

/**
 * One line in a donut card's legend: a colour dot matching its ring slice,
 * label + value on one row, and a note that wraps instead of truncating (the
 * old stacked rows clipped "Rejected, invalid or rolled back — needs a
 * retry" mid-sentence). A plain list row rather than a boxed tile — the
 * donut is the widget here, this just names its slices.
 */
function RingLegendRow({ color, label, value, note, onClick, drillLabel }: {
  color: string
  label: string
  value: ReactNode
  note: string
  onClick?: () => void
  drillLabel?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, 'aria-label': drillLabel ?? label } : {})}
      className={`group flex flex-col gap-0.5 text-left w-full py-2 border-b border-line-soft last:border-b-0
        ${onClick ? 'cursor-pointer hover:bg-plane -mx-1.5 px-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100' : ''}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} aria-hidden />
          <span className="text-[12.5px] font-semibold text-ink-1 truncate">{label}</span>
        </span>
        <span className="flex items-center gap-1 shrink-0">
          <span className="tnum font-semibold text-[14px] text-ink-1">{value}</span>
          {onClick && <ArrowUpRight size={12} className="text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />}
        </span>
      </span>
      <span className="text-[11px] text-ink-3 leading-snug pl-[18px]">{note}</span>
    </Tag>
  )
}

/**
 * The six things a request can be, in lifecycle order rather than ranked by
 * volume — a card people read repeatedly should hold still while they change
 * the filters, so each type keeps its own colour. Create is the only one
 * that builds something new; every other type acts on a service that is
 * already carrying traffic, which is the split the ring exists to show.
 * Every intent gets its own colour (no repeats) so the ring and the legend
 * beside it are unambiguous without an icon per row.
 */
const INTENT_META: { intent: OrderIntent; color: string }[] = [
  { intent: 'Create', color: SOFT.brand },
  { intent: 'Modify', color: SOFT.purple },
  { intent: 'Suspend', color: SOFT.warn },
  { intent: 'Resume', color: SOFT.good },
  { intent: 'Cease', color: SOFT.crit },
  { intent: 'Re-prove', color: SOFT.cyan },
]

/** Icon-chip tone tokens for Problem spotlight's metric grid — a small local
 * map, since these cells use an icon + coloured value neither Stat nor
 * StatRow renders. */
const ICON_TONE: Record<StatTone | 'brand', { value: string; iconBg: string; iconFg: string; ring: string }> = {
  brand: { value: 'text-ink-1', iconBg: 'bg-brand-50', iconFg: 'text-brand-600', ring: 'ring-brand-200/60' },
  good: { value: 'text-good-700', iconBg: 'bg-good-50', iconFg: 'text-good-700', ring: 'ring-good-200/70' },
  warn: { value: 'text-warn-700', iconBg: 'bg-warn-50', iconFg: 'text-warn-700', ring: 'ring-warn-200/70' },
  crit: { value: 'text-crit-500', iconBg: 'bg-crit-50', iconFg: 'text-crit-500', ring: 'ring-crit-200/70' },
  plum: { value: 'text-plum-700', iconBg: 'bg-plum-50', iconFg: 'text-plum-700', ring: 'ring-plum-200/70' },
}

/**
 * One cell in Problem spotlight's 2×2 metric grid — an icon, a headline
 * value and a label, with the note wrapping in full underneath instead of
 * a truncated line. Plain padding and a hover tint, not a bordered tile.
 */
function SpotlightStat({ icon: Icon, tone, value, label, note, onClick, drillLabel }: {
  icon: ComponentType<{ size?: number; className?: string }>
  tone?: StatTone
  value: ReactNode
  label: string
  note: string
  onClick?: () => void
  drillLabel?: string
}) {
  const c = ICON_TONE[tone ?? 'brand']
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, 'aria-label': drillLabel ?? label } : {})}
      className={`group flex flex-col gap-1 text-left rounded-lg p-1.5 -m-1.5
        ${onClick ? 'cursor-pointer hover:bg-plane transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100' : ''}`}
    >
      <span className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ring-1 ring-inset ${c.iconBg} ${c.iconFg} ${c.ring}`} aria-hidden>
          <Icon size={14} />
        </span>
        <span className={`tnum font-semibold text-[16px] leading-none ${c.value}`}>{value}</span>
      </span>
      <span className="text-[11.5px] font-semibold text-ink-1 leading-tight">{label}</span>
      <span className="text-[10.5px] text-ink-3 leading-snug">{note}</span>
    </Tag>
  )
}

/* The two vocabularies the pipeline's halves have always used. A request can
   fail before a device is ever touched (Invalid pre-validation), which is why
   the request-side failure lane is one state wider than execution's. */
const REQUEST_FAIL: OrderState[] = ['Failed', 'Rejected', 'Invalid', 'Reinstantiate']
const EXEC_FAIL: OrderState[] = ['Failed', 'Rejected', 'Reinstantiate']
/* Still waiting on design or a decision — not yet in execution's pool. */
const PRE_EXECUTION: OrderState[] = ['Draft', 'Planned', 'Validated', 'Invalid']

/** Inline chart legend — a dot per key, so a chart that mixes request-phase
 * and execution-phase marks says which is which right beside its title. */
function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex vw-wrap items-center gap-x-4 gap-y-1 px-4 pt-3">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color }} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  )
}

/**
 * The analytics home for the unified Provisioning Requests screen — one
 * combined view, with Requests and Execution kept tellable inside it: each
 * half has its own at-a-glance card, and the shared charts carry both on the
 * same canvas with the phase split labelled on the marks and in a legend.
 * Scoped to whatever the caller's domain/category/search selection already
 * resolved to (ignoring only the status filter, since status is exactly
 * what these charts break down); every element drills back into Listing
 * with the matching filter applied via `onDrill`.
 */
export function ProvisioningInsights({ orders, runs, onDrill }: {
  orders: Order[]
  runs?: Run[]
  onDrill: (patch: Patch) => void
}) {
  const cnt = (...st: OrderState[]) => orders.filter((o) => st.includes(o.state)).length
  const total = orders.length
  const noun = 'requests'

  /* Execution's own pool, exactly as the standalone Execution screen scoped
     it: everything past design and decision. Same orders, one stage later. */
  const execPool = useMemo(() => orders.filter((o) => !PRE_EXECUTION.includes(o.state)), [orders])
  const ecnt = (...st: OrderState[]) => execPool.filter((o) => st.includes(o.state)).length

  const byCategory = useMemo(() => {
    const m = new Map<Category, Order[]>()
    orders.forEach((o) => { if (!m.has(o.category)) m.set(o.category, []); m.get(o.category)!.push(o) })
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [orders])

  const byIntent = useMemo(() => {
    const m = new Map<OrderIntent, number>()
    orders.forEach((o) => m.set(o.intent, (m.get(o.intent) ?? 0) + 1))
    return m
  }, [orders])

  /* Grouped by each order's first (primary/Source) endpoint — a two-ended
     order can technically span two vendors, so this is a KPI-level signal
     about where the load and the failures concentrate, not a full
     multi-vendor audit of every endpoint. */
  const byVendor = useMemo(() => {
    const m = new Map<Vendor, Order[]>()
    orders.forEach((o) => {
      const v = o.endpoints[0]?.vendor
      if (!v) return
      if (!m.has(v)) m.set(v, [])
      m.get(v)!.push(o)
    })
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [orders])

  const worstDomain = useMemo(() => worstBy(orders, (o) => domainOf(o.category), REQUEST_FAIL, 1), [orders])
  const worstVendor = useMemo(() => worstBy(orders, (o) => o.endpoints[0]?.vendor, REQUEST_FAIL, 3), [orders])
  const worstModel = useMemo(() => worstBy(orders, (o) => o.endpoints[0]?.deviceName, REQUEST_FAIL, 3), [orders])
  const slaBreaches = orders.filter((o) => o.slaBreached).length

  const DAYS = 14
  const trend = useMemo(() => {
    const labels = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(Date.now() - (DAYS - 1 - i) * DAY)
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    })
    return {
      labels,
      raised: perDay(orders.map((o) => o.createdAt), DAYS),
      completed: perDay(orders.filter((o) => o.state === 'Ready').map((o) => o.updatedAt), DAYS),
    }
  }, [orders])

  /* ---------------- execution health figures ---------------- */
  const execIds = new Set(execPool.map((o) => o.id))
  const scopedRuns = (runs ?? []).filter((r) => execIds.has(r.orderId))
  const firstAttempts = scopedRuns.filter((r) => r.attempt === 1 && r.outcome !== 'Running')
  const firstPassRate = firstAttempts.length ? Math.round((firstAttempts.filter((r) => r.outcome === 'Accepted').length / firstAttempts.length) * 100) : undefined
  const durations = scopedRuns.map((r) => r.durationMs).filter((d): d is number => d !== undefined)
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : undefined

  /* -------- request-side figures, as the Requests screen counted them ---- */
  const waiting = cnt('Validated')
  const readyToRun = cnt('Approved', 'Queued')
  const reqFailed = cnt(...REQUEST_FAIL)

  /* -------- execution-side figures, as the Execution screen counted them - */
  const execTotal = execPool.length
  const execReady = ecnt('Ready')
  const execInProgress = ecnt('In progress', 'Queued', 'Approved')
  const execFailed = ecnt(...EXEC_FAIL)

  /* What the work is, rather than how much of it there is: every request in
     scope falls into exactly one of these six, so a ring fits it without a
     residual slice. Whether this queue is mostly Create or mostly Modify is
     the difference between an estate still being built and one being
     maintained. `justify-center` (rather than pt-1/top-aligned) is what
     keeps this card free of trailing white space: the donut + legend block
     is shorter than the Requests/Execution cards' donut + 3-row list, so
     top-aligning it left a visible gap under the legend — centering spreads
     any leftover room evenly above and below instead. */
  const intentSegments = INTENT_META.map(({ intent, color }) => ({
    label: intent, value: byIntent.get(intent) ?? 0, fill: 'brand' as const, color,
    onClick: (byIntent.get(intent) ?? 0) > 0 ? () => onDrill({ intent, state: null }) : undefined,
  }))
  const intentCard = (
    <Card className="h-full flex flex-col">
      <CardHead title="By request type" sub="Why each one was raised, for the current selection"
        info="Every request in the current selection counted by why it was raised. Create is the only type that builds something new — Modify, Suspend, Resume, Cease and Re-prove all act on a service that is already live, so the balance between Create and the rest says whether this queue is growing the estate or maintaining it. Click a slice or a row to open just those." />
      <CardBody className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4">
        <Donut size={128} total={total} segments={intentSegments} />
        <DonutLegend segments={intentSegments} columns={2} />
      </CardBody>
    </Card>
  )

  /* One combined "Problem spotlight" card instead of 3–7 separate stat rows.
     Unlike Requests/Execution/By request type, these six figures aren't
     parts of one whole — a percentage, a count and a duration can't share a
     ring — so the widget here is a dense 2×2 metric grid instead: request
     risk and SLA first, then execution's own health (first-pass rate, run
     duration), laid out two to a row so all six fill the card with no
     scrolling and no trailing gap. */
  const spotlightCard = (
    <Card className="h-full flex flex-col">
      <CardHead title="Problem spotlight" sub="Where failures are concentrated in scope right now"
        info="The domain, vendor and device model with the highest failure rate in the current scope (vendor and model need at least 3 orders to qualify, so one unlucky order doesn't look like a trend), plus SLA breaches and how execution itself is performing. Click a metric to open those failures." />
      <CardBody className="flex-1 min-h-0 grid grid-cols-2 gap-x-4 gap-y-3.5 content-start">
        <SpotlightStat icon={Globe} value={worstDomain ? `${Math.round(worstDomain.rate * 100)}%` : '—'} label="Riskiest domain"
          tone={worstDomain ? riskTone(worstDomain.rate) : undefined}
          note={worstDomain ? `${worstDomain.key} — ${worstDomain.failed} of ${worstDomain.total} failed` : 'Not enough data in scope'}
          drillLabel={worstDomain ? `failed ${worstDomain.key} ${noun}` : undefined}
          onClick={worstDomain ? () => onDrill({ domain: worstDomain.key, state: REQUEST_FAIL.join(',') }) : undefined} />
        <SpotlightStat icon={Boxes} value={worstVendor ? `${Math.round(worstVendor.rate * 100)}%` : '—'} label="Riskiest vendor"
          tone={worstVendor ? riskTone(worstVendor.rate) : undefined}
          note={worstVendor ? `${VENDOR_LABEL[worstVendor.key as Vendor] ?? worstVendor.key} — ${worstVendor.failed} of ${worstVendor.total} failed` : 'Needs 3+ orders on one vendor'}
          drillLabel={worstVendor ? `failed orders on ${worstVendor.key}` : undefined}
          onClick={worstVendor ? () => onDrill({ vendor: worstVendor.key, state: REQUEST_FAIL.join(',') }) : undefined} />
        <SpotlightStat icon={Server} value={worstModel ? `${Math.round(worstModel.rate * 100)}%` : '—'} label="Riskiest model"
          tone={worstModel ? riskTone(worstModel.rate) : undefined}
          note={worstModel ? `${worstModel.key} — ${worstModel.failed} of ${worstModel.total} failed` : 'Needs 3+ orders on one model'}
          drillLabel={worstModel ? `failed orders on ${worstModel.key}` : undefined}
          onClick={worstModel ? () => onDrill({ q: worstModel.key, state: REQUEST_FAIL.join(',') }) : undefined} />
        <SpotlightStat icon={AlertTriangle} value={slaBreaches} label="SLA breaches"
          tone={slaBreaches ? 'crit' : 'good'}
          note={slaBreaches ? `${slaBreaches} request${slaBreaches === 1 ? '' : 's'} past commitment` : 'Nothing has breached SLA in scope'} />
        <SpotlightStat icon={Gauge} value={firstPassRate !== undefined ? `${firstPassRate}%` : '—'} label="First-pass rate"
          tone={firstPassRate === undefined ? undefined : firstPassRate >= 90 ? 'good' : firstPassRate >= 70 ? 'plum' : 'crit'}
          note="First attempts accepted without a retry" />
        <SpotlightStat icon={Timer} value={avgDuration !== undefined ? dur(avgDuration) : '—'} label="Average run duration"
          note="Across every run in scope" />
      </CardBody>
    </Card>
  )

  /* The whole pipeline in one chart, with the request/execution split carried
     on the marks themselves: grey bars are the request phase (still being
     designed or decided), coloured bars are the execution phase — blue while
     work is moving, green done, red failed. Each bar also says which phase it
     belongs to under its stage label, and the legend states the code. */
  const stages: { label: string; states: OrderState[]; color: string; phase: 'Requests' | 'Execution' }[] = [
    { label: 'Draft', states: ['Draft'], color: SOFT.none, phase: 'Requests' },
    { label: 'Planned', states: ['Planned'], color: SOFT.none, phase: 'Requests' },
    { label: 'Validated', states: ['Validated'], color: SOFT.none, phase: 'Requests' },
    { label: 'Approved', states: ['Approved', 'Queued'], color: SOFT.brand, phase: 'Execution' },
    { label: 'In progress', states: ['In progress'], color: SOFT.brand, phase: 'Execution' },
    { label: 'Ready', states: ['Ready'], color: SOFT.good, phase: 'Execution' },
    { label: 'Failed', states: ['Failed'], color: SOFT.crit, phase: 'Execution' },
  ]

  return (
    <div className="flex flex-col gap-4">

      {/* One glance card per half of the pipeline, side by side, with exactly
         the same counts each standalone screen always showed — as a donut
         plus legend list, so the card fills its height with content instead
         of a partly-empty list. Requests' ring carries a fourth, grey slice
         for everything the three named figures don't cover — draft, planned,
         in progress or already live — so the ring is never misleadingly
         partial; Execution's three slices already exhaust its pool. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="h-full flex flex-col">
          <CardHead title="Requests" sub="At a glance, for the current selection"
            info="Every request in the current selection, as one ring: how many are waiting on a decision, how many are cleared and ready to run, and how many failed. The grey slice is everything else in the pipeline — drafted, planned, in progress or already live. Click a slice or a row to open exactly those requests." />
          <CardBody className="flex-1 min-h-0 flex flex-col items-center gap-1 pt-1">
            <Donut size={116} total={total} segments={[
              { label: 'Waiting for approval', value: waiting, fill: 'brand', color: SOFT.purple, onClick: () => onDrill({ state: 'Validated' }) },
              { label: 'Ready to run', value: readyToRun, fill: 'good', color: SOFT.good, onClick: () => onDrill({ state: 'Approved,Queued' }) },
              { label: 'Failed', value: reqFailed, fill: 'crit', color: SOFT.crit, onClick: () => onDrill({ state: REQUEST_FAIL.join(',') }) },
              {
                label: 'Elsewhere in the pipeline', value: Math.max(0, total - waiting - readyToRun - reqFailed), fill: 'none', color: SOFT.none,
                onClick: () => onDrill({ state: 'Draft,Planned,In progress,Ready' }),
              },
            ]} />
            <button type="button" onClick={() => onDrill({ state: null })} aria-label="Every request in scope. Open them"
              className="text-[11.5px] text-ink-3 hover:text-brand-600 transition-colors -mt-1">
              {cnt('Draft')} still in draft
            </button>
            <div className="w-full mt-1">
              <RingLegendRow color={SOFT.purple} label="Waiting for approval" value={waiting} note="Pre-validated, ready for a decision"
                drillLabel="requests waiting on approval" onClick={() => onDrill({ state: 'Validated' })} />
              <RingLegendRow color={SOFT.good} label="Ready to run" value={readyToRun} note="Approved, waiting for a change window"
                drillLabel="requests ready to run" onClick={() => onDrill({ state: 'Approved,Queued' })} />
              <RingLegendRow color={SOFT.crit} label="Failed" value={reqFailed} note="Rejected, invalid or rolled back — needs a retry"
                drillLabel="failed requests" onClick={() => onDrill({ state: REQUEST_FAIL.join(',') })} />
            </div>
          </CardBody>
        </Card>
        <Card className="h-full flex flex-col">
          <CardHead title="Execution" sub="At a glance, for the current selection"
            info="Everything in the current selection that has moved into execution, as one ring: finished, still moving, or failed — every order in scope is exactly one of the three. Click a slice or a row to open exactly those orders." />
          <CardBody className="flex-1 min-h-0 flex flex-col items-center gap-1 pt-1">
            <Donut size={116} total={execTotal} segments={[
              { label: 'Ready', value: execReady, fill: 'good', color: SOFT.good, onClick: () => onDrill({ state: 'Ready' }) },
              { label: 'In progress', value: execInProgress, fill: 'brand', color: SOFT.brand, onClick: () => onDrill({ state: 'In progress,Queued,Approved' }) },
              { label: 'Failed', value: execFailed, fill: 'crit', color: SOFT.crit, onClick: () => onDrill({ state: EXEC_FAIL.join(',') }) },
            ]} />
            <div className="w-full mt-2">
              <RingLegendRow color={SOFT.good} label="Ready" value={execReady} note="Finished successfully"
                drillLabel="orders that finished successfully" onClick={() => onDrill({ state: 'Ready' })} />
              <RingLegendRow color={SOFT.brand} label="In progress" value={execInProgress} note="Running or queued behind a change window"
                drillLabel="orders in progress" onClick={() => onDrill({ state: 'In progress,Queued,Approved' })} />
              <RingLegendRow color={SOFT.crit} label="Failed" value={execFailed} note="Rolled back, can be retried"
                drillLabel="failed orders" onClick={() => onDrill({ state: EXEC_FAIL.join(',') })} />
            </div>
          </CardBody>
        </Card>
        {intentCard}
        {spotlightCard}
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="h-full flex flex-col">
          <CardHead title="Pipeline by stage" sub="Requests and execution on one axis — click a bar to open that list"
            info="Each bar is one stage of the provisioning pipeline for the current selection, left to right in the order a request moves through it. Grey bars are the request phase — still being designed, checked or decided. Coloured bars are the execution phase: blue is moving, green finished, red failed. The label under each stage names its phase." />
          <ChartLegend items={[
            { label: 'Requests — awaiting design or decision', color: SOFT.none },
            { label: 'Execution — moving', color: SOFT.brand },
            { label: 'Execution — completed', color: SOFT.good },
            { label: 'Execution — failed', color: SOFT.crit },
          ]} />
          <CardBody className="flex-1 min-h-0 flex flex-col">
            <ColumnChart height={290} ariaLabel="Requests and execution by pipeline stage"
              data={stages.map((s) => ({
                label: s.label, sub: s.phase, color: s.color,
                value: s.states.reduce((a, st) => a + cnt(st), 0),
                onClick: () => onDrill({ state: s.states.join(',') }),
              }))} />
          </CardBody>
        </Card>
        <Card className="h-full flex flex-col">
          <CardHead title="Raised vs completed" sub={`Last 14 days · ${trend.raised.reduce((a, b) => a + b, 0)} requests raised, ${trend.completed.reduce((a, b) => a + b, 0)} executions completed`}
            info="Both halves of the pipeline on one timeline: requests raised per day (blue) against executions that finished successfully per day (green), over the last 14 days for the current selection. When the blue line runs above the green one, work is arriving faster than it is being executed and the backlog grows. Hover the chart for exact daily numbers." />
          <CardBody className="flex-1 min-h-0 flex flex-col">
            <TrendChart height={280} ariaLabel="Requests raised and executions completed per day, last 14 days" labels={trend.labels}
              series={[
                { name: 'Requests raised', values: trend.raised, fill: 'brand', color: SOFT.brand },
                { name: 'Executions completed', values: trend.completed, fill: 'good', color: SOFT.good },
              ]} />
          </CardBody>
        </Card>
      </div>

      <RankedBreakdown title="By category" sub="Every category in scope, split by where it stands — click a badge or a segment to open exactly those"
        info="Every service category in the current selection, biggest first, split into Ready, In progress, Waiting and Failed. Waiting is the request phase; the other three are execution. Click the count to open the whole category, or a segment of its bar to open just that slice."
        groups={byCategory} noun={noun} onDrill={onDrill}
        renderLabel={(c) => <Badge tone={CATEGORY_TONE[c]}>{c}</Badge>}
        labelFor={(c) => c}
        patchFor={(c, states) => ({ cat: c, state: states })}
        segmentsFor={(list) => {
          const c = (...st: OrderState[]) => list.filter((o) => st.includes(o.state)).length
          return [
            { label: 'Ready', value: c('Ready'), fill: 'good' as const, states: 'Ready' },
            { label: 'In progress', value: c('In progress', 'Queued', 'Approved'), fill: 'brand' as const, states: 'In progress,Queued,Approved' },
            { label: 'Waiting', value: c('Draft', 'Planned', 'Validated'), fill: 'none' as const, states: 'Draft,Planned,Validated' },
            { label: 'Failed', value: c(...REQUEST_FAIL), fill: 'crit' as const, states: REQUEST_FAIL.join(',') },
          ]
        }} />

      <VendorBreakdown byVendor={byVendor} noun={noun} onDrill={onDrill} />
    </div>
  )
}

/** Ranked, biggest-first breakdown — one StackedBar row each. Generic over
 * the grouping key (category, vendor, ...) so both "By category" and "By
 * vendor" reuse the same layout and drill-down wiring. Bounded to a small,
 * naturally-fixed set of keys (categories) — for vendors, which can keep
 * growing, see VendorBreakdown instead. */
function RankedBreakdown({ title, sub, info, groups, noun, segmentsFor, renderLabel, labelFor, patchFor, onDrill }: {
  title: string
  sub: string
  info?: ReactNode
  groups: [string, Order[]][]
  noun: string
  segmentsFor: (list: Order[]) => { label: string; value: number; fill: 'good' | 'brand' | 'none' | 'crit'; states: string }[]
  renderLabel: (key: string) => ReactNode
  /** Plain-text version of `renderLabel`, for aria-labels — a raw vendor
   * key (e.g. "NOKIA") differs from what's actually shown on screen
   * (VENDOR_LABEL's "Nokia"), so the two can't share one string. */
  labelFor: (key: string) => string
  patchFor: (key: string, states: string | null) => Patch
  onDrill: (patch: Patch) => void
}) {
  return (
    <Card>
      <CardHead title={title} sub={sub} info={info} />
      <CardBody className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {groups.map(([key, list]) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-2">
                {renderLabel(key)}
                <button onClick={() => onDrill(patchFor(key, null))} className="text-[13px] font-medium tnum hover:text-brand-600"
                  aria-label={`${list.length} ${labelFor(key)} ${noun}. Open them`}>{list.length} {noun}</button>
              </span>
            </div>
            <StackedBar
              ariaLabel={`${key} ${noun} by status`}
              compact
              segments={segmentsFor(list).map((s) => ({ label: s.label, value: s.value, fill: s.fill, color: SOFT[s.fill], onClick: () => onDrill(patchFor(key, s.states)) }))}
            />
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

/**
 * A vendor list has no natural ceiling — the platform already carries 20,
 * and every new domain brings more. A "By category" style stacked-bar row
 * per vendor would either grow the card forever or need constant re-fixing
 * (which is exactly what kept happening). Instead: one compact bar per
 * vendor — rank + volume + a failure-rate colour, nothing else — inside a
 * card that's capped and scrolls, so the layout never depends on how many
 * vendors exist.
 */
function VendorBreakdown({ byVendor, noun, onDrill }: {
  byVendor: [Vendor, Order[]][]
  noun: string
  onDrill: (patch: Patch) => void
}) {
  const items = byVendor.map(([v, list]) => {
    const failed = list.filter((o) => REQUEST_FAIL.includes(o.state)).length
    const rate = failed / list.length
    const label = VENDOR_LABEL[v] ?? v
    return {
      label,
      value: list.length,
      color: riskColor(rate),
      valueLabel: `${list.length} · ${Math.round(rate * 100)}%`,
      drillLabel: `${list.length} ${label} ${noun}, ${Math.round(rate * 100)}% failed. Open them`,
      onClick: () => onDrill({ vendor: v, state: null }),
    }
  })
  return (
    <Card>
      <CardHead title="By vendor" sub="Ranked by volume — the colour is that vendor's failure rate, not its size"
        info="Every vendor in scope, by each order's primary endpoint, ranked by volume. Bar colour reflects failure rate: grey under 10%, amber at 10%+, red at 25%+. Scrolls past the top vendors instead of growing the page, since the vendor list has no fixed size — click a bar to open that vendor's requests." />
      <CardBody className="max-h-[360px] overflow-y-auto">
        <BarList items={items} labelWidth={112} valueWidth={72} />
      </CardBody>
    </Card>
  )
}
