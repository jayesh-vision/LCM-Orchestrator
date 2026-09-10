import type { Order, ReportDef, ResourcePool, Run, Service } from '@/types'

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

const SERVICE_COLUMNS = ['Service ID', 'Service name', 'Order ID', 'Account', 'Category', 'Type', 'State', 'Conformance']

/** Order ID + owner a service can be traced back to, preferring the order that created it. */
function buildServiceOrderIndex(orders: Order[]): Map<string, Order> {
  const m = new Map<string, Order>()
  orders.forEach((o) => {
    if (!o.serviceId) return
    const existing = m.get(o.serviceId)
    if (!existing || (o.intent === 'Create' && existing.intent !== 'Create') || (o.intent === existing.intent && o.updatedAt > existing.updatedAt)) {
      m.set(o.serviceId, o)
    }
  })
  return m
}

function serviceRow(s: Service, orderIdx: Map<string, Order>, extra: (string | number)[]): (string | number)[] {
  const o = orderIdx.get(s.id)
  return [s.id, s.name, o?.id ?? 'No order on record', s.accountName, s.category, s.type, s.state, s.conformance, ...extra]
}

function buildDataset(report: ReportDef, ctx: ReportContext): ReportDataset {
  const orderIdx = buildServiceOrderIndex(ctx.orders)

  switch (report.id) {
    case 'RPT-001': {
      const rows = ctx.services.filter((s) => s.conformance === 'Ghost')
      return {
        label: 'Services billed with no configuration on the device',
        columns: [...SERVICE_COLUMNS, 'Monthly value (INR)', 'Live since'],
        rows: rows.map((s) => serviceRow(s, orderIdx, [s.monthlyValueInr, s.liveSince])),
      }
    }
    case 'RPT-002': {
      const rows = ctx.services.filter((s) => s.conformance === 'Never proven')
      return {
        label: 'Live services with no end-to-end evidence, ever',
        columns: [...SERVICE_COLUMNS, 'Live since', 'Age'],
        rows: rows.map((s) => serviceRow(s, orderIdx, [s.liveSince, s.ageLabel])),
      }
    }
    case 'RPT-003': {
      const rows = ctx.services.filter((s) => s.conformance === 'Drifted')
      return {
        label: 'Services with open drift',
        columns: [...SERVICE_COLUMNS, 'Drift count', 'Last proven', 'Owner'],
        rows: rows.map((s) => serviceRow(s, orderIdx, [s.driftCount, s.lastProvenAt ?? 'never', orderIdx.get(s.id)?.owner ?? 'Unassigned'])),
      }
    }
    case 'RPT-004': {
      const rows = ctx.runs.filter((r) => r.attempt === 1 && r.outcome === 'Failed')
      return {
        label: 'First-attempt runs that failed, and the task that failed',
        columns: ['Run ID', 'Order ID', 'Workflow ID', 'Outcome', 'Failing task', 'Failure reason', 'Started at'],
        rows: rows.map((r) => {
          const failing = r.tasks.find((t) => t.state === 'Failed')
          return [r.id, r.orderId, r.workflowId, r.outcome, failing?.name ?? 'Unknown', failing?.failureReason ?? 'Not recorded', r.startedAt]
        }),
      }
    }
    case 'RPT-005': {
      const rows = ctx.runs.filter((r) => r.outcome === 'Rolled back with residue' || (r.residue && r.residue.length > 0))
      return {
        label: 'Rollbacks that ran but left something behind',
        columns: ['Run ID', 'Order ID', 'Workflow ID', 'Outcome', 'Residue left behind', 'Started at'],
        rows: rows.map((r) => [r.id, r.orderId, r.workflowId, r.outcome, (r.residue ?? []).join('; ') || 'Not itemised', r.startedAt]),
      }
    }
    case 'RPT-006': {
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
    case 'RPT-007': {
      const rows: (string | number)[][] = []
      ctx.pools.forEach((p) => p.entries.forEach((e) => {
        if (e.state === 'Allocated' && !e.serviceId) rows.push([p.id, p.kind, p.scope, e.value, e.state])
      }))
      return { label: 'Allocated configuration with no owning service record', columns: ['Pool ID', 'Kind', 'Scope', 'Value', 'State'], rows }
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
