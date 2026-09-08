import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useQueryState } from '@/lib/useQueryState'
import { useStore } from '@/store/useStore'
import type { Category, ProfileType } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellMain, Chip, DataTable,
  Field, Modal, Note, Select, Stat, TextInput, type Column,
} from '@/components/ui'
import { CATEGORY_TONE } from '@/lib/format'

const CATS: Category[] = ['L2VPN', 'L3VPN', 'IBW']

export default function ProfileTypes() {
  const profileTypes = useStore((s) => s.profileTypes)
  const workflows = useStore((s) => s.workflows)
  const add = useStore((s) => s.addProfileType)

  const nav = useNavigate()
  const pushToast = useStore((st) => st.pushToast)
  const [q, setQ] = useQueryState('q', '')
  const [cat, setCat] = useQueryState<Category | 'All'>('cat', 'All')
  const [ptype, setPtype] = useQueryState('type', 'All')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ category: 'L2VPN' as Category, type: '', subtype: '', description: '' })

  const filtered = useMemo(() => profileTypes.filter((p) => {
    if (cat !== 'All' && p.category !== cat) return false
    if (ptype !== 'All' && p.type !== ptype) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(p.category.toLowerCase().includes(t) || p.type.toLowerCase().includes(t) || p.subtype.toLowerCase().includes(t))) return false
    }
    return true
  }), [profileTypes, cat, ptype, q])

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
  ]

  return (
    <>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Profile types" value={profileTypes.length} note="Category → Type → Subtype combinations"
          drillLabel="every profile type" onClick={() => { setCat('All'); }} />
        <Stat label="Categories" value={CATS.length} note="L2VPN · L3VPN · IBW"
          drillLabel="L2VPN profile types" onClick={() => setCat('L2VPN')} />
        <Stat label="Distinct types" value={types} note="Functional classifications across all categories"
          drillLabel="the workflows that consume these types" onClick={() => nav('/workflows')} />
        <Stat label="Unused" value={unused} tone={unused > 0 ? 'warn' : undefined}
          note="No workflow references these yet"
          drillLabel="the workflow coverage matrix" onClick={() => nav('/workflows')} />
      </div>

      <Card>
        <CardHead title="How the hierarchy is used" sub="Profile Type is admin configuration; workflows and provisioning consume it" />
        <CardBody>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ['Step 1', 'Create the hierarchy', 'Category → Type → Subtype, as an admin action.'],
              ['Step 2', 'Create the workflow', 'The hierarchy scopes the workflow along with vendor and model.'],
              ['Step 3', 'Provision a service', 'The request picks a category and type; matching workflows are offered.'],
            ].map(([s, t, d]) => (
              <div key={s} className="border border-line rounded-lg px-4 py-3.5">
                <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3">{s}</div>
                <div className="text-[13px] font-medium mt-1">{t}</div>
                <div className="text-[12px] text-ink-3 mt-1 leading-snug">{d}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[['L3VPN', 'Fully-Mesh', 'BGP'], ['IBW', 'VRF', 'Static'], ['L2VPN', 'Railwire', 'Tagged']].map(([c, t, s]) => (
              <div key={c + t} className="flex items-center gap-2 text-[12.5px] font-mono border border-line rounded-lg px-3.5 py-2.5">
                <Badge tone={CATEGORY_TONE[c]}>{c}</Badge><span className="text-ink-3">→</span>
                <span>{t}</span><span className="text-ink-3">→</span><span className="font-semibold">{s}</span>
              </div>
            ))}
          </div>
          <Note>
            Keep Type and Subtype naming consistent, and reuse an existing profile before creating another —
            a token that appears at two levels of the hierarchy makes workflow mapping ambiguous.
          </Note>
        </CardBody>
      </Card>

      <DataTable
        rows={filtered} total={profileTypes.length} columns={columns} pageSize={12} minWidth={900}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Category, Type, Subtype' },
          chips: CATS.map((c) => (
            <Chip key={c} tone={CATEGORY_TONE[c]} active={cat === c} count={profileTypes.filter((p) => p.category === c).length} onClick={() => setCat(cat === c ? 'All' : c)}>{c}</Chip>
          )),
          filters: [
            { key: 'cat', label: 'Category', value: cat, onChange: (v) => setCat(v as Category | 'All'),
              options: CATS.map((c) => ({ value: c, label: c, count: profileTypes.filter((p) => p.category === c).length })) },
            { key: 'type', label: 'Type', value: ptype, onChange: setPtype,
              options: [...new Set(profileTypes.map((p) => p.type))].sort().map((t) => ({ value: t, label: t, count: profileTypes.filter((p) => p.type === t).length })) },
            { key: 'q', label: 'Category / Type / Subtype', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: () => { setCat('All'); setPtype('All'); setQ('') },
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
    </>
  )
}
