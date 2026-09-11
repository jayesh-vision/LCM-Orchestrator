import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { InfoTip } from '@/components/ui'

/* ------------------------------------------------------------------
   Chart fills, taken from the NST palette (colors.css / theme-tokens.css).
   BRAND is the single magnitude hue; GOOD / WARN / CRIT are the fixed
   status roles. Amber still sits below 3:1 on white, so every status
   fill here carries a direct label — the required relief, not decoration.
   ------------------------------------------------------------------ */
export const FILL = {
  brand: '#1c81ef',      /* --primaryColor500      */
  brandSoft: '#dbeafe',  /* --primaryColor100      */
  /* One shade lighter than the emerald/red-600 badge tokens — a chart fill
     covers a much larger area than a status chip, so the 600 weight that
     reads fine on a small pill reads as glaring across a full bar or
     segment. 500 keeps the same hue at a calmer intensity. */
  good: '#10b981',       /* --vw-color-emerald-500 */
  warn: '#f59e0b',       /* --vw-color-amber-500   */
  crit: '#ef4444',       /* --vw-color-red-500     */
  none: '#9ca3af',       /* --vw-color-gray-400    */
  grid: '#e2e8f0',       /* --vw-color-slate-200   */
} as const

export type FillKey = keyof typeof FILL

/* Chart palette from the NST "Dashboard Charts" specimen: a brand-blue ramp for
   progression, grey for waiting, red only for failure. Every value is a
   colors.css / theme-tokens.css token. */
export const CHART = {
  blue200: '#bfdbfe', /* --vw-color-blue-200 */
  blue300: '#93c5fd', /* --vw-color-blue-300 */
  blue400: '#60a5fa', /* --vw-color-blue-400 */
  blue500: '#3b82f6', /* --vw-color-blue-500 */
  blue600: '#2563eb', /* --vw-color-blue-600 */
  blue700: '#1d4ed8', /* --vw-color-blue-700 */
  blue900: '#1e3a8a', /* --vw-color-blue-900 */
  sky400:  '#38bdf8', /* --vw-color-sky-400  */
  gray300: '#d1d5db', /* --vw-color-gray-300 */
  gray400: '#9ca3af', /* --vw-color-gray-400 */
  red300:  '#fca5a5', /* --vw-color-red-300  */
  red400:  '#f87171', /* --vw-color-red-400  */
  red500:  '#ef4444', /* --vw-color-red-500  */
} as const

/* A soft, light palette for large chart fills — donut rings, stacked
   bars/columns, trend lines. FILL/badge tones above (500–600 weight) are
   tuned for small chips and thin bars; the same saturation across a whole
   donut ring or a full-height stacked bar reads far more intense, so pages
   that want a calmer, "soothing" look (Dashboard, Provisioning Insights)
   use these lighter 300-weight tints instead via an explicit `color`
   override alongside the usual `fill` tone. */
export const SOFT = {
  brand: '#93c5fd', // blue-300
  good: '#6ee7b7',  // emerald-300
  warn: '#fcd34d',  // amber-300
  crit: '#fca5a5',  // red-300
  none: '#d1d5db',  // gray-300
  purple: '#d8b4fe', // purple-300
  cyan: '#67e8f9',   // cyan-300
} as const

/** Measures its own box so a chart can stretch to fill the card it lives in,
 * instead of centering at a fixed aspect ratio and leaving dead space below
 * it when the card is taller than the chart's natural height (e.g. the
 * dashboard's trend card next to a longer "Running now" list). */
