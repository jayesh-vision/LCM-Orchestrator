import { useMemo, type ReactNode } from 'react'
import { AlertTriangle, Boxes, CheckCircle2, ClipboardList, Gauge, Globe, PlayCircle, Server, Timer, XCircle } from 'lucide-react'
import type { Category, Order, OrderState, Run, Vendor } from '@/types'
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
 * The analytics home for Provisioning Requests/Execution — everything that
 * used to compete with the grid for vertical space now lives here, one
 * toggle away. Scoped to whatever the caller's domain/category/search
 * selection already resolved to (ignoring only the status filter, since
 * status is exactly what these charts break down); every element drills
 * back into Listing with the matching filter applied via `onDrill`.
 */
export function ProvisioningInsights({ mode, orders, runs, onDrill }: {
  mode: 'requests' | 'execution'
  orders: Order[]
  runs?: Run[]
  onDrill: (patch: Patch) => void
}) {
  const cnt = (...st: OrderState[]) => orders.filter((o) => st.includes(o.state)).length
  const total = orders.length
  const noun = mode === 'requests' ? 'requests' : 'in execution'
  const failStates: OrderState[] = mode === 'requests'
    ? ['Failed', 'Rejected', 'Invalid', 'Reinstantiate']
    : ['Failed', 'Rejected', 'Reinstantiate']

  const byCategory = useMemo(() => {
    const m = new Map<Category, Order[]>()
    orders.forEach((o) => { if (!m.has(o.category)) m.set(o.category, []); m.get(o.category)!.push(o) })
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
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

  const worstDomain = useMemo(() => worstBy(orders, (o) => domainOf(o.category), failStates, 1), [orders, failStates])
  const worstVendor = useMemo(() => worstBy(orders, (o) => o.endpoints[0]?.vendor, failStates, 3), [orders, failStates])
  const worstModel = useMemo(() => worstBy(orders, (o) => o.endpoints[0]?.deviceName, failStates, 3), [orders, failStates])
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

  /* ---------------- execution-only health figures ---------------- */
  const orderIds = new Set(orders.map((o) => o.id))
  const scopedRuns = (runs ?? []).filter((r) => orderIds.has(r.orderId))
  const firstAttempts = scopedRuns.filter((r) => r.attempt === 1 && r.outcome !== 'Running')
  const firstPassRate = firstAttempts.length ? Math.round((firstAttempts.filter((r) => r.outcome === 'Accepted').length / firstAttempts.length) * 100) : undefined
  const durations = scopedRuns.map((r) => r.durationMs).filter((d): d is number => d !== undefined)
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : undefined

  /* One combined "Problem spotlight" card instead of 3–5 separate Stat
     tiles — a row of near-identical tiles reads fine at 3–4, past that it's
     just card sprawl. Execution mode folds first-pass rate and average run
     duration in as two more rows, since they're the same "how healthy is
     this scope" question as the risk rows above them. */
  const spotlightCard = (
    <Card className="h-full flex flex-col">
      <CardHead title="Problem spotlight" sub="Where failures are concentrated in scope right now"
        info="The domain, vendor and device model with the highest failure rate in the current scope (vendor and model need at least 3 orders to qualify, so one unlucky order doesn't look like a trend). Click a row to open those failures." />
      <CardBody className="flex flex-col gap-2 flex-1 justify-between">
        <StatRow label="Riskiest domain" icon={Globe} value={worstDomain ? `${Math.round(worstDomain.rate * 100)}%` : '—'}
          tone={worstDomain ? riskTone(worstDomain.rate) : undefined}
          note={worstDomain ? `${worstDomain.key} — ${worstDomain.failed} of ${worstDomain.total} failed` : 'Not enough data in scope'}
          drillLabel={worstDomain ? `failed ${worstDomain.key} ${noun}` : undefined}
          onClick={worstDomain ? () => onDrill({ domain: worstDomain.key, state: failStates.join(',') }) : undefined} />
        <StatRow label="Riskiest vendor" icon={Boxes} value={worstVendor ? `${Math.round(worstVendor.rate * 100)}%` : '—'}
          tone={worstVendor ? riskTone(worstVendor.rate) : undefined}
          note={worstVendor ? `${VENDOR_LABEL[worstVendor.key as Vendor] ?? worstVendor.key} — ${worstVendor.failed} of ${worstVendor.total} failed` : 'Needs 3+ orders on one vendor'}
          drillLabel={worstVendor ? `failed orders on ${worstVendor.key}` : undefined}
          onClick={worstVendor ? () => onDrill({ vendor: worstVendor.key, state: failStates.join(',') }) : undefined} />
        <StatRow label="Riskiest model" icon={Server} value={worstModel ? `${Math.round(worstModel.rate * 100)}%` : '—'}
          tone={worstModel ? riskTone(worstModel.rate) : undefined}
          note={worstModel ? `${worstModel.key} — ${worstModel.failed} of ${worstModel.total} failed` : 'Needs 3+ orders on one model'}
          drillLabel={worstModel ? `failed orders on ${worstModel.key}` : undefined}
          onClick={worstModel ? () => onDrill({ q: worstModel.key, state: failStates.join(',') }) : undefined} />
        {mode === 'requests' && (
          <StatRow label="SLA breaches" icon={AlertTriangle} value={slaBreaches}
            tone={slaBreaches ? 'crit' : 'good'}
            note={slaBreaches ? `${slaBreaches} request${slaBreaches === 1 ? '' : 's'} past commitment` : 'Nothing has breached SLA in scope'} />
        )}
        {mode === 'execution' && (
          <>
            <StatRow label="First-pass rate" icon={Gauge} value={firstPassRate !== undefined ? `${firstPassRate}%` : '—'}
              tone={firstPassRate === undefined ? undefined : firstPassRate >= 90 ? 'good' : firstPassRate >= 70 ? 'plum' : 'crit'}
              note="First attempts accepted without a retry" />
            <StatRow label="Average run duration" icon={Timer} value={avgDuration !== undefined ? dur(avgDuration) : '—'}
              note="Across every run in scope" />
          </>
        )}
      </CardBody>
    </Card>
  )

  if (mode === 'requests') {
    const waiting = cnt('Validated')
    const ready = cnt('Approved', 'Queued')
    const failed = cnt('Failed', 'Rejected', 'Invalid', 'Reinstantiate')

    const stages: { label: string; states: OrderState[]; color: string }[] = [
      { label: 'Draft', states: ['Draft'], color: SOFT.none },
      { label: 'Planned', states: ['Planned'], color: SOFT.none },
      { label: 'Validated', states: ['Validated'], color: SOFT.none },
      { label: 'Approved', states: ['Approved', 'Queued'], color: SOFT.brand },
      { label: 'In progress', states: ['In progress'], color: SOFT.brand },
      { label: 'Ready', states: ['Ready'], color: SOFT.good },
      { label: 'Failed', states: ['Failed'], color: SOFT.crit },
    ]

    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="h-full flex flex-col">
            <CardHead title="Requests" sub="At a glance, for the current selection"
              info="A quick read of every request in the current selection, broken down by where it sits between draft and execution. Click a row to open exactly those requests." />
            <CardBody className="flex flex-col gap-2 flex-1 justify-between">
              <StatRow label="Total requests" icon={ClipboardList} value={total.toLocaleString()}
                note={`${cnt('Draft')} still in draft`} drillLabel="every request in scope" onClick={() => onDrill({ state: null })} />
              <StatRow label="Waiting for approval" icon={CheckCircle2} value={waiting} tone="plum"
                progress={(waiting / Math.max(1, total)) * 100} note="Pre-validated, ready for a decision"
                drillLabel="requests waiting on approval" onClick={() => onDrill({ state: 'Validated' })} />
              <StatRow label="Ready to run" icon={PlayCircle} value={ready} tone="good"
                progress={(ready / Math.max(1, total)) * 100} note="Approved, waiting for a change window"
                drillLabel="requests ready to run" onClick={() => onDrill({ state: 'Approved,Queued' })} />
              <StatRow label="Failed" icon={XCircle} value={failed} tone={failed ? 'crit' : undefined}
                progress={(failed / Math.max(1, total)) * 100} note="Rolled back, needs a retry"
                drillLabel="failed requests" onClick={() => onDrill({ state: 'Failed,Rejected,Invalid,Reinstantiate' })} />
            </CardBody>
          </Card>
          {spotlightCard}
        </div>

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Card className="h-full flex flex-col">
            <CardHead title="Requests by stage" sub="Where every request in scope is right now — click a bar to open that list"
              info="Each bar is one stage of the provisioning pipeline for the current selection, left to right in the order a request moves through it: Draft → Planned → Validated → Approved → In progress → Ready. Grey stages are pre-approval, blue are actively being worked, green is done and red is failed." />
            <CardBody className="flex-1 min-h-0 flex flex-col">
              <ColumnChart height={300} ariaLabel="Requests by stage"
                data={stages.map((s) => ({ label: s.label, color: s.color, value: s.states.reduce((a, st) => a + cnt(st), 0), onClick: () => onDrill({ state: s.states.join(',') }) }))} />
            </CardBody>
          </Card>
          <Card className="h-full flex flex-col">
            <CardHead title="Raised vs completed" sub={`Last 14 days · ${trend.raised.reduce((a, b) => a + b, 0)} raised, ${trend.completed.reduce((a, b) => a + b, 0)} went live`}
              info="New requests raised per day against the total that went live, over the last 14 days for the current selection. When Raised runs above Completed, work is arriving faster than the team is finishing it and the backlog grows. Hover the chart for exact daily numbers." />
            <CardBody className="flex-1 min-h-0 flex flex-col">
              <TrendChart height={280} ariaLabel="Requests raised and completed per day, last 14 days" labels={trend.labels}
                series={[{ name: 'Raised', values: trend.raised, fill: 'brand', color: SOFT.brand }, { name: 'Completed', values: trend.completed, fill: 'good', color: SOFT.good }]} />
            </CardBody>
          </Card>
        </div>

        <RankedBreakdown title="By category" sub="Every category in scope, split by where it stands — click a badge or a segment to open exactly those"
          info="Every service category in the current selection, biggest first, split into Ready, In progress, Waiting and Failed. Click the count to open the whole category, or a segment of its bar to open just that slice."
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
              { label: 'Failed', value: c('Failed', 'Rejected', 'Invalid', 'Reinstantiate'), fill: 'crit' as const, states: 'Failed,Rejected,Invalid,Reinstantiate' },
            ]
          }} />

        <VendorBreakdown byVendor={byVendor} noun={noun} failStates={failStates} onDrill={onDrill} />
      </div>
    )
  }

  /* ---------------- execution ---------------- */
  const ready = cnt('Ready')
  const inProgress = cnt('In progress', 'Queued', 'Approved')
  const failed = cnt('Failed', 'Rejected', 'Reinstantiate')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="h-full flex flex-col">
          <CardHead title="Execution" sub="At a glance, for the current selection"
            info="A quick read of everything in the current selection that has moved into execution — what's finished, what's running, and what failed. Click a row to open exactly those orders." />
          <CardBody className="flex flex-col gap-2 flex-1 justify-between">
            <StatRow label="Total in execution" icon={PlayCircle} value={total.toLocaleString()}
              note={`${inProgress} in progress`} drillLabel="everything in execution" onClick={() => onDrill({ state: null })} />
            <StatRow label="Ready" icon={CheckCircle2} value={ready} tone="good"
              progress={(ready / Math.max(1, total)) * 100} note="Finished successfully"
              drillLabel="orders that finished successfully" onClick={() => onDrill({ state: 'Ready' })} />
            <StatRow label="In progress" icon={PlayCircle} value={inProgress}
              progress={(inProgress / Math.max(1, total)) * 100} note="Running or queued behind a change window"
              drillLabel="orders in progress" onClick={() => onDrill({ state: 'In progress,Queued,Approved' })} />
            <StatRow label="Failed" icon={XCircle} value={failed} tone={failed ? 'crit' : undefined}
              progress={(failed / Math.max(1, total)) * 100} note="Rolled back, can be retried"
              drillLabel="failed orders" onClick={() => onDrill({ state: 'Failed,Rejected,Reinstantiate' })} />
          </CardBody>
        </Card>
        {spotlightCard}
      </div>

      <RankedBreakdown title="By category" sub="Every category in scope, split by where it stands — click a badge or a segment to open exactly those"
        info="Every service category in the current selection, biggest first, split into Ready, In progress and Failed. Click the count to open the whole category, or a segment of its bar to open just that slice."
        groups={byCategory} noun={noun} onDrill={onDrill}
        renderLabel={(c) => <Badge tone={CATEGORY_TONE[c]}>{c}</Badge>}
        labelFor={(c) => c}
        patchFor={(c, states) => ({ cat: c, state: states })}
        segmentsFor={(list) => {
          const c = (...st: OrderState[]) => list.filter((o) => st.includes(o.state)).length
          return [
            { label: 'Ready', value: c('Ready'), fill: 'good' as const, states: 'Ready' },
            { label: 'In progress', value: c('In progress', 'Queued', 'Approved'), fill: 'brand' as const, states: 'In progress,Queued,Approved' },
            { label: 'Failed', value: c('Failed', 'Rejected', 'Reinstantiate'), fill: 'crit' as const, states: 'Failed,Rejected,Reinstantiate' },
          ]
        }} />

      <VendorBreakdown byVendor={byVendor} noun={noun} failStates={failStates} onDrill={onDrill} />

      <Card>
        <CardHead title="Completions" sub={`Last 14 days · ${trend.completed.reduce((a, b) => a + b, 0)} orders went live`}
          info="Orders that finished execution successfully, per day, over the last 14 days for the current selection. Hover the chart for exact daily numbers." />
        {/* TrendChart's own root is `h-full`, which needs a definite ancestor
           height to resolve against — the paired charts above get that for
           free from their grid row's tallest sibling, but this card is alone
           with no sibling to borrow a height from, so it gets one explicitly. */}
        <CardBody className="h-[240px]">
          <TrendChart height={220} ariaLabel="Orders completed per day, last 14 days" labels={trend.labels}
            series={[{ name: 'Completed', values: trend.completed, fill: 'good', color: SOFT.good }]} />
        </CardBody>
      </Card>
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
function VendorBreakdown({ byVendor, noun, failStates, onDrill }: {
  byVendor: [Vendor, Order[]][]
  noun: string
  failStates: OrderState[]
  onDrill: (patch: Patch) => void
}) {
  const items = byVendor.map(([v, list]) => {
    const failed = list.filter((o) => failStates.includes(o.state)).length
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
