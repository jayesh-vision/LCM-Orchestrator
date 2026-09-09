import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cable, CheckCircle2, ClipboardList, PlayCircle, RadioTower, Router, Wifi, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Domain, Order, OrderState } from '@/types'
import { DOMAINS, domainOf } from '@/types'
import { Badge, Button, Card, CardBody, CardHead, Mono, Progress, Stat, type StatTone } from '@/components/ui'
import { CHART, FILL, ColumnChart, StackedBar, TrendChart } from '@/components/charts'
import { CATEGORY_TONE, relTime } from '@/lib/format'

const DAY = 86400000
const CATS = ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM', 'RAN VNF'] as const
const DOMAIN_ICON: Record<Domain, typeof Router> = { Transport: Router, Access: Wifi, Radio: RadioTower, Fiber: Cable }
const DOMAIN_BLURB: Record<Domain, string> = {
  Transport: 'L2VPN, L3VPN and IBW — router/switch CLI provisioning across 8 vendors.',
  Access: 'Broadband CPE activation — the platform\'s newest domain, 3 CPE vendors.',
  Radio: 'Microwave point-to-point backhaul links — Ceragon, Aviat, NEC.',
  Fiber: 'DWDM wavelength circuits over optical transport — Ciena, Infinera, ECI.',
}
const DOMAIN_STAT_TONE: Record<Domain, StatTone | undefined> = { Transport: undefined, Access: 'warn', Radio: 'plum', Fiber: 'good' }

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
  const waitingApproval = n('Validated')
  const readyToRun = n('Approved') + n('Queued')
  const toRequests = (state?: string, cat?: string, domain?: string) => {
    const p = new URLSearchParams()
    if (state) p.set('state', state)
    if (cat) p.set('cat', cat)
    if (domain) p.set('domain', domain)
    return `/requests${p.toString() ? `?${p}` : ''}`
  }

  /* ---- multi-domain split across every domain the platform provisions ---- */
  const domainCounts = useMemo(() => {
    const out: Record<Domain, number> = { Transport: 0, Access: 0, Radio: 0, Fiber: 0 }
    orders.forEach((o) => { out[domainOf(o.category)] += 1 })
    return out
  }, [orders])

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
      completed: perDay(orders.filter((o) => o.state === 'Ready').map((o) => o.updatedAt), DAYS),
    }
  }, [orders])
  const raised14 = trend.raised.reduce((a, b) => a + b, 0)
  const completed14 = trend.completed.reduce((a, b) => a + b, 0)

  /* ---- pipeline stages, in order ---- */
  /* Brand-blue ramp: the further along, the deeper the blue. Red only for failed. */
  const stages: { label: string; states: OrderState[]; color: string; go: string }[] = [
    { label: 'Draft', states: ['Draft'], color: FILL.none, go: toRequests('Draft') },
    { label: 'Planned', states: ['Planned'], color: FILL.none, go: toRequests('Planned') },
    { label: 'Validated', states: ['Validated'], color: FILL.none, go: toRequests('Validated') },
    { label: 'Approved', states: ['Approved', 'Queued'], color: FILL.brand, go: '/execution?state=Approved,Queued' },
    { label: 'In progress', states: ['In progress'], color: FILL.brand, go: '/execution?state=In progress' },
    { label: 'Ready', states: ['Ready'], color: FILL.good, go: toRequests('Ready') },
    { label: 'Failed', states: ['Failed'], color: FILL.crit, go: '/execution?state=Failed' },
  ]

  const kpis: { label: string; value: number; sub: string; icon: typeof ClipboardList; go: string; info: string; tone?: StatTone; progress?: number }[] = [
    { label: 'Open requests', value: orders.length, sub: `${n('Draft')} still in draft`, icon: ClipboardList, go: '/requests',
      progress: (n('Draft') / Math.max(1, orders.length)) * 100,
      info: 'Every provisioning request currently in the system, from first draft through execution. Click to open the full request list.' },
    { label: 'Waiting for approval', value: waitingApproval, sub: 'Pre-validated, ready for a decision', icon: CheckCircle2, go: toRequests('Validated'), tone: 'plum',
      progress: (waitingApproval / Math.max(1, orders.length)) * 100,
      info: 'Requests that passed validation and now need a NOC lead to approve or reject them. Nothing is written to a device until this decision is made.' },
    { label: 'Ready to run', value: readyToRun, sub: 'Approved, waiting for a change window', icon: PlayCircle, go: '/execution?state=Approved,Queued', tone: 'good',
      progress: (readyToRun / Math.max(1, orders.length)) * 100,
      info: 'Approved requests queued for execution. Traffic-affecting work waits for the nightly change window; hitless work runs as capacity allows.' },
    { label: 'Failed', value: n('Failed'), sub: 'Rolled back, needs a retry', icon: XCircle, go: '/execution?state=Failed', tone: n('Failed') ? 'crit' : undefined,
      progress: (n('Failed') / Math.max(1, orders.length)) * 100,
      info: 'Requests whose execution failed and was rolled back — the device is back in its prior state and the order can be retried from Provisioning Execution.' },
  ]

  return (
    <>
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Stat key={k.label} label={k.label} icon={k.icon} value={k.value.toLocaleString()} tone={k.tone}
            progress={k.progress} note={k.sub} info={k.info}
            drillLabel={k.label.toLowerCase()} onClick={() => nav(k.go)} />
        ))}
      </div>

      {/* ---------------- by domain ---------------- */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {DOMAINS.map((d) => (
          <Stat key={d} label={`${d} requests`} icon={DOMAIN_ICON[d]} value={domainCounts[d]}
            tone={DOMAIN_STAT_TONE[d]}
            progress={(domainCounts[d] / Math.max(1, orders.length)) * 100}
            note={`${Math.round((domainCounts[d] / Math.max(1, orders.length)) * 100)}% of all requests · ${DOMAIN_BLURB[d]}`}
            info={`Every request belongs to exactly one domain. ${DOMAIN_BLURB[d]}`}
            drillLabel={`${d} domain requests`} onClick={() => nav(toRequests(undefined, undefined, d))} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* ---------------- pipeline ---------------- */}
        <Card className="h-full vw-flex vw-flex-col">
          <CardHead title="Requests by stage" sub="Where every open request is right now — click a bar to open that list"
            info="Each bar is one stage of the provisioning pipeline, left to right in the order a request moves through it: Draft → Planned → Validated → Approved → In progress → Ready. Grey stages are pre-approval, blue are actively being worked, green is done and red is failed."
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
          <CardHead title="By service type" sub="Ready · In progress · Waiting · Failed"
            info="The same open requests split by service family across both domains — L2VPN, L3VPN and IBW (Transport), Broadband (Access). Each bar is segmented by how far along the requests are — click a segment to open exactly those requests." />
          <CardBody className="vw-flex vw-flex-col vw-justify-evenly vw-gap-lg flex-1">
            {CATS.map((c) => {
              const list = orders.filter((o: Order) => o.category === c)
              const cnt = (...st: OrderState[]) => list.filter((o) => st.includes(o.state)).length
              const seg = (label: string, value: number, fill: 'good' | 'brand' | 'none' | 'crit', states: string) =>
                ({ label, value, fill, onClick: () => nav(toRequests(states, c)) })
              return (
                <div key={c}>
                  <div className="vw-flex vw-items-center vw-justify-between mb-2">
                    <span className="vw-flex vw-items-center vw-gap-sm">
                      <Badge tone={CATEGORY_TONE[c]}>{c}</Badge>
                      <button onClick={() => nav(toRequests(undefined, c))} className="vw-value font-medium tnum hover:text-brand-600"
                        aria-label={`${list.length} ${c} requests. Open them`}>{list.length} requests</button>
                    </span>
                    <span className="vw-label tnum">{cnt('Ready')} ready</span>
                  </div>
                  <StackedBar
                    ariaLabel={`${c} requests by status`}
                    compact
                    segments={[
                      seg('Ready', cnt('Ready'), 'good', 'Ready'),
                      seg('In progress', cnt('Approved', 'Queued', 'In progress'), 'brand', 'Approved,Queued,In progress'),
                      seg('Waiting', cnt('Draft', 'Planned', 'Validated'), 'none', 'Draft,Planned,Validated'),
                      seg('Failed', cnt('Failed', 'Rejected', 'Invalid', 'Reinstantiate'), 'crit', 'Failed,Rejected,Invalid,Reinstantiate'),
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
          <CardHead title="Raised vs completed" sub={`Last 14 days · ${raised14} raised, ${completed14} went live`}
            info="New requests raised per day against requests that went live, over the last 14 days. When the raised line stays above the completed line, work is arriving faster than the team is finishing it and the backlog grows. Hover the chart for exact daily numbers." />
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
            info="Orders whose workflow is executing on a device at this moment, with live task progress. Click one to open its execution detail."
            right={running.length > 0 && <Button size="sm" onClick={() => nav('/execution?state=In progress')}>All</Button>} />
          <CardBody className="vw-flex vw-flex-col vw-gap-sm flex-1 min-h-0 max-h-[360px] overflow-y-auto">
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
