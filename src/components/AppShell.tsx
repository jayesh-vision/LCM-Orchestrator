import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Bell, Boxes, CheckCircle2, CheckSquare, Database, FileBarChart,
  Info, LayoutGrid, ListChecks, PanelLeftClose, PanelLeftOpen, PlayCircle, RefreshCcw, Search, Server, Workflow as WorkflowIcon, X,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Badge, Button } from './ui'

interface NavItem { to: string; label: string; icon: typeof LayoutGrid; count?: () => string }

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ to: '/', label: 'Dashboard', icon: LayoutGrid }],
  },
  {
    label: 'Operate',
    items: [
      { to: '/requests', label: 'Provisioning Requests', icon: ListChecks },
      { to: '/execution', label: 'Provisioning Execution', icon: PlayCircle },
      { to: '/inventory', label: 'Service Inventory', icon: Server },
      { to: '/change', label: 'Change & Cease', icon: RefreshCcw },
    ],
  },
  {
    label: 'Configure',
    items: [
      { to: '/workflows', label: 'Workflows', icon: WorkflowIcon },
      { to: '/profile-types', label: 'Profile Types', icon: Boxes },
      { to: '/pools', label: 'Resource Pools', icon: Database },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { to: '/evidence', label: 'Evidence', icon: CheckSquare },
      { to: '/reports', label: 'Reports', icon: FileBarChart },
    ],
  },
]

const CRUMBS: Record<string, string> = {
  '/': 'Dashboard',
  '/requests': 'Operate / Provisioning Requests',
  '/execution': 'Operate / Provisioning Execution',
  '/inventory': 'Operate / Service Inventory',
  '/change': 'Operate / Change & Cease',
  '/workflows': 'Configure / Workflows',
  '/profile-types': 'Configure / Profile Types',
  '/pools': 'Configure / Resource Pools',
  '/evidence': 'Analyse / Evidence',
  '/reports': 'Analyse / Reports',
}

function useCounts() {
  const orders = useStore((s) => s.orders)
  const services = useStore((s) => s.services)
  const workflows = useStore((s) => s.workflows)
  const pools = useStore((s) => s.pools)
  const profileTypes = useStore((s) => s.profileTypes)
  const reports = useStore((s) => s.reports)
  return {
    '/requests': orders.length,
    '/execution': orders.filter((o) => !['Draft', 'Planned'].includes(o.state)).length,
    '/inventory': services.length,
    '/change': orders.filter((o) => o.intent !== 'Create').length,
    '/workflows': workflows.length,
    '/profile-types': profileTypes.length,
    '/pools': pools.length,
    '/reports': reports.length,
  } as Record<string, number>
}

