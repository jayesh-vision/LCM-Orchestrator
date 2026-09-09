import type { Conformance, OrderState, RunOutcome, ServiceState, TaskState, WorkflowState } from '@/types'
import type { Tone } from '@/components/ui'

export const ORDER_TONE: Record<OrderState, Tone> = {
  Draft: 'none',
  Planned: 'info',
  Validated: 'teal',
  Invalid: 'warn',
  Approved: 'good',
  Rejected: 'warn',
  Queued: 'info',
  'In progress': 'info',
  Ready: 'good',
  Failed: 'crit',
  Reinstantiate: 'plum',
}

export const SERVICE_TONE: Record<ServiceState, Tone> = {
  Designed: 'none', Activating: 'info', Live: 'good', Degraded: 'warn',
  Suspended: 'warn', Ceasing: 'plum', Ceased: 'none', Purged: 'none',
}

export const CONFORMANCE_TONE: Record<Conformance, Tone> = {
  Conformant: 'good', Drifted: 'warn', 'Never proven': 'none', Ghost: 'crit', 'Not checked': 'none',
}

export const TASK_TONE: Record<TaskState, Tone> = {
  'Not started': 'none', Queued: 'warn', Running: 'info', Passed: 'good',
  Failed: 'crit', Blocked: 'plum', Skipped: 'warn',
}

export const RUN_TONE: Record<RunOutcome, Tone> = {
  Running: 'info', Accepted: 'good', Failed: 'crit',
  'Rolled back': 'warn', 'Rolled back with residue': 'warn', Aborted: 'none',
}

export const WORKFLOW_TONE: Record<WorkflowState, Tone> = {
  Draft: 'none', Assigned: 'info', 'Awaiting approval': 'plum',
  Active: 'good', Rejected: 'crit', Retired: 'none',
}

export const CATEGORY_TONE: Record<string, Tone> = {
  L2VPN: 'info', L3VPN: 'plum', IBW: 'teal', Broadband: 'good', Microwave: 'warn', DWDM: 'crit',
}

/** Domain badge tone — one per Domain. With 7 tones and now 4 domains + 6
 *  categories, full disjointness from CATEGORY_TONE no longer fits the
 *  palette; each chip is text-labelled, so a colour repeating across an
 *  unrelated domain and category isn't ambiguous in context. */
export const DOMAIN_TONE: Record<string, Tone> = { Transport: 'none', Access: 'warn', Radio: 'info', Fiber: 'teal' }

export const INTENT_TONE: Record<string, Tone> = {
  Create: 'info', Modify: 'plum', Suspend: 'warn', Resume: 'good', Cease: 'crit', 'Re-prove': 'teal',
}

export function relTime(iso?: string): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return `${Math.round(d / 30)} mo ago`
}

export function shortDate(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function clockTime(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function dur(ms?: number): string {
  if (ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(2)} s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

export function inr(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`
  return `₹${n.toLocaleString('en-IN')}`
}

export function ageLabel(days: number): string {
  if (days === 0) return 'today'
  if (days < 1) return '< 1 d'
  return `${days} d`
}
