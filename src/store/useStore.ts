import { create } from 'zustand'
import type {
  IntentParam, Notification, Order, OrderIntent, OrderParamValue, OrderState,
  ProfileType, ReportDef, ResourcePool, Run, RunTask, Service, ServiceIntent, Workflow,
} from '@/types'
import { INTENTS, PROFILE_TYPES, pad } from '@/data/catalog'
import { buildWorkflows } from '@/data/workflows'
import { buildServices, serviceFromOrder } from '@/data/services'
import { bindEndpoints, buildHistoricalOrders, buildOrders, buildRuns, claimFor, hasRetainedLog, linkProvenance, orderedTasks, WAITING } from '@/data/orders'
import { renderCommand, workflowParams } from '@/data/templates'
import { allocateForService, buildNotifications, buildPools, buildReports, releaseForService } from '@/data/misc'

/** Migration: guarantee every workflow maps to a real, currently Active
 *  Service Intent — `buildWorkflows()`'s intentId assignment already covers
 *  every category and every legacy intent migrates to Active (see
 *  `catalog.ts`), so this is a no-op against today's seed. It exists as a
 *  permanent safety net rather than an assumption: if a workflow's intentId
 *  is missing, dangling, or (the real, ongoing case) points at a version
 *  that's since been retired in favour of a newer one in the same family,
 *  it's remapped to that family's current Active version here — the same
 *  repair `setIntentState` performs live when an activation retires a
 *  sibling, just also run once up front so nothing already-broken slips
 *  through. `explicitParams` is pruned to whatever the replacement's own
 *  parameter catalog actually contains, so a manually-added parameter that
 *  only existed on the old version doesn't linger as orphaned data. */
function reconcileWorkflowIntents(allWorkflows: Workflow[], allIntents: ServiceIntent[]): Workflow[] {
  let fixed = 0
  const result = allWorkflows.map((w) => {
    const current = allIntents.find((i) => i.id === w.intentId)
    if (current?.state === 'Active') return w
    const replacement = (current && allIntents.find((i) => i.familyId === current.familyId && i.state === 'Active'))
      ?? allIntents.find((i) => i.state === 'Active' && i.category === w.category && i.type === w.type)
      ?? allIntents.find((i) => i.state === 'Active' && i.category === w.category)
    if (!replacement || replacement.id === w.intentId) return w
    fixed += 1
    const validNames = new Set(replacement.params.map((p) => p.name))
    return { ...w, intentId: replacement.id, explicitParams: (w.explicitParams ?? []).filter((n) => validNames.has(n)) }
  })
  if (fixed > 0) console.info(`[migration] Remapped ${fixed} workflow(s) to a valid Active Service Intent.`)
  return result
}

/** Migration: run *after* `reconcileWorkflowIntents`, so every workflow here
 *  is already pointing at a real, Active Service Intent — but that intent's
 *  formal parameter catalog may still be missing names the workflow's own
 *  commands actually reference (the Workflow Builder's "· not in catalog"
 *  tag). This registers those: for every Active intent with at least one
 *  workflow using an uncatalogued parameter, one new version is published
 *  carrying every such parameter its family's workflows need, all at once —
 *  not one interactive fork per parameter, which would leave a pile of
 *  Draft versions needing individual review for what is really a single
 *  bulk data-correction pass. Published straight to Active, because this is
 *  a system backfill of parameters already safely in production use, not a
 *  human edit awaiting review — and every workflow pointing at the version
 *  being replaced follows forward to the new one, same as a live activation. */
function backfillIntentParamsFromLegacyWorkflows(
  allIntents: ServiceIntent[], allWorkflows: Workflow[],
): { intents: ServiceIntent[]; workflows: Workflow[] } {
  let intents = allIntents
  let workflows = allWorkflows
  let intentsBackfilled = 0
  let paramsRegistered = 0

  const byIntentId = new Map<string, Workflow[]>()
  allWorkflows.forEach((w) => byIntentId.set(w.intentId, [...(byIntentId.get(w.intentId) ?? []), w]))

  byIntentId.forEach((wfs, intentId) => {
    const current = intents.find((i) => i.id === intentId)
    if (!current) return
    const existingNames = new Set(current.params.map((p) => p.name))
    const missing = new Set<string>()
    wfs.forEach((w) => workflowParams(w.tasks).forEach((name) => { if (!existingNames.has(name)) missing.add(name) }))
    if (missing.size === 0) return

    const backfilled: IntentParam[] = [...missing].sort().map((name) => ({
      name, type: 'string', required: true, modifiable: 'hitless',
      constraint: 'Backfilled from legacy workflow commands during migration — review and refine.',
    }))
    intentsBackfilled += 1
    paramsRegistered += backfilled.length

    if (current.state === 'Draft') {
      intents = intents.map((i) => (i.id === intentId ? { ...i, params: [...i.params, ...backfilled] } : i))
      return
    }

    const nextVersion = Math.max(...intents.filter((i) => i.familyId === current.familyId).map((i) => i.version)) + 1
    const newId = `${current.familyId}-v${nextVersion}`
    intents = intents
      .map((i) => (i.familyId === current.familyId && i.state === 'Active' ? { ...i, state: 'Retired' as const } : i))
      .concat([{ ...current, id: newId, version: nextVersion, state: 'Active', params: [...current.params, ...backfilled] }])
    workflows = workflows.map((w) => (w.intentId === intentId ? { ...w, intentId: newId } : w))
  })

  if (intentsBackfilled > 0) {
    console.info(`[migration] Registered ${paramsRegistered} parameter(s) across ${intentsBackfilled} Service Intent(s) from legacy workflow usage.`)
  }
  return { intents, workflows }
}

