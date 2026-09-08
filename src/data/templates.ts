import type {
  Category, EndpointRole, StageKind, ValidationRule, ValidationType, Vendor, WorkflowStage, WorkflowTaskDef,
} from '@/types'
import { pad } from './catalog'

/* ------------------------------------------------------------------
   Stage and task templates, written the way the platform writes them:
   three stage nodes (Pre validation → Set service configuration →
   Post validation), every task a device command whose output is judged
   by Contains / Not contains rules, every Configuration task carrying
   its own rollback command. `${Parameter}` placeholders use the exact
   parameter names the request detail renders per endpoint.
   ------------------------------------------------------------------ */

let ruleSeq = 0
const rule = (text: string, type: ValidationType = 'Not contains', join: 'And' | 'Or' = 'And'): ValidationRule => {
  ruleSeq += 1
  return { id: `VR-${pad(ruleSeq, 6)}`, join, text, type }
}
const ok = () => [rule('error'), rule('invalid')]

let taskSeq = 0
let stageSeq = 0

type TaskSeed = {
  name: string
  set: string
  rules?: ValidationRule[]
  rollback?: string
  rollbackRules?: ValidationRule[]
  timeoutMs?: number
  retry?: boolean
  skip?: boolean
  manual?: boolean
  breaker?: boolean
}

type StageSeed = { name: string; kind: StageKind; tasks: TaskSeed[] }

function materialise(seeds: StageSeed[]): { stages: WorkflowStage[]; tasks: WorkflowTaskDef[] } {
  const stages: WorkflowStage[] = []
  const tasks: WorkflowTaskDef[] = []
  seeds.forEach((s, si) => {
    stageSeq += 1
    const stage: WorkflowStage = { id: `STG-${pad(stageSeq, 6)}`, name: s.name, displayName: s.name, kind: s.kind, sequence: si + 1 }
    stages.push(stage)
    s.tasks.forEach((t, ti) => {
      taskSeq += 1
      const write = s.kind === 'Configuration'
      const rules = t.rules ?? ok()
      const first = rules[0]
      tasks.push({
        id: `TSK-${pad(taskSeq, 6)}`,
        name: t.name,
        displayName: t.name,
        sequence: ti + 1,
        stageId: stage.id,
        stage: stage.displayName,
        stageKind: stage.kind,
        kind: write ? 'write' : 'read',
        setCommand: t.set,
        validations: rules,
        inverseCommand: t.rollback,
        rollbackValidations: t.rollback ? (t.rollbackRules ?? ok()) : [],
        skipAllowed: t.skip ?? false,
        manualCompleteAllowed: t.manual ?? false,
        rollbackEnabled: !!t.rollback,
        rollbackBreaker: t.breaker ?? (write && !!t.rollback),
        retryAllowed: t.retry ?? !write,
        timeoutMs: t.timeoutMs ?? 50000,
        delayMs: undefined,
        assertion: first
          ? { form: first.type === 'Contains' ? 'exists' : first.type === 'Not contains' ? 'absent' : 'matches', field: 'output', expected: `${first.type.toLowerCase()} "${first.text}"` }
          : undefined,
        postRollbackAssertion: t.rollback ? 'rollback output not contains "error"' : undefined,
      })
    })
  })
  return { stages, tasks }
}

/* ------------------------------------------------------------------
   The platform's own lifecycle workflows, transcribed from Jayesh's
   screenshots (Sep 2026): stage names and task names are verbatim; the
   commands are the vendor CLI each task would send. One entry per
   category × vendor (× type where the platform differs).
   ------------------------------------------------------------------ */

const IF = '${Interface}', U = '${Vlan-ID}', V = '${VRF}', NB = '${Neighbor IP}'
const showSet = (path: string) => `show configuration ${path} | display set`
const JCOMMIT = '\ncommit and-quit'
const XCOMMIT = '\ncommit'

