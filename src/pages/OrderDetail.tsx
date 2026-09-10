import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, PlayCircle, RotateCcw, Square, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Endpoint, Run, RunTask, StageKind } from '@/types'
import { endpointRole } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellSub, CodeBlock, Drawer, KV,
  Mono, Note, Progress, Tabs, type Tone,
} from '@/components/ui'
import { CATEGORY_TONE, clockTime, dateTime, dur, ORDER_TONE, relTime, RUN_TONE, TASK_TONE, shortDate } from '@/lib/format'

/* Stage kind → chip tone, as the platform colours its stage nodes. */
const STAGE_KIND_TONE: Record<StageKind, Tone> = { 'Pre validation': 'teal', Configuration: 'info', 'Post validation': 'warn' }

/**
 * Why this particular attempt was made.
 *
 * Every run under one request shares the same reason for existing — that is
 * the request's intent, and it belongs on the card header, stated once. What
 * changes row to row is why the platform went back to the device: this was
 * the first try, or it was a retry, and a retry is only readable as an audit
 * record if it names what it was retrying after.
 */
function attemptReason(group: Run[], r: Run): string {
  if (r.attempt <= 1) return 'First attempt'
  const prev = group.find((x) => x.attempt === r.attempt - 1)
  return prev ? `Retry after ${prev.outcome.toLowerCase()}` : 'Retry'
}

/** The request's own reason, for the header above each endpoint's attempts. */
function requestReason(intent: string, delta?: { attribute: string; current: string; requested: string }[]): string {
  const why = intent === 'Create' ? 'Initial provisioning' : `${intent} request`
  if (!delta?.length) return why
  return `${why} · ${delta.map((d) => `${d.attribute} ${d.current} → ${d.requested}`).join(', ')}`
}

