import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, CircleAlert, Eye, FolderTree, Layers, Pencil, Plus, Shapes } from 'lucide-react'
import { useQueryState } from '@/lib/useQueryState'
import { useStore } from '@/store/useStore'
import type { Category, Domain, ProfileType } from '@/types'
import { CATEGORIES_BY_DOMAIN, DOMAINS, domainOf } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellMain, Chip, DataTable, Drawer,
  Field, Kebab, KV, Modal, Note, Select, Stat, TextInput, type Column,
} from '@/components/ui'
import { CATEGORY_TONE, DOMAIN_TONE, shortDate } from '@/lib/format'

const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW', 'Broadband', 'Microwave', 'DWDM']

export default function ProfileTypes() {
  const profileTypes = useStore((s) => s.profileTypes)
  const workflows = useStore((s) => s.workflows)
  const add = useStore((s) => s.addProfileType)
  const update = useStore((s) => s.updateProfileType)

  const nav = useNavigate()
  const pushToast = useStore((st) => st.pushToast)
  const [q, setQ] = useQueryState('q', '')
  const [domain, setDomain] = useQueryState<Domain | 'All'>('domain', 'All')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [ptype, setPtype] = useQueryState('type', 'All')
  const domainCats = domain === 'All' ? CATS : CATEGORIES_BY_DOMAIN[domain]
  const setDomainScoped = (next: Domain | 'All') => {
    setDomain(next)
    if (next !== 'All' && cat !== 'All' && domainOf(cat) !== next) setCat('All')
  }
  const pickDomain = (d: Domain) => setDomainScoped(domain === d ? 'All' : d)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ category: 'L2VPN' as Category, type: '', subtype: '', description: '' })
  const [view, setView] = useState<ProfileType | null>(null)
  const [edit, setEdit] = useState<ProfileType | null>(null)
  const [editForm, setEditForm] = useState({ category: 'L2VPN' as Category, type: '', subtype: '', description: '' })

  const startEdit = (p: ProfileType) => {
    setEditForm({ category: p.category, type: p.type, subtype: p.subtype, description: p.description })
    setEdit(p)
  }

  const filtered = useMemo(() => profileTypes.filter((p) => {
    if (domain !== 'All' && domainOf(p.category) !== domain) return false
    if (cat !== 'All' && p.category !== cat) return false
    if (ptype !== 'All' && p.type !== ptype) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(p.category.toLowerCase().includes(t) || p.type.toLowerCase().includes(t) || p.subtype.toLowerCase().includes(t))) return false
    }
    return true
  }), [profileTypes, domain, cat, ptype, q])

  const usage = useMemo(() => {
    const m = new Map<string, number>()
    workflows.forEach((w) => {
      const k = `${w.category}|${w.type}|${w.subtype}`
      m.set(k, (m.get(k) ?? 0) + 1)
    })
    return m
  }, [workflows])

  const types = useMemo(() => new Set(profileTypes.map((p) => `${p.category}|${p.type}`)).size, [profileTypes])
  const unused = useMemo(
    () => profileTypes.filter((p) => !(usage.get(`${p.category}|${p.type}|${p.subtype}`) ?? 0)).length,
    [profileTypes, usage],
  )

  const columns: Column<ProfileType>[] = [
    { key: 'sub', header: 'Subtype', width: '150px', sortValue: (r) => r.subtype, render: (r) => <CellMain>{r.subtype}</CellMain> },
    { key: 'type', header: 'Type', width: '170px', sortValue: (r) => r.type, render: (r) => r.type },
    { key: 'cat', header: 'Category', width: '120px', sortValue: (r) => r.category, render: (r) => <Badge tone={CATEGORY_TONE[r.category]}>{r.category}</Badge> },
    { key: 'desc', header: 'Description', render: (r) => <span className="block truncate max-w-[560px]" title={r.description}>{r.description}</span> },
    { key: 'creator', header: 'Creator', width: '110px', sortValue: (r) => r.creator, render: (r) => r.creator },
    {
      key: 'used', header: 'Workflows', align: 'right', width: '100px',
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
          { label: 'Edit', icon: Pencil, onClick: () => startEdit(r) },
        ]} />
      ),
    },
  ]

  return (
    <>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Profile types" icon={Layers} value={profileTypes.length} note="Category → Type → Subtype combinations"
          info="The master hierarchy of service profiles. Each row is one Category → Type → Subtype combination that workflows are scoped to and provisioning requests select from."
          drillLabel="every profile type" onClick={() => { setCat('All'); }} />
        <Stat label="Categories" icon={FolderTree} value={CATS.length} note="Across Transport and Access domains"
          info="The top level of the hierarchy — the broad service families the platform provisions. Every profile type belongs to exactly one category, and every category belongs to exactly one domain."
          drillLabel="L2VPN profile types" onClick={() => setCat('L2VPN')} />
        <Stat label="Distinct types" icon={Shapes} value={types} note="Functional classifications across all categories"
          info="The middle level of the hierarchy — functional classifications such as Hub & Spoke or Point-to-point. One type can carry several subtypes."
          drillLabel="the workflows that consume these types" onClick={() => nav('/workflows')} />
        <Stat label="Unused" icon={CircleAlert} value={unused} tone={unused > 0 ? 'warn' : 'good'}
          note={unused > 0 ? 'No workflow references these yet' : 'Every profile is referenced by a workflow'}
          info="Profile types no workflow references yet. An order that selects one of these cannot be fulfilled until a workflow is mapped to it — either build the workflow or retire the profile."
          drillLabel="the workflow coverage matrix" onClick={() => nav('/workflows')} />
      </div>

      <Card>
        <CardHead title="How the hierarchy is used" sub="Profile Type is admin configuration; workflows and provisioning consume it"
          info="Profile types are created once by an admin and then consumed twice: a workflow is scoped to one hierarchy (plus vendor and model), and a provisioning request picks a category and type to be offered the matching workflows. Each step card below ends with a worked example." />
        <CardBody>
          <div className="flex flex-col gap-3 md:grid md:grid-cols-[1fr_28px_1fr_28px_1fr] md:items-stretch md:gap-0">
            {[
              { n: '1', title: 'Create the hierarchy', desc: 'Category → Type → Subtype, as an admin action.', ex: ['L3VPN', 'Fully-Mesh', 'BGP'] },
              { n: '2', title: 'Create the workflow', desc: 'The hierarchy scopes the workflow along with vendor and model.', ex: ['IBW', 'VRF', 'Static'] },
              { n: '3', title: 'Provision a service', desc: 'The request picks a category and type; matching workflows are offered.', ex: ['L2VPN', 'Railwire', 'Tagged'] },
            ].map((step, i) => (
              <div key={step.n} className="contents">
                {i > 0 && (
                  <div className="hidden md:grid place-items-center" aria-hidden>
                    <ChevronRight size={18} className="text-ink-3" />
                  </div>
                )}
                <div className="flex flex-col border border-line rounded-lg px-4 py-4">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-brand-500 text-white grid place-items-center text-[12px] font-semibold shrink-0">{step.n}</span>
                    <span className="text-[13px] font-semibold text-ink-1">{step.title}</span>
                  </div>
                  <p className="text-[12px] text-ink-3 mt-2 mb-0 leading-snug flex-1">{step.desc}</p>
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[12px] font-mono mt-3 pt-3 border-t border-line-soft">
                    <Badge tone={CATEGORY_TONE[step.ex[0]]}>{step.ex[0]}</Badge><span className="text-ink-3">→</span>
                    <span>{step.ex[1]}</span><span className="text-ink-3">→</span><span className="font-semibold">{step.ex[2]}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Note className="mt-4">
            Keep Type and Subtype naming consistent, and reuse an existing profile before creating another —
            a token that appears at two levels of the hierarchy makes workflow mapping ambiguous.
          </Note>
        </CardBody>
      </Card>

      <DataTable
        rows={filtered} total={profileTypes.length} columns={columns} pageSize={12} minWidth={900}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Category, Type, Subtype' },
          chips: [
            ...DOMAINS.map((d) => <Chip key={d} tone={DOMAIN_TONE[d]} active={domain === d} onClick={() => pickDomain(d)}>{d}</Chip>),
            ...domainCats.map((c) => (
              <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>
            )),
          ],
          filters: [
            { key: 'domain', label: 'Domain', value: domain, onChange: (v) => setDomainScoped(v as Domain | 'All'),
              options: DOMAINS.map((d) => ({ value: d, label: d, count: profileTypes.filter((p) => domainOf(p.category) === d).length })) },
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: domainCats.map((c) => ({ value: c, label: c, count: profileTypes.filter((p) => p.category === c).length })) },
            { key: 'type', label: 'Type', value: ptype, onChange: setPtype,
              options: [...new Set(profileTypes.map((p) => p.type))].sort().map((t) => ({ value: t, label: t, count: profileTypes.filter((p) => p.type === t).length })) },
            { key: 'q', label: 'Category / Type / Subtype', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: () => { setDomain('All'); setCat('All'); setPtype('All'); setQ('') },
          onRefresh: () => pushToast('info', 'Profile types refreshed.'),
          actions: [
            { label: 'Create profile template', icon: Plus, onClick: () => setOpen(true) },
          ],
        }}
      />

      <Modal
        open={open} onClose={() => setOpen(false)}
        title="Create profile template" sub="Adds a Category → Type → Subtype row to the master hierarchy"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!form.type.trim() || !form.subtype.trim() || !form.description.trim()}
              onClick={() => {
                add(form.category, form.type.trim(), form.subtype.trim(), form.description.trim())
                setForm({ category: 'L2VPN', type: '', subtype: '', description: '' })
                setOpen(false)
              }}
            >Create</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Profile category" required>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as Category })}>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Profile type" required hint="Functional classification, for example Hub & Spoke or Transparent.">
            <TextInput value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} placeholder="Hub & Spoke" />
          </Field>
          <Field label="Subtype" required hint="Specialisation used during workflow mapping, for example BGP or Tagged.">
            <TextInput value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })} placeholder="BGP" />
          </Field>
          <Field label="Description" required>
            <TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="L3VPN Hub and Spoke profile for BGP-based connectivity." />
          </Field>
          {profileTypes.some((p) => p.category === form.category && p.type === form.type.trim() && p.subtype === form.subtype.trim()) && (
            <Note tone="warn">A profile type with this exact hierarchy already exists. Reuse it rather than creating a duplicate.</Note>
          )}
        </div>
      </Modal>

      {/* -------- view details -------- */}
      <Drawer
        open={!!view} onClose={() => setView(null)}
        title={view ? `${view.category} · ${view.type} · ${view.subtype}` : ''}
        sub={view?.id}
        width={520}
        footer={view && (
          <Button variant="primary" onClick={() => { startEdit(view); setView(null) }}>
            <Pencil size={15} />Edit
          </Button>
        )}
      >
        {view && (
          <div className="flex flex-col gap-5">
            <KV items={[
              ['Category', <Badge key="c" tone={CATEGORY_TONE[view.category]}>{view.category}</Badge>],
              ['Type', view.type],
              ['Subtype', view.subtype],
              ['Description', view.description],
              ['Creator', view.creator],
              ['Created', shortDate(view.createdAt)],
              ['Workflows using this', usage.get(`${view.category}|${view.type}|${view.subtype}`) ?? 0],
            ]} />
          </div>
        )}
      </Drawer>

      {/* -------- edit -------- */}
      <Modal
        open={!!edit} onClose={() => setEdit(null)}
        title="Edit profile template" sub={edit?.id}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!editForm.type.trim() || !editForm.subtype.trim() || !editForm.description.trim()}
              onClick={() => {
                if (edit) {
                  update(edit.id, {
                    category: editForm.category,
                    type: editForm.type.trim(),
                    subtype: editForm.subtype.trim(),
                    description: editForm.description.trim(),
                  })
                }
                setEdit(null)
              }}
            >Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Profile category" required>
            <Select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value as Category })}>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Profile type" required hint="Functional classification, for example Hub & Spoke or Transparent.">
            <TextInput value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} placeholder="Hub & Spoke" />
          </Field>
          <Field label="Subtype" required hint="Specialisation used during workflow mapping, for example BGP or Tagged.">
            <TextInput value={editForm.subtype} onChange={(e) => setEditForm({ ...editForm, subtype: e.target.value })} placeholder="BGP" />
          </Field>
          <Field label="Description" required>
            <TextInput value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="L3VPN Hub and Spoke profile for BGP-based connectivity." />
          </Field>
          {edit && (usage.get(`${edit.category}|${edit.type}|${edit.subtype}`) ?? 0) > 0 && (
            <Note tone="warn">
              {usage.get(`${edit.category}|${edit.type}|${edit.subtype}`)} workflow(s) are mapped to this exact hierarchy — changing Category, Type or Subtype breaks that mapping.
            </Note>
          )}
        </div>
      </Modal>
    </>
  )
}