/* ---- L2VPN | Transparent | Untagged/Tagged | CISCO | NCS  (Pre-Validation 4 · Service configuration 1 · Post-Validation 2) */
function l2vpnCisco(subtype: string): StageSeed[] {
  const untagged = /untagged/i.test(subtype)
  const encap = untagged ? 'encapsulation untagged' : `encapsulation dot1q ${U}`
  const XG = '${Xconnect group}', PW = 'PW-${VC ID}'
  return [
    { name: 'Pre-Validation', kind: 'Pre validation', tasks: [
      { name: 'Neighbor Reachability Test', set: `ping ${NB} count 5`, rules: [rule('Success rate is 100 percent', 'Contains')], retry: true },
      { name: 'Verify running config', set: `show running-config interface ${IF}.${U}`, rules: [rule(`interface ${IF}.${U}`), rule('Invalid input')] },
      { name: 'Interface Configuration Check', set: `show interfaces ${IF} brief`, rules: [rule('up', 'Contains'), rule('admin-down')] },
      { name: 'Verify pw class', set: 'show running-config l2vpn pw-class PW-CLASS-MPLS', rules: [rule('pw-class PW-CLASS-MPLS', 'Contains')] },
    ] },
    { name: 'Service configuration', kind: 'Configuration', tasks: [
      { name: 'Set Interface configuration',
        set: `interface ${IF}.${U} l2transport\n description \${Description}\n ${encap}\n${untagged ? '' : ' rewrite ingress tag pop 1 symmetric\n'} service-policy input PM-\${Bandwidth}M\n!\nl2vpn\n xconnect group ${XG}\n  p2p ${PW}\n   interface ${IF}.${U}\n   neighbor ipv4 ${NB} pw-id \${VC ID}\n    pw-class PW-CLASS-MPLS${XCOMMIT}`,
        rules: [rule('Failed'), rule('error')],
        rollback: `l2vpn\n xconnect group ${XG}\n  no p2p ${PW}\n!\nno interface ${IF}.${U} l2transport${XCOMMIT}`, timeoutMs: 120000, breaker: true },
    ] },
    { name: 'Post-Validation', kind: 'Post validation', tasks: [
      { name: 'Verify interface configuration', set: `show running-config interface ${IF}.${U}`, rules: [rule('Invalid input'), rule(encap, 'Contains'), rule('l2transport', 'Contains')] },
      { name: 'Final verify pw class', set: `show l2vpn xconnect group ${XG} | include ${PW}`, rules: [rule('UP', 'Contains'), rule('DN')], retry: true, timeoutMs: 90000 },
    ] },
  ]
}

