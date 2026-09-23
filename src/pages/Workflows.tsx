import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClearQuery, useQueryPatch, useQueryState, useScrollToResultsOnDrillIn } from '@/lib/useQueryState'
import {
  Cable, CheckCircle2, Clock, Copy, Cpu, Download, Eye, Grid3x3, Home, ListChecks, Pencil, Plus,
  RadioTower, Router, Send, ShieldCheck, Trash2, Network as SwitchIcon, Wifi, XCircle,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Category, Domain, Vendor, Workflow, WorkflowState } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Card, CardBody, CardHead, CellMain, Chip, DataTable,
  Kebab, Mono, Note, Stat, type Column,
} from '@/components/ui'
import { CoverageMatrix, type CoverageCol } from '@/components/charts'
import {
  CPE_VENDORS, ONT_VENDORS, OPTICAL_VENDORS,
  RADIO_VENDORS, ROUTER_VENDORS, SWITCH_VENDORS, VNF_VENDORS,
} from '@/data/catalog'
import { VENDOR_LABEL } from '@/data/workflows'
import { CATEGORY_TONE, DOMAIN_TONE, WORKFLOW_TONE } from '@/lib/format'

const STATES: WorkflowState[] = ['Draft', 'Assigned', 'Awaiting approval', 'Active', 'Rejected', 'Retired']
const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'VLAN', 'Microwave', 'DWDM', 'RAN VNF', 'GPON']
/* Router vendors first (they can carry any Transport intent), then Switch
   vendors (L2VPN only — a switch has no BGP/VRF to run an L3VPN or IBW
   intent with). CPE/Radio/Optical/ONT vendors are each a disjoint estate,
   scoped to their own category only. */
const VENDOR_COLS: Vendor[] = [...ROUTER_VENDORS, ...SWITCH_VENDORS]
const VENDOR_COVER_COLS: CoverageCol[] = VENDOR_COLS.map((v) => ({
  key: v, label: VENDOR_LABEL[v], sub: SWITCH_VENDORS.includes(v) ? 'Switch' : 'Router',
  icon: SWITCH_VENDORS.includes(v) ? SwitchIcon : Router,
}))
const CPE_VENDOR_COVER_COLS: CoverageCol[] = CPE_VENDORS.map((v) => ({ key: v, label: VENDOR_LABEL[v], sub: 'CPE', icon: Wifi }))
const RADIO_VENDOR_COVER_COLS: CoverageCol[] = RADIO_VENDORS.map((v) => ({ key: v, label: VENDOR_LABEL[v], sub: 'Radio', icon: RadioTower }))
const FIBER_VENDOR_COVER_COLS: CoverageCol[] = OPTICAL_VENDORS.map((v) => ({ key: v, label: VENDOR_LABEL[v], sub: 'Optical', icon: Cable }))
const VNF_VENDOR_COVER_COLS: CoverageCol[] = VNF_VENDORS.map((v) => ({ key: v, label: VENDOR_LABEL[v], sub: 'VNF', icon: Cpu }))
const ONT_VENDOR_COVER_COLS: CoverageCol[] = ONT_VENDORS.map((v) => ({ key: v, label: VENDOR_LABEL[v], sub: 'ONT', icon: Home }))
/* One vendor-column set per category — not per domain. Radio is the first
   domain where two categories (Microwave, RAN VNF) have disjoint vendor
   estates, so the coverage grid groups a domain's categories by their
   column signature and only surfaces a group switcher when a domain
   resolves to more than one distinct signature. Fiber has only one category
   (GPON), so it never needs that switcher. */
