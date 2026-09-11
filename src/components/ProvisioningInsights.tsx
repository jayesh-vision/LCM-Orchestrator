import { useMemo, type ComponentType, type ReactNode } from 'react'
import {
  AlertTriangle, Boxes, CheckCircle2, CircleOff, ClipboardList, Gauge, Globe, PauseCircle,
  Pencil, PlayCircle, Plus, Server, ShieldCheck, Timer, XCircle,
} from 'lucide-react'
import type { Category, Order, OrderIntent, OrderState, Run, Vendor } from '@/types'
import { domainOf } from '@/types'
import { Badge, Card, CardBody, CardHead, StatRow, type StatTone } from '@/components/ui'
import { BarList, ColumnChart, SOFT, StackedBar, TrendChart } from '@/components/charts'
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
 * Shared body for the KPI cards in the Insights top row.
 *
 * Cards in one grid row are all as tall as the tallest — and the tallest is
 * whichever has the most rows. Spreading the shorter cards' rows across that
 * height (`justify-between`) left gaps wide enough to read as missing
 * content. Capping the body instead keeps every row at its natural spacing
 * and lets the one card that overflows scroll, so the row stays the height
 * of about four rows however many any single card happens to carry.
 */
const KPI_BODY = 'vw-scroll-hint flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto max-h-[336px]'

/**
 * The six things a request can be, in lifecycle order rather than ranked by
 * volume — a KPI card people read repeatedly should hold still while they
 * change the filters, so each type keeps its own line. Create is the only one
 * that builds something new; every other type acts on a service that is
 * already carrying traffic, which is the split the card exists to show.
 *
 * Tones follow INTENT_TONE where StatRow has a matching one. It has four
 * (good/warn/crit/plum) against that palette's seven, so Create and Re-prove
 * both fall back to the default brand — they are the two that never damage
 * anything, and the icon and label carry the difference.
 */