/* ---- L2VPN | Transparent | Tagged/Untagged | Juniper  (Pre-Validation 2 · Service configuration 2 · Post-Validation 3) */
function l2vpnJuniper(subtype: string): StageSeed[] {
  const untagged = /untagged/i.test(subtype)
  const unit = untagged ? '0' : U
  const ifSet = untagged
    ? `set interfaces ${IF} description "\${Description}"\nset interfaces ${IF} encapsulation ethernet-ccc\nset interfaces ${IF} unit 0 family ccc policer input POLICER-\${Bandwidth}M`
    : `set interfaces ${IF} unit ${U} description "\${Description}"\nset interfaces ${IF} unit ${U} encapsulation vlan-ccc\nset interfaces ${IF} unit ${U} vlan-id ${U}\nset interfaces ${IF} unit ${U} family ccc policer input POLICER-\${Bandwidth}M`
  return [
    { name: 'Pre-Validation', kind: 'Pre validation', tasks: [
      { name: 'Validate neighbour reachability', set: `ping ${NB} count 5`, rules: [rule('0% packet loss', 'Contains')], retry: true },
      { name: 'Check existing interface config', set: showSet(`interfaces ${IF} unit ${unit}`), rules: [rule(`unit ${unit}`), rule('error')] },
    ] },
    { name: 'Service configuration', kind: 'Configuration', tasks: [
      { name: 'Set interface configuration',
        set: `set firewall policer POLICER-\${Bandwidth}M if-exceeding bandwidth-limit \${Bandwidth}m burst-size-limit 625k\nset firewall policer POLICER-\${Bandwidth}M then discard\n${ifSet}`,
        rollback: untagged ? `delete interfaces ${IF}` : `delete interfaces ${IF} unit ${U}` },
      { name: 'Set protocol configuration',
        set: `set protocols l2circuit neighbor ${NB} interface ${IF}.${unit} virtual-circuit-id \${VC ID}\nset protocols l2circuit neighbor ${NB} interface ${IF}.${unit} description "\${Description}"${JCOMMIT}`,
        rules: [rule('commit complete', 'Contains'), rule('error')],
        rollback: `delete protocols l2circuit neighbor ${NB} interface ${IF}.${unit}${JCOMMIT}`, timeoutMs: 120000, breaker: true },
    ] },
    { name: 'Post-Validation', kind: 'Post validation', tasks: [
      { name: 'Confirm interface config', set: `show configuration | display set | match ${IF}`,
        rules: [rule('error'), rule('invalid'), rule(untagged ? `set interfaces ${IF} encapsulation ethernet-ccc` : `set interfaces ${IF} unit ${U} vlan-id ${U}`, 'Contains')] },
      { name: 'Interface status check', set: `show interfaces ${IF}.${unit} terse`, rules: [rule('up', 'Contains'), rule('down')], retry: true },
      { name: 'L2Circuit connection status check', set: `show l2circuit connections interface ${IF}.${unit}`, rules: [rule('Up', 'Contains')], retry: true, timeoutMs: 90000 },
    ] },
  ]
}

/* ---- L3VPN | Fully-Mesh | VRF | JUNIPER  (Pre Validation 4 · Set VRF Configuration 3 · Post Validation 4) */
function l3vpnMeshJuniper(): StageSeed[] {
  return [
    { name: 'Pre Validation', kind: 'Pre validation', tasks: [
      { name: 'Check Routing Instances', set: showSet(`routing-instances ${V}`), rules: [rule('error')] },
      { name: 'Check Import-Policy-Statement', set: showSet(`policy-options policy-statement ${V}-IMPORT`), rules: [rule('error')] },
      { name: 'Check Export-Policy-Statement', set: showSet(`policy-options policy-statement ${V}-EXPORT`), rules: [rule('error')] },
      { name: 'Check Policy-options Community', set: showSet(`policy-options community ${V}-RT`), rules: [rule('error')] },
    ] },
    { name: 'Set VRF Configuration', kind: 'Configuration', tasks: [
      { name: 'Set Policy-options Community', set: `set policy-options community ${V}-RT members target:\${RT}`, rollback: `delete policy-options community ${V}-RT` },
      { name: 'Set policy-statement',
        set: `set policy-options policy-statement ${V}-IMPORT term 1 from community ${V}-RT\nset policy-options policy-statement ${V}-IMPORT term 1 then accept\nset policy-options policy-statement ${V}-EXPORT term 1 then community add ${V}-RT\nset policy-options policy-statement ${V}-EXPORT term 1 then accept`,
        rollback: `delete policy-options policy-statement ${V}-IMPORT\ndelete policy-options policy-statement ${V}-EXPORT` },
      { name: 'Set Routing-Instances',
        set: `set interfaces ${IF} unit ${U} description "\${Description}"\nset interfaces ${IF} unit ${U} vlan-id ${U}\nset interfaces ${IF} unit ${U} family inet address \${Interface IP}\nset routing-instances ${V} instance-type vrf\nset routing-instances ${V} interface ${IF}.${U}\nset routing-instances ${V} route-distinguisher \${RD}\nset routing-instances ${V} vrf-import ${V}-IMPORT\nset routing-instances ${V} vrf-export ${V}-EXPORT\nset routing-instances ${V} protocols bgp group CE neighbor ${NB} peer-as \${Peer AS}${JCOMMIT}`,
        rules: [rule('commit complete', 'Contains'), rule('error')],
        rollback: `delete routing-instances ${V}\ndelete interfaces ${IF} unit ${U}${JCOMMIT}`, timeoutMs: 120000, breaker: true },
    ] },
    { name: 'Post Validation', kind: 'Post validation', tasks: [
      { name: 'Check Routing-Instances', set: showSet(`routing-instances ${V}`), rules: [rule('instance-type vrf', 'Contains'), rule(`interface ${IF}.${U}`, 'Contains')] },
      { name: 'Check Import-Policy-Statement', set: showSet(`policy-options policy-statement ${V}-IMPORT`), rules: [rule(`${V}-IMPORT term 1`, 'Contains')] },
      { name: 'Check Export-Policy-Statement', set: showSet(`policy-options policy-statement ${V}-EXPORT`), rules: [rule(`${V}-EXPORT term 1`, 'Contains')] },
      { name: 'Check Policy-options Community', set: showSet(`policy-options community ${V}-RT`), rules: [rule('target:${RT}', 'Contains')] },
    ] },
  ]
}

