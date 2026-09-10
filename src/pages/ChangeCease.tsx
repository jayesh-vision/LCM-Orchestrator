import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryState } from '@/lib/useQueryState'
import { CalendarClock, CheckCircle2, CircleOff, Eye, PauseCircle, Pencil, Plus, Server, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Order, OrderIntent, Service } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellMain, CellSub, Chip, DataTable,
  Field, Kebab, Modal, Mono, Note, Select, Stat, stampColumn, type Column,
} from '@/components/ui'
import { INTENT_TONE, ORDER_TONE, relTime } from '@/lib/format'
import { CeaseServiceModal, ModifyServiceDrawer } from '@/components/ServiceChangeDialogs'

const INTENTS: OrderIntent[] = ['Modify', 'Suspend', 'Resume', 'Cease', 'Re-prove']

const IMPACT: Record<string, { bounce: boolean; reconverge: boolean; note: string }> = {
  Modify: { bounce: false, reconverge: false, note: 'Policer rebind is hitless on this platform. Uplink headroom is checked before approval.' },
  Suspend: { bounce: true, reconverge: false, note: 'Total loss of service, intended. Configuration is retained so a resume restores the prior revision.' },
  Resume: { bounce: true, reconverge: false, note: 'Restores the revision captured at suspend time.' },
  Cease: { bounce: true, reconverge: true, note: 'Total and final. Resources move to quarantine, not straight back to the pool.' },
  'Re-prove': { bounce: false, reconverge: false, note: 'Read-only. No configuration is written.' },
}

export default function ChangeCease() {
  const orders = useStore((s) => s.orders).filter((o) => !o.archived)
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
  const [modifyTarget, setModifyTarget] = useState<Service | null>(null)
  const [ceaseTarget, setCeaseTarget] = useState<Service | null>(null)

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
    stampColumn<Order>((r) => r.createdAt, (r) => r.updatedAt),
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/execution/${r.id}`) },
          ...(r.serviceId ? [{ label: 'Open service', icon: Server, onClick: () => nav(`/inventory/${r.serviceId}`) }] : []),
          ...(r.state === 'Validated'
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
        <Stat label="Open modify orders" icon={Pencil} value={n('Modify')}
          note="Delta only — the renderer emits just the lines the change implies"
          info="Orders that change an attribute of an existing live service, such as bandwidth. Only the delta is written to the device, and the change is hitless on this platform."
          drillLabel="modify orders" onClick={() => setIntent('Modify')} />
        <Stat label="Suspend & resume" icon={PauseCircle} value={n('Suspend') + n('Resume')} tone="warn"
          note="Billing-driven · configuration retained for resume"
          info="Billing-driven stops and restarts. A suspend zeroes the policer but keeps the configuration, so a later resume restores exactly the revision that was live. Both interrupt service."
          drillLabel="suspend orders" onClick={() => setIntent('Suspend')} />
        <Stat label="Cease orders" icon={CircleOff} value={n('Cease')} tone="crit" note="Resources quarantined for 30 days"
          info="Permanent decommissions. Configuration is fully removed, absence is proven, and the service's resources move to quarantine — not straight back to the pool — so nothing stale can leak."
          drillLabel="cease orders" onClick={() => setIntent('Cease')} />
        <Stat label="Next change window" icon={CalendarClock} value="01:00" tone="good"
          note="Tonight, IST · traffic-affecting changes only run inside a window"
          info="Traffic-affecting changes (suspend, resume, cease) only execute inside the nightly maintenance window. Approved orders queue until it opens; hitless changes run any time."
          drillLabel="the execution queue waiting on a window" onClick={() => nav('/execution?state=Approved,Queued')} />
      </div>

      <DataTable
        rows={filtered} total={changes.length} columns={columns} pageSize={10}
        onRowClick={(r) => nav(`/execution/${r.id}`)}
        empty="No change orders yet. Raise one from a service, or with the button above."
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Service, Customer' },
          chips: INTENTS.filter((i) => n(i) > 0).map((i) => <Chip key={i} active={intent === i} onClick={() => setIntent(intent === i ? 'All' : i)}>{i}</Chip>),
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
        <CardHead title="Cease completion checklist" sub="A cease is not complete when the commands return — it is complete when absence is proven"
          info="The five gates every cease must pass before it closes. Removing configuration and proving it is gone are different acts — discovery re-checks at day 7 and reopens the cease if residue is found, and billing only stops once the whole chain completes." />
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
                <div className="w-6 h-6 rounded-full bg-brand-50 text-brand-600 grid place-items-center text-[11px] font-semibold mb-2">{n2}</div>
                <div className="text-[12.5px] font-medium leading-snug">{t}</div>
                <div className="text-[11.5px] text-ink-3 mt-1 leading-snug">{s}</div>
              </div>
            ))}
          </div>
          <Note tone="warn" className="mt-4">
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
                setOpen(false); setServiceId('')
                /* Modify and Cease open their own enter-details / confirm dialog
                   rather than raising the order straight from this picker. */
                if (newIntent === 'Modify') { setModifyTarget(svc); return }
                if (newIntent === 'Cease') { setCeaseTarget(svc); return }
                raiseChange(serviceId, newIntent)
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

      <ModifyServiceDrawer service={modifyTarget} onClose={() => setModifyTarget(null)} />
      <CeaseServiceModal service={ceaseTarget} onClose={() => setCeaseTarget(null)} />
    </>
  )
}