/* Seed once, at module load, so the dataset is stable across navigation. */
const { intents: seedIntents, workflows } = backfillIntentParamsFromLegacyWorkflows(INTENTS, reconcileWorkflowIntents(buildWorkflows(), INTENTS))
const services = buildServices()
const liveOrders = buildOrders(services, workflows)
const historicalOrders = buildHistoricalOrders(services, workflows)
/* Archived work executed too — it is what put the estate on the devices. What
   decides whether its runs are still here is age, not archival: anything that
   completed inside the log retention window keeps its task-by-task record, and
   older work keeps the request while the transcript behind it has aged out.
   Built in one pass so run ids stay unique across both sets. */
const runs = buildRuns([...liveOrders, ...historicalOrders.filter((o) => hasRetainedLog(o))], workflows)

/* A request that executed was last touched when its last run finished. Runs are
   built after the orders that own them, so the order carries a placeholder
   stamp until here — left alone, a request showed as "closed" days after the
   work it closed on, which the service lifecycle puts side by side. Archived
   orders keep their own stamp: their create closes when the service goes live,
   which is after the run that put it there, not at the same instant. */
liveOrders.forEach((o) => {
  const own = runs.filter((r) => r.orderId === o.id)
  if (own.length === 0) return
  const last = Math.max(...own.map((r) => Date.parse(r.endedAt ?? r.startedAt)))
  o.updatedAt = new Date(last).toISOString()
})
/* The queue plus the archive. Both are orders and both are the same shape;
   only `archived` separates work in flight from the record of work done. */
const orders = [...liveOrders, ...historicalOrders]
linkProvenance(services, orders)
const pools = buildPools(services)
const reports = buildReports(orders, runs, services, pools)

export interface WizardDraft {
  category: string
  type: string
  subtype: string
  accountId: string
  accountName: string
  name: string
  intentId: string
  workflowId: string
  /**
   * `workflowId` overrides the vendor-matched template bindEndpoints would
   * otherwise pick, and `params` overrides the values it would render — both
   * come from the wizard, where the operator picks a template per endpoint and
   * fills in that template's own parameters. Two endpoints running different
   * templates have different parameter sets and different values, so neither
   * can be derived from a single service-wide list.
   */
  endpoints: {
    role: 'A' | 'Z' | 'hub' | 'spoke'; siteCode: string; deviceName: string
    vendor: string; mgmtIp: string; port: string
    workflowId?: string; params?: OrderParamValue[]
  }[]
  params: OrderParamValue[]
}

interface Toast { id: number; tone: 'good' | 'warn' | 'crit' | 'info'; text: string }

interface State {
  orders: Order[]
  services: Service[]
  workflows: Workflow[]
  runs: Run[]
  pools: ResourcePool[]
  profileTypes: typeof PROFILE_TYPES
  intents: typeof INTENTS
  reports: ReportDef[]
  notifications: Notification[]
  toasts: Toast[]
  activeRunId: string | null

  /* selectors */
  orderById: (id: string) => Order | undefined
  serviceById: (id: string) => Service | undefined
  workflowById: (id: string) => Workflow | undefined
  runsForOrder: (orderId: string) => Run[]

  /* actions */
  pushToast: (tone: Toast['tone'], text: string) => void
  dismissToast: (id: number) => void
  markNotificationRead: (id: string) => void
  markAllNotificationsRead: () => void

  createOrder: (draft: WizardDraft) => Order
  /** Draft-only: rename the request or move it to another account before it's ever submitted. */
  updateOrderDraft: (id: string, patch: { name?: string; accountId?: string; accountName?: string }) => void
  /** Draft-only: change one parameter's rendered value on one endpoint. */
  updateOrderEndpointParam: (orderId: string, endpointId: string, paramName: string, value: string) => void
  /** Draft → Planned → Validated/Invalid, the same automatic cycle a freshly
   *  created request runs — triggered by hand for a request that sat in
   *  Draft rather than firing the moment it was created. */
  submitDraftForValidation: (id: string) => void
  setOrderState: (id: string, state: OrderState, note?: string) => void
  approveOrder: (id: string, by: string) => void
  rejectOrder: (id: string, by: string, comment: string) => void
  startRun: (orderId: string) => string | undefined
  abortRun: (runId: string) => void
  retryOrder: (orderId: string) => void