/* ---- L3VPN | Hub & Spoke | VRF | JUNIPER  (Pre Validation 4 · Set Configuration 3 · Post Validation 4) */
function l3vpnHubSpokeJuniper(): StageSeed[] {
  const mesh = l3vpnMeshJuniper()
  return [
    { name: 'Pre Validation', kind: 'Pre validation', tasks: [
      { name: 'Check vrf', set: showSet(`routing-instances ${V}`), rules: [rule('error')] },
      ...mesh[0].tasks.slice(1),
    ] },
    { name: 'Set Configuration', kind: 'Configuration', tasks: [
      { ...mesh[1].tasks[0], name: 'Set policy-options community' },
      mesh[1].tasks[1],
      { ...mesh[1].tasks[2], name: 'Set vrf' },
    ] },
    mesh[2],
  ]
}

/* ---- L3VPN | * | CISCO — the Juniper sequence on IOS-XR vocabulary */
function l3vpnCisco(type: string): StageSeed[] {
  const hub = /hub/i.test(type)
  return [
    { name: 'Pre Validation', kind: 'Pre validation', tasks: [
      { name: 'Check vrf', set: `show running-config vrf ${V}`, rules: [rule('Invalid input')] },
      { name: 'Check Import Route-Policy', set: `show running-config route-policy ${V}-IMPORT`, rules: [rule('Invalid input')] },
      { name: 'Check Export Route-Policy', set: `show running-config route-policy ${V}-EXPORT`, rules: [rule('Invalid input')] },
      { name: 'Check Community-Set', set: `show running-config community-set ${V}-RT`, rules: [rule('Invalid input')] },
    ] },
    { name: hub ? 'Set Configuration' : 'Set VRF Configuration', kind: 'Configuration', tasks: [
      { name: 'Set community-set', set: `community-set ${V}-RT\n \${RT}\nend-set`, rollback: `no community-set ${V}-RT` },
      { name: 'Set route-policy',
        set: `route-policy ${V}-IMPORT\n if community matches-any ${V}-RT then\n  pass\n endif\nend-policy\nroute-policy ${V}-EXPORT\n set community ${V}-RT additive\n pass\nend-policy`,
        rollback: `no route-policy ${V}-IMPORT\nno route-policy ${V}-EXPORT` },
      { name: 'Set vrf',
        set: `vrf ${V}\n rd \${RD}\n address-family ipv4 unicast\n  import route-policy ${V}-IMPORT\n  export route-policy ${V}-EXPORT\n!\ninterface ${IF}.${U}\n description \${Description}\n vrf ${V}\n encapsulation dot1q ${U}\n ipv4 address \${Interface IP}\n!\nrouter bgp 65001\n vrf ${V}\n  rd \${RD}\n  neighbor ${NB}\n   remote-as \${Peer AS}\n   address-family ipv4 unicast${XCOMMIT}`,
        rules: [rule('Failed'), rule('error')],
        rollback: `router bgp 65001\n no vrf ${V}\n!\nno interface ${IF}.${U}\nno vrf ${V}${XCOMMIT}`, timeoutMs: 120000, breaker: true },
    ] },
    { name: 'Post Validation', kind: 'Post validation', tasks: [
      { name: 'Check vrf', set: `show vrf ${V} detail`, rules: [rule(`VRF ${V}`, 'Contains'), rule(`${IF}.${U}`, 'Contains')] },
      { name: 'Check Import Route-Policy', set: `show running-config route-policy ${V}-IMPORT`, rules: [rule(`${V}-RT`, 'Contains')] },
      { name: 'Check Export Route-Policy', set: `show running-config route-policy ${V}-EXPORT`, rules: [rule(`${V}-RT`, 'Contains')] },
      { name: 'Check BGP neighbor', set: `show bgp vrf ${V} neighbors ${NB} | include BGP state`, rules: [rule('Established', 'Contains')], retry: true, timeoutMs: 90000 },
    ] },
  ]
}

