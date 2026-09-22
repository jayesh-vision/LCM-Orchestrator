import { useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, Boxes, Globe, Server, Wrench } from 'lucide-react'
import type { Category, Domain, Order, OrderIntent, OrderState, Run, RunTask, Vendor } from '@/types'
import { domainOf, DOMAINS } from '@/types'
import { Badge, Card, CardBody, CardHead, Chip, Drawer, type StatTone } from '@/components/ui'
import { BarList, ColumnChart, Donut, SOFT, StackedBar, TrendChart } from '@/components/charts'
import { VENDOR_LABEL } from '@/data/workflows'
import { CATEGORY_TONE, DOMAIN_TONE, ORDER_TONE, relTime } from '@/lib/format'
import { EXEC_FAIL, failureReasonFor, PRE_EXECUTION, REQUEST_FAIL, RISK_FAIL, worstBy } from '@/lib/orderFailure'

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

const riskTone = (rate: number): StatTone => (rate >= 0.25 ? 'crit' : rate >= 0.1 ? 'warn' : 'good')
/** Raw hex counterpart of `riskTone`, for components that take a colour
 * instead of a tone name (BarList). */
const riskColor = (rate: number) => (rate >= 0.25 ? SOFT.crit : rate >= 0.1 ? SOFT.warn : SOFT.brand)

/** One order behind a failure-reason bucket, with the specific run/task that
 * landed it there — what the "Why failures happen" drawer lists. */
interface ReasonHit { order: Order; run: Run; task: RunTask }

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

/* Cell colours for the intent waffle. Create keeps the pastel the other
   rings use for it; the maintenance intents step up one weight so a handful
   of cells still reads against eighty-odd blue ones. Checked with the
   dataviz palette validator: every adjacent pair clears the normal-vision
   floor, and the one CVD-tight pair (Resume/Cease) is carried by the legend
   counts and the grid gaps as well as by colour. */
const WAFFLE_COLOR: Record<OrderIntent, string> = {
  Create: SOFT.brand, Modify: '#c084fc', Suspend: '#fbbf24', Resume: '#34d399', Cease: '#f87171', 'Re-prove': '#22d3ee',
}

/**
 * Split `cells` units across the series by largest remainder, so the shares
 * sum exactly and anything present at all gets at least one cell — a 1%
 * intent that rounded to nothing would otherwise vanish from a chart whose
 * whole point is that these small ones exist.
 */
function allocateCells(series: { intent: OrderIntent; value: number }[], total: number, cells: number): OrderIntent[] {
  if (!total) return []
  const raw = series.map((s) => ({ ...s, exact: (s.value / total) * cells }))
  const got = raw.map((s) => Math.floor(s.exact))
  let left = cells - got.reduce((a, b) => a + b, 0)
  raw.map((s, i) => ({ i, rem: s.exact - got[i] })).sort((a, b) => b.rem - a.rem).forEach(({ i }) => { if (left > 0) { got[i] += 1; left -= 1 } })
  raw.forEach((s, i) => {
    if (s.value > 0 && got[i] === 0) {
      const big = got.indexOf(Math.max(...got))
      got[big] -= 1; got[i] += 1
    }
  })
  return raw.flatMap((s, i) => Array<OrderIntent>(got[i]).fill(s.intent))
}

/**
 * New vs upgrade, as a unit chart rather than a third ring.
 *
 * The story is one number — what share of the queue is Create — so that
 * number leads, with its complement beside it and a split bar between them.
 * Under it a 10×10 waffle, one cell per percent, shows the same split as
 * mass: a hundred cells make the small intents visible as a few distinct
 * squares instead of slivers on a ring. A compact legend below names every
 * colour in the bar and grid directly, so the split doesn't depend on
 * hovering to be readable. Click a cell, the bar, or a legend entry to open
 * those requests.
 */
