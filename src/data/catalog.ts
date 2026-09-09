import type {
  AcceptanceCriterion, Category, DeviceKind, IntentParam, ProfileType, ServiceIntent, Vendor,
} from '@/types'

/* ---------- deterministic RNG so every reload shows the same data ---------- */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const rnd = mulberry32(20260903)
export const pick = <T,>(arr: readonly T[], r = rnd): T => arr[Math.floor(r() * arr.length)]
export const between = (lo: number, hi: number, r = rnd) => lo + Math.floor(r() * (hi - lo + 1))
export const pad = (n: number, w: number) => String(n).padStart(w, '0')

/* ---------- accounts ---------- */
export interface Account { id: string; name: string; segment: string }
export const ACCOUNTS: Account[] = [
  { id: 'ACC-04417', name: 'Excitel Business Solutions', segment: 'ISP' },
  { id: 'ACC-00218', name: 'RailTel Corporation', segment: 'Government' },
  { id: 'ACC-00031', name: 'Bharti Airtel Enterprise', segment: 'Carrier' },
  { id: 'ACC-01186', name: 'Karnataka State Data Centre', segment: 'Government' },
  { id: 'ACC-02290', name: 'Sify Technologies', segment: 'Enterprise' },
  { id: 'ACC-03104', name: 'Tata Communications', segment: 'Carrier' },
  { id: 'ACC-05512', name: 'Hathway Cable', segment: 'ISP' },
  { id: 'ACC-06001', name: 'Kerala Vision Broadband', segment: 'ISP' },
  { id: 'ACC-07219', name: 'Nxtra Data Centres', segment: 'Enterprise' },
  { id: 'ACC-08840', name: 'Maharashtra Police Network', segment: 'Government' },
]

/* ---------- sites and devices ---------- */
export interface Site { code: string; city: string; region: string }
export const SITES: Site[] = [
  { code: 'DL-BLR-0412', city: 'Bengaluru', region: 'South' },
  { code: 'DL-BLR-0977', city: 'Bengaluru', region: 'South' },
  { code: 'KA-BGLK-0277', city: 'Bengaluru', region: 'South' },
  { code: 'KA-MYS-0044', city: 'Mysuru', region: 'South' },
  { code: 'MH-PUN-1140', city: 'Pune', region: 'West' },
  { code: 'MH-MUM-0301', city: 'Mumbai', region: 'West' },
  { code: 'TN-CHN-0805', city: 'Chennai', region: 'South' },
  { code: 'TN-CBE-0212', city: 'Coimbatore', region: 'South' },
  { code: 'KL-KOC-0119', city: 'Kochi', region: 'South' },
  { code: 'UP-LKO-0331', city: 'Lucknow', region: 'North' },
  { code: 'UP-KNP-0208', city: 'Kanpur', region: 'North' },
  { code: 'DL-NOI-0155', city: 'Noida', region: 'North' },
  { code: 'WB-KOL-0620', city: 'Kolkata', region: 'East' },
  { code: 'GJ-AMD-0733', city: 'Ahmedabad', region: 'West' },
]

export interface DeviceModel { vendor: Vendor; model: string; kind: DeviceKind; os: string; osRange: string; ports: string[] }
/**
 * The vendor estate this platform provisions against. Router-class devices
 * carry BGP/VRF/L3 routing and can serve any intent; Switch-class devices are
 * Ethernet/VLAN-only, so they only ever appear under the L2VPN family — see
 * `ROUTER_VENDORS` / `SWITCH_VENDORS` below and their use in workflows.ts.
 */
