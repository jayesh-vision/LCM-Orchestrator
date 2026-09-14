import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, FileText, Layers, Maximize2, Minimize2, Play, PlayCircle, Settings, User, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { Order, Run, RunTask, Workflow } from '@/types'
import {
  attemptsOf, buildExecutionGraph, buildRequestGraph,
  type JDetail, type JEdge, type JGraph, type JNode, type JPort, type JTone,
} from '@/lib/journey'
import { Badge, Button, Card, CardHead, CodeBlock, Mono, Note, type Tone } from '@/components/ui'
import { RUN_TONE, dateTime } from '@/lib/format'

/* ------------------------------------------------------------------
   BPMN journey — the request as a process diagram.

   Top: the request lifecycle, every state a BPMN element, the path this
   request took drawn solid and animated in, everything it did not do
   drawn dashed. Bottom: the execution sub-process expanded — one lane
   per device, one BPMN task per workflow task, the break point as an
   error boundary event, and the roll back / abort / wait-for-Source
   paths drawn as the alternate flows they were.

   Hand-rolled SVG like every chart in the app: a small orthogonal
   router, pan and zoom on the canvas, a token that replays the story,
   and a panel that explains whatever is selected.
   ------------------------------------------------------------------ */

const STEP_S = 0.38

const TONE_COLOR: Record<JTone, { stroke: string; fill: string; soft: string }> = {
  brand: { stroke: 'var(--color-brand-500)', fill: 'var(--color-brand-50)', soft: 'var(--color-brand-200)' },
  good: { stroke: 'var(--color-good-500)', fill: 'var(--color-good-50)', soft: 'var(--color-good-200)' },
  warn: { stroke: 'var(--color-warn-500)', fill: 'var(--color-warn-50)', soft: 'var(--color-warn-200)' },
  crit: { stroke: 'var(--color-crit-500)', fill: 'var(--color-crit-50)', soft: 'var(--color-crit-200)' },
  plum: { stroke: 'var(--color-plum-500)', fill: 'var(--color-plum-50)', soft: 'var(--color-plum-200)' },
  teal: { stroke: 'var(--color-teal-700)', fill: 'var(--color-teal-50)', soft: 'var(--color-teal-200)' },
  none: { stroke: 'var(--color-neutral-fill)', fill: '#ffffff', soft: 'var(--color-line)' },
}
const TONES = Object.keys(TONE_COLOR) as JTone[]
const BADGE_TONE: Record<JTone, Tone> = { brand: 'info', good: 'good', warn: 'warn', crit: 'crit', plum: 'plum', teal: 'teal', none: 'none' }
const STAGE_FILL: Record<string, { stroke: string; fill: string }> = {
  'Pre validation': { stroke: 'var(--color-teal-200)', fill: 'var(--color-teal-50)' },
  Configuration: { stroke: 'var(--color-brand-200)', fill: 'var(--color-brand-50)' },
  'Post validation': { stroke: 'var(--color-warn-200)', fill: 'var(--color-warn-50)' },
}

/* ---------------------------------------------------------- routing */
type Pt = { x: number; y: number }
const horiz = (p: JPort) => p === 'left' || p === 'right'

function port(n: JNode, p: JPort): Pt {
  const hw = n.w / 2; const hh = n.h / 2
  switch (p) {
    case 'left': return { x: n.x - hw, y: n.y }
    case 'right': return { x: n.x + hw, y: n.y }
    case 'top': return { x: n.x, y: n.y - hh }
    case 'bottom': return { x: n.x, y: n.y + hh }
  }
}

/** Orthogonal polyline from one port to another, honouring the waypoints. */
function routeEdge(e: JEdge, byId: Map<string, JNode>): Pt[] {
  const a = byId.get(e.from); const b = byId.get(e.to)
  if (!a || !b) return []
  const fp = e.fromPort ?? 'right'; const tp = e.toPort ?? 'left'
  const raw: Pt[] = [port(a, fp)]
  let prev = raw[0]
  ;(e.via ?? []).forEach((v) => { const pt = { x: v.x ?? prev.x, y: v.y ?? prev.y }; raw.push(pt); prev = pt })
  raw.push(port(b, tp))
  const out: Pt[] = [raw[0]]
  for (let i = 0; i < raw.length - 1; i += 1) {
    const s = raw[i]; const t = raw[i + 1]
    const first = i === 0; const last = i === raw.length - 2
    if (s.x !== t.x && s.y !== t.y) {
      if (first && last) {
        if (horiz(fp) && horiz(tp)) { const mx = (s.x + t.x) / 2; out.push({ x: mx, y: s.y }, { x: mx, y: t.y }) }
        else if (!horiz(fp) && !horiz(tp)) { const my = (s.y + t.y) / 2; out.push({ x: s.x, y: my }, { x: t.x, y: my }) }
        else if (horiz(fp)) out.push({ x: t.x, y: s.y })
        else out.push({ x: s.x, y: t.y })
      } else if (first) out.push(horiz(fp) ? { x: t.x, y: s.y } : { x: s.x, y: t.y })
      else if (last) out.push(horiz(tp) ? { x: s.x, y: t.y } : { x: t.x, y: s.y })
      else out.push({ x: t.x, y: s.y })
    }
    out.push(t)
  }
  return out
}