function IntentWaffle({ counts, total, onDrill }:
{ counts: Map<OrderIntent, number>; total: number; onDrill: (patch: Patch) => void }) {
  const [hot, setHot] = useState<OrderIntent | null>(null)
  const count = (i: OrderIntent) => counts.get(i) ?? 0
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  const build = count('Create')
  const buildPct = pct(build)
  const cells = useMemo(
    () => allocateCells(INTENT_META.map((m) => ({ intent: m.intent, value: count(m.intent) })), total, 100),
    [counts, total], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const verdict = !total ? 'Nothing in scope'
    : buildPct >= 60 ? 'Mostly growing the estate'
      : buildPct <= 40 ? 'Mostly changing services already live'
        : 'An even mix of new builds and changes'
  const drill = (intent: OrderIntent) => (count(intent) > 0 ? () => onDrill({ intent, state: null }) : undefined)
  const dim = (intent: OrderIntent) => (hot !== null && hot !== intent ? 'opacity-25' : '')

  return (
    <div className="w-full flex flex-col gap-3">
      {/* the number, and its complement */}
      <div className="flex items-end justify-between gap-3">
        <button type="button" onClick={drill('Create')} disabled={!build} aria-label={`${build} create requests. Open them`}
          onMouseEnter={() => setHot('Create')} onMouseLeave={() => setHot(null)}
          className="text-left rounded-md -mx-1.5 px-1.5 py-0.5 hover:bg-plane transition-colors disabled:hover:bg-transparent">
          <div className="text-[28px] font-semibold tnum leading-none tracking-[-.5px]">{buildPct}%</div>
          <div className="text-[12px] text-ink-2 mt-1.5">New</div>
        </button>
        <div className="text-right rounded-md -mx-1.5 px-1.5 py-0.5">
          <div className="text-[28px] font-semibold tnum leading-none tracking-[-.5px] text-ink-2">{total ? 100 - buildPct : 0}%</div>
          <div className="text-[12px] text-ink-2 mt-1.5">Upgrade</div>
        </div>
      </div>

      {/* one bar, every intent a segment, animated open on first paint */}
      <div className="h-2 rounded-full bg-line-soft overflow-hidden">
        <div className="h-full flex gap-[2px] anim-grow">
          {INTENT_META.filter((m) => count(m.intent) > 0).map((m) => (
            <span key={m.intent} title={`${m.intent} · ${count(m.intent)}`}
              onMouseEnter={() => setHot(m.intent)} onMouseLeave={() => setHot(null)}
              className={`h-full rounded-full transition-opacity ${dim(m.intent)}`}
              style={{ width: `${(count(m.intent) / total) * 100}%`, background: WAFFLE_COLOR[m.intent] }} />
          ))}
        </div>
      </div>
      <p className="m-0 -mt-1 text-[12px] text-ink-3 text-center">{verdict}</p>

      {/* the waffle: 100 cells, one per percent */}
      <div className="grid grid-cols-10 gap-[3px] mx-auto" style={{ width: 10 * 16 + 9 * 3 }} aria-hidden>
        {cells.map((intent, i) => (
          <span key={i} title={`${intent} · ${count(intent)} (${pct(count(intent))}%)`}
            onMouseEnter={() => setHot(intent)} onMouseLeave={() => setHot(null)} onClick={drill(intent)}
            className={`h-[16px] rounded-[3px] anim-in transition-opacity ${dim(intent)} ${count(intent) ? 'cursor-pointer' : ''}`}
            style={{ background: WAFFLE_COLOR[intent], animationDelay: `${i * 6}ms` }} />
        ))}
        {!total && Array.from({ length: 100 }, (_, i) => <span key={i} className="h-[16px] rounded-[3px] bg-line-soft" />)}
      </div>

      {/* legend: names every colour in the bar/grid above, so the split
          doesn't depend on hovering to be readable */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pt-0.5">
        {INTENT_META.filter((m) => count(m.intent) > 0).map((m) => (
          <button
            key={m.intent} type="button" onClick={drill(m.intent)} disabled={!count(m.intent)}
            onMouseEnter={() => setHot(m.intent)} onMouseLeave={() => setHot(null)}
            aria-label={`${m.intent}: ${count(m.intent)}. Open the matching requests`}
            className={`flex items-center gap-1.5 text-[11px] text-ink-2 rounded -mx-1 px-1 py-0.5 transition-opacity
              ${dim(m.intent)} hover:bg-plane hover:text-brand-600 disabled:hover:bg-transparent disabled:cursor-default
              focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100`}
          >
            <i className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: WAFFLE_COLOR[m.intent] }} />
            <span>{m.intent}</span>
            <span className="font-semibold tnum text-ink-1">{count(m.intent)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

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
  const navigate = useNavigate()
  const [openReason, setOpenReason] = useState<string | null>(null)
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

  const worstDomain = useMemo(() => worstBy(orders, (o) => domainOf(o.category), RISK_FAIL, 1), [orders])
  const worstVendor = useMemo(() => worstBy(orders, (o) => o.endpoints[0]?.vendor, RISK_FAIL, 3), [orders])
  const worstModel = useMemo(() => worstBy(orders, (o) => o.endpoints[0]?.deviceName, RISK_FAIL, 3), [orders])
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

  /* Every task that actually failed, bucketed by root cause (see
     `failureReasonFor`) and ranked by count — the "why" behind the failure
     figures above. Scoped to orders that are *currently* failed (the same
     EXEC_FAIL states the rest of this card already treats as failure) — an
     order that failed on attempt 1 but passed on a later retry now reads
     Ready, not failed, so its old failed task must not count here, and only
     an order's most recent attempt is counted so an order isn't attributed
     to two different reasons from two different retries. Deduped by order
     within a bucket (one order can fail more than one endpoint for the same
     reason) for the drawer a click opens. */
  const failureReasons = useMemo(() => {
    const orderById = new Map(orders.map((o) => [o.id, o]))
    const failedOrderIds = new Set(orders.filter((o) => EXEC_FAIL.includes(o.state)).map((o) => o.id))
    const latestAttempt = new Map<string, number>()
    scopedRuns.forEach((r) => {
      if (!failedOrderIds.has(r.orderId)) return
      latestAttempt.set(r.orderId, Math.max(latestAttempt.get(r.orderId) ?? 0, r.attempt))
    })
    const buckets = new Map<string, { count: number; hits: Map<string, ReasonHit> }>()
    let failedTasks = 0
    scopedRuns.forEach((r) => {
      if (!failedOrderIds.has(r.orderId) || r.attempt !== latestAttempt.get(r.orderId)) return
      r.tasks.forEach((t) => {
        if (t.state !== 'Failed') return
        failedTasks += 1
        const reason = failureReasonFor(r.id, t.taskDefId, t.stageKind)
        const bucket = buckets.get(reason) ?? { count: 0, hits: new Map<string, ReasonHit>() }
        bucket.count += 1
        const order = orderById.get(r.orderId)
        if (order && !bucket.hits.has(order.id)) bucket.hits.set(order.id, { order, run: r, task: t })
        buckets.set(reason, bucket)
      })
    })
    const items = [...buckets.entries()]
      .map(([reason, b]) => ({
        reason, count: b.count,
        hits: [...b.hits.values()].sort((a, b2) => b2.order.updatedAt.localeCompare(a.order.updatedAt)),
      }))
      .sort((a, b) => b.count - a.count)
    return { items, total: failedTasks }
  }, [scopedRuns, orders])

  /* -------- request-side figures, as the Requests screen counted them ---- */
  const waiting = cnt('Validated')
  const readyToRun = cnt('Approved', 'Queued')
  const reqFailed = cnt(...REQUEST_FAIL)

  /* -------- execution-side figures, as the Execution screen counted them - */
  const execTotal = execPool.length
  const execReady = ecnt('Ready')
  const execInProgress = ecnt('In progress', 'Queued', 'Approved')
  const execFailed = ecnt(...EXEC_FAIL)

  /* What the work is, rather than how much of it there is. Whether this
     queue is mostly Create or mostly Modify is the difference between an
     estate still being built and one being maintained — one number, which
     is why this card leads with it and draws the split as a unit chart
     instead of a third ring beside the two that already sit to its left.
     `justify-center` keeps the block free of trailing white space against
     the taller Requests/Execution cards. */
  const intentCard = (
    <Card className="h-full flex flex-col">
      <CardHead title="New vs Upgrade" sub="New services versus upgrades to ones already live"
        info="Every request in the current selection counted by why it was raised. Create is the only type that builds something new — Modify, Suspend, Resume, Cease and Re-prove all act on a service that is already live, so the balance between Create and the rest says whether this queue is growing the estate or upgrading it. Each cell of the grid is one percent of the selection, coloured by type — the legend below names every colour; hover or click a cell, the bar, or a legend entry to isolate and open just those requests." />
      <CardBody className="flex-1 min-h-0 flex flex-col justify-center">
        <IntentWaffle counts={byIntent} total={total} onDrill={onDrill} />
      </CardBody>
    </Card>
  )

  /* One combined "Problem spotlight" card instead of separate stat rows.
     Top half is a 2×2 metric grid — request risk (domain/vendor/model) plus
     SLA breaches, four figures that fill two even rows with no trailing
     gap. Bottom half answers *why*, not just where: every task that actually
     failed in scope, bucketed by root cause and ranked — replacing the two
     run-performance figures (first-pass rate, average duration) this card
     used to close with, which told you how execution was doing but not what
     to go fix. */
  const spotlightCard = (
    <Card className="h-full flex flex-col">
      <CardHead title="Where failures cluster" sub="The domain, vendor and model that fail most, and why"
        info="The domain, vendor and device model with the highest failure rate in the current scope (vendor and model need at least 3 orders to qualify, so one unlucky order doesn't look like a trend), plus SLA breaches and the root causes behind every failed task. Click a metric to open those failures." />
      <CardBody className="flex-1 min-h-0 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          <SpotlightStat icon={Globe} value={worstDomain ? `${Math.round(worstDomain.rate * 100)}%` : '—'} label="Riskiest domain"
            tone={worstDomain ? riskTone(worstDomain.rate) : undefined}
            note={worstDomain ? `${worstDomain.key} — ${worstDomain.failed} of ${worstDomain.total} failed` : 'Not enough data in scope'}
            drillLabel={worstDomain ? `failed ${worstDomain.key} ${noun}` : undefined}
            onClick={worstDomain ? () => onDrill({ domain: worstDomain.key, state: RISK_FAIL.join(',') }) : undefined} />
          <SpotlightStat icon={Boxes} value={worstVendor ? `${Math.round(worstVendor.rate * 100)}%` : '—'} label="Riskiest vendor"
            tone={worstVendor ? riskTone(worstVendor.rate) : undefined}
            note={worstVendor ? `${VENDOR_LABEL[worstVendor.key as Vendor] ?? worstVendor.key} — ${worstVendor.failed} of ${worstVendor.total} failed` : 'Needs 3+ orders on one vendor'}
            drillLabel={worstVendor ? `failed orders on ${worstVendor.key}` : undefined}
            onClick={worstVendor ? () => onDrill({ vendor: worstVendor.key, state: RISK_FAIL.join(',') }) : undefined} />
          <SpotlightStat icon={Server} value={worstModel ? `${Math.round(worstModel.rate * 100)}%` : '—'} label="Riskiest model"
            tone={worstModel ? riskTone(worstModel.rate) : undefined}
            note={worstModel ? `${worstModel.key} — ${worstModel.failed} of ${worstModel.total} failed` : 'Needs 3+ orders on one model'}
            drillLabel={worstModel ? `failed orders on ${worstModel.key}` : undefined}
            onClick={worstModel ? () => onDrill({ q: worstModel.key, state: RISK_FAIL.join(',') }) : undefined} />
          <SpotlightStat icon={AlertTriangle} value={slaBreaches} label="SLA breaches"
            tone={slaBreaches ? 'crit' : 'good'}
            note={slaBreaches ? `${slaBreaches} request${slaBreaches === 1 ? '' : 's'} past commitment` : 'Nothing has breached SLA in scope'} />
        </div>
        <div className="flex-1 min-h-0 pt-3.5 border-t border-line-soft flex flex-col">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2 mb-2.5">
            <Wrench size={12} className="text-ink-3" aria-hidden />
            Why failures happen
          </div>
          {failureReasons.total === 0 ? (
            <p className="m-0 text-[12px] text-ink-3">Nothing has failed in scope.</p>
          ) : (
            <BarList
              items={failureReasons.items.map(({ reason, count, hits }) => ({
                label: reason,
                value: count,
                valueLabel: `${count} · ${Math.round((count / failureReasons.total) * 100)}%`,
                color: SOFT.crit,
                drillLabel: `${count} failed task${count === 1 ? '' : 's'}: ${reason}, across ${hits.length} request${hits.length === 1 ? '' : 's'}. View them`,
                onClick: () => setOpenReason(reason),
              }))}
              labelWidth={140} valueWidth={64}
            />
          )}
        </div>
      </CardBody>
    </Card>
  )

  const openBucket = failureReasons.items.find((it) => it.reason === openReason)
  const failureDrawer = (
    <Drawer
      open={openReason !== null}
      onClose={() => setOpenReason(null)}
      title={openReason ?? ''}
      sub={openBucket ? `${openBucket.count} failed task${openBucket.count === 1 ? '' : 's'} across ${openBucket.hits.length} request${openBucket.hits.length === 1 ? '' : 's'} in the current selection` : undefined}
    >
      {!openBucket || openBucket.hits.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">No requests matched this reason in the current selection.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {openBucket.hits.map(({ order, run, task }) => {
            const ep = order.endpoints.find((e) => e.id === run.endpointId)
            return (
              <button
                key={order.id} type="button"
                onClick={() => navigate(`/execution/${order.id}?tab=lifecycle`)}
                className="w-full text-left rounded-lg border border-line-soft p-3 hover:bg-plane hover:border-line
                  transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink-1 truncate">{order.code} · {order.name}</div>
                    <div className="text-[11.5px] text-ink-3 truncate">{order.accountName} · {order.category}</div>
                  </div>
                  <Badge tone={ORDER_TONE[order.state]}>{order.state}</Badge>
                </div>
                <div className="mt-2 pt-2 border-t border-line-soft text-[11.5px] text-ink-3">
                  <span className="text-ink-2">{task.name}</span>
                  {ep && <> failed on {VENDOR_LABEL[ep.vendor] ?? ep.vendor} {ep.deviceName}</>}
                  {task.endedAt && <> · {relTime(task.endedAt)}</>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Drawer>
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
          <CardHead title="Where requests are waiting" sub="Who each request is waiting on before reaching a device"
            info="Every request in the current selection, as one ring: how many are waiting on a decision, how many are cleared and ready to run, and how many failed. The grey slice is everything else in the pipeline — drafted, planned, in progress or already live. Click a slice or a row to open exactly those requests." />
          <CardBody className="flex-1 min-h-0 flex flex-col justify-center items-center gap-1 pt-1">
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
        {intentCard}
        <Card className="h-full flex flex-col">
          <CardHead title="How execution is going" sub="What became of the requests that reached the devices"
            info="Everything in the current selection that has moved into execution, as one ring: finished, still moving, or failed — every order in scope is exactly one of the three. Click a slice or a row to open exactly those orders." />
          <CardBody className="flex-1 min-h-0 flex flex-col justify-center items-center gap-1 pt-1">
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
        {spotlightCard}
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="h-full flex flex-col">
          <CardHead title="Where work sits in the pipeline" sub="Every stage from draft to ready, in the order a request moves through them"
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
          <CardHead title="Is the backlog growing?" sub="Requests raised against executions completed, day by day over the last two weeks"
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

      <RankedBreakdown title="Which categories carry the load" sub="Each service category by volume, split by where its requests stand"
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

      <VendorBreakdown orders={orders} noun={noun} onDrill={onDrill} />
      {failureDrawer}
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
/**
 * Vendor estates are domain-locked in this platform (a Router vendor serves
 * Transport, a CPE vendor serves Access, and so on), so "which vendors carry
 * the load" is really a question with a domain dimension underneath it. A
 * grouped/stacked bar with up to 20 vendors across 4 domains would be
 * unreadable in this card's width — instead, a domain tab row re-scopes the
 * same list: pick a domain and every vendor's volume and failure rate
 * recompute from just that domain's orders, so the numbers on screen are
 * never a vendor's global figure while the tab claims to be narrower.
 */
function VendorBreakdown({ orders, noun, onDrill }: {
  orders: Order[]
  noun: string
  onDrill: (patch: Patch) => void
}) {
  const [domain, setDomain] = useState<Domain | 'All'>('All')

  const domainCounts = useMemo(() => {
    const m = new Map<Domain, number>()
    orders.forEach((o) => { const d = domainOf(o.category); m.set(d, (m.get(d) ?? 0) + 1) })
    return m
  }, [orders])
  const activeDomains = DOMAINS.filter((d) => (domainCounts.get(d) ?? 0) > 0)

  /* Grouped by each order's first (primary/Source) endpoint — a two-ended
     order can technically span two vendors, so this is a KPI-level signal
     about where the load and the failures concentrate, not a full
     multi-vendor audit of every endpoint. */
  const byVendor = useMemo(() => {
    const scoped = domain === 'All' ? orders : orders.filter((o) => domainOf(o.category) === domain)
    const m = new Map<Vendor, Order[]>()
    scoped.forEach((o) => {
      const v = o.endpoints[0]?.vendor
      if (!v) return
      if (!m.has(v)) m.set(v, [])
      m.get(v)!.push(o)
    })
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [orders, domain])

  const items = byVendor.map(([v, list]) => {
    const failed = list.filter((o) => REQUEST_FAIL.includes(o.state)).length
    const rate = failed / list.length
    const label = VENDOR_LABEL[v] ?? v
    const domainNote = domain === 'All' ? '' : ` in ${domain}`
    return {
      label,
      value: list.length,
      color: riskColor(rate),
      valueLabel: `${list.length} · ${Math.round(rate * 100)}%`,
      drillLabel: `${list.length} ${label} ${noun}${domainNote}, ${Math.round(rate * 100)}% failed. Open them`,
      onClick: () => onDrill({ vendor: v, domain: domain === 'All' ? null : domain, state: null }),
    }
  })

  return (
    <Card>
      <CardHead title="Which vendors carry the load" sub="Each vendor by volume, by domain — the colour is its failure rate, not its size"
        info="Every vendor in scope, by each order's primary endpoint, ranked by volume. Bar colour reflects failure rate: grey under 10%, amber at 10%+, red at 25%+. Pick a domain tab to see just that domain's vendors — volume and failure rate recompute for the domain, they aren't the vendor's overall figures. Scrolls past the top vendors instead of growing the page, since the vendor list has no fixed size — click a bar to open that vendor's requests." />
      <div className="px-4 pt-3 pb-1 flex flex-wrap gap-1.5">
        <Chip active={domain === 'All'} onClick={() => setDomain('All')} count={orders.length}>All domains</Chip>
        {activeDomains.map((d) => (
          <Chip key={d} tone={DOMAIN_TONE[d]} active={domain === d} onClick={() => setDomain(domain === d ? 'All' : d)}
            count={domainCounts.get(d) ?? 0}>
            {d}
          </Chip>
        ))}
      </div>
      <CardBody className="max-h-[360px] overflow-y-auto pt-2">
        {items.length === 0
          ? <p className="m-0 text-[12px] text-ink-3">No vendors in this domain, in the current selection.</p>
          : <BarList items={items} labelWidth={112} valueWidth={72} />}
      </CardBody>
    </Card>
  )
}
