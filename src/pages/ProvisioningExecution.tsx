import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { CheckCircle2, Download, Eye, ListChecks, PlayCircle, Plus, ShieldCheck, Workflow, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Order, OrderState } from '@/types'
import {
  Badge, Button, CellMain, CellSub, Chip, DataTable, Drawer, Field,
  FilterBanner, KV, Kebab, Modal, Mono, Note, Progress, type Column,
} from '@/components/ui'
import { CategoryCard } from '@/components/charts'
import { ageLabel, CATEGORY_TONE, clockTime, ORDER_TONE, relTime } from '@/lib/format'

const EXEC_STATES: OrderState[] = [
  'Designed', 'Awaiting approval', 'Approved', 'Queued', 'Executing', 'Activated', 'Failed', 'Rejected',
]
const CATEGORIES: Category[] = ['L2VPN', 'L3VPN', 'IBW']

export default function ProvisioningExecution() {
  const orders = useStore((s) => s.orders)
  const runsForOrder = useStore((s) => s.runsForOrder)
  const approveOrder = useStore((s) => s.approveOrder)
  const rejectOrder = useStore((s) => s.rejectOrder)
  const startRun = useStore((s) => s.startRun)
  const retryOrder = useStore((s) => s.retryOrder)
  const pushToast = useStore((s) => s.pushToast)
  const nav = useNavigate()

  const [q, setQ] = useQueryState('q', '')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [state, setState] = useQueryState<OrderState | 'All' | string>('state', 'All')
  const stateList = state === 'All' ? [] : state.split(',')
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'cat', 'state'])
  const resultsRef = useScrollToResultsOnDrillIn(cat !== 'All' || state !== 'All')
  const [verify, setVerify] = useState<Order | null>(null)
  const [reject, setReject] = useState<Order | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [creds, setCreds] = useState<Order | null>(null)

  /* Execution is the queue after design: drafts and unrouted records are not here. */
  const pool = useMemo(() => orders.filter((o) => !['Draft', 'Unrouted'].includes(o.state)), [orders])

  const filtered = useMemo(() => pool.filter((o) => {
    if (cat !== 'All' && o.category !== cat) return false
    if (stateList.length && !stateList.includes(o.state)) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(o.id.toLowerCase().includes(t) || o.name.toLowerCase().includes(t) || o.accountName.toLowerCase().includes(t))) return false
    }
    return true
  }), [pool, cat, state, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const n = (s: OrderState) => pool.filter((o) => o.state === s).length

  const doApprove = (o: Order) => { approveOrder(o.id, 'Ravi K.'); setVerify(null); setCreds(o) }
  const runCredentialsThenExecute = (o: Order) => { setCreds(null); startRun(o.id); nav(`/execution/${o.id}?tab=lifecycle`) }

  const columns: Column<Order>[] = [
    {
      key: 'order', header: 'Service', width: '180px', sortValue: (r) => r.id,
      render: (r) => (<><CellMain>{r.name}</CellMain><CellSub><Mono>{r.id}</Mono></CellSub></>),
    },
    { key: 'category', header: 'Category', width: '104px', sortValue: (r) => r.category, render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge> },
    {
      key: 'customer', header: 'Customer', width: '186px', sortValue: (r) => r.accountName,
      render: (r) => (<><CellMain>{r.accountName}</CellMain><CellSub><Mono>{r.accountId}</Mono></CellSub></>),
    },
    {
      key: 'workflow', header: 'Workflow', width: '150px',
      render: (r) => (r.workflowId ? <Mono className="text-ink-2">{r.workflowId}</Mono> : <span className="text-ink-3">not bound</span>),
    },
    {
      key: 'state', header: 'Status', width: '186px', sortValue: (r) => EXEC_STATES.indexOf(r.state),
      render: (r) => {
        const runs = runsForOrder(r.id)
        const live = runs.find((x) => x.outcome === 'Running')
        const done = live ? live.tasks.filter((t) => t.state === 'Passed').length : 0
        return (
          <>
            <Badge tone={ORDER_TONE[r.state]} dot>{r.state}</Badge>
            {live && (<><Progress value={(done / live.tasks.length) * 100} className="mt-2 w-28" />
              <CellSub>task {done + 1} of {live.tasks.length}</CellSub></>)}
            {r.state === 'Failed' && runs[0] && <CellSub>{runs[0].tasks.find((t) => t.state === 'Failed')?.name ?? 'see lifecycle log'}</CellSub>}
          </>
        )
      },
    },
    { key: 'runs', header: 'Runs', align: 'right', width: '70px', sortValue: (r) => new Set(runsForOrder(r.id).map((x) => x.attempt)).size, render: (r) => new Set(runsForOrder(r.id).map((x) => x.attempt)).size },
    { key: 'age', header: 'Age', align: 'right', width: '74px', sortValue: (r) => r.ageDays, render: (r) => ageLabel(r.ageDays) },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => setVerify(r) },
          { label: 'Life cycle operation', icon: Workflow, onClick: () => nav(`/execution/${r.id}?tab=lifecycle`) },
          { label: 'View jobs', icon: ListChecks, onClick: () => nav(`/execution/${r.id}?tab=runs`) },
          ...(r.state === 'Designed' || r.state === 'Awaiting approval'
            ? [{ label: 'Approve', icon: CheckCircle2, onClick: () => doApprove(r) },
              { label: 'Reject', icon: XCircle, onClick: () => { setReject(r); setRejectNote('') }, danger: true }]
            : []),
          ...(r.state === 'Approved' || r.state === 'Queued' ? [{ label: 'Validate credentials & execute', icon: ShieldCheck, onClick: () => setCreds(r) }] : []),
          ...(r.state === 'Failed' ? [{ label: 'Retry', icon: PlayCircle, onClick: () => retryOrder(r.id) }] : []),
        ]} />
      ),
    },
  ]

  return (
    <>

      <FilterBanner
        count={filtered.length} noun="requests" onClear={clear}
        filters={[
          ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
          ...(state !== 'All' ? [{ key: 'state', label: 'Status', value: stateList.join(' or '), onRemove: () => setState('All') }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />


      <div className="grid gap-4 lg:grid-cols-3">
        {CATEGORIES.map((c) => {
          const list = pool.filter((o) => o.category === c)
          const cnt = (st: OrderState) => list.filter((o) => o.state === st).length
          const seg = (label: string, value: number, fill: 'good' | 'brand' | 'none' | 'crit', states: string) =>
            ({ label, value, fill, onClick: () => patch({ cat: c, state: states }) })
          return (
            <CategoryCard
              key={c}
              chip={<Badge tone={CATEGORY_TONE[c]}>{c}</Badge>}
              total={list.length} noun="in execution"
              onOpen={() => patch({ cat: c, state: null })}
              segments={[
                seg('Activated', cnt('Activated'), 'good', 'Activated'),
                seg('In flight', cnt('Executing') + cnt('Queued') + cnt('Approved'), 'brand', 'Executing,Queued,Approved'),
                seg('Awaiting', cnt('Designed') + cnt('Awaiting approval'), 'none', 'Designed,Awaiting approval'),
                seg('Failed', cnt('Failed') + cnt('Rejected'), 'crit', 'Failed,Rejected'),
              ]}
            />
          )
        })}
      </div>

      <div ref={resultsRef} />
      <DataTable
        rows={filtered} total={pool.length} columns={columns} pageSize={12}
        onRowClick={(r) => nav(`/execution/${r.id}?tab=lifecycle`)}
        rowTone={(r) => (r.state === 'Failed' ? 'crit' : r.state === 'Rejected' ? 'warn' : undefined)}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Name, Code' },
          chips: CATEGORIES.map((c) => <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} count={pool.filter((o) => o.category === c).length} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>),
          filters: [
            { key: 'state', label: 'Status', value: state, onChange: (v) => setState(v),
              options: [
                ...EXEC_STATES.filter((st) => n(st) > 0).map((st) => ({ value: st, label: st, count: n(st) })),
                { value: 'Designed,Awaiting approval', label: 'Waiting for approval' },
                { value: 'Approved,Queued', label: 'Ready to run' },
              ] },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: CATEGORIES.map((c) => ({ value: c, label: c, count: pool.filter((o) => o.category === c).length })) },
            { key: 'q', label: 'Name / Code', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: clear,
          onRefresh: () => pushToast('info', 'Execution queue refreshed.'),
          actions: [{ label: 'New network service', icon: Plus, onClick: () => nav('/requests/new') }, { label: 'Export to CSV', icon: Download, onClick: () => pushToast('info', 'Export queued — the file will appear in Reports.') }],
        }}
      />

      {/* -------- verify details -------- */}
      <Drawer
        open={!!verify} onClose={() => setVerify(null)}
        title={verify ? `Verify details · ${verify.id}` : ''}
        sub={verify ? `${verify.name} · ${verify.accountName}` : ''}
        width={660}
        footer={verify && (
          <>
            <Button variant="danger" onClick={() => { setReject(verify); setRejectNote(''); setVerify(null) }}>
              <XCircle size={15} />Reject
            </Button>
            <Button variant="primary" onClick={() => doApprove(verify)}><CheckCircle2 size={15} />Approve</Button>
          </>
        )}
      >
        {verify && (
          <div className="flex flex-col gap-5">
            <Note>Every parameter below was populated during service creation. Approving moves the request to <b>Approved</b>; credentials are validated before execution starts.</Note>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Request</div>
              <KV items={[
                ['Order', <Mono key="o">{verify.id}</Mono>],
                ['Code', <Mono key="c">{verify.code}</Mono>],
                ['Category / type', `${verify.category} · ${verify.type} · ${verify.subtype}`],
                ['Customer', `${verify.accountName} (${verify.accountId})`],
                ['Workflow', <Mono key="w">{verify.workflowId ?? 'not bound'}</Mono>],
                ['Created', relTime(verify.createdAt)],
              ]} />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Endpoints</div>
              <div className="flex flex-col gap-2">
                {verify.endpoints.map((e) => (
                  <div key={e.id} className="border border-line rounded-lg px-3.5 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[12.5px] font-medium">{e.siteCode} <span className="text-ink-3 font-normal">· {e.deviceName}</span></div>
                      <div className="text-[11.5px] text-ink-3 font-mono">{e.port} · {e.mgmtIp}</div>
                    </div>
                    <Badge tone="none">{e.role}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Parameters</div>
              <table className="w-full text-[12.5px] border border-line rounded-lg overflow-hidden">
                <thead><tr className="bg-plane">
                  <th scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Name</th>
                  <th scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Value</th>
                  <th scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">Source</th>
                </tr></thead>
                <tbody>
                  {verify.params.map((p) => (
                    <tr key={p.name} className="border-t border-line-soft">
                      <td className="px-3.5 py-2 font-mono">{p.name}</td>
                      <td className="px-3.5 py-2 font-mono font-medium">{p.value}</td>
                      <td className="px-3.5 py-2">
                        <Badge tone={p.source === 'pool' ? 'info' : p.source === 'user' ? 'none' : 'teal'}>{p.source}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Drawer>

      {/* -------- reject -------- */}
      <Modal
        open={!!reject} onClose={() => setReject(null)}
        title="Reject request" sub={reject?.id}
        footer={
          <>
            <Button onClick={() => setReject(null)}>Cancel</Button>
            <Button variant="danger" disabled={!rejectNote.trim()}
              onClick={() => { if (reject) rejectOrder(reject.id, 'Ravi K.', rejectNote); setReject(null) }}>
              Reject request
            </Button>
          </>
        }
      >
        <Field label="Reason" required hint="Recorded on the approval trail and shown to the requester.">
          <textarea
            value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={4}
            placeholder="Uplink headroom insufficient at the A-end…"
            className="w-full px-3 py-2.5 border border-line rounded-md text-[13px] outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 resize-y"
          />
        </Field>
      </Modal>

      {/* -------- credential validation -------- */}
      <Modal
        open={!!creds} onClose={() => setCreds(null)}
        title="Validate device credentials" sub={creds ? `${creds.id} · ${creds.endpoints.length} endpoint(s)` : ''}
        footer={
          <>
            <Button onClick={() => setCreds(null)}>Later</Button>
            <Button variant="primary" onClick={() => creds && runCredentialsThenExecute(creds)}>
              <PlayCircle size={15} />Execute workflow
            </Button>
          </>
        }
      >
        {creds && (
          <div className="flex flex-col gap-3">
            {creds.endpoints.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 border border-line rounded-lg px-3.5 py-3">
                <div>
                  <div className="text-[13px] font-medium">{e.siteCode}</div>
                  <div className="text-[11.5px] text-ink-3 font-mono">{e.mgmtIp} · ssh · profile NST-EDGE</div>
                </div>
                <Badge tone="good" dot><ShieldCheck size={12} className="mr-0.5" />Reachable</Badge>
              </div>
            ))}
            <Note>Credentials are checked immediately before execution, not at design time — a profile that worked yesterday can be rotated overnight. Validated at {clockTime(new Date().toISOString())} IST.</Note>
          </div>
        )}
      </Modal>
    </>
  )
}