/* ---- IBW | BGP | Other | JUNIPER  (Pre Validation 6 · Set Service Configuration 3 · Post Validation 5) */
function ibwBgpJuniper(): StageSeed[] {
  return [
    { name: 'Pre Validation', kind: 'Pre validation', tasks: [
      { name: 'Check Interface Status', set: `show interfaces ${IF} terse`, rules: [rule('up', 'Contains'), rule('error')] },
      { name: 'Check Routing Instances', set: showSet(`routing-instances ${V}`), rules: [rule('error')] },
      { name: 'Check Policer', set: showSet('firewall policer POLICER-${Bandwidth}M'), rules: [rule('error')] },
      { name: 'Check Interface Configuration', set: showSet(`interfaces ${IF} unit ${U}`), rules: [rule(`unit ${U}`), rule('error')] },
      { name: 'Check Import Policy Configuration', set: showSet(`policy-options policy-statement ${V}-IMPORT`), rules: [rule('error')] },
      { name: 'Check Export Policy Configuration', set: showSet(`policy-options policy-statement ${V}-EXPORT`), rules: [rule('error')] },
    ] },
    { name: 'Set Service Configuration', kind: 'Configuration', tasks: [
      { name: 'Set Interface Configuration',
        set: `set interfaces ${IF} unit ${U} description "\${Description}"\nset interfaces ${IF} unit ${U} vlan-id ${U}\nset interfaces ${IF} unit ${U} family inet policer input POLICER-\${Bandwidth}M\nset interfaces ${IF} unit ${U} family inet address \${Interface IP}`,
        rollback: `delete interfaces ${IF} unit ${U}` },
      { name: 'Set Policy Configuration',
        set: `set firewall policer POLICER-\${Bandwidth}M if-exceeding bandwidth-limit \${Bandwidth}m burst-size-limit 625k\nset firewall policer POLICER-\${Bandwidth}M then discard\nset policy-options policy-statement ${V}-IMPORT term 1 from route-filter \${Customer prefix} orlonger\nset policy-options policy-statement ${V}-IMPORT term 1 then accept\nset policy-options policy-statement ${V}-IMPORT term 2 then reject\nset policy-options policy-statement ${V}-EXPORT term 1 from protocol static\nset policy-options policy-statement ${V}-EXPORT term 1 then accept`,
        rollback: `delete policy-options policy-statement ${V}-IMPORT\ndelete policy-options policy-statement ${V}-EXPORT\ndelete firewall policer POLICER-\${Bandwidth}M` },
      { name: 'Set Routing Instance',
        set: `set routing-instances ${V} instance-type virtual-router\nset routing-instances ${V} interface ${IF}.${U}\nset routing-instances ${V} protocols bgp group CE neighbor ${NB} peer-as \${Peer AS}\nset routing-instances ${V} protocols bgp group CE import ${V}-IMPORT\nset routing-instances ${V} protocols bgp group CE export ${V}-EXPORT${JCOMMIT}`,
        rules: [rule('commit complete', 'Contains'), rule('error')],
        rollback: `delete routing-instances ${V}${JCOMMIT}`, timeoutMs: 120000, breaker: true },
    ] },
    { name: 'Post Validation', kind: 'Post validation', tasks: [
      { name: 'Check Interface configuration', set: `show configuration | display set | match ${IF}`,
        rules: [rule('error'), rule('invalid'), rule(`set interfaces ${IF} unit ${U} vlan-id ${U}`, 'Contains'), rule(`set routing-instances ${V} interface ${IF}.${U}`, 'Contains')] },
      { name: 'Check Routing Instance', set: `show bgp summary instance ${V}`, rules: [rule('Establ', 'Contains')], retry: true, timeoutMs: 90000 },
      { name: 'Check Import Policy Configuration', set: showSet(`policy-options policy-statement ${V}-IMPORT`), rules: [rule('${Customer prefix}', 'Contains')] },
      { name: 'Check Export Policy Configuration', set: showSet(`policy-options policy-statement ${V}-EXPORT`), rules: [rule(`${V}-EXPORT term 1`, 'Contains')] },
      { name: 'Check DNS Reachability', set: `ping 8.8.8.8 routing-instance ${V} count 3`, rules: [rule('0% packet loss', 'Contains')], retry: true },
    ] },
  ]
}

