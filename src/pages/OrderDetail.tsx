import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Check, CheckCircle2, ChevronDown, GitBranch, Pencil, PlayCircle, RotateCcw, Send, Server, Square, XCircle,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { RUN_LOG_RETENTION_DAYS } from '@/data/orders'
import { ACCOUNTS } from '@/data/catalog'
import type { Endpoint, Run, RunTask, StageKind } from '@/types'
import { endpointRole } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellSub, CodeBlock, Drawer, KV,
  Mono, Note, Progress, Select, Tabs, TextInput, type Tone,
} from '@/components/ui'
import { CATEGORY_TONE, clockTime, dateTime, dur, ORDER_TONE, relTime, RUN_TONE, TASK_TONE, shortDate } from '@/lib/format'
import BpmnJourney from '@/components/BpmnJourney'

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

type Delta = { attribute: string; current: string; requested: string }[]

/** A run's tasks grouped back into the stages its workflow defines, in order. */
function stagesOf(run: Run): { name: string; kind: StageKind; tasks: RunTask[] }[] {
  const out: { name: string; kind: StageKind; tasks: RunTask[] }[] = []
  run.tasks.forEach((t) => {
    const last = out[out.length - 1]
    if (last && last.name === t.stage) last.tasks.push(t)
    else out.push({ name: t.stage, kind: t.stageKind, tasks: [t] })
  })
  return out
}

/** What the change actually is, in one line: "Circuit capacity 400 Gbps → 800
 *  Gbps". A create has no delta because nothing existed to differ from. */
function changeSummary(intent: string, delta?: Delta): string {
  if (!delta?.length) return intent === 'Create' ? 'initial configuration' : `${intent.toLowerCase()} applied`
  return delta.map((d) => `${d.attribute} ${d.current} → ${d.requested}`).join(', ')
}

/** One fact about the change's life, in the strip above the attribute table.
 *  Four of these read left to right as the order things happened in. */
function ChangeFact({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="vw-card-section bg-plane p-3">
      <div className="vw-label mb-1">{label}</div>
      <div className="vw-value font-medium leading-snug">{value}</div>
      {sub && <div className="text-[12px] text-ink-3 mt-0.5 leading-snug">{sub}</div>}
    </div>
  )
}

