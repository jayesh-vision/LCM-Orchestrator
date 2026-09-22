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
  { id: 'ACC-06001', name: 'Kerala Vision Networks', segment: 'ISP' },
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
  /* Access domain — residential/business gateways (ONT/CPE), a separate
     estate from the Transport vendors above; never bound to a Transport intent. */
  { vendor: 'HUAWEI', model: 'EG8145V5', kind: 'CPE', os: 'HW CPE FW 5.2', osRange: '5.0 – 5.2', ports: ['LAN1', 'LAN2', 'WAN'] },
  { vendor: 'ZTE', model: 'ZXHN F670L', kind: 'CPE', os: 'ZTE CPE FW 3.1', osRange: '2.9 – 3.1', ports: ['LAN1', 'LAN2', 'WAN'] },
  { vendor: 'ADTRAN', model: '411', kind: 'CPE', os: 'Adtran OS 6.4', osRange: '6.0 – 6.4', ports: ['LAN1', 'LAN2', 'WAN'] },
  /* Radio domain — point-to-point microwave backhaul units. A disjoint
     estate again; a radio has no BGP/VLAN vocabulary at all. */
  { vendor: 'CERAGON', model: 'IP-20C', kind: 'Radio', os: 'CeraOS 10.9', osRange: '10.4 – 10.9', ports: ['RF-1', 'GE-1', 'GE-2'] },
  { vendor: 'AVIAT', model: 'WTM 4000', kind: 'Radio', os: 'Aviat OS 6.1', osRange: '5.8 – 6.1', ports: ['RF-1', 'ETH-1'] },
  { vendor: 'NEC', model: 'iPASOLINK VR', kind: 'Radio', os: 'NEC OS 4.3', osRange: '4.0 – 4.3', ports: ['RF-1', 'GE-1'] },
  /* DWDM (Transport domain) — optical transponders/ROADMs carrying
     wavelength circuits. A disjoint estate again; an optical port has no
     VLAN/BGP vocabulary. */
  { vendor: 'CIENA', model: '6500-D8', kind: 'Optical', os: 'SAOS 10.2', osRange: '9.8 – 10.2', ports: ['TRANSPONDER-1', 'TRANSPONDER-2', 'LINE-1'] },
  { vendor: 'INFINERA', model: 'GX G30', kind: 'Optical', os: 'GX OS 6.4', osRange: '6.0 – 6.4', ports: ['CLIENT-1', 'CLIENT-2', 'LINE-1'] },
  { vendor: 'ECI', model: 'Apollo ODM', kind: 'Optical', os: 'ECI NPT 5.1', osRange: '4.8 – 5.1', ports: ['TRANSPONDER-1', 'LINE-1'] },
  /* Radio domain, RAN VNF category — O-RAN CU/DU virtualized network
     functions. No physical port at all; "ports" here are the O-RAN
     interface names the workflow templates render commands against
     (F1 between CU and DU, E1 between CU-CP/CU-UP, NG to the 5G core,
     Xn to neighbour gNBs). A disjoint vendor estate again. */
  { vendor: 'MAVENIR', model: 'OpenRAN vRAN 4.2', kind: 'VNF', os: 'Mavenir CNF 4.2', osRange: '4.0 – 4.2', ports: ['F1', 'E1', 'NG', 'Xn'] },
  { vendor: 'SAMSUNG', model: 'vRAN CU/DU 3.0', kind: 'VNF', os: 'Samsung vRAN 3.0', osRange: '2.8 – 3.0', ports: ['F1', 'E1', 'NG'] },
  { vendor: 'RADISYS', model: 'Engage vRAN', kind: 'VNF', os: 'Radisys CNF 2.5', osRange: '2.2 – 2.5', ports: ['F1', 'E1', 'NG'] },
  /* Fiber domain, GPON category — the OLT head-end. Not an endpoint itself
     (the ONT below is), but its own device class: a PON port on one of these
     chassis is what an ONT's fibre actually terminates on. */
  { vendor: 'NOKIA', model: 'ISAM FX-16', kind: 'OLT', os: 'Nokia ISAM 24.3', osRange: '23.6 – 24.3', ports: ['PON 1/1/1', 'PON 1/1/2', 'PON 1/1/3', 'PON 1/1/4'] },
  { vendor: 'HUAWEI', model: 'MA5800-X7', kind: 'OLT', os: 'Huawei VRP 8.230', osRange: '8.190 – 8.230', ports: ['GPON 0/1/0', 'GPON 0/1/1', 'GPON 0/2/0'] },
  { vendor: 'ZTE', model: 'ZXA10 C300', kind: 'OLT', os: 'ZTE ZXROS 4.1', osRange: '3.9 – 4.1', ports: ['GPON-1/1', 'GPON-1/2', 'GPON-2/1'] },
  /* Fiber domain, GPON category — the ONT/ONU at the customer premises. This
     is the endpoint device on a GPON order, same convention as VLAN's
     CPE: single-ended, no far end to configure. Distinct models from the
     Access-domain CPE above — a GPON ONT speaks PON framing, not just
     Ethernet/WiFi, and is bound to a specific OLT PON port. */
  { vendor: 'NOKIA', model: 'G-240W-F', kind: 'ONT', os: 'Nokia ONT FW 3.62', osRange: '3.40 – 3.62', ports: ['PON', 'LAN1', 'LAN2', 'WAN'] },
  { vendor: 'HUAWEI', model: 'HG8245Q2', kind: 'ONT', os: 'Huawei ONT FW 5.1', osRange: '4.8 – 5.1', ports: ['PON', 'LAN1', 'LAN2', 'WAN'] },
  { vendor: 'ZTE', model: 'F660 v9', kind: 'ONT', os: 'ZTE ONT FW 2.4', osRange: '2.1 – 2.4', ports: ['PON', 'LAN1', 'LAN2', 'WAN'] },
]