const CATEGORY_COVER_COLS: Record<Category, CoverageCol[]> = {
  L2VPN: VENDOR_COVER_COLS, L3VPN: VENDOR_COVER_COLS, IBW: VENDOR_COVER_COLS,
  VLAN: CPE_VENDOR_COVER_COLS, Microwave: RADIO_VENDOR_COVER_COLS, DWDM: FIBER_VENDOR_COVER_COLS,
  'RAN VNF': VNF_VENDOR_COVER_COLS,
  GPON: ONT_VENDOR_COVER_COLS,
}
const colSetKey = (c: Category) => CATEGORY_COVER_COLS[c].map((x) => x.key).join(',')
const domainCategoryGroups = (d: Domain): Category[][] => {
  const groups: Category[][] = []
  const byKey = new Map<string, Category[]>()
  CATEGORIES_BY_DOMAIN[d].forEach((c) => {
    const k = colSetKey(c)
    let g = byKey.get(k)
    if (!g) { g = []; byKey.set(k, g); groups.push(g) }
    g.push(c)
  })
  return groups
}
const ALL_VENDOR_COLS: Vendor[] = [
  ...VENDOR_COLS, ...CPE_VENDORS, ...RADIO_VENDORS, ...OPTICAL_VENDORS, ...VNF_VENDORS, ...ONT_VENDORS,
]

