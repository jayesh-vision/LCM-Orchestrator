import { create } from 'zustand'
import type {
  Notification, Order, OrderIntent, OrderParamValue, OrderState,
  ResourcePool, Run, RunTask, Service, Workflow,
} from '@/types'
import { INTENTS, PROFILE_TYPES, intentById, pad } from '@/data/catalog'
import { buildWorkflows } from '@/data/workflows'
import { buildServices } from '@/data/services'
import { bindEndpoints, buildOrders, buildRuns, claimFor, orderedTasks } from '@/data/orders'
import { renderCommand } from '@/data/templates'
import { REPORTS, buildNotifications, buildPools } from '@/data/misc'

/* Seed once, at module load, so the dataset is stable across navigation. */
const workflows = buildWorkflows()
const services = buildServices()
const orders = buildOrders(services, workflows)
const runs = buildRuns(orders, workflows)
const pools = buildPools(services)

export interface WizardDraft {
  category: string
  type: string
  subtype: string
  accountId: string
  accountName: string
  name: string
  intentId: string
  workflowId: string
  endpoints: { role: 'A' | 'Z' | 'hub' | 'spoke'; siteCode: string; deviceName: string; vendor: string; mgmtIp: string; port: string }[]
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
  reports: typeof REPORTS
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
  setOrderState: (id: string, state: OrderState, note?: string) => void
  approveOrder: (id: string, by: string) => void
  rejectOrder: (id: string, by: string, comment: string) => void
  startRun: (orderId: string) => string | undefined
  abortRun: (runId: string) => void
  retryOrder: (orderId: string) => void

  raiseChange: (serviceId: string, intent: OrderIntent, delta?: Order['delta']) => Order
  reproveService: (serviceId: string) => void

  addProfileType: (category: string, type: string, subtype: string, description: string) => void
  setWorkflowState: (id: string, state: Workflow['state']) => void
  /** Create or replace a workflow from the builder. Returns the stored id. */
  saveWorkflow: (wf: Workflow, note?: string) => string
}

let toastSeq = 0
let runTimer: ReturnType<typeof setInterval> | null = null

export const useStore = create<State>((set, get) => ({
  orders, services, workflows, runs, pools,
  profileTypes: PROFILE_TYPES,
  intents: INTENTS,
  reports: REPORTS,
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
      name: draft.name || intentById(draft.intentId).name,
      intent: 'Create',
      intentId: draft.intentId,
      category: draft.category as Order['category'],
      type: draft.type,
      subtype: draft.subtype,
      accountId: draft.accountId,
      accountName: draft.accountName,
      state: 'Designed',
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
      ),
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
    get().pushToast('good', `${order.id} created and pre-validated. Awaiting approval.`)
    return order
  },

  setOrderState: (id, state, note) =>
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === id ? { ...o, state, notes: note ?? o.notes, updatedAt: new Date().toISOString() } : o),
    })),

  approveOrder: (id, by) => {
    set((s) => ({
      orders: s.orders.map((o) => (o.id === id
        ? {
          ...o,
          state: 'Approved' as OrderState,
          waitingOn: 'Change window',
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
          waitingOn: 'Requester',
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
        ? { ...o, state: 'Executing' as OrderState, waitingOn: undefined, runIds: [...runIds, ...o.runIds] } : o)),
    }))
    get().pushToast('info', `Run ${attempt} started on ${eps.length} device(s).`)

    if (runTimer) clearInterval(runTimer)
    let i = 0
    const longest = Math.max(...newRuns.map((r) => r.tasks.length))

    runTimer = setInterval(() => {
      const state = get()
      const mine = state.runs.filter((r) => runIds.includes(r.id))
      if (mine.length === 0) { if (runTimer) clearInterval(runTimer); return }

      if (i >= longest) {
        if (runTimer) clearInterval(runTimer)
        set((s) => ({
          runs: s.runs.map((r) => (runIds.includes(r.id)
            ? { ...r, outcome: 'Accepted', endedAt: new Date().toISOString(), durationMs: Date.now() - new Date(r.startedAt).getTime() }
            : r)),
          orders: s.orders.map((o) => (o.id === orderId ? { ...o, state: 'Activated' as OrderState } : o)),
          activeRunId: null,
        }))
        get().pushToast('good', `${orderId} activated. All acceptance criteria passed on every device.`)
        return
      }

      const idx = i
      set((s) => ({
        runs: s.runs.map((r) => {
          if (!runIds.includes(r.id)) return r
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
            if (n === idx + 1) return { ...t, state: 'Running', startedAt: new Date().toISOString() }
            return t
          })
          return { ...r, tasks: next }
        }),
      }))
      i += 1
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
            : t.state === 'Running' ? { ...t, state: 'Skipped' } : t)),
        }
        : r)),
      orders: s.orders.map((o) => (o.id === run?.orderId ? { ...o, state: 'Failed' as OrderState, waitingOn: 'Assigned engineer' } : o)),
      activeRunId: null,
    }))
    get().pushToast('warn', 'Run aborted. Rollback tasks executed in reverse order.')
  },

  retryOrder: (orderId) => {
    get().setOrderState(orderId, 'Approved')
    get().pushToast('info', `${orderId} queued for retry.`)
  },

  raiseChange: (serviceId, intent, delta) => {
    const svc = get().serviceById(serviceId)!
    const seq = get().orders.length + 1
    const now = new Date().toISOString()
    const order: Order = {
      id: `ORD-2026-${pad(4500 + seq, 6)}`,
      code: `NS-${pad(400 + seq, 6)}`,
      name: `${svc.name} · ${intent.toLowerCase()}`,
      intent,
      intentId: svc.intentId,
      category: svc.category,
      type: svc.type,
      subtype: '—',
      accountId: svc.accountId,
      accountName: svc.accountName,
      serviceId,
      state: 'Awaiting approval',
      workflowId: get().workflows.find((w) => w.intentId === svc.intentId && w.state === 'Active')?.id,
      endpoints: bindEndpoints(svc.endpoints, svc.category, svc.type, '—', get().workflows,
        svc.attributes.map((a) => ({ name: a.name, value: a.intent, source: 'derived' as const })), svc.bandwidthMbps),
      params: svc.attributes.map((a) => ({ name: a.name, value: a.intent, source: 'derived' as const })),
      createdAt: now, updatedAt: now, ageDays: 0,
      owner: 'Priya S.', waitingOn: 'NOC lead',
      runIds: [], approvals: [{ role: 'NOC lead' }],
      delta, slaBreached: false,
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
}))