/* ---- IBW | Static | * | JUNIPER  (Pre validation 5 · Set service configuration 3 · Post Validation 3, from the builder screenshot) */
function ibwStaticJuniper(): StageSeed[] {
  const bgp = ibwBgpJuniper()
  return [
    { name: 'Pre validation', kind: 'Pre validation', tasks: [
      { name: 'Check routing-instances', set: showSet(`routing-instances ${V}`), rules: [rule('error')] },
      { name: 'Check interface configuration', set: showSet(`interfaces ${IF} unit ${U}`), rules: [rule(`unit ${U}`), rule('error')] },
      { name: 'Check policer', set: showSet('firewall policer POLICER-${Bandwidth}M'), rules: [rule('error')] },
      bgp[0].tasks[4], bgp[0].tasks[5],
    ] },
    { name: 'Set service configuration', kind: 'Configuration', tasks: [
      { ...bgp[1].tasks[0], name: 'Set interface configuration' },
      bgp[1].tasks[1],
      { name: 'Set routing-instance configuration',
        set: `set routing-instances ${V} instance-type virtual-router\nset routing-instances ${V} interface ${IF}.${U}\nset routing-instances ${V} routing-options static route \${Customer prefix} next-hop ${NB}${JCOMMIT}`,
        rules: [rule('commit complete', 'Contains'), rule('error')],
        rollback: `delete routing-instances ${V}${JCOMMIT}`, timeoutMs: 120000, breaker: true },
    ] },
    { name: 'Post Validation', kind: 'Post validation', tasks: [
      { name: 'Check Interface Configuration', set: `show configuration | display set | match ${IF}`,
        rules: [rule('error'), rule('invalid'), rule(`set interfaces ${IF} unit ${U} vlan-id ${U}`, 'Contains'), rule(`set interfaces ${IF} unit ${U} family inet address`, 'Contains'), rule(`set routing-instances ${V} interface ${IF}.${U}`, 'Contains')] },
      { name: 'Check routing instance', set: `show route table ${V}.inet.0 \${Customer prefix}`, rules: [rule('${Customer prefix}', 'Contains')], retry: true },
      { name: 'Check Policy Configuration', set: `show configuration policy-options | display set | match ${V}`, rules: [rule(`${V}-IMPORT`, 'Contains'), rule(`${V}-EXPORT`, 'Contains')] },
    ] },
  ]
}

