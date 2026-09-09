/* ============================================================
   Domain model — LCM Orchestrator
   ============================================================ */

/** The provisioning domain a service belongs to. Sits above Category — Transport's
 *  categories are L2VPN/L3VPN/IBW; each other domain brings its own category set. */
export type Domain = 'Transport' | 'Access' | 'Radio' | 'Fiber'
export const DOMAINS: Domain[] = ['Transport', 'Access', 'Radio', 'Fiber']

export type Category = 'L2VPN' | 'L3VPN' | 'IBW' | 'Broadband' | 'Microwave' | 'DWDM' | 'RAN VNF'
/** Which categories exist under each domain — drives every domain→category cascade in the UI.
 *  A domain can carry more than one category with a disjoint vendor estate
 *  (Radio's Microwave links vs its RAN VNF category) — see CATEGORY_VENDOR_KIND
 *  in catalog.ts, which is what actually drives vendor eligibility. */
export const CATEGORIES_BY_DOMAIN: Record<Domain, Category[]> = {
  Transport: ['L2VPN', 'L3VPN', 'IBW'],
  Access: ['Broadband'],
  Radio: ['Microwave', 'RAN VNF'],
  Fiber: ['DWDM'],
}
const CATEGORY_DOMAIN: Record<Category, Domain> = {
  L2VPN: 'Transport', L3VPN: 'Transport', IBW: 'Transport',
  Broadband: 'Access', Microwave: 'Radio', 'RAN VNF': 'Radio', DWDM: 'Fiber',
}
export const domainOf = (category: Category): Domain => CATEGORY_DOMAIN[category]

/** Contractual state of a service. Changed only by orders. */
export type ServiceState =
  | 'Designed' | 'Activating' | 'Live' | 'Degraded'
  | 'Suspended' | 'Ceasing' | 'Ceased' | 'Purged'

/** Observed state. Polled, never stored as truth. */
export type OperState = 'Up' | 'Down' | 'Degraded' | 'Unknown'

/** Computed by comparing intent to the device. Never typed by a human. */
export type Conformance = 'Conformant' | 'Drifted' | 'Never proven' | 'Ghost' | 'Not checked'

/** Lifecycle state of an order — the platform's own vocabulary end to end:
 *  Draft (params only, no check run yet) → Planned (pre-validation running) →
 *  Validated / Invalid (pre-validation outcome) → Approved / Rejected (human
 *  decision on a Validated request) → Queued (sent to the execution queue) →
 *  In progress (workflow executing) → Ready / Failed (workflow outcome) →
 *  Reinstantiate (a Failed request re-entering the queue for another attempt). */
export type OrderState =
  | 'Draft' | 'Planned' | 'Validated' | 'Invalid' | 'Approved' | 'Rejected'
  | 'Queued' | 'In progress' | 'Ready' | 'Failed' | 'Reinstantiate'

export type OrderIntent = 'Create' | 'Modify' | 'Suspend' | 'Resume' | 'Cease' | 'Re-prove'

/** State of one task inside a run. Direction is carried separately. */
export type TaskState =
  | 'Not started' | 'Queued' | 'Running' | 'Passed'
  | 'Failed' | 'Blocked' | 'Skipped'

export type RunDirection = 'forward' | 'rollback'

export type RunOutcome =
  | 'Running' | 'Accepted' | 'Failed' | 'Rolled back'
  | 'Rolled back with residue' | 'Aborted'

/** The three kinds of stage a workflow can carry, as on the platform. A workflow
 *  is an ordered list of stage nodes; each node has one of these kinds. */
export type StageKind = 'Pre validation' | 'Configuration' | 'Post validation'
export const STAGE_KINDS: StageKind[] = ['Pre validation', 'Configuration', 'Post validation']

export interface WorkflowStage {
  id: string
  name: string          // "Category name" on the platform, e.g. Set service configuration
  displayName: string
  kind: StageKind
  sequence: number
}

/** How a command's output is judged. */
export type ValidationType = 'Contains' | 'Not contains' | 'Equals' | 'Matches regex' | 'Not empty'
export const VALIDATION_TYPES: ValidationType[] = ['Contains', 'Not contains', 'Equals', 'Matches regex', 'Not empty']

export interface ValidationRule {
  id: string
  join: 'And' | 'Or'    // how this rule combines with the one above it
  text: string          // "Validation command" on the platform — the text looked for
  type: ValidationType
}

/* Each vendor estate is disjoint, never bound to another category's workflow:
   Transport CISCO..DLINK, Access HUAWEI..ADTRAN, Radio(Microwave) CERAGON..NEC,
   Fiber CIENA..ECI, Radio(RAN VNF) MAVENIR..RADISYS. */
