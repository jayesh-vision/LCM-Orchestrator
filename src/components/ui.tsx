import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Check, ChevronDown, Copy, Filter, Info, MoreVertical, RefreshCcw, Search, X } from 'lucide-react'
/* format.ts only imports `Tone` back from here as a type, so this pair is a
   type-level cycle that erases at build time, not a runtime one. */
import { dateTime, relTime } from '@/lib/format'

/* -------------------------------------------------------------- info tip
   A small ⓘ next to a widget's label. Hover, focus or click shows a short
   explanation of what the number/widget means. The tooltip is rendered in a
   portal so it is never clipped by a card's overflow. Safe to place inside a
   clickable Stat card: activating it never triggers the card's drill-down. */
export function InfoTip({ children, width = 270 }: { children: ReactNode; width?: number }) {
  const [pos, setPos] = useState<{ x: number; y: number; alignRight: boolean } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const alignRight = r.left + width + 16 > window.innerWidth
    setPos({ x: alignRight ? r.right : r.left, y: r.bottom + 7, alignRight })
  }
  const hide = () => setPos(null)
  return (
    <>
      <span
        ref={ref} role="button" tabIndex={0} aria-label="What this shows"
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (pos) hide(); else show() }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide()
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (pos) hide(); else show() }
        }}
        className="inline-grid place-items-center w-[18px] h-[18px] rounded-full shrink-0 align-middle cursor-help
          text-ink-3 hover:text-brand-600 hover:bg-brand-100 transition-colors
          focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-100"
      >
        <Info size={13} />
      </span>
      {pos && createPortal(
        <div
          role="tooltip"
          className="fixed z-[120] rounded-lg bg-ink-1 text-white shadow-lg px-3.5 py-2.5 text-[12px] leading-relaxed font-normal normal-case tracking-normal text-left"
          style={{
            top: pos.y, width, maxWidth: 'calc(100vw - 24px)',
            left: pos.alignRight ? undefined : pos.x,
            right: pos.alignRight ? Math.max(12, window.innerWidth - pos.x) : undefined,
          }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}

/* ------------------------------------------------------------------ card
   NST registry: .vw-card-section is the card container, .vw-card-title the
   heading, .vw-card-description the sub-line. Padding is handled by the
   head/body/foot parts, so the section itself is reset to zero. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`vw-card-section p-0 overflow-hidden ${className}`}>{children}</div>
}
export function CardHead({ title, sub, right, info, tight = false }:
{ title?: ReactNode; sub?: ReactNode; right?: ReactNode; info?: ReactNode; tight?: boolean }) {
  return (
    <div className={`vw-flex vw-items-center vw-justify-between vw-wrap vw-gap-lg px-4 ${tight ? 'pt-4 pb-0' : 'py-3.5 border-b border-line-soft'}`}>
      <div className="min-w-0">
        {title && (
          <h2 className="vw-card-title m-0 flex items-center gap-1.5">
            {title}
            {info && <InfoTip>{info}</InfoTip>}
          </h2>
        )}
        {sub && <p className="vw-card-description mt-0.5 m-0">{sub}</p>}
      </div>
      {right && <div className="vw-flex vw-items-center vw-wrap vw-gap-sm">{right}</div>}
    </div>
  )
}
export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>
}
export function CardFoot({ children }: { children: ReactNode }) {
  return <div className="vw-card-footer-divider mt-0 px-4 py-2 vw-flex vw-items-center vw-justify-between vw-wrap vw-gap-md vw-footer-meta">{children}</div>
}

/* ----------------------------------------------------------------- badge */
/* NST registry: .vw-chip + one variant. Tone names are the app's; the class
   they resolve to is the design system's. */
export type Tone = 'good' | 'warn' | 'crit' | 'info' | 'plum' | 'teal' | 'none'
const TONE: Record<Tone, string> = {
  good: 'vw-chip--success',
  warn: 'vw-chip--warning',
  crit: 'vw-chip--error',
  info: 'vw-chip--info',
  plum: 'vw-chip--purple',
  teal: 'vw-chip--cyan',
  none: 'vw-chip--neutral',
}
export function Badge({ tone = 'none', dot = false, children, className = '' }:
{ tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`vw-chip ${TONE[tone]} is-strong gap-1.5 px-2.5 py-[3px] ${className}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------- button */
/* NST registry: .nst-btn + variant + size. `primary` maps to --filled
   (brand blue), `danger` to --danger-subtle, `ghost` to --ghost. */
type BtnVariant = 'default' | 'primary' | 'danger' | 'ghost'
const BTN: Record<BtnVariant, string> = {
  default: '',
  primary: 'nst-btn--filled',
  danger: 'nst-btn--danger-subtle',
  ghost: 'nst-btn--ghost',
}
export function Button({ variant = 'default', size = 'md', children, className = '', ...rest }:
React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      className={`nst-btn ${size === 'sm' ? 'nst-btn--sm' : 'nst-btn--md'} ${BTN[variant]}
        disabled:opacity-45 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ tabs */
export function Tabs<T extends string>({ tabs, value, onChange }:
{ tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-6 border-b border-line overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`py-2.5 text-[15px] border-b-2 -mb-px whitespace-nowrap transition-colors
            ${value === t.id ? 'text-ink-1 border-ink-1 font-semibold' : 'text-ink-3 border-transparent font-normal hover:text-ink-1'}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-[11.5px] text-ink-3 tnum">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ segmented
   toggle. A compact 2 (or 3) option switch — inline-track pill container,
   the active option lifted onto a white "thumb". For mode/view switches
   that live in a page header, not a form. */
export function SegmentedToggle<T extends string>({ options, value, onChange, size = 'md' }:
{ options: { value: T; label: string; icon?: IconType }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div role="tablist" className={`inline-flex items-center gap-0.5 rounded-full bg-plane p-0.5 shrink-0 ${size === 'sm' ? 'text-[12px]' : 'text-[13px]'}`}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value} type="button" role="tab" aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors
              ${size === 'sm' ? 'px-2.5 py-1' : 'px-3.5 py-1.5'}
              ${active ? 'bg-white text-ink-1 shadow-sm' : 'text-ink-3 hover:text-ink-1'}`}
          >
            {o.icon && <o.icon size={13} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ----------------------------------------------------------------- chips */
/* NST registry: .vw-chip.is-clickable; the selected state uses the solid
   variant rather than an invented active colour. */
export function Chip({ active = false, count, children, onClick, tone }:
{ active?: boolean; count?: number; children: ReactNode; onClick?: () => void; tone?: Tone }) {
  /* A toned chip keeps its pastel when idle and goes solid when selected,
     as the platform's category chips do. */
  const idle = tone ? TONE[tone] : 'vw-chip--neutral'
  const on = tone ? `${TONE[tone]}-solid` : 'vw-chip--info-solid'
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`vw-chip is-clickable gap-1.5 h-[30px] ${active ? `${on} is-strong` : `${idle} hover:brightness-95`}`}
    >
      {children}
      {count !== undefined && <span className={`tnum ${active ? 'opacity-75' : 'opacity-70'}`}>{count}</span>}
    </button>
  )
}

/* ------------------------------------------------------------------ stat
   Every Stat renders the same skeleton — icon chip, value (+ optional delta),
   optional progress bar, note pinned to the bottom, and a tone-coloured
   accent strip along the bottom edge. Because the strip and icon are always
   driven by `tone` (brand when absent) rather than an ad-hoc colour prop,
   any row of Stat cards on one screen stays visually symmetric by
   construction — nothing for a caller to forget to match. */
export type StatTone = 'good' | 'warn' | 'crit' | 'plum'
const STAT_TONE: Record<StatTone | 'brand', { value: string; iconBg: string; iconFg: string; ring: string }> = {
  brand: { value: '', iconBg: 'bg-brand-50', iconFg: 'text-brand-600', ring: 'ring-brand-200/60' },
  good: { value: 'text-good-700', iconBg: 'bg-good-50', iconFg: 'text-good-700', ring: 'ring-good-200/70' },
  warn: { value: 'text-warn-700', iconBg: 'bg-warn-50', iconFg: 'text-warn-700', ring: 'ring-warn-200/70' },
  crit: { value: 'text-crit-500', iconBg: 'bg-crit-50', iconFg: 'text-crit-500', ring: 'ring-crit-200/70' },
  plum: { value: 'text-plum-700', iconBg: 'bg-plum-50', iconFg: 'text-plum-700', ring: 'ring-plum-200/70' },
}

export function Stat({ label, value, note, tone, delta, onClick, drillLabel, icon: Icon, progress, progressColor, info }:
{
  label: string; value: ReactNode; note?: ReactNode; tone?: StatTone
  delta?: { text: string; tone: 'good' | 'bad' | 'flat' }
  /** Makes the whole tile a drill-down into the screen that explains the number. */
  onClick?: () => void
  /** What the drill-down leads to, e.g. "46 ghost services". Announced to screen readers. */
  drillLabel?: string
  icon?: ComponentType<{ size?: number; className?: string }>
  /** 0–100. Renders a thin share-of-total bar under the value in the card's tone. */
  progress?: number
  /** Raw CSS color for that bar, e.g. a page's own soft palette; wins over the tone default. */
  progressColor?: string
  /** One or two sentences explaining what the number means, behind a small ⓘ. */
  info?: ReactNode
}) {
  const c = STAT_TONE[tone ?? 'brand']
  const inner = (
    <>
      <div className="vw-flex vw-items-center vw-gap-sm">
        {Icon && (
          <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ring-1 ring-inset ${c.iconBg} ${c.iconFg} ${c.ring}`} aria-hidden>
            <Icon size={18} />
          </span>
        )}
        <div className="vw-card-metric-label vw-flex vw-items-center vw-gap-xxs min-w-0">
          <span className="truncate">{label}</span>
          {info && <InfoTip>{info}</InfoTip>}
          {onClick && <ArrowUpRight size={13} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />}
        </div>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap mt-3">
        <span className={`vw-card-metric-xxl tnum ${c.value}`}>{value}</span>
        {delta && (
          <Badge tone={delta.tone === 'bad' ? 'crit' : delta.tone === 'good' ? 'good' : 'none'} className="!text-[11px]">
            {delta.text}
          </Badge>
        )}
      </div>
      {progress !== undefined && (
        <Progress value={progress} tone={tone ?? 'brand'} color={progressColor} className="mt-3" />
      )}
      {/* Anchored to the bottom so the note line sits at the same height on
         every card in a KPI row, whatever the value/delta/progress above it. */}
      {note && <div className="vw-card-metric-label-sub mt-auto pt-2.5 leading-snug">{note}</div>}
    </>
  )
  const base = 'vw-card-section vw-flex vw-flex-col'
  if (!onClick) return <div className={base}>{inner}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={drillLabel ? `${label}. Open ${drillLabel}` : `${label}. Open the detail`}
      className={`${base} vw-card--clickable group text-left`}
    >
      {inner}
    </button>
  )
}

/* --------------------------------------------------------------- statrow
   A compact row version of Stat — icon chip, label, value, an optional
   share-of-total bar, and a note line — for grouping several related
   numbers into one card (e.g. "Action queue", "Problem spotlight") instead
   of a full-width Stat tile per number. A row of identical Stat tiles reads
   fine at 3–4; past that it reads as repetitive card sprawl, which is
   exactly what this exists to replace. */
export function StatRow({ label, value, note, tone, onClick, drillLabel, icon: Icon, progress, info }:
{
  label: string; value: ReactNode; note?: ReactNode; tone?: StatTone
  onClick?: () => void
  drillLabel?: string
  icon?: ComponentType<{ size?: number; className?: string }>
  /** 0–100. Renders a thin share-of-total bar under the row in the row's tone. */
  progress?: number
  info?: ReactNode
}) {
  const c = STAT_TONE[tone ?? 'brand']
  const inner = (
    <span className="vw-flex vw-items-center vw-gap-sm">
      {Icon && (
        <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ring-1 ring-inset ${c.iconBg} ${c.iconFg} ${c.ring}`} aria-hidden>
          <Icon size={15} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="vw-flex vw-items-center vw-justify-between vw-gap-sm">
          <span className="vw-card-activity-label truncate vw-flex vw-items-center vw-gap-xxs">
            {label}
            {info && <InfoTip>{info}</InfoTip>}
          </span>
          <span className="vw-card-metric-sm tnum shrink-0">{value}</span>
        </span>
        {progress !== undefined && <Progress value={progress} tone={tone ?? 'brand'} className="mt-1.5" />}
        {note && <span className="vw-card-activity-value block mt-1 truncate">{note}</span>}
      </span>
    </span>
  )
  if (!onClick) return <div className="vw-card-child">{inner}</div>
  return (
    <button type="button" onClick={onClick}
      aria-label={drillLabel ? `${label}. Open ${drillLabel}` : `${label}. Open the detail`}
      className="vw-card-child vw-card--clickable w-full text-left">
      {inner}
    </button>
  )
}

/* ------------------------------------------------------------ active filter */
/** Shape for a currently-applied filter, shown as a removable pill in the grid toolbar. */
export interface ActiveFilter { key: string; label: string; value: string; onRemove: () => void }

/* ---------------------------------------------------------------- drawer */
export function Drawer({ open, onClose, title, sub, width = 620, children, footer }:
{ open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; width?: number; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink-1/25" onClick={onClose} />
      <aside
        className="relative bg-white h-full shadow-pop flex flex-col anim-drawer max-w-full"
        style={{ width }}
        role="dialog"
        aria-label={typeof title === 'string' ? title : 'Details'}
      >
        <header className="px-5 py-4 border-b border-line flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="vw-card-title">{title}</div>
            {sub && <div className="vw-card-description mt-0.5">{sub}</div>}
          </div>
          <button onClick={onClose} className="nst-icon-btn w-8 h-8" aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="px-5 py-3.5 border-t border-line flex items-center justify-end gap-2">{footer}</footer>}
      </aside>
    </div>
  )
}

/* ----------------------------------------------------------------- modal */
export function Modal({ open, onClose, title, sub, children, footer, width = 560 }:
{ open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-1/30" onClick={onClose} />
      <div className="relative bg-white rounded-[var(--vw-radius-lg)] shadow-pop anim-in w-full" style={{ maxWidth: width }} role="dialog">
        <header className="px-5 py-4 border-b border-line-soft flex items-start justify-between gap-4">
          <div>
            <div className="vw-card-title">{title}</div>
            {sub && <div className="vw-card-description mt-0.5">{sub}</div>}
          </div>
          <button onClick={onClose} className="nst-icon-btn w-8 h-8" aria-label="Close"><X size={16} /></button>
        </header>
        <div className="px-5 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <footer className="px-5 py-3.5 border-t border-line-soft flex items-center justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- forms */
export function Field({ label, hint, required, children }:
{ label: ReactNode; hint?: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="nst-input-label block mb-1.5">
        {label}{required && <span className="text-crit-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="nst-input-hint block mt-1">{hint}</span>}
    </label>
  )
}
/* NST registry: .nst-input carries the border, radius, focus ring and states. */
const inputCls = 'nst-input w-full'
export function TextInput(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`${inputCls} ${p.className ?? ''}`} />
}
export function Select({ children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...p} className={`${inputCls} has-icon-right appearance-none ${p.className ?? ''}`}>{children}</select>
      <ChevronDown size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
    </div>
  )
}
export function Toggle({ checked, onChange, label, hint, disabled }:
{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)}
      className="flex items-start gap-2.5 text-left w-full group disabled:opacity-55 disabled:cursor-not-allowed">
      <span className={`mt-0.5 w-[34px] h-[19px] rounded-full shrink-0 transition-colors relative ${checked ? 'bg-brand-500' : 'bg-line'}`}>
        <span className={`absolute top-[2px] w-[15px] h-[15px] rounded-full bg-white shadow transition-all ${checked ? 'left-[17px]' : 'left-[2px]'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-ink-1">{label}</span>
        {hint && <span className="block text-[11.5px] text-ink-3 leading-snug">{hint}</span>}
      </span>
    </button>
  )
}

/* --------------------------------------------------------------- toolbar */
export function SearchBox({ value, onChange, placeholder = 'Search…', width = 260 }:
{ value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <div className="relative" style={{ width }}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="nst-input has-icon-left has-icon-right w-full"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-1" aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- kebab */
export type IconType = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>
export interface MenuItem { label: string; onClick: () => void; icon?: IconType; danger?: boolean }

/* NST registry: .nst-action-menu / .nst-action-menu-item / .nst-action-menu-icon.
   Row actions carry an icon each, as the platform's own grid does.
   The menu renders in a portal, positioned from the trigger's own
   bounding rect — a table card clips overflow for its horizontal
   scroller, which would otherwise cut off the dropdown for any row
   near the bottom (worst on a short, lightly-filtered list, where
   almost every row is "near the bottom"). */
export function Kebab({ items, align = 'right', variant = 'inline' }: { items: MenuItem[]; align?: 'right' | 'left'; variant?: 'inline' | 'icon-btn' }) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const open = !!pos
  useEffect(() => {
    if (!open) return
    const h = () => setPos(null)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [open])
  const toggle = () => {
    if (open) { setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      top: r.bottom + 4,
      left: align === 'left' ? r.left : undefined,
      right: align === 'right' ? window.innerWidth - r.right : undefined,
    })
  }
  return (
    <div className="inline-block" onClick={(e) => e.stopPropagation()}>
      <button ref={btnRef} onClick={toggle} aria-label={variant === 'icon-btn' ? 'More actions' : 'Row actions'} aria-expanded={open}
        className={variant === 'icon-btn' ? `nst-icon-btn ${open ? 'is-active' : ''}` : 'nst-table-kebab w-8 h-8 rounded-[var(--vw-radius-sm)] hover:bg-plane'}>
        <MoreVertical size={16} />
      </button>
      {pos && createPortal(
        <div className="nst-action-menu min-w-[220px] anim-in" style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right }} role="menu">
          {items.map((it) => (
            <button
              key={it.label} role="menuitem"
              onClick={() => { setPos(null); it.onClick() }}
              className={`nst-action-menu-item w-full text-left gap-2.5 whitespace-nowrap ${it.danger ? 'nst-action-menu-item--danger' : ''}`}
            >
              {it.icon && <it.icon size={18} className="nst-action-menu-icon" aria-hidden />}
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

/* -------------------------------------------------------- filter popover */
export interface FilterOption { value: string; label: string; count?: number }
export interface FilterField {
  key: string
  label: string
  type?: 'select' | 'text'
  options?: FilterOption[]
  value: string
  onChange: (v: string) => void
}

/**
 * The platform's filter popover: field list on the left, the selected field's
 * control on the right, Reset / Apply in the footer. Edits are held as a draft
 * and only reach the URL on Apply, so a half-built filter never flickers the grid.
 */
export function FilterPopover({ fields, onReset, onClose }:
{ fields: FilterField[]; onReset?: () => void; onClose: () => void }) {
  const [active, setActive] = useState(fields[0]?.key)
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])))
  const [q, setQ] = useState('')
  const [listOpen, setListOpen] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const field = fields.find((f) => f.key === active) ?? fields[0]
  const isAll = (v: string) => !v || v === 'All'
  const dirtyCount = fields.filter((f) => !isAll(draft[f.key])).length
  const apply = () => { fields.forEach((f) => { if (draft[f.key] !== f.value) f.onChange(draft[f.key]) }); onClose() }
  const reset = () => { setDraft(Object.fromEntries(fields.map((f) => [f.key, 'All']))); onReset?.() }
  const options = (field?.options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* No `overflow-hidden` here. The option list below is absolutely
          positioned and is routinely taller than this panel's body, so
          clipping to the panel cut the list off at the bottom border with no
          way to reach the rest — it needs to escape the panel the way a
          native select does. Nothing inside paints into the rounded corners,
          so there is nothing left for the clip to do. */}
      <div className="nst-surface--raised absolute right-0 top-11 z-50 w-[460px] max-w-[calc(100vw-2rem)] anim-in" role="dialog" aria-label="Filters" onClick={(e) => e.stopPropagation()}>
        <div className="vw-flex vw-items-center vw-justify-between px-3 pt-2.5 pb-1.5 border-b border-line-soft">
          <span className="vw-card-title-sm">Filters</span>
          <button onClick={onClose} className="nst-icon-btn w-7 h-7 border-0" aria-label="Close filters"><X size={15} /></button>
        </div>
        <div className="vw-flex" style={{ minHeight: 200 }}>
          <ul className="m-0 p-1.5 list-none w-[150px] shrink-0 border-r border-line-soft">
            {fields.map((f) => (
              <li key={f.key}>
                <button
                  onClick={() => { setActive(f.key); setQ(''); setListOpen(false) }}
                  className={`w-full text-left px-2.5 py-2 rounded-[var(--vw-radius-xs)] vw-value text-[13px] vw-flex vw-items-center vw-justify-between gap-2 border-l-2
                    ${f.key === field?.key ? 'bg-plane border-ink-1 font-medium' : 'border-transparent hover:bg-plane'}`}
                  aria-current={f.key === field?.key}
                >
                  <span className="truncate">{f.label}</span>
                  {!isAll(draft[f.key]) && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" aria-label="active" />}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex-1 p-3 min-w-0">
            {field && (
              /* A <div>, not a <label>: a label re-dispatches clicks to its first
                 control, so choosing an option would reopen the list. */
              <div className="block">
                <span className="nst-input-label block mb-1.5" id={`filter-label-${field.key}`}>{field.label}</span>
                {field.type === 'text' ? (
                  <input className="nst-input w-full" aria-labelledby={`filter-label-${field.key}`} value={isAll(draft[field.key]) ? '' : draft[field.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))} placeholder={`Type a ${field.label.toLowerCase()}`} />
                ) : (
                  <div className="relative">
                    <button type="button" onClick={() => setListOpen((v) => !v)}
                      className={`nst-input w-full text-left vw-flex vw-items-center vw-justify-between ${listOpen ? 'ring-2 ring-ink-1 border-ink-1' : ''}`}
                      aria-haspopup="listbox" aria-expanded={listOpen} aria-labelledby={`filter-label-${field.key}`}>
                      <span className={isAll(draft[field.key]) ? 'text-ink-3' : ''}>
                        {isAll(draft[field.key]) ? 'Any' : (field.options?.find((o) => o.value === draft[field.key])?.label ?? draft[field.key])}
                      </span>
                      <ChevronDown size={15} className="text-ink-3" />
                    </button>
                    {listOpen && (
                      /* Column, not one scrolling block: the search box stays
                         pinned and only the options scroll under it, so
                         narrowing a long list doesn't first require scrolling
                         back up to find the box you type into. */
                      <div className="nst-surface--raised absolute left-0 right-0 top-[calc(100%+6px)] z-20 p-1 anim-in flex flex-col max-h-[min(320px,50vh)]" role="listbox">
                        <div className="relative mb-1 shrink-0">
                          <input autoFocus className="nst-input has-icon-right w-full border-0 border-b border-line-soft rounded-none focus:ring-0" placeholder="Search"
                            value={q} onChange={(e) => setQ(e.target.value)} />
                          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                        </div>
                        <div className="min-h-0 overflow-y-auto">
                          <button role="option" aria-selected={isAll(draft[field.key])}
                            onClick={() => { setDraft((d) => ({ ...d, [field.key]: 'All' })); setListOpen(false) }}
                            className={`w-full text-left px-2.5 py-2 rounded-[var(--vw-radius-xs)] vw-value text-[13px] hover:bg-plane ${isAll(draft[field.key]) ? 'bg-plane' : ''}`}>
                            Any
                          </button>
                          {options.map((o) => (
                            <button key={o.value} role="option" aria-selected={draft[field.key] === o.value}
                              onClick={() => { setDraft((d) => ({ ...d, [field.key]: o.value })); setListOpen(false) }}
                              className={`w-full text-left px-2.5 py-2 rounded-[var(--vw-radius-xs)] vw-value text-[13px] hover:bg-plane ${draft[field.key] === o.value ? 'bg-plane' : ''}`}>
                              {o.label}
                            </button>
                          ))}
                          {options.length === 0 && <div className="px-3 py-2.5 vw-label">No matches</div>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="vw-flex vw-items-center vw-justify-end vw-gap-xs px-3 py-2 border-t border-line-soft">
          <button className="nst-btn nst-btn--xs nst-btn--ghost px-2" onClick={reset} disabled={dirtyCount === 0}>Reset to default</button>
          <button className="nst-btn nst-btn--xs nst-btn--filled px-2.5" onClick={apply}>Apply filters</button>
        </div>
      </div>
    </>
  )
}

/**
 * A single-field quick filter, rendered inline in the grid toolbar next to
 * search instead of hidden behind the filter icon — for the handful of
 * facets (domain, vendor, category) worth one click instead of two. Shows
 * the field label when set to "All", and the selected option's label once
 * something is picked, so the button doubles as its own active-filter tag.
 */
export function FieldDropdown({ label, value, onChange, options, width = 220 }:
{ label: string; value: string; onChange: (v: string) => void; options: FilterOption[]; width?: number }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open])
  const isAll = !value || value === 'All'
  const selected = options.find((o) => o.value === value)
  const filtered = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="relative">
      <button
        type="button" onClick={() => { setOpen((v) => !v); setQ('') }}
        className={`nst-input h-9 px-3 vw-flex vw-items-center vw-gap-xs whitespace-nowrap
          ${open ? 'ring-2 ring-ink-1 border-ink-1' : ''} ${!isAll ? 'border-brand-300 bg-brand-50/60' : ''}`}
        aria-haspopup="listbox" aria-expanded={open}
      >
        <span className={isAll ? 'text-ink-3' : 'font-medium text-ink-1'}>{isAll ? label : (selected?.label ?? value)}</span>
        <ChevronDown size={14} className="text-ink-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Same shape as the filter popover's list — search pinned, options
              scrolling under it — so the two behave identically. */}
          <div className="nst-surface--raised absolute left-0 top-[calc(100%+6px)] z-50 anim-in p-1 flex flex-col max-h-[min(320px,50vh)]" style={{ width }} role="listbox" aria-label={label}>
            <div className="relative mb-1 shrink-0">
              <input autoFocus className="nst-input has-icon-right w-full border-0 border-b border-line-soft rounded-none focus:ring-0" placeholder="Search"
                value={q} onChange={(e) => setQ(e.target.value)} />
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
            </div>
            <div className="min-h-0 overflow-y-auto">
              <button role="option" aria-selected={isAll} onClick={() => { onChange('All'); setOpen(false) }}
                className={`w-full text-left px-2.5 py-2 rounded-[var(--vw-radius-xs)] vw-value text-[13px] hover:bg-plane ${isAll ? 'bg-plane font-medium' : ''}`}>
                Any {label.toLowerCase()}
              </button>
              {filtered.map((o) => (
                <button key={o.value} role="option" aria-selected={value === o.value}
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className={`w-full text-left px-2.5 py-2 rounded-[var(--vw-radius-xs)] vw-value text-[13px] hover:bg-plane ${value === o.value ? 'bg-plane font-medium' : ''}`}>
                  {o.label}
                </button>
              ))}
              {filtered.length === 0 && <div className="px-3 py-2.5 vw-label">No matches</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- table */
export interface Column<T> {
  key: string
  header: string
  width?: string
  align?: 'left' | 'right' | 'center'
  sortValue?: (row: T) => string | number
  render: (row: T) => ReactNode
}

/**
 * The platform grid toolbar: "Showing x of y" · search · quick chips on the
 * left; refresh · filter · more on the right. Filters open the FilterPopover.
 */
export interface GridToolbar {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  chips?: ReactNode
  filters?: FilterField[]
  /** Currently-applied filters, shown as removable pills next to the toolbar icons. */
  activeFilterChips?: ActiveFilter[]
  onResetFilters?: () => void
  onRefresh?: () => void
  actions?: MenuItem[]
}

export function DataTable<T extends { id: string }>({
  rows, columns, pageSize = 25, onRowClick, empty = 'Nothing matches these filters.', minWidth = 1040, maxHeight = 560, toolbar, total, fillHeight = false,
}: {
  rows: T[]
  columns: Column<T>[]
  /** Rows revealed per scroll-triggered load. */
  pageSize?: number
  onRowClick?: (row: T) => void
  empty?: string
  minWidth?: number
  /** Height of the scrollable grid body; scrolling near the bottom loads the next `pageSize` rows. Ignored when `fillHeight` is set. */
  maxHeight?: number
  /** Rendering the toolbar also wraps the table in its own .nst-table-card. */
  toolbar?: GridToolbar
  /** Unfiltered total, for "Showing 12 of 138". Defaults to rows.length. */
  total?: number
  /** Grow the grid to fill the remaining height of its flex parent instead of stopping at a fixed `maxHeight` — leaves no dead space below a short result set. Needs an ancestor with a bounded height (e.g. a flex column sized to the viewport). */
  fillHeight?: boolean
}) {
  const [visibleCount, setVisibleCount] = useState(pageSize)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [spin, setSpin] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeFilters = (toolbar?.filters ?? []).filter((f) => f.value && f.value !== 'All').length

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a); const bv = col.sortValue!(b)
      if (av === bv) return 0
      return (av > bv ? 1 : -1) * sort.dir
    })
  }, [rows, sort, columns])

  const view = sorted.slice(0, visibleCount)
  const hasMore = visibleCount < sorted.length
  useEffect(() => {
    setVisibleCount(pageSize)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [rows.length, pageSize])

  /* Grid-scroll pagination: reveal the next `pageSize` rows once the user
     scrolls near the bottom of the grid's own viewport, instead of paging
     through click-through Prev/Next controls. */
  const onGridScroll = () => {
    const el = scrollRef.current
    if (!el || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
      setVisibleCount((c) => Math.min(sorted.length, c + pageSize))
    }
  }

  const tableEl = (
    <>
      {/* NST registry: the semantic .nst-table variant — real table markup keeps
          row/column semantics for screen readers, which the grid-of-divs
          variant does not. Border and radius are dropped because the table sits
          inside a .vw-card-section that already provides them. */}
      <div
        ref={scrollRef} onScroll={onGridScroll}
        className={`overflow-auto ${fillHeight ? 'flex-1 min-h-0' : ''}`}
        style={fillHeight ? undefined : { maxHeight }}
      >
        <table className="nst-table border-0 rounded-none [&>thead>tr>th]:bg-plane [&>thead>tr>th]:sticky [&>thead>tr>th]:top-0 [&>thead>tr>th]:z-10" style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  onClick={() => c.sortValue && setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                  className={`${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'} ${c.sortValue ? 'cursor-pointer select-none hover:text-ink-1' : ''}`}
                  style={{ width: c.width }}
                >
                  {c.header}
                  {sort?.key === c.key && <span className="ml-1 text-brand-500">{sort.dir === 1 ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={columns.length} className="py-12 text-center text-ink-3">{empty}</td></tr>
            )}
            {/* Rows are never tinted by state — the status chip carries the colour. */}
            {view.map((row) => {
              return (
                <tr key={row.id} onClick={() => onRowClick?.(row)} className={onRowClick ? 'is-clickable' : ''}>
                  {columns.map((c) => (
                    <td key={c.key} className={`nst-table-td--primary ${c.align === 'right' ? 'text-right tnum' : c.align === 'center' ? 'text-center tnum' : ''}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className={fillHeight ? 'shrink-0' : ''}>
          <CardFoot>
            <span>Showing {view.length.toLocaleString()} of {sorted.length.toLocaleString()}</span>
            <span className="text-ink-3">Scroll for more</span>
          </CardFoot>
        </div>
      )}
    </>
  )

  if (!toolbar) return tableEl

  const refresh = () => { setSpin(true); toolbar.onRefresh?.(); window.setTimeout(() => setSpin(false), 600) }

  return (
    <div className={`vw-flex vw-flex-col vw-gap-xs ${fillHeight ? 'flex-1 min-h-0' : ''}`}>
      <div className="vw-flex vw-items-center vw-wrap vw-gap-md shrink-0">
        <span className="vw-value text-ink-2 whitespace-nowrap tnum">
          Showing {view.length.toLocaleString()} of {sorted.length.toLocaleString()}{total !== undefined && total !== sorted.length ? <span className="text-ink-3"> · {total.toLocaleString()} in total</span> : ''}
        </span>
        {toolbar.search && (
          <SearchBox value={toolbar.search.value} onChange={toolbar.search.onChange} placeholder={toolbar.search.placeholder ?? 'Search…'} width={300} />
        )}
        {toolbar.chips && <div className="vw-flex vw-items-center vw-wrap vw-gap-sm">{toolbar.chips}</div>}
        <div className="flex-1" />
        {toolbar.activeFilterChips && toolbar.activeFilterChips.length > 0 && (
          <div className="vw-flex vw-items-center vw-wrap vw-gap-xs">
            {toolbar.activeFilterChips.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-[3px] rounded-full bg-plane text-[12px] text-ink-2 whitespace-nowrap">
                {f.label} = <b className="font-medium text-ink-1">{f.value}</b>
                <button
                  type="button" onClick={f.onRemove} aria-label={`Remove the ${f.label} filter`}
                  className="w-[15px] h-[15px] grid place-items-center rounded-full hover:bg-line shrink-0"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {toolbar.activeFilterChips.length > 1 && toolbar.onResetFilters && (
              <button type="button" onClick={toolbar.onResetFilters} className="text-[12px] text-brand-600 hover:underline whitespace-nowrap">
                Clear all
              </button>
            )}
          </div>
        )}
        <div className="vw-flex vw-items-center vw-gap-sm relative">
          <button className={`nst-icon-btn ${spin ? 'is-active' : ''}`} onClick={refresh} aria-label="Refresh" title="Refresh">
            <RefreshCcw size={16} className={spin ? 'animate-spin' : ''} />
          </button>
          {toolbar.filters && toolbar.filters.length > 0 && (
            <button
              className={`nst-icon-btn relative ${filtersOpen || activeFilters ? 'is-active' : ''}`}
              onClick={() => setFiltersOpen((v) => !v)} aria-label={`Filters${activeFilters ? `, ${activeFilters} active` : ''}`}
              aria-expanded={filtersOpen} title="Filters"
            >
              <Filter size={16} />
              {activeFilters > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-brand-500 text-white text-[10px] font-medium grid place-items-center tnum">
                  {activeFilters}
                </span>
              )}
            </button>
          )}
          {toolbar.actions && toolbar.actions.length > 0 && (
            <Kebab items={toolbar.actions} variant="icon-btn" />
          )}
          {filtersOpen && toolbar.filters && (
            <FilterPopover fields={toolbar.filters} onReset={toolbar.onResetFilters} onClose={() => setFiltersOpen(false)} />
          )}
        </div>
      </div>
      <div className={`nst-table-card ${fillHeight ? 'flex flex-col flex-1 min-h-0' : ''}`}>
        {tableEl}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ cell atoms */
export const CellMain = ({ children }: { children: ReactNode }) =>
  <div className="vw-card-activity-label leading-snug">{children}</div>
export const CellSub = ({ children }: { children: ReactNode }) =>
  <div className="vw-card-activity-value mt-0.5 leading-snug">{children}</div>
export const Mono = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <span className={`font-mono text-[12.5px] ${className}`}>{children}</span>

/**
 * The last column on every list of records someone can act on: when it first
 * arrived, and whether anything has happened to it since.
 *
 * A factory rather than four hand-written copies, because the wording, the
 * width, the sort key and the "has this actually changed" test are the same
 * question on every screen and would drift apart the moment they were typed
 * out separately. Callers supply only where the two timestamps live on their
 * own row type — an order carries them directly, a service has to derive the
 * second from its change history.
 */
export function stampColumn<T>(
  createdOf: (row: T) => string | undefined,
  modifiedOf: (row: T) => string | undefined,
  header = 'Created / Modified',
): Column<T> {
  return {
    key: 'stamp',
    header,
    width: '196px',
    /* Sort on the later of the two: the question this column answers when you
       click it is "what moved most recently", not "what was raised first". */
    sortValue: (row) => Date.parse(modifiedOf(row) ?? createdOf(row) ?? '') || 0,
    render: (row) => {
      const created = createdOf(row)
      const modified = modifiedOf(row)
      /* Only call it modified if something happened *after* it was raised.
         Repeating the creation time on a second line under the label
         "Modified" would state a change that never happened. */
      const changed = created && modified && Date.parse(modified) > Date.parse(created)
      return (
        <>
          <CellMain>{dateTime(created)}</CellMain>
          {/* Both lines carry the same absolute stamp, to the minute. A
              relative age here ("Modified 23 d ago") could not be compared
              against the creation date sitting directly above it without doing
              arithmetic in your head, and could not be compared against the
              row below it at all; the age moves to the tooltip, where it
              answers "is this recent" without costing a column. */}
          <CellSub>
            {changed
              ? <span title={`Last modified ${relTime(modified)}`} className="whitespace-nowrap">Modified {dateTime(modified)}</span>
              : <span className="text-ink-3">Not modified since</span>}
          </CellSub>
        </>
      )
    },
  }
}

/* -------------------------------------------------------------- progress */
/* Deliberately lighter than the badge palette (--color-good-500 etc, which
   is really emerald/red/purple-600) — a thin bar covers more visual area
   than a small status pill, so the 600-weight that reads fine on a chip
   reads as glaring across a whole card. Same softening already applied to
   the chart FILL palette in charts.tsx. */
const PROGRESS_FILL: Record<'brand' | 'good' | 'warn' | 'crit' | 'plum', string> = {
  brand: 'bg-brand-500', good: 'bg-[#10b981]', warn: 'bg-warn-500', crit: 'bg-[#ef4444]', plum: 'bg-[#a855f7]',
}
export function Progress({ value, tone = 'brand', color, className = '' }:
{ value: number; tone?: 'brand' | 'good' | 'warn' | 'crit' | 'plum'; /** Raw CSS color; wins over `tone`. */ color?: string; className?: string }) {
  const c = PROGRESS_FILL[tone]
  return (
    <div className={`h-1.5 rounded-full bg-line-soft overflow-hidden ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${color ? '' : c}`} style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  )
}

/* ----------------------------------------------------------------- note */
export function Note({ tone = 'info', className = '', children }: { tone?: 'info' | 'warn' | 'crit' | 'good'; className?: string; children: ReactNode }) {
  const cls = tone === 'warn' ? 'vw-card--warning text-warn-700'
    : tone === 'crit' ? 'vw-card--error text-crit-700'
      : tone === 'good' ? 'vw-card--success text-good-700'
        : 'vw-card--info text-ink-2'
  return <div className={`vw-card-section ${cls} vw-card-description px-4 py-3 leading-relaxed ${className}`}>{children}</div>
}

/* -------------------------------------------------------------- stepper */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-start w-full overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = i < current; const now = i === current
        return (
          /* display:contents lifts the circle+label column and the connector
             out as direct flex children of the <ol> — semantic <li> markup
             stays, but layout-wise the connector can flex-grow to fill
             whatever width the card actually has, instead of the whole row
             bunching up at a fixed width on the left of a wide card. */
          <li key={s} className="contents">
            <div className="flex flex-col items-center gap-1.5 text-center shrink-0 px-1" style={{ width: 132 }}>
              <span className={`w-7 h-7 rounded-full grid place-items-center text-[12px] font-medium shrink-0
                ${done ? 'vw-chip vw-chip--success' : now ? 'vw-chip vw-chip--info-solid' : 'vw-chip vw-chip--neutral'}`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={`text-[11px] leading-tight ${now ? 'text-ink-1 font-semibold' : 'text-ink-3'}`}>{s}</span>
            </div>
            {i < steps.length - 1 && <span className={`flex-1 h-px mt-3.5 min-w-6 ${done ? 'bg-good-200' : 'bg-line'}`} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------ page header */
export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-7 flex-wrap">
      <div>
        <h1 className="vw-page-title m-0">{title}</h1>
        {sub && <p className="vw-page-description mt-1 m-0 max-w-[78ch]">{sub}</p>}
      </div>
      {actions && <div className="vw-flex vw-items-center vw-wrap vw-gap-sm">{actions}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------- kv */
export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[13px] items-baseline m-0">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="vw-label whitespace-nowrap">{k}</dt>
          <dd className="vw-value m-0 font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ------------------------------------------------------------------ code */
export function CodeBlock({ children, className = '', copyable = false }: { children: ReactNode; className?: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false)
  const text = typeof children === 'string' ? children : undefined
  const copy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* Clipboard access can be denied outside a secure/focused context —
         leave the button as-is rather than claim a copy that didn't happen. */
    }
  }
  return (
    <div className="relative group">
      <pre className={`bg-[var(--vw-color-gray-900)] text-[var(--vw-color-gray-200)] rounded-[var(--vw-radius-sm)] px-4 py-3.5 m-0 overflow-x-auto whitespace-pre font-mono text-[11.5px] leading-[1.7] ${className}`}>
        {children}
      </pre>
      {copyable && text && (
        <button
          type="button" onClick={copy} aria-label="Copy to clipboard"
          className="absolute top-2 right-2 vw-flex vw-items-center vw-gap-xs px-2 py-1 rounded-[var(--vw-radius-sm)] text-[11px]
            bg-white/10 text-[var(--vw-color-gray-200)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-white/20"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  )
}