/* ---- IBW | * | CISCO — the Juniper sequences on IOS-XR vocabulary */
function ibwCisco(type: string): StageSeed[] {
  const bgp = /bgp/i.test(type)
  const routing = bgp
    ? `router bgp 65001\n vrf ${V}\n  neighbor ${NB}\n   remote-as \${Peer AS}\n   address-family ipv4 unicast\n    route-policy ${V}-IN in\n    route-policy ${V}-OUT out`
    : `router static\n vrf ${V}\n  address-family ipv4 unicast\n   \${Customer prefix} ${NB}`
  return [
    { name: 'Pre Validation', kind: 'Pre validation', tasks: [
      { name: 'Check Interface Status', set: `show interfaces ${IF} brief`, rules: [rule('up', 'Contains'), rule('admin-down')] },
      { name: 'Check VRF', set: `show running-config vrf ${V}`, rules: [rule('Invalid input')] },
      { name: 'Check Policy-map', set: 'show running-config policy-map PM-${Bandwidth}M', rules: [rule('Invalid input')] },
      { name: 'Check Interface Configuration', set: `show running-config interface ${IF}.${U}`, rules: [rule(`interface ${IF}.${U}`), rule('Invalid input')] },
      { name: 'Check Import Route-Policy', set: `show running-config route-policy ${V}-IN`, rules: [rule('Invalid input')] },
      { name: 'Check Export Route-Policy', set: `show running-config route-policy ${V}-OUT`, rules: [rule('Invalid input')] },
    ] },
    { name: 'Set Service Configuration', kind: 'Configuration', tasks: [
      { name: 'Set Interface Configuration',
        set: `interface ${IF}.${U}\n description \${Description}\n vrf ${V}\n encapsulation dot1q ${U}\n ipv4 address \${Interface IP}\n service-policy input PM-\${Bandwidth}M`,
        rollback: `no interface ${IF}.${U}` },
      { name: 'Set Policy Configuration',
        set: `policy-map PM-\${Bandwidth}M\n class class-default\n  police rate \${Bandwidth} mbps\n!\nprefix-set ${V}-PREFIXES\n \${Customer prefix} le 32\nend-set\nroute-policy ${V}-IN\n if destination in ${V}-PREFIXES then pass else drop endif\nend-policy\nroute-policy ${V}-OUT\n pass\nend-policy`,
        rollback: `no route-policy ${V}-IN\nno route-policy ${V}-OUT\nno prefix-set ${V}-PREFIXES\nno policy-map PM-\${Bandwidth}M` },
      { name: bgp ? 'Set BGP Configuration' : 'Set Static Route',
        set: `vrf ${V}\n address-family ipv4 unicast\n!\n${routing}${XCOMMIT}`,
        rules: [rule('Failed'), rule('error')],
        rollback: `no vrf ${V}${XCOMMIT}`, timeoutMs: 120000, breaker: true },
    ] },
    { name: 'Post Validation', kind: 'Post validation', tasks: [
      { name: 'Check Interface configuration', set: `show running-config interface ${IF}.${U}`, rules: [rule('Invalid input'), rule(`vrf ${V}`, 'Contains'), rule(`encapsulation dot1q ${U}`, 'Contains')] },
      { name: 'Check Route', set: `show route vrf ${V} \${Customer prefix}`, rules: [rule('${Customer prefix}', 'Contains'), rule('not in table')], retry: true },
      { name: 'Check Import Route-Policy', set: `show running-config route-policy ${V}-IN`, rules: [rule(`${V}-PREFIXES`, 'Contains')] },
      { name: 'Check Export Route-Policy', set: `show running-config route-policy ${V}-OUT`, rules: [rule('pass', 'Contains')] },
      { name: 'Check DNS Reachability', set: `ping vrf ${V} 8.8.8.8 count 3`, rules: [rule('Success rate is 100 percent', 'Contains')], retry: true },
    ] },
  ]
}

