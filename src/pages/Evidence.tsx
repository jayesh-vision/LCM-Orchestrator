import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, FileBarChart, ListChecks, Network, ShieldCheck } from 'lucide-react'
import { useClearQuery, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import { useStore } from '@/store/useStore'
import type { RunTask } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellMain, CellSub, Chip, CodeBlock, DataTable,
  Drawer, FilterBanner, KV, Mono, Note, Stat, type Column,
} from '@/components/ui'
import { StackedBar } from '@/components/charts'
import { dur, relTime, TASK_TONE } from '@/lib/format'

interface EvidenceRow extends RunTask { id: string; runId: string; orderId: string; attempt: number }

export default function Evidence() {
  const runs = useStore((s) => s.runs)
  const workflows = useStore((s) => s.workflows)
  const nav = useNavigate()
  const [q, setQ] = useQueryState('q', '')
  const [verdict, setVerdict] = useQueryState<'All' | 'Passed' | 'Failed'>('verdict', 'All')
  const [stage, setStage] = useQueryState('stage', 'All')
  const pushToast = useStore((st) => st.pushToast)
  const [open, setOpen] = useState<EvidenceRow | null>(null)
  const clear = useClearQuery(['q', 'verdict', 'stage'])
  const resultsRef = useScrollToResultsOnDrillIn(verdict !== 'All')

  /* Every task evaluated across every run becomes an evidence record. */
  const rows: EvidenceRow[] = useMemo(
    () => runs.slice(0, 60).flatMap((r) => r.tasks
      .filter((t) => t.state === 'Passed' || t.state === 'Failed')
      .map((t, i) => ({ ...t, id: `${r.id}-${i}`, runId: r.id, orderId: r.orderId, attempt: r.attempt }))),
    [runs],
  )

  const filtered = useMemo(() => rows.filter((r) => {
    if (verdict !== 'All' && r.state !== verdict) return false
    if (stage !== 'All' && r.stage !== stage) return false
    if (!q) return true
    const t = q.toLowerCase()
    return r.name.toLowerCase().includes(t) || r.orderId.toLowerCase().includes(t) || r.claim.toLowerCase().includes(t)
  }), [rows, q, verdict, stage])

  /* Assertion coverage across every task definition in the estate. */
  const audit = useMemo(() => {
    let asserting = 0; let unasserted = 0; let noRollbackProof = 0
    workflows.forEach((w) => w.tasks.forEach((t) => {
      if (t.validations.length) asserting += 1; else unasserted += 1
      if (t.rollbackEnabled && t.inverseCommand && !t.rollbackValidations.length) noRollbackProof += 1
    }))
    return { asserting, unasserted, noRollbackProof, total: asserting + unasserted }
  }, [workflows])

  const passRate = rows.length ? (rows.filter((r) => r.state === 'Passed').length / rows.length) * 100 : 0
  const serviceLayer = useMemo(
    () => workflows.reduce((a, w) => a + w.tasks.filter((t) => t.stageKind === 'Post validation' && /status|session|route|xconnect|l2circuit/i.test(t.name)).length, 0),
    [workflows],
  )

  const columns: Column<EvidenceRow>[] = [
    {
      key: 'task', header: 'Assertion', width: '240px', sortValue: (r) => r.name,
      render: (r) => (<><CellMain>{r.name}</CellMain><CellSub>{r.stage} · task {r.sequence}</CellSub></>),
    },
    { key: 'claim', header: 'Claim', width: '260px', render: (r) => <Mono className="text-ink-2 text-[11.5px]">{r.claim}</Mono> },
    { key: 'order', header: 'Order', width: '160px', sortValue: (r) => r.orderId, render: (r) => (<><Mono>{r.orderId}</Mono><CellSub>run {r.attempt}</CellSub></>) },
    { key: 'expected', header: 'Expected', width: '150px', render: (r) => <Mono className="text-ink-3">{r.expected ?? '—'}</Mono> },
    { key: 'actual', header: 'Actual', width: '150px', render: (r) => <Mono className={r.state === 'Failed' ? 'text-crit-700 font-semibold' : ''}>{r.actual ?? '—'}</Mono> },
    { key: 'verdict', header: 'Verdict', width: '112px', sortValue: (r) => r.state, render: (r) => <Badge tone={TASK_TONE[r.state]}>{r.state}</Badge> },
    { key: 'took', header: 'Took', align: 'right', width: '92px', sortValue: (r) => r.durationMs ?? 0, render: (r) => dur(r.durationMs) },
    { key: 'when', header: 'When', width: '116px', sortValue: (r) => r.startedAt ?? '', render: (r) => <span className="text-ink-3">{relTime(r.startedAt)}</span> },
  ]

  return (
    <>

      {/* Verdict has its own quick-chip row in the toolbar below, which
         already shows which one is selected — no need to say it twice. */}
      <FilterBanner
        count={filtered.length} noun="assertions" onClear={clear}
        filters={[
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Assertions evaluated" icon={ListChecks} value={rows.length.toLocaleString()} note="Across the runs held in this workspace"
          info="Every individual check executed by workflow runs in this workspace. An assertion compares an observed value from the device against the expected value from the order, and records a pass or fail verdict."
          drillLabel="every assertion, unfiltered" onClick={clear} />
        <Stat label="Pass rate" icon={ShieldCheck} value={`${passRate.toFixed(1)}%`} tone="good" delta={{ text: '▲ 1.2 pts this week', tone: 'good' }}
          note="Share of evaluated assertions that returned their expected value"
          info="The share of all evaluated assertions that returned their expected value. Click to see only the failures."
          drillLabel="the assertions that failed" onClick={() => setVerdict('Failed')} />
        <Stat label="Task definitions" icon={ClipboardList} value={audit.total.toLocaleString()} note={`${audit.asserting.toLocaleString()} carry an assertion`}
          info="The reusable task steps defined across every workflow. Only the ones carrying an assertion actually prove anything — the rest just execute commands."
          drillLabel="the workflows these definitions belong to" onClick={() => nav('/workflows')} />
        <Stat label="Service-layer checks" icon={Network} value={serviceLayer}
          info="Checks that prove the customer's traffic actually moves end to end — pings across the VPN, route presence in the peer's table — rather than merely reading configuration back from the device."
          note="Checks that prove customer traffic moves, not just that config reads back"
          drillLabel="the workflows carrying these checks" onClick={() => nav('/workflows?state=Active')} />
      </div>

      <Card>
        <CardHead title="Assertion coverage" sub="Every task definition across every workflow, classified by what it actually proves"
          info="Classifies every task in the workflow library by evidential strength: does it prove service-layer reality, only read configuration back, or assert nothing at all? The weaker the class, the less a green run actually tells you." />
        <CardBody>
          <StackedBar
            ariaLabel="Assertion coverage across all task definitions"
            segments={[
              { label: 'Asserting', value: audit.asserting, fill: 'good', note: 'a false output would fail the task', onClick: () => setVerdict('Passed') },
              { label: 'Rollback unproven', value: audit.noRollbackProof, fill: 'warn', note: 'has a rollback, but nothing asserts it worked', onClick: () => nav('/workflows') },
              { label: 'Unasserted', value: audit.unasserted, fill: 'crit', note: 'pass would rest on the transport exit code alone', onClick: () => nav('/workflows') },
            ]}
          />
          <Note tone={audit.unasserted > 0 ? 'warn' : 'good'}>
            The transport exit code is <b>0 whenever the SSH session opened</b> — including for a ping that timed out on every
            echo. It is recorded for troubleshooting and never decides an outcome.
          </Note>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="What a well-formed assertion records" sub="Worked example · MPLS neighbour reachability" />
          <CardBody>
            <KV items={[
              ['Claim', 'The MPLS data plane to the remote PE carries at least 4 of 5 echoes'],
              ['Command', <Mono key="c">ping mpls ipv4 172.31.33.100/32 count 5</Mono>],
              ['Transport', <span key="t">ssh · exit <Mono>0</Mono> <span className="text-ink-3 font-normal">(recorded, never the verdict)</span></span>],
              ['Parse rule', <Mono key="p" className="text-[11.5px]">{'^Success rate is (\\d+) percent \\((\\d+)\\/(\\d+)\\)'}</Mono>],
              ['Parsed', <Mono key="pa">received = 5 · sent = 5</Mono>],
              ['Expected', <Mono key="e">received &gt;= 4</Mono>],
              ['Actual', <Mono key="a">5</Mono>],
              ['Verdict', <Badge key="v" tone="good">Passed — because 5 ≥ 4, for no other reason</Badge>],
              ['If unparseable', <Badge key="u" tone="crit">Fail · UNPARSEABLE</Badge>],
            ]} />
          </CardBody>
        </Card>

        <Card>
          <CardHead title="The assertion vocabulary" sub="Seven forms cover every check in the estate" />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr>
                {['Form', 'Asserts', 'Example'].map((h) => (
                  <th key={h} scope="col" className="text-left px-[18px] py-2.5 border-b border-line text-[12px] font-medium text-ink-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {([
                  ['exists', 'A parsed object is present', 'vrf "IBW-RTL-0218" exists'],
                  ['absent', 'A parsed object is gone — the rollback and cease workhorse', 'neighbor 10.244.7.2 absent'],
                  ['equals', 'A parsed field matches a literal', 'link == "up"'],
                  ['in_range', 'A parsed number falls inside bounds', '95 <= mbps <= 105'],
                  ['count', 'Cardinality of parsed rows', 'count(established_peers) == 2'],
                  ['matches', 'A parsed field matches a pattern', 'rd =~ ^65001:\\d+$'],
                  ['unchanged', 'A field equals a captured pre-state — how a modify proves it was hitless', 'uptime unchanged since pre-flight'],
                ]).map(([f, a, e]) => (
                  <tr key={f} className="border-b border-line-soft last:border-0">
                    <td className="px-[18px] py-2.5"><Mono className="font-semibold">{f}</Mono></td>
                    <td className="px-[18px] py-2.5 text-ink-2">{a}</td>
                    <td className="px-[18px] py-2.5"><Mono className="text-ink-3 text-[11.5px]">{e}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div ref={resultsRef} />
      <DataTable
        rows={filtered} total={rows.length} columns={columns} pageSize={12} minWidth={1180}
        onRowClick={(r) => setOpen(r)}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Task, Claim, Order' },
          chips: (['Passed', 'Failed'] as const).map((v) => (
            <Chip key={v} active={verdict === v} onClick={() => setVerdict(verdict === v ? 'All' : v)}>{v}</Chip>
          )),
          filters: [
            { key: 'verdict', label: 'Verdict', value: verdict, onChange: (v) => setVerdict(v as 'All' | 'Passed' | 'Failed'),
              options: (['Passed', 'Failed'] as const).map((v) => ({ value: v, label: v, count: rows.filter((r) => r.state === v).length })) },
            { key: 'stage', label: 'Stage', value: stage, onChange: setStage,
              options: [...new Set(rows.map((r) => r.stage))].map((st) => ({ value: st, label: st, count: rows.filter((r) => r.stage === st).length })) },
            { key: 'q', label: 'Task / Claim / Order', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: clear,
          onRefresh: () => pushToast('info', 'Evidence records refreshed.'),
          actions: [
            { label: 'Open assertion audit', icon: FileBarChart, onClick: () => nav('/reports') },
          ],
        }}
      />

      <Drawer
        open={!!open} onClose={() => setOpen(null)}
        title={open?.name ?? ''} sub={open ? `${open.orderId} · run ${open.attempt} · ${open.stage}` : ''}
        width={720}
        footer={open && <Button variant="primary" onClick={() => { nav(`/execution/${open.orderId}?tab=lifecycle`); setOpen(null) }}>Open the run</Button>}
      >
        {open && (
          <div className="flex flex-col gap-5">
            <div className="flex gap-2 flex-wrap">
              <Badge tone={TASK_TONE[open.state]} dot>{open.state}</Badge>
              <Badge tone="none">{dur(open.durationMs)}</Badge>
              <Badge tone="none">transport exit {open.transportExit}</Badge>
            </div>
            <KV items={[
              ['Claim', open.claim],
              ['Parsed', open.parsed ? <Mono key="p">{open.parsed}</Mono> : '—'],
              ['Expected', open.expected ? <Mono key="e">{open.expected}</Mono> : '—'],
              ['Actual', open.actual ? <Mono key="a">{open.actual}</Mono> : '—'],
            ]} />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2">Command</div>
              <CodeBlock>{open.command}</CodeBlock>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2">Response</div>
              <CodeBlock>{open.responsePayload || '— no response captured —'}</CodeBlock>
            </div>
            {open.failureReason && <Note tone="crit"><b>Why it failed.</b> {open.failureReason}</Note>}
          </div>
        )}
      </Drawer>
    </>
  )
}