function pathD(pts: Pt[], r = 7): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i - 1]; const c = pts[i]; const n = pts[i + 1]
    const d1 = Math.hypot(c.x - p.x, c.y - p.y); const d2 = Math.hypot(n.x - c.x, n.y - c.y)
    if (!d1 || !d2) { d += ` L${c.x} ${c.y}`; continue }
    const rr = Math.min(r, d1 / 2, d2 / 2)
    const a = { x: c.x - ((c.x - p.x) / d1) * rr, y: c.y - ((c.y - p.y) / d1) * rr }
    const b = { x: c.x + ((n.x - c.x) / d2) * rr, y: c.y + ((n.y - c.y) / d2) * rr }
    d += ` L${a.x} ${a.y} Q${c.x} ${c.y} ${b.x} ${b.y}`
  }
  const l = pts[pts.length - 1]
  return `${d} L${l.x} ${l.y}`
}

/** A point part-way along the polyline, and whether that segment is vertical. */
function along(pts: Pt[], f: number): { p: Pt; vertical: boolean } {
  const segs = pts.slice(1).map((p, i) => ({ a: pts[i], b: p, len: Math.hypot(p.x - pts[i].x, p.y - pts[i].y) }))
  const total = segs.reduce((n, s) => n + s.len, 0)
  let want = total * f
  for (const s of segs) {
    if (want <= s.len || s === segs[segs.length - 1]) {
      const t = s.len ? Math.min(1, want / s.len) : 0
      return { p: { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }, vertical: s.a.x === s.b.x }
    }
    want -= s.len
  }
  return { p: pts[0], vertical: false }
}

/* ---------------------------------------------------------- shapes */
function Lightning({ x, y, size = 9, color }: { x: number; y: number; size?: number; color: string }) {
  const s = size / 10
  return (
    <path
      d={`M${x - 2 * s} ${y - 5 * s} L${x + 3 * s} ${y - 5 * s} L${x} ${y - s} L${x + 3 * s} ${y - s} L${x - 2 * s} ${y + 5 * s} L${x - 0.5 * s} ${y + s} L${x - 3 * s} ${y + s} Z`}
      fill={color} stroke="none"
    />
  )
}

function Label({ x, y, w, h, title, sub, muted, align = 'center', bold = true, valign = 'center' }:
{ x: number; y: number; w: number; h: number; title: string; sub?: string; muted: boolean; align?: 'center' | 'left'; bold?: boolean; valign?: 'start' | 'center' | 'end' }) {
  return (
    <foreignObject x={x} y={y} width={w} height={h} style={{ pointerEvents: 'none', overflow: 'visible' }}>
      <div style={{
        fontFamily: 'var(--font-sans)', textAlign: align, lineHeight: 1.2,
        display: 'flex', flexDirection: 'column', justifyContent: valign === 'start' ? 'flex-start' : valign === 'end' ? 'flex-end' : 'center',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        height: '100%', color: muted ? 'var(--color-ink-3)' : 'var(--color-ink-1)',
      }}>
        <div style={{ fontSize: 12, fontWeight: bold ? 600 : 500, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--color-ink-3)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{sub}</div>}
      </div>
    </foreignObject>
  )
}

