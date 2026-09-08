import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ClipboardList, PlayCircle, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Order, OrderState } from '@/types'
import { Badge, Button, Card, CardBody, CardHead, Mono, Progress } from '@/components/ui'
import { CHART, ColumnChart, StackedBar, TrendChart } from '@/components/charts'
import { CATEGORY_TONE, relTime } from '@/lib/format'

const DAY = 86400000
const CATS = ['L2VPN', 'L3VPN', 'IBW'] as const

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

/**
 * Service provisioning at a glance. Every figure is a plain count an engineer
 * already uses in conversation, and every figure opens the list behind it.
 */
export default function Dashboard() {
  const orders = useStore((s) => s.orders)
  const runs = useStore((s) => s.runs)
  const nav = useNavigate()

  const n = (s: OrderState) => orders.filter((o) => o.state === s).length
  const running = runs.filter((r) => r.outcome === 'Running')
  const waitingApproval = n('Designed') + n('Awaiting approval')
  const readyToRun = n('Approved') + n('Queued')
  const toRequests = (state?: string, cat?: string) => {
    const p = new URLSearchParams()
    if (state) p.set('state', state)
    if (cat) p.set('cat', cat)
    return `/requests${p.toString() ? `?${p}` : ''}`
  }

  /* ---- 14-day trend: raised vs completed ---- */
  const DAYS = 14
  const trend = useMemo(() => {
    const labels = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(Date.now() - (DAYS - 1 - i) * DAY)
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    })
    return {
      labels,
      raised: perDay(orders.map((o) => o.createdAt), DAYS),
      completed: perDay(orders.filter((o) => o.state === 'Activated').map((o) => o.updatedAt), DAYS),
    }
  }, [orders])
  const raised14 = trend.raised.reduce((a, b) => a + b, 0)
  const completed14 = trend.completed.reduce((a, b) => a + b, 0)

  /* ---- pipeline stages, in order ---- */
  /* Brand-blue ramp: the further along, the deeper the blue. Red only for failed. */
  const stages: { label: string; states: OrderState[]; color: string; go: string }[] = [
    { label: 'Draft', states: ['Draft'], color: CHART.gray300, go: toRequests('Draft') },
    { label: 'Designed', states: ['Designed'], color: CHART.blue200, go: toRequests('Designed') },
    { label: 'Approval', states: ['Awaiting approval'], color: CHART.blue300, go: '/execution?state=Awaiting approval' },
    { label: 'Approved', states: ['Approved', 'Queued'], color: CHART.blue400, go: '/execution?state=Approved,Queued' },
    { label: 'Running', states: ['Executing'], color: CHART.blue500, go: '/execution?state=Executing' },
    { label: 'Activated', states: ['Activated'], color: CHART.blue600, go: toRequests('Activated') },
    { label: 'Failed', states: ['Failed'], color: CHART.red300, go: '/execution?state=Failed' },
  ]

  const kpis = [
    { label: 'Open requests', value: orders.length, sub: `${n('Draft')} still in draft`, icon: ClipboardList, go: '/requests' },
    { label: 'Waiting for approval', value: waitingApproval, sub: 'Verify, then approve or send back', icon: CheckCircle2, go: '/execution?state=Designed,Awaiting approval' },
    { label: 'Ready to run', value: readyToRun, sub: 'Approved, waiting for a change window', icon: PlayCircle, go: '/execution?state=Approved,Queued' },
    { label: 'Failed', value: n('Failed'), sub: 'Rolled back, needs a retry', icon: XCircle, go: '/execution?state=Failed' },
  ]

  return (
    <>
      {/* ---------------- KPI strip — NST kpi-card specimen ---------------- */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <button key={k.label} onClick={() => nav(k.go)}
            aria-label={`${k.value} ${k.label.toLowerCase()}. Open them`}
            className="vw-card-section vw-card--clickable text-left vw-flex vw-flex-col vw-gap-md">
            <span className="vw-flex vw-items-start vw-justify-between vw-gap-sm">
              <span className="vw-card-metric-label">{k.label}</span>
              <k.icon size={16} className="text-ink-3 shrink-0" aria-hidden />
            </span>
            <span className="vw-card-metric-xl tnum">{k.value.toLocaleString()}</span>
            <span className="vw-card-metric-label-sub">{k.sub}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* ---------------- pipeline ---------------- */}
        <Card className="h-full vw-flex vw-flex-col">
          <CardHead title="Requests by stage" sub="Where every open request is right now — click a bar to open that list"
            right={<Button size="sm" onClick={() => nav('/requests')}>All requests</Button>} />
          <CardBody className="flex-1 min-h-0 vw-flex vw-flex-col">
            <ColumnChart height={340}
              ariaLabel="Requests by stage"
              data={stages.map((s) => ({
                label: s.label, color: s.color,
                value: s.states.reduce((a, st) => a + n(st), 0),
                onClick: () => nav(s.go),
              }))}
            />
          </CardBody>
        </Card>

        {/* ---------------- by service type ---------------- */}
        <Card className="h-full vw-flex vw-flex-col">
          <CardHead title="By service type" sub="Activated · In progress · Waiting · Failed" />
          <CardBody className="vw-flex vw-flex-col vw-justify-evenly vw-gap-lg flex-1">
            {CATS.map((c) => {
              const list = orders.filter((o: Order) => o.category === c)
              const cnt = (...st: OrderState[]) => list.filter((o) => st.includes(o.state)).length
              const seg = (label: string, value: number, color: string, states: string) =>
                ({ label, value, fill: 'brand' as const, color, onClick: () => nav(toRequests(states, c)) })
              return (
                <div key={c}>
                  <div className="vw-flex vw-items-center vw-justify-between mb-2">
                    <span className="vw-flex vw-items-center vw-gap-sm">
                      <Badge tone={CATEGORY_TONE[c]}>{c}</Badge>
                      <button onClick={() => nav(toRequests(undefined, c))} className="vw-value font-medium tnum hover:text-brand-600"
                        aria-label={`${list.length} ${c} requests. Open them`}>{list.length} requests</button>
                    </span>
                    <span className="vw-label tnum">{cnt('Activated')} activated</span>
                  </div>
                  <StackedBar
                    ariaLabel={`${c} requests by status`}
                    compact
                    segments={[
                      seg('Activated', cnt('Activated'), CHART.blue600, 'Activated'),
                      seg('In progress', cnt('Approved', 'Queued', 'Executing'), CHART.blue400, 'Approved,Queued,Executing'),
                      seg('Waiting', cnt('Draft', 'Designed', 'Awaiting approval'), CHART.gray300, 'Draft,Designed,Awaiting approval'),
                      seg('Failed', cnt('Failed', 'Rejected', 'Unrouted'), CHART.red300, 'Failed,Rejected,Unrouted'),
                    ]}
                  />
                </div>
              )
            })}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* ---------------- trend ---------------- */}
        <Card className="h-full vw-flex vw-flex-col">
          <CardHead title="Raised vs completed" sub={`Last 14 days · ${raised14} raised, ${completed14} went live`} />
          <CardBody className="flex-1 min-h-0 vw-flex vw-flex-col">
            <TrendChart height={330}
              ariaLabel="Requests raised and completed per day, last 14 days"
              labels={trend.labels}
              series={[
                { name: 'Raised', values: trend.raised, fill: 'brand', color: CHART.blue500 },
                { name: 'Completed', values: trend.completed, fill: 'brand', color: CHART.blue300 },
              ]}
            />
          </CardBody>
        </Card>

        {/* ---------------- running now ---------------- */}
        <Card className="h-full vw-flex vw-flex-col">
          <CardHead title="Running now" sub={running.length ? `${running.length} on a device right now` : 'Nothing on a device'}
            right={running.length > 0 && <Button size="sm" onClick={() => nav('/execution?state=Executing')}>All</Button>} />
          <CardBody className="vw-flex vw-flex-col vw-gap-sm flex-1">
            {running.length === 0 && (
              <div className="py-6 text-center">
                <p className="vw-card-description mb-3">No configuration is being pushed right now.</p>
                <Button size="sm" variant="primary" onClick={() => nav('/requests/new')}>New network service</Button>
              </div>
            )}
            {running.slice(0, 6).map((r) => {
              const order = orders.find((o) => o.id === r.orderId)
              const done = r.tasks.filter((t) => t.state === 'Passed').length
              const now = r.tasks.find((t) => t.state === 'Running')
              return (
                <button key={r.id} onClick={() => nav(`/execution/${r.orderId}?tab=lifecycle`)}
                  aria-label={`Open the live run for ${r.orderId}`}
                  className="vw-card-child vw-card--clickable text-left w-full">
                  <span className="vw-flex vw-items-center vw-justify-between vw-gap-md">
                    <span className="min-w-0">
                      <span className="vw-card-activity-label block truncate">{order?.name ?? r.orderId}</span>
                      <span className="vw-card-activity-value block truncate">
                        <Mono className="text-[11.5px]">{r.orderId}</Mono>{order ? ` · ${order.accountName}` : ''}
                      </span>
                    </span>
                    <span className="vw-label tnum whitespace-nowrap">step {done + 1} of {r.tasks.length}</span>
                  </span>
                  <Progress value={(done / r.tasks.length) * 100} className="mt-2" />
                  <span className="vw-card-activity-value block mt-1 truncate">
                    {now ? `${now.name} · ` : ''}started {relTime(r.startedAt)}
                  </span>
                </button>
              )
            })}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
