import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CircleOff, PauseCircle, Pencil, PlayCircle, Plus, RefreshCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { useStore } from '@/store/useStore'
import {
  Badge, Button, Card, CardBody, CardHead, KV, Mono, Note, Tabs,
} from '@/components/ui'
import {
  CATEGORY_TONE, CONFORMANCE_TONE, dateTime, dur, inr, INTENT_TONE, ORDER_TONE,
  relTime, RUN_TONE, SERVICE_TONE, shortDate,
} from '@/lib/format'
import { ORIGIN_BLURB, ORIGIN_LABEL, serviceOrigins } from '@/lib/traceability'
import { CeaseServiceModal, ModifyServiceDrawer } from '@/components/ServiceChangeDialogs'
import { RUN_LOG_RETENTION_DAYS } from '@/data/orders'
import { endpointRole } from '@/types'
import type { OrderIntent, Run } from '@/types'

type Tab = 'overview' | 'realised' | 'evidence' | 'lifecycle' | 'history' | 'resources'

/* The mark on each stop of the journey. Intent is the one thing that is true
   of a request before anything happens to it, so it carries the colour; the
   outcome is stated in words underneath rather than recoloured, which would
   leave two competing meanings on one dot. */
const JOURNEY: Record<OrderIntent, { icon: typeof Plus; dot: string }> = {
  Create: { icon: Plus, dot: 'bg-brand-500' },
  Modify: { icon: Pencil, dot: 'bg-plum-500' },
  Suspend: { icon: PauseCircle, dot: 'bg-warn-500' },
  Resume: { icon: PlayCircle, dot: 'bg-good-500' },
  Cease: { icon: CircleOff, dot: 'bg-crit-500' },
  'Re-prove': { icon: ShieldCheck, dot: 'bg-brand-500' },
}

