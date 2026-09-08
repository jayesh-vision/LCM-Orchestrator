import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useClearQuery, useQueryPatch, useQueryState } from '@/lib/useQueryState'
import { useStore } from '@/store/useStore'
import type { PoolKind, ResourcePool } from '@/types'
import {
  Badge, Button, Card, CardBody, CardHead, CellMain, CellSub, Chip, DataTable,
  Drawer, FilterBanner, Mono, Note, Stat, type Column,
} from '@/components/ui'
import { BarList, PoolGauge } from '@/components/charts'

const KINDS: PoolKind[] = ['VLAN', 'Pseudowire ID', 'RD/RT', 'IP block', 'ASN slot']

export default function ResourcePools() {
  const pools = useStore((s) => s.pools)
  const pushToast = useStore((s) => s.pushToast)
  const [kind, setKind] = useQueryState<PoolKind | 'All'>('kind', 'All')
  const [q, setQ] = useQueryState('q', '')
  const [open, setOpen] = useState<ResourcePool | null>(null)
  /* A pool can be opened straight from another screen: /pools?pool=POOL-VLAN-01 */
  const [poolId, setPoolId] = useQueryState('pool', '')
  const patch = useQueryPatch()
  const clear = useClearQuery(['kind', 'q', 'pool'])
  useEffect(() => {
    if (!poolId) { setOpen(null); return }
    setOpen(pools.find((p) => p.id === poolId) ?? null)
  }, [poolId, pools])
  const closeDrawer = () => { setPoolId('') }
  const openPool = (p: ResourcePool) => setPoolId(p.id)

  const filtered = useMemo(() => pools.filter((p) => {
    if (kind !== 'All' && p.kind !== kind) return false
    if (q && !(p.scope.toLowerCase().includes(q.toLowerCase()) || p.id.toLowerCase().includes(q.toLowerCase()))) return false
    return true
  }), [pools, kind, q])

  const totals = useMemo(() => pools.reduce((a, p) => ({
    total: a.total + p.total,
    allocated: a.allocated + p.allocated,
    quarantined: a.quarantined + p.quarantined,
    reserved: a.reserved + p.reserved,
  }), { total: 0, allocated: 0, quarantined: 0, reserved: 0 }), [pools])

  const freePct = (p: ResourcePool) => ((p.total - p.allocated - p.quarantined - p.reserved) / p.total) * 100
  const critical = pools.filter((p) => freePct(p) < 10)

  const columns: Column<ResourcePool>[] = [
    {
      key: 'pool', header: 'Pool', width: '210px', sortValue: (r) => r.id,
      render: (r) => (<><CellMain>{r.kind}</CellMain><CellSub><Mono>{r.id}</Mono></CellSub></>),
    },
    { key: 'scope', header: 'Scope', width: '260px', sortValue: (r) => r.scope, render: (r) => <span className="text-ink-2">{r.scope}</span> },
    {
      key: 'util', header: 'Utilisation', width: '300px', sortValue: (r) => -freePct(r),
      render: (r) => <PoolGauge allocated={r.allocated} quarantined={r.quarantined} reserved={r.reserved} total={r.total} />,
    },
    {
      key: 'free', header: 'Free', align: 'right', width: '110px', sortValue: (r) => freePct(r),
      render: (r) => {
        const f = freePct(r)
        return <span className={f < 10 ? 'text-crit-500 font-semibold' : f < 25 ? 'text-warn-700 font-semibold' : ''}>{f.toFixed(0)}%</span>
      },
    },
    {
      key: 'act', header: '', width: '106px',
      render: (r) => <Button size="sm" onClick={() => openPool(r)}>Browse</Button>,
    },
  ]

  return (
    <>

      <FilterBanner
        count={filtered.length} noun="pools" onClear={clear}
        filters={[
          ...(kind !== 'All' ? [{ key: 'kind', label: 'Kind', value: kind, onRemove: () => patch({ kind: null }) }] : []),
          ...(q ? [{ key: 'q', label: 'Search', value: q, onRemove: () => setQ('') }] : []),
        ]}
      />

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        <Stat label="Pools" value={pools.length} note={`${totals.total.toLocaleString()} addressable values`}
          drillLabel="every pool, unfiltered" onClick={clear} />
        <Stat label="Allocated" value={totals.allocated.toLocaleString()}
          note={`${((totals.allocated / totals.total) * 100).toFixed(0)}% of the estate`}
          drillLabel="the pool with the least headroom"
          onClick={() => { const t = [...pools].sort((a, b) => freePct(a) - freePct(b))[0]; if (t) openPool(t) }} />
        <Stat label="Quarantined" value={totals.quarantined} tone="warn"
          note="Released on cease, held 30 days before reissue"
          drillLabel="the pool holding the most quarantined values"
          onClick={() => { const t = [...pools].sort((a, b) => b.quarantined - a.quarantined)[0]; if (t) openPool(t) }} />
        <Stat label="Pools under 10% free" value={critical.length} tone={critical.length ? 'crit' : undefined}
          note={critical.length ? critical.map((p) => p.kind).join(', ') : 'All pools have headroom'}
          drillLabel={critical.length ? 'the tightest pool' : 'all pools'}
          onClick={() => { const t = critical.slice().sort((a, b) => freePct(a) - freePct(b))[0]; if (t) openPool(t); else clear() }} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHead title="Headroom by pool" sub="Sorted by how close each pool is to exhaustion" />
          <CardBody>
            <BarList
              labelWidth={190}
              max={100}
              items={[...pools]
                .sort((a, b) => freePct(a) - freePct(b))
                .slice(0, 8)
                .map((p) => ({
                  label: p.kind,
                  sub: p.scope.length > 30 ? `${p.scope.slice(0, 30)}…` : p.scope,
                  value: Math.round(freePct(p)),
                  tone: freePct(p) < 10 ? ('crit' as const) : freePct(p) < 25 ? ('warn' as const) : ('good' as const),
                  drillLabel: `${p.kind} pool for ${p.scope}. Browse it`,
                  onClick: () => openPool(p),
                }))}
            />
            <Note>Values shown are percentage free. A pool below 10% free will block new orders for that intent before anything else fails.</Note>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Why quarantine" sub="Not every released value can be reissued immediately" />
          <CardBody className="flex flex-col gap-3.5">
            {[
              ['Route targets', 'Reissuing an RT that a peer still advertises leaks one customer\'s routes into another customer\'s VRF.', '30 days'],
              ['IP blocks', 'A CE that has not been decommissioned may still be sending traffic to the old gateway.', '30 days'],
              ['VLANs', 'Port-scoped and safe to reuse as soon as the sub-interface is confirmed absent.', 'immediate'],
              ['Pseudowire IDs', 'Global, but only meaningful with a matching remote PE. Safe once absence is asserted at both ends.', 'immediate'],
            ].map(([k, why, hold]) => (
              <div key={k} className="border border-line rounded-lg px-3.5 py-3">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-[13px] font-medium">{k}</span>
                  <Badge tone={hold === 'immediate' ? 'good' : 'warn'}>{hold}</Badge>
                </div>
                <div className="text-[12px] text-ink-3 leading-snug">{why}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <DataTable
        rows={filtered} total={pools.length} columns={columns} pageSize={10} minWidth={1020}
        onRowClick={(r) => openPool(r)}
        toolbar={{
          search: { value: q, onChange: setQ, placeholder: 'Pool, Scope' },
          chips: KINDS.filter((k) => pools.some((p) => p.kind === k)).map((k) => (
            <Chip key={k} active={kind === k} count={pools.filter((p) => p.kind === k).length} onClick={() => setKind(kind === k ? 'All' : k)}>{k}</Chip>
          )),
          filters: [
            { key: 'kind', label: 'Kind', value: kind, onChange: (v) => setKind(v as PoolKind | 'All'),
              options: KINDS.filter((k) => pools.some((p) => p.kind === k)).map((k) => ({ value: k, label: k, count: pools.filter((p) => p.kind === k).length })) },
            { key: 'q', label: 'Pool / Scope', type: 'text', value: q, onChange: setQ },
          ],
          onResetFilters: clear,
          onRefresh: () => pushToast('info', 'Pool utilisation refreshed.'),
          actions: [{ label: 'Run pool audit', icon: ShieldCheck, onClick: () => pushToast('info', 'Pool audit queued. Results appear in Reports.') }],
        }}
      />

      <Drawer
        open={!!open} onClose={closeDrawer}
        title={open ? `${open.kind} pool` : ''}
        sub={open?.scope}
        width={620}
      >
        {open && (
          <div className="flex flex-col gap-5">
            <PoolGauge allocated={open.allocated} quarantined={open.quarantined} reserved={open.reserved} total={open.total} />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.09em] text-ink-3 mb-2.5">Entries</div>
              <div className="border border-line rounded-lg overflow-hidden max-h-[520px] overflow-y-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-plane">
                    <tr>
                      {['Value', 'State', 'Held by'].map((h) => (
                        <th key={h} scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold border-b border-line">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {open.entries.slice(0, 120).map((e) => (
                      <tr key={e.value} className="border-b border-line-soft last:border-0">
                        <td className="px-3.5 py-2 font-mono">{e.value}</td>
                        <td className="px-3.5 py-2">
                          <Badge tone={e.state === 'Allocated' ? 'info' : e.state === 'Quarantined' ? 'warn' : e.state === 'Reserved' ? 'plum' : 'good'}>{e.state}</Badge>
                        </td>
                        <td className="px-3.5 py-2 font-mono text-ink-3">{e.serviceId ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[11.5px] text-ink-3 mt-2">Showing the first 120 of {open.total.toLocaleString()} values.</div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  )
}