export const DEVICE_MODELS: DeviceModel[] = [
  { vendor: 'CISCO', model: 'ASR9006', kind: 'Router', os: 'IOS-XR 7.9.2', osRange: '7.3 – 7.11', ports: ['TenGigE0/0/0/3', 'TenGigE0/0/0/6', 'TenGigE0/0/0/9', 'TenGigE0/0/0/12'] },
  { vendor: 'CISCO', model: 'NCS-540', kind: 'Router', os: 'IOS-XR 7.8.1', osRange: '7.3 – 7.11', ports: ['TenGigE0/0/0/1', 'TenGigE0/0/0/4', 'GigabitEthernet0/0/0/2'] },
  { vendor: 'JUNIPER', model: 'MX204', kind: 'Router', os: 'JunOS 22.4R3', osRange: '21.4R – 23.4R', ports: ['xe-0/0/3', 'xe-0/0/9', 'xe-1/1/0', 'ge-0/0/4'] },
  { vendor: 'JUNIPER', model: 'ACX2200', kind: 'Router', os: 'JunOS 21.4R1', osRange: '21.2R – 22.4R', ports: ['xe-0/0/0', 'xe-0/0/2', 'ge-0/0/6'] },
  { vendor: 'NOKIA', model: '7750 SR-1', kind: 'Router', os: 'SR OS 23.7.R1', osRange: '22.10 – 23.10', ports: ['1/1/c1/1', '1/1/c2/1', '1/1/c3/1'] },
  { vendor: 'NOKIA', model: '7750 SR-2s', kind: 'Router', os: 'SR OS 23.7.R1', osRange: '22.10 – 23.10', ports: ['1/1/1', '1/1/4', '1/1/7'] },
  { vendor: 'ADVA', model: 'FSP 150-XG480', kind: 'Router', os: 'ADVA OS 12.4', osRange: '11.6 – 12.4', ports: ['NET-1', 'NET-2', 'ACC-1'] },
  { vendor: 'TEJAS', model: 'TJ1400', kind: 'Router', os: 'TejNMS 9.2', osRange: '8.4 – 9.2', ports: ['GE-1/1', 'GE-1/2', 'TenGE-2/1'] },
  { vendor: 'TECHROUTE', model: 'TR-2500', kind: 'Router', os: 'TR-OS 4.1', osRange: '3.6 – 4.1', ports: ['eth-1/1', 'eth-1/2', 'eth-2/1'] },
  { vendor: 'EDGECORE', model: 'AS7726-32X', kind: 'Switch', os: 'SONiC 4.2', osRange: '4.0 – 4.2', ports: ['Ethernet4', 'Ethernet8', 'Ethernet12'] },
  { vendor: 'EDGECORE', model: 'AS4630-54PE', kind: 'Switch', os: 'SONiC 4.1', osRange: '4.0 – 4.2', ports: ['Ethernet1', 'Ethernet5', 'Ethernet9'] },
  { vendor: 'DLINK', model: 'DGS-3630-28TC', kind: 'Switch', os: 'D-Link OS 3.00', osRange: '2.90 – 3.00', ports: ['1/0/1', '1/0/5', '1/0/9'] },
  { vendor: 'DLINK', model: 'DXS-3600-32S', kind: 'Switch', os: 'D-Link OS 3.00', osRange: '2.90 – 3.00', ports: ['1/0/2', '1/0/6', '1/0/10'] },
]

/** Only Router-class devices run BGP/VRF, so only these can serve L3VPN/IBW. */
export const ROUTER_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'Router').map((d) => d.vendor))]
/** Switch-class devices are Ethernet/VLAN-only — L2VPN is the only family they can carry. */
export const SWITCH_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'Switch').map((d) => d.vendor))]
/** The device estate eligible for a given service category. */
export const modelsForCategory = (category: Category): DeviceModel[] =>
  category === 'L2VPN' ? DEVICE_MODELS : DEVICE_MODELS.filter((d) => d.kind === 'Router')

/* ---------- intent catalog ---------- */

const l2p2pParams: IntentParam[] = [
  { name: 'encapsulation', type: 'enum', constraint: 'transparent | tagged', modifiable: 'recreate', options: ['transparent', 'tagged'], default: 'tagged', required: true },
  { name: 'vlan', type: 'integer', constraint: '2–4094 · from pool · unique per port', modifiable: 'no', fromPool: 'VLAN', min: 2, max: 4094, required: true },
  { name: 'mtu', type: 'integer', constraint: '1500–9192 · equal at both ends', modifiable: 'bounce', min: 1500, max: 9192, default: 1500, required: true },
  { name: 'bandwidth_mbps', type: 'integer', constraint: '1–10000 · must fit port headroom', modifiable: 'hitless', min: 1, max: 10000, default: 100, required: true },
  { name: 'control_word', type: 'boolean', constraint: 'default true', modifiable: 'bounce', default: true, required: false },
  { name: 'pw_id', type: 'integer', constraint: 'pool-allocated · never entered by hand', modifiable: 'no', fromPool: 'Pseudowire ID', required: true },
]

