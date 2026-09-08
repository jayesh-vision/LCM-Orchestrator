import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryState } from '@/lib/useQueryState'
import { CheckCircle2, Eye, Plus, Server, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Order, OrderIntent } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellMain, CellSub, Chip, DataTable,
  Field, Kebab, Modal, Mono, Note, Select, Stat, type Column,
} from '@/components/ui'
import { INTENT_TONE, ORDER_TONE, relTime } from '@/lib/format'

const INTENTS: OrderIntent[] = ['Modify', 'Suspend', 'Resume', 'Cease', 'Re-prove']

const IMPACT: Record<string, { bounce: boolean; reconverge: boolean; note: string }> = {
  Modify: { bounce: false, reconverge: false, note: 'Policer rebind is hitless on this platform. Uplink headroom is checked before approval.' },
  Suspend: { bounce: true, reconverge: false, note: 'Total loss of service, intended. Configuration is retained so a resume restores the prior revision.' },
  Resume: { bounce: true, reconverge: false, note: 'Restores the revision captured at suspend time.' },
  Cease: { bounce: true, reconverge: true, note: 'Total and final. Resources move to quarantine, not straight back to the pool.' },
  'Re-prove': { bounce: false, reconverge: false, note: 'Read-only. No configuration is written.' },
}

