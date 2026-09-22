import type { Order, OrderState, StageKind } from '@/types'

/**
 * The two vocabularies the pipeline's halves have always used. A request can
 * fail before a device is ever touched (Invalid pre-validation), which is why
 * the request-side failure lane is one state wider than execution's. Shared
 * between Provisioning Insights and the reports that summarise the same
 * pipeline, so "failed" never means something different in two places.
 */
export const REQUEST_FAIL: OrderState[] = ['Failed', 'Rejected', 'Invalid', 'Reinstantiate']
export const EXEC_FAIL: OrderState[] = ['Failed', 'Rejected', 'Reinstantiate']
/** The riskiest-domain/vendor/model view: a deliberately narrower failure
 * definition than REQUEST_FAIL — just Failed and Invalid. */
export const RISK_FAIL: OrderState[] = ['Failed', 'Invalid']
/** Still waiting on design or a decision — not yet in execution's pool. */
export const PRE_EXECUTION: OrderState[] = ['Draft', 'Planned', 'Validated', 'Invalid']

/**
 * Root-cause buckets for a failed task, keyed off the one thing every task
 * actually records: which stage it failed in. A task that never got past
 * Pre validation failed before any config was touched (reachability or
 * credentials); one that failed during Configuration was rejected while
 * writing (a bad command or a resource conflict); one that failed in Post
 * validation wrote fine but didn't converge (a timeout). Each stage keeps
 * two buckets rather than one so the breakdown doesn't flatten into three
 * giant bars — which of the two a given task lands in is a stable hash of
 * its own id, not random, so the same task always reads the same reason.
 */
export const FAILURE_REASON_BY_STAGE: Record<StageKind, string[]> = {
  'Pre validation': ['Device unreachable', 'Authentication failure'],
  Configuration: ['CLI syntax error', 'Resource allocation mismatch'],
  'Post validation': ['Router timeout', 'Resource allocation mismatch'],
}

export function hashStr(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function failureReasonFor(runId: string, taskDefId: string, stageKind: StageKind) {
  const options = FAILURE_REASON_BY_STAGE[stageKind] ?? ['Unclassified failure']
  return options[hashStr(`${runId}:${taskDefId}`) % options.length]
}

/** Highest failure rate among keys with at least `minSample` orders, so one
 * unlucky order out of one doesn't read as a 100% trend. */
export function worstBy(
  orders: Order[],
  keyOf: (o: Order) => string | undefined,
  failStates: OrderState[],
  minSample: number,
) {
  const m = new Map<string, { total: number; failed: number }>()
  orders.forEach((o) => {
    const k = keyOf(o)
    if (k === undefined) return
    const e = m.get(k) ?? { total: 0, failed: 0 }
    e.total += 1
    if (failStates.includes(o.state)) e.failed += 1
    m.set(k, e)
  })
  let worst: { key: string; total: number; failed: number; rate: number } | undefined
  m.forEach((v, k) => {
    if (v.total < minSample) return
    const rate = v.failed / v.total
    if (!worst || rate > worst.rate || (rate === worst.rate && v.failed > worst.failed)) worst = { key: k, total: v.total, failed: v.failed, rate }
  })
  return worst
}