const l2p2pAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'Both sub-interfaces are admin-up and oper-up', layer: 'device', expected: 'admin=up, link=up on both ends' },
  { id: 'AC-2', claim: 'Pseudowire is Up at both ends with a matching vc-id', layer: 'device', expected: 'state=Up, vc-id matched' },
  { id: 'AC-3', claim: 'MPLS LSP to the remote PE resolves', layer: 'network', expected: 'received >= 4 of 5 echoes' },
  { id: 'AC-4', claim: '1500-byte frame crosses CE to CE with no loss', layer: 'service', expected: 'loss = 0/20, mtu = 1500' },
  { id: 'AC-5', claim: 'Measured throughput is within ±5% of the ordered rate', layer: 'service', expected: 'within tolerance band' },
]

const ibwParams: IntentParam[] = [
  { name: 'bandwidth_mbps', type: 'integer', constraint: '1–10000', modifiable: 'hitless', min: 1, max: 10000, default: 100, required: true },
  { name: 'routing', type: 'enum', constraint: 'BGP | Static | OSPF', modifiable: 'recreate', options: ['BGP', 'Static', 'OSPF'], default: 'BGP', required: true },
  { name: 'customer_asn', type: 'integer', constraint: '64512–65534 private, or public ASN', modifiable: 'bounce', min: 1, max: 4294967295, required: true },
  { name: 'prefix_limit', type: 'integer', constraint: '1–5000', modifiable: 'hitless', min: 1, max: 5000, default: 500, required: true },
  { name: 'ip_block', type: 'ipv4', constraint: '/30 or /31 from the WAN pool', modifiable: 'no', fromPool: 'IP block', required: true },
]

const ibwAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'Sub-interface is admin-up and oper-up', layer: 'device', expected: 'admin=up, link=up' },
  { id: 'AC-2', claim: 'BGP session reaches Established', layer: 'device', expected: 'state=Established' },
  { id: 'AC-3', claim: 'At least one prefix received from the customer', layer: 'network', expected: 'received > 0' },
  { id: 'AC-4', claim: 'Measured throughput within ±5% of the ordered rate', layer: 'service', expected: 'within tolerance band' },
]

const l3Params: IntentParam[] = [
  { name: 'pe_ce_protocol', type: 'enum', constraint: 'BGP | OSPF | Static', modifiable: 'bounce', options: ['BGP', 'OSPF', 'Static'], default: 'BGP', required: true },
  { name: 'customer_asn', type: 'integer', constraint: 'customer-side ASN', modifiable: 'bounce', required: true },
  { name: 'rd', type: 'string', constraint: 'pool-allocated route distinguisher', modifiable: 'no', fromPool: 'RD/RT', required: true },
  { name: 'rt_import', type: 'string', constraint: 'pool-allocated route target', modifiable: 'no', fromPool: 'RD/RT', required: true },
  { name: 'rt_export', type: 'string', constraint: 'pool-allocated route target', modifiable: 'no', fromPool: 'RD/RT', required: true },
  { name: 'prefix_limit', type: 'integer', constraint: '1–10000', modifiable: 'hitless', min: 1, max: 10000, default: 1000, required: true },
]

const l3Acceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'VRF exists on every PE in the service', layer: 'device', expected: 'vrf present on all PEs' },
  { id: 'AC-2', claim: 'PE-CE protocol is up at every site', layer: 'device', expected: 'all sessions Established' },
  { id: 'AC-3', claim: 'Route targets import and export as designed', layer: 'network', expected: 'RT policy matches intent' },
  { id: 'AC-4', claim: 'Any spoke reaches the hub, CE to CE', layer: 'service', expected: 'loss = 0/20 from each spoke' },
]

