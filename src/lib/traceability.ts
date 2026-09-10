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

/* ---------------------------------------------------------------- origin */

/**
 * Where a service came from, which is not the same question as how well it can
 * be followed.
 *
 * A service is only ever created by a create request that executed
 * successfully — that rule holds for everything done in the platform. It does
 * not describe the estate that was already there when the platform arrived,
 * and most of this base is exactly that. Stating it on the row turns a service
 * with no request behind it from something that looks broken into something
 * that is labelled.
 */
export type ServiceOrigin = 'provisioned' | 'managed' | 'inherited'

export const ORIGIN_LABEL: Record<ServiceOrigin, string> = {
  provisioned: 'Provisioned here',
  managed: 'Managed here',
  inherited: 'Inherited',
}

export const ORIGIN_BLURB: Record<ServiceOrigin, string> = {
  provisioned: 'A create request in this system executed successfully and produced this service.',
  managed: 'Older than the platform, but requests raised here have since changed it.',
  inherited: 'Part of the baseline estate. No request on record, so its details can only be taken at face value.',
}

/**
 * Origin per service id, built once from the order list. Anything absent is
 * inherited — the common case, and the reason this returns a lookup rather
 * than a field on the service.
 */
export function serviceOrigins(orders: Order[]): Map<string, ServiceOrigin> {
  const m = new Map<string, ServiceOrigin>()
  orders.forEach((o) => {
    if (!o.serviceId) return
    /* Only a completed create explains why a service exists; a create still in
       flight has not produced anything yet. */
    if (o.intent === 'Create' && o.state === 'Ready') { m.set(o.serviceId, 'provisioned'); return }
    if (!m.has(o.serviceId)) m.set(o.serviceId, 'managed')
  })
  return m
}
