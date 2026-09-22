import type { Order, ReportDef, ResourcePool, Run, Service } from '@/types'
import { WAITING } from '@/data/orders'
import { EXEC_FAIL, RISK_FAIL, failureReasonFor, worstBy } from '@/lib/orderFailure'

/**
 * Turns a report definition into the CSV a person actually wants: not just the
 * dashboard's headline number, but the underlying records that number counts —
 * one row per service, run or pool entry, with the service name and order ID a
 * NOC/finance reader needs to go act on it.
 */

export interface ReportContext {
  services: Service[]
  orders: Order[]
  pools: ResourcePool[]
  runs: Run[]
}

interface ReportDataset {
  /** Human description of what one row represents, shown above the table. */
  label: string
  columns: string[]
  rows: (string | number)[][]
}

const ORDER_COLUMNS = ['Order ID', 'Name', 'Account', 'Category', 'Intent', 'State']

function orderRow(o: Order, extra: (string | number)[]): (string | number)[] {
  return [o.id, o.name, o.accountName, o.category, o.intent, o.state, ...extra]
}

const DAY = 86400000

function buildDataset(report: ReportDef, ctx: ReportContext): ReportDataset {
  switch (report.id) {
    case 'RPT-001': {
      const since = Date.now() - 7 * DAY
      const rows = ctx.orders.filter((o) => Date.parse(o.createdAt) > since)
      return {
        label: 'Requests raised in the last 7 days',
        columns: [...ORDER_COLUMNS, 'Created'],
        rows: rows.map((o) => orderRow(o, [o.createdAt])),
      }
    }
    case 'RPT-002': {
      const since = Date.now() - 7 * DAY
      const rows = ctx.runs.filter((r) => r.attempt === 1 && Date.parse(r.startedAt) > since)
      return {
        label: 'First-attempt runs from the last 7 days',
        columns: ['Run ID', 'Order ID', 'Workflow ID', 'Outcome', 'Started at'],
        rows: rows.map((r) => [r.id, r.orderId, r.workflowId, r.outcome, r.startedAt]),
      }
    }
    case 'RPT-003': {
      const failedOrderIds = new Set(ctx.orders.filter((o) => EXEC_FAIL.includes(o.state)).map((o) => o.id))
      const latestAttempt = new Map<string, number>()
      ctx.runs.forEach((r) => { if (failedOrderIds.has(r.orderId)) latestAttempt.set(r.orderId, Math.max(latestAttempt.get(r.orderId) ?? 0, r.attempt)) })
      const rows: (string | number)[][] = []
      ctx.runs.forEach((r) => {
        if (!failedOrderIds.has(r.orderId) || r.attempt !== latestAttempt.get(r.orderId)) return
        r.tasks.forEach((t) => {
          if (t.state !== 'Failed') return
          rows.push([r.orderId, r.id, t.name, t.stageKind, failureReasonFor(r.id, t.taskDefId, t.stageKind), t.endedAt ?? r.startedAt])
        })
      })
      return { label: 'Failed tasks behind every provisioning failure, by reason', columns: ['Order ID', 'Run ID', 'Task', 'Stage', 'Reason', 'Ended at'], rows }
    }
    case 'RPT-004': {
      const rows = ctx.orders.filter((o) => !o.archived && Object.keys(WAITING).includes(o.state) && o.ageDays > 5)
        .sort((a, b) => b.ageDays - a.ageDays)
      return {
        label: 'Requests waiting more than 5 days',
        columns: [...ORDER_COLUMNS, 'Waiting on', 'Age (days)'],
        rows: rows.map((o) => orderRow(o, [o.waitingOn ?? '—', o.ageDays])),
      }
    }
    case 'RPT-005': {
      const maxAttemptByOrder = new Map<string, number>()
      ctx.runs.forEach((r) => maxAttemptByOrder.set(r.orderId, Math.max(maxAttemptByOrder.get(r.orderId) ?? 0, r.attempt)))
      const rows = ctx.orders.filter((o) => (maxAttemptByOrder.get(o.id) ?? 0) >= 2)
      return {
        label: 'Requests that needed more than one attempt',
        columns: [...ORDER_COLUMNS, 'Attempts', 'Retry succeeded'],
        rows: rows.map((o) => orderRow(o, [maxAttemptByOrder.get(o.id) ?? 1, o.state === 'Ready' ? 'Yes' : 'No'])),
      }
    }
    case 'RPT-006': {
      const rows = ctx.orders.filter((o) => !o.archived && o.slaBreached)
      return {
        label: 'Requests past their promised turnaround time',
        columns: [...ORDER_COLUMNS, 'Waiting on', 'Age (days)'],
        rows: rows.map((o) => orderRow(o, [o.waitingOn ?? '—', o.ageDays])),
      }
    }
    case 'RPT-007': {
      const rows = ctx.pools.filter((p) => p.total > 0 && (p.total - p.allocated - p.quarantined) / p.total < 0.1)
      return {
        label: 'Pools under 10% free',
        columns: ['Pool ID', 'Kind', 'Scope', 'Total', 'Allocated', 'Quarantined', 'Free', 'Free %'],
        rows: rows.map((p) => {
          const free = p.total - p.allocated - p.quarantined
          return [p.id, p.kind, p.scope, p.total, p.allocated, p.quarantined, free, Math.round((free / p.total) * 100)]
        }),
      }
    }
    case 'RPT-008': {
      const worst = worstBy(ctx.orders, (o) => o.endpoints[0]?.vendor, RISK_FAIL, 3)
      const rows = worst ? ctx.orders.filter((o) => o.endpoints[0]?.vendor === worst.key) : []
      return {
        label: worst ? `Requests on ${worst.key} equipment, the estate's worst-performing vendor` : 'No vendor has enough volume to compare',
        columns: [...ORDER_COLUMNS, 'Vendor', 'Device'],
        rows: rows.map((o) => orderRow(o, [o.endpoints[0]?.vendor ?? '—', o.endpoints[0]?.deviceName ?? '—'])),
      }
    }
    case 'RPT-009': {
      const order = ctx.orders.find((o) => report.snapshot.startsWith(o.id))
      const service = order ? ctx.services.find((s) => s.id === order.serviceId) : undefined
      const evidence = service?.acceptanceEvidence ?? []
      return {
        label: `Acceptance evidence for ${service?.name ?? order?.id ?? report.snapshot}`,
        columns: ['Service ID', 'Service name', 'Order ID', 'Criterion', 'Layer', 'Expected', 'Actual', 'Passed'],
        rows: evidence.map((e) => [service?.id ?? '—', service?.name ?? '—', order?.id ?? '—', e.criterion, e.layer, e.expected, e.actual, e.passed ? 'Yes' : 'No']),
      }
    }
    default:
      return { label: 'No underlying records are modelled for this report in the prototype', columns: [], rows: [] }
  }
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(',')
}