const INTENT_ROWS: {
  intent: OrderIntent
  icon: ComponentType<{ size?: number; className?: string }>
  tone?: StatTone
  note: string
}[] = [
  { intent: 'Create', icon: Plus, note: 'New build — lands a service in inventory' },
  { intent: 'Modify', icon: Pencil, tone: 'plum', note: 'Changes an attribute of a live service' },
  { intent: 'Suspend', icon: PauseCircle, tone: 'warn', note: 'Billing stop — configuration retained' },
  { intent: 'Resume', icon: PlayCircle, tone: 'good', note: 'Restores the revision captured at suspend' },
  { intent: 'Cease', icon: CircleOff, tone: 'crit', note: 'Permanent — resources go to quarantine' },
  { intent: 'Re-prove', icon: ShieldCheck, note: 'Read-only re-check, nothing written' },
]

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

  /* What the work is, rather than how much of it there is. Whether this queue
     is mostly Create or mostly Modify is the difference between an estate
     still being built and one being maintained, and nothing else on this
     screen answers that. */
  const intentCard = (
    <Card className="h-full flex flex-col">
      <CardHead title="By request type" sub="Why each one was raised, for the current selection"
        info="Every request in the current selection counted by why it was raised. Create is the only type that builds something new — Modify, Suspend, Resume, Cease and Re-prove all act on a service that is already live, so the balance between Create and the rest says whether this queue is growing the estate or maintaining it. The bar is that type's share of the selection. Click a row to open just those." />
      <CardBody className={KPI_BODY}>
        {INTENT_ROWS.map(({ intent, icon, tone, note }) => {
          const n = byIntent.get(intent) ?? 0
          return (
            <StatRow key={intent} label={intent} icon={icon} value={n.toLocaleString()}
              tone={n ? tone : undefined} progress={(n / Math.max(1, total)) * 100} note={note}
              drillLabel={n ? `${intent} ${noun}` : undefined}
              onClick={n ? () => onDrill({ intent, state: null }) : undefined} />
          )
        })}
      </CardBody>
    </Card>
  )

  /* One combined "Problem spotlight" card instead of 3–7 separate Stat
     tiles — request-side risks and SLA first, then execution's own health
     (first-pass rate, run duration), all one "how healthy is this scope"
     question. The capped body scrolls past four rows. */
  const spotlightCard = (
    <Card className="h-full flex flex-col">
      <CardHead title="Problem spotlight" sub="Where failures are concentrated in scope right now"
        info="The domain, vendor and device model with the highest failure rate in the current scope (vendor and model need at least 3 orders to qualify, so one unlucky order doesn't look like a trend), plus SLA breaches and how execution itself is performing. Click a risk row to open those failures." />
      <CardBody className={KPI_BODY}>
        <StatRow label="Riskiest domain" icon={Globe} value={worstDomain ? `${Math.round(worstDomain.rate * 100)}%` : '—'}
          tone={worstDomain ? riskTone(worstDomain.rate) : undefined}
          note={worstDomain ? `${worstDomain.key} — ${worstDomain.failed} of ${worstDomain.total} failed` : 'Not enough data in scope'}
          drillLabel={worstDomain ? `failed ${worstDomain.key} ${noun}` : undefined}
          onClick={worstDomain ? () => onDrill({ domain: worstDomain.key, state: REQUEST_FAIL.join(',') }) : undefined} />
        <StatRow label="Riskiest vendor" icon={Boxes} value={worstVendor ? `${Math.round(worstVendor.rate * 100)}%` : '—'}
          tone={worstVendor ? riskTone(worstVendor.rate) : undefined}
          note={worstVendor ? `${VENDOR_LABEL[worstVendor.key as Vendor] ?? worstVendor.key} — ${worstVendor.failed} of ${worstVendor.total} failed` : 'Needs 3+ orders on one vendor'}
          drillLabel={worstVendor ? `failed orders on ${worstVendor.key}` : undefined}
          onClick={worstVendor ? () => onDrill({ vendor: worstVendor.key, state: REQUEST_FAIL.join(',') }) : undefined} />
        <StatRow label="Riskiest model" icon={Server} value={worstModel ? `${Math.round(worstModel.rate * 100)}%` : '—'}
          tone={worstModel ? riskTone(worstModel.rate) : undefined}
          note={worstModel ? `${worstModel.key} — ${worstModel.failed} of ${worstModel.total} failed` : 'Needs 3+ orders on one model'}
          drillLabel={worstModel ? `failed orders on ${worstModel.key}` : undefined}
          onClick={worstModel ? () => onDrill({ q: worstModel.key, state: REQUEST_FAIL.join(',') }) : undefined} />
        <StatRow label="SLA breaches" icon={AlertTriangle} value={slaBreaches}
          tone={slaBreaches ? 'crit' : 'good'}
          note={slaBreaches ? `${slaBreaches} request${slaBreaches === 1 ? '' : 's'} past commitment` : 'Nothing has breached SLA in scope'} />
        <StatRow label="First-pass rate" icon={Gauge} value={firstPassRate !== undefined ? `${firstPassRate}%` : '—'}
          tone={firstPassRate === undefined ? undefined : firstPassRate >= 90 ? 'good' : firstPassRate >= 70 ? 'plum' : 'crit'}
          note="First attempts accepted without a retry" />
        <StatRow label="Average run duration" icon={Timer} value={avgDuration !== undefined ? dur(avgDuration) : '—'}
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

      {/* One glance card per half of the pipeline, side by side, each with
         exactly the rows its standalone screen always showed — so request
         counts and execution counts never blur into each other. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="h-full flex flex-col">
          <CardHead title="Requests" sub="At a glance, for the current selection"
            info="A quick read of every request in the current selection, broken down by where it sits between draft and execution. Click a row to open exactly those requests." />
          <CardBody className={KPI_BODY}>
            <StatRow label="Total requests" icon={ClipboardList} value={total.toLocaleString()}
              note={`${cnt('Draft')} still in draft`} drillLabel="every request in scope" onClick={() => onDrill({ state: null })} />
            <StatRow label="Waiting for approval" icon={CheckCircle2} value={waiting} tone="plum"
              progress={(waiting / Math.max(1, total)) * 100} note="Pre-validated, ready for a decision"
              drillLabel="requests waiting on approval" onClick={() => onDrill({ state: 'Validated' })} />
            <StatRow label="Ready to run" icon={PlayCircle} value={readyToRun} tone="good"
              progress={(readyToRun / Math.max(1, total)) * 100} note="Approved, waiting for a change window"
              drillLabel="requests ready to run" onClick={() => onDrill({ state: 'Approved,Queued' })} />
            <StatRow label="Failed" icon={XCircle} value={reqFailed} tone={reqFailed ? 'crit' : undefined}
              progress={(reqFailed / Math.max(1, total)) * 100} note="Rejected, invalid or rolled back — needs a retry"
              drillLabel="failed requests" onClick={() => onDrill({ state: REQUEST_FAIL.join(',') })} />
          </CardBody>
        </Card>
        <Card className="h-full flex flex-col">
          <CardHead title="Execution" sub="At a glance, for the current selection"
            info="A quick read of everything in the current selection that has moved into execution — what's finished, what's running, and what failed. Click a row to open exactly those orders." />
          <CardBody className={KPI_BODY}>
            <StatRow label="Total in execution" icon={PlayCircle} value={execTotal.toLocaleString()}
              note={`${execInProgress} in progress`} drillLabel="everything in execution"
              onClick={() => onDrill({ state: [...EXEC_FAIL, 'Approved', 'Queued', 'In progress', 'Ready'].join(',') })} />
            <StatRow label="Ready" icon={CheckCircle2} value={execReady} tone="good"
              progress={(execReady / Math.max(1, execTotal)) * 100} note="Finished successfully"
              drillLabel="orders that finished successfully" onClick={() => onDrill({ state: 'Ready' })} />
            <StatRow label="In progress" icon={PlayCircle} value={execInProgress}
              progress={(execInProgress / Math.max(1, execTotal)) * 100} note="Running or queued behind a change window"
              drillLabel="orders in progress" onClick={() => onDrill({ state: 'In progress,Queued,Approved' })} />
            <StatRow label="Failed" icon={XCircle} value={execFailed} tone={execFailed ? 'crit' : undefined}
              progress={(execFailed / Math.max(1, execTotal)) * 100} note="Rolled back, can be retried"
              drillLabel="failed orders" onClick={() => onDrill({ state: EXEC_FAIL.join(',') })} />
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