function NodeView({ n, selected, hovered, animate }: { n: JNode; selected: boolean; hovered: boolean; animate: boolean }) {
  const off = n.visit === 'off'
  const c = TONE_COLOR[off ? 'none' : n.tone]
  const stroke = c.stroke
  const fill = off ? '#fff' : c.fill
  const dash = off ? '4 3' : undefined
  const sw = n.visit === 'current' || selected ? 2.4 : 1.6
  const hw = n.w / 2; const hh = n.h / 2
  const delay = animate && n.step !== undefined && !off ? `${Math.max(0, (n.step + 1) * STEP_S - 0.12)}s` : undefined
  const style: React.CSSProperties = {
    cursor: 'pointer',
    opacity: off ? 0.75 : 1,
    filter: hovered || selected ? 'drop-shadow(0 3px 6px rgba(10,13,18,.18))' : undefined,
    ...(delay ? { animation: `lcm-light .45s ease-out ${delay} both`, transformBox: 'fill-box', transformOrigin: 'center' } : {}),
  }
  const isEvent = n.shape === 'start' || n.shape === 'end' || n.shape === 'end-error'
  const isRect = !isEvent && n.shape !== 'gateway' && n.shape !== 'data'

  const ring = n.visit === 'current' && (
    isEvent
      ? <circle cx={n.x} cy={n.y} r={hw + 7} fill="none" stroke={c.soft} strokeWidth={5} className="anim-pulse" />
      : n.shape === 'gateway'
        ? <rect x={n.x - 14} y={n.y - 14} width={28} height={28} rx={4} transform={`rotate(45 ${n.x} ${n.y})`} fill="none" stroke={c.soft} strokeWidth={9} className="anim-pulse" />
        : <rect x={n.x - hw - 6} y={n.y - hh - 6} width={n.w + 12} height={n.h + 12} rx={13} fill="none" stroke={c.soft} strokeWidth={5} className="anim-pulse" />
  )
  const sel = selected && (
    isEvent
      ? <circle cx={n.x} cy={n.y} r={hw + 5} fill="none" stroke="var(--color-brand-500)" strokeWidth={1.5} strokeDasharray="3 2" />
      : <rect x={n.x - hw - 5} y={n.y - hh - 5} width={n.w + 10} height={n.h + 10} rx={isRect ? 12 : 8} fill="none" stroke="var(--color-brand-500)" strokeWidth={1.5} strokeDasharray="3 2" />
  )

  let body: ReactNode
  if (n.shape === 'start') {
    body = (
      <>
        <circle cx={n.x} cy={n.y} r={hw} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
        <path d={`M${n.x - 4} ${n.y - 6} L${n.x + 6} ${n.y} L${n.x - 4} ${n.y + 6} Z`} fill={stroke} />
      </>
    )
  } else if (n.shape === 'end' || n.shape === 'end-error') {
    body = (
      <>
        <circle cx={n.x} cy={n.y} r={hw} fill={fill} stroke={stroke} strokeWidth={3.2} strokeDasharray={dash} />
        {n.shape === 'end-error'
          ? <Lightning x={n.x} y={n.y} size={11} color={stroke} />
          : <circle cx={n.x} cy={n.y} r={5} fill={stroke} />}
      </>
    )
  } else if (n.shape === 'gateway') {
    body = (
      <>
        <rect x={n.x - 14} y={n.y - 14} width={28} height={28} rx={4} transform={`rotate(45 ${n.x} ${n.y})`} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
        <path d={`M${n.x - 5} ${n.y - 5} L${n.x + 5} ${n.y + 5} M${n.x + 5} ${n.y - 5} L${n.x - 5} ${n.y + 5}`} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      </>
    )
  } else if (n.shape === 'data') {
    const x0 = n.x - hw; const y0 = n.y - hh; const f = 12
    body = (
      <path
        d={`M${x0} ${y0} H${x0 + n.w - f} L${x0 + n.w} ${y0 + f} V${y0 + n.h} H${x0} Z M${x0 + n.w - f} ${y0} V${y0 + f} H${x0 + n.w}`}
        fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} strokeLinejoin="round"
      />
    )
  } else {
    const Icon = n.shape === 'user' ? User : n.shape === 'service' ? Settings : n.shape === 'subprocess' ? Layers : null
    body = (
      <>
        <rect x={n.x - hw} y={n.y - hh} width={n.w} height={n.h} rx={9} fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
        {n.shape !== 'compensate' && <rect x={n.x - hw} y={n.y - hh} width={4} height={n.h} rx={2} fill={stroke} opacity={off ? 0.5 : 1} />}
        {Icon && (
          <g transform={`translate(${n.x - hw + 8} ${n.y - hh + 5})`}>
            <Icon size={11} strokeWidth={2.2} color={stroke} />
          </g>
        )}
        {n.shape === 'subprocess' && (
          <g>
            <rect x={n.x - 7} y={n.y + hh - 12} width={14} height={11} rx={2} fill="#fff" stroke={stroke} strokeWidth={1.2} />
            <path d={`M${n.x - 3.5} ${n.y + hh - 6.5} H${n.x + 3.5} M${n.x} ${n.y + hh - 10} V${n.y + hh - 3}`} stroke={stroke} strokeWidth={1.4} strokeLinecap="round" />
          </g>
        )}
        {n.shape === 'compensate' && (
          <path d={`M${n.x - 1} ${n.y + hh - 9} L${n.x - 7} ${n.y + hh - 5} L${n.x - 1} ${n.y + hh - 1} Z M${n.x + 6} ${n.y + hh - 9} L${n.x} ${n.y + hh - 5} L${n.x + 6} ${n.y + hh - 1} Z`} fill={stroke} />
        )}
      </>
    )
  }

  const labelBelow = isEvent || n.shape === 'gateway'
  return (
    <g data-node={n.id} style={style}>
      {ring}
      {sel}
      {body}
      {labelBelow
        ? <Label x={n.x - 56} y={n.labelPos === 'above' ? n.y - hh - 38 : n.y + hh + 4} w={112} h={34} title={n.label} sub={n.sub} muted={off} bold={n.shape !== 'gateway'} valign={n.labelPos === 'above' ? 'end' : 'start'} />
        : n.shape === 'data'
          ? <Label x={n.x - hw + 6} y={n.y - hh + 2} w={n.w - 16} h={n.h - 4} title={n.label} sub={n.sub} muted={off} align="left" />
          : <Label x={n.x - hw + (n.shape === 'compensate' ? 8 : 20)} y={n.y - hh + 2} w={n.w - (n.shape === 'compensate' ? 14 : 26)} h={n.h - 4 - (n.shape === 'subprocess' ? 8 : 0)} title={n.label} sub={n.sub} muted={off} align="left" />}
      {n.boundary && (
        <g>
          <circle cx={n.x + hw - 6} cy={n.y + hh - 1} r={9} fill="#fff" stroke={stroke} strokeWidth={1.8} />
          <circle cx={n.x + hw - 6} cy={n.y + hh - 1} r={6.5} fill="none" stroke={stroke} strokeWidth={1} />
          {n.boundary === 'error'
            ? <Lightning x={n.x + hw - 6} y={n.y + hh - 1} size={8} color={stroke} />
            : <path d={`M${n.x + hw - 5} ${n.y + hh - 4} L${n.x + hw - 9} ${n.y + hh - 1} L${n.x + hw - 5} ${n.y + hh + 2} Z M${n.x + hw - 1} ${n.y + hh - 4} L${n.x + hw - 5} ${n.y + hh - 1} L${n.x + hw - 1} ${n.y + hh + 2} Z`} fill={stroke} />}
        </g>
      )}
      {n.marker && (
        <g>
          <rect x={n.x + hw - 22} y={n.y - hh - 9} width={26} height={16} rx={8} fill={stroke} />
          <text x={n.x + hw - 9} y={n.y - hh + 2.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff" fontFamily="var(--font-sans)">{n.marker}</text>
        </g>
      )}
    </g>
  )
}