export default function ChangeCease() {
  const orders = useStore((s) => s.orders)
  const services = useStore((s) => s.services)
  const raiseChange = useStore((s) => s.raiseChange)
  const approve = useStore((s) => s.approveOrder)
  const reject = useStore((s) => s.rejectOrder)
  const nav = useNavigate()

  const [intent, setIntent] = useQueryState<OrderIntent | 'All'>('intent', 'All')
  const [cstate, setCstate] = useQueryState('state', 'All')
  const [q, setQ] = useQueryState('q', '')
  const pushToast = useStore((st) => st.pushToast)
  const [open, setOpen] = useState(false)
  const [newIntent, setNewIntent] = useState<OrderIntent>('Modify')
  const [serviceId, setServiceId] = useState('')

  const changes = useMemo(() => orders.filter((o) => o.intent !== 'Create'), [orders])
  const filtered = useMemo(() => changes.filter((o) => {
    if (intent !== 'All' && o.intent !== intent) return false
    if (cstate !== 'All' && o.state !== cstate) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(o.name.toLowerCase().includes(t) || o.accountName.toLowerCase().includes(t) || o.id.toLowerCase().includes(t) || (o.serviceId ?? '').toLowerCase().includes(t))) return false
    }
    return true
  }), [changes, intent, cstate, q])
  const liveServices = useMemo(() => services.filter((s) => s.state === 'Live' || s.state === 'Suspended').slice(0, 60), [services])
  const n = (i: OrderIntent) => changes.filter((o) => o.intent === i).length

  const columns: Column<Order>[] = [
    {
      key: 'order', header: 'Order', width: '170px', sortValue: (r) => r.id,
      render: (r) => (<><CellMain><Mono>{r.id}</Mono></CellMain><CellSub>{relTime(r.createdAt)}</CellSub></>),
    },
    {
      key: 'intent', header: 'Intent', width: '112px', sortValue: (r) => r.intent,
      render: (r) => <Badge tone={INTENT_TONE[r.intent]}>{r.intent}</Badge>,
    },
    {
      key: 'service', header: 'Service', width: '210px', sortValue: (r) => r.serviceId ?? '',
      render: (r) => (r.serviceId
        ? (<><CellMain><Mono>{r.serviceId}</Mono></CellMain><CellSub>{r.name}</CellSub></>)
        : <span className="text-ink-3">no service bound</span>),
    },
    { key: 'acct', header: 'Customer', width: '180px', sortValue: (r) => r.accountName, render: (r) => r.accountName },
    {
      key: 'delta', header: 'Change', width: '230px',
      render: (r) => (r.delta?.length
        ? (<>{r.delta.slice(0, 2).map((d) => (
          <div key={d.attribute} className="text-[12px]">
            <span className="text-ink-3">{d.attribute}:</span>{' '}
            <Mono className="text-ink-3">{d.current}</Mono> → <Mono className="font-semibold">{d.requested}</Mono>
          </div>
        ))}</>)
        : <span className="text-ink-3">no attribute change</span>),
    },
    {
      key: 'impact', header: 'Traffic impact', width: '140px',
      render: (r) => {
        const im = IMPACT[r.intent]
        return im?.bounce ? <Badge tone="crit">Interrupts service</Badge> : <Badge tone="good">Hitless</Badge>
      },
    },
    { key: 'state', header: 'Status', width: '160px', sortValue: (r) => r.state, render: (r) => <Badge tone={ORDER_TONE[r.state]} dot>{r.state}</Badge> },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/execution/${r.id}`) },
          ...(r.serviceId ? [{ label: 'Open service', icon: Server, onClick: () => nav(`/inventory/${r.serviceId}`) }] : []),
          ...(r.state === 'Awaiting approval' || r.state === 'Designed'
            ? [{ label: 'Approve', icon: CheckCircle2, onClick: () => approve(r.id, 'Ravi K.') },
              { label: 'Reject', icon: XCircle, onClick: () => reject(r.id, 'Ravi K.', 'Rejected from Change & Cease.'), danger: true }]
            : []),
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Open modify orders" value={n('Modify')} accent="var(--vw-color-purple-600)"
          note="Delta only — the renderer emits just the lines the change implies"
          drillLabel="modify orders" onClick={() => setIntent('Modify')} />
        <Stat label="Suspend & resume" value={n('Suspend') + n('Resume')} accent="var(--vw-color-amber-500)" note="Billing-driven"
          drillLabel="suspend orders" onClick={() => setIntent('Suspend')} />
        <Stat label="Cease orders" value={n('Cease')} accent="var(--vw-color-red-600)" note="Resources quarantined for 30 days"
          drillLabel="cease orders" onClick={() => setIntent('Cease')} />
        <Stat label="Next change window" value="01:00" accent="var(--vw-color-emerald-600)"
          note="Tonight, IST · traffic-affecting changes only run inside a window"
          drillLabel="the execution queue waiting on a window" onClick={() => nav('/execution?state=Approved,Queued')} />
      </div>

      <Card>
        <CardHead title="Lifecycle operations available after Create"
          sub="One order carries exactly one intent against exactly one service" />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr>
              {['Intent', 'Produces', 'Configuration written', 'Traffic impact', 'Approval', 'Open'].map((h) => (
                <th key={h} scope="col" className="text-left px-[18px] py-3 border-b border-line text-[12px] font-medium text-ink-3">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {([
                ['Create', 'A new service instance', 'Full render', false, 'NOC lead', orders.filter((o) => o.intent === 'Create').length],
                ['Modify', 'A new revision of the same service', 'Delta only', false, 'NOC lead if traffic-affecting', n('Modify')],
                ['Suspend', 'Same service, Suspended', 'Policer to zero', true, 'Billing + NOC lead', n('Suspend')],
                ['Resume', 'Same service, Live', 'Restore prior revision', true, 'Billing', n('Resume')],
                ['Cease', 'Ceased, then Purged at day 90', 'Full removal + pool release', true, 'NOC lead + account owner', n('Cease')],
                ['Re-prove', 'Fresh evidence, no state change', 'None — read only', false, 'Not required', n('Re-prove')],
              ] as [OrderIntent, string, string, boolean, string, number][]).map(([i, produces, cfg, bounce, appr, count]) => (
                <tr key={i} className="border-b border-line-soft last:border-0">
                  <td className="px-[18px] py-3"><Badge tone={INTENT_TONE[i]}>{i}</Badge></td>
                  <td className="px-[18px] py-3">{produces}</td>
                  <td className="px-[18px] py-3 text-ink-3">{cfg}</td>
                  <td className="px-[18px] py-3">{bounce ? <Badge tone="crit">Interrupts service</Badge> : <Badge tone="good">Hitless</Badge>}</td>
                  <td className="px-[18px] py-3 text-ink-3">{appr}</td>
                  <td className="px-[18px] py-3 tnum font-semibold">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <DataTable
        rows={filtered} total={changes.length} columns={columns} pageSize={10}
        onRowClick={(r) => nav(`/execution/${r.id}`)}
        empty="No change orders yet. Raise one from a service, or with the button above."
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Service, Customer' },
          chips: INTENTS.filter((i) => n(i) > 0).map((i) => <Chip key={i} active={intent === i} count={n(i)} onClick={() => setIntent(intent === i ? 'All' : i)}>{i}</Chip>),
          filters: [
            { key: 'intent', label: 'Operation', value: intent, onChange: (v) => setIntent(v as OrderIntent | 'All'),
              options: INTENTS.filter((i) => n(i) > 0).map((i) => ({ value: i, label: i, count: n(i) })) },
            { key: 'state', label: 'Status', value: cstate, onChange: setCstate,
              options: [...new Set(changes.map((c) => c.state))].map((st) => ({ value: st, label: st, count: changes.filter((c) => c.state === st).length })) },
            { key: 'q', label: 'Service / Customer', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: () => { setIntent('All'); setCstate('All'); setQ('') },
          onRefresh: () => pushToast('info', 'Change orders refreshed.'),
          actions: [
            { label: 'Raise a change', icon: Plus, onClick: () => setOpen(true) },
          ],
        }}
      />

      <Card>
        <CardHead title="Cease completion checklist" sub="A cease is not complete when the commands return — it is complete when absence is proven" />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-5">
            {[
              ['1', 'Configuration removed', 'On every PE in the service'],
              ['2', 'Absence asserted', 'Removing and proving removal are different acts'],
              ['3', 'Resources quarantined', 'RD, RT, VRF name, IP block'],
              ['4', 'Discovery confirms', 'Day 7 · reopens the cease if it does not'],
              ['5', 'Billing stop-date', 'Written back, closes the order'],
            ].map(([n2, t, s]) => (
              <div key={n2} className="border border-line rounded-lg px-3.5 py-3">
                <div className="w-6 h-6 rounded-full bg-plane text-ink-3 grid place-items-center text-[11px] font-semibold mb-2">{n2}</div>
                <div className="text-[12.5px] font-medium leading-snug">{t}</div>
                <div className="text-[11.5px] text-ink-3 mt-1 leading-snug">{s}</div>
              </div>
            ))}
          </div>
          <Note tone="warn">
            A ceased service sits in <b>Ceased</b>, not Purged, for 90 days precisely so discovery has time to contradict it.
            If configuration is still found at day 7 the cease reopens as a failed cease with the residue itemised.
          </Note>
        </CardBody>
      </Card>

      <Modal
        open={open} onClose={() => setOpen(false)}
        title="Raise a change" sub="Against a live service"
        footer={
          <>
            <Button onClick={() => setOpen(false)}><XCircle size={15} />Cancel</Button>
            <Button
              variant="primary" disabled={!serviceId}
              onClick={() => {
                const svc = services.find((s) => s.id === serviceId)!
                raiseChange(serviceId, newIntent, newIntent === 'Modify'
                  ? [{ attribute: 'Bandwidth', current: `${svc.bandwidthMbps} Mbps`, requested: `${svc.bandwidthMbps * 2} Mbps` }]
                  : undefined)
                setOpen(false); setServiceId('')
              }}
            >
              <CheckCircle2 size={15} />Raise order
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Intent" required>
            <Select value={newIntent} onChange={(e) => setNewIntent(e.target.value as OrderIntent)}>
              {INTENTS.map((i) => <option key={i}>{i}</option>)}
            </Select>
          </Field>
          <Field label="Service" required hint="Only live and suspended services can carry a change order.">
            <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Choose a service…</option>
              {liveServices.map((s) => <option key={s.id} value={s.id}>{s.id} — {s.name} ({s.accountName})</option>)}
            </Select>
          </Field>
          <Note tone={IMPACT[newIntent].bounce ? 'warn' : 'good'}>
            <b>{IMPACT[newIntent].bounce ? 'Traffic-affecting.' : 'Hitless.'}</b> {IMPACT[newIntent].note}
          </Note>
        </div>
      </Modal>
    </>
  )
}