/** Only Router-class devices run BGP/VRF, so only these can serve L3VPN/IBW. */
export const ROUTER_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'Router').map((d) => d.vendor))]
/** Switch-class devices are Ethernet/VLAN-only — L2VPN is the only Transport family they can carry. */
export const SWITCH_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'Switch').map((d) => d.vendor))]
/** CPE-class devices are the Access domain's estate — never eligible for a Transport intent. */
export const CPE_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'CPE').map((d) => d.vendor))]
/** Radio-class devices are the Radio domain's estate — microwave backhaul only. */
export const RADIO_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'Radio').map((d) => d.vendor))]
/** Optical-class devices are DWDM's estate — wavelength circuits only. */
export const OPTICAL_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'Optical').map((d) => d.vendor))]
/** VNF-class functions are the RAN VNF category's estate — CU/DU only, no physical device. */
export const VNF_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'VNF').map((d) => d.vendor))]
/** OLT-class chassis are the GPON category's head-end estate. */
export const OLT_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'OLT').map((d) => d.vendor))]
/** ONT-class terminals are GPON's endpoint device — the customer premises box a request actually binds to. */
export const ONT_VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.filter((d) => d.kind === 'ONT').map((d) => d.vendor))]
/** The device estate eligible for a given service category. */
export const modelsForCategory = (category: Category): DeviceModel[] => {
  if (category === 'VLAN') return DEVICE_MODELS.filter((d) => d.kind === 'CPE')
  if (category === 'Microwave') return DEVICE_MODELS.filter((d) => d.kind === 'Radio')
  if (category === 'RAN VNF') return DEVICE_MODELS.filter((d) => d.kind === 'VNF')
  if (category === 'DWDM') return DEVICE_MODELS.filter((d) => d.kind === 'Optical')
  /* GPON's endpoint device is the ONT — the OLT is the head-end it binds to
     (an `olt_id` intent param), not a second endpoint, same as how a
     VLAN order never models the BNG it terminates on. */
  if (category === 'GPON') return DEVICE_MODELS.filter((d) => d.kind === 'ONT')
  if (category === 'L2VPN') return DEVICE_MODELS.filter((d) => d.kind === 'Router' || d.kind === 'Switch')
  return DEVICE_MODELS.filter((d) => d.kind === 'Router')
}

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

/* ---------- Access domain: CPE / VLAN activation ---------- */

const cpeParams: IntentParam[] = [
  { name: 'ssid', type: 'string', constraint: '1–32 chars · unique per CPE', modifiable: 'hitless', required: true },
  { name: 'wifi_password', type: 'string', constraint: '8–63 chars · WPA2/WPA3', modifiable: 'hitless', required: true },
  { name: 'wan_vlan', type: 'integer', constraint: '2–4094 · from pool', modifiable: 'no', fromPool: 'VLAN', min: 2, max: 4094, required: true },
  { name: 'cpe_serial', type: 'string', constraint: 'pool-allocated · pre-provisioned stock', modifiable: 'no', fromPool: 'CPE Serial', required: true },
  { name: 'bandwidth_mbps', type: 'integer', constraint: '10–1000', modifiable: 'hitless', min: 10, max: 1000, default: 100, required: true },
]

const cpeAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'CPE registers on the access network with the bound serial', layer: 'device', expected: 'serial matches, state=Online' },
  { id: 'AC-2', claim: 'WiFi SSID broadcasts with the configured security mode', layer: 'device', expected: 'ssid visible, WPA2/WPA3 enabled' },
  { id: 'AC-3', claim: 'WAN interface obtains an address inside the assigned VLAN', layer: 'network', expected: 'DHCP/PPPoE bound, vlan matches' },
  { id: 'AC-4', claim: 'Measured downstream throughput is within ±10% of the ordered rate', layer: 'service', expected: 'within tolerance band' },
]

const ibwAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'Sub-interface is admin-up and oper-up', layer: 'device', expected: 'admin=up, link=up' },
  { id: 'AC-2', claim: 'BGP session reaches Established', layer: 'device', expected: 'state=Established' },
  { id: 'AC-3', claim: 'At least one prefix received from the customer', layer: 'network', expected: 'received > 0' },
  { id: 'AC-4', claim: 'Measured throughput within ±5% of the ordered rate', layer: 'service', expected: 'within tolerance band' },
]

/* ---------- Radio domain: point-to-point microwave backhaul ---------- */

const radioParams: IntentParam[] = [
  { name: 'frequency_band', type: 'enum', constraint: 'L6 | U6 | L7 | L8 | E-band', modifiable: 'recreate', options: ['L6', 'U6', 'L7', 'L8', 'E-band'], default: 'L7', required: true },
  { name: 'channel_bandwidth_mhz', type: 'enum', constraint: '7 | 14 | 28 | 40 | 56 MHz', modifiable: 'bounce', options: ['7', '14', '28', '40', '56'], default: '28', required: true },
  { name: 'modulation', type: 'enum', constraint: 'QPSK | 16QAM | 64QAM | 256QAM, adaptive', modifiable: 'hitless', options: ['QPSK', '16QAM', '64QAM', '256QAM'], default: '256QAM', required: true },
  { name: 'tx_power_dbm', type: 'integer', constraint: '0–30 dBm', modifiable: 'hitless', min: 0, max: 30, default: 20, required: true },
  { name: 'frequency_channel', type: 'string', constraint: 'pool-allocated · licensed frequency slot', modifiable: 'no', fromPool: 'Frequency Channel', required: true },
  { name: 'capacity_mbps', type: 'integer', constraint: '50–1000', modifiable: 'hitless', min: 50, max: 1000, default: 200, required: true },
]

const radioAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'Both radio units are admin-up and RF-up', layer: 'device', expected: 'admin=up, rf=up on both ends' },
  { id: 'AC-2', claim: 'Received signal level is within the planned link budget', layer: 'device', expected: 'RSL within ±3 dB of plan' },
  { id: 'AC-3', claim: 'Bit error rate stays below threshold over a sustained window', layer: 'network', expected: 'BER < 1e-9 over 15 min' },
  { id: 'AC-4', claim: 'Measured throughput is within ±5% of the ordered capacity', layer: 'service', expected: 'within tolerance band' },
]

/* ---------- Radio domain, RAN VNF category: O-RAN CU/DU lifecycle ---------- */
/* Single-ended, same as IBW — provisioning one VNF instance, not a link
   between two physical devices. CU and DU are separate intents: different
   configs, different interfaces (CU: NG to the core, F1 to the DU; DU: F1
   to the CU, cell activation), the same distinction the platform draws
   between the Transport intents rather than lumping them into one. */

const cuParams: IntentParam[] = [
  { name: 'plmn_id', type: 'string', constraint: 'MCC-MNC, e.g. 404-01', modifiable: 'recreate', required: true },
  { name: 'gnb_id', type: 'string', constraint: 'globally unique gNodeB identifier', modifiable: 'no', required: true },
  { name: 'amf_ip', type: 'ipv4', constraint: 'NG-C interface · pool-allocated', modifiable: 'no', fromPool: 'IP block', required: true },
  { name: 'f1_ip', type: 'ipv4', constraint: 'F1 interface, faces the DU · pool-allocated', modifiable: 'no', fromPool: 'IP block', required: true },
  { name: 'max_ue_capacity', type: 'integer', constraint: '500–5000 UEs', modifiable: 'hitless', min: 500, max: 5000, default: 2000, required: true },
]

const cuAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'CU VNF instance is running and healthy', layer: 'device', expected: 'state=Running, health=OK' },
  { id: 'AC-2', claim: 'NG interface to the 5G core AMF reaches Connected', layer: 'network', expected: 'ng-c state=Connected' },
  { id: 'AC-3', claim: 'F1 interface is up and ready to accept a DU', layer: 'network', expected: 'f1 state=Ready' },
  { id: 'AC-4', claim: 'RRC service is available within the configured UE capacity', layer: 'service', expected: 'rrc=Available, registered <= max_ue_capacity' },
]

const duParams: IntentParam[] = [
  { name: 'cu_f1_ip', type: 'ipv4', constraint: 'target CU\'s F1 interface address', modifiable: 'no', required: true },
  { name: 'pci', type: 'integer', constraint: '0–503 · pool-allocated, must not collide with a neighbour', modifiable: 'no', fromPool: 'PCI', min: 0, max: 503, required: true },
  { name: 'bandwidth_mhz', type: 'enum', constraint: '20 | 40 | 60 | 100 MHz', modifiable: 'bounce', options: ['20', '40', '60', '100'], default: '100', required: true },
  { name: 'tx_power_dbm', type: 'integer', constraint: '20–46 dBm', modifiable: 'hitless', min: 20, max: 46, default: 40, required: true },
]

const duAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'DU VNF instance is running and healthy', layer: 'device', expected: 'state=Running, health=OK' },
  { id: 'AC-2', claim: 'F1 interface to the CU reaches Established', layer: 'network', expected: 'f1 state=Established' },
  { id: 'AC-3', claim: 'Cell is activated and broadcasting on the assigned PCI', layer: 'network', expected: 'cell state=Active, pci matches' },
  { id: 'AC-4', claim: 'Measured cell throughput is within ±10% of the planned capacity for the bandwidth', layer: 'service', expected: 'within tolerance band' },
]

/* ---------- DWDM (Transport domain): wavelength circuit provisioning ---------- */

const dwdmParams: IntentParam[] = [
  { name: 'wavelength_channel', type: 'string', constraint: 'pool-allocated · ITU-T 100GHz grid', modifiable: 'no', fromPool: 'Wavelength', required: true },
  { name: 'otn_framing', type: 'enum', constraint: 'OTU2 | OTU4', modifiable: 'recreate', options: ['OTU2', 'OTU4'], default: 'OTU4', required: true },
  { name: 'protection', type: 'enum', constraint: 'Unprotected | Protected (1+1)', modifiable: 'recreate', options: ['Unprotected', 'Protected'], default: 'Unprotected', required: true },
  { name: 'capacity_gbps', type: 'integer', constraint: '10–400', modifiable: 'bounce', min: 10, max: 400, default: 100, required: true },
]

const dwdmAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'Both transponders are admin-up and the optical line is up', layer: 'device', expected: 'admin=up, line=up on both ends' },
  { id: 'AC-2', claim: 'Received optical power is within the span loss budget', layer: 'device', expected: 'Rx power within ±2 dB of plan' },
  { id: 'AC-3', claim: 'OTN frame achieves sync with no uncorrected errors', layer: 'network', expected: 'FEC locked, 0 uncorrectable errors' },
  { id: 'AC-4', claim: 'Measured throughput is within ±2% of the ordered capacity', layer: 'service', expected: 'within tolerance band' },
]

/* ---------- Fiber domain, GPON category: GPON/XGS-PON FTTH access ---------- */
/* Single-ended, same shape as VLAN's CPE activation — the ONT is the
   endpoint, the OLT it binds to is an identifying param, not a second
   endpoint (a subscriber's fibre has no "far end" to configure). */

