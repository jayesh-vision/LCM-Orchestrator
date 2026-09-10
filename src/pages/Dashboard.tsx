import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Boxes, Cable, CheckCircle2, ClipboardList, Clock, HelpCircle,
  PlayCircle, RadioTower, Router, Wifi, Workflow as WorkflowIcon, XCircle,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Conformance, Domain, Order, OrderState } from '@/types'
import { DOMAINS, domainOf } from '@/types'
import { Badge, Button, Card, CardBody, CardHead, InfoTip, Mono, Progress, type StatTone } from '@/components/ui'
import { Donut, ColumnChart, SOFT, StackedBar, StackedTrendChart, TrendChart } from '@/components/charts'
import { CPE_VENDORS, OPTICAL_VENDORS, RADIO_VENDORS, ROUTER_VENDORS, SWITCH_VENDORS, VNF_VENDORS } from '@/data/catalog'
import { CATEGORY_TONE, relTime } from '@/lib/format'

const DAY = 86400000
const CATS = ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM', 'RAN VNF'] as const
const DOMAIN_ICON: Record<Domain, typeof Router> = { Transport: Router, Access: Wifi, Radio: RadioTower, Fiber: Cable }
const DOMAIN_BLURB: Record<Domain, string> = {
  Transport: 'L2VPN, L3VPN and IBW — router/switch CLI provisioning across 8 vendors.',
  Access: 'Broadband CPE activation — the platform\'s newest domain, 3 CPE vendors.',
  Radio: 'Microwave point-to-point backhaul links and RAN CU/DU VNF instances.',
  Fiber: 'DWDM wavelength circuits over optical transport — Ciena, Infinera, ECI.',
}
/* A distinct hue per domain, independent of the badge/stat tone palettes —
   the donut and its legend need four colours that read apart from each
   other side by side, which good/warn/crit/plum (4 slots, 2 already
   reserved for real status meaning) doesn't comfortably give. */
const DOMAIN_COLOR: Record<Domain, string> = { Transport: SOFT.brand, Access: SOFT.warn, Radio: SOFT.purple, Fiber: SOFT.cyan }
const DOMAIN_CHIP_CLS: Record<Domain, string> = {
  Transport: 'bg-[#1c81ef]/10 text-[#1c81ef]',
  Access: 'bg-[#f59e0b]/10 text-[#f59e0b]',
  Radio: 'bg-[#a855f7]/10 text-[#a855f7]',
  Fiber: 'bg-[#06b6d4]/10 text-[#06b6d4]',
}
const QUEUE_ICON_TONE: Record<'brand' | StatTone, { bg: string; fg: string; ring: string }> = {
  brand: { bg: 'bg-brand-50', fg: 'text-brand-600', ring: 'ring-brand-200/60' },
  good: { bg: 'bg-good-50', fg: 'text-good-700', ring: 'ring-good-200/70' },
  warn: { bg: 'bg-warn-50', fg: 'text-warn-700', ring: 'ring-warn-200/70' },
  crit: { bg: 'bg-crit-50', fg: 'text-crit-500', ring: 'ring-crit-200/70' },
  plum: { bg: 'bg-plum-50', fg: 'text-plum-700', ring: 'ring-plum-200/70' },
}

/* Service health — whether what's already provisioned still matches its
   intent. The other half of the LCM story the request funnel doesn't show:
   Requests raise the order, Workflows execute it, but only this closes the
   loop on whether the result still holds. */
const CONF_ORDER: Conformance[] = ['Conformant', 'Drifted', 'Never proven', 'Ghost']
const CONF_ICON: Record<string, typeof CheckCircle2> = { Conformant: CheckCircle2, Drifted: AlertTriangle, 'Never proven': HelpCircle, Ghost: XCircle }
const CONF_COLOR: Record<string, string> = { Conformant: SOFT.good, Drifted: SOFT.warn, 'Never proven': SOFT.none, Ghost: SOFT.crit }
const CONF_CHIP_CLS: Record<string, string> = {
  Conformant: 'bg-[#10b981]/10 text-[#10b981]',
  Drifted: 'bg-[#f59e0b]/10 text-[#f59e0b]',
  'Never proven': 'bg-[#9ca3af]/10 text-[#6b7280]',
  Ghost: 'bg-[#ef4444]/10 text-[#ef4444]',
}
/* Kept short on purpose — this card is half-width (unlike the full-width
   domain card's blurbs), so the row has roughly half the horizontal room
   before `truncate` starts clipping it. */