export type Vendor =
  | 'CISCO' | 'JUNIPER' | 'NOKIA' | 'ADVA' | 'TEJAS' | 'TECHROUTE' | 'EDGECORE' | 'DLINK'
  | 'HUAWEI' | 'ZTE' | 'ADTRAN'
  | 'CERAGON' | 'AVIAT' | 'NEC'
  | 'CIENA' | 'INFINERA' | 'ECI'
  | 'MAVENIR' | 'SAMSUNG' | 'RADISYS'

/** What the device actually is. Router-class devices carry BGP/VRF/L3 routing
 *  and are the only kind that can serve an L3VPN or IBW intent; a Switch is
 *  Ethernet/VLAN-only and can only carry the L2VPN family. CPE is the Access
 *  domain's device class. Radio is a microwave backhaul unit; Optical is a
 *  DWDM transponder/ROADM. VNF is a virtualized RAN network function (CU/DU)
 *  — no physical device at all, provisioned as a lifecycle-managed instance
 *  rather than a CLI-configured box; each kind is only ever eligible for its
 *  own category's intent. */
export type DeviceKind = 'Router' | 'Switch' | 'CPE' | 'Radio' | 'Optical' | 'VNF'

export type WorkflowState = 'Draft' | 'Assigned' | 'Awaiting approval' | 'Active' | 'Rejected' | 'Retired'

export type PoolKind =
  | 'VLAN' | 'RD/RT' | 'Pseudowire ID' | 'IP block' | 'Sub-interface' | 'ASN slot' | 'CPE Serial'
  | 'Frequency Channel' | 'Wavelength' | 'PCI'

export type AssertionForm =
  | 'exists' | 'absent' | 'equals' | 'in_range' | 'count' | 'matches' | 'unchanged'

/* ---------- endpoints ---------- */

export type EndpointRole = 'Source' | 'Destination'

export interface Endpoint {
  id: string
  role: 'A' | 'Z' | 'hub' | 'spoke'
  siteCode: string        // DL-BLR-0412
  deviceName: string      // ASR9k / MX204
  vendor: Vendor
  mgmtIp: string
  port: string            // xe-0/0/3
  subInterface?: string   // xe-0/0/3.104
  /** The workflow that runs on THIS device. A and Z can differ — different vendor, different role. */
  workflowId?: string
  /** Parameters rendered for this device only. */
  params?: OrderParamValue[]
}

/** A = Source, Z = Destination; a hub is the source of its spokes. */
export const endpointRole = (e: Pick<Endpoint, 'role'>): EndpointRole =>
  e.role === 'A' || e.role === 'hub' ? 'Source' : 'Destination'

/* ---------- intent catalog ---------- */

export interface IntentParam {
  name: string
  type: 'enum' | 'integer' | 'boolean' | 'string' | 'ipv4'
  constraint: string
  modifiable: 'no' | 'hitless' | 'bounce' | 'recreate'
  fromPool?: PoolKind
  options?: string[]
  min?: number
  max?: number
  default?: string | number | boolean
  required: boolean
}

export interface AcceptanceCriterion {
  id: string
  claim: string
  layer: 'device' | 'network' | 'service'
  expected: string
}

export interface ServiceIntent {
  id: string                 // INT-L2-P2P
  name: string
  category: Category
  type: string               // Transparent / Railwire / Hub & Spoke / BGP
  topology: 'Single-ended' | 'Two-ended' | 'Star' | 'Full mesh'
  endpointArity: string
  params: IntentParam[]
  pools: PoolKind[]
  acceptance: AcceptanceCriterion[]
  version: number
  liveServices: number
}

/* ---------- profile type (master hierarchy) ---------- */

export interface ProfileType {
  id: string
  category: Category
  type: string
  subtype: string
  description: string
  creator: string
  createdAt: string
  usedByWorkflows: number
}

/* ---------- workflow / renderer ---------- */

export interface WorkflowTaskDef {
  id: string
  name: string
  displayName: string
  sequence: number            // within its stage
  stageId: string
  stage: string               // stage display name (denormalised for display)
  stageKind: StageKind
  kind: 'read' | 'write'
  /** The command sent to the device. `${Parameter}` placeholders are rendered per endpoint. */
  setCommand: string
  /** Rules applied to the set command's output, top to bottom with And/Or joins. */
  validations: ValidationRule[]
  /** Rollback command and its own rules; only used when rollbackEnabled. */
  inverseCommand?: string
  rollbackValidations: ValidationRule[]
  /* Behaviour flags, named as on the platform */
  skipAllowed: boolean            // Is skip required
  manualCompleteAllowed: boolean  // Is manual complete required
  rollbackEnabled: boolean        // Is rollback enable
  rollbackBreaker: boolean        // Rollback breaker
  retryAllowed: boolean           // Is retry possible
  timeoutMs?: number              // Configure timeout (absent = platform default)
  delayMs?: number                // Task delay (absent = none)
  /* Legacy evidence fields kept for the assertion audit */
  parseRule?: string
  assertion?: { form: AssertionForm; field?: string; expected: string }
  postRollbackAssertion?: string
}