const gponParams: IntentParam[] = [
  { name: 'olt_id', type: 'string', constraint: 'OLT chassis identifier, e.g. OLT-BLR-014', modifiable: 'no', required: true },
  { name: 'pon_port', type: 'string', constraint: 'pool-allocated · PON port + ONU-ID slot on that OLT', modifiable: 'no', fromPool: 'PON Port', required: true },
  { name: 'ont_serial', type: 'string', constraint: 'pool-allocated · pre-provisioned ONT stock', modifiable: 'no', fromPool: 'ONT Serial', required: true },
  { name: 'vlan', type: 'integer', constraint: '2–4094 · from pool', modifiable: 'no', fromPool: 'VLAN', min: 2, max: 4094, required: true },
  { name: 'tx_power_dbm', type: 'integer', constraint: 'OLT Tx, typically +1.5 to +5 dBm', modifiable: 'no', min: -5, max: 5, default: 3, required: false },
  { name: 'rx_power_dbm', type: 'integer', constraint: 'ONT Rx, must fall within -8 to -27 dBm per GPON budget', modifiable: 'no', min: -27, max: -8, default: -18, required: false },
  { name: 'bandwidth_profile', type: 'enum', constraint: 'DBA profile — committed/max rate pairing', modifiable: 'hitless', options: ['100M/50M', '300M/150M', '1G/500M'], default: '300M/150M', required: true },
  { name: 'bandwidth_mbps', type: 'integer', constraint: '10–1000', modifiable: 'hitless', min: 10, max: 1000, default: 300, required: true },
  { name: 'service_address', type: 'string', constraint: 'customer premises physical address', modifiable: 'no', required: true },
]