/* -------------------------------------------------------------- picker */

/** The platform workflow for a profile + vendor. `role` only affects naming; both ends run the same sequence. */
export function templateFor(category: Category, vendor: Vendor, type: string, _role?: EndpointRole, subtype = '') {
  const seeds =
    category === 'L2VPN' ? (vendor === 'JUNIPER' ? l2vpnJuniper(subtype) : l2vpnCisco(subtype))
      : category === 'L3VPN' ? (vendor === 'JUNIPER' ? (/hub/i.test(type) ? l3vpnHubSpokeJuniper() : l3vpnMeshJuniper()) : l3vpnCisco(type))
        : (vendor === 'JUNIPER' ? (/bgp|ospf|vrf/i.test(type) ? ibwBgpJuniper() : ibwStaticJuniper()) : ibwCisco(type))
  return materialise(seeds)
}

/** Empty three-stage skeleton for a brand-new workflow. */
export function emptyStages(): WorkflowStage[] {
  return (['Pre Validation', 'Set Service Configuration', 'Post Validation'] as const).map((name, i) => {
    stageSeq += 1
    const kind: StageKind = i === 0 ? 'Pre validation' : i === 1 ? 'Configuration' : 'Post validation'
    return { id: `STG-${pad(stageSeq, 6)}`, name, displayName: name, kind, sequence: i + 1 }
  })
}

export function newRule(join: 'And' | 'Or' = 'And', type: ValidationType = 'Not contains', text = ''): ValidationRule {
  ruleSeq += 1
  return { id: `VR-${pad(ruleSeq, 6)}`, join, text, type }
}

export function newStage(name: string, kind: StageKind, sequence: number): WorkflowStage {
  stageSeq += 1
  return { id: `STG-${pad(stageSeq, 6)}`, name, displayName: name, kind, sequence }
}

export function newTask(stage: WorkflowStage, sequence: number): WorkflowTaskDef {
  taskSeq += 1
  const write = stage.kind === 'Configuration'
  return {
    id: `TSK-${pad(taskSeq, 6)}`, name: '', displayName: '', sequence,
    stageId: stage.id, stage: stage.displayName, stageKind: stage.kind, kind: write ? 'write' : 'read',
    setCommand: '', validations: [newRule('And', 'Not contains', 'error')],
    inverseCommand: undefined, rollbackValidations: [],
    skipAllowed: false, manualCompleteAllowed: false, rollbackEnabled: write, rollbackBreaker: write, retryAllowed: !write,
    timeoutMs: 50000, delayMs: undefined,
  }
}

/** Every `${Parameter}` referenced by a command. */
export function paramsIn(text: string | undefined): string[] {
  if (!text) return []
  const out = new Set<string>()
  for (const m of text.matchAll(/\$\{([^}]+)\}/g)) out.add(m[1])
  return [...out]
}

/** Render `${Parameter}` placeholders from a name→value map; unknown names are left as-is. */
export function renderCommand(text: string, values: Record<string, string>): string {
  return text.replace(/\$\{([^}]+)\}/g, (m, k: string) => (k in values ? values[k] : m))
}

/** Parameters the request detail renders for each category — the vocabulary a command may use. */
export const KNOWN_PARAMS: Record<Category, string[]> = {
  L2VPN: ['Interface', 'Vlan-ID', 'Neighbor IP', 'Description', 'Bandwidth', 'Xconnect group', 'VC ID'],
  L3VPN: ['Interface', 'Vlan-ID', 'Neighbor IP', 'Description', 'Bandwidth', 'VRF', 'RD', 'RT', 'Interface IP', 'Peer AS'],
  IBW: ['Interface', 'Vlan-ID', 'Neighbor IP', 'Description', 'Bandwidth', 'VRF', 'Interface IP', 'Customer prefix', 'Peer AS'],
}