/** The request's own reason, for the header above each endpoint's attempts. */
function requestReason(intent: string, delta?: Delta): string {
  const why = intent === 'Create' ? 'Initial provisioning' : `${intent} request`
  if (!delta?.length) return why
  return `${why} · ${changeSummary(intent, delta)}`
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
     replays that exact selection. */
  const listBase = loc.pathname.startsWith('/execution') ? '/execution' : '/requests'
  const fromList = (loc.state as { fromList?: string } | null)?.fromList
  const listPath = `${listBase}${fromList || ''}`
  const listLabel = listBase === '/execution' ? 'Provisioning Execution' : 'Provisioning Requests'
  const order = useStore((s) => s.orders.find((o) => o.id === id))
  const allRuns = useStore((s) => s.runs)
  const approveOrder = useStore((s) => s.approveOrder)
  const rejectOrder = useStore((s) => s.rejectOrder)
  const startRun = useStore((s) => s.startRun)
  const abortRun = useStore((s) => s.abortRun)
  const retryOrder = useStore((s) => s.retryOrder)
  const updateOrderDraft = useStore((s) => s.updateOrderDraft)
  const updateOrderEndpointParam = useStore((s) => s.updateOrderEndpointParam)
  const submitDraftForValidation = useStore((s) => s.submitDraftForValidation)

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

  /**
   * Which task definitions actually write to the device.
   *
   * Most of a run's audit value sits in these: read and validation tasks prove
   * what the state was, write tasks *are* the state change. A run that wrote
   * nothing and a run that reconfigured the circuit otherwise look identical
   * in a list of outcomes and durations. A RunTask carries only the id of the
   * definition it came from, so the kind has to be resolved back through the
   * workflow that produced the run.
   */
  const writeTaskIds = useMemo(() => {
    const m = new Map<string, Set<string>>()
    workflows.forEach((w) => m.set(w.id, new Set(w.tasks.filter((t) => t.kind === 'write').map((t) => t.id))))
    return m
  }, [workflows])
  const writesIn = (r: Run) => {
    const ids = writeTaskIds.get(r.workflowId)
    const w = ids ? r.tasks.filter((t) => ids.has(t.taskDefId)) : []
    return { total: w.length, passed: w.filter((t) => t.state === 'Passed').length }
  }

  /**
   * The life of the change itself.
   *
   * A change record that cannot answer "when was this asked for, who cleared
   * it, when did it reach the devices, and is it on them now" is not an audit
   * record. Every one of those facts already existed — on the order, on its
   * approvals, on its runs — but scattered across three tabs, so the change
   * card showed what was asked for and nothing about what became of it.
   *
   * Counted over the latest attempt per endpoint, not every run: a retry
   * re-writes the same commands, and summing across attempts would report a
   * change applied twice when it landed once.
   */
  const changeAudit = useMemo(() => {
    const latest = runGroups.map((g) => g.runs[0]).filter(Boolean)
    const starts = latest.map((r) => Date.parse(r.startedAt)).filter((n) => !Number.isNaN(n))
    const ends = latest.map((r) => (r.endedAt ? Date.parse(r.endedAt) : NaN)).filter((n) => !Number.isNaN(n))
    const startedAt = starts.length ? new Date(Math.min(...starts)).toISOString() : undefined
    /* Only call the change finished once every endpoint has finished. */
    const endedAt = ends.length === latest.length && ends.length > 0 ? new Date(Math.max(...ends)).toISOString() : undefined
    const elapsed = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : undefined
    const writes = latest.reduce((acc, r) => {
      const w = writesIn(r)
      return { total: acc.total + w.total, passed: acc.passed + w.passed }
    }, { total: 0, passed: 0 })
    const devices = `${latest.length} device${latest.length === 1 ? '' : 's'}`
    const outcome: { tone: Tone; label: string; note: string } = latest.length === 0
      ? {
        tone: 'none', label: 'Not applied yet',
        note: order?.state === 'Approved' ? 'approved — waiting to be executed'
          : order?.state === 'Validated' ? 'waiting for approval'
            : `request is ${order?.state.toLowerCase() ?? 'draft'}`,
      }
      : latest.some((r) => r.outcome === 'Running')
        ? { tone: 'info', label: 'Applying now', note: `${writes.passed} of ${writes.total} commands written so far` }
        : latest.every((r) => r.outcome === 'Accepted')
          ? {
            tone: 'good', label: 'Applied and proved',
            note: writes.total ? `${writes.total} command${writes.total === 1 ? '' : 's'} written across ${devices}` : `read-only — nothing written to ${devices}`,
          }
          : {
            tone: 'crit',
            label: latest.some((r) => r.outcome === 'Failed') ? 'Failed — change not applied' : latest[0].outcome,
            note: `${writes.passed} of ${writes.total} commands written before it stopped`,
          }
    return { startedAt, endedAt, elapsed, writes, outcome, decision: order?.approvals.find((a) => a.decision) }
  }, [runGroups, order, writeTaskIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const tab = (sp.get('tab') ?? 'service') as 'service' | 'journey' | 'lifecycle' | 'runs'
  /* replace: true — switching tabs shouldn't push a browser-history entry, so
     the Back button (and the browser's own back button) never gets stuck
     cycling through tabs instead of leaving the screen. */
  const setTab = (t: string) => setSp((prev) => {
    const next = new URLSearchParams(prev)
    next.set('tab', t === 'params' ? 'service' : t)
    return next
  }, { replace: true })

  /**
   * Whether the change card is open.
   *
   * It sits above all three tabs, which is right — the change is the subject of
   * the screen, not of one tab — but that also means its height is paid on
   * every tab. Someone reading runs has usually already read the change. The
   * choice is remembered for the session rather than per request, so it does
   * not have to be made again on the next one; the header carries the summary
   * either way, so collapsing it hides detail, never the answer.
   */
  const [changeOpen, setChangeOpen] = useState(() => sessionStorage.getItem('lcm.changeCard') !== 'closed')
  const toggleChange = () => setChangeOpen((v) => {
    sessionStorage.setItem('lcm.changeCard', v ? 'closed' : 'open')
    return !v
  })

  const [runIdx, setRunIdx] = useState(0)
  const [openStageIdx, setOpenStageIdx] = useState(0)
  const [taskDrawer, setTaskDrawer] = useState<RunTask | null>(null)

  const run: Run | undefined = runs[runIdx]

  /* The run's stages in the order its workflow defines them. */
  const stages = useMemo(() => (run ? stagesOf(run) : []), [run])
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
  /* A Draft hasn't been checked against anything yet — nothing has run
     against it and no one has seen it — so it's the one state where the
     request itself, not just its lifecycle, can still change. */
  const isDraft = order.state === 'Draft'
  const editMode = isDraft && sp.get('edit') === '1'
  const setEditMode = (v: boolean) => setSp((prev) => {
    const next = new URLSearchParams(prev)
    if (v) next.set('edit', '1'); else next.delete('edit')
    return next
  }, { replace: true })

  /**
   * Why there is nothing to show, said once for both tabs that can hit it.
   *
   * "No runs recorded" is true and useless: on a completed request it reads as
   * missing data, which is exactly how it was read. An archived request did
   * run — it produced the service it points at — and what is gone is the
   * task-by-task device log, which ages out while the order is kept for the
   * life of the service. Saying that is the difference between a record and a
   * gap. Lifecycle and Runs both reached this state and answered it
   * differently, so the answer lives in one place now.
   */
  const noRuns = (
    <Card><CardBody className="py-14 text-center">
      <div className="text-[15px] font-semibold mb-1">
        {order.archived ? 'Execution log not retained' : 'No runs yet'}
      </div>
      <p className="text-ink-3 text-[13px] mb-4 max-w-[440px] mx-auto leading-relaxed">
        {order.archived
          ? <>This request completed on {shortDate(order.updatedAt)} and produced{' '}
            {order.serviceId
              ? <Link className="text-brand-600" to={`/inventory/${order.serviceId}?tab=lifecycle`}><Mono>{order.serviceId}</Mono></Link>
              : 'a service'}. Per-task device logs are kept for {RUN_LOG_RETENTION_DAYS} days; the request
            and what it configured are kept for the life of the service.</>
          : canExecute ? 'This request is approved and ready to execute.' : 'Runs appear once the request is approved and executed.'}
      </p>
      {canExecute && !order.archived && <Button variant="primary" onClick={() => startRun(order.id)}><PlayCircle size={15} />Execute workflow</Button>}
    </CardBody></Card>
  )

  return (
    <>
      <Card>
        <CardBody className="pb-4">
          <button onClick={() => nav(listPath)} className="text-[12.5px] text-ink-3 hover:text-ink-1 flex items-center gap-1.5 mb-3">
            <ArrowLeft size={14} />Back to {listLabel}
          </button>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                {editMode ? (
                  <TextInput
                    value={order.name} onChange={(e) => updateOrderDraft(order.id, { name: e.target.value })}
                    aria-label="Request name" className="!text-[16px] !font-semibold !h-9 max-w-[360px]"
                  />
                ) : (
                  <h1 className="text-[21px] font-semibold tracking-[-.4px] m-0">{order.name}</h1>
                )}
                <Badge tone={ORDER_TONE[order.state]} dot>{order.state}</Badge>
                <Badge tone={CATEGORY_TONE[order.category]}>{order.category}</Badge>
                <Badge tone="none">{order.type} · {order.subtype}</Badge>
                {editMode && <Badge tone="info">Editing</Badge>}
              </div>
              {editMode ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] text-ink-2"><Mono className="font-semibold">{order.id}</Mono> · code <Mono>{order.code}</Mono> · customer</span>
                  <Select
                    value={order.accountId} aria-label="Customer account"
                    onChange={(e) => {
                      const acc = ACCOUNTS.find((a) => a.id === e.target.value)
                      if (acc) updateOrderDraft(order.id, { accountId: acc.id, accountName: acc.name })
                    }}
                    className="!h-8 !py-0 !text-[12.5px] w-[260px]"
                  >
                    {ACCOUNTS.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}
                  </Select>
                </div>
              ) : (
                <p className="text-[13px] text-ink-2 m-0">
                  <Mono className="font-semibold">{order.id}</Mono> · code <Mono>{order.code}</Mono> ·
                  {' '}{order.accountName} <Mono className="text-ink-3">{order.accountId}</Mono> ·
                  {' '}created {relTime(order.createdAt)}
                  {order.serviceId && <> · service <Link className="text-brand-600" to={`/inventory/${order.serviceId}`}><Mono>{order.serviceId}</Mono></Link></>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isDraft && (
                <>
                  <Button onClick={() => setEditMode(!editMode)}>
                    {editMode ? <><Check size={15} />Done editing</> : <><Pencil size={15} />Edit request</>}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => { setEditMode(false); submitDraftForValidation(order.id) }}
                  >
                    <Send size={15} />Submit for validation
                  </Button>
                </>
              )}
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
              /* The whole journey as one BPMN process — raised to landed,
                 with the execution sub-process expanded per device and the
                 point where a run broke marked as such. */
              { id: 'journey', label: 'BPMN journey' },
              { id: 'lifecycle', label: 'Lifecycle operation' },
              /* Every run on the request, not the selected endpoint's share of
                 them. The tab body groups Source and Destination side by side,
                 so counting one endpoint made a two-ended request that executed
                 correctly on both ends read as though only one run existed.

                 No count at all on an archived request whose log has aged out:
                 "0" asserts that nothing ran, when what happened is that the
                 transcript is no longer held. The tab says so when opened. */
              {
                id: 'runs',
                label: 'Runs',
                count: order.archived && allOrderRuns.length === 0 ? undefined : allOrderRuns.length,
              },
            ]}
          />
        </div>
      </Card>

      {/* Every attribute the requester actually asked to change, current vs
          requested — kept visible across tabs since not every attribute has
          a device command parameter to show up in below (MTU, for one, is
          not a modelled command placeholder for any vendor in this
          prototype), so this is the only place some of them are ever shown.

          Shown for every change against a live service, not only the ones
          carrying an attribute delta: a cease or a suspend changes nothing
          about the configuration and so has no delta to show, but it is
          precisely the kind of request whose audit trail someone comes
          looking for. A create is the exception — there is no prior state
          for it to be a change from. */}
      {order.intent !== 'Create' && (
        <Card>
          {/* A change is raised somewhere and lands somewhere: Change & Cease is
              where it was raised and where its siblings against this service
              sit, the service is what it acts on. Both were a search away from
              here and are now one click. */}
          <CardHead
            tight={!changeOpen}
            title={
              <button
                type="button" onClick={toggleChange} aria-expanded={changeOpen}
                className="flex items-center gap-1.5 bg-transparent border-0 p-0 m-0 font-[inherit] text-ink-1 cursor-pointer hover:text-brand-600"
              >
                Requested change
                <ChevronDown size={16} className={`text-ink-3 transition-transform ${changeOpen ? 'rotate-180' : ''}`} />
              </button>
            }
            /* Collapsed, the header has to carry the answer on its own —
               otherwise closing the card loses the thing it was opened for.
               What changed, whether it landed, and when, in one line. */
            sub={changeOpen
              ? (order.notes ? `Reason: ${order.notes}` : `Raised as a ${order.intent.toLowerCase()} against this service`)
              : (
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="truncate max-w-[620px]">{changeSummary(order.intent, order.delta)}</span>
                  <Badge tone={changeAudit.outcome.tone} dot>{changeAudit.outcome.label}</Badge>
                  {/* Named, not bare: an unlabelled date next to a change reads
                      as when it was asked for, not when it reached the device. */}
                  {changeAudit.startedAt && <span className="text-ink-3">executed {dateTime(changeAudit.startedAt)}</span>}
                </span>
              )}
            right={
              <>
                <Link to={`/change?q=${order.id}`} className="nst-btn nst-btn--xs no-underline">
                  <GitBranch size={14} />Open in Change &amp; Cease
                </Link>
                {/* Not the service overview — its lifecycle. From a change
                    request the question is what else has been done to this
                    service and in what order; this request is one entry on
                    that list, and the list is the only place it can be seen
                    in context. */}
                {order.serviceId && (
                  <Link to={`/inventory/${order.serviceId}?tab=lifecycle`} className="nst-btn nst-btn--xs no-underline">
                    <Server size={14} />Service lifecycle
                  </Link>
                )}
              </>
            }
          />
          {!changeOpen && <div className="pb-4" />}
          {changeOpen && (<>
          {/* Raised → cleared → executed → landed. The four questions asked of
              any change record, in the order they get answered. */}
          <div className="grid gap-3 px-4 pt-4 sm:grid-cols-2 xl:grid-cols-4">
            <ChangeFact
              label="Raised"
              value={dateTime(order.createdAt)}
              sub={<>{relTime(order.createdAt)}{order.owner ? ` · by ${order.owner}` : ''}</>}
            />
            <ChangeFact
              label={changeAudit.decision?.decision === 'Rejected' ? 'Rejected' : 'Approved'}
              value={changeAudit.decision?.at ? dateTime(changeAudit.decision.at) : <span className="text-ink-3">Not cleared yet</span>}
              sub={changeAudit.decision
                ? `${changeAudit.decision.role} · ${changeAudit.decision.by}`
                : order.approvals.length > 0 ? `waiting on ${order.approvals[0].role}` : 'no approval recorded'}
            />
            <ChangeFact
              label="Executed"
              value={changeAudit.startedAt ? dateTime(changeAudit.startedAt) : <span className="text-ink-3">Not executed yet</span>}
              sub={changeAudit.startedAt
                ? <>{relTime(changeAudit.startedAt)}{changeAudit.elapsed !== undefined ? ` · took ${dur(changeAudit.elapsed)}` : ' · still running'}</>
                : 'no run has reached the devices'}
            />
            <ChangeFact
              label="Result"
              value={<Badge tone={changeAudit.outcome.tone} dot>{changeAudit.outcome.label}</Badge>}
              sub={changeAudit.outcome.note}
            />
          </div>
          {order.delta && order.delta.length > 0 && (
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
          )}
          {/* An attribute delta says what should change; it says nothing about
              how. The workflow bound to each endpoint is the how — and it is
              knowable before the request ever runs, so this reads as a plan
              beforehand and as a record afterwards. */}
          <div className="border-t border-line-soft px-4 py-4">
            <div className="vw-card-title-sm mb-2.5">
              {changeAudit.startedAt ? 'Applied by' : 'Will be applied by'}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {order.endpoints.map((e) => {
                const last = allOrderRuns.find((r) => r.endpointId === e.id)
                /* Bound template first; failing that, whichever one the run
                   actually used. An endpoint can reach execution unbound — the
                   platform falls back to the Source's template — and claiming
                   "no workflow bound" next to an accepted run would be false. */
                const w = workflows.find((x) => x.id === e.workflowId)
                  ?? workflows.find((x) => x.id === last?.workflowId)
                const cmds = w ? w.tasks.filter((t) => t.kind === 'write').length : 0
                return (
                  <div key={e.id} className="vw-card-section bg-plane p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="vw-label mb-1">{endpointRole(e)} · <Mono>{e.mgmtIp}</Mono></div>
                      {w ? (
                        <>
                          <Link to={`/workflows/${w.id}`} className="vw-value font-medium block hover:text-brand-600">
                            {w.name} — V {w.version}
                          </Link>
                          <div className="text-[12px] text-ink-3 mt-0.5">
                            {w.vendor} {e.deviceName} · {w.stages.length} stages · {cmds || 'no'} config command{cmds === 1 ? '' : 's'}
                          </div>
                        </>
                      ) : (
                        <div className="vw-value text-ink-3">No workflow bound — assigned at design</div>
                      )}
                    </div>
                    {/* The card names the workflow and says it was accepted;
                        the next question is always what it actually did on the
                        device. Same jump the Runs table offers — select this
                        endpoint's latest attempt and open it in Lifecycle —
                        rather than making someone find the row again there. */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge tone={last ? RUN_TONE[last.outcome] : 'none'} dot>
                        {last ? last.outcome : 'Not run'}
                      </Badge>
                      {last && (
                        <Button
                          size="sm"
                          onClick={() => { setEpId(e.id); setRunIdx(0); setTab('lifecycle') }}
                        >
                          Open
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          </>)}
        </Card>
      )}

      {/* ---------------- network service ---------------- */}
      {tab === 'service' && (
        <div className="flex flex-col gap-4">
          {editMode && (
            <Note tone="info">
              Editing this request. Changes save as you type — pick an endpoint on the left and edit its parameters
              on the right, or the name and customer above. <b>Submit for validation</b> when it's ready to move on.
            </Note>
          )}
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
                    <div className="vw-flex vw-items-center vw-justify-between vw-gap-sm mb-2">
                      <div className="vw-card-title-sm">Parameters</div>
                      {editMode && <span className="text-[11.5px] text-ink-3">Edits render into this endpoint's commands only</span>}
                    </div>
                    <table className="nst-table border-0 rounded-none">
                      <thead><tr><th scope="col">Parameter name</th><th scope="col">Parameter value</th></tr></thead>
                      <tbody>
                        {(ep.params ?? []).map((p) => {
                          /* Interface and Neighbor IP are read off the port picked for
                             this endpoint, not typed — editing them here without
                             re-picking the port would contradict what the request
                             actually reserved, so they stay locked even in edit mode,
                             same rule the wizard itself applies when it renders them. */
                          const locked = p.source === 'derived'
                          return (
                            <tr key={p.name}>
                              <td className="nst-table-td--primary whitespace-nowrap">{p.name}</td>
                              <td className="nst-table-td--primary">
                                {editMode && !locked ? (
                                  <TextInput
                                    value={p.value} aria-label={`${p.name} value`}
                                    onChange={(e) => updateOrderEndpointParam(order.id, ep.id, p.name, e.target.value)}
                                    className="!h-8 !py-1 font-mono !text-[12.5px] max-w-[420px]"
                                  />
                                ) : (
                                  <span className={`truncate max-w-[520px] block ${editMode && locked ? 'text-ink-3' : ''}`} title={editMode && locked ? 'Set by the port chosen for this endpoint' : undefined}>
                                    {p.value}
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
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
        </div>
      )}

      {/* ---------------- BPMN journey ---------------- */}
      {tab === 'journey' && (
        <BpmnJourney
          order={order} runs={allOrderRuns} workflows={workflows}
          onOpenTask={setTaskDrawer}
          /* Same jump the Runs table makes: select that endpoint, pick the
             attempt, and land on the stage-and-task view of it. */
          onOpenRun={(runId, endpointId) => {
            const target = allOrderRuns.find((r) => r.id === runId)
            const epKey = endpointId ?? target?.endpointId
            if (epKey) setEpId(epKey)
            const idx = allOrderRuns
              .filter((r) => (epKey ? r.endpointId === epKey : !r.endpointId))
              .sort((a, b) => b.attempt - a.attempt)
              .findIndex((r) => r.id === runId)
            setRunIdx(Math.max(0, idx))
            setOpenStageIdx(target ? Math.max(0, stagesOf(target).findIndex((s) => s.tasks.some((t) => t.state === 'Failed' || t.state === 'Running'))) : 0)
            setTab('lifecycle')
          }}
        />
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
                {/* What this particular run did to this particular device.
                    Opening a run used to drop you straight into a stage list
                    with no statement of what the run was for — fine for a
                    create, where the whole configuration is the change, but on
                    a modify it left the one question worth asking unanswered. */}
                <Note tone={run.outcome === 'Accepted' ? 'good' : run.outcome === 'Running' ? 'info' : 'warn'} className="mb-4">
                  {(() => {
                    const w = writesIn(run)
                    const what = changeSummary(order.intent, order.delta)
                    if (!w.total) return <>This run only read and validated <strong>{ep?.mgmtIp}</strong> — no configuration was written.</>
                    if (run.outcome === 'Running') return <>Applying <strong>{what}</strong> to {ep?.mgmtIp} — {w.passed} of {w.total} commands written so far.</>
                    if (run.outcome === 'Accepted') return <>Applied <strong>{what}</strong> to {ep?.mgmtIp}, writing {w.total} command{w.total === 1 ? '' : 's'}, and proved it afterwards.</>
                    return <>Attempted <strong>{what}</strong> on {ep?.mgmtIp} — {w.passed} of {w.total} commands written before the run ended {run.outcome.toLowerCase()}.</>
                  })()}
                </Note>
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
        ) : noRuns)}

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
                    {['Run', 'Reason', 'Outcome', 'Started', 'Duration', 'Tasks passed', 'Config written', 'Residue', ''].map((h) => (
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
                        {/* Separates a run that changed the device from one that
                            only read and validated it — the difference an audit
                            actually cares about, and invisible in a pass count. */}
                        <td className="px-[18px] py-3">
                          {(() => {
                            const w = writesIn(r)
                            if (!w.total) return <span className="text-ink-3">nothing written</span>
                            return (
                              <>
                                <div className="tnum">{w.passed} of {w.total} commands</div>
                                <div className="text-[12px] text-ink-3">{changeSummary(order.intent, order.delta)}</div>
                              </>
                            )
                          })()}
                        </td>
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
          {runGroups.length === 0 && noRuns}
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
              <CodeBlock copyable>{taskDrawer.command}</CodeBlock>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2">Request</div>
              <CodeBlock copyable>{taskDrawer.requestPayload}</CodeBlock>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2">Response</div>
              <CodeBlock copyable={!!taskDrawer.responsePayload}>{taskDrawer.responsePayload || '— not yet executed —'}</CodeBlock>
            </div>

            {taskDrawer.failureReason && <Note tone="crit"><b>Why it failed.</b> {taskDrawer.failureReason}</Note>}
          </div>
        )}
      </Drawer>
    </>
  )
}