function useFill<T extends HTMLElement>(fallback: { w: number; h: number }) {
  const ref = useRef<T>(null)
  const [size, setSize] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Measure synchronously on mount rather than waiting for the observer's
    // first callback — a backgrounded/occluded tab can defer that callback
    // indefinitely even though layout has already run.
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 0 && height > 0) setSize({ w: width, h: height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const paint = (fill?: FillKey, color?: string) => color ?? FILL[fill ?? 'brand']

/* ---------------------------------------------------- horizontal bar list */
export interface BarItem {
  label: string; value: number; tone?: FillKey; sub?: string; onClick?: () => void; drillLabel?: string
  /** Raw CSS color for the bar; wins over `tone`. Lets a list use a ramp. */
  color?: string
  /** Shown in the value column instead of the bare number, e.g. "27% free". */
  valueLabel?: string
}

export function BarList({ items, labelWidth = 150, max, valueWidth = 56, className = '' }:
{ items: BarItem[]; labelWidth?: number; max?: number; valueWidth?: number; className?: string }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {items.map((it, idx) => {
        const cols = { gridTemplateColumns: `${labelWidth}px 1fr ${valueWidth}px` }
        const inner = (
          <>
            <div className="text-[12.5px] text-ink-2 text-right leading-tight">
              {it.label}
              {it.sub && <div className="text-[11px] text-ink-3">{it.sub}</div>}
            </div>
            <div className="h-5 bg-line-soft rounded overflow-hidden">
              <div
                className="h-full rounded-r transition-all duration-500 min-w-[3px]"
                style={{ width: `${(it.value / top) * 100}%`, background: it.color ?? FILL[it.tone ?? 'brand'] }}
              />
            </div>
            <div className="text-[13px] font-semibold tnum text-ink-1 whitespace-nowrap">{it.valueLabel ?? it.value.toLocaleString()}</div>
          </>
        )
        if (!it.onClick) {
          return <div key={`${it.label}-${idx}`} className="grid items-center gap-3" style={cols}>{inner}</div>
        }
        return (
          <button
            key={`${it.label}-${idx}`} type="button" onClick={it.onClick}
            aria-label={it.drillLabel ?? `${it.label}: ${it.value}. Open the matching list`}
            className="grid items-center gap-3 w-full text-left rounded-md -mx-1.5 px-1.5 py-0.5 cursor-pointer
              hover:bg-plane focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
            style={cols}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------ labelled stacked bar + legend */
export interface StackSegment { label: string; value: number; fill: FillKey; color?: string; note?: string; onClick?: () => void }

export function StackedBar({ segments, ariaLabel, compact = false }:
{ segments: StackSegment[]; ariaLabel: string; compact?: boolean }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div>
      <div className={`flex ${compact ? 'h-5' : 'h-9'} rounded-lg overflow-hidden gap-0.5`} role="img" aria-label={ariaLabel}>
        {segments.map((s) => {
          const pct = (s.value / total) * 100
          /* good/crit are now a lighter 500 weight (see FILL) — too light for
             reliable white-text contrast, so they take dark labels too. */
          const dark = s.fill === 'warn' || s.fill === 'none' || s.fill === 'good' || s.fill === 'crit'
            || (s.color !== undefined && /^#(9|a|b|c|d|e|f)/i.test(s.color))
          const Tag = s.onClick ? 'button' : 'div'
          return (
            <Tag
              key={s.label}
              {...(s.onClick ? { type: 'button' as const, onClick: s.onClick, 'aria-label': `${s.label}: ${s.value}. Open the matching list` } : {})}
              className={`grid place-items-center text-[12px] font-semibold min-w-[2px] transition-all duration-500 border-0
                ${s.onClick ? 'cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white' : ''}`}
              style={{ width: `${pct}%`, background: paint(s.fill, s.color), color: dark ? 'var(--vw-color-gray-900)' : 'var(--vw-color-white)' }}
              title={`${s.label}: ${s.value.toLocaleString()}`}
            >
              {pct > 6 ? s.value.toLocaleString() : ''}
            </Tag>
          )
        })}
      </div>
      <div className={`flex ${compact ? 'gap-x-4 gap-y-1 mt-1.5' : 'gap-x-6 gap-y-2.5 mt-3'} flex-wrap`}>
        {segments.map((s) => {
          const body = (
            <>
              <i className="w-2.5 h-2.5 rounded-[3px] shrink-0 mt-1" style={{ background: paint(s.fill, s.color) }} />
              <span>
                <b className="text-ink-1 font-semibold tnum">{s.value.toLocaleString()}</b> {s.label}
                {s.note && <span className="block text-ink-3">{s.note}</span>}
              </span>
            </>
          )
          if (!s.onClick) return <div key={s.label} className="flex items-start gap-2 text-[12px] text-ink-2">{body}</div>
          return (
            <button
              key={s.label} type="button" onClick={s.onClick}
              aria-label={`${s.label}: ${s.value}. Open the matching list`}
              className="flex items-start gap-2 text-[12px] text-ink-2 text-left rounded-md -m-1 p-1 cursor-pointer
                hover:bg-plane hover:text-ink-1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
            >
              {body}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ donut */
export interface DonutSegment { label: string; value: number; fill: FillKey; color?: string; onClick?: () => void }

/**
 * The legend beside a donut. Every row is a drill-down when given an onClick,
 * which is also what makes the chart keyboard-reachable — the arcs alone are not.
 */
export function DonutLegend({ segments, columns = 1 }: { segments: DonutSegment[]; columns?: 1 | 2 }) {
  return (
    <div className={`grid gap-x-3 gap-y-1.5 text-[12px] ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {segments.map((s) => {
        const body = (
          <>
            <span className="flex items-center gap-1.5 min-w-0">
              <i className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: paint(s.fill, s.color) }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="font-semibold tnum text-ink-1">{s.value.toLocaleString()}</span>
          </>
        )
        if (!s.onClick) return <div key={s.label} className="flex items-center justify-between gap-2 text-ink-2">{body}</div>
        return (
          <button
            key={s.label} type="button" onClick={s.onClick}
            aria-label={`${s.label}: ${s.value}. Open the matching list`}
            className="flex items-center justify-between gap-2 text-ink-2 text-left rounded -mx-1 px-1 cursor-pointer
              hover:bg-plane hover:text-brand-600 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}

export function Donut({ segments, total, caption, size = 132 }:
{ segments: DonutSegment[]; total?: number; caption?: ReactNode; size?: number }) {
  const sum = total ?? segments.reduce((a, s) => a + s.value, 0)
  const r = 54; const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 132 132" role="img" aria-label={`Total ${sum}`}>
        <circle cx="66" cy="66" r={r} fill="none" stroke={FILL.grid} strokeWidth="15" />
        {segments.filter((s) => s.value > 0).map((s) => {
          const frac = s.value / (sum || 1)
          const dash = frac * c
          const el = (
            <circle
              key={s.label} cx="66" cy="66" r={r} fill="none"
              stroke={paint(s.fill, s.color)} strokeWidth="15"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 66 66)"
              onClick={s.onClick}
              style={s.onClick ? { cursor: 'pointer' } : undefined}
            >
              <title>{`${s.label}: ${s.value.toLocaleString()}`}</title>
            </circle>
          )
          offset += dash
          return el
        })}
        <text x="66" y="62" textAnchor="middle" className="fill-ink-1" style={{ fontSize: 24, fontWeight: 600 }}>{sum.toLocaleString()}</text>
        <text x="66" y="80" textAnchor="middle" className="fill-ink-3" style={{ fontSize: 10.5 }}>total</text>
      </svg>
      {caption && <div className="min-w-0 flex-1">{caption}</div>}
    </div>
  )
}

/* --------------------------------------------------------------- sparkline */
export function TrendLine({ points, tone = 'brand', height = 96, labels, ariaLabel = 'Trend over the last four runs' }:
{ points: number[]; tone?: FillKey; height?: number; labels?: string[]; ariaLabel?: string }) {
  if (points.length < 2) return null
  const w = 420; const pad = 26
  const min = Math.min(...points); const max = Math.max(...points)
  const span = max - min || 1
  const xs = points.map((_, i) => pad + (i * (w - pad * 2)) / (points.length - 1))
  const ys = points.map((p) => 18 + (1 - (p - min) / span) * (height - 46))
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
      <line x1={pad} y1={height - 22} x2={w - pad} y2={height - 22} stroke={FILL.grid} />
      <path d={path} fill="none" stroke={FILL[tone]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {xs.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={ys[i]} r={i === xs.length - 1 ? 5 : 4} fill={FILL[tone]} stroke="#fff" strokeWidth="2" />
          {labels?.[i] && (
            <text x={x} y={height - 6} textAnchor="middle" style={{ fontSize: 10 }} className="fill-ink-3">{labels[i]}</text>
          )}
        </g>
      ))}
      <text x={xs[xs.length - 1]} y={ys[ys.length - 1] - 11} textAnchor="end" style={{ fontSize: 11.5, fontWeight: 600 }} className="fill-ink-1">
        {points[points.length - 1]}
      </text>
    </svg>
  )
}

/* ------------------------------------------------------- coverage matrix */
/**
 * One rich row per intent: name + workflow count on the left, a coloured
 * status tile per vendor in the middle, and a proportional live-services bar
 * on the right. The bar flexes to absorb the card's leftover width, so the
 * widget reads dense at any size instead of stretching a sparse table.
 */
export interface CoverageCol { key: string; label: string; sub?: string; icon?: ComponentType<{ size?: number; className?: string }> }

export function CoverageMatrix({ rows, cols, cell, onCellClick, onTrailingClick, trailingLabel = 'Live services' }:
{
  rows: { key: string; label: string; sub?: string; trailing: number }[]
  cols: CoverageCol[]
  cell: (r: string, c: string) => { count?: number; state: 'built' | 'draft' | 'gap' | 'na' }
  /** Drill into the workflows behind one intent × vendor tile. */
  onCellClick?: (rowKey: string, col: string) => void
  /** Drill into whatever the trailing bar counts, for that row. */
  onTrailingClick?: (rowKey: string) => void
  trailingLabel?: string
}) {
  const maxT = Math.max(1, ...rows.map((r) => r.trailing))
  const totalT = rows.reduce((a, r) => a + r.trailing, 0) || 1
  const gridCols = `minmax(180px,230px) repeat(${cols.length}, minmax(112px,128px)) minmax(210px,1fr)`

  const tile: Record<string, { box: string; big: string; sub: string }> = {
    built: { box: 'bg-good-50 border-good-200', big: 'text-good-700', sub: 'text-good-700/75' },
    draft: { box: 'bg-warn-50 border-warn-200', big: 'text-warn-700', sub: 'text-warn-700/75' },
    gap: { box: 'bg-plane border-dashed border-line', big: 'text-ink-3', sub: 'text-ink-3' },
    na: { box: 'bg-transparent border-transparent', big: 'text-line', sub: 'text-line' },
  }

  /* A shadow on the frozen Intent column only once there's something
     scrolled behind it — otherwise the column edge looks identical to
     the rest of the table and the "content passes behind it" behaviour
     reads as a rendering glitch instead of an intentional frozen column. */
  const [scrolled, setScrolled] = useState(false)
  const stickyShadow = scrolled ? 'shadow-[6px_0_8px_-6px_rgba(15,23,42,0.16)]' : ''

  return (
    <div className="overflow-x-auto" onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
      <div role="table" aria-label="Workflow coverage by intent and vendor" style={{ minWidth: 340 + cols.length * 128 }}>
        <div role="row" className="grid gap-2.5 px-3.5 pb-2" style={{ gridTemplateColumns: gridCols }}>
          {/* Sticky so the Intent label stays put while the vendor columns
             scroll underneath it — without this, a domain with enough
             vendors to overflow the card loses the one column that says
             which row you're looking at. */}
          <div role="columnheader" className={`sticky left-0 z-10 bg-white pr-2 -mr-2.5 text-[11px] font-semibold uppercase tracking-[.07em] text-ink-3 ${stickyShadow}`}>Intent</div>
          {cols.map((c) => (
            <div key={c.key} role="columnheader" className="flex flex-col items-center gap-0.5 text-center">
              {c.icon && <c.icon size={13} className="text-ink-3" />}
              <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-ink-3 leading-tight">{c.label}</span>
              {c.sub && <span className="text-[9.5px] text-ink-3/70 leading-tight">{c.sub}</span>}
            </div>
          ))}
          <div role="columnheader" className="text-[11px] font-semibold uppercase tracking-[.07em] text-ink-3 text-right">{trailingLabel}</div>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const share = Math.round((r.trailing / totalT) * 100)
            return (
              <div key={r.key} role="row"
                className="grid gap-2.5 items-center border border-line rounded-lg px-3.5 py-2.5 transition-colors hover:border-brand-200 hover:bg-plane"
                style={{ gridTemplateColumns: gridCols }}>
                <div role="rowheader" className={`sticky left-0 z-10 self-stretch flex flex-col justify-center bg-white min-w-0 pr-2 -mr-2.5 -my-2.5 py-2.5 pl-3.5 -ml-3.5 ${stickyShadow}`}>
                  <div className="text-[13px] font-semibold text-ink-1 truncate" title={r.label}>{r.label}</div>
                  {r.sub && <div className="text-[11px] text-ink-3 mt-0.5 truncate">{r.sub}</div>}
                </div>
                {cols.map((c) => {
                  const v = cell(r.key, c.key)
                  const t = tile[v.state]
                  if (v.state === 'na') {
                    return (
                      <div key={c.key} role="cell" className="flex items-center justify-center text-[13px] text-line" aria-label={`${r.label} on ${c.label}: not applicable`}>
                        —
                      </div>
                    )
                  }
                  const big = v.state === 'built' ? v.count : v.state === 'draft' ? 'Draft' : '—'
                  const sub = v.state === 'built' ? (v.count === 1 ? 'active workflow' : 'active workflows')
                    : v.state === 'draft' ? 'not approved yet' : 'no workflow'
                  const inner = (
                    <span className={`flex flex-col items-center justify-center w-full rounded-lg border px-2 py-1.5 ${t.box}`}>
                      <span className={`text-[15px] font-semibold tnum leading-tight ${t.big}`}>{big}</span>
                      <span className={`text-[10.5px] leading-tight ${t.sub}`}>{sub}</span>
                    </span>
                  )
                  if (!onCellClick) return <div key={c.key} role="cell">{inner}</div>
                  return (
                    <button
                      key={c.key} role="cell" type="button" onClick={() => onCellClick(r.key, c.key)}
                      aria-label={`${r.label} on ${c.label}: ${big} ${sub}. Open the matching workflows`}
                      className="cursor-pointer rounded-lg transition-[filter] hover:brightness-[.97]
                        focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
                    >
                      {inner}
                    </button>
                  )
                })}
                <div role="cell">
                  {(() => {
                    const bar = (
                      <>
                        <span className="flex-1 h-2 rounded-full bg-line-soft overflow-hidden min-w-[60px]" aria-hidden>
                          <span className="block h-full rounded-full bg-brand-500 transition-all duration-500"
                            style={{ width: `${(r.trailing / maxT) * 100}%` }} />
                        </span>
                        <span className="text-right shrink-0 w-[74px]">
                          <span className="block text-[13px] font-semibold tnum text-ink-1 leading-tight">{r.trailing.toLocaleString()}</span>
                          <span className="block text-[10.5px] text-ink-3 leading-tight">{share}% of base</span>
                        </span>
                      </>
                    )
                    if (!onTrailingClick) return <span className="flex items-center gap-3">{bar}</span>
                    return (
                      <button
                        type="button" onClick={() => onTrailingClick(r.key)}
                        aria-label={`${r.trailing.toLocaleString()} services on ${r.label}. Open them`}
                        className="flex items-center gap-3 w-full cursor-pointer rounded-md
                          focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
                      >
                        {bar}
                      </button>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ pool gauge */
export function PoolGauge({ allocated, quarantined, reserved, total }:
{ allocated: number; quarantined: number; reserved: number; total: number }) {
  const free = Math.max(0, total - allocated - quarantined - reserved)
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-line-soft gap-px">
        <div style={{ width: pct(allocated), background: FILL.brand }} title={`Allocated ${allocated}`} />
        <div style={{ width: pct(reserved), background: FILL.brandSoft }} title={`Reserved ${reserved}`} />
        <div style={{ width: pct(quarantined), background: FILL.warn }} title={`Quarantined ${quarantined}`} />
        <div style={{ width: pct(free), background: 'var(--vw-color-slate-100)' }} title={`Free ${free}`} />
      </div>
      <div className="flex gap-x-4 gap-y-1 flex-wrap mt-2 text-[11.5px] text-ink-3">
        <span><b className="text-ink-1 tnum">{allocated.toLocaleString()}</b> allocated</span>
        <span><b className="text-ink-1 tnum">{reserved}</b> reserved</span>
        <span><b className="text-warn-700 tnum">{quarantined}</b> quarantined</span>
        <span><b className={`tnum ${free / total < 0.1 ? 'text-crit-500' : 'text-ink-1'}`}>{free.toLocaleString()}</b> free</span>
      </div>
    </div>
  )
}


/* ------------------------------------------------------- category card */
/**
 * One compact card per service category: chip + total on one line, a small
 * donut, and a four-bucket legend where every row drills into the grid.
 * No Filter button — the grid's quick chips already do that job.
 */
export function CategoryCard({ chip, total, noun, segments, onOpen, info }:
{ chip: ReactNode; total: number; noun: string; segments: DonutSegment[]; onOpen: () => void; info?: ReactNode }) {
  return (
    <div className="vw-card-section p-4">
      <div className="vw-flex vw-items-center vw-justify-between vw-gap-md mb-3">
        <span className="vw-flex vw-items-center vw-gap-sm">
          {chip}
          <button onClick={onOpen} className="vw-card-metric-md tnum hover:text-brand-600" aria-label={`${total} ${noun}. Open them`}>
            {total.toLocaleString()} <span className="vw-card-metric-label-sub">{noun}</span>
          </button>
        </span>
        {info && <InfoTip>{info}</InfoTip>}
      </div>
      <Donut size={92} segments={segments} caption={<DonutLegend segments={segments} />} />
    </div>
  )
}

/* ================================================================
   Dashboard charts, following the NST "Dashboard Charts" specimen:
   light horizontal gridlines, grey tick labels, rounded bars,
   smooth two-series lines with dots. Colours come from FILL.
   ================================================================ */

const TICK = { fontSize: 11, fill: '#9ca3af' }        /* --vw-color-gray-400 */
const GRID = '#f3f4f6'                                 /* --vw-color-gray-100 */

function niceMax(v: number) {
  if (v <= 5) return 5
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return m * p
}

/* ----------------------------------------------------------- columns */
export interface ColumnDatum { label: string; value: number; fill?: FillKey; color?: string; sub?: string; onClick?: () => void }

export function ColumnChart({ data, height = 220, ariaLabel }: { data: ColumnDatum[]; height?: number; ariaLabel: string }) {
  const [fillRef, size] = useFill<HTMLDivElement>({ w: 640, h: height })
  const W = 640; const H = size.w > 0 ? size.h * (W / size.w) : height
  const m = { t: 14, r: 8, b: 44, l: 34 }
  const cW = W - m.l - m.r; const cH = H - m.t - m.b
  const yMax = niceMax(Math.max(1, ...data.map((d) => d.value)))
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(yMax * f))
  const sy = (v: number) => cH - (v / yMax) * cH
  const slot = cW / data.length; const bw = Math.min(46, slot * 0.56)
  return (
    <div ref={fillRef} className="w-full h-full">
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full block overflow-visible" role="img" aria-label={ariaLabel}>
      <g transform={`translate(${m.l},${m.t})`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={0} x2={cW} y1={sy(t)} y2={sy(t)} stroke={GRID} />
            <text x={-8} y={sy(t) + 4} textAnchor="end" {...TICK}>{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = i * slot + slot / 2 - bw / 2
          const y = sy(d.value); const h = cH - y
          return (
            <g key={d.label} onClick={d.onClick} style={d.onClick ? { cursor: 'pointer' } : undefined}>
              <title>{`${d.label}: ${d.value}`}</title>
              <rect x={x} y={y} width={bw} height={Math.max(h, d.value > 0 ? 3 : 0)} rx={8} fill={paint(d.fill, d.color)} />
              <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize={12} fontWeight={500} fill="#111827">{d.value}</text>
              <text x={i * slot + slot / 2} y={cH + 18} textAnchor="middle" fontSize={11.5} fill="#4b5563">{d.label}</text>
              {d.sub && <text x={i * slot + slot / 2} y={cH + 32} textAnchor="middle" fontSize={10} fill="#9ca3af">{d.sub}</text>}
            </g>
          )
        })}
      </g>
    </svg>
    </div>
  )
}

/* ------------------------------------------------------------- trend */
export interface TrendSeries { name: string; values: number[]; fill: FillKey; color?: string }

/* Cardinal spline with control-point Y clamped to the plot range, so a
   run of zeros never draws a curve dipping below the baseline. */
function smooth(pts: { x: number; y: number }[], yMin: number, yMax: number) {
  if (pts.length < 2) return ''
  const c = (y: number) => Math.min(yMax, Math.max(yMin, y))
  let d = `M${pts[0].x},${pts[0].y}`
  const t = 0.28
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(i - 1, 0)]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[Math.min(i + 2, pts.length - 1)]
    d += ` C${p1.x + (p2.x - p0.x) * t},${c(p1.y + (p2.y - p0.y) * t)} ${p2.x - (p3.x - p1.x) * t},${c(p2.y - (p3.y - p1.y) * t)} ${p2.x},${p2.y}`
  }
  return d
}

export function TrendChart({ labels, series, height = 200, ariaLabel }:
{ labels: string[]; series: TrendSeries[]; height?: number; ariaLabel: string }) {
  const [fillRef, size] = useFill<HTMLDivElement>({ w: 640, h: height })
  const [hover, setHover] = useState<number | null>(null)
  const W = 640; const H = size.w > 0 ? size.h * (W / size.w) : height
  const m = { t: 14, r: 12, b: 30, l: 30 }
  const cW = W - m.l - m.r; const cH = H - m.t - m.b
  const yMax = niceMax(Math.max(1, ...series.flatMap((s) => s.values)))
  const ticks = [0, 0.5, 1].map((f) => Math.round(yMax * f))
  const sy = (v: number) => cH - (v / yMax) * cH
  const sx = (i: number) => (i / Math.max(1, labels.length - 1)) * cW
  const pts = series.map((s) => s.values.map((v, i) => ({ x: sx(i), y: sy(v) })))

  /* The dots are a 3px hit target — far too small to find reliably. Instead
     track the pointer across the whole plot and snap to the nearest day, the
     way every other trend chart works. */
  const trackPointer = (e: { clientX: number; clientY: number; currentTarget: SVGRectElement }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const localX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * cW
    const i = Math.round((localX / cW) * Math.max(1, labels.length - 1))
    setHover(Math.min(labels.length - 1, Math.max(0, i)))
  }

  const tipLeftPct = hover === null ? 0 : ((m.l + sx(hover)) / W) * 100

  return (
    <div className="h-full vw-flex vw-flex-col">
      <div ref={fillRef} className="flex-1 min-h-0 relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full block overflow-visible" role="img" aria-label={ariaLabel}>
        <g transform={`translate(${m.l},${m.t})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={cW} y1={sy(t)} y2={sy(t)} stroke={GRID} />
              <text x={-8} y={sy(t) + 4} textAnchor="end" {...TICK}>{t}</text>
            </g>
          ))}
          {hover !== null && (
            <line x1={sx(hover)} x2={sx(hover)} y1={0} y2={cH} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {series.map((s, si) => (
            <g key={s.name}>
              <path d={smooth(pts[si], 0, cH)} fill="none" stroke={paint(s.fill, s.color)} strokeWidth={2.5} strokeLinecap="round" />
              {pts[si].map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 5 : 3} fill="#fff" stroke={paint(s.fill, s.color)} strokeWidth={2} />
              ))}
            </g>
          ))}
          {labels.map((l, i) => (i % 2 === 0 || i === labels.length - 1) && (
            <text key={l} x={sx(i)} y={cH + 20} textAnchor="middle" {...TICK}>{l}</text>
          ))}
          <rect
            x={0} y={0} width={cW} height={cH} fill="transparent"
            onMouseMove={trackPointer}
            onMouseLeave={() => setHover(null)}
          />
        </g>
      </svg>
      {hover !== null && (
        <div
          className="absolute top-1.5 -translate-x-1/2 pointer-events-none z-10 whitespace-nowrap
            bg-ink-1 text-white text-[11.5px] rounded-md px-2.5 py-1.5 shadow-lg vw-flex vw-flex-col vw-gap-0.5"
          style={{ left: `${Math.min(94, Math.max(6, tipLeftPct))}%` }}
        >
          <span className="font-medium">{labels[hover]}</span>
          {series.map((s) => (
            <span key={s.name} className="vw-flex vw-items-center vw-gap-xs">
              <i className="w-2 h-2 rounded-full shrink-0" style={{ background: paint(s.fill, s.color) }} />
              {s.name}: <b className="tnum">{s.values[hover]}</b>
            </span>
          ))}
        </div>
      )}
      </div>
      <div className="vw-flex vw-items-center vw-gap-lg mt-2">
        {series.map((s) => (
          <span key={s.name} className="vw-flex vw-items-center vw-gap-xs vw-label">
            <i className="w-2.5 h-2.5 rounded-full" style={{ background: paint(s.fill, s.color) }} />{s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------- stacked trend */
export interface StackedTrendSeries { name: string; values: number[]; color: string }

/**
 * One stacked bar per day (composition by category) with an optional single
 * line overlay for a second, uncategorised metric drawn over the same axis
 * — e.g. "raised, by domain" as stacked bars against a "completed" total as
 * a line, so the category breakdown and the inflow/outflow comparison both
 * read at once instead of needing two separate charts, and two same-hue
 * lines never have to stand in for four different categories.
 */
export function StackedTrendChart({ labels, series, overlay, height = 220, ariaLabel }:
{ labels: string[]; series: StackedTrendSeries[]; overlay?: { name: string; values: number[]; color: string }; height?: number; ariaLabel: string }) {
  const [fillRef, size] = useFill<HTMLDivElement>({ w: 640, h: height })
  const [hover, setHover] = useState<number | null>(null)
  const W = 640; const H = size.w > 0 ? size.h * (W / size.w) : height
  const m = { t: 14, r: 12, b: 30, l: 30 }
  const cW = W - m.l - m.r; const cH = H - m.t - m.b
  const n = labels.length
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0))
  const yMax = niceMax(Math.max(1, ...totals, ...(overlay?.values ?? [0])))
  const ticks = [0, 0.5, 1].map((f) => Math.round(yMax * f))
  const sy = (v: number) => cH - (v / yMax) * cH
  const slot = cW / n; const bw = Math.min(28, slot * 0.5)
  const cx = (i: number) => i * slot + slot / 2
  const sx = (i: number) => (i / Math.max(1, n - 1)) * cW
  const overlayPts = overlay ? overlay.values.map((v, i) => ({ x: sx(i), y: sy(v) })) : []

  const trackPointer = (e: { clientX: number; clientY: number; currentTarget: SVGRectElement }) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const localX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * cW
    const i = Math.round((localX / cW) * Math.max(1, n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }
  const tipLeftPct = hover === null ? 0 : ((m.l + cx(hover)) / W) * 100

  return (
    <div className="h-full vw-flex vw-flex-col">
      <div ref={fillRef} className="flex-1 min-h-0 relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full block overflow-visible" role="img" aria-label={ariaLabel}>
        <g transform={`translate(${m.l},${m.t})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={cW} y1={sy(t)} y2={sy(t)} stroke={GRID} />
              <text x={-8} y={sy(t) + 4} textAnchor="end" {...TICK}>{t}</text>
            </g>
          ))}
          {hover !== null && (
            <line x1={cx(hover)} x2={cx(hover)} y1={0} y2={cH} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {labels.map((_, i) => {
            let cum = 0
            const x = cx(i) - bw / 2
            return (
              <g key={i}>
                {series.map((s) => {
                  const v = s.values[i] ?? 0
                  if (v <= 0) return null
                  const y0 = sy(cum); const y1 = sy(cum + v)
                  cum += v
                  return <rect key={s.name} x={x} y={y1} width={bw} height={Math.max(y0 - y1, 1)} rx={2} fill={s.color} />
                })}
              </g>
            )
          })}
          {overlay && (
            <>
              <path d={smooth(overlayPts, 0, cH)} fill="none" stroke={overlay.color} strokeWidth={2.5} strokeLinecap="round" />
              {overlayPts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 5 : 3} fill="#fff" stroke={overlay.color} strokeWidth={2} />
              ))}
            </>
          )}
          {labels.map((l, i) => (i % 2 === 0 || i === n - 1) && (
            <text key={l} x={cx(i)} y={cH + 20} textAnchor="middle" {...TICK}>{l}</text>
          ))}
          <rect
            x={0} y={0} width={cW} height={cH} fill="transparent"
            onMouseMove={trackPointer}
            onMouseLeave={() => setHover(null)}
          />
        </g>
      </svg>
      {hover !== null && (
        <div
          className="absolute top-1.5 -translate-x-1/2 pointer-events-none z-10 whitespace-nowrap
            bg-ink-1 text-white text-[11.5px] rounded-md px-2.5 py-1.5 shadow-lg vw-flex vw-flex-col vw-gap-0.5"
          style={{ left: `${Math.min(94, Math.max(6, tipLeftPct))}%` }}
        >
          <span className="font-medium">{labels[hover]}</span>
          {series.map((s) => (
            <span key={s.name} className="vw-flex vw-items-center vw-gap-xs">
              <i className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
              {s.name}: <b className="tnum">{s.values[hover] ?? 0}</b>
            </span>
          ))}
          {overlay && (
            <span className="vw-flex vw-items-center vw-gap-xs">
              <i className="w-2 h-2 rounded-full shrink-0" style={{ background: overlay.color }} />
              {overlay.name}: <b className="tnum">{overlay.values[hover] ?? 0}</b>
            </span>
          )}
        </div>
      )}
      </div>
      <div className="vw-flex vw-items-center vw-gap-lg vw-wrap mt-2">
        {series.map((s) => (
          <span key={s.name} className="vw-flex vw-items-center vw-gap-xs vw-label">
            <i className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.name}
          </span>
        ))}
        {overlay && (
          <span className="vw-flex vw-items-center vw-gap-xs vw-label">
            <i className="w-2.5 h-2.5 rounded-full" style={{ background: overlay.color }} />{overlay.name}
          </span>
        )}
      </div>
    </div>
  )
}