function EdgeView({ e, pts, hot, animate }: { e: JEdge; pts: Pt[]; hot: boolean; animate: boolean }) {
  if (pts.length < 2) return null
  const c = TONE_COLOR[e.taken ? e.tone : 'none']
  const d = pathD(pts)
  const dashed = e.kind === 'msg' ? '7 4' : e.kind === 'assoc' ? '2 4' : e.taken ? undefined : '5 4'
  const draw = animate && e.taken && e.kind === 'seq' && e.step !== undefined
  const fade = animate && e.taken && e.kind !== 'seq' && e.step !== undefined
  const width = e.taken ? (hot ? 3 : 2.2) : (hot ? 2 : 1.4)
  const marker = e.kind === 'assoc' ? undefined : `url(#arr-${e.kind === 'msg' ? 'open-' : ''}${e.taken ? e.tone : 'none'})`
  const mid = along(pts, 0.5)
  return (
    <g opacity={e.taken ? 1 : 0.7}>
      {/* a wide invisible twin so a thin line is still hoverable */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
      <path
        d={d} fill="none" stroke={c.stroke} strokeWidth={width} markerEnd={marker}
        strokeLinecap="round"
        /* pathLength=1 makes the dash offset unit-free, so one keyframe
           draws every edge in regardless of its real length. */
        strokeDasharray={draw ? 1 : dashed}
        pathLength={draw ? 1 : undefined}
        style={draw
          ? { strokeDashoffset: 1, animation: `lcm-draw ${STEP_S}s linear ${(e.step ?? 0) * STEP_S}s both` }
          : fade ? { animation: `lcm-fade-up .4s ease-out ${(e.step ?? 0) * STEP_S}s both` } : undefined}
      />
      {e.kind === 'msg' && <circle cx={pts[0].x} cy={pts[0].y} r={3.5} fill="#fff" stroke={c.stroke} strokeWidth={1.5} />}
      {e.kind === 'assoc' && <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} fill={c.stroke} />}
      {e.label && (
        <text
          x={mid.vertical ? mid.p.x + 7 : mid.p.x} y={mid.vertical ? mid.p.y + 3.5 : mid.p.y - 6}
          textAnchor={mid.vertical ? 'start' : 'middle'} fontSize={10} fontWeight={500} fontFamily="var(--font-sans)"
          fill={e.taken ? 'var(--color-ink-2)' : 'var(--color-ink-3)'}
          style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3, strokeLinejoin: 'round' }}
        >
          {e.label}{e.count && e.count > 1 ? ` ×${e.count}` : ''}
        </text>
      )}
    </g>
  )
}

/* ---------------------------------------------------------- canvas */
/**
 * The scale at which the whole graph fits the canvas. Width-bound normally —
 * the canvas takes its height from the graph — and bound by both when the
 * canvas is expanded to the viewport and its height is fixed. Allowed to go
 * past 1: on a wide screen a diagram drawn at 1× in a 1.6× box is just small.
 */
function useFit(graph: JGraph, minK: number, byHeight: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect
      setBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }))
    })
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const wFit = box.w ? (box.w - 32) / graph.width : 1
  const hFit = byHeight && box.h ? (box.h - 32) / graph.height : Infinity
  const fitK = box.w ? Math.max(minK, Math.min(1.3, wFit, hFit)) : 1
  return { ref, cw: box.w, ch: box.h, fitK }
}

interface CanvasProps {
  graph: JGraph
  selected: string | null
  onSelect: (id: string | null) => void
  replayKey: number
  onReplay?: () => void
  minK?: number
  toolbar?: ReactNode
  laneHeader?: (lane: JGraph['lanes'][number]) => ReactNode
  /** Floats over the canvas, top right, when something on this canvas is selected. */
  panel?: ReactNode
  /** Shortest the canvas gets; the graph is centred vertically inside it. */
  minHeight?: number
  /** Shown as the title bar when the canvas is expanded to the viewport. */
  title?: string
}