const gponAcceptance: AcceptanceCriterion[] = [
  { id: 'AC-1', claim: 'ONT registers on the assigned PON port with the bound serial', layer: 'device', expected: 'serial matches, state=Online' },
  { id: 'AC-2', claim: 'Received optical power at the ONT is within the GPON Rx budget', layer: 'device', expected: 'Rx power within -8 to -27 dBm' },
  { id: 'AC-3', claim: 'WAN interface obtains an address inside the assigned VLAN', layer: 'network', expected: 'DHCP/PPPoE bound, vlan matches' },
  { id: 'AC-4', claim: 'Measured downstream throughput is within ±10% of the bandwidth profile', layer: 'service', expected: 'within tolerance band' },
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
  /* Access domain — CPE/VLAN activation. Single-ended like IBW: one
     device, no far end. */
  {
    id: 'INT-ACCESS-RESIDENTIAL', name: 'VLAN — Residential Gateway', category: 'VLAN', type: 'Residential Gateway',
    topology: 'Single-ended', endpointArity: 'exactly 1', params: cpeParams,
    pools: ['VLAN', 'CPE Serial'], acceptance: cpeAcceptance, version: 1, liveServices: 200,
  },
  {
    id: 'INT-ACCESS-BUSINESS', name: 'VLAN — Business Gateway', category: 'VLAN', type: 'Business Gateway',
    topology: 'Single-ended', endpointArity: 'exactly 1', params: cpeParams,
    pools: ['VLAN', 'CPE Serial'], acceptance: cpeAcceptance, version: 1, liveServices: 60,
  },
  /* Radio domain — microwave backhaul. Two-ended: a link is always a pair
     of radio units, same shape as an L2VPN point-to-point circuit. */
  {
    id: 'INT-RADIO-PTP', name: 'Microwave Point-to-Point Link', category: 'Microwave', type: 'Point-to-Point',
    topology: 'Two-ended', endpointArity: 'exactly 2', params: radioParams,
    pools: ['Frequency Channel'], acceptance: radioAcceptance, version: 1, liveServices: 140,
  },
  /* DWDM (Transport domain) — wavelength circuits. Two-ended: a lambda
     always terminates on a transponder at each end. */
  {
    id: 'INT-FIBER-WAVELENGTH', name: 'DWDM Wavelength Circuit', category: 'DWDM', type: 'Wavelength Circuit',
    topology: 'Two-ended', endpointArity: 'exactly 2', params: dwdmParams,
    pools: ['Wavelength'], acceptance: dwdmAcceptance, version: 1, liveServices: 90,
  },
  /* Radio domain, RAN VNF category — CU and DU are separate VNF instances,
     each single-ended like IBW: one lifecycle-managed function, no far end. */
  {
    id: 'INT-RAN-CU', name: 'RAN CU Provisioning', category: 'RAN VNF', type: 'CU',
    topology: 'Single-ended', endpointArity: 'exactly 1', params: cuParams,
    pools: ['IP block'], acceptance: cuAcceptance, version: 1, liveServices: 42,
  },
  {
    id: 'INT-RAN-DU', name: 'RAN DU Provisioning', category: 'RAN VNF', type: 'DU',
    topology: 'Single-ended', endpointArity: 'exactly 1', params: duParams,
    pools: ['PCI'], acceptance: duAcceptance, version: 1, liveServices: 68,
  },
  /* Fiber domain, GPON category — single-ended, same shape as VLAN:
     the ONT is the endpoint, the OLT it binds to is a param. */
  {
    id: 'INT-GPON-RESI', name: 'GPON Residential Internet Access (FTTH)', category: 'GPON', type: 'GPON',
    topology: 'Single-ended', endpointArity: 'exactly 1', params: gponParams,
    pools: ['VLAN', 'ONT Serial', 'PON Port'], acceptance: gponAcceptance, version: 1, liveServices: 90,
  },
  {
    id: 'INT-XGSPON-BIZ', name: 'XGS-PON Business Internet Access', category: 'GPON', type: 'XGS-PON',
    topology: 'Single-ended', endpointArity: 'exactly 1', params: gponParams,
    pools: ['VLAN', 'ONT Serial', 'PON Port'], acceptance: gponAcceptance, version: 1, liveServices: 35,
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
  // VLAN (Access domain)
  ['VLAN', 'Residential Gateway', 'FTTH', 'VLAN Residential Gateway profile for fibre-to-the-home connectivity.', 'Jayesh'],
  ['VLAN', 'Residential Gateway', 'DSL', 'VLAN Residential Gateway profile for DSL connectivity.', 'Jayesh'],
  ['VLAN', 'Business Gateway', 'FTTH', 'VLAN Business Gateway profile for fibre-to-the-home connectivity.', 'Jayesh'],
  ['VLAN', 'Business Gateway', 'Other', 'VLAN Business Gateway profile for standard connectivity.', 'Jayesh'],
  // Microwave (Radio domain)
  ['Microwave', 'Point-to-Point', 'All-IP', 'Microwave PtP profile for all-IP Ethernet backhaul links.', 'Jayesh'],
  ['Microwave', 'Point-to-Point', 'Hybrid', 'Microwave PtP profile for hybrid TDM/Ethernet backhaul links.', 'Jayesh'],
  ['Microwave', 'Point-to-Point', 'E-band', 'Microwave PtP profile for E-band high-capacity short-haul links.', 'Jayesh'],
  // DWDM (Transport domain)
  ['DWDM', 'Wavelength Circuit', 'Unprotected', 'DWDM wavelength profile for unprotected point-to-point lambda circuits.', 'Jayesh'],
  ['DWDM', 'Wavelength Circuit', 'Protected', 'DWDM wavelength profile for 1+1 protected lambda circuits.', 'Jayesh'],
  // RAN VNF (Radio domain)
  ['RAN VNF', 'CU', 'Standalone', 'RAN CU profile for 5G Standalone (SA) deployments.', 'Jayesh'],
  ['RAN VNF', 'CU', 'Non-Standalone', 'RAN CU profile for 5G Non-Standalone (NSA) deployments anchored on LTE.', 'Jayesh'],
  ['RAN VNF', 'DU', 'Indoor', 'RAN DU profile for indoor small-cell deployments.', 'Jayesh'],
  ['RAN VNF', 'DU', 'Outdoor', 'RAN DU profile for outdoor macro-cell deployments.', 'Jayesh'],
  // GPON (Fiber domain)
  ['GPON', 'GPON', 'Residential', 'GPON profile for residential FTTH internet access.', 'Jayesh'],
  ['GPON', 'GPON', 'Business', 'GPON profile for business-grade FTTH internet access.', 'Jayesh'],
  ['GPON', 'XGS-PON', 'Residential', 'XGS-PON profile for 10G-symmetric residential FTTH.', 'Jayesh'],
  ['GPON', 'XGS-PON', 'Business', 'XGS-PON profile for 10G-symmetric business FTTH.', 'Jayesh'],
]

export const PROFILE_TYPES: ProfileType[] = PROFILE_ROWS.map(([category, type, subtype, description, creator], i) => ({
  id: `PT-${pad(i + 1, 3)}`,
  category, type, subtype, description, creator,
  createdAt: new Date(2025, 8 + (i % 10), 3 + (i % 22)).toISOString(),
  usedByWorkflows: 0, // filled once workflows are built
}))

export const VENDORS: Vendor[] = [...new Set(DEVICE_MODELS.map((d) => d.vendor))]
export const CATEGORIES: Category[] = [
  'L2VPN', 'L3VPN', 'IBW', 'VLAN', 'Microwave', 'DWDM', 'RAN VNF', 'GPON',
]