export function reportToCsv(report: ReportDef, ctx: ReportContext): string {
  const dataset = buildDataset(report, ctx)
  const lines = [
    csvRow(['Report', 'Question', 'Cadence', 'Audience', 'Last run', 'Snapshot', 'Headline', 'Change', 'Status']),
    csvRow([report.name, report.question, report.cadence, report.audience, report.lastRunAt, report.snapshot, report.headline, report.deltaLabel, report.state]),
    '',
  ]

  if (report.failureReason) lines.push(csvRow(['Generation failed', report.failureReason]), '')

  lines.push(csvRow([`${dataset.label} (${dataset.rows.length} record${dataset.rows.length === 1 ? '' : 's'})`]))
  if (dataset.columns.length) {
    lines.push(csvRow(dataset.columns))
    dataset.rows.forEach((row) => lines.push(csvRow(row)))
  }
  lines.push('')

  lines.push(csvRow(['Run', 'Snapshot', 'Value', 'Change']))
  report.history.forEach((h) => lines.push(csvRow([h.at, h.snapshot, h.value, h.delta])))

  return lines.join('\n')
}

export function downloadReportCsv(report: ReportDef, ctx: ReportContext): void {
  const blob = new Blob([reportToCsv(report, ctx)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${report.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${report.snapshot}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
