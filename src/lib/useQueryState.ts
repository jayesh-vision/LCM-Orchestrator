import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * A filter value that lives in the URL instead of component state.
 *
 * Every drill-down in the app is a link, so the filtered view is shareable,
 * survives a reload, and the browser Back button steps back out of the
 * filter rather than off the screen.
 */
export function useQueryState<T extends string = string>(key: string, fallback: NoInfer<T>) {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const value = (raw === null || raw === '' ? fallback : raw) as T

  const set = useCallback((next: T) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (next === fallback || next === '') p.delete(key)
      else p.set(key, next)
      return p
    }, { replace: true })
  }, [key, fallback, setParams])

  return [value, set] as const
}

/**
 * Set several filter keys in one navigation.
 *
 * Two separate setter calls in the same event handler do NOT compose — each
 * resolves against the same starting params, so the second silently discards
 * the first. Anything that changes more than one filter must go through here.
 */
export function useQueryPatch() {
  const [, setParams] = useSearchParams()
  return useCallback((patch: Record<string, string | null | undefined>) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '' || v === 'All') p.delete(k)
        else p.set(k, v)
      })
      return p
    }, { replace: true })
  }, [setParams])
}

/** Clear a named set of filter keys, leaving anything else in the URL alone. */
export function useClearQuery(keys: string[]) {
  const [, setParams] = useSearchParams()
  return useCallback(() => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      keys.forEach((k) => p.delete(k))
      return p
    }, { replace: true })
  }, [setParams, keys.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * A drill-down arrives with filters already applied, and the results grid is
 * usually below the fold. Scroll it into view once, on arrival only — never
 * when the user changes a filter themselves.
 */
export function useScrollToResultsOnDrillIn(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const done = useRef(false)
  useEffect(() => {
    if (!active || done.current || !ref.current) return
    done.current = true
    const el = ref.current
    const t = window.setTimeout(() => {
      const y = el.getBoundingClientRect().top + window.scrollY - 72
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    }, 60)
    return () => window.clearTimeout(t)
  }, [active])
  return ref
}

/** Multi-valued filter: `state=Failed,Rejected` matches any of them. */
export function splitMulti(v: string): string[] {
  return v === 'All' || !v ? [] : v.split(',').map((s) => s.trim()).filter(Boolean)
}
