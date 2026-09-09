import { useMemo } from 'react'
import { CheckCircle2, ClipboardList, Gauge, PlayCircle, Timer, XCircle } from 'lucide-react'
import type { Category, Order, OrderState, Run } from '@/types'
import { Badge, Card, CardBody, CardHead, Stat } from '@/components/ui'
import { ColumnChart, FILL, StackedBar, TrendChart } from '@/components/charts'
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

  const byCategory = useMemo(() => {
    const m = new Map<Category, Order[]>()
    orders.forEach((o) => { if (!m.has(o.category)) m.set(o.category, []); m.get(o.category)!.push(o) })
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [orders])

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

  if (mode === 'requests') {
    const waiting = cnt('Validated')
    const ready = cnt('Approved', 'Queued')
    const failed = cnt('Failed', 'Rejected', 'Invalid', 'Reinstantiate')

    const stages: { label: string; states: OrderState[]; color: string }[] = [
      { label: 'Draft', states: ['Draft'], color: FILL.none },
      { label: 'Planned', states: ['Planned'], color: FILL.none },
      { label: 'Validated', states: ['Validated'], color: FILL.none },
      { label: 'Approved', states: ['Approved', 'Queued'], color: FILL.brand },
      { label: 'In progress', states: ['In progress'], color: FILL.brand },
      { label: 'Ready', states: ['Ready'], color: FILL.good },
      { label: 'Failed', states: ['Failed'], color: FILL.crit },
    ]

    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          <Stat label="Total requests" icon={ClipboardList} value={total.toLocaleString()}
            note={`${cnt('Draft')} still in draft`} drillLabel="every request in scope" onClick={() => onDrill({ state: null })}
            info="Every request in the current domain/category/search selection, in any state." />
          <Stat label="Waiting for approval" icon={CheckCircle2} value={waiting} tone="plum"
            progress={(waiting / Math.max(1, total)) * 100} note="Pre-validated, ready for a decision"
            drillLabel="requests waiting on approval" onClick={() => onDrill({ state: 'Validated' })}
            info="Requests that passed validation and now need a NOC lead to approve or reject them." />
          <Stat label="Ready to run" icon={PlayCircle} value={ready} tone="good"
            progress={(ready / Math.max(1, total)) * 100} note="Approved, waiting for a change window"
            drillLabel="requests ready to run" onClick={() => onDrill({ state: 'Approved,Queued' })}
            info="Approved requests queued for execution." />
          <Stat label="Failed" icon={XCircle} value={failed} tone={failed ? 'crit' : undefined}
            progress={(failed / Math.max(1, total)) * 100} note="Rolled back, needs a retry"
            drillLabel="failed requests" onClick={() => onDrill({ state: 'Failed,Rejected,Invalid,Reinstantiate' })}
            info="Requests whose execution failed and was rolled back, or were rejected at approval." />
        </div>

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Card className="h-full flex flex-col">
            <CardHead title="Requests by stage" sub="Where every request in scope is right now — click a bar to open that list" />
            <CardBody className="flex-1 min-h-0 flex flex-col">
              <ColumnChart height={300} ariaLabel="Requests by stage"
                data={stages.map((s) => ({ label: s.label, color: s.color, value: s.states.reduce((a, st) => a + cnt(st), 0), onClick: () => onDrill({ state: s.states.join(',') }) }))} />
            </CardBody>
          </Card>
          <Card className="h-full flex flex-col">
            <CardHead title="Raised vs completed" sub={`Last 14 days · ${trend.raised.reduce((a, b) => a + b, 0)} raised, ${trend.completed.reduce((a, b) => a + b, 0)} went live`} />
            <CardBody className="flex-1 min-h-0 flex flex-col">
              <TrendChart height={280} ariaLabel="Requests raised and completed per day, last 14 days" labels={trend.labels}
                series={[{ name: 'Raised', values: trend.raised, fill: 'brand' }, { name: 'Completed', values: trend.completed, fill: 'good' }]} />
            </CardBody>
          </Card>
        </div>

        <CategoryBreakdown byCategory={byCategory} noun="requests" onDrill={onDrill}
          segmentsFor={(list) => {
            const c = (...st: OrderState[]) => list.filter((o) => st.includes(o.state)).length
            return [
              { label: 'Ready', value: c('Ready'), fill: 'good' as const, states: 'Ready' },
              { label: 'In progress', value: c('In progress', 'Queued', 'Approved'), fill: 'brand' as const, states: 'In progress,Queued,Approved' },
              { label: 'Waiting', value: c('Draft', 'Planned', 'Validated'), fill: 'none' as const, states: 'Draft,Planned,Validated' },
              { label: 'Failed', value: c('Failed', 'Rejected', 'Invalid', 'Reinstantiate'), fill: 'crit' as const, states: 'Failed,Rejected,Invalid,Reinstantiate' },
            ]
          }} />
      </div>
    )
  }

  /* ---------------- execution ---------------- */
  const ready = cnt('Ready')
  const inProgress = cnt('In progress', 'Queued', 'Approved')
  const failed = cnt('Failed', 'Rejected', 'Reinstantiate')

  const orderIds = new Set(orders.map((o) => o.id))
  const scopedRuns = (runs ?? []).filter((r) => orderIds.has(r.orderId))
  const firstAttempts = scopedRuns.filter((r) => r.attempt === 1 && r.outcome !== 'Running')
  const firstPassRate = firstAttempts.length ? Math.round((firstAttempts.filter((r) => r.outcome === 'Accepted').length / firstAttempts.length) * 100) : undefined
  const durations = scopedRuns.map((r) => r.durationMs).filter((d): d is number => d !== undefined)
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Total in execution" icon={PlayCircle} value={total.toLocaleString()}
          note={`${inProgress} in progress`} drillLabel="everything in execution" onClick={() => onDrill({ state: null })}
          info="Every order in the execution pool for the current domain/category/search selection." />
        <Stat label="Ready" icon={CheckCircle2} value={ready} tone="good"
          progress={(ready / Math.max(1, total)) * 100} note="Finished successfully"
          drillLabel="orders that finished successfully" onClick={() => onDrill({ state: 'Ready' })}
          info="Orders whose execution finished successfully." />
        <Stat label="In progress" icon={PlayCircle} value={inProgress}
          progress={(inProgress / Math.max(1, total)) * 100} note="Running or queued behind a change window"
          drillLabel="orders in progress" onClick={() => onDrill({ state: 'In progress,Queued,Approved' })}
          info="Approved, queued, or actively executing right now." />
        <Stat label="Failed" icon={XCircle} value={failed} tone={failed ? 'crit' : undefined}
          progress={(failed / Math.max(1, total)) * 100} note="Rolled back, can be retried"
          drillLabel="failed orders" onClick={() => onDrill({ state: 'Failed,Rejected,Reinstantiate' })}
          info="Orders whose execution failed and was rolled back." />
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <Stat label="First-pass rate" icon={Gauge} value={firstPassRate !== undefined ? `${firstPassRate}%` : '—'}
          tone={firstPassRate === undefined ? undefined : firstPassRate >= 90 ? 'good' : firstPassRate >= 70 ? 'plum' : 'crit'}
          note="First attempts accepted without a retry"
          info="Of every order's first execution attempt in scope, the share accepted without needing a retry." />
        <Stat label="Average run duration" icon={Timer} value={avgDuration !== undefined ? dur(avgDuration) : '—'}
          note="Across every run in scope" info="Mean wall-clock duration of every run (any attempt) for orders in scope." />
      </div>

      <CategoryBreakdown byCategory={byCategory} noun="in execution" onDrill={onDrill}
        segmentsFor={(list) => {
          const c = (...st: OrderState[]) => list.filter((o) => st.includes(o.state)).length
          return [
            { label: 'Ready', value: c('Ready'), fill: 'good' as const, states: 'Ready' },
            { label: 'In progress', value: c('In progress', 'Queued', 'Approved'), fill: 'brand' as const, states: 'In progress,Queued,Approved' },
            { label: 'Failed', value: c('Failed', 'Rejected', 'Reinstantiate'), fill: 'crit' as const, states: 'Failed,Rejected,Reinstantiate' },
          ]
        }} />

      <Card>
        <CardHead title="Completions" sub={`Last 14 days · ${trend.completed.reduce((a, b) => a + b, 0)} orders went live`} />
        {/* TrendChart's own root is `h-full`, which needs a definite ancestor
           height to resolve against — the paired charts above get that for
           free from their grid row's tallest sibling, but this card is alone
           with no sibling to borrow a height from, so it gets one explicitly. */}
        <CardBody className="h-[240px]">
          <TrendChart height={220} ariaLabel="Orders completed per day, last 14 days" labels={trend.labels}
            series={[{ name: 'Completed', values: trend.completed, fill: 'good' }]} />
        </CardBody>
      </Card>
    </div>
  )
}