  raiseChange: (serviceId: string, intent: OrderIntent, delta?: Order['delta'], params?: OrderParamValue[], notes?: string) => Order
  reproveService: (serviceId: string) => void

  addProfileType: (category: string, type: string, subtype: string, description: string) => void
  updateProfileType: (id: string, patch: Partial<Pick<ProfileType, 'category' | 'type' | 'subtype' | 'description'>>) => void
  setWorkflowState: (id: string, state: Workflow['state']) => void
  /** Create or replace a workflow from the builder. Returns the stored id. */
  saveWorkflow: (wf: Workflow, note?: string) => string

  /** Create a Service Intent bound to a Profile Type row. Returns the new intent id. */
  addIntent: (input: { profileTypeId: string; name: string; topology: ServiceIntent['topology']; endpointArity: string }) => string
  /* No `updateIntent` — a Service Intent's basic metadata (name, topology,
     endpoint arity, profile type, category, type) is fixed forever once
     created. The parameter catalog is the only thing that can change, and
     changing it either edits a Draft in place or forks a new Draft version —
     never overwrites a published row. Each of these four returns the id of
     the row the change actually landed on (itself, or a newly forked one),
     so the UI can follow the edit to wherever it went. */
  addIntentParam: (intentId: string, param: IntentParam) => string
  updateIntentParam: (intentId: string, name: string, patch: Partial<IntentParam>) => string
  removeIntentParam: (intentId: string, name: string) => string
  reorderIntentParam: (intentId: string, name: string, direction: -1 | 1) => string
  /** Only a never-activated Draft can be deleted. */
  deleteIntent: (id: string) => void
  setIntentState: (id: string, state: ServiceIntent['state']) => void
}

let toastSeq = 0
let runTimer: ReturnType<typeof setInterval> | null = null
let svcSeq = 0

/**
 * Land a successfully executed order on the estate.
 *
 * This is the arrow that closes the lifecycle: until a request reaches here it
 * is only a statement of intent, and Service Inventory has no idea it happened.
 * Create brings a service into existence with the resources it drew and the
 * run's criteria as its first proof; every other intent moves a service that
 * already exists, which is why they carry a serviceId and Create does not.
 */
function applyToInventory(services: Service[], pools: ResourcePool[], order: Order):
{ services: Service[]; pools: ResourcePool[]; serviceId?: string } | null {
  const stamp = (sv: Service, change: string): Service => ({
    ...sv,
    history: [{ at: new Date().toISOString(), orderId: order.id, change, by: order.owner ?? 'Orchestrator', outOfBand: false }, ...sv.history],
  })

  if (order.intent === 'Create') {
    if (order.serviceId) return null                       // already landed
    svcSeq += 1
    const id = `SVC-${order.category === 'IBW' ? 'IBW' : order.category === 'L2VPN' ? 'L2' : order.category === 'L3VPN' ? 'L3' : 'NS'}-${900000 + svcSeq}`
    const { pools: nextPools, held } = allocateForService(pools, order.intentId, id, order.endpoints.length, svcSeq)
    const svc = { ...serviceFromOrder(order, held, svcSeq), id }
    return { services: [svc, ...services], pools: nextPools, serviceId: id }
  }

  const target = services.find((sv) => sv.id === order.serviceId)
  if (!target) return null

  if (order.intent === 'Cease') {
    return {
      services: services.map((sv) => (sv.id !== target.id ? sv : stamp({
        ...sv,
        state: 'Ceased', operState: 'Down', conformance: 'Not checked',
        resources: sv.resources.map((r) => ({ ...r, state: 'Quarantined' as const })),
      }, 'Ceased · resources returned to quarantine'))),
      pools: releaseForService(pools, target.id),
    }
  }

  if (order.intent === 'Suspend' || order.intent === 'Resume') {
    const resumed = order.intent === 'Resume'
    return {
      services: services.map((sv) => (sv.id !== target.id ? sv : stamp({
        ...sv,
        state: resumed ? 'Live' : 'Suspended',
        operState: resumed ? 'Up' : 'Down',
      }, resumed ? 'Resumed · service returned to Live' : 'Suspended · configuration left in place'))),
      pools,
    }
  }

  if (order.intent === 'Modify' || order.intent === 'Re-prove') {
    const bw = Number(order.params.find((p) => p.name === 'bandwidth_mbps')?.value ?? target.bandwidthMbps)
    const proved = new Date().toISOString()
    return {
      services: services.map((sv) => (sv.id !== target.id ? sv : stamp({
        ...sv,
        /* Either way the service has just been re-verified end to end, so the
           drift the platform was tracking is resolved as of now. */
        bandwidthMbps: order.intent === 'Modify' ? bw : sv.bandwidthMbps,
        conformance: 'Conformant', driftCount: 0, lastProvenAt: proved,
      }, order.intent === 'Modify' ? `Modified · bandwidth now ${bw} Mbps` : 'Re-proven · acceptance criteria re-run'))),
      pools,
    }
  }

  return null
}

