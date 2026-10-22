import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, Eye, FolderTree, Layers, Plus, Shapes, Workflow as WorkflowIcon } from 'lucide-react'
import { useQueryState } from '@/lib/useQueryState'
import { useStore } from '@/store/useStore'
import type { Category, Domain, ProfileType } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, CellMain, DataTable,
  Field, FieldDropdown, Kebab, Modal, Note, Select, Stat, TextInput, type Column,
} from '@/components/ui'
import { CATEGORY_TONE, DOMAIN_TONE, shortDate } from '@/lib/format'

const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'VLAN', 'Microwave', 'DWDM', 'RAN VNF', 'GPON']

export default function ProfileTypes() {
  const profileTypes = useStore((s) => s.profileTypes)
  const workflows = useStore((s) => s.workflows)
  const add = useStore((s) => s.addProfileType)

  const nav = useNavigate()
  const pushToast = useStore((st) => st.pushToast)
  const [q, setQ] = useQueryState('q', '')
  const [qsubtype, setQsubtype] = useQueryState('subtype', '')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [ptype, setPtype] = useQueryState('type', 'All')
  const [usedFilter, setUsedFilter] = useQueryState<'All' | 'unused'>('used', 'All')
  const domainCats = domain === 'All' ? CATS : CATEGORIES_BY_DOMAIN[domain]
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ domain: '' as Domain | '', category: '' as Category | '', type: '', subtype: '', description: '' })
  const [view, setView] = useState<ProfileType | null>(null)

  const usage = useMemo(() => {
    const m = new Map<string, number>()
    workflows.forEach((w) => {
      const k = `${w.category}|${w.type}|${w.subtype}`
      m.set(k, (m.get(k) ?? 0) + 1)
    })
    return m
  }, [workflows])

  const filtered = useMemo(() => profileTypes.filter((p) => {
    if (domain !== 'All' && domainOf(p.category) !== domain) return false
    if (cat !== 'All' && p.category !== cat) return false
    if (ptype !== 'All' && p.type !== ptype) return false
    if (usedFilter === 'unused' && (usage.get(`${p.category}|${p.type}|${p.subtype}`) ?? 0) > 0) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(p.category.toLowerCase().includes(t) || p.type.toLowerCase().includes(t) || p.subtype.toLowerCase().includes(t))) return false
    }
    if (qsubtype && !p.subtype.toLowerCase().includes(qsubtype.toLowerCase())) return false
    return true
  }), [profileTypes, domain, cat, ptype, usedFilter, usage, q, qsubtype])

  const types = useMemo(() => new Set(profileTypes.map((p) => `${p.category}|${p.type}`)).size, [profileTypes])
  const unused = useMemo(
    () => profileTypes.filter((p) => !(usage.get(`${p.category}|${p.type}|${p.subtype}`) ?? 0)).length,
    [profileTypes, usage],
  )

  const columns: Column<ProfileType>[] = [
    { key: 'domain', header: 'Domain', width: '120px', sortValue: (r) => domainOf(r.category), render: (r) => domainOf(r.category) },
    { key: 'cat', header: 'Category', width: '120px', sortValue: (r) => r.category, render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge> },
    { key: 'type', header: 'Type', width: '170px', sortValue: (r) => r.type, render: (r) => r.type },
    { key: 'sub', header: 'Subtype', width: '150px', sortValue: (r) => r.subtype, render: (r) => <CellMain>{r.subtype}</CellMain> },
    { key: 'desc', header: 'Description', render: (r) => <span className="block truncate max-w-[560px]" title={r.description}>{r.description}</span> },
    { key: 'creator', header: 'Creator', width: '110px', sortValue: (r) => r.creator, render: (r) => r.creator },
    {
      key: 'used', header: 'Workflows', align: 'center', width: '100px',
      sortValue: (r) => usage.get(`${r.category}|${r.type}|${r.subtype}`) ?? 0,
      render: (r) => {
        const n = usage.get(`${r.category}|${r.type}|${r.subtype}`) ?? 0
        return n ? <span className="font-medium tnum">{n}</span> : <Badge tone="none">unused</Badge>
      },
    },
    {
      key: 'act', header: '', width: '48px',
      render: (r) => (
        <Kebab items={[
          { label: 'View details', icon: Eye, onClick: () => setView(r) },
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Profile types" icon={Layers} value={profileTypes.length} note="Category → Type → Subtype combinations"
          info="Service profiles define the category, type, and subtype used by workflows and requests." />
        <Stat label="Categories" icon={FolderTree} value={CATS.length} note="Across Transport, Access, Radio and Fiber domains"
          info="Categories are service families grouped under a domain." />
        <Stat label="Distinct types" icon={Shapes} value={types} note="Functional classifications across all categories"
          info="Types describe a service shape, such as Hub & Spoke. Each can have several subtypes." />
        <Stat label="Unused" icon={CircleAlert} value={unused} tone={unused > 0 ? 'warn' : 'good'}
          note={unused > 0 ? 'No workflow references these yet' : 'Every profile is referenced by a workflow'}
          info="These profiles have no workflow mapping, so requests using them cannot run." />
      </div>

      <DataTable
        rows={filtered} total={profileTypes.length} columns={columns} minWidth={1020}
        onRowClick={(row) => setView(row)}
        fillHeight
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Category, Type, Subtype' },
          /* Domain (Transport/Access/Radio/Fiber as one dropdown's options,
             not a pill per value) and Category are the two facets worth a
             direct dropdown in the toolbar; everything else stays behind
             the filter icon. */
          chips: [
            <FieldDropdown key="domain" label="Domain" value={domain} onChange={(v) => setDomainScoped(v as Domain | 'All')}
              options={DOMAINS.map((d) => ({ value: d, label: d, count: profileTypes.filter((p) => domainOf(p.category) === d).length }))} />,
            <FieldDropdown key="cat" label="Category" value={cat} onChange={(v) => setCat(v as Category | 'All')}
              options={domainCats.map((c) => ({ value: c, label: c, count: profileTypes.filter((p) => p.category === c).length }))} />,
          ],
          filters: [
            { key: 'type', label: 'Type', value: ptype, onChange: setPtype,
              options: [...new Set(profileTypes.map((p) => p.type))].sort().map((t) => ({ value: t, label: t, count: profileTypes.filter((p) => p.type === t).length })) },
            { key: 'subtype', label: 'Subtype', type: 'text', value: qsubtype, onChange: setQsubtype },
            { key: 'used', label: 'Usage', value: usedFilter, onChange: (v) => setUsedFilter(v as 'All' | 'unused'),
              options: [{ value: 'unused', label: 'Unused only', count: unused }] },
          ],
          onResetFilters: () => { setDomain('All'); setCat('All'); setPtype('All'); setUsedFilter('All'); setQ(''); setQsubtype('') },
          actions: [
            { label: 'Profile template', icon: Plus, onClick: () => setOpen(true) },
          ],
        }}
      />

      <Modal
        open={open} onClose={() => setOpen(false)}
        title="Profile template"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.domain || !form.category || !form.type.trim() || !form.subtype.trim() || !form.description.trim()}
              onClick={() => {
                if (!form.category) return
                add(form.category, form.type.trim(), form.subtype.trim(), form.description.trim())
                setForm({ domain: '', category: '', type: '', subtype: '', description: '' })
                setOpen(false)
              }}
            >Create</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-line p-3">
            <Field label="Domain" required>
              <Select value={form.domain} onChange={(e) => {
                const nextDomain = e.target.value as Domain
                setForm({ ...form, domain: nextDomain, category: '' })
              }}>
                <option value="" disabled>Select domain</option>
                {DOMAINS.map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="Category" required>
              <Select value={form.category} disabled={!form.domain} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
                <option value="" disabled>Select category</option>
                {form.domain && CATEGORIES_BY_DOMAIN[form.domain].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Profile type" required>
            <TextInput value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="Enter profile type" />
          </Field>
          <Field label="Subtype" required>
            <TextInput value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })} placeholder="Enter subtype" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" required>
              <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Enter description" />
            </Field>
          </div>
          {form.category && profileTypes.some((p) => p.category === form.category && p.type === form.type.trim() && p.subtype === form.subtype.trim()) && (
            <Note tone="warn">A profile type with this exact hierarchy already exists. Reuse it rather than creating a duplicate.</Note>
          )}
        </div>
      </Modal>

      {/* -------- view details -------- */}
      <Modal
        open={!!view} onClose={() => setView(null)}
        title={view ? `${view.category} · ${view.type} · ${view.subtype}` : ''}
        sub={view?.id}
        width={640}
        footer={<Button onClick={() => setView(null)}>Cancel</Button>}
      >
        {view && (() => {
          const count = usage.get(`${view.category}|${view.type}|${view.subtype}`) ?? 0
          return (
            <div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-5">
                <div>
                  <div className="vw-label mb-1">Domain</div>
                  <Badge tone={DOMAIN_TONE[domainOf(view.category)]}>{domainOf(view.category)}</Badge>
                </div>
                <div>
                  <div className="vw-label mb-1">Category</div>
                  <Badge tone={CATEGORY_TONE[view.category]}>{view.category}</Badge>
                </div>
                <div>
                  <div className="vw-label mb-1">Type</div>
                  <div className="vw-value font-medium">{view.type}</div>
                </div>
                <div>
                  <div className="vw-label mb-1">Subtype</div>
                  <div className="vw-value font-medium">{view.subtype}</div>
                </div>
                <div>
                  <div className="vw-label mb-1">Creator</div>
                  <div className="vw-value font-medium">{view.creator}</div>
                </div>
                <div>
                  <div className="vw-label mb-1">Created</div>
                  <div className="vw-value font-medium">{shortDate(view.createdAt)}</div>
                </div>
              </div>

              <div className="mt-5">
                <div className="vw-label mb-1">Description</div>
                <div className="vw-value font-medium">{view.description}</div>
              </div>
              {count > 0 ? (
                <button
                  type="button"
                  onClick={() => { setView(null); nav(`/workflows?cat=${encodeURIComponent(view.category)}&type=${encodeURIComponent(view.type)}&subtype=${encodeURIComponent(view.subtype)}`) }}
                  className="vw-card-child vw-card--clickable w-full max-w-[400px] text-left mt-5"
                  aria-label={`${count} workflows use this profile. Open them in Workflows`}
                >
                  <span className="vw-flex vw-items-center vw-justify-between vw-gap-sm">
                    <span className="vw-flex vw-items-center vw-gap-sm">
                      <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 ring-1 ring-inset bg-brand-50 text-brand-600 ring-brand-200/60" aria-hidden>
                        <WorkflowIcon size={16} />
                      </span>
                      <span>
                        <span className="vw-card-activity-label block">Workflows using this</span>
                        <span className="vw-card-activity-value block mt-0.5">Click to open them in Workflows</span>
                      </span>
                    </span>
                    <span className="vw-card-metric-sm tnum">{count}</span>
                  </span>
                </button>
              ) : (
                <div className="mt-5"><Note tone="warn">No workflow references this profile yet — an order that selects it can't be fulfilled until one is mapped.</Note></div>
              )}
            </div>
          )
        })()}
      </Modal>

    </>
  )
}
