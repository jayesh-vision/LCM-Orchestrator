import type { Order, Service } from '@/types'

/**
 * How far a record can actually be followed.
 *
 * Not every row in this estate carries the same weight of evidence: some
 * services were provisioned through the platform and can be walked back to the
 * request, the template and the run that produced them, while others are older
 * records the platform inherited and can only be taken at face value. Ranking
 * on that puts the rows worth opening at the top of a list, rather than
 * whichever happened to be generated first.
 *
 * Scores are only meaningful against each other inside one list.
 */

/** Weighted so provenance — a real order behind the row — dominates. */
export function orderTrace(o: Order, hasRun: (orderId: string) => boolean): number {
  let n = 0
  if (o.serviceId) n += 4                                              // produced or targets a service
  if (hasRun(o.id)) n += 3                                             // was actually executed
  if (o.endpoints.length > 0 && o.endpoints.every((e) => e.workflowId)) n += 2  // every end has a template
  if (o.params.length > 0) n += 1
  return n
}

export function serviceTrace(s: Service, referenced: Set<string>): number {
  let n = 0
  if (referenced.has(s.id)) n += 4                                     // an order in the system created or changed it
  if (s.acceptanceEvidence?.length) n += 2                             // it was proven, and the proof is kept
  if (s.resources.length) n += 2                                       // it holds resources drawn from a pool
  if (s.lastProvenAt) n += 1
  return n
}

/**
 * Sort by traceability, most complete first, without disturbing the relative
 * order of rows that score the same — so the existing newest-first ordering
 * still shows through within each band.
 */
export function byTraceability<T>(rows: T[], score: (row: T) => number): T[] {
  return rows
    .map((row, i) => ({ row, i, s: score(row) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.row)
}