function Canvas({ graph, selected, onSelect, replayKey, onReplay, minK = 0.6, toolbar, laneHeader, panel, minHeight = 280, title }: CanvasProps) {
  const [expanded, setExpanded] = useState(false)
  const { ref, cw, ch, fitK } = useFit(graph, minK, expanded)
  const [view, setView] = useState({ k: 1, tx: 16, ty: 12 })
  const [hover, setHover] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; node: JNode } | null>(null)
  /* What was under the pointer when it went down. Pointer capture retargets
     every later event to the canvas itself, so the node has to be resolved
     here and remembered — reading it on pointer-up finds only the canvas. */
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean; hit: string | null } | null>(null)

  /* Normal: as tall as the graph needs at this scale, never shorter than
     minHeight. Expanded: whatever the viewport gives. */
  const height = expanded ? ch : Math.round(Math.min(720, Math.max(minHeight, graph.height * view.k + 24)))
  const centred = (k: number) => ({
    k,
    tx: Math.max(16, (cw - graph.width * k) / 2),
    ty: Math.max(12, ((expanded ? ch : Math.max(minHeight, graph.height * k + 24)) - graph.height * k) / 2),
  })

  /* Fit whenever the box or the graph changes. */
  useEffect(() => {
    if (!cw) return
    setView(centred(fitK))
  }, [cw, ch, fitK, graph.width, graph.height, expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!expanded) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [expanded])
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const routed = useMemo(() => graph.edges.map((e) => ({ e, pts: routeEdge(e, byId) })), [graph, byId])
  const tokenD = useMemo(() => {
    if (!graph.story.length) return ''
    const pathOf = new Map(routed.map((r) => [r.e.id, r.pts]))
    return graph.story.map((id) => pathD(pathOf.get(id) ?? [])).join(' ')
  }, [graph.story, routed])

  const zoomBy = (f: number, cx?: number, cy?: number) => setView((v) => {
    const k = Math.min(2.2, Math.max(0.35, v.k * f))
    const px = cx ?? (cw / 2); const py = cy ?? (height / 2)
    return { k, tx: px - (px - v.tx) * (k / v.k), ty: py - (py - v.ty) * (k / v.k) }
  })
  const fit = () => setView(centred(fitK))

  useEffect(() => {
    const el = ref.current; if (!el) return
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return
      ev.preventDefault()
      const r = el.getBoundingClientRect()
      zoomBy(ev.deltaY < 0 ? 1.12 : 0.89, ev.clientX - r.left, ev.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [cw, height]) // eslint-disable-line react-hooks/exhaustive-deps

  const nodeAt = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-node]')?.getAttribute('data-node') ?? null : null)
  const laneAt = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-lane]')?.getAttribute('data-lane') ?? null : null)

  return (
    <div className={expanded ? 'fixed inset-0 z-[70] bg-white p-4 flex flex-col gap-3 anim-in' : 'relative'}>
      {expanded && (
        <div className="flex items-center justify-between gap-3 shrink-0">
          <div className="vw-card-title">{title ?? 'BPMN diagram'}</div>
          <span className="text-[12px] text-ink-3">Esc to close</span>
        </div>
      )}
      <div
        ref={ref}
        className={`relative overflow-hidden rounded-[var(--vw-radius-sm)] border border-line select-none ${expanded ? 'flex-1 min-h-0' : ''}`}
        style={{
          height: expanded ? undefined : height, backgroundColor: 'var(--vw-color-gray-50)',
          backgroundImage: 'radial-gradient(var(--vw-color-gray-300) 1px, transparent 1px)', backgroundSize: '16px 16px',
          cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none',
        }}
        onPointerDown={(ev) => {
          drag.current = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty, moved: false, hit: nodeAt(ev.target) ?? laneAt(ev.target) }
          ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
        }}
        onPointerMove={(ev) => {
          const d = drag.current
          if (d) {
            const dx = ev.clientX - d.x; const dy = ev.clientY - d.y
            if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
            if (d.moved) setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }))
            return
          }
          const id = nodeAt(ev.target)
          setHover(id)
          if (id) {
            const r = ref.current!.getBoundingClientRect()
            setTip({ x: ev.clientX - r.left, y: ev.clientY - r.top, node: byId.get(id)! })
          } else setTip(null)
        }}
        onPointerUp={() => {
          const d = drag.current; drag.current = null
          if (!d || d.moved) return
          onSelect(d.hit)
        }}
        onPointerLeave={() => { setHover(null); setTip(null) }}
      >
        <svg width="100%" height="100%" style={{ display: 'block' }} aria-label="BPMN diagram">
          <defs>
            {TONES.map((t) => (
              <g key={t}>
                <marker id={`arr-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 Z" fill={TONE_COLOR[t].stroke} />
                </marker>
                <marker id={`arr-open-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 Z" fill="#fff" stroke={TONE_COLOR[t].stroke} strokeWidth={1.4} />
                </marker>
              </g>
            ))}
          </defs>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
            {/* lanes */}
            {graph.lanes.length > 0 && (
              <g>
                <rect x={0} y={graph.lanes[0].y} width={graph.width} height={graph.lanes.reduce((n, l) => n + l.h, 0)} rx={10} fill="#fff" stroke="var(--color-line)" />
                {graph.lanes.map((l, i) => {
                  const c = TONE_COLOR[l.tone]
                  return (
                    <g key={l.id} data-lane={l.id} style={{ cursor: 'pointer' }}>
                      {i > 0 && <line x1={0} y1={l.y} x2={graph.width} y2={l.y} stroke="var(--color-line)" />}
                      <rect x={0} y={l.y} width={36} height={l.h} fill={selected === l.id ? c.fill : 'var(--color-plane)'} stroke="var(--color-line)" rx={i === 0 ? 10 : 0} />
                      <rect x={0} y={l.y} width={4} height={l.h} fill={c.stroke} />
                      <text transform={`translate(22 ${l.y + l.h / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="var(--font-sans)" fill="var(--color-ink-2)" letterSpacing=".06em">
                        {l.label.toUpperCase()}
                      </text>
                      <foreignObject x={48} y={l.y + 8} width={graph.width - 60} height={22} style={{ pointerEvents: 'none', overflow: 'visible' }}>
                        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--color-ink-2)', display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
                          {laneHeader ? laneHeader(l) : <span>{l.sub}</span>}
                        </div>
                      </foreignObject>
                    </g>
                  )
                })}
              </g>
            )}
            {/* stage groups */}
            {graph.groups.map((g) => {
              const c = STAGE_FILL[g.kind] ?? STAGE_FILL.Configuration
              return (
                <g key={g.id}>
                  <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} fill={c.fill} stroke={c.stroke} strokeDasharray="5 4" />
                  <text x={g.x + 12} y={g.y + 17} fontSize={10.5} fontWeight={600} fontFamily="var(--font-sans)" fill="var(--color-ink-2)">{g.label}</text>
                  <text x={g.x + g.w - 12} y={g.y + 17} textAnchor="end" fontSize={9.5} fontFamily="var(--font-sans)" fill="var(--color-ink-3)" letterSpacing=".05em">{g.kind.toUpperCase()}</text>
                </g>
              )
            })}
            <g key={`edges-${replayKey}`}>
              {routed.filter((r) => !r.e.taken).map((r) => <EdgeView key={r.e.id} e={r.e} pts={r.pts} hot={hover === r.e.from || hover === r.e.to} animate={false} />)}
              {routed.filter((r) => r.e.taken).map((r) => <EdgeView key={r.e.id} e={r.e} pts={r.pts} hot={hover === r.e.from || hover === r.e.to} animate />)}
            </g>
            <g key={`nodes-${replayKey}`}>
              {graph.nodes.map((n) => <NodeView key={n.id} n={n} selected={selected === n.id} hovered={hover === n.id} animate />)}
              {tokenD && (
                <g key={`token-${replayKey}`}>
                  <circle r={7} fill="var(--color-brand-500)" stroke="#fff" strokeWidth={2.5} style={{ filter: 'drop-shadow(0 1px 3px rgba(28,129,239,.6))' }}>
                    <animateMotion dur={`${graph.story.length * STEP_S}s`} path={tokenD} fill="freeze" calcMode="linear" />
                  </circle>
                </g>
              )}
            </g>
          </g>
        </svg>

        {tip && !drag.current && (
          <div
            className="absolute z-10 pointer-events-none rounded-lg bg-ink-1 text-white shadow-lg px-3 py-2 text-[11.5px] leading-snug max-w-[260px]"
            style={{ left: Math.min(tip.x + 14, Math.max(0, cw - 270)), top: tip.y + 16 }}
          >
            <div className="font-semibold">{tip.node.label}</div>
            {tip.node.sub && <div className="opacity-80">{tip.node.sub}</div>}
            <div className="opacity-60 mt-0.5">{tip.node.visit === 'current' ? 'Where it stands now' : tip.node.visit === 'done' ? 'On the path taken' : 'Not taken'} · click for detail</div>
          </div>
        )}

        {/* controls */}
        <div className="absolute right-2 top-2 flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          {toolbar}
          {onReplay && (
            <button type="button" onClick={onReplay} className="nst-btn nst-btn--xs bg-white" title="Replay the journey"><Play size={12} />Replay</button>
          )}
          <button type="button" onClick={() => zoomBy(1.2)} className="nst-icon-btn w-7 h-7 bg-white" aria-label="Zoom in" title="Zoom in"><ZoomIn size={14} /></button>
          <button type="button" onClick={() => zoomBy(1 / 1.2)} className="nst-icon-btn w-7 h-7 bg-white" aria-label="Zoom out" title="Zoom out"><ZoomOut size={14} /></button>
          <button type="button" onClick={fit} className="nst-btn nst-btn--xs bg-white" title="Fit the whole diagram in view">Fit</button>
          <button
            type="button" onClick={() => setExpanded((v) => !v)} className="nst-icon-btn w-7 h-7 bg-white"
            aria-label={expanded ? 'Exit full screen' : 'Expand to full screen'} title={expanded ? 'Exit full screen (Esc)' : 'Expand to full screen'}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
        <div className="absolute left-2 bottom-1.5 text-[10.5px] text-ink-3 pointer-events-none">drag to pan · ⌘/ctrl + wheel to zoom · {Math.round(view.k * 100)}%</div>

        {/* The explanation sits over the diagram, next to what it explains,
            rather than in a column that would cost the diagram a third of
            its width. Scrolls on its own if it outgrows the canvas. */}
        {panel && (
          <div
            className="absolute right-2 top-11 w-[292px] max-w-[calc(100%-16px)] nst-surface--raised anim-in overflow-y-auto"
            style={{ maxHeight: 'calc(100% - 56px)', background: 'rgba(255,255,255,.96)', backdropFilter: 'blur(4px)' }}
            onPointerDown={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
          >
            {panel}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- legend */
function Swatch({ tone, dashed, label, kind = 'line' }: { tone: JTone; dashed?: boolean; label: string; kind?: 'line' | 'pulse' | 'box' }) {
  const c = TONE_COLOR[tone]
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-2">
      {kind === 'line' && (
        <svg width="26" height="10" aria-hidden><line x1="1" y1="5" x2="25" y2="5" stroke={c.stroke} strokeWidth={dashed ? 1.5 : 2.2} strokeDasharray={dashed ? '4 3' : undefined} /></svg>
      )}
      {kind === 'pulse' && <span className="w-3 h-3 rounded-full ring-[3px] anim-pulse" style={{ background: c.stroke, boxShadow: `0 0 0 3px ${c.soft}` }} />}
      {kind === 'box' && <span className="w-3.5 h-3.5 rounded-[4px] border-[1.5px]" style={{ background: c.fill, borderColor: c.stroke, borderStyle: tone === 'none' ? 'dashed' : 'solid' }} />}
      {label}
    </span>
  )
}

/* ---------------------------------------------------------- detail */
function DetailPanel({ detail, onClose, onOpenTask, onOpenRun }:
{ detail: JDetail; onClose: () => void; onOpenTask?: (t: RunTask) => void; onOpenRun?: (runId: string, endpointId?: string) => void }) {
  const cmd = detail.task?.command.split('\n') ?? []
  return (
    <div className="flex flex-col gap-3.5 p-3.5" key={detail.title + (detail.task?.taskDefId ?? '')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold leading-snug">{detail.title}</div>
          {detail.task && <div className="text-[11px] text-ink-3 mt-0.5">{detail.task.stage} · task {detail.task.sequence}</div>}
        </div>
        <button type="button" onClick={onClose} className="nst-icon-btn w-6 h-6 shrink-0" aria-label="Close detail"><X size={13} /></button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px] m-0 items-baseline">
        {detail.facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="vw-label whitespace-nowrap">{k}</dt>
            <dd className="m-0 font-medium break-words min-w-0">{v}</dd>
          </div>
        ))}
      </dl>
      {detail.note && <Note tone={detail.noteTone ?? 'info'} className="!px-3 !py-2 text-[12px]">{detail.note}</Note>}
      {detail.task && cmd.length > 0 && (
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-1">Command</div>
          <CodeBlock className="!text-[10.5px] !py-2 !px-2.5">{cmd.slice(0, 3).join('\n')}{cmd.length > 3 ? `\n… ${cmd.length - 3} more line${cmd.length - 3 === 1 ? '' : 's'}` : ''}</CodeBlock>
        </div>
      )}
      {(detail.task || detail.runId || detail.link) && (
        <div className="flex flex-col gap-1.5">
          {detail.task && onOpenTask && (
            <Button size="sm" onClick={() => onOpenTask(detail.task!)}><FileText size={13} />Request &amp; response</Button>
          )}
          {detail.runId && onOpenRun && (
            <Button size="sm" onClick={() => onOpenRun(detail.runId!, detail.endpointId)}><PlayCircle size={13} />Open in Lifecycle operation</Button>
          )}
          {detail.link && (
            <Link to={detail.link.to} className="nst-btn nst-btn--sm no-underline justify-center"><ExternalLink size={13} />{detail.link.label}</Link>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------- journey */
export default function BpmnJourney({ order, runs, workflows, onOpenTask, onOpenRun }: {
  order: Order
  /** Every run on this request, any attempt, any endpoint. */
  runs: Run[]
  workflows: Workflow[]
  onOpenTask?: (t: RunTask) => void
  onOpenRun?: (runId: string, endpointId?: string) => void
}) {
  const attempts = useMemo(() => attemptsOf(runs), [runs])
  const [attemptN, setAttemptN] = useState<number>(() => attempts[attempts.length - 1]?.n ?? 1)
  useEffect(() => { setAttemptN(attempts[attempts.length - 1]?.n ?? 1) }, [attempts.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const attempt = attempts.find((a) => a.n === attemptN) ?? attempts[attempts.length - 1]

  const requestGraph = useMemo(() => buildRequestGraph(order, runs), [order, runs])
  const wfName = (id: string) => workflows.find((w) => w.id === id)?.name
  const execGraph = useMemo(
    () => (attempt ? buildExecutionGraph(order, attempt.runs, wfName) : null),
    [order, attempt], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const [sel, setSel] = useState<string | null>(null)
  const [replay, setReplay] = useState(0)
  const [replayExec, setReplayExec] = useState(0)
  /* A different request, or the same one moving on, drops a stale selection. */
  useEffect(() => { setSel(null) }, [order.id, order.state])

  /* Which canvas the selection lives on decides where the panel floats. */
  const reqDetail = useMemo(() => (sel ? requestGraph.nodes.find((x) => x.id === sel)?.detail ?? null : null), [sel, requestGraph])
  const execDetail = useMemo(() => {
    if (!sel || !execGraph) return null
    return execGraph.nodes.find((x) => x.id === sel)?.detail ?? execGraph.lanes.find((l) => l.id === sel)?.detail ?? null
  }, [sel, execGraph])
  const panelFor = (d: JDetail | null) => (d ? <DetailPanel detail={d} onClose={() => setSel(null)} onOpenTask={onOpenTask} onOpenRun={onOpenRun} /> : undefined)

  const cur = requestGraph.nodes.find((n) => n.visit === 'current')
  const taken = requestGraph.nodes.filter((n) => n.visit !== 'off').length

  return (
    <div className="flex flex-col gap-4">
      {/* -------- request process -------- */}
      <Card>
        <CardHead
          title="Request process"
          sub={
            <>
              {taken - 1} of {requestGraph.nodes.length - 1} steps walked · standing at <b className="font-medium text-ink-1">{cur?.label ?? order.state}</b>
              {cur?.sub ? ` (${cur.sub})` : ''} · click any element for its detail
            </>
          }
          right={<Badge tone={BADGE_TONE[cur?.tone ?? 'none']} dot>{order.state}</Badge>}
        />
        <div className="p-3">
          <Canvas
            graph={requestGraph} selected={sel} onSelect={setSel}
            replayKey={replay} onReplay={() => setReplay((k) => k + 1)} minK={0.78}
            panel={panelFor(reqDetail)} title={`Request process · ${order.id}`}
          />
          <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-2.5 px-1">
            <Swatch tone="brand" label="Path taken" />
            <Swatch tone="brand" kind="pulse" label="Where it stands" />
            <Swatch tone="none" dashed label="Not taken" />
            <Swatch tone="crit" label="Rejection / failure path" />
            <Swatch tone="plum" label="Retry loop" />
            <Swatch tone="good" label="Landed on the estate" />
          </div>
        </div>
      </Card>

      {/* -------- execution sub-process -------- */}
      <Card>
        <CardHead
          title={<><Layers size={15} className="inline -mt-0.5 mr-1.5 text-brand-600" />Execute workflow — expanded</>}
          sub={attempt
            ? `Attempt ${attempt.n} of ${attempts.length} · ${attempt.runs.length} device${attempt.runs.length === 1 ? '' : 's'} · started ${dateTime(attempt.startedAt)} · one lane per device, the break point marked where a run stopped`
            : order.archived ? 'Per-task device log no longer retained for this request' : 'Nothing has run against the devices yet'}
          right={attempts.length > 1 ? (
            <select
              value={attemptN} onChange={(e) => setAttemptN(Number(e.target.value))}
              className="h-[30px] px-2.5 border border-line rounded-md text-[12.5px] bg-white" aria-label="Attempt"
            >
              {attempts.map((a) => <option key={a.n} value={a.n}>Attempt {a.n} · {a.outcome}</option>)}
            </select>
          ) : undefined}
        />
        <div className="p-3">
          {execGraph ? (
            <>
              <Canvas
                graph={execGraph} selected={sel} onSelect={setSel}
                replayKey={replayExec} onReplay={() => setReplayExec((k) => k + 1)} minK={0.7}
                panel={panelFor(execDetail)} minHeight={420} title={`Execute workflow · ${order.id} · attempt ${attempt?.n ?? 1}`}
                laneHeader={(l) => {
                  const run = attempt?.runs.find((r) => r.id === l.runId)
                  const t = run ? RUN_TONE[run.outcome] : 'none'
                  const chip = t === 'good' ? 'success' : t === 'crit' ? 'error' : t === 'warn' ? 'warning' : t === 'info' ? 'info' : 'neutral'
                  return (
                    <>
                      <span className="font-medium text-ink-1">{l.sub}</span>
                      {run && <span className={`vw-chip vw-chip--${chip} text-[10px] py-0`}>{run.outcome}</span>}
                      {run && <span className="text-ink-3">{wfName(run.workflowId) ?? run.workflowId}</span>}
                    </>
                  )
                }}
              />
              <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-2.5 px-1">
                <Swatch tone="good" kind="box" label="Passed" />
                <Swatch tone="brand" kind="pulse" label="Running" />
                <Swatch tone="warn" kind="box" label="Queued / skipped" />
                <Swatch tone="crit" kind="box" label="Failed — break point" />
                <Swatch tone="none" kind="box" label="Blocked / never ran" />
                <Swatch tone="crit" label="Roll back" />
                <Swatch tone="teal" dashed label="Message flow — waits on Source" />
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-[13px] text-ink-3">
              {order.archived
                ? <>This request executed and produced {order.serviceId ? <Mono>{order.serviceId}</Mono> : 'a service'}, but the task-by-task device log has aged out — the sub-process cannot be expanded.</>
                : 'The sub-process expands here once the request is approved and executed — every stage and task, per device, with the path it actually takes.'}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