export default function AppShell() {
  const loc = useLocation()
  const counts = useCounts()
  const notifications = useStore((s) => s.notifications)
  const markRead = useStore((s) => s.markNotificationRead)
  const markAll = useStore((s) => s.markAllNotificationsRead)
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)
  const [bellOpen, setBellOpen] = useState(false)
  const unread = notifications.filter((n) => !n.read).length

  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])

  const crumb = CRUMBS[loc.pathname]
    ?? Object.entries(CRUMBS).find(([k]) => k !== '/' && loc.pathname.startsWith(k))?.[1]
    ?? 'LCM Orchestrator'
  const parts = crumb.split(' / ')

  /* Collapsible sidebar — icons only when collapsed; the choice is remembered per browser. */
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('lcm.nav.collapsed') === '1' } catch { return false }
  })
  const toggleNav = () => {
    setCollapsed((c) => { try { localStorage.setItem('lcm.nav.collapsed', c ? '0' : '1') } catch { /* private mode */ } return !c })
  }

  /* Embed mode — for hosting a screen as an iframe elsewhere with no chrome of its
     own. `?leftbar=true` shows the sidebar + header (the normal app); leave it off
     (or pass leftbar=false) and only the routed screen renders. The choice is read
     once from the URL and then kept for the rest of the browser tab's session, so it
     survives in-app navigation even though most links don't carry the query string
     forward. Default (no param, fresh tab) is chrome hidden — the iframe-friendly mode. */
  const [search] = useSearchParams()
  const [showChrome, setShowChrome] = useState<boolean>(() => {
    const raw = search.get('leftbar')
    if (raw !== null) {
      const val = raw === 'true' || raw === '1'
      try { sessionStorage.setItem('lcm.leftbar', val ? '1' : '0') } catch { /* private mode */ }
      return val
    }
    try { return sessionStorage.getItem('lcm.leftbar') === '1' } catch { return false }
  })
  useEffect(() => {
    const raw = search.get('leftbar')
    if (raw === null) return
    const val = raw === 'true' || raw === '1'
    setShowChrome(val)
    try { sessionStorage.setItem('lcm.leftbar', val ? '1' : '0') } catch { /* private mode */ }
  }, [search])

  return (
    <div className="flex min-h-screen">
      {/* -------- sidebar -------- */}
      {showChrome && (
      <nav
        className={`${collapsed ? 'w-[64px]' : 'w-[254px]'} shrink-0 bg-white border-r border-line sticky top-0 h-screen overflow-y-auto overflow-x-hidden flex flex-col transition-[width] duration-200`}
        aria-label="Modules" data-collapsed={collapsed ? 'true' : 'false'}
      >
        <div className={`flex items-center gap-2.5 ${collapsed ? 'px-3.5 justify-center' : 'px-[18px]'} py-[18px] border-b border-line-soft`}>
          <div className="w-8 h-8 rounded-lg bg-ink-1 text-white grid place-items-center text-[11px] font-semibold shrink-0">LCM</div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[14px] font-semibold tracking-[-.2px]">Orchestrator</div>
              <div className="text-[10.5px] text-ink-3">NetSingularity OSS</div>
            </div>
          )}
        </div>

        {GROUPS.map((g, gi) => (
          <div key={gi} className={`${collapsed ? 'px-2' : 'px-2.5'} pt-3.5`}>
            {g.label && (collapsed
              ? <div className="h-px bg-line-soft mx-2 mb-2.5" aria-hidden />
              : <div className="text-[10px] font-semibold tracking-[.1em] uppercase text-ink-3 px-2 pb-1.5">{g.label}</div>)}
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === '/'}
                title={collapsed ? it.label : undefined}
                aria-label={it.label}
                className={({ isActive }) => `flex items-center gap-2.5 ${collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'} my-px rounded-md text-[13px] no-underline transition-colors
                  ${isActive ? 'bg-brand-50 text-brand-600 font-semibold' : 'text-ink-2 hover:bg-plane hover:text-ink-1'}`}
              >
                <it.icon size={collapsed ? 18 : 16} className="shrink-0 opacity-80" />
                {!collapsed && <span className="truncate">{it.label}</span>}
                {!collapsed && counts[it.to] !== undefined && (
                  <span className="ml-auto text-[11px] tnum text-ink-3 font-medium">{counts[it.to].toLocaleString()}</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="flex-1" />
        <div className={`flex items-center gap-2.5 ${collapsed ? 'px-3.5 justify-center' : 'px-[18px]'} py-3.5 border-t border-line-soft`}>
          <div className="w-7 h-7 rounded-full bg-[var(--vw-color-amber-400)] text-[var(--vw-color-amber-900)] grid place-items-center text-[11px] font-semibold shrink-0" title={collapsed ? 'Jayesh Verma · Network design' : undefined}>JV</div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[12.5px] font-medium">Jayesh Verma</div>
              <div className="text-[10.5px] text-ink-3">Network design</div>
            </div>
          )}
        </div>
      </nav>
      )}

      {/* -------- main -------- */}
      <div className="flex-1 min-w-0 flex flex-col">
        {showChrome && (
        <header className="h-14 bg-white border-b border-line pl-4 pr-7 flex items-center gap-3 sticky top-0 z-30">
          <button
            type="button" onClick={toggleNav}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} aria-expanded={!collapsed} title={collapsed ? 'Expand menu' : 'Collapse menu'}
            className="w-[34px] h-[34px] grid place-items-center rounded-md border border-line text-ink-2 hover:bg-plane shrink-0"
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="text-[12.5px] text-ink-3 flex items-center gap-1.5 min-w-0">
            {parts.map((p, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="opacity-50">/</span>}
                <span className={i === parts.length - 1 ? 'text-ink-1 font-semibold truncate' : ''}>{p}</span>
              </span>
            ))}
          </div>
          <div className="flex-1" />
          <div className="relative hidden md:block">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
            <input
              placeholder="Search services, orders, workflows…"
              className="nst-input has-icon-left w-[300px]"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setBellOpen((v) => !v)}
              className="w-[34px] h-[34px] grid place-items-center rounded-md border border-line text-ink-2 hover:bg-plane relative"
              aria-label={`Notifications, ${unread} unread`}
            >
              <Bell size={16} />
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-crit-500 text-white text-[10px] font-semibold grid place-items-center">
                  {unread}
                </span>
              )}
            </button>
            {bellOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setBellOpen(false)} />
                <div className="absolute right-0 top-11 z-50 w-[380px] bg-white border border-line rounded-xl shadow-pop anim-in overflow-hidden">
                  <div className="px-4 py-3 border-b border-line-soft flex items-center justify-between">
                    <span className="text-[13px] font-semibold">Notifications</span>
                    <button onClick={markAll} className="text-[12px] text-brand-600 hover:underline">Mark all read</button>
                  </div>
                  <div className="max-h-[380px] overflow-y-auto">
                    {notifications.map((n) => {
                      const Icon = n.tone === 'crit' ? AlertTriangle : n.tone === 'good' ? CheckCircle2 : n.tone === 'warn' ? AlertTriangle : Info
                      const c = n.tone === 'crit' ? 'text-crit-500' : n.tone === 'good' ? 'text-good-500' : n.tone === 'warn' ? 'text-warn-700' : 'text-brand-500'
                      return (
                        <button
                          key={n.id}
                          onClick={() => markRead(n.id)}
                          className={`w-full text-left flex gap-3 px-4 py-3 border-b border-line-soft last:border-b-0 hover:bg-plane ${n.read ? 'opacity-60' : ''}`}
                        >
                          <Icon size={16} className={`${c} shrink-0 mt-0.5`} />
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium text-ink-1">{n.title}</span>
                            <span className="block text-[11.5px] text-ink-3 leading-snug mt-0.5">{n.body}</span>
                          </span>
                          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0 mt-1.5" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </header>
        )}

        <main className="px-7 py-6 pb-12 flex flex-col gap-5 max-w-[1560px] w-full">
          <Outlet />
        </main>
      </div>

      {/* -------- toasts -------- */}
      <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[350px]">
        {toasts.map((t) => {
          const Icon = t.tone === 'crit' ? AlertTriangle : t.tone === 'good' ? CheckCircle2 : t.tone === 'warn' ? AlertTriangle : Info
          const c = t.tone === 'crit' ? 'text-crit-500' : t.tone === 'good' ? 'text-good-500' : t.tone === 'warn' ? 'text-warn-700' : 'text-brand-500'
          return (
            <div key={t.id} className="bg-white border border-line rounded-lg shadow-pop px-4 py-3 flex items-start gap-2.5 anim-in">
              <Icon size={16} className={`${c} shrink-0 mt-0.5`} />
              <span className="text-[12.5px] text-ink-1 flex-1 leading-snug">{t.text}</span>
              <button onClick={() => dismissToast(t.id)} className="text-ink-3 hover:text-ink-1 shrink-0" aria-label="Dismiss"><X size={14} /></button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { Badge, Button }