/** Ranked, biggest-first category breakdown — one StackedBar row each. */
function CategoryBreakdown({ byCategory, noun, segmentsFor, onDrill }: {
  byCategory: [Category, Order[]][]
  noun: string
  segmentsFor: (list: Order[]) => { label: string; value: number; fill: 'good' | 'brand' | 'none' | 'crit'; states: string }[]
  onDrill: (patch: Patch) => void
}) {
  return (
    <Card>
      <CardHead title="By category" sub="Every category in scope, split by where it stands — click a badge or a segment to open exactly those" />
      <CardBody className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {byCategory.map(([c, list]) => (
          <div key={c}>
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-2">
                <Badge tone={CATEGORY_TONE[c]}>{c}</Badge>
                <button onClick={() => onDrill({ cat: c, state: null })} className="text-[13px] font-medium tnum hover:text-brand-600"
                  aria-label={`${list.length} ${c} ${noun}. Open them`}>{list.length} {noun}</button>
              </span>
            </div>
            <StackedBar
              ariaLabel={`${c} ${noun} by status`}
              compact
              segments={segmentsFor(list).map((s) => ({ label: s.label, value: s.value, fill: s.fill, onClick: () => onDrill({ cat: c, state: s.states }) }))}
            />
          </div>
        ))}
      </CardBody>
    </Card>
  )
}