export default function ServiceDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const svc = useStore((s) => s.services.find((x) => x.id === id))
  const allOrders = useStore((s) => s.orders)
  const raiseChange = useStore((s) => s.raiseChange)
  const reprove = useStore((s) => s.reproveService)
  /* The tab lives in the URL so another screen can link straight to it — a
     change request points at this service's lifecycle, not at its overview. */
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') ?? 'overview') as Tab
  const setTab = (t: string) => setSp({ tab: t }, { replace: true })
  /* Which stop on the journey strip is selected, so the strip and the detail
     list below it point at the same request instead of being two lists the
     reader has to line up by eye. */
  const [focus, setFocus] = useState<string | null>(null)
  const [modifyOpen, setModifyOpen] = useState(false)
  const [ceaseOpen, setCeaseOpen] = useState(false)
  const orders = useMemo(() => allOrders.filter((o) => o.serviceId === id), [allOrders, id])
  const origin = useMemo(() => serviceOrigins(allOrders).get(id ?? '') ?? 'inherited', [allOrders, id])

  /**
   * Every request ever raised against this service, newest first, each with the
   * runs that carried it out.
   *
   * A request detail screen answers "what happened to this request". Nothing
   * answered "what has been done to this service, by whom, and when" — you had
   * to already know each order id to walk the chain. This is that walk: the
   * create that built it, then every change since, with the device-level
   * execution under each one.
   */
  const allRuns = useStore((s) => s.runs)
  const lifecycle = useMemo(() => {
    const byOrder = new Map<string, Run[]>()
    allRuns.forEach((r) => {
      const list = byOrder.get(r.orderId) ?? []
      list.push(r)
      byOrder.set(r.orderId, list)
    })
    /* Oldest first. This is a provenance record, not a feed: it reads "built,
       then changed, then changed again", which is the order the events
       happened in and the order anyone narrates them in. */
    return [...orders]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((o) => ({
        order: o,
        /* Oldest attempt first — a retry only reads as a retry after the thing
           it retried. */
        runs: (byOrder.get(o.id) ?? []).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
      }))
  }, [orders, allRuns])

  if (!svc) {
    return (
      <Card><CardBody className="py-14 text-center">
        <div className="text-[16px] font-semibold mb-1">Service not found</div>
        <p className="text-ink-3 text-[13px] mb-4">{id} is not in the current dataset.</p>
        <Link to="/inventory" className="text-brand-600 text-[13px] font-medium">Back to Service Inventory</Link>
      </CardBody></Card>
    )
  }

  const drift = svc.attributes.filter((a) => a.verdict === 'Drift')

  return (
    <>
      <Card>
        <CardBody className="pb-4">
          <button onClick={() => nav(-1)} className="text-[12.5px] text-ink-3 hover:text-ink-1 flex items-center gap-1.5 mb-3">
            <ArrowLeft size={14} />Back
          </button>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                <h1 className="text-[21px] font-semibold tracking-[-.4px] m-0">{svc.name}</h1>
                <Badge tone={SERVICE_TONE[svc.state]} dot>{svc.state}</Badge>
                <Badge tone={CATEGORY_TONE[svc.category]}>{svc.category} · {svc.type}</Badge>
                <Badge tone={CONFORMANCE_TONE[svc.conformance]}>{svc.conformance}</Badge>
                {/* Whether this service came from a request in this system or
                    was already on the network when the platform arrived. Most
                    of the base is the latter, and saying so stops a service
                    with no order behind it from looking like missing data. */}
                <span title={ORIGIN_BLURB[origin]}>
                  <Badge tone={origin === 'provisioned' ? 'good' : origin === 'managed' ? 'info' : 'none'}>
                    {ORIGIN_LABEL[origin]}
                  </Badge>
                </span>
              </div>
              <p className="text-[13px] text-ink-2 m-0">
                <Mono className="font-semibold">{svc.id}</Mono> · {svc.accountName} <Mono className="text-ink-3">{svc.accountId}</Mono> ·
                {' '}live since {shortDate(svc.liveSince)} · {svc.history.length} changes on record
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => setModifyOpen(true)}>Modify</Button>
              <Button onClick={() => { raiseChange(svc.id, svc.state === 'Suspended' ? 'Resume' : 'Suspend'); nav('/change') }}>
                {svc.state === 'Suspended' ? <><PlayCircle size={15} />Resume</> : <><PauseCircle size={15} />Suspend</>}
              </Button>
              <Button variant="danger" onClick={() => setCeaseOpen(true)}><Trash2 size={15} />Cease</Button>
              <Button variant="primary" onClick={() => reprove(svc.id)}><RefreshCcw size={15} />Re-prove now</Button>
            </div>
          </div>
        </CardBody>
        <div className="px-5">
          <Tabs
            value={tab} onChange={setTab}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'realised', label: 'Intent vs realised', count: svc.attributes.length },
              { id: 'evidence', label: 'Evidence' },
              { id: 'lifecycle', label: 'Lifecycle', count: orders.length },
              { id: 'history', label: 'Change history', count: svc.history.length },
              { id: 'resources', label: 'Resources', count: svc.resources.length },
            ]}
          />
        </div>
      </Card>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHead title="Service path" sub="A-end to Z-end, with the layer each hop is proven at"
              right={svc.lastProvenAt ? <Badge tone="good" dot>Proven {relTime(svc.lastProvenAt)}</Badge> : <Badge tone="warn">Never proven</Badge>} />
            <CardBody>
              <div className="flex items-center gap-2 flex-wrap justify-center py-3">
                {svc.endpoints.map((e, i) => (
                  <div key={e.id} className="flex items-center gap-2">
                    {i > 0 && (
                      <div className="flex flex-col items-center px-1">
                        <span className={`text-[10px] ${svc.operState === 'Up' ? 'text-good-700' : 'text-warn-700'}`}>
                          {svc.operState === 'Up' ? 'up' : svc.operState.toLowerCase()}
                        </span>
                        <span className={`block w-14 h-0.5 ${svc.operState === 'Up' ? 'bg-good-500' : 'bg-warn-500'}`} />
                      </div>
                    )}
                    <div className="border border-brand-200 bg-brand-50 rounded-xl px-4 py-3 text-center min-w-[150px]">
                      <div className="text-[12.5px] font-semibold">{e.siteCode}</div>
                      <div className="text-[11px] text-ink-2">{e.vendor} {e.deviceName}</div>
                      <div className="text-[11px] font-mono text-ink-2 mt-0.5">{e.subInterface ?? e.port}</div>
                      <Badge tone="none" className="mt-1.5">{e.role}</Badge>
                    </div>
                  </div>
                ))}
              </div>
              {svc.acceptanceEvidence && (
                <div className="mt-3 border border-good-200 bg-good-50 rounded-lg px-4 py-3">
                  <div className="text-[11.5px] font-semibold text-good-700 mb-1">Acceptance evidence</div>
                  <div className="text-[11.5px] text-good-700/90">
                    {svc.acceptanceEvidence.filter((e) => e.layer === 'service').map((e) => e.actual).join(' · ') || 'device and network criteria passed'}
                  </div>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-3 mt-4">
                <div className="border border-line rounded-lg px-3.5 py-3">
                  <div className="text-[12px] text-ink-3">Ordered bandwidth</div>
                  <div className="text-[14px] font-semibold mt-0.5">{svc.bandwidthMbps} Mbps</div>
                </div>
                <div className="border border-line rounded-lg px-3.5 py-3">
                  <div className="text-[12px] text-ink-3">Monthly value</div>
                  <div className="text-[14px] font-semibold mt-0.5">{inr(svc.monthlyValueInr)}</div>
                </div>
                <div className="border border-line rounded-lg px-3.5 py-3">
                  <div className="text-[12px] text-ink-3">Open drift</div>
                  <div className={`text-[14px] font-semibold mt-0.5 ${drift.length ? 'text-warn-700' : ''}`}>{drift.length}</div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Current state" sub="Three independent readings, never merged" />
            <CardBody className="flex flex-col gap-3.5">
              {[
                ['Service state', 'Contractual · changed only by orders', <Badge key="a" tone={SERVICE_TONE[svc.state]} dot>{svc.state}</Badge>],
                ['Operational state', 'Observed · polled every 60 s, never stored', <Badge key="b" tone={svc.operState === 'Up' ? 'good' : svc.operState === 'Degraded' ? 'warn' : 'none'} dot>{svc.operState}</Badge>],
                ['Conformance', 'Computed · intent compared to device', <Badge key="c" tone={CONFORMANCE_TONE[svc.conformance]}>{svc.conformance}</Badge>],
              ].map(([t, s, b], i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium">{t as string}</div>
                    <div className="text-[11.5px] text-ink-3">{s as string}</div>
                  </div>
                  {b as React.ReactNode}
                </div>
              ))}
              <div className="h-px bg-line-soft" />
              <KV items={[
                ['Last proven', relTime(svc.lastProvenAt)],
                ['Live since', shortDate(svc.liveSince)],
                ['Age', svc.ageLabel],
                /* Orders are the only reason a service ever changes, so every
                   one named here opens the request that did it. */
                ['Open orders', orders.length
                  ? (
                    <span className="flex flex-wrap gap-x-2 gap-y-1">
                      {orders.map((o) => (
                        <Link key={o.id} to={`/requests/${o.id}`} className="text-brand-600 hover:underline">
                          <Mono>{o.id}</Mono>
                        </Link>
                      ))}
                    </span>
                  )
                  : <span className="text-ink-3">none</span>],
              ]} />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'realised' && (
        <Card>
          <CardHead title="Intent vs realised"
            sub="What the order asked for, what the device reports, and where each value came from"
            right={drift.length ? <Badge tone="warn" dot>{drift.length} drift</Badge> : <Badge tone="good" dot>No drift</Badge>} />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr>
                {['Attribute', 'Intent', 'On device', 'Source', 'Verified', 'Verdict'].map((h) => (
                  <th key={h} scope="col" className="text-left px-[18px] py-3 border-b border-line text-[12px] font-medium text-ink-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {svc.attributes.map((a) => (
                  <tr key={a.name} className="border-b border-line-soft last:border-0">
                    <td className="px-[18px] py-3 font-medium">{a.name}</td>
                    <td className="px-[18px] py-3 font-mono">{a.intent}</td>
                    <td className={`px-[18px] py-3 font-mono ${a.verdict === 'Drift' ? 'text-warn-700 font-semibold' : a.verdict === 'Absent' ? 'text-crit-700' : ''}`}>{a.onDevice}</td>
                    <td className="px-[18px] py-3"><Badge tone={a.source === 'Reserved' ? 'info' : a.source === 'Manual' ? 'warn' : a.source === 'Inventory' ? 'plum' : 'none'}>{a.source}</Badge></td>
                    <td className="px-[18px] py-3 text-ink-3">{a.verifiedAt ?? 'never'}</td>
                    <td className="px-[18px] py-3">
                      <Badge tone={a.verdict === 'Match' ? 'good' : a.verdict === 'Drift' ? 'warn' : a.verdict === 'Absent' ? 'crit' : 'none'}>{a.verdict}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody className="pt-4">
            <Note>Precedence when sources disagree: <b>Derived → Discovered → Reserved → Manual → Planned</b>. A designed-but-unbuilt service reads as <i>not yet built</i>, never as drifted.</Note>
          </CardBody>
        </Card>
      )}

      {tab === 'evidence' && (
        <Card>
          <CardHead title="Acceptance evidence" sub="What the last proof actually asserted"
            right={svc.acceptanceEvidence ? <Badge tone="good" dot>{svc.acceptanceEvidence.length} of {svc.acceptanceEvidence.length} passed</Badge> : <Badge tone="warn">No evidence</Badge>} />
          {svc.acceptanceEvidence ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr>
                  {['#', 'Claim', 'Layer', 'Expected', 'Actual', 'Verdict'].map((h) => (
                    <th key={h} scope="col" className="text-left px-[18px] py-3 border-b border-line text-[12px] font-medium text-ink-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {svc.acceptanceEvidence.map((e, i) => (
                    <tr key={i} className={`border-b border-line-soft last:border-0 ${e.layer === 'service' ? 'bg-good-50' : ''}`}>
                      <td className="px-[18px] py-3 font-mono text-ink-3">{i + 1}</td>
                      <td className="px-[18px] py-3 font-medium">{e.criterion}</td>
                      <td className="px-[18px] py-3"><Badge tone={e.layer === 'service' ? 'good' : 'none'}>{e.layer}</Badge></td>
                      <td className="px-[18px] py-3 font-mono text-ink-2">{e.expected}</td>
                      <td className="px-[18px] py-3 font-mono">{e.actual}</td>
                      <td className="px-[18px] py-3"><Badge tone={e.passed ? 'good' : 'crit'}>{e.passed ? 'Passed' : 'Failed'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CardBody className="py-12 text-center">
              <div className="text-[15px] font-semibold mb-1">No evidence on file</div>
              <p className="text-[13px] text-ink-3 mb-4">
                This service has never been proven end to end. Configuration may read back correctly while no customer traffic has ever been tested.
              </p>
              <Button variant="primary" onClick={() => reprove(svc.id)}><RefreshCcw size={15} />Re-prove now</Button>
            </CardBody>
          )}
        </Card>
      )}

      {tab === 'lifecycle' && (
        <Card>
          <CardHead
            title="Lifecycle"
            sub="Built, then every change since — oldest first, with the runs that carried each one out"
            info="The audit trail for the service rather than for one request: who asked for what, who cleared it, when it reached the devices and what came back. Change history sits alongside this and records what changed on the device — including changes made outside the platform, which have no request behind them."
          />
          <CardBody>
            {lifecycle.length === 0 ? (
              <div className="py-12 text-center">
                <div className="text-[15px] font-semibold mb-1">No requests on record</div>
                <p className="text-ink-3 text-[13px] max-w-[440px] mx-auto leading-relaxed">
                  This service was already carrying traffic when the platform was deployed, so nothing
                  here raised it. Changes made to it since are on the Change history tab.
                </p>
              </div>
            ) : (<>
              {/* The shape of the whole life in one line, before any of the
                  detail. Scanning six stacked cards to work out that a service
                  was built once and changed twice is work the eye should not
                  have to do — and this is the view someone opens precisely to
                  ask "what has happened to this thing". */}
              <div className="vw-scroll-hint overflow-x-auto pb-2 mb-5">
                <ol className="flex items-start m-0 p-0 list-none min-w-max">
                  {lifecycle.map(({ order: o, runs }, i) => {
                    const { icon: Icon, dot } = JOURNEY[o.intent]
                    /* Judged on the last attempt per endpoint, not on every run
                       ever made. A change that failed once and succeeded on
                       retry landed — reporting it as "2 of 4 accepted" would
                       mark a service that is correctly configured as half
                       broken. The retry is worth saying, so it is said. */
                    const latest = new Map<string, Run>()
                    runs.forEach((r) => {
                      const key = r.endpointId ?? '-'
                      const cur = latest.get(key)
                      if (!cur || r.attempt > cur.attempt) latest.set(key, r)
                    })
                    const final = [...latest.values()]
                    const retried = runs.length > final.length
                    const outcome = runs.length === 0
                      ? (o.archived ? 'log not retained' : 'not executed')
                      : final.some((r) => r.outcome === 'Running') ? 'running now'
                        : final.every((r) => r.outcome === 'Accepted') ? (retried ? 'accepted on retry' : 'accepted')
                          : 'failed'
                    return (
                      <li key={o.id} className="flex items-start">
                        {i > 0 && <span aria-hidden className="w-10 h-px bg-line mt-6 shrink-0" />}
                        <button
                          type="button" onClick={() => setFocus(focus === o.id ? null : o.id)}
                          aria-pressed={focus === o.id}
                          className={`flex flex-col items-center gap-1.5 w-[132px] shrink-0 px-2 py-2 rounded-[var(--vw-radius-sm)] bg-transparent border-0 cursor-pointer
                            hover:bg-plane ${focus === o.id ? 'bg-plane ring-1 ring-brand-500' : ''}`}
                        >
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 ${dot}`}>
                            <Icon size={16} />
                          </span>
                          <span className="vw-value font-medium leading-tight">{o.intent}</span>
                          <span className="text-[12px] text-ink-3 leading-tight">{shortDate(o.updatedAt)}</span>
                          <span className="text-[11px] text-ink-3 leading-tight text-center">{outcome}</span>
                        </button>
                      </li>
                    )
                  })}
                  {/* Where it stands now. Without it the line reads as though
                      the last request is the end of the story rather than the
                      state it left the service in. */}
                  <li className="flex items-start">
                    <span aria-hidden className="w-10 h-px bg-line mt-6 shrink-0" />
                    <div className="flex flex-col items-center gap-1.5 w-[132px] shrink-0 px-2 py-2">
                      <span className="w-8 h-8 rounded-full border-2 border-dashed border-line flex items-center justify-center shrink-0">
                        <span className={`w-2.5 h-2.5 rounded-full ${svc.state === 'Live' ? 'bg-good-500' : svc.state === 'Ceased' || svc.state === 'Purged' ? 'bg-crit-500' : 'bg-warn-500'}`} />
                      </span>
                      <span className="vw-value font-medium leading-tight">Today</span>
                      <span className="text-[12px] text-ink-3 leading-tight">{svc.state}</span>
                      <span className="text-[11px] text-ink-3 leading-tight text-center">{svc.conformance.toLowerCase()}</span>
                    </div>
                  </li>
                </ol>
              </div>

              <ol className="m-0 p-0 list-none flex flex-col">
                {lifecycle.map(({ order: o, runs }, i) => {
                  const cleared = o.approvals.find((a) => a.decision)
                  const last = i === lifecycle.length - 1
                  return (
                    /* Padding, not margin, so the rail below can reach into the
                       gap — a margin would collapse out of the item's box and
                       leave the line stopping at each card. */
                    <li key={o.id} className={`relative pl-7 ${last ? '' : 'pb-3'}`}>
                      {/* The rail stops at the last entry so it reads as a
                          beginning — the create — not as a trail running off. */}
                      {!last && <span aria-hidden className="absolute left-[6px] top-4 bottom-0 w-px bg-line" />}
                      <span aria-hidden className={`absolute left-0 top-[7px] w-[13px] h-[13px] rounded-full border-[3px] border-white
                        ${o.intent === 'Create' ? 'bg-brand-500' : o.intent === 'Cease' ? 'bg-crit-500' : 'bg-plum-500'}`}
                      />
                      <div className={`vw-card-section bg-plane p-3.5 transition-shadow ${focus === o.id ? 'ring-2 ring-brand-500' : ''}`}>
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <Badge tone={INTENT_TONE[o.intent]}>{o.intent}</Badge>
                          <Link to={`/requests/${o.id}`} className="text-brand-600 hover:underline"><Mono>{o.id}</Mono></Link>
                          <Mono className="text-ink-3 text-[12px]">{o.code}</Mono>
                          <span className="ml-auto"><Badge tone={ORDER_TONE[o.state]} dot>{o.state}</Badge></span>
                        </div>
                        <div className="vw-value font-medium mb-1">
                          {o.delta?.length
                            ? o.delta.map((d) => `${d.attribute} ${d.current} → ${d.requested}`).join(' · ')
                            : o.intent === 'Create' ? 'Initial provisioning — service went live' : `${o.intent} requested`}
                        </div>
                        <div className="text-[12px] text-ink-3 leading-relaxed">
                          Raised {dateTime(o.createdAt)}{o.owner ? ` by ${o.owner}` : ''}
                          {cleared?.at && <> · {cleared.decision} by {cleared.by} {dateTime(cleared.at)}</>}
                          {' · '}closed {dateTime(o.updatedAt)} ({relTime(o.updatedAt)})
                        </div>

                        {runs.length > 0 ? (
                          <div className="mt-2.5 pt-2.5 border-t border-line-soft flex flex-col gap-1.5">
                            {runs.map((r) => {
                              const ep = o.endpoints.find((e) => e.id === r.endpointId)
                              return (
                                <div key={r.id} className="flex items-center gap-2 flex-wrap text-[12px]">
                                  <Badge tone={RUN_TONE[r.outcome]} dot>{r.outcome}</Badge>
                                  <span className="text-ink-2">
                                    {ep ? `${endpointRole(ep)} · ` : ''}<Mono>{ep?.mgmtIp ?? 'device'}</Mono>
                                  </span>
                                  <span className="text-ink-3">attempt {r.attempt}</span>
                                  <span className="text-ink-3">{dateTime(r.startedAt)}</span>
                                  <span className="text-ink-3 font-mono">{dur(r.durationMs)}</span>
                                  <span className="text-ink-3">
                                    {r.tasks.filter((t) => t.state === 'Passed').length} of {r.tasks.length} tasks passed
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          /* Not a gap — the request is kept for the life of the
                             service, the device transcript behind it is not. */
                          <div className="mt-2.5 pt-2.5 border-t border-line-soft text-[12px] text-ink-3">
                            {o.archived
                              ? `Execution log not retained — per-task device logs are kept for ${RUN_LOG_RETENTION_DAYS} days.`
                              : 'Not executed yet.'}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </>)}
          </CardBody>
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          <CardHead title="Change history" sub="Every change to this service, with or without an order behind it" />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr>
                {['When', 'Order', 'Change', 'By'].map((h) => (
                  <th key={h} scope="col" className="text-left px-[18px] py-3 border-b border-line text-[12px] font-medium text-ink-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {svc.history.map((h, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-0">
                    <td className="px-[18px] py-3 whitespace-nowrap">{shortDate(h.at)}</td>
                    {/* An id here always resolves to a request in the system —
                        anything the platform can't account for carries no id
                        rather than a dead one, which is what a change made
                        before this platform, or straight on the device, is. */}
                    <td className="px-[18px] py-3">
                      {h.orderId
                        ? <Link to={`/requests/${h.orderId}`} className="text-brand-600 hover:underline"><Mono>{h.orderId}</Mono></Link>
                        : <span className="text-ink-3">none</span>}
                    </td>
                    <td className="px-[18px] py-3">
                      {h.change}
                      {h.outOfBand && <Badge tone="warn" className="ml-2">out of band</Badge>}
                    </td>
                    <td className="px-[18px] py-3">{h.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'resources' && (
        <Card>
          <CardHead title="Resources held" sub="Released to quarantine when the service is ceased"
            right={<Button size="sm" onClick={() => nav('/pools')}>Open pools</Button>} />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr>
                {['Resource', 'Value', 'Pool', 'State'].map((h) => (
                  <th key={h} scope="col" className="text-left px-[18px] py-3 border-b border-line text-[12px] font-medium text-ink-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {svc.resources.map((r, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-0">
                    <td className="px-[18px] py-3 font-medium">{r.kind}</td>
                    <td className="px-[18px] py-3 font-mono">{r.value}</td>
                    <td className="px-[18px] py-3 text-ink-3">{r.pool}</td>
                    <td className="px-[18px] py-3"><Badge tone={r.state === 'Allocated' ? 'good' : r.state === 'Quarantined' ? 'warn' : 'none'}>{r.state}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody className="pt-4">
            <Note tone="warn">Route targets and IP blocks go to <b>quarantine</b> on cease, not straight back to the pool. Reissuing a route target that a peer still advertises leaks one customer's routes into another customer's VRF.</Note>
          </CardBody>
        </Card>
      )}

      <ModifyServiceDrawer service={modifyOpen ? svc : null} onClose={() => setModifyOpen(false)} />
      <CeaseServiceModal service={ceaseOpen ? svc : null} onClose={() => setCeaseOpen(false)} />
    </>
  )
}