export const INTENTS: ServiceIntent[] = [
  {
    id: 'INT-IBW-ACCESS', name: 'IBW Internet Access', category: 'IBW', type: 'Internet Access',
    topology: 'Single-ended', endpointArity: 'exactly 1', params: ibwParams,
    pools: ['IP block', 'Sub-interface', 'ASN slot'], acceptance: ibwAcceptance, version: 3, liveServices: 1697,
  },
  {
    id: 'INT-L2-P2P', name: 'L2VPN Point-to-point', category: 'L2VPN', type: 'Transparent',
    topology: 'Two-ended', endpointArity: 'exactly 2', params: l2p2pParams,
    pools: ['VLAN', 'Pseudowire ID', 'Sub-interface'], acceptance: l2p2pAcceptance, version: 4, liveServices: 431,
  },
  {
    id: 'INT-L2-RAILWIRE', name: 'L2VPN Railwire', category: 'L2VPN', type: 'Railwire',
    topology: 'Two-ended', endpointArity: 'exactly 2',
    params: [
      { name: 'vlan', type: 'integer', constraint: '2–4094 · from pool', modifiable: 'no', fromPool: 'VLAN', min: 2, max: 4094, required: true },
      { name: 'bng_aggregate', type: 'string', constraint: 'BNG aggregate interface', modifiable: 'bounce', required: true },
      { name: 'pw_mode', type: 'enum', constraint: 'raw | tagged | pseudo', modifiable: 'recreate', options: ['raw', 'tagged', 'pseudo'], default: 'tagged', required: true },
      { name: 'mtu', type: 'integer', constraint: '1500–9192', modifiable: 'bounce', min: 1500, max: 9192, default: 1500, required: true },
    ],
    pools: ['VLAN', 'Pseudowire ID'], acceptance: l2p2pAcceptance.slice(0, 4), version: 1, liveServices: 181,
  },
  {
    id: 'INT-L3-HUBSPOKE', name: 'L3VPN Hub & Spoke', category: 'L3VPN', type: 'Hub & Spoke',
    topology: 'Star', endpointArity: '1 hub + 1…n spokes', params: l3Params,
    pools: ['RD/RT', 'IP block', 'Sub-interface'], acceptance: l3Acceptance, version: 2, liveServices: 96,
  },
  {
    id: 'INT-L3-MESH', name: 'L3VPN Any-to-any', category: 'L3VPN', type: 'Fully-Mesh',
    topology: 'Full mesh', endpointArity: '2…n', params: l3Params,
    pools: ['RD/RT', 'IP block', 'Sub-interface'], acceptance: l3Acceptance, version: 1, liveServices: 52,
  },
]

export const intentById = (id: string) => INTENTS.find((i) => i.id === id)!

/* ---------- profile type master ---------- */

/* Profile type master — Category → Type → Subtype, as configured on the platform.
   Subtype / Type / Category / Description / Creator, in the platform's own words. */
