import type { Conformance, Service } from '@/types'

/**
 * One definition of the conformance breakdown, shared by every screen that
 * reports it.
 *
 * This exists because it previously did not: the Dashboard counted four
 * verdicts and quietly dropped the fifth, the Service Inventory donut folded
 * that fifth into "Never proven", and the KPI card beside it did neither — so
 * the same 154 services were reported three different ways and the two screens
 * disagreed on the size of the estate. Anything that shows this breakdown now
 * derives it here, so the numbers cannot drift apart again.
 */

/** Worst-last, which is the order every breakdown on screen reads in. */
export const CONFORMANCE_ORDER: Conformance[] = [
  'Conformant', 'Drifted', 'Never proven', 'Ghost', 'Not checked',
]

/**
 * What each verdict claims. "Never proven" and "Not checked" are genuinely
 * different states and must not be merged: never-proven means the service is
 * configured and carrying traffic but nobody has ever tested it end to end,
 * which is a real risk someone should act on. Not-checked means conformance
 * does not apply — the service is ceased, or still activating — which is not
 * a risk at all. Merging them inflates the risk figure with records nobody
 * needs to do anything about.
 */
export const CONFORMANCE_BLURB: Record<Conformance, string> = {
  Conformant: 'Matches the intent exactly.',
  Drifted: 'Changed since it was last proven.',
  'Never proven': 'Never independently verified.',
  Ghost: 'No configuration on the device.',
  'Not checked': 'Ceased or activating — not applicable.',
}

export interface ConformanceBreakdown {
  counts: Record<Conformance, number>
  /** Always the full base: every service holds exactly one verdict. */
  total: number
  share: (c: Conformance) => number
}

export function conformanceBreakdown(services: Service[]): ConformanceBreakdown {
  const counts = {
    Conformant: 0, Drifted: 0, 'Never proven': 0, Ghost: 0, 'Not checked': 0,
  } as Record<Conformance, number>
  services.forEach((s) => { if (s.conformance in counts) counts[s.conformance] += 1 })
  const total = services.length
  return {
    counts,
    total,
    share: (c) => (total ? Math.round((counts[c] / total) * 100) : 0),
  }
}
