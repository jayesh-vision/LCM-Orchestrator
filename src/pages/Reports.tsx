import { useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, Download, Eye, FileText, Hourglass, Plus, RotateCcw, Share2, XCircle } from 'lucide-react'
import { useQueryState } from '@/lib/useQueryState'
import { useStore } from '@/store/useStore'
import type { ReportDef } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellMain, CellSub, Chip, DataTable,
  Drawer, KV, Kebab, Mono, Note, Stat, type Column,
} from '@/components/ui'
import { TrendLine } from '@/components/charts'
import { relTime, shortDate } from '@/lib/format'

const STATE_TONE = { Current: 'good', Stale: 'warn', Running: 'info', Failed: 'crit' } as const

export default function Reports() {
  const reports = useStore((s) => s.reports)
  const pushToast = useStore((s) => s.pushToast)
  const [q, setQ] = useQueryState('q', '')
  const [state, setState] = useQueryState<ReportDef['state'] | 'All'>('state', 'All')
  const [open, setOpen] = useState<ReportDef | null>(null)

  const filtered = useMemo(() => reports.filter((r) => {
    if (state !== 'All' && r.state !== state) return false
    if (q && !(r.name.toLowerCase().includes(q.toLowerCase()) || r.question.toLowerCase().includes(q.toLowerCase()))) return false
    return true
  }), [reports, state, q])

  const n = (s: ReportDef['state']) => reports.filter((r) => r.state === s).length
  const featured = reports[0]

  const columns: Column<ReportDef>[] = [
    {
      key: 'name', header: 'Report', width: '220px', sortValue: (r) => r.name,
      render: (r) => (<><CellMain>{r.name}</CellMain><CellSub>{r.cadence}</CellSub></>),
    },
    { key: 'q', header: 'Question it answers', width: '300px', render: (r) => <span className="text-ink-3">{r.question}</span> },
    { key: 'last', header: 'Last run', width: '120px', sortValue: (r) => r.lastRunAt, render: (r) => <span className="text-ink-2">{shortDate(r.lastRunAt)}</span> },
    { key: 'snap', header: 'Snapshot', width: '176px', render: (r) => <Mono className="text-ink-3 text-[11.5px] whitespace-nowrap">{r.snapshot}</Mono> },
    { key: 'headline', header: 'Headline', width: '190px', render: (r) => <CellMain>{r.headline}</CellMain> },
    {
      key: 'delta', header: 'Change', width: '132px',
      render: (r) => <Badge tone={r.deltaTone === 'bad' ? 'crit' : r.deltaTone === 'good' ? 'good' : 'none'}>{r.deltaLabel}</Badge>,
    },
    {
      key: 'state', header: 'Status', width: '150px', sortValue: (r) => r.state,
      render: (r) => (<><Badge tone={STATE_TONE[r.state]} dot={r.state === 'Running'}>{r.state}</Badge>
        {r.failureReason && <CellSub>{r.failureReason}</CellSub>}</>),
    },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => setOpen(r) },
          { label: 'Download', icon: Download, onClick: () => pushToast(r.state === 'Current' ? 'good' : 'warn', r.state === 'Current' ? `${r.name} downloaded.` : `${r.name} downloaded with a stale-data banner.`) },
          { label: 'Share', icon: Share2, onClick: () => pushToast('info', `Share link created · ${r.audience}`) },
          { label: 'Re-run now', icon: RotateCcw, onClick: () => pushToast('info', `${r.name} queued.`) },
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Report definitions" icon={FileText} value={reports.length} note={`${reports.filter((r) => r.cadence.includes('demand')).length} on demand`}
          info="Every report the platform can produce — some generated on a schedule, some on demand. Each definition answers one operational question from live data."
          drillLabel="every report definition" onClick={() => setState('All')} />
        <Stat label="Current" icon={CheckCircle2} value={n('Current')} tone="good" note="Source data has not moved since generation"
          info="Reports whose source data has not changed since the file was generated — what you download is still true right now."
          drillLabel="current reports" onClick={() => setState('Current')} />
        <Stat label="Stale" icon={Hourglass} value={n('Stale')} tone="warn" note="Valid as a dated statement, wrong as a current one"
          info="Reports generated before the underlying data last changed. Still valid as a statement about that moment, but regenerate before using one to describe the present."
          drillLabel="stale reports" onClick={() => setState('Stale')} />
        <Stat label="Failed" icon={XCircle} value={n('Failed')} tone={n('Failed') ? 'crit' : undefined} note="Retry available"
          info="Reports whose last generation attempt errored — no fresh file was produced. Retry from the row's actions."
          drillLabel="failed reports" onClick={() => setState('Failed')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHead title={featured.name} sub={featured.question}
            right={<><Button size="sm"><Download size={14} />Download</Button><Button size="sm"><Share2 size={14} />Share</Button></>} />
          <CardBody>
            <div className="flex items-end gap-7 flex-wrap">
              <div>
                <div className="text-[12px] text-ink-3 font-medium">Current</div>
                <div className="text-[30px] font-semibold text-crit-500 tnum leading-tight">{featured.history[0].value}</div>
                <div className="text-[11.5px] font-semibold text-crit-500 mt-1">{featured.deltaLabel} · none resolved</div>
              </div>
              <div className="flex-1 min-w-[280px]">
                <TrendLine
                  tone="crit"
                  points={[...featured.history].reverse().map((h) => h.value)}
                  labels={[...featured.history].reverse().map((h) => h.at.slice(5))}
                />
              </div>
            </div>
            <div className="border border-line rounded-lg overflow-hidden mt-4">
              <table className="w-full text-[12.5px]">
                <thead><tr className="bg-plane">
                  {['Run', 'Snapshot', 'Value', 'Change'].map((h) => (
                    <th key={h} scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {featured.history.map((h) => (
                    <tr key={h.snapshot} className="border-t border-line-soft">
                      <td className="px-3.5 py-2 whitespace-nowrap">{h.at}</td>
                      <td className="px-3.5 py-2"><Mono className="text-ink-3">{h.snapshot}</Mono></td>
                      <td className="px-3.5 py-2 font-semibold tnum">{h.value}</td>
                      <td className="px-3.5 py-2">
                        {h.delta === 0 ? <Badge tone="none">baseline</Badge>
                          : <Badge tone={h.delta > 0 ? 'crit' : 'good'}>{h.delta > 0 ? '+' : ''}{h.delta}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>A single figure is a number. <b>The trend is the report</b> — a count that rises every week with nothing resolved is a decision, not a statistic.</Note>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Report states" sub="What each one means for the file in your hand" />
          <CardBody className="flex flex-col gap-3">
            {([
              ['Current', 'good', 'Generated, and the source data has not moved since.', 'Download freely'],
              ['Stale', 'warn', 'Generated, but the source data has changed since.', 'Downloads carry a banner'],
              ['Running', 'info', 'In progress, with elapsed time shown.', 'Not downloadable'],
              ['Failed', 'crit', 'Generation failed, with the failing step named.', 'Retry available'],
            ] as const).map(([s, tone, meaning, dl]) => (
              <div key={s} className="flex items-start gap-3 border border-line rounded-lg px-3.5 py-3">
                <Badge tone={tone}>{s}</Badge>
                <div className="min-w-0">
                  <div className="text-[12.5px] text-ink-1">{meaning}</div>
                  <div className="text-[11.5px] text-ink-3 mt-0.5">{dl}</div>
                </div>
              </div>
            ))}
            <Note tone="warn">
              A weekly report over a daily-moving base spends most of its life <b>Stale</b>. Saying so is the difference
              between a number and a number you can act on.
            </Note>
          </CardBody>
        </Card>
      </div>

      <DataTable
        rows={filtered} total={reports.length} columns={columns} pageSize={10} minWidth={1220}
        onRowClick={(r) => setOpen(r)}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Report, Question' },
          chips: (['Current', 'Stale', 'Running', 'Failed'] as const).filter((s) => n(s) > 0).map((s) => (
            <Chip key={s} active={state === s} onClick={() => setState(state === s ? 'All' : s)}>{s}</Chip>
          )),
          filters: [
            { key: 'state', label: 'Status', value: state, onChange: (v) => setState(v as ReportDef['state'] | 'All'),
              options: (['Current', 'Stale', 'Running', 'Failed'] as const).filter((s) => n(s) > 0).map((s) => ({ value: s, label: s, count: n(s) })) },
            { key: 'q', label: 'Report / Question', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: () => { setState('All'); setQ('') },
          onRefresh: () => pushToast('info', 'Report catalog refreshed.'),
          actions: [
            { label: 'New report', icon: Plus, onClick: () => pushToast('info', 'Report queued. It will appear here when generation completes.') },
            { label: 'Schedules', icon: CalendarClock, onClick: () => pushToast('info', 'Schedules are not wired in this prototype.') },
          ],
        }}
      />

      <Drawer
        open={!!open} onClose={() => setOpen(null)}
        title={open?.name ?? ''} sub={open?.question} width={640}
        footer={open && (
          <>
            {open.state === 'Failed' && <Button onClick={() => pushToast('info', `${open.name} queued for retry.`)}><RotateCcw size={15} />Retry</Button>}
            <Button variant="primary" disabled={open.state === 'Running' || open.state === 'Failed'}
              onClick={() => pushToast('good', `${open.name} downloaded.`)}>
              <Download size={15} />Download
            </Button>
          </>
        )}
      >
        {open && (
          <div className="flex flex-col gap-5">
            <div className="flex gap-2 flex-wrap">
              <Badge tone={STATE_TONE[open.state]} dot={open.state === 'Running'}>{open.state}</Badge>
              <Badge tone={open.deltaTone === 'bad' ? 'crit' : open.deltaTone === 'good' ? 'good' : 'none'}>{open.deltaLabel}</Badge>
            </div>
            <KV items={[
              ['Headline', <b key="h">{open.headline}</b>],
              ['Cadence', open.cadence],
              ['Last run', `${shortDate(open.lastRunAt)} · ${relTime(open.lastRunAt)}`],
              ['Snapshot', <Mono key="s">{open.snapshot}</Mono>],
              ['Audience', open.audience],
            ]} />
            {open.failureReason && <Note tone="crit"><b>Generation failed.</b> {open.failureReason}</Note>}
            {open.state === 'Stale' && <Note tone="warn">The ledger this report read has changed since generation. The figure below is still a valid statement about {shortDate(open.lastRunAt)}, and wrong as a statement about today.</Note>}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Run history</div>
              <TrendLine
                tone={open.deltaTone === 'bad' ? 'crit' : 'brand'}
                points={[...open.history].reverse().map((h) => h.value)}
                labels={[...open.history].reverse().map((h) => h.at.slice(5))}
              />
            </div>
          </div>
        )}
      </Drawer>
    </>
  )
}