export interface Workflow {
  id: string                 // CF-000248
  name: string
  displayName: string
  category: Category
  type: string
  subtype: string
  vendor: Vendor
  kind: DeviceKind             // Router or Switch — denormalised from the bound device model
  model: string               // first model, for grids
  models: string[]            // every model this template may run on
  osRange: string
  intentId: string
  /** Which end of the service this template configures ("Location" on the platform). Absent = either end. */
  endpointRole?: EndpointRole
  state: WorkflowState
  version: number
  modifiedOn: string
  createdBy: string
  stages: WorkflowStage[]
  tasks: WorkflowTaskDef[]
  runs30d: number
  firstPassRate: number
}

/* ---------- runs ---------- */

export interface RunTask {
  taskDefId: string
  name: string
  stage: string
  stageKind: StageKind
  sequence: number
  state: TaskState
  direction: RunDirection
  claim: string
  command: string
  requestPayload: string
  responsePayload: string
  transportExit: number
  parsed?: string
  expected?: string
  actual?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  failureReason?: string
  blockedBy?: string
}

export interface Run {
  id: string
  attempt: number
  orderId: string
  /** The endpoint this run executed against. One run per endpoint per attempt. */
  endpointId?: string
  workflowId: string
  direction: RunDirection
  outcome: RunOutcome
  startedAt: string
  endedAt?: string
  durationMs?: number
  orchestratorClock: string
  deviceClock: string
  clockSkewMs: number
  tasks: RunTask[]
  residue?: string[]
}

/* ---------- orders ---------- */

export interface OrderParamValue {
  name: string
  value: string
  source: 'user' | 'template' | 'pool' | 'derived'
}

export interface Order {
  id: string                   // ORD-2026-004417
  code: string                 // NS-000114
  name: string
  intent: OrderIntent
  intentId: string
  category: Category
  type: string
  subtype: string
  accountId: string
  accountName: string
  serviceId?: string
  state: OrderState
  workflowId?: string
  endpoints: Endpoint[]
  params: OrderParamValue[]
  createdAt: string
  updatedAt: string
  ageDays: number
  owner?: string
  waitingOn?: string
  runIds: string[]
  approvals: { role: string; by?: string; at?: string; decision?: 'Approved' | 'Rejected'; comment?: string }[]
  delta?: { attribute: string; current: string; requested: string }[]
  slaBreached: boolean
  notes?: string
}

/* ---------- services ---------- */

export interface ServiceAttribute {
  name: string
  intent: string
  onDevice: string
  source: 'Order' | 'Reserved' | 'Derived' | 'Discovered' | 'Manual' | 'Inventory' | 'No source system'
  verifiedAt?: string
  verdict: 'Match' | 'Drift' | 'Not sourced' | 'Absent'
}

export interface HeldResource {
  kind: PoolKind
  value: string
  pool: string
  state: 'Allocated' | 'Quarantined' | 'Released'
}

export interface ChangeRecord {
  at: string
  orderId?: string
  change: string
  by: string
  outOfBand: boolean
}

export interface Service {
  id: string                   // SVC-L2-018842
  name: string
  category: Category
  type: string
  intentId: string
  accountId: string
  accountName: string
  state: ServiceState
  operState: OperState
  conformance: Conformance
  endpoints: Endpoint[]
  attributes: ServiceAttribute[]
  resources: HeldResource[]
  history: ChangeRecord[]
  bandwidthMbps: number
  monthlyValueInr: number
  liveSince: string
  lastProvenAt?: string
  ageLabel: string
  driftCount: number
  acceptanceEvidence?: { criterion: string; layer: string; expected: string; actual: string; passed: boolean }[]
}

/* ---------- resource pools ---------- */

export interface PoolEntry {
  value: string
  state: 'Free' | 'Allocated' | 'Quarantined' | 'Reserved'
  serviceId?: string
  releasedAt?: string
  quarantineUntil?: string
}

export interface ResourcePool {
  id: string
  kind: PoolKind
  scope: string                // device + port, or global
  total: number
  allocated: number
  quarantined: number
  reserved: number
  entries: PoolEntry[]
}

/* ---------- reports ---------- */

export interface ReportRun {
  at: string
  snapshot: string
  headline: string
  value: number
  delta: number
}

export interface ReportDef {
  id: string
  name: string
  question: string
  cadence: string
  audience: string
  state: 'Current' | 'Stale' | 'Running' | 'Failed'
  lastRunAt: string
  snapshot: string
  headline: string
  deltaLabel: string
  deltaTone: 'good' | 'bad' | 'flat'
  history: ReportRun[]
  failureReason?: string
}

/* ---------- notifications ---------- */

export interface Notification {
  id: string
  at: string
  tone: 'info' | 'good' | 'warn' | 'crit'
  title: string
  body: string
  read: boolean
  link?: string
}
