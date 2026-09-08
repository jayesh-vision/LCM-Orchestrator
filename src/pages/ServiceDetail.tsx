import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, PauseCircle, PlayCircle, RefreshCcw, Trash2 } from 'lucide-react'
import { useStore } from '@/store/useStore'
import {
  Badge, Button, Card, CardBody, CardHead, KV, Mono, Note, Tabs,
} from '@/components/ui'
import { CATEGORY_TONE, CONFORMANCE_TONE, inr, relTime, SERVICE_TONE, shortDate } from '@/lib/format'

type Tab = 'overview' | 'realised' | 'evidence' | 'history' | 'resources'

export default function ServiceDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const svc = useStore((s) => s.services.find((x) => x.id === id))
  const allOrders = useStore((s) => s.orders)
  const raiseChange = useStore((s) => s.raiseChange)
  const reprove = useStore((s) => s.reproveService)
  const [tab, setTab] = useState<Tab>('overview')
  const orders = useMemo(() => allOrders.filter((o) => o.serviceId === id), [allOrders, id])

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
              </div>
              <p className="text-[13px] text-ink-2 m-0">
                <Mono className="font-semibold">{svc.id}</Mono> · {svc.accountName} <Mono className="text-ink-3">{svc.accountId}</Mono> ·
                {' '}live since {shortDate(svc.liveSince)} · {svc.history.length} changes on record
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button onClick={() => { raiseChange(svc.id, 'Modify', [{ attribute: 'Bandwidth', current: `${svc.bandwidthMbps} Mbps`, requested: `${svc.bandwidthMbps * 2} Mbps` }]); nav('/change') }}>Modify</Button>
              <Button onClick={() => { raiseChange(svc.id, svc.state === 'Suspended' ? 'Resume' : 'Suspend'); nav('/change') }}>
                {svc.state === 'Suspended' ? <><PlayCircle size={15} />Resume</> : <><PauseCircle size={15} />Suspend</>}
              </Button>
              <Button variant="danger" onClick={() => { raiseChange(svc.id, 'Cease'); nav('/change') }}><Trash2 size={15} />Cease</Button>
              <Button variant="primary" onClick={() => reprove(svc.id)}><RefreshCcw size={15} />Re-prove now</Button>
            </div>
          </div>
        </CardBody>
        <div className="px-5">
          <Tabs
            value={tab} onChange={(t) => setTab(t as Tab)}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'realised', label: 'Intent vs realised', count: svc.attributes.length },
              { id: 'evidence', label: 'Evidence' },
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
                ['Open orders', orders.length ? orders.map((o) => o.id).join(', ') : 'none'],
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
                  <tr key={a.name} className={`border-b border-line-soft last:border-0 ${a.verdict === 'Drift' ? 'bg-warn-50' : a.verdict === 'Absent' ? 'bg-crit-50' : ''}`}>
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
                  <tr key={i} className={`border-b border-line-soft last:border-0 ${h.outOfBand ? 'bg-warn-50' : ''}`}>
                    <td className="px-[18px] py-3 whitespace-nowrap">{shortDate(h.at)}</td>
                    <td className="px-[18px] py-3">{h.orderId ? <Mono>{h.orderId}</Mono> : <span className="text-ink-3">none</span>}</td>
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
    </>
  )
}