export default function Workflows() {
  const workflows = useStore((s) => s.workflows)
  const intents = useStore((s) => s.intents)
  const setState = useStore((s) => s.setWorkflowState)
  const pushToast = useStore((s) => s.pushToast)
  const nav = useNavigate()

  const [q, setQ] = useQueryState('q', '')
  const [qname, setQname] = useQueryState('name', '')
  const [qcode, setQcode] = useQueryState('code', '')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [wtype, setWtype] = useQueryState('type', 'All')
  const [wsubtype, setWsubtype] = useQueryState('subtype', 'All')
  const [st, setSt] = useQueryState<WorkflowState | 'All' | string>('state', 'All')
  const [intentId, setIntentId] = useQueryState('intent', 'All')
  const [vendor, setVendor] = useQueryState<Vendor | 'All'>('vendor', 'All')
  const stList = st === 'All' ? [] : st.split(',')
  const patch = useQueryPatch()
  const clear = useClearQuery(['q', 'name', 'code', 'domain', 'cat', 'type', 'subtype', 'state', 'intent', 'vendor'])
  const domainCats = domain === 'All' ? CATS : CATEGORIES_BY_DOMAIN[domain]
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const pickDomain = (d: Domain) => setDomainScoped(domain === d ? 'All' : d)
  const anyFilter = domain !== 'All' || cat !== 'All' || st !== 'All' || intentId !== 'All' || vendor !== 'All'
  const { ref: resultsRef, scrollToResults } = useScrollToResultsOnDrillIn(anyFilter ? `d=${domain}|c=${cat}|s=${st}|i=${intentId}|v=${vendor}` : '')

  const n = {
    state: (s: WorkflowState) => workflows.filter((w) => w.state === s).length,
    cat: (c: Category) => workflows.filter((w) => w.category === c).length,
  }

  const filtered = useMemo(() => workflows.filter((w) => {
    if (domain !== 'All' && domainOf(w.category) !== domain) return false
    if (cat !== 'All' && w.category !== cat) return false
    if (wtype !== 'All' && w.type !== wtype) return false
    if (wsubtype !== 'All' && w.subtype !== wsubtype) return false
    if (stList.length && !stList.includes(w.state)) return false
    if (intentId !== 'All' && w.intentId !== intentId) return false
    if (vendor !== 'All' && w.vendor !== vendor) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(w.id.toLowerCase().includes(t) || w.name.toLowerCase().includes(t) || w.vendor.toLowerCase().includes(t) || w.model.toLowerCase().includes(t))) return false
    }
    if (qname && !w.name.toLowerCase().includes(qname.toLowerCase())) return false
    if (qcode && !w.id.toLowerCase().includes(qcode.toLowerCase())) return false
    return true
  }), [workflows, domain, cat, wtype, wsubtype, st, intentId, vendor, q, qname, qcode]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Coverage: which intent × vendor combinations actually have an active workflow. */
  const coverage = useMemo(() => {
    const map = new Map<string, { built: number; draft: number }>()
    workflows.forEach((w) => {
      const k = `${w.intentId}|${w.vendor}`
      const cur = map.get(k) ?? { built: 0, draft: 0 }
      if (w.state === 'Active') cur.built += 1
      else if (w.state === 'Draft' || w.state === 'Assigned') cur.draft += 1
      map.set(k, cur)
    })
    return map
  }, [workflows])

  /* A Switch vendor has no BGP/VRF, so it only ever covers an L2VPN intent;
     a CPE vendor only ever covers a VLAN intent — everything else is
     "not applicable", not a real gap, and must be excluded from the
     denominator or Coverage% would be permanently deflated by combinations
     that can never be built. Checked by device-class membership for the
     category at hand, not by exclusion from every other class — a vendor
     like Nokia sells both Routers and ONTs, so it's a real member of more
     than one list, and excluding it from Transport just for also being an
     ONT_VENDOR would hide its genuine Router coverage. */
  const vendorApplicable = (category: Category, vendor: Vendor): boolean => {
    if (category === 'VLAN') return CPE_VENDORS.includes(vendor)
    if (category === 'Microwave') return RADIO_VENDORS.includes(vendor)
    if (category === 'DWDM') return OPTICAL_VENDORS.includes(vendor)
    if (category === 'RAN VNF') return VNF_VENDORS.includes(vendor)
    if (category === 'GPON') return ONT_VENDORS.includes(vendor)
    if (category === 'L2VPN') return ROUTER_VENDORS.includes(vendor) || SWITCH_VENDORS.includes(vendor)
    return ROUTER_VENDORS.includes(vendor)
  }
  const applicablePairs = useMemo(() => intents.flatMap((i) => ALL_VENDOR_COLS
    .filter((v) => vendorApplicable(i.category, v))
    .map((v) => `${i.id}|${v}`)), [intents]) // eslint-disable-line react-hooks/exhaustive-deps
  const built = applicablePairs.filter((k) => (coverage.get(k)?.built ?? 0) > 0).length
  const draftCombos = applicablePairs.filter((k) => (coverage.get(k)?.built ?? 0) === 0 && (coverage.get(k)?.draft ?? 0) > 0).length
  const combinations = applicablePairs.length
  const gaps = combinations - built
  const coveragePct = combinations > 0 ? Math.round((built / combinations) * 100) : 100

  /* The matrix stays single-category-group — every disjoint vendor estate
     mixed into one grid would be mostly dashes. It follows the Domain
     filter; "All" defaults to Transport, the largest domain, same as every
     other widget on this screen. A domain whose categories split across
     more than one vendor estate (Radio: Microwave vs RAN VNF) gets a group
     switcher; the current Category filter picks the group when it applies. */
  const coverageDomain: Domain = domain === 'All' ? 'Transport' : domain
  const coverageGroups = useMemo(() => domainCategoryGroups(coverageDomain), [coverageDomain])
  const coverageGroup = useMemo(() => {
    if (cat !== 'All' && domainOf(cat) === coverageDomain) {
      const g = coverageGroups.find((grp) => grp.includes(cat))
      if (g) return g
    }
    return coverageGroups[0] ?? []
  }, [coverageGroups, cat, coverageDomain])
  const coverageIntents = intents.filter((i) => coverageGroup.includes(i.category))
  const coverageCols = coverageGroup[0] ? CATEGORY_COVER_COLS[coverageGroup[0]] : []

  const columns: Column<Workflow>[] = [
    {
      key: 'state', header: 'Status', width: '120px', sortValue: (r) => r.state,
      render: (r) => <Badge tone={WORKFLOW_TONE[r.state]}>{r.state}</Badge>,
    },
    {
      key: 'wf', header: 'Name', width: '340px', sortValue: (r) => r.name,
      render: (r) => <CellMain><span className="block truncate max-w-[330px]" title={r.name}>{r.name}</span></CellMain>,
    },
    { key: 'code', header: 'Code', width: '110px', sortValue: (r) => r.id, render: (r) => <Mono>{r.id}</Mono> },
    { key: 'cat', header: 'Category', width: '110px', sortValue: (r) => r.category, render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge> },
    { key: 'type', header: 'Type', width: '140px', sortValue: (r) => r.type, render: (r) => r.type },
    { key: 'sub', header: 'Subtype', width: '110px', sortValue: (r) => r.subtype, render: (r) => r.subtype },
    { key: 'vendor', header: 'Vendor', width: '110px', sortValue: (r) => r.vendor, render: (r) => VENDOR_LABEL[r.vendor] },
    { key: 'version', header: 'Version', align: 'center', width: '84px', sortValue: (r) => r.version, render: (r) => r.version },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => nav(`/workflows/${r.id}`) },
          { label: 'Edit workflow', icon: Pencil, onClick: () => nav(`/workflows/${r.id}?edit=1`) },
          { label: 'Clone as new version', icon: Copy, onClick: () => nav(`/workflows/new?from=${r.id}`) },
          ...(r.state === 'Draft' || r.state === 'Assigned' || r.state === 'Rejected'
            ? [{ label: 'Send for approval', icon: Send, onClick: () => setState(r.id, 'Awaiting approval') }]
            : []),
          ...(r.state === 'Awaiting approval' ? [{ label: 'Approve & activate', icon: ShieldCheck, onClick: () => setState(r.id, 'Active') },
            { label: 'Reject', icon: XCircle, onClick: () => setState(r.id, 'Rejected'), danger: true }] : []),
          ...(r.state === 'Active' ? [{ label: 'Retire', icon: Trash2, onClick: () => setState(r.id, 'Retired'), danger: true }] : []),
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Total workflows" icon={ListChecks} value={workflows.length}
          progress={(n.state('Active') / Math.max(1, workflows.length)) * 100}
          note={`${n.state('Active')} active · ${n.state('Draft')} draft`}
          info="Every workflow definition in the library, in any state. A workflow is the executable recipe — tasks, assertions and acceptance criteria — that provisioning runs for one intent on one vendor and model."
          drillLabel="every workflow, unfiltered" onClick={() => { clear(); scrollToResults() }} />
        <Stat label="Active" icon={CheckCircle2} value={n.state('Active')} tone="good"
          progress={(n.state('Active') / Math.max(1, workflows.length)) * 100}
          note="Only Active workflows can be executed"
          info="Workflows that have been approved and published. Only these can be picked up by a provisioning request — everything else is still being authored or reviewed."
          drillLabel="active workflows" onClick={() => setSt('Active')} />
        <Stat label="Awaiting approval" icon={Clock} value={n.state('Awaiting approval') + n.state('Assigned')} tone="plum"
          progress={((n.state('Awaiting approval') + n.state('Assigned')) / Math.max(1, workflows.length)) * 100}
          note="Draft → Assigned → Awaiting approval → Active"
          info="Workflows sitting in the review queue: assigned to a reviewer or already submitted for approval. They cannot run until someone approves them."
          drillLabel="workflows waiting on approval" onClick={() => setSt('Assigned,Awaiting approval')} />
        <Stat label="Coverage" icon={Grid3x3} value={`${coveragePct}%`} tone={gaps === 0 ? 'good' : gaps > combinations / 2 ? 'crit' : 'warn'}
          progress={coveragePct}
          note={gaps === 0 ? `All ${combinations} intent × vendor combinations are covered` : `${gaps} of ${combinations} combinations have no active workflow`}
          info="The share of intent × vendor combinations that have at least one Active workflow. A gap means orders for that combination cannot be provisioned until a workflow is built and approved."
          drillLabel="draft workflows behind the remaining gaps" onClick={() => setSt('Draft')} />
      </div>

      <Card>
        <CardHead title="Coverage — intent by vendor" sub={`${coverageDomain} domain${coverageGroups.length > 1 ? ` — ${coverageGroup.join(' / ')}` : ''} — where an active workflow exists, and how much of the installed base rides on it`}
          info="Each tile shows whether an Active workflow exists for that intent on that vendor: a green count = that many active workflows, amber Draft = authoring has started but nothing is approved, a plain dash (—) = nothing exists — click it to see what's missing. Every vendor column is marked with its device class (Router, Switch, CPE, Radio, Optical, VNF, ONT) — those are disjoint estates, so a column only ever lights up under the category it belongs to; outside that category the dash is fixed and not clickable, because that combination can never be built. Use the Domain chip above the grid to switch between Transport, Access, Radio and Fiber — a domain with more than one disjoint vendor estate (Radio's Microwave/RAN VNF) adds its own group switcher underneath. The bar on the right is the live services riding on that intent — the bigger the bar, the more revenue depends on that row's coverage. Click a tile to filter the list below, or the bar to open those services."
          right={<>
            <Badge tone="good">Built {built}</Badge>
            {draftCombos > 0 && <Badge tone="warn">Draft {draftCombos}</Badge>}
            <Badge tone={gaps > 0 ? 'crit' : 'none'}>Gap {gaps}</Badge>
          </>} />
        <CardBody>
          <div className="flex items-center gap-1.5 mb-3.5">
            {DOMAINS.map((d) => (
              <Chip key={d} tone={DOMAIN_TONE[d]} active={(domain === 'All' ? 'Transport' : domain) === d} onClick={() => pickDomain(d)}>{d}</Chip>
            ))}
          </div>
          {coverageGroups.length > 1 && (
            <div className="flex items-center gap-1.5 mb-3.5">
              {coverageGroups.map((g) => (
                <Chip key={g.join(',')} tone={CATEGORY_TONE[g[0]]} active={coverageGroup === g} onClick={() => setCat(g[0])}>{g.join(' / ')}</Chip>
              ))}
            </div>
          )}
          <CoverageMatrix
            cols={coverageCols}
            rows={coverageIntents.map((i) => ({
              key: i.id,
              label: i.name,
              sub: `${workflows.filter((w) => w.intentId === i.id).length} workflows · v${i.version}`,
              trailing: serviceCount(i.id),
            }))}
            onCellClick={(r, c) => patch({ intent: r, vendor: c, state: null, cat: null })}
            onTrailingClick={(r) => nav(`/inventory?intent=${encodeURIComponent(r)}`)}
            cell={(r, c) => {
              const i = intents.find((x) => x.id === r)
              if (i && !vendorApplicable(i.category, c as Vendor)) return { state: 'na' as const }
              const v = coverage.get(`${r}|${c}`)
              if (v?.built) return { count: v.built, state: 'built' as const }
              if (v?.draft) return { state: 'draft' as const }
              return { state: 'gap' as const }
            }}
          />
          <Note className="mt-4">
            A workflow is bound to <b>category, type, subtype, vendor and model</b>. Adding a vendor means one workflow per
            intent, not one per combination — the tasks, assertions and acceptance criteria come from the intent.
          </Note>
        </CardBody>
      </Card>

      <div ref={resultsRef} />
      <DataTable
        rows={filtered} total={workflows.length} columns={columns}
        onRowClick={(r) => nav(`/workflows/${r.id}`)}
        minWidth={1180}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Name, Code, Vendor' },
          /* Domain is the one quick-chip facet kept inline; category and
             everything else lives in the filter popover so this stays one line. */
          chips: DOMAINS.map((d) => <Chip key={d} tone={DOMAIN_TONE[d]} active={domain === d} onClick={() => pickDomain(d)}>{d}</Chip>),
          filters: [
            { key: 'domain', label: 'Domain', value: domain, onChange: (v) => setDomainScoped(v as Domain | 'All'),
              options: DOMAINS.map((d) => ({ value: d, label: d, count: workflows.filter((w) => domainOf(w.category) === d).length })) },
            { key: 'state', label: 'Status', value: st, onChange: (v) => setSt(v),
              options: STATES.filter((x) => n.state(x) > 0).map((x) => ({ value: x, label: x, count: n.state(x) })) },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => patch({ cat: v === 'All' ? null : v, type: null, subtype: null }),
              options: domainCats.map((c) => ({ value: c, label: c, count: n.cat(c) })) },
            { key: 'type', label: 'Type', value: wtype, onChange: (v) => patch({ type: v === 'All' ? null : v, subtype: null }),
              options: [...new Set(workflows.filter((w) => cat === 'All' || w.category === cat).map((w) => w.type))].sort()
                .map((t) => ({ value: t, label: t, count: workflows.filter((w) => (cat === 'All' || w.category === cat) && w.type === t).length })) },
            { key: 'subtype', label: 'Subtype', value: wsubtype, onChange: setWsubtype,
              options: [...new Set(workflows.filter((w) => (cat === 'All' || w.category === cat) && (wtype === 'All' || w.type === wtype)).map((w) => w.subtype))].sort()
                .map((s) => ({ value: s, label: s, count: workflows.filter((w) => (cat === 'All' || w.category === cat) && (wtype === 'All' || w.type === wtype) && w.subtype === s).length })) },
            { key: 'vendor', label: 'Vendor', value: vendor, onChange: (v) => setVendor(v as Vendor | 'All'),
              options: ALL_VENDOR_COLS.map((v) => ({ value: v, label: VENDOR_LABEL[v], count: workflows.filter((w) => w.vendor === v).length })) },
            { key: 'intent', label: 'Intent', value: intentId, onChange: setIntentId,
              options: intents.map((i) => ({ value: i.id, label: i.name, count: workflows.filter((w) => w.intentId === i.id).length })) },
            { key: 'name', label: 'Name', type: 'text', value: qname, onChange: setQname },
            { key: 'code', label: 'Code', type: 'text', value: qcode, onChange: setQcode },
          ],
          activeFilterChips: [
            ...(cat !== 'All' ? [{ key: 'cat', label: 'Category', value: cat, onRemove: () => setCat('All') }] : []),
            ...(wtype !== 'All' ? [{ key: 'type', label: 'Type', value: wtype, onRemove: () => setWtype('All') }] : []),
            ...(wsubtype !== 'All' ? [{ key: 'subtype', label: 'Subtype', value: wsubtype, onRemove: () => setWsubtype('All') }] : []),
            ...(st !== 'All' ? [{ key: 'state', label: 'State', value: stList.join(' or '), onRemove: () => setSt('All') }] : []),
            ...(intentId !== 'All' ? [{ key: 'intent', label: 'Intent', value: intents.find((i) => i.id === intentId)?.name ?? intentId, onRemove: () => setIntentId('All') }] : []),
            ...(vendor !== 'All' ? [{ key: 'vendor', label: 'Vendor', value: vendor, onRemove: () => setVendor('All') }] : []),
            ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
            ...(qname ? [{ key: 'name', label: 'Name', value: qname, onRemove: () => setQname('') }] : []),
            ...(qcode ? [{ key: 'code', label: 'Code', value: qcode, onRemove: () => setQcode('') }] : []),
          ],
          onResetFilters: clear,
          onRefresh: () => pushToast('info', 'Workflow list refreshed.'),
          actions: [{ label: 'New workflow', icon: Plus, onClick: () => nav('/workflows/new') }, { label: 'Export to CSV', icon: Download, onClick: () => pushToast('info', 'Export queued — the file will appear in Reports.') }],
        }}
      />
    </>
  )

  function serviceCount(intentId: string) {
    return useStore.getState().services.filter((s) => s.intentId === intentId).length
  }
}