const PROFILE_ROWS: Array<[Category, string, string, string, string]> = [
  // L2VPN
  ['L2VPN', 'Other', 'Other', 'L2VPN profile for standard Layer 2 VPN services.', 'Jayesh'],
  ['L2VPN', 'Railwire', 'Untagged', 'L2VPN Railwire profile for Untagged Layer 2 VPN connectivity.', 'Jayesh'],
  ['L2VPN', 'Transparent', 'Untagged', 'L2VPN Transparent profile for Untagged Layer 2 VPN connectivity.', 'Jayesh'],
  ['L2VPN', 'VLAN', 'Tagged', 'L2VPN VLAN profile for Tagged Layer 2 VPN connectivity.', 'Jayesh'],
  ['L2VPN', 'Railwire', 'Tagged', 'L2VPN Railwire profile for Tagged Layer 2 VPN connectivity.', 'Jayesh'],
  ['L2VPN', 'Transparent', 'Tagged', 'L2VPN Transparent profile for Tagged Layer 2 VPN connectivity.', 'Jayesh'],
  ['L2VPN', 'Railwire', 'Other', 'L2VPN profile for Railwire Layer 2 VPN services.', 'Jayesh'],
  ['L2VPN', 'Transparent', 'Other', 'L2VPN profile for Transparent Layer 2 VPN services.', 'Jayesh'],
  ['L2VPN', 'VLAN', 'Other', 'L2VPN profile for VLAN-based Layer 2 VPN services.', 'Jayesh'],
  // L3VPN
  ['L3VPN', 'Fully-Mesh', 'Other', 'L3VPN Fully-Mesh profile for standard Layer 3 VPN connectivity.', 'Jayesh'],
  ['L3VPN', 'Fully-Mesh', 'Static', 'L3VPN Fully-Mesh profile for static connectivity.', 'Jayesh'],
  ['L3VPN', 'Fully-Mesh', 'OSPF', 'L3VPN Fully-Mesh profile for OSPF-based connectivity.', 'Jayesh'],
  ['L3VPN', 'Fully-Mesh', 'BGP', 'L3VPN Fully-Mesh profile for BGP-based connectivity.', 'Jayesh'],
  ['L3VPN', 'Fully-Mesh VRF', 'VRF', 'L3VPN Fully-Mesh VRF profile for Virtual Routing and Forwarding services.', 'Jayesh'],
  ['L3VPN', 'Hub & Spoke VRF', 'VRF', 'L3VPN Hub and Spoke VRF profile for Virtual Routing and Forwarding services.', 'Jayesh'],
  ['L3VPN', 'Hub & Spoke', 'Static', 'L3VPN Hub and Spoke profile for static connectivity.', 'Jayesh'],
  ['L3VPN', 'Hub & Spoke', 'OSPF', 'L3VPN Hub and Spoke profile for OSPF-based connectivity.', 'Jayesh'],
  ['L3VPN', 'Hub & Spoke', 'BGP', 'L3VPN Hub and Spoke profile for BGP-based connectivity.', 'Jayesh'],
  ['L3VPN', 'Hub & Spoke', 'Other', 'L3VPN Hub and Spoke profile for standard Layer 3 VPN connectivity.', 'Jayesh'],
  ['L3VPN', 'Other', 'Other', 'L3VPN profile for standard Layer 3 VPN services.', 'Jayesh'],
  // IBW
  ['IBW', 'Static', 'Vlan', 'IBW Static VLAN-based provisioning for configuring customer interfaces.', 'Raj'],
  ['IBW', 'VRF', 'IPv6', 'IBW VRF profile for IPv6-based Virtual Routing and Forwarding services.', 'Jayesh'],
  ['IBW', 'VRF', 'Other', 'IBW VRF profile for standard Virtual Routing and Forwarding services.', 'Jayesh'],
  ['IBW', 'VRF', 'IPv4', 'IBW VRF profile for IPv4-based Virtual Routing and Forwarding services.', 'Jayesh'],
  ['IBW', 'OSPF', 'Other', 'IBW OSPF profile for OSPF-based Internet Bandwidth connectivity.', 'Jayesh'],
  ['IBW', 'BGP', 'Other', 'IBW BGP profile for BGP-based Internet Bandwidth connectivity.', 'Jayesh'],
  ['IBW', 'Static', 'Other', 'IBW Static profile for static Internet Bandwidth connectivity.', 'Jayesh'],
  ['IBW', 'Other', 'Other', 'IBW profile for standard Internet Bandwidth services.', 'Jayesh'],
]

export const PROFILE_TYPES: ProfileType[] = PROFILE_ROWS.map(([category, type, subtype, description, creator], i) => ({
  id: `PT-${pad(i + 1, 3)}`,
  category, type, subtype, description, creator,
  createdAt: new Date(2025, 8 + (i % 10), 3 + (i % 22)).toISOString(),
  usedByWorkflows: 0, // filled once workflows are built
}))

export const VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.map((d) => d.vendor))]
export const CATEGORIES: Category[] = ['L2VPN', 'L3VPN', 'IBW']