const CONF_BLURB: Record<string, string> = {
  Conformant: 'Matches the intent exactly.',
  Drifted: 'Changed since it was last proven.',
  'Never proven': 'Never independently verified.',
  Ghost: 'No configuration on the device.',
}

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
  const workflows = useStore((s) => s.workflows)
  const services = useStore((s) => s.services)
  const intents = useStore((s) => s.intents)
  const nav = useNavigate()

  const n = (s: OrderState) => orders.filter((o) => o.state === s).length
  const running = runs.filter((r) => r.outcome === 'Running')
  const waitingApproval = n('Validated')
  const readyToRun = n('Approved') + n('Queued')

  /* ---- templates & coverage: can we actually provision what's asked? ---- */
  const activeWf = workflows.filter((w) => w.state === 'Active').length
  const awaitingWf = workflows.filter((w) => w.state === 'Assigned' || w.state === 'Awaiting approval').length
  const vendorsActive = new Set(workflows.filter((w) => w.state === 'Active').map((w) => w.vendor)).size
  const allVendors = new Set([...ROUTER_VENDORS, ...SWITCH_VENDORS, ...CPE_VENDORS, ...RADIO_VENDORS, ...OPTICAL_VENDORS, ...VNF_VENDORS]).size
  const coverageGaps = intents.filter((i) => !workflows.some((w) => w.intentId === i.id && w.state === 'Active')).length

  /* ---- service health: does what's live still match its own intent? ---- */
  const confCounts = useMemo(() => {
    const out: Record<string, number> = { Conformant: 0, Drifted: 0, 'Never proven': 0, Ghost: 0 }
    services.forEach((s) => { if (s.conformance in out) out[s.conformance] += 1 })
    return out
  }, [services])
  const confTotal = CONF_ORDER.reduce((a, c) => a + confCounts[c], 0)
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
  /* "Active" = actually moving right now (approved/queued/in progress), as
     opposed to merely open (which also counts things still waiting on a
     decision, or already finished/failed) — the hero's per-domain strip
     needs both, since "246 open" alone can't say where the live work is. */
  const activeInDomain = (d: Domain) => orders.filter((o) => domainOf(o.category) === d && ['Approved', 'Queued', 'In progress'].includes(o.state)).length

  /* ---- 14-day trend: raised vs completed, plus per domain for the hero ---- */
  const DAYS = 14
  const trend = useMemo(() => {
    const labels = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(Date.now() - (DAYS - 1 - i) * DAY)
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    })
    const raisedByDomain = Object.fromEntries(
      DOMAINS.map((d) => [d, perDay(orders.filter((o) => domainOf(o.category) === d).map((o) => o.createdAt), DAYS)]),
    ) as Record<Domain, number[]>
    return {
      labels,
      raised: perDay(orders.map((o) => o.createdAt), DAYS),
      completed: perDay(orders.filter((o) => o.state === 'Ready').map((o) => o.updatedAt), DAYS),
      raisedByDomain,
    }
  }, [orders])
  const raised14 = trend.raised.reduce((a, b) => a + b, 0)
  const completed14 = trend.completed.reduce((a, b) => a + b, 0)

  /* ---- pipeline stages, in order ---- */
  /* Brand-blue ramp: the further along, the deeper the blue. Red only for failed. */
  const stages: { label: string; states: OrderState[]; color: string; go: string }[] = [
    { label: 'Draft', states: ['Draft'], color: SOFT.none, go: toRequests('Draft') },
    { label: 'Planned', states: ['Planned'], color: SOFT.none, go: toRequests('Planned') },
    { label: 'Validated', states: ['Validated'], color: SOFT.none, go: toRequests('Validated') },
    { label: 'Approved', states: ['Approved', 'Queued'], color: SOFT.brand, go: '/execution?state=Approved,Queued' },
    { label: 'In progress', states: ['In progress'], color: SOFT.brand, go: '/execution?state=In progress' },
    { label: 'Ready', states: ['Ready'], color: SOFT.good, go: toRequests('Ready') },
    { label: 'Failed', states: ['Failed'], color: SOFT.crit, go: '/execution?state=Failed' },
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

  const heroKpi = kpis[0]
  const queueKpis = kpis.slice(1)

  const templateRows: { label: string; value: number; sub: string; icon: typeof WorkflowIcon; go: string; tone?: StatTone; progress: number }[] = [
    { label: 'Active workflows', value: activeWf, sub: 'Ready to execute an order', icon: WorkflowIcon, go: '/workflows?state=Active', tone: 'good',
      progress: (activeWf / Math.max(1, workflows.length)) * 100 },
    { label: 'Awaiting approval', value: awaitingWf, sub: 'Authored, not yet published', icon: Clock, go: '/workflows?state=Assigned,Awaiting approval', tone: 'plum',
      progress: (awaitingWf / Math.max(1, workflows.length)) * 100 },
    { label: 'Vendors in service', value: vendorsActive, sub: `Of ${allVendors} vendors the platform supports`, icon: Boxes, go: '/workflows',
      progress: (vendorsActive / Math.max(1, allVendors)) * 100 },
    { label: 'Coverage gaps', value: coverageGaps, sub: 'Intents with no active workflow at all', icon: AlertTriangle, go: '/workflows', tone: coverageGaps ? 'crit' : 'good',
      progress: (coverageGaps / Math.max(1, intents.length)) * 100 },
  ]

  return (
    <>
      {/* ---------------- overview: headline + action queue ---------------- */}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="vw-flex vw-flex-col">
          <CardBody className="flex-1 min-h-0 vw-flex vw-flex-col">
            <button type="button" onClick={() => nav(heroKpi.go)}
              aria-label={`${heroKpi.value} ${heroKpi.label}. Open the full request list`}
              className="text-left w-full vw-flex vw-items-center vw-gap-sm group rounded-lg
                focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100">
              <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0 ring-1 ring-inset bg-brand-50 text-brand-600 ring-brand-200/60 transition-colors group-hover:bg-brand-100" aria-hidden>
                <heroKpi.icon size={20} />
              </span>
              <span className="min-w-0">
                <span className="vw-card-metric-label vw-flex vw-items-center vw-gap-xxs">
                  {heroKpi.label}
                  <InfoTip>{heroKpi.info}</InfoTip>
                </span>
                <span className="block vw-card-metric-xxxl tnum mt-0.5 group-hover:text-brand-600 transition-colors">{heroKpi.value.toLocaleString()}</span>
              </span>
            </button>
            <div className="flex-1 min-h-[120px] mt-1">
              <TrendChart height={150} ariaLabel="Requests raised per day by domain, last 14 days"
                labels={trend.labels}
                series={DOMAINS.map((d) => ({ name: d, values: trend.raisedByDomain[d], fill: 'brand', color: DOMAIN_COLOR[d] }))}
              />
            </div>
            {/* Per-domain breakdown — the number a domain contributes to "open",
               and how many of those are actually moving ("active") right now,
               so the hero doesn't read as one opaque total across every domain. */}
            <div className="pt-3 border-t border-line-soft vw-flex vw-items-center vw-gap-x-5 vw-gap-y-2 vw-wrap">
              {DOMAINS.map((d) => (
                <button key={d} type="button" onClick={() => nav(toRequests(undefined, undefined, d))}
                  aria-label={`${domainCounts[d]} ${d} requests, ${activeInDomain(d)} active. Open them`}
                  className="vw-flex vw-items-center vw-gap-xs text-[12.5px] text-ink-2 hover:text-ink-1">
                  <i className="w-2 h-2 rounded-full shrink-0" style={{ background: DOMAIN_COLOR[d] }} aria-hidden />
                  <span className="font-medium text-ink-1">{d}</span>
                  <span className="tnum">{domainCounts[d]}</span>
                  <span className="text-ink-3">· {activeInDomain(d)} active</span>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card className="vw-flex vw-flex-col">
          <CardHead title="Action queue" sub="What's waiting on a decision or a device, right now"
            info="Requests that need a human or a device to act before they can move forward: waiting for a NOC lead's approval, approved and queued for the next execution window, or failed and rolled back. Click a row to open exactly those requests." />
          <CardBody className="vw-flex vw-flex-col vw-gap-sm flex-1">
            {queueKpis.map((k) => {
              const t = QUEUE_ICON_TONE[k.tone ?? 'brand']
              return (
                <button key={k.label} type="button" onClick={() => nav(k.go)}
                  aria-label={`${k.value} ${k.label}. Open ${k.label.toLowerCase()}`}
                  className="vw-card-child vw-card--clickable w-full text-left">
                  <span className="vw-flex vw-items-center vw-gap-sm">
                    <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ring-1 ring-inset ${t.bg} ${t.fg} ${t.ring}`} aria-hidden>
                      <k.icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="vw-flex vw-items-center vw-justify-between vw-gap-sm">
                        <span className="vw-card-activity-label truncate">{k.label}</span>
                        <span className="vw-card-metric-sm tnum shrink-0">{k.value}</span>
                      </span>
                      <Progress value={k.progress ?? 0} tone={k.tone ?? 'brand'} className="mt-1.5" />
                      <span className="vw-card-activity-value block mt-1 truncate">{k.sub}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </CardBody>
        </Card>
      </div>

      {/* ---------------- templates & coverage · service health ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="vw-flex vw-flex-col">
          <CardHead title="Templates & coverage" sub="Can we actually provision what's being asked for?"
            info="Workflow templates are the executable recipes — CLI or VNF-lifecycle commands — bound to one category, vendor and model. An order can only run once an Active template exists for its intent, on its vendor. Click a row to open Workflows filtered to it." />
          <CardBody className="vw-flex vw-flex-col vw-gap-sm flex-1">
            {templateRows.map((k) => {
              const t = QUEUE_ICON_TONE[k.tone ?? 'brand']
              return (
                <button key={k.label} type="button" onClick={() => nav(k.go)}
                  aria-label={`${k.value} ${k.label}. Open Workflows`}
                  className="vw-card-child vw-card--clickable w-full text-left">
                  <span className="vw-flex vw-items-center vw-gap-sm">
                    <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ring-1 ring-inset ${t.bg} ${t.fg} ${t.ring}`} aria-hidden>
                      <k.icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="vw-flex vw-items-center vw-justify-between vw-gap-sm">
                        <span className="vw-card-activity-label truncate">{k.label}</span>
                        <span className="vw-card-metric-sm tnum shrink-0">{k.value}</span>
                      </span>
                      <Progress value={k.progress} tone={k.tone ?? 'brand'} className="mt-1.5" />
                      <span className="vw-card-activity-value block mt-1 truncate">{k.sub}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Service health" sub="Every live service, checked against its own intent"
            info="Whether what's already been provisioned still matches what was ordered. Conformant means the device matches the intent exactly; Drifted means it changed after being proven; Never proven means it was never independently verified; Ghost means there's no configuration on the device at all. Click a slice of the donut or a row to open those services." />
          <CardBody className="vw-flex vw-items-center vw-gap-6 vw-wrap lg:flex-nowrap">
            <div className="shrink-0 w-full flex justify-center lg:w-auto lg:justify-start">
              <Donut size={168} total={confTotal}
                segments={CONF_ORDER.map((c) => ({
                  label: c, value: confCounts[c], fill: 'brand', color: CONF_COLOR[c],
                  onClick: () => nav(`/inventory?conf=${encodeURIComponent(c)}`),
                }))}
              />
            </div>
            <div className="grid gap-2 flex-1 min-w-0 w-full">
              {CONF_ORDER.map((c) => {
                const share = Math.round((confCounts[c] / Math.max(1, confTotal)) * 100)
                const Icon = CONF_ICON[c]
                return (
                  <button key={c} type="button" onClick={() => nav(`/inventory?conf=${encodeURIComponent(c)}`)}
                    aria-label={`${confCounts[c]} ${c} services. Open them`}
                    className="vw-card-child vw-card--clickable w-full text-left">
                    <span className="vw-flex vw-items-center vw-gap-sm">
                      <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${CONF_CHIP_CLS[c]}`} aria-hidden>
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="vw-flex vw-items-center vw-justify-between vw-gap-sm">
                          <span className="vw-card-activity-label truncate">{c}</span>
                          <span className="vw-flex vw-items-baseline vw-gap-xs shrink-0">
                            <span className="vw-card-metric-sm tnum">{confCounts[c]}</span>
                            <span className="vw-label">{share}%</span>
                          </span>
                        </span>
                        <Progress value={share} color={CONF_COLOR[c]} className="mt-1.5" />
                        <span className="vw-card-activity-value block mt-1 truncate">{CONF_BLURB[c]}</span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Both cards below are pinned to the same explicit height and opted
         out of grid stretch (`self-start`) — two independently-sized `h-full`
         cards drift out of alignment the moment either one's natural content
         height changes (a chart's aspect ratio, one more category row), which
         is exactly what kept happening here. A shared fixed height makes the
         match permanent instead of a coincidence to re-verify every time. */}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* ---------------- pipeline ---------------- */}
        <Card className="h-[480px] self-start vw-flex vw-flex-col">
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
        {/* Same fixed height as "Requests by stage", same opt-out of grid
           stretch — with 7 categories today (and more to come), an unbounded
           list would drag its own height past its sibling's regardless of
           which one is taller. The list scrolls internally instead. */}
        <Card className="h-[480px] self-start vw-flex vw-flex-col">
          <CardHead title="By service type" sub="Ready · In progress · Waiting · Failed"
            info="The same open requests split by service family across every domain. Each bar is segmented by how far along the requests are — click a segment to open exactly those requests. Scrolls if more service types are added." />
          <CardBody className="vw-flex vw-flex-col vw-gap-lg flex-1 min-h-0 overflow-y-auto">
            {CATS.map((c) => {
              const list = orders.filter((o: Order) => o.category === c)
              const cnt = (...st: OrderState[]) => list.filter((o) => st.includes(o.state)).length
              const seg = (label: string, value: number, fill: 'good' | 'brand' | 'none' | 'crit', states: string) =>
                ({ label, value, fill, color: SOFT[fill], onClick: () => nav(toRequests(states, c)) })
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

      {/* ---------------- by domain ---------------- */}
      <Card>
        <CardHead title="Provisioning by domain" sub="Every request belongs to exactly one domain — click a slice or a row to open it"
          info="Requests split by network domain — Transport (router/switch), Access (CPE), Radio (microwave backhaul and RAN CU/DU) and Fiber (DWDM). Click a slice of the donut or a row on the right to open that domain's requests." />
        <CardBody className="vw-flex vw-items-center vw-gap-6 vw-wrap lg:flex-nowrap">
          <div className="shrink-0 w-full flex justify-center lg:w-auto lg:justify-start">
            <Donut size={168} total={orders.length}
              segments={DOMAINS.map((d) => ({
                label: d, value: domainCounts[d], fill: 'brand', color: DOMAIN_COLOR[d],
                onClick: () => nav(toRequests(undefined, undefined, d)),
              }))}
            />
          </div>
          <div className="grid gap-2 flex-1 min-w-0 w-full">
            {DOMAINS.map((d) => {
              const share = Math.round((domainCounts[d] / Math.max(1, orders.length)) * 100)
              const Icon = DOMAIN_ICON[d]
              return (
                <button key={d} type="button" onClick={() => nav(toRequests(undefined, undefined, d))}
                  aria-label={`${domainCounts[d]} ${d} domain requests. Open them`}
                  className="vw-card-child vw-card--clickable w-full text-left">
                  <span className="vw-flex vw-items-center vw-gap-sm">
                    <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${DOMAIN_CHIP_CLS[d]}`} aria-hidden>
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="vw-flex vw-items-center vw-justify-between vw-gap-sm">
                        <span className="vw-card-activity-label truncate">{d}</span>
                        <span className="vw-flex vw-items-baseline vw-gap-xs shrink-0">
                          <span className="vw-card-metric-sm tnum">{domainCounts[d]}</span>
                          <span className="vw-label">{share}%</span>
                        </span>
                      </span>
                      <Progress value={share} color={DOMAIN_COLOR[d]} className="mt-1.5" />
                      <span className="vw-card-activity-value block mt-1 truncate">{DOMAIN_BLURB[d]}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        {/* ---------------- trend ---------------- */}
        <Card className="h-full vw-flex vw-flex-col">
          <CardHead title="Raised vs completed" sub={`Last 14 days · ${raised14} raised, ${completed14} went live`}
            info="New requests raised per day, stacked by domain, against the total that went live — over the last 14 days. When the bars stack up above the Completed line, work is arriving faster than the team is finishing it and the backlog grows. Hover the chart for exact daily numbers." />
          <CardBody className="flex-1 min-h-0 vw-flex vw-flex-col">
            <StackedTrendChart height={330}
              ariaLabel="Requests raised per day by domain, versus completed, last 14 days"
              labels={trend.labels}
              series={DOMAINS.map((d) => ({ name: d, values: trend.raisedByDomain[d], color: DOMAIN_COLOR[d] }))}
              overlay={{ name: 'Completed', values: trend.completed, color: '#4b5563' }}
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