/** The one rule every parameter-catalog change follows: a Draft version is
 *  still being authored, so it's edited in place; anything else (Active or
 *  Retired) is frozen, so the change instead forks a new Draft version
 *  carrying the same familyId, leaving the published row untouched. Returns
 *  the updated array plus the id of whichever row the change landed on, so
 *  callers can report back — or retarget a UI — to wherever the edit went. */
function applyParamChange(
  intents: ServiceIntent[], intentId: string, transform: (params: IntentParam[]) => IntentParam[],
): { intents: ServiceIntent[]; id: string } {
  const target = intents.find((i) => i.id === intentId)
  if (!target) return { intents, id: intentId }
  if (target.state === 'Draft') {
    return {
      intents: intents.map((i) => (i.id === intentId ? { ...i, params: transform(i.params) } : i)),
      id: intentId,
    }
  }
  const nextVersion = Math.max(...intents.filter((i) => i.familyId === target.familyId).map((i) => i.version)) + 1
  const forked: ServiceIntent = {
    ...target, id: `${target.familyId}-v${nextVersion}`, version: nextVersion, state: 'Draft',
    liveServices: 0, params: transform(target.params),
  }
  return { intents: [forked, ...intents], id: forked.id }
}

export const useStore = create<State>((set, get) => ({
  orders, services, workflows, runs, pools,
  profileTypes: PROFILE_TYPES,
  intents: seedIntents,
  reports,
  notifications: buildNotifications(),
  toasts: [],
  activeRunId: null,

  orderById: (id) => get().orders.find((o) => o.id === id),
  serviceById: (id) => get().services.find((s) => s.id === id),
  workflowById: (id) => get().workflows.find((w) => w.id === id),
  runsForOrder: (orderId) => get().runs.filter((r) => r.orderId === orderId).sort((a, b) => b.attempt - a.attempt),

  pushToast: (tone, text) => {
    toastSeq += 1
    const id = toastSeq
    set((s) => ({ toasts: [...s.toasts, { id, tone, text }] }))
    setTimeout(() => get().dismissToast(id), 4200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  markNotificationRead: (id) =>
    set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
  markAllNotificationsRead: () =>
    set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),

  createOrder: (draft) => {
    const seq = get().orders.length + 1
    const now = new Date().toISOString()
    const order: Order = {
      id: `ORD-2026-${pad(4500 + seq, 6)}`,
      code: `NS-${pad(400 + seq, 6)}`,
      /* Live store lookup, not the static `intentById` import — `draft.intentId`
         can name a version a migration or a live edit forked at runtime. */
      name: draft.name || get().intents.find((i) => i.id === draft.intentId)!.name,
      intent: 'Create',
      intentId: draft.intentId,
      category: draft.category as Order['category'],
      type: draft.type,
      subtype: draft.subtype,
      accountId: draft.accountId,
      accountName: draft.accountName,
      state: 'Draft',
      workflowId: draft.workflowId,
      endpoints: bindEndpoints(
        draft.endpoints.map((e, i) => ({
          id: `EP-N${pad(seq * 10 + i, 5)}`,
          role: e.role,
          siteCode: e.siteCode,
          deviceName: e.deviceName,
          vendor: e.vendor as Order['endpoints'][number]['vendor'],
          mgmtIp: e.mgmtIp,
          port: e.port,
          subInterface: `${e.port}.${draft.params.find((p) => p.name === 'vlan')?.value ?? '100'}`,
        })),
        draft.category, draft.type, draft.subtype, get().workflows, draft.params,
        Number(draft.params.find((p) => p.name === 'bandwidth_mbps')?.value ?? 100),
      /* bindEndpoints supplies the derived/pool-allocated values; anything the
         operator chose per endpoint in the wizard (its template, and that
         template's own parameter values) wins over it. */
      ).map((ep, i) => {
        const d = draft.endpoints[i]
        return {
          ...ep,
          ...(d?.workflowId ? { workflowId: d.workflowId } : {}),
          ...(d?.params?.length ? { params: d.params } : {}),
        }
      }),
      params: draft.params,
      createdAt: now,
      updatedAt: now,
      ageDays: 0,
      owner: 'Priya S.',
      waitingOn: 'NOC lead',
      runIds: [],
      approvals: [{ role: 'NOC lead' }],
      slaBreached: false,
    }
    set((s) => ({ orders: [order, ...s.orders] }))
    get().pushToast('good', `${order.id} created. Pre-validation starting.`)

    /* Draft → Planned (pre-validation running) → Validated / Invalid — a
       small simulated background check, in the same spirit as startRun's
       task timer but for the single gate that runs before a human ever
       sees the request. */
    setTimeout(() => { get().setOrderState(order.id, 'Planned') }, 900)
    setTimeout(() => {
      const ok = Math.random() > 0.12
      get().setOrderState(order.id, ok ? 'Validated' : 'Invalid')
      get().pushToast(ok ? 'good' : 'crit', ok
        ? `${order.id} pre-validated. Awaiting approval.`
        : `${order.id} failed pre-validation. Needs rework before it can be approved.`)
    }, 3200)

    return order
  },

  updateOrderDraft: (id, patch) =>
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id && o.state === 'Draft'
        ? { ...o, ...patch, updatedAt: new Date().toISOString() } : o)),
    })),

  updateOrderEndpointParam: (orderId, endpointId, paramName, value) =>
    set((s) => ({
      orders: s.orders.map((o) => (o.id === orderId && o.state === 'Draft'
        ? {
          ...o,
          endpoints: o.endpoints.map((e) => (e.id === endpointId
            ? { ...e, params: (e.params ?? []).map((p) => (p.name === paramName ? { ...p, value, source: 'user' as const } : p)) }
            : e)),
          updatedAt: new Date().toISOString(),
        }
        : o)),
    })),

  /* Mirrors the second half of createOrder's own timeline — Draft moves to
     Planned the instant someone asks for it, then resolves to Validated or
     Invalid a couple of seconds later, exactly as a freshly designed request
     does. A seeded or previously-abandoned Draft gets the same cycle a new
     one gets automatically; this is what lets someone act on it by hand. */
  submitDraftForValidation: (id) => {
    const order = get().orderById(id)
    if (!order || order.state !== 'Draft') return
    get().setOrderState(id, 'Planned')
    get().pushToast('good', `${id} submitted. Pre-validation starting.`)
    setTimeout(() => {
      const ok = Math.random() > 0.12
      get().setOrderState(id, ok ? 'Validated' : 'Invalid')
      get().pushToast(ok ? 'good' : 'crit', ok
        ? `${id} pre-validated. Awaiting approval.`
        : `${id} failed pre-validation. Needs rework before it can be approved.`)
    }, 2200)
  },

  setOrderState: (id, state, note) =>
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === id ? { ...o, state, waitingOn: WAITING[state], notes: note ?? o.notes, updatedAt: new Date().toISOString() } : o),
    })),

  approveOrder: (id, by) => {
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id
        ? {
          ...o,
          state: 'Approved' as OrderState,
          waitingOn: WAITING.Approved,
          approvals: o.approvals.map((a, i) => (i === 0
            ? { ...a, by, at: new Date().toISOString(), decision: 'Approved' as const } : a)),
        }
        : o)),
    }))
    get().pushToast('good', `${id} approved. Credentials will be validated before execution.`)
  },

  rejectOrder: (id, by, comment) => {
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id
        ? {
          ...o,
          state: 'Rejected' as OrderState,
          waitingOn: WAITING.Rejected,
          approvals: o.approvals.map((a, i) => (i === 0
            ? { ...a, by, at: new Date().toISOString(), decision: 'Rejected' as const, comment } : a)),
        }
        : o)),
    }))
    get().pushToast('warn', `${id} rejected.`)
  },

  /* Execute the workflow, one task at a time, on a timer. */
  startRun: (orderId) => {
    const order = get().orderById(orderId)
    if (!order) return undefined
    const attempt = (Math.max(0, ...get().runs.filter((r) => r.orderId === orderId).map((r) => r.attempt))) + 1
    const fallback = get().workflowById(order.workflowId ?? '') ?? get().workflows.find((w) => w.state === 'Active')
    if (!fallback) { get().pushToast('crit', 'No active workflow bound to this order.'); return undefined }

    /* One run per endpoint. Each device gets the template bound to it — the
       Source and Destination templates differ, so the task lists differ too. */
    const eps = order.endpoints.length ? order.endpoints : [undefined]
    const newRuns: Run[] = eps.map((ep, i) => {
      const wf = (ep?.workflowId && get().workflowById(ep.workflowId)) || fallback
      const values = Object.fromEntries((ep?.params ?? []).map((p) => [p.name, p.value]))
      const tasks: RunTask[] = orderedTasks(wf).map((td, k) => ({
        taskDefId: td.id,
        name: td.name,
        stage: td.stage,
        stageKind: td.stageKind,
        sequence: k + 1,
        state: 'Not started',
        direction: 'forward',
        claim: claimFor(td, values),
        command: renderCommand(td.setCommand, values),
        requestPayload: JSON.stringify({ device: ep?.mgmtIp ?? '172.31.33.20', transport: 'ssh', commands: renderCommand(td.setCommand, values).split('\n') }, null, 2),
        responsePayload: '',
        transportExit: 0,
        expected: claimFor(td, values),
      }))
      return {
        id: `RUN-N${pad(get().runs.length + 1 + i, 5)}`,
        attempt, orderId, endpointId: ep?.id, workflowId: wf.id, direction: 'forward',
        outcome: 'Running',
        startedAt: new Date().toISOString(),
        orchestratorClock: new Date().toISOString(),
        deviceClock: new Date(Date.now() - 3100).toISOString(),
        clockSkewMs: -3100,
        tasks,
      }
    })
    const runIds = newRuns.map((r) => r.id)

    set((s) => ({
      runs: [...newRuns, ...s.runs],
      activeRunId: runIds[0],
      orders: s.orders.map((o) => (o.id === orderId
        ? { ...o, state: 'Queued' as OrderState, waitingOn: WAITING.Queued, runIds: [...runIds, ...o.runIds] } : o)),
    }))
    get().pushToast('info', `Run ${attempt} queued on ${eps.length} device(s).`)

    /* Queued → In progress once the run actually starts ticking through tasks. */
    setTimeout(() => { get().setOrderState(orderId, 'In progress') }, 700)

    if (runTimer) clearInterval(runTimer)

    /* Endpoint 0 is always Source (A / hub); every run after it is a
       Destination. Pre validation runs in parallel on every endpoint, but
       Configuration/Post validation only starts on a Destination once the
       Source's own run has fully passed — mirrored from the same rule the
       seed data and buildRuns() apply. */
    const srcRunId = newRuns[0]?.id
    const cfgIdxByRun = new Map(newRuns.map((r) => {
      const i = r.tasks.findIndex((t) => t.stageKind !== 'Pre validation')
      return [r.id, i === -1 ? r.tasks.length : i]
    }))

    runTimer = setInterval(() => {
      const state = get()
      const mine = state.runs.filter((r) => runIds.includes(r.id))
      if (mine.length === 0) { if (runTimer) clearInterval(runTimer); return }

      const srcRun = mine.find((r) => r.id === srcRunId)
      const srcDone = !srcRun || srcRun.tasks.every((t) => t.state === 'Passed')

      set((s) => ({
        runs: s.runs.map((r) => {
          if (!runIds.includes(r.id)) return r
          const isSource = r.id === srcRunId
          const cfgIdx = cfgIdxByRun.get(r.id) ?? 0
          /* A Destination task at or past Configuration is gated until the
             Source finishes; Pre validation tasks are never gated. */
          const gated = (n: number) => !isSource && n >= cfgIdx && !srcDone
          const idx = r.tasks.findIndex((t) => t.state !== 'Passed')
          if (idx === -1) return r
          if (gated(idx)) {
            if (r.tasks[idx].state === 'Queued') return r
            return { ...r, tasks: r.tasks.map((t, n): RunTask => (n === idx ? { ...t, state: 'Queued' } : t)) }
          }
          const next = r.tasks.map((t, n): RunTask => {
            if (n < idx) return t
            if (n === idx) {
              return {
                ...t,
                state: 'Passed',
                startedAt: t.startedAt ?? new Date().toISOString(),
                endedAt: new Date().toISOString(),
                durationMs: 600 + Math.round(Math.random() * 1800),
                transportExit: 0,
                parsed: 'received = 5, sent = 5',
                actual: (t.expected ?? 'ok').replace(/[<>=]/g, '').trim(),
                responsePayload: JSON.stringify({ transportExit: 0, output: ['Success rate is 100 percent (5/5), round-trip min/avg/max = 2/3/5 ms'] }, null, 2),
              }
            }
            if (n === idx + 1) {
              if (gated(n)) return { ...t, state: 'Queued' }
              return { ...t, state: 'Running', startedAt: new Date().toISOString() }
            }
            return t
          })
          return { ...r, tasks: next }
        }),
      }))

      const after = get().runs.filter((r) => runIds.includes(r.id))
      if (after.every((r) => r.tasks.every((t) => t.state === 'Passed'))) {
        if (runTimer) clearInterval(runTimer)
        set((s) => {
          const order = s.orders.find((o) => o.id === orderId)
          /* Execution succeeded, so the request now has to land on the estate.
             What that means depends on what was asked for: a Create leaves a
             new service behind, and every other intent moves one that already
             exists. Without this the pipeline would end at Ready and the
             inventory would never reflect the work that was just done. */
          const effect = order ? applyToInventory(s.services, s.pools, order) : null
          return {
            runs: s.runs.map((r) => (runIds.includes(r.id)
              ? { ...r, outcome: 'Accepted' as const, endedAt: new Date().toISOString(), durationMs: Date.now() - new Date(r.startedAt).getTime() }
              : r)),
            orders: s.orders.map((o) => (o.id === orderId
              ? { ...o, state: 'Ready' as OrderState, waitingOn: undefined, serviceId: effect?.serviceId ?? o.serviceId }
              : o)),
            services: effect?.services ?? s.services,
            pools: effect?.pools ?? s.pools,
            activeRunId: null,
          }
        })
        const landed = get().orders.find((o) => o.id === orderId)
        const svc = landed?.serviceId
        get().pushToast('good', svc && landed?.intent === 'Create'
          ? `${orderId} ready. ${svc} is now live in Service Inventory.`
          : `${orderId} ready. All acceptance criteria passed on every device.`)
      }
    }, 900)

    return runIds[0]
  },

  abortRun: (runId) => {
    if (runTimer) clearInterval(runTimer)
    const run = get().runs.find((r) => r.id === runId)
    const siblings = get().runs.filter((r) => run && r.orderId === run.orderId && r.attempt === run.attempt).map((r) => r.id)
    set((s) => ({
      runs: s.runs.map((r) => (siblings.includes(r.id)
        ? {
          ...r,
          outcome: 'Rolled back',
          endedAt: new Date().toISOString(),
          tasks: r.tasks.map((t) => (t.state === 'Passed'
            ? { ...t, state: 'Passed', direction: 'rollback' as const }
            : t.state === 'Running' || t.state === 'Queued' ? { ...t, state: 'Skipped' } : t)),
        }
        : r)),
      orders: s.orders.map((o) => (o.id === run?.orderId ? { ...o, state: 'Failed' as OrderState, waitingOn: 'Assigned engineer' } : o)),
      activeRunId: null,
    }))
    get().pushToast('warn', 'Run aborted. Rollback tasks executed in reverse order.')
  },

  retryOrder: (orderId) => {
    get().setOrderState(orderId, 'Reinstantiate')
    get().pushToast('info', `${orderId} reinstantiated — re-entering the execution queue.`)
    setTimeout(() => { get().startRun(orderId) }, 1100)
  },

  raiseChange: (serviceId, intent, delta, params, notes) => {
    const svc = get().serviceById(serviceId)!
    const seq = get().orders.length + 1
    const now = new Date().toISOString()
    /* The endpoint's rendered command needs the service's full parameter set,
       with whatever was actually requested overlaid on top of it — not the
       stale current values, and not only the changed ones (a command missing
       its unrelated placeholders can't render at all). */
    const overrides = new Map((params ?? []).map((p) => [p.name, p.value]))
    const mergedAttrs: OrderParamValue[] = svc.attributes.map((a) => (
      overrides.has(a.name)
        ? { name: a.name, value: overrides.get(a.name)!, source: 'user' as const }
        : { name: a.name, value: a.intent, source: 'derived' as const }
    ))
    const bandwidth = overrides.has('Bandwidth') ? (parseInt(overrides.get('Bandwidth')!, 10) || svc.bandwidthMbps) : svc.bandwidthMbps
    const order: Order = {
      id: `ORD-2026-${pad(4500 + seq, 6)}`,
      code: `NS-${pad(400 + seq, 6)}`,
      name: svc.name,
      intent,
      intentId: svc.intentId,
      category: svc.category,
      type: svc.type,
      subtype: '—',
      accountId: svc.accountId,
      accountName: svc.accountName,
      serviceId,
      state: 'Validated',
      workflowId: get().workflows.find((w) => w.intentId === svc.intentId && w.state === 'Active')?.id,
      endpoints: bindEndpoints(svc.endpoints, svc.category, svc.type, '—', get().workflows, mergedAttrs, bandwidth),
      /* Only what was actually changed goes on the request — everything else
         about the service is unaffected and has no business being here. */
      params: params ?? mergedAttrs,
      createdAt: now, updatedAt: now, ageDays: 0,
      owner: 'Priya S.', waitingOn: 'NOC lead',
      runIds: [], approvals: [{ role: 'NOC lead' }],
      delta, slaBreached: false, notes,
    }
    set((s) => ({ orders: [order, ...s.orders] }))
    get().pushToast('good', `${intent} order ${order.id} raised against ${serviceId}.`)
    return order
  },

  reproveService: (serviceId) => {
    set((s) => ({
      services: s.services.map((sv) => (sv.id === serviceId
        ? { ...sv, lastProvenAt: new Date().toISOString(), conformance: sv.conformance === 'Never proven' ? 'Conformant' : sv.conformance }
        : sv)),
    }))
    get().pushToast('good', `${serviceId} re-proven. Evidence refreshed.`)
  },

  addProfileType: (category, type, subtype, description) => {
    set((s) => ({
      profileTypes: [{
        id: `PT-${pad(s.profileTypes.length + 1, 3)}`,
        category: category as (typeof PROFILE_TYPES)[number]['category'],
        type, subtype, description,
        creator: 'Jayesh',
        createdAt: new Date().toISOString(),
        usedByWorkflows: 0,
      }, ...s.profileTypes],
    }))
    get().pushToast('good', `Profile type ${category} → ${type} → ${subtype} created.`)
  },

  updateProfileType: (id, patch) => {
    set((s) => ({
      profileTypes: s.profileTypes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
    get().pushToast('good', `${id} updated.`)
  },

  setWorkflowState: (id, state) => {
    set((s) => ({ workflows: s.workflows.map((w) => (w.id === id ? { ...w, state } : w)) }))
    get().pushToast('good', `Workflow ${id} moved to ${state}.`)
  },

  saveWorkflow: (wf, note) => {
    const exists = get().workflows.some((w) => w.id === wf.id)
    const id = exists ? wf.id : `CF-${pad(400 + get().workflows.filter((w) => w.id > 'CF-000400').length + 1, 6)}`
    const stored: Workflow = { ...wf, id, modifiedOn: new Date().toISOString() }
    set((s) => ({ workflows: exists ? s.workflows.map((w) => (w.id === id ? stored : w)) : [stored, ...s.workflows] }))
    get().pushToast('good', note ?? `${id} saved${stored.state === 'Draft' ? ' as draft' : ''}.`)
    return id
  },

  addIntent: (input) => {
    const pt = get().profileTypes.find((p) => p.id === input.profileTypeId)
    const category = pt?.category ?? 'L2VPN'
    const catToken = category.replace(/\s+/g, '').toUpperCase().slice(0, 6)
    const nameToken = input.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'INTENT'
    let id = `INT-${catToken}-${nameToken}`
    let n = 2
    while (get().intents.some((i) => i.id === id)) { id = `INT-${catToken}-${nameToken}-${n}`; n += 1 }
    /* Starts Draft, not Active — a freshly authored intent isn't ready to be
       picked in a workflow until someone explicitly activates it. Its own
       id is the root of a new family — every later version forks from here. */
    const intent: ServiceIntent = {
      id, familyId: id, name: input.name.trim(), profileTypeId: input.profileTypeId,
      category, type: pt?.type ?? '', topology: input.topology, endpointArity: input.endpointArity.trim() || 'exactly 2',
      params: [], pools: [], acceptance: [], version: 1, state: 'Draft', liveServices: 0,
    }
    set((s) => ({ intents: [intent, ...s.intents] }))
    get().pushToast('good', `Service Intent ${id} created.`)
    return id
  },

  setIntentState: (id, state) => {
    const familyId = get().intents.find((i) => i.id === id)?.familyId
    let retiredSiblingId: string | null = null
    set((s) => ({
      intents: s.intents.map((i) => {
        if (i.id === id) return { ...i, state }
        /* Activating a version retires whichever sibling in its family was
           Active — at most one current Active version per family, which is
           what lets every picker elsewhere key off `state === 'Active'`
           and only ever see one row per intent. */
        if (state === 'Active' && i.familyId === familyId && i.state === 'Active') {
          retiredSiblingId = i.id
          return { ...i, state: 'Retired' }
        }
        return i
      }),
    }))
    /* Migration, live: every workflow still pinned to the version that just
       retired follows forward to the one that replaced it, so "mapped to a
       valid Service Intent" stays true for old workflows too, not just new
       ones — and any explicitly-added parameter that only existed on the
       old version is dropped rather than left dangling against the new one. */
    let remapped = 0
    if (retiredSiblingId) {
      const replacement = get().intents.find((i) => i.id === id)!
      const validNames = new Set(replacement.params.map((p) => p.name))
      set((s) => ({
        workflows: s.workflows.map((w) => {
          if (w.intentId !== retiredSiblingId) return w
          remapped += 1
          return { ...w, intentId: id, explicitParams: (w.explicitParams ?? []).filter((n) => validNames.has(n)) }
        }),
      }))
    }
    get().pushToast('good', remapped > 0
      ? `Service Intent ${id} moved to ${state} — ${remapped} workflow(s) remapped from the retired version.`
      : `Service Intent ${id} moved to ${state}.`)
  },

  addIntentParam: (intentId, param) => {
    if (get().intents.find((i) => i.id === intentId)?.params.some((p) => p.name === param.name)) return intentId
    const result = applyParamChange(get().intents, intentId, (params) => [...params, param])
    set({ intents: result.intents })
    get().pushToast('good', result.id === intentId ? `Parameter ${param.name} added.` : `Parameter ${param.name} added in new draft ${result.id}.`)
    return result.id
  },

  updateIntentParam: (intentId, name, patch) => {
    const result = applyParamChange(get().intents, intentId, (params) => params.map((p) => (p.name === name ? { ...p, ...patch } : p)))
    set({ intents: result.intents })
    get().pushToast('good', result.id === intentId ? `Parameter ${name} updated.` : `Parameter ${name} updated in new draft ${result.id}.`)
    return result.id
  },

  removeIntentParam: (intentId, name) => {
    const result = applyParamChange(get().intents, intentId, (params) => params.filter((p) => p.name !== name))
    set({ intents: result.intents })
    get().pushToast('good', result.id === intentId ? `Parameter ${name} removed.` : `Parameter ${name} removed in new draft ${result.id}.`)
    return result.id
  },

  reorderIntentParam: (intentId, name, direction) => {
    const result = applyParamChange(get().intents, intentId, (params) => {
      const i = params.findIndex((p) => p.name === name)
      const j = i + direction
      if (i < 0 || j < 0 || j >= params.length) return params
      const arr = [...params]
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return arr
    })
    set({ intents: result.intents })
    return result.id
  },

  deleteIntent: (id) => {
    const target = get().intents.find((i) => i.id === id)
    if (!target || target.state !== 'Draft') {
      get().pushToast('crit', 'Only a Draft version can be deleted.')
      return
    }
    set((s) => ({ intents: s.intents.filter((i) => i.id !== id) }))
    get().pushToast('good', `${id} deleted.`)
  },
}))