export default function OrderDetail() {
  const { id = '' } = useParams()
  const loc = useLocation()
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  /* Requests and Execution both route here; "Back" and tab switches should return
     to whichever grid this screen was opened from, not walk browser history.

     Going back has to land on the grid, and on the grid the way it was left.
     A bare path doesn't do that: Requests opens on Insights by default, so
     Back from a row dropped the user on the charts rather than the list they
     came from, and dropped their filters with it. The list passes its own
     query string across in navigation state when it opens a row, so Back
     replays that exact selection; anything that reaches this screen by some
     other route still gets `?view=listing`, because a row detail is only ever
     opened from a row. */
  const listBase = loc.pathname.startsWith('/execution') ? '/execution' : '/requests'
  const fromList = (loc.state as { fromList?: string } | null)?.fromList
  const listPath = `${listBase}${fromList || '?view=listing'}`
  const listLabel = listBase === '/execution' ? 'Provisioning Execution' : 'Provisioning Requests'
  const order = useStore((s) => s.orders.find((o) => o.id === id))
  const allRuns = useStore((s) => s.runs)
  const approveOrder = useStore((s) => s.approveOrder)
  const rejectOrder = useStore((s) => s.rejectOrder)
  const startRun = useStore((s) => s.startRun)
  const abortRun = useStore((s) => s.abortRun)
  const retryOrder = useStore((s) => s.retryOrder)

  const workflows = useStore((s) => s.workflows)

  /* Which end of the service is on screen. Drives the workflow, the parameters
     and the lifecycle tasks — each device has its own. */
  const endpoints: Endpoint[] = order?.endpoints ?? []
  const [epId, setEpId] = useState<string | null>(null)
  const ep = endpoints.find((e) => e.id === epId) ?? endpoints[0]
  const epWorkflow = workflows.find((w) => w.id === ep?.workflowId)

  const runs = useMemo(
    () => allRuns
      .filter((r) => r.orderId === id && (!ep || !r.endpointId || r.endpointId === ep.id))
      .sort((a, b) => b.attempt - a.attempt),
    [allRuns, id, ep],
  )

  /* Every run for this order, regardless of which endpoint card is selected —
     the Runs tab shows Source and Destination side by side, each grouped by
     role with its own attempt count, rather than only whichever endpoint is
     currently selected. */
  const allOrderRuns = useMemo(
    () => allRuns.filter((r) => r.orderId === id).sort((a, b) => b.attempt - a.attempt),
    [allRuns, id],
  )
  const runGroups = useMemo(() => {
    const groups: { role: 'Source' | 'Destination'; endpoint: Endpoint | undefined; runs: Run[] }[] = []
    ;(['Source', 'Destination'] as const).forEach((role) => {
      const roleEndpoints = endpoints.filter((e) => endpointRole(e) === role)
      if (roleEndpoints.length === 0) return
      roleEndpoints.forEach((e) => {
        const eRuns = allOrderRuns.filter((r) => r.endpointId === e.id)
        if (eRuns.length > 0) groups.push({ role, endpoint: e, runs: eRuns })
      })
    })
    /* Runs recorded with no endpointId (older/shared runs) still need a home. */
    const unassigned = allOrderRuns.filter((r) => !r.endpointId)
    if (unassigned.length > 0) groups.push({ role: 'Source', endpoint: undefined, runs: unassigned })
    return groups
  }, [allOrderRuns, endpoints])

  const tab = (sp.get('tab') ?? 'service') as 'service' | 'lifecycle' | 'runs'
  /* replace: true — switching tabs shouldn't push a browser-history entry, so
     the Back button (and the browser's own back button) never gets stuck
     cycling through tabs instead of leaving the screen. */
  const setTab = (t: string) => setSp({ tab: t === 'params' ? 'service' : t }, { replace: true })

  const [runIdx, setRunIdx] = useState(0)
  const [openStageIdx, setOpenStageIdx] = useState(0)
  const [taskDrawer, setTaskDrawer] = useState<RunTask | null>(null)

  const run: Run | undefined = runs[runIdx]

  /* The run's stages in the order its workflow defines them. */
  const stages = useMemo(() => {
    const out: { name: string; kind: StageKind; tasks: RunTask[] }[] = []
    run?.tasks.forEach((t) => {
      const last = out[out.length - 1]
      if (last && last.name === t.stage) last.tasks.push(t)
      else out.push({ name: t.stage, kind: t.stageKind, tasks: [t] })
    })
    return out
  }, [run])
  const openStage = stages[Math.min(openStageIdx, Math.max(0, stages.length - 1))]

  if (!order) {
    return (
      <Card><CardBody className="py-14 text-center">
        <div className="text-[16px] font-semibold mb-1">Request not found</div>
        <p className="text-ink-3 text-[13px] mb-4">{id} is not in the current dataset.</p>
        <Link to={listPath} className="text-brand-600 text-[13px] font-medium">Back to {listLabel}</Link>
      </CardBody></Card>
    )
  }

  const stageState = (list: RunTask[]): { tone: Tone; label: string; passed: number; total: number } => {
    const passed = list.filter((t) => t.state === 'Passed').length
    const failed = list.some((t) => t.state === 'Failed')
    const running = list.some((t) => t.state === 'Running')
    return {
      tone: failed ? 'crit' : running ? 'info' : passed === list.length && list.length > 0 ? 'good' : 'none',
      label: failed ? 'Failed' : running ? 'Running' : passed === list.length && list.length > 0 ? 'Complete' : 'Not started',
      passed, total: list.length,
    }
  }

  const canApprove = order.state === 'Validated'
  const canExecute = order.state === 'Approved'
  const isRunning = order.state === 'In progress'

  return (
    <>
      <Card>
        <CardBody className="pb-4">
          <button onClick={() => nav(listPath)} className="text-[12.5px] text-ink-3 hover:text-ink-1 flex items-center gap-1.5 mb-3">
            <ArrowLeft size={14} />Back to {listLabel}
          </button>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                <h1 className="text-[21px] font-semibold tracking-[-.4px] m-0">{order.name}</h1>
                <Badge tone={ORDER_TONE[order.state]} dot>{order.state}</Badge>
                <Badge tone={CATEGORY_TONE[order.category]}>{order.category}</Badge>
                <Badge tone="none">{order.type} · {order.subtype}</Badge>
              </div>
              <p className="text-[13px] text-ink-2 m-0">
                <Mono className="font-semibold">{order.id}</Mono> · code <Mono>{order.code}</Mono> ·
                {' '}{order.accountName} <Mono className="text-ink-3">{order.accountId}</Mono> ·
                {' '}created {relTime(order.createdAt)}
                {order.serviceId && <> · service <Link className="text-brand-600" to={`/inventory/${order.serviceId}`}><Mono>{order.serviceId}</Mono></Link></>}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {canApprove && (
                <>
                  <Button variant="danger" onClick={() => rejectOrder(order.id, 'Ravi K.', 'Rejected from the request detail screen.')}>
                    <XCircle size={15} />Reject
                  </Button>
                  <Button variant="primary" onClick={() => approveOrder(order.id, 'Ravi K.')}><CheckCircle2 size={15} />Approve</Button>
                </>
              )}
              {canExecute && (
                <Button variant="primary" onClick={() => { startRun(order.id); setTab('lifecycle'); setRunIdx(0) }}>
                  <PlayCircle size={15} />Execute workflow
                </Button>
              )}
              {isRunning && run && (
                <Button variant="danger" onClick={() => abortRun(run.id)}><Square size={14} />Abort &amp; roll back</Button>
              )}
              {order.state === 'Failed' && (
                <Button variant="primary" onClick={() => retryOrder(order.id)}><RotateCcw size={15} />Retry</Button>
              )}
            </div>
          </div>
        </CardBody>
        <div className="px-5">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'service', label: 'Network service' },
              { id: 'lifecycle', label: 'Lifecycle operation' },
              { id: 'runs', label: 'Runs', count: runs.length },
            ]}
          />
        </div>
      </Card>

      {/* Every attribute the requester actually asked to change, current vs
          requested — kept visible across tabs since not every attribute has
          a device command parameter to show up in below (MTU, for one, is
          not a modelled command placeholder for any vendor in this
          prototype), so this is the only place some of them are ever shown. */}
      {order.delta && order.delta.length > 0 && (
        <Card>
          <CardHead title="Requested change" sub={order.notes ? `Reason: ${order.notes}` : undefined} />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr>
                {['Attribute', 'Current', 'Requested'].map((h) => (
                  <th key={h} scope="col" className="text-left px-[18px] py-3 border-b border-line text-[12px] font-medium text-ink-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {order.delta.map((d) => (
                  <tr key={d.attribute} className="border-b border-line-soft last:border-0">
                    <td className="px-[18px] py-3 font-medium">{d.attribute}</td>
                    <td className="px-[18px] py-3 font-mono text-ink-3">{d.current}</td>
                    <td className="px-[18px] py-3 font-mono font-semibold text-brand-600">{d.requested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---------------- network service ---------------- */}
      {tab === 'service' && (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* endpoints: Source first, then every Destination */}
          <Card className="h-full">
            <CardBody className="vw-flex vw-flex-col vw-gap-md">
              {endpoints.length === 0 && <Note tone="warn">This request has no endpoints. It cannot be designed until at least one is chosen.</Note>}
              {(['Source', 'Destination'] as const).map((role) => {
                const list = endpoints.filter((e) => endpointRole(e) === role)
                if (list.length === 0) return null
                return (
                  <div key={role}>
                    <div className="vw-card-title-sm mb-2">{role === 'Source' ? 'Source' : list.length > 1 ? 'Destinations' : 'Destination'}</div>
                    <div className="vw-flex vw-flex-col vw-gap-sm">
                      {list.map((e) => {
                        const active = e.id === ep?.id
                        return (
                          <button
                            key={e.id} onClick={() => setEpId(e.id)} aria-pressed={active}
                            aria-label={`${role} ${e.mgmtIp}, ${e.siteCode}`}
                            className={`text-left rounded-[var(--vw-radius-sm)] border px-3.5 py-3 transition-colors
                              ${active ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200' : 'border-line hover:bg-plane'}`}
                          >
                            <span className="vw-flex vw-items-center vw-justify-between vw-gap-sm">
                              <Mono className={`text-[13px] ${active ? 'text-brand-700 font-medium' : ''}`}>{e.mgmtIp}</Mono>
                              <Badge tone="none">{e.role}</Badge>
                            </span>
                            <span className="vw-card-activity-value block mt-0.5">{e.siteCode} · {e.vendor} {e.deviceName} · {e.port}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <div className="vw-card-footer-divider">
                <div className="vw-card-title-sm mb-2">Approval trail</div>
                {order.approvals.map((a, i) => (
                  <div key={i} className="vw-flex vw-items-start vw-gap-sm mb-2 last:mb-0">
                    <span className={`vw-chip w-6 h-6 p-0 justify-center text-[11px] shrink-0
                      ${a.decision === 'Approved' ? 'vw-chip--success' : a.decision === 'Rejected' ? 'vw-chip--error' : 'vw-chip--neutral'}`}>
                      {a.decision === 'Approved' ? '✓' : a.decision === 'Rejected' ? '×' : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="vw-card-activity-label block">{a.role}</span>
                      <span className="vw-card-activity-value block">{a.decision ? `${a.decision} by ${a.by} · ${relTime(a.at)}` : 'Pending'}</span>
                      {a.comment && <span className="block text-[12px] text-crit-700 mt-0.5">{a.comment}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* the selected device: its workflow and the parameters it receives */}
          <Card className="h-full bg-plane">
            <CardBody>
              {ep ? (
                <div className="vw-card-section p-4">
                  <div className="vw-flex vw-items-center vw-gap-sm mb-3">
                    <Mono className="text-[15px] font-medium">{ep.mgmtIp}</Mono>
                    <Badge tone="info">{endpointRole(ep)}</Badge>
                    <span className="vw-label">{ep.siteCode} · {ep.vendor} {ep.deviceName}</span>
                  </div>
                  <div className="vw-label">Workflow name</div>
                  {epWorkflow ? (
                    <Link to={`/workflows/${epWorkflow.id}`} className="vw-value block hover:text-brand-600">
                      {epWorkflow.name} - V {epWorkflow.version}
                    </Link>
                  ) : <span className="vw-value block text-ink-3">Not bound yet — assigned at design</span>}

                  <div className="vw-card-footer-divider">
                    <div className="vw-card-title-sm mb-2">Parameters</div>
                    <table className="nst-table border-0 rounded-none">
                      <thead><tr><th scope="col">Parameter name</th><th scope="col">Parameter value</th></tr></thead>
                      <tbody>
                        {(ep.params ?? []).map((p) => (
                          <tr key={p.name}>
                            <td className="nst-table-td--primary">{p.name}</td>
                            <td className="nst-table-td--primary truncate max-w-[520px]">{p.value}</td>
                          </tr>
                        ))}
                        {(ep.params ?? []).length === 0 && <tr><td colSpan={2} className="py-8 text-center text-ink-3">No parameters for this device yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="py-14 text-center vw-card-description">Pick an endpoint to see its workflow and parameters.</div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ---------------- lifecycle operation ---------------- */}
      {tab === 'lifecycle' && (
        run ? (
          <>
            <Card>
              <div className="px-4 pt-3.5 pb-1 vw-flex vw-items-center vw-wrap vw-gap-sm">
                <span className="vw-label mr-1">Device</span>
                {endpoints.map((e) => (
                  <button key={e.id} onClick={() => { setEpId(e.id); setRunIdx(0) }} aria-pressed={e.id === ep?.id}
                    className={`vw-chip is-clickable gap-1.5 ${e.id === ep?.id ? 'vw-chip--info-solid is-strong' : 'vw-chip--neutral hover:brightness-95'}`}>
                    {endpointRole(e)} · <Mono className="text-[12px]">{e.mgmtIp}</Mono>
                  </button>
                ))}
                {epWorkflow && <span className="vw-label ml-auto truncate">{epWorkflow.name} - V {epWorkflow.version}</span>}
              </div>
              <CardHead
                title={`Run ${run.attempt} · ${run.workflowId}`}
                sub={`${attemptReason(runs, run)} · started ${dateTime(run.startedAt)} (${relTime(run.startedAt)})`
                  + `${run.endedAt ? `, ended ${clockTime(run.endedAt)}` : ''}`
                  + ` · orchestrator clock ${clockTime(run.orchestratorClock)} · device clock ${clockTime(run.deviceClock)} · skew ${(run.clockSkewMs / 1000).toFixed(1)} s`}
                right={
                  <>
                    <Badge tone={RUN_TONE[run.outcome]} dot>{run.outcome}</Badge>
                    {runs.length > 1 && (
                      <select
                        value={runIdx}
                        onChange={(e) => setRunIdx(Number(e.target.value))}
                        className="h-[30px] px-2.5 border border-line rounded-md text-[12.5px] bg-white"
                      >
                        {runs.map((r, i) => <option key={r.id} value={i}>Run {r.attempt} · {r.outcome}</option>)}
                      </select>
                    )}
                  </>
                }
              />
              <CardBody>
                <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
                  {/* stages */}
                  <div className="flex flex-col gap-2">
                    {stages.map((s, i) => {
                      const st = stageState(s.tasks)
                      const active = openStage?.name === s.name
                      return (
                        <button
                          key={s.name}
                          onClick={() => setOpenStageIdx(i)}
                          className={`text-left border rounded-lg px-3.5 py-3 transition-colors
                            ${active ? 'border-brand-200 bg-brand-50' : 'border-line hover:bg-plane'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium">{s.name}</span>
                            <Badge tone={st.tone}>{st.passed}/{st.total}</Badge>
                          </div>
                          <div className="mt-1"><span className={`vw-chip vw-chip--${STAGE_KIND_TONE[s.kind] === 'teal' ? 'cyan' : STAGE_KIND_TONE[s.kind] === 'warn' ? 'warning' : 'info'} text-[11px]`}>{s.kind}</span></div>
                          <Progress
                            value={st.total ? (st.passed / st.total) * 100 : 0}
                            tone={st.tone === 'crit' ? 'crit' : st.tone === 'good' ? 'good' : 'brand'}
                            className="mt-2"
                          />
                        </button>
                      )
                    })}
                    <div className="h-px bg-line-soft my-2" />
                    <KV items={[
                      ['Duration', dur(run.durationMs)],
                      ['Tasks', String(run.tasks.length)],
                      ['Direction', run.direction],
                    ]} />
                    {run.residue && (
                      <Note tone="warn">
                        <b>Rolled back with residue.</b> {run.residue.join('; ')}
                      </Note>
                    )}
                  </div>

                  {/* tasks */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">{openStage?.name} · tasks</div>
                    <div className="border border-line rounded-lg overflow-hidden">
                      {(openStage?.tasks ?? []).map((t) => (
                        <button
                          key={t.taskDefId}
                          onClick={() => setTaskDrawer(t)}
                          className="w-full text-left px-4 py-3 border-b border-line-soft last:border-0 hover:bg-plane flex items-start justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium flex items-center gap-2">
                              <span className="text-ink-3 font-mono text-[11.5px]">{t.sequence}</span>
                              {t.name}
                            </div>
                            <div className="text-[11.5px] text-ink-3 mt-0.5">
                              asserts: <span className="font-mono">{t.claim}</span>
                            </div>
                            {t.failureReason && <div className="text-[11.5px] text-crit-700 mt-1">{t.failureReason}</div>}
                            {t.blockedBy && <div className="text-[11.5px] text-plum-700 mt-1">Blocked — {t.blockedBy} did not pass</div>}
                          </div>
                          <div className="text-right shrink-0">
                            <Badge tone={TASK_TONE[t.state]} dot={t.state === 'Running'}>{t.state}</Badge>
                            <CellSub>{dur(t.durationMs)}</CellSub>
                          </div>
                        </button>
                      ))}
                      {(openStage?.tasks ?? []).length === 0 && (
                        <div className="px-4 py-10 text-center text-ink-3 text-[13px]">No tasks in this stage.</div>
                      )}
                    </div>
                    <Note tone="info" className="mt-3">
                      Open any task to see the exact request sent and the response captured. The transport exit code is
                      recorded but never decides the outcome — the assertion does.
                    </Note>
                  </div>
                </div>
              </CardBody>
            </Card>
          </>
        ) : (
          <Card><CardBody className="py-14 text-center">
            {/* An archived request did run — it produced the service it points
                at. What is missing is the task-by-task device log, which ages
                out while the order itself is kept. Saying that is the
                difference between a record and a gap. */}
            <div className="text-[15px] font-semibold mb-1">
              {order.archived ? 'Execution log not retained' : 'No runs yet'}
            </div>
            <p className="text-ink-3 text-[13px] mb-4 max-w-[440px] mx-auto leading-relaxed">
              {order.archived
                ? <>This request completed on {shortDate(order.updatedAt)} and produced{' '}
                  {order.serviceId
                    ? <Link className="text-brand-600" to={`/inventory/${order.serviceId}`}><Mono>{order.serviceId}</Mono></Link>
                    : 'a service'}. Per-task device logs are kept for 90 days; the request and what it
                  configured are kept for the life of the service.</>
                : canExecute ? 'This request is approved and ready to execute.' : 'Runs appear once the request is approved and executed.'}
            </p>
            {canExecute && !order.archived && <Button variant="primary" onClick={() => startRun(order.id)}><PlayCircle size={15} />Execute workflow</Button>}
          </CardBody></Card>
        )
      )}

      {/* ---------------- runs ---------------- */}
      {tab === 'runs' && (
        <div className="flex flex-col gap-4">
          {runGroups.map((g, gi) => (
            <Card key={g.endpoint?.id ?? `unassigned-${gi}`}>
              <CardHead
                title={g.endpoint ? `${g.role} · ${g.endpoint.mgmtIp}` : g.role}
                sub={`${requestReason(order.intent, order.delta)} · ${
                  g.runs.length === 1
                    ? '1 attempt recorded'
                    : `${g.runs.length} attempts recorded — provisioning needed more than one try`
                }`}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr>
                    {['Run', 'Reason', 'Outcome', 'Started', 'Duration', 'Tasks passed', 'Residue', ''].map((h) => (
                      <th key={h} scope="col" className="text-left px-[18px] py-3 border-b border-line text-[12px] font-medium text-ink-3">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {g.runs.map((r) => (
                      <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-plane">
                        <td className="px-[18px] py-3"><Mono className="font-semibold">Run {r.attempt}</Mono></td>
                        <td className="px-[18px] py-3 text-ink-2 whitespace-nowrap">{attemptReason(g.runs, r)}</td>
                        <td className="px-[18px] py-3"><Badge tone={RUN_TONE[r.outcome]} dot>{r.outcome}</Badge></td>
                        {/* Absolute first, relative underneath. "1 h ago" answers
                            "is this recent"; an audit trail has to answer "when",
                            and only the timestamp does that. */}
                        <td className="px-[18px] py-3">
                          <div className="whitespace-nowrap">{dateTime(r.startedAt)}</div>
                          <div className="text-[12px] text-ink-3">{relTime(r.startedAt)}</div>
                        </td>
                        <td className="px-[18px] py-3">
                          <div className="font-mono">{dur(r.durationMs)}</div>
                          <div className="text-[12px] text-ink-3 whitespace-nowrap">{r.endedAt ? `ended ${clockTime(r.endedAt)}` : 'still running'}</div>
                        </td>
                        <td className="px-[18px] py-3 tnum">{r.tasks.filter((t) => t.state === 'Passed').length} of {r.tasks.length}</td>
                        <td className="px-[18px] py-3 text-ink-3">{r.residue ? r.residue.join('; ') : '—'}</td>
                        <td className="px-[18px] py-3 text-right">
                          <Button
                            size="sm"
                            onClick={() => {
                              if (g.endpoint) setEpId(g.endpoint.id)
                              const idxInEndpointRuns = allOrderRuns
                                .filter((x) => (!g.endpoint || x.endpointId === g.endpoint.id) && (g.endpoint || !x.endpointId))
                                .sort((a, b) => b.attempt - a.attempt)
                                .findIndex((x) => x.id === r.id)
                              setRunIdx(Math.max(0, idxInEndpointRuns))
                              setTab('lifecycle')
                            }}
                          >
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          {runGroups.length === 0 && (
            <Card><CardBody className="py-14 text-center text-ink-3">No runs recorded.</CardBody></Card>
          )}
        </div>
      )}

      {/* -------- request / response -------- */}
      <Drawer
        open={!!taskDrawer} onClose={() => setTaskDrawer(null)}
        title={taskDrawer?.name ?? ''}
        sub={taskDrawer ? `${taskDrawer.stage} · task ${taskDrawer.sequence}` : ''}
        width={720}
      >
        {taskDrawer && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={TASK_TONE[taskDrawer.state]} dot>{taskDrawer.state}</Badge>
              <Badge tone="none">{dur(taskDrawer.durationMs)}</Badge>
              {taskDrawer.startedAt && <Badge tone="none">{clockTime(taskDrawer.startedAt)} → {clockTime(taskDrawer.endedAt)}</Badge>}
            </div>

            <KV items={[
              ['Claim', taskDrawer.claim],
              ['Transport', <span key="t">ssh · exit <Mono>{taskDrawer.transportExit}</Mono> <span className="text-ink-3 font-normal">(recorded, never the verdict)</span></span>],
              ['Parsed', taskDrawer.parsed ? <Mono key="p">{taskDrawer.parsed}</Mono> : '—'],
              ['Expected', taskDrawer.expected ? <Mono key="e">{taskDrawer.expected}</Mono> : '—'],
              ['Actual', taskDrawer.actual ? <Mono key="a">{taskDrawer.actual}</Mono> : '—'],
            ]} />

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2">Command</div>
              <CodeBlock>{taskDrawer.command}</CodeBlock>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2">Request</div>
              <CodeBlock>{taskDrawer.requestPayload}</CodeBlock>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2">Response</div>
              <CodeBlock>{taskDrawer.responsePayload || '— not yet executed —'}</CodeBlock>
            </div>

            {taskDrawer.failureReason && <Note tone="crit"><b>Why it failed.</b> {taskDrawer.failureReason}</Note>}
          </div>
        )}
      </Drawer>
    </>
  )
}
