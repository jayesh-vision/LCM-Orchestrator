-- ============================================================================
-- TELECOM LCM ORCHESTRATOR: COMPLETE PRODUCTION SEED SCRIPT
-- Senior Principal Architect Edition
-- Aligned with React Frontend UI (LCM-Orchestrator) & Architectural Standards
-- Standards: MySQL 8.0+ / Decoupled Provisioning Orchestrator (OMS is External)
-- Conventions:
--   - All Column Names in UPPERCASE
--   - Foreign keys use `<REFERENCED_TABLE>_ID_FK` naming format
--   - Mandatory universal governance columns on every table:
--       CREATED_TIME    DATETIME(6) NULL DEFAULT NULL
--       MODIFIED_TIME   DATETIME(6) NULL DEFAULT NULL
--       IS_DELETED      TINYINT(1) NOT NULL DEFAULT 0
--       CREATOR         BIGINT UNSIGNED NULL DEFAULT NULL (FK to USER.ID)
--       LAST_MODIFIER   BIGINT UNSIGNED NULL DEFAULT NULL (FK to USER.ID)
--       CUSTOMER_ID     INT NULL DEFAULT NULL (Value: 1)
--   - Central User Identity: Synced into `USER` table. CREATOR and LAST_MODIFIER
--     foreign keys map directly to `USER.ID` (no redundant creator_name strings).
--   - Decoupled Order Management: PROVISIONING_REQUEST with ORDER_ID for external OMS Feign client
--   - Direct Router Hardware Binding: NETWORK_ELEMENT_ID_FK + PORT_NAME (no separate interface table)
--   - Selective Rollback, Stop Rollback Breakers, Retries, and Task Transcripts
--   - Exact Mock Data matching UI: Accounts (Excitel, RailTel, Airtel, etc.),
--     Orders (ORD-2026-004417, ORD-2026-004412, etc.), Services (SVC-L2-018842, SVC-L3-010412, etc.)
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- 1. USERS (Synced from Central Platform via CDC)
-- ----------------------------------------------------------------------------
INSERT INTO `USER` (
    ID, CUSTOMER_ID, USERNAME, FULL_NAME, EMAIL, ROLE_CODE, DEPARTMENT, IS_ACTIVE,
    LAST_LOGIN_TIME, CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(523456789012345601, 1, 'ravi.k', 'Ravi K.', 'ravi.k@telecom.net', 'NOC_LEAD', 'NOC Operations', TRUE, NOW(6), NOW(6), NOW(6), 0, 523456789012345606, 523456789012345606),
(523456789012345602, 1, 'priya.s', 'Priya S.', 'priya.s@telecom.net', 'OPERATOR', 'Enterprise Delivery', TRUE, NOW(6), NOW(6), NOW(6), 0, 523456789012345606, 523456789012345606),
(523456789012345603, 1, 'anil.m', 'Anil M.', 'anil.m@telecom.net', 'OPERATOR', 'Carrier Fulfillment', TRUE, NOW(6), NOW(6), NOW(6), 0, 523456789012345606, 523456789012345606),
(523456789012345604, 1, 'raj.v', 'Raj V.', 'raj.v@telecom.net', 'ARCHITECT', 'Transport Architecture', TRUE, NOW(6), NOW(6), NOW(6), 0, 523456789012345606, 523456789012345606),
(523456789012345605, 1, 'jayesh.m', 'Jayesh M.', 'jayesh.m@telecom.net', 'ARCHITECT', 'IP Core Architecture', TRUE, NOW(6), NOW(6), NOW(6), 0, 523456789012345606, 523456789012345606),
(523456789012345606, 1, 'admin.sys', 'System Admin', 'admin@telecom.net', 'ADMIN', 'Infrastructure IT', TRUE, NOW(6), NOW(6), NOW(6), 0, 523456789012345606, 523456789012345606);

-- ----------------------------------------------------------------------------
-- 2. NETWORK ELEMENTS (Direct Router & Hardware Inventory)
-- ----------------------------------------------------------------------------
INSERT INTO NETWORK_ELEMENT (
    ID, CUSTOMER_ID, DEVICE_NAME, SITE_CODE, CITY, REGION, VENDOR, MODEL, DEVICE_KIND,
    MANAGEMENT_IP, OS_VERSION, ADMIN_STATE, OPER_STATE, LAST_DISCOVERED_TIME,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(600100200300400501, 1, 'ASR9k-MUM-PE01', 'MH-MUM-0301', 'Mumbai', 'West', 'CISCO', 'ASR-9006', 'Router', '172.31.33.20', 'IOS-XR 7.5.2', 'In Service', 'Up', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(600100200300400502, 1, 'MX204-BLR-PE02', 'DL-BLR-0412', 'Bengaluru', 'South', 'JUNIPER', 'MX204', 'Router', '172.31.33.100', 'Junos 21.4R3', 'In Service', 'Up', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(600100200300400503, 1, 'NCS540-BLR-PE01', 'DL-BLR-0412', 'Bengaluru', 'South', 'CISCO', 'NCS-540', 'Router', '172.31.63.20', 'IOS-XR 7.3.1', 'In Service', 'Up', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(600100200300400504, 1, 'MX204-BLR-PE03', 'DL-BLR-0977', 'Bengaluru', 'South', 'JUNIPER', 'MX204', 'Router', '172.31.33.100', 'Junos 22.4R3', 'In Service', 'Up', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(600100200300400505, 1, '7750SR-PUN-PE01', 'MH-PUN-1140', 'Pune', 'West', 'NOKIA', '7750 SR-1', 'Router', '172.31.33.45', 'SR OS 22.10', 'In Service', 'Up', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(600100200300400506, 1, 'ASR9k-DEL-PE01', 'DL-DEL-0101', 'Delhi', 'North', 'CISCO', 'ASR-9010', 'Router', '172.31.33.15', 'IOS-XR 7.5.2', 'In Service', 'Up', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(600100200300400507, 1, 'AS7726-CHN-SW01', 'TN-CHN-0805', 'Chennai', 'South', 'EDGECORE', 'AS7726-32X', 'Switch', '172.31.44.10', 'SONiC 202211', 'In Service', 'Up', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(600100200300400508, 1, 'ISAM-KOL-OLT01', 'WB-KOL-0620', 'Kolkata', 'East', 'NOKIA', 'ISAM FX-16', 'OLT', '172.31.55.12', 'ISAM 6.4.02', 'In Service', 'Up', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601);

-- ----------------------------------------------------------------------------
-- 3. PRODUCT CATALOG (PROFILE_TYPE) & SERVICE INTENTS
-- ----------------------------------------------------------------------------
-- Profile types authored by Jayesh M. (523456789012345605) and Raj V. (523456789012345604)
INSERT INTO PROFILE_TYPE (
    ID, CUSTOMER_ID, DOMAIN, CATEGORY, TYPE, SUBTYPE, DESCRIPTION,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 'Transport', 'L3VPN', 'Hub & Spoke', 'VRF', 'Enterprise Layer 3 private WAN with central hub and branch spoke routing', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(2, 1, 'Transport', 'L3VPN', 'Fully-Mesh', 'VRF', 'Full mesh any-to-any enterprise IP routing with dedicated customer VRF', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(3, 1, 'Transport', 'L2VPN', 'Point-to-point', 'Tagged', '802.1Q tagged sub-interface point-to-point pseudowire Ethernet link', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(4, 1, 'Transport', 'L2VPN', 'Point-to-point', 'Untagged', 'Port-based untagged point-to-point Ethernet circuit', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(5, 1, 'Transport', 'L2VPN', 'Transparent', 'Untagged', 'Port-based untagged transparent Ethernet circuit', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(6, 1, 'Transport', 'IBW', 'BGP', 'Other', 'Direct corporate internet bandwidth with BGP customer routing and policer', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(7, 1, 'Access', 'VLAN', 'Residential Gateway', 'FTTH', 'Residential broadband fiber access gateway termination', NOW(6), NOW(6), 0, 523456789012345604, 523456789012345604),
(8, 1, 'Radio', 'Microwave', 'Point-to-point', 'All-IP', 'High capacity millimeter wave wireless backhaul link', NOW(6), NOW(6), 0, 523456789012345604, 523456789012345604),
(9, 1, 'Fiber', 'GPON', 'Point-to-point', 'FTTH', 'Gigabit Passive Optical Network residential internet subscriber link', NOW(6), NOW(6), 0, 523456789012345604, 523456789012345604);

-- Service Intent Catalog Contracts (Blueprints matching catalog.ts and ServiceIntents.tsx UI)
INSERT INTO SERVICE_INTENT (
    ID, CUSTOMER_ID, INTENT_CODE, PROFILE_TYPE_ID_FK, NAME, TOPOLOGY, ENDPOINT_ARITY,
    VERSION, STATE, LIVE_SERVICES_COUNT, DESCRIPTION, CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 'INT-L3-HUBSPOKE', 1, 'L3VPN Hub & Spoke', 'Star', '1 hub + 1…n spokes', 1, 'Active', 96, 'MPLS Layer 3 VPN topology with central HQ Hub and branch Spokes', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(2, 1, 'INT-L2-P2P', 3, 'L2VPN Point-to-point', 'Two-ended', 'exactly 2', 1, 'Active', 431, 'Ethernet point-to-point pseudowire between two customer sites', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(3, 1, 'INT-IBW-ACCESS', 6, 'IBW Internet Access', 'Single-ended', 'exactly 1', 1, 'Active', 1697, 'High capacity enterprise dedicated internet access with upstream BGP peering', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(4, 1, 'INT-ACCESS-RESIDENTIAL', 7, 'VLAN — Residential Gateway', 'Single-ended', 'exactly 1', 1, 'Active', 200, 'Residential broadband Internet access on FTTH ONT', NOW(6), NOW(6), 0, 523456789012345604, 523456789012345604),
(5, 1, 'INT-RADIO-PTP', 8, 'Microwave Point-to-Point Link', 'Two-ended', 'exactly 2', 1, 'Active', 100, 'All-IP microwave point-to-point transmission link between towers', NOW(6), NOW(6), 0, 523456789012345604, 523456789012345604),
(6, 1, 'INT-GPON-RESI', 9, 'GPON Residential Internet Access', 'Single-ended', 'exactly 1', 1, 'Active', 90, 'Fiber to the home residential broadband over GPON OLT/ONT', NOW(6), NOW(6), 0, 523456789012345604, 523456789012345604);

-- Intent Parameter Specifications (With SEQUENCE, OPTIONS_CSV, MIN_VALUE, MAX_VALUE, and FROM_POOL_KIND)
INSERT INTO INTENT_PARAM_SPEC (
    ID, CUSTOMER_ID, SERVICE_INTENT_ID_FK, SEQUENCE, PARAM_NAME, PARAM_TYPE, OPTIONS_CSV, MIN_VALUE, MAX_VALUE,
    CONSTRAINT_EXPR, MODIFIABLE, FROM_POOL_KIND, IS_REQUIRED, DEFAULT_VALUE,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 1, 1, 'Bandwidth', 'integer', NULL, '10', '10000', '10-10000 Mbps', 'hitless', NULL, TRUE, '100', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(2, 1, 1, 2, 'VRF', 'string', NULL, NULL, NULL, '^[A-Z0-9_]{3,32}$', 'recreate', NULL, TRUE, NULL, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(3, 1, 1, 3, 'Vlan-ID', 'integer', NULL, '2', '4094', '2–4094 · from pool · unique per port', 'bounce', 'VLAN', TRUE, NULL, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(4, 1, 1, 4, 'Interface IP', 'ipv4', NULL, NULL, NULL, 'CIDR /30 · point-to-point pool', 'bounce', 'IP block', TRUE, NULL, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(5, 1, 1, 5, 'RD', 'string', NULL, NULL, NULL, '65001:nnn · from RD/RT pool', 'recreate', 'RD/RT', TRUE, NULL, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(6, 1, 1, 6, 'RT', 'string', NULL, NULL, NULL, '65001:nnn · from RD/RT pool', 'hitless', 'RD/RT', TRUE, NULL, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(7, 1, 2, 1, 'Bandwidth', 'integer', NULL, '10', '10000', '10-10000 Mbps', 'hitless', NULL, TRUE, '100', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(8, 1, 2, 2, 'Vlan-ID', 'integer', NULL, '2', '4094', '2–4094 · from pool · unique per port', 'bounce', 'VLAN', TRUE, NULL, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(9, 1, 2, 3, 'pw_id', 'integer', NULL, '4000', '4999', '4000–4999 · from Pseudowire ID pool', 'recreate', 'Pseudowire ID', TRUE, NULL, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(10, 1, 3, 1, 'Bandwidth', 'integer', NULL, '10', '10000', '10-10000 Mbps', 'hitless', NULL, TRUE, '1000', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(11, 1, 3, 2, 'Customer prefix', 'ipv4', NULL, NULL, NULL, 'Public /29 or /30 block', 'bounce', 'IP block', TRUE, NULL, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

-- ----------------------------------------------------------------------------
-- 4. WORKFLOW RECIPES, STAGES, TASKS WITH ROLLBACK BREAKERS & RETRIES
-- ----------------------------------------------------------------------------
-- Workflow 1: Cisco ASR9k L3VPN Hub (TSID: 700100200300400101)
INSERT INTO WORKFLOW (
    ID, CUSTOMER_ID, CODE, SERVICE_INTENT_ID_FK, NAME, DISPLAY_NAME,
    VENDOR, DEVICE_KIND, OS_RANGE, ENDPOINT_ROLE, STATE, OPERATION, VERSION, RUNS_30D, FIRST_PASS_RATE,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(700100200300400101, 1, 'CF-000248', 1, 'L3VPN | Hub & Spoke | VRF | Cisco | Source 1', 'L3VPN Cisco ASR9k Hub', 'CISCO', 'Router', '7.3 – 7.11', 'Source', 'Active', 'Create', 1, 42, 95.20, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(700100200300400102, 1, 'CF-000249', 1, 'L3VPN | Hub & Spoke | VRF | Juniper | Destination 1', 'L3VPN Juniper MX204 Spoke', 'JUNIPER', 'Router', '21.4R – 23.4R', 'Destination', 'Active', 'Create', 1, 38, 97.40, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

INSERT INTO WORKFLOW_SUPPORTED_MODEL (ID, CUSTOMER_ID, WORKFLOW_ID_FK, MODEL_NAME, CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER) VALUES
(1, 1, 700100200300400101, 'ASR-9006', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(2, 1, 700100200300400101, 'ASR-9010', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(3, 1, 700100200300400101, 'ASR-9904', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(4, 1, 700100200300400102, 'MX204', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(5, 1, 700100200300400102, 'MX480', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

INSERT INTO WORKFLOW_STAGE (ID, CUSTOMER_ID, WORKFLOW_ID_FK, NAME, DISPLAY_NAME, KIND, SEQUENCE, CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER) VALUES
(4, 1, 700100200300400102, 'Pre Validation', 'Pre Validation Checks', 'Pre validation', 1, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(5, 1, 700100200300400102, 'Set Configuration', 'Set Routing Instance & Policer', 'Configuration', 2, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(6, 1, 700100200300400102, 'Post Validation', 'Proof of Service Assertions', 'Post validation', 3, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

INSERT INTO WORKFLOW_TASK (
    ID, CUSTOMER_ID, WORKFLOW_STAGE_ID_FK, NAME, DISPLAY_NAME, SEQUENCE, KIND, SET_COMMAND,
    IS_ROLLBACK_ENABLED, ROLLBACK_TEMPLATE, IS_ROLLBACK_STOP_POINT, SKIP_ALLOWED, MANUAL_COMPLETE_ALLOWED,
    MAX_RETRY_COUNT, RETRY_INTERVAL_SECONDS, TIMEOUT_MS, DELAY_MS, AFFECTS_ATTRIBUTE,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(6, 1, 4, 'Check Interface', 'Check Junos Port Status', 1, 'read', 'show interfaces ${Interface} terse', FALSE, NULL, FALSE, FALSE, FALSE, 3, 5, 30000, 0, 'Interface', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(7, 1, 5, 'Set Policer & Instance', 'Configure Junos Policer & VRF', 1, 'write', 'set policy-options community ${VRF}-RT members target:${RT}\nset firewall policer POLICER-${Bandwidth}M if-exceeding bandwidth-limit ${Bandwidth}m burst-size-limit 625k\nset firewall policer POLICER-${Bandwidth}M then discard\nset interfaces ${Interface} unit ${Vlan-ID} vlan-id ${Vlan-ID}\nset interfaces ${Interface} unit ${Vlan-ID} family inet policer input POLICER-${Bandwidth}M\nset interfaces ${Interface} unit ${Vlan-ID} family inet address ${Interface IP}\nset routing-instances ${VRF} instance-type vrf\nset routing-instances ${VRF} interface ${Interface}.${Vlan-ID}\nset routing-instances ${VRF} route-distinguisher ${RD}\ncommit and-quit', TRUE, 'delete routing-instances ${VRF}\ndelete interfaces ${Interface} unit ${Vlan-ID}\ndelete firewall policer POLICER-${Bandwidth}M\ncommit and-quit', FALSE, FALSE, FALSE, 1, 5, 90000, 0, 'Bandwidth', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(8, 1, 6, 'Verify Instance', 'Verify Junos VRF Running', 1, 'read', 'show routing-instances ${VRF}', FALSE, NULL, FALSE, FALSE, FALSE, 2, 5, 30000, 0, 'VRF', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

INSERT INTO TASK_VALIDATION_RULE (ID, CUSTOMER_ID, WORKFLOW_TASK_ID_FK, SEQUENCE, JOIN_TYPE, OPERATOR, EXPECTED_VALUE, IS_ROLLBACK_RULE, CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER) VALUES
(7, 1, 6, 1, 'AND', 'CONTAINS', 'up', FALSE, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(8, 1, 7, 1, 'AND', 'CONTAINS', 'commit complete', FALSE, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(9, 1, 8, 1, 'AND', 'CONTAINS', 'instance-type vrf', FALSE, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

-- Workflow 3: Cisco NCS-540 L2VPN Point-to-Point (TSID: 700100200300400103)
INSERT INTO WORKFLOW (
    ID, CUSTOMER_ID, CODE, SERVICE_INTENT_ID_FK, NAME, DISPLAY_NAME,
    VENDOR, DEVICE_KIND, OS_RANGE, ENDPOINT_ROLE, STATE, OPERATION, VERSION, RUNS_30D, FIRST_PASS_RATE,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(700100200300400103, 1, 'CF-000250', 2, 'L2VPN | Point-to-point | Tagged | Cisco | A', 'L2VPN Cisco NCS540 Pseudowire', 'CISCO', 'Router', '7.3 – 7.11', 'Source', 'Active', 'Create', 1, 64, 98.10, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
-- Day-2 Operational Workflows (Modify, Suspend, Cease)
(700100200300400104, 1, 'CF-MOD-0074', 3, 'IBW | Modify Policer & Bandwidth | Adva', 'IBW Modify Adva', 'ADVA', 'Router', '12.2 – 14.1', 'Source', 'Active', 'Modify', 1, 64, 93.00, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(700100200300400105, 1, 'CF-SUS-0075', 3, 'IBW | Suspend Administrative Traffic Hold | Adva', 'IBW Suspend Adva', 'ADVA', 'Router', '12.2 – 14.1', 'Source', 'Active', 'Suspend', 1, 29, 91.00, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(700100200300400106, 1, 'CF-CEA-0089', 3, 'IBW | Cease Teardown & Quarantine | Cisco', 'IBW Cease Cisco', 'CISCO', 'Router', '7.3 – 7.11', 'Source', 'Active', 'Cease', 1, 18, 95.00, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

INSERT INTO WORKFLOW_SUPPORTED_MODEL (ID, CUSTOMER_ID, WORKFLOW_ID_FK, MODEL_NAME, CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER) VALUES
(6, 1, 700100200300400103, 'NCS-540', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(7, 1, 700100200300400104, 'FSP-150', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(8, 1, 700100200300400105, 'FSP-150', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(9, 1, 700100200300400106, 'ASR-9006', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

INSERT INTO WORKFLOW_STAGE (ID, CUSTOMER_ID, WORKFLOW_ID_FK, NAME, DISPLAY_NAME, KIND, SEQUENCE, CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER) VALUES
(7, 1, 700100200300400103, 'Pre Validation', 'Pre Validation Checks', 'Pre validation', 1, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(8, 1, 700100200300400103, 'Set Configuration', 'Set Pseudowire & Xconnect', 'Configuration', 2, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(9, 1, 700100200300400103, 'Post Validation', 'Proof of Service Assertions', 'Post validation', 3, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

INSERT INTO WORKFLOW_TASK (
    ID, CUSTOMER_ID, WORKFLOW_STAGE_ID_FK, NAME, DISPLAY_NAME, SEQUENCE, KIND, SET_COMMAND,
    IS_ROLLBACK_ENABLED, ROLLBACK_TEMPLATE, IS_ROLLBACK_STOP_POINT, SKIP_ALLOWED, MANUAL_COMPLETE_ALLOWED,
    MAX_RETRY_COUNT, RETRY_INTERVAL_SECONDS, TIMEOUT_MS, DELAY_MS, AFFECTS_ATTRIBUTE,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(9, 1, 7, 'Check Port Physical', 'Check Physical Link State', 1, 'read', 'show interfaces ${Interface} brief', FALSE, NULL, FALSE, FALSE, FALSE, 3, 5, 30000, 0, 'Interface', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(10, 1, 8, 'Set L2VPN Xconnect', 'Configure Subinterface & Pseudowire', 1, 'write', 'interface ${Interface}.${vlan} l2transport\n encapsulation dot1q ${vlan}\n rewrite ingress tag pop 1 symmetric\n!\nl2vpn\n xconnect group XG1\n  p2p P2P-${vlan}\n   interface ${Interface}.${vlan}\n   neighbor ipv4 ${Neighbor IP} pw-id ${pw_id}\n!\ncommit', TRUE, 'no l2vpn xconnect group XG1 p2p P2P-${vlan}\nno interface ${Interface}.${vlan}\ncommit', FALSE, FALSE, FALSE, 1, 5, 60000, 0, 'Bandwidth', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(11, 1, 9, 'Verify Pseudowire UP', 'Verify L2VPN PW State is Up', 1, 'read', 'show l2vpn xconnect brief', FALSE, NULL, FALSE, FALSE, FALSE, 3, 5, 30000, 0, 'pw_id', NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);

INSERT INTO TASK_VALIDATION_RULE (ID, CUSTOMER_ID, WORKFLOW_TASK_ID_FK, SEQUENCE, JOIN_TYPE, OPERATOR, EXPECTED_VALUE, IS_ROLLBACK_RULE, CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER) VALUES
(10, 1, 7, 1, 'AND', 'CONTAINS', 'up', FALSE, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(11, 1, 8, 1, 'AND', 'CONTAINS', 'commit complete', FALSE, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605),
(12, 1, 9, 1, 'AND', 'CONTAINS', 'up', FALSE, NOW(6), NOW(6), 0, 523456789012345605, 523456789012345605);
-- Workflow Required Parameters: Mapping templates to required INTENT_PARAM_SPEC IDs
INSERT INTO WORKFLOW_REQUIRED_PARAM (ID, WORKFLOW_ID_FK, INTENT_PARAM_SPEC_ID_FK, IS_DELETED) VALUES
-- Cisco ASR9k L3VPN Hub (TSID: 700100200300400101) requires Bandwidth(1), VRF(2), Vlan-ID(3), Interface IP(4), RD(5), RT(6)
(1, 700100200300400101, 1, 0),
(2, 700100200300400101, 2, 0),
(3, 700100200300400101, 3, 0),
(4, 700100200300400101, 4, 0),
(5, 700100200300400101, 5, 0),
(6, 700100200300400101, 6, 0),
-- Juniper MX204 L3VPN Spoke (TSID: 700100200300400102) requires Bandwidth(1), VRF(2), Vlan-ID(3), Interface IP(4), RD(5), RT(6)
(7, 700100200300400102, 1, 0),
(8, 700100200300400102, 2, 0),
(9, 700100200300400102, 3, 0),
(10, 700100200300400102, 4, 0),
(11, 700100200300400102, 5, 0),
(12, 700100200300400102, 6, 0),
-- Cisco NCS-540 L2VPN Point-to-Point (TSID: 700100200300400103) requires Bandwidth(7), Vlan-ID(8), pw_id(9)
(13, 700100200300400103, 7, 0),
(14, 700100200300400103, 8, 0),
(15, 700100200300400103, 9, 0);

-- ----------------------------------------------------------------------------
-- 5. RESOURCE POOLS & ENTRIES (Matching misc.ts SEEDS)
-- ----------------------------------------------------------------------------
INSERT INTO RESOURCE_POOL (
    ID, CUSTOMER_ID, CODE, KIND, SCOPE, TOTAL_CAPACITY, ALLOCATED_COUNT, QUARANTINED_COUNT, RESERVED_COUNT,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(800100200300400101, 1, 'POOL-VLAN-001', 'VLAN', 'Global Core Metro', 1000, 420, 15, 5, NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(800100200300400102, 1, 'POOL-IP-001', 'IP block', 'WAN Transit 10.244.0.0/16', 256, 110, 8, 2, NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(800100200300400103, 1, 'POOL-RDRT-001', 'RD/RT', 'Global 65001:x', 500, 180, 12, 1, NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(800100200300400104, 1, 'POOL-PWID-001', 'Pseudowire ID', 'Global L2VPN 4000-4999', 1000, 315, 4, 3, NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(800100200300400105, 1, 'POOL-ASN-001', 'ASN slot', 'Autonomous System 64512-65534', 1024, 210, 0, 0, NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601);

-- ----------------------------------------------------------------------------
-- 6. LIVE SERVICES IN INSTALLED BASE (Screen 2: Service Inventory)
-- ----------------------------------------------------------------------------
-- Service 1: Hand-authored featured drifted service (SVC-L2-018842 from UI services.ts)
INSERT INTO SERVICE (
    ID, CUSTOMER_ID, SERVICE_CODE, NAME, ACCOUNT_ID, ACCOUNT_NAME, PROFILE_TYPE_ID_FK,
    SERVICE_INTENT_ID_FK, SERVICE_STATE, OPER_STATE, CONFORMANCE, DRIFT_COUNT,
    BANDWIDTH_MBPS, MONTHLY_VALUE_INR, LIVE_SINCE, LAST_PROVEN_TIME,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
('SVC-L2-018842', 1, 'NS-000114', 'Excitel BLR ring — east leg', 'ACC-04417', 'Excitel Business Solutions', 3, 2, 'Live', 'Up', 'Drifted', 1, 100, 120000.00, DATE_SUB(NOW(6), INTERVAL 780 DAY), DATE_SUB(NOW(6), INTERVAL 4 HOUR), NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
('SVC-L3-010412', 1, 'NS-000105', 'RailTel Enterprise WAN Core', 'ACC-00218', 'RailTel Corporation', 1, 1, 'Live', 'Up', 'Conformant', 0, 500, 450000.00, DATE_SUB(NOW(6), INTERVAL 340 DAY), DATE_SUB(NOW(6), INTERVAL 15 MINUTE), NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
('SVC-IBW-010992', 1, 'NS-000088', 'Bharti Airtel Peering Link', 'ACC-00031', 'Bharti Airtel Enterprise', 6, 3, 'Live', 'Up', 'Conformant', 0, 1000, 980000.00, DATE_SUB(NOW(6), INTERVAL 180 DAY), DATE_SUB(NOW(6), INTERVAL 1 HOUR), NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
('SVC-L3-010355', 1, 'NS-000092', 'Apollo Hospitals Emergency VPN', 'ACC-02290', 'Sify Technologies', 1, 1, 'Suspended', 'Down', 'Not checked', 0, 50, 45000.00, DATE_SUB(NOW(6), INTERVAL 90 DAY), DATE_SUB(NOW(6), INTERVAL 5 DAY), NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602);

-- Unified Endpoints for Live Services (Direct router binding: Router derives Site, IP, Vendor)
INSERT INTO SERVICE_ENDPOINT (
    ID, CUSTOMER_ID, SERVICE_ID_FK, PROVISIONING_REQUEST_ID_FK, ROLE,
    NETWORK_ELEMENT_ID_FK, PORT_NAME, SUB_INTERFACE, WORKFLOW_ID_FK,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
-- SVC-L2-018842 Endpoints (A-end on NCS-540 in Bengaluru, Z-end on MX204 in Bengaluru)
(1, 1, 'SVC-L2-018842', NULL, 'A', 600100200300400503, 'TenGigE0/0/0/1', 'TenGigE0/0/0/1.104', 700100200300400103, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(2, 1, 'SVC-L2-018842', NULL, 'Z', 600100200300400504, 'xe-1/1/0', 'xe-1/1/0.104', 700100200300400102, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
-- SVC-L3-010412 Endpoints (Source on ASR9k in Mumbai, Destination on MX204 in Bengaluru)
(3, 1, 'SVC-L3-010412', NULL, 'Source', 600100200300400501, 'xe-0/0/3', 'xe-0/0/3.200', 700100200300400101, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(4, 1, 'SVC-L3-010412', NULL, 'Destination', 600100200300400502, 'ge-1/0/0', 'ge-1/0/0.200', 700100200300400102, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602);

-- Service Attributes: Intent vs Realised comparison matrix for automated drift detection (Service Detail Realised tab)
INSERT INTO SERVICE_ATTRIBUTE (
    ID, CUSTOMER_ID, SERVICE_ID_FK, ATTRIBUTE_NAME, INTENT_VALUE, ON_DEVICE_VALUE, SOURCE_SYSTEM, VERDICT, VERIFIED_TIME,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 'SVC-L2-018842', 'Service type', 'L2VPN Point-to-point', 'Point-to-point', 'Order', 'Match', DATE_SUB(NOW(6), INTERVAL 4 HOUR), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(2, 1, 'SVC-L2-018842', 'Bandwidth', '100 Mbps', '200 Mbps', 'Manual', 'Drift', DATE_SUB(NOW(6), INTERVAL 4 HOUR), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(3, 1, 'SVC-L2-018842', 'VLAN', '104', '104', 'Reserved', 'Match', DATE_SUB(NOW(6), INTERVAL 4 HOUR), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(4, 1, 'SVC-L2-018842', 'Pseudowire ID', '4104', '4104', 'Reserved', 'Match', DATE_SUB(NOW(6), INTERVAL 4 HOUR), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(5, 1, 'SVC-L2-018842', 'MTU', '1500', '1500', 'Order', 'Match', DATE_SUB(NOW(6), INTERVAL 4 HOUR), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(6, 1, 'SVC-L3-010412', 'Service type', 'L3VPN Hub & Spoke', 'Hub & Spoke', 'Order', 'Match', DATE_SUB(NOW(6), INTERVAL 15 MINUTE), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(7, 1, 'SVC-L3-010412', 'Bandwidth', '500 Mbps', '500 Mbps', 'Order', 'Match', DATE_SUB(NOW(6), INTERVAL 15 MINUTE), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(8, 1, 'SVC-L3-010412', 'Route distinguisher', '65001:200', '65001:200', 'Reserved', 'Match', DATE_SUB(NOW(6), INTERVAL 15 MINUTE), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601);

-- Service History: Chronological audit trail comparing portal changes vs out-of-band CLI edits (Service Detail History tab)
INSERT INTO SERVICE_HISTORY (
    ID, CUSTOMER_ID, SERVICE_ID_FK, PROVISIONING_REQUEST_ID_FK, CHANGE_DESCRIPTION, IS_OUT_OF_BAND, OCCURRED_TIME,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 'SVC-L2-018842', NULL, 'Bandwidth changed on the device via CLI terminal', TRUE, DATE_SUB(NOW(6), INTERVAL 15 DAY), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(2, 1, 'SVC-L2-018842', NULL, 'MTU 1400 -> 1500 adjusted via maintenance window', FALSE, DATE_SUB(NOW(6), INTERVAL 120 DAY), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(3, 1, 'SVC-L2-018842', NULL, 'Created · service went Live', FALSE, DATE_SUB(NOW(6), INTERVAL 780 DAY), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(4, 1, 'SVC-L3-010412', NULL, 'Created · service went Live', FALSE, DATE_SUB(NOW(6), INTERVAL 340 DAY), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601);

-- Service Revisions
INSERT INTO SERVICE_REVISION (
    ID, CUSTOMER_ID, SERVICE_ID_FK, REVISION_NUMBER, PROVISIONING_REQUEST_ID_FK, CHANGE_SUMMARY,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
('REV-018f3a2c-0001', 1, 'SVC-L2-018842', 1, NULL, 'Initial provisioning creation at 100 Mbps', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
('REV-018f3a2c-0002', 1, 'SVC-L3-010412', 1, NULL, 'Initial provisioning creation at 500 Mbps', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602);

-- Pool Entries allocated to live services
INSERT INTO RESOURCE_POOL_ENTRY (
    ID, CUSTOMER_ID, RESOURCE_POOL_ID_FK, RESOURCE_VALUE, STATE, SERVICE_ID_FK,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 800100200300400101, '104', 'Allocated', 'SVC-L2-018842', NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(2, 1, 800100200300400104, '4104', 'Allocated', 'SVC-L2-018842', NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(3, 1, 800100200300400101, '200', 'Allocated', 'SVC-L3-010412', NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(4, 1, 800100200300400102, '10.244.12.0/30', 'Allocated', 'SVC-L3-010412', NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(5, 1, 800100200300400103, '65001:200', 'Allocated', 'SVC-L3-010412', NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(6, 1, 800100200300400101, '205', 'Quarantined', NULL, NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(7, 1, 800100200300400101, '206', 'Free', NULL, NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601);

-- ----------------------------------------------------------------------------
-- 7. PROVISIONING REQUESTS & DAY-2 CHANGES (Matching React UI Screen 1 & 3)
-- ----------------------------------------------------------------------------
-- Request 1: Featured In-Progress Modify Request (ORD-2026-004417 from UI orders.ts)
-- Reconciles drift on SVC-L2-018842 by modifying Bandwidth 100M -> 200M!
INSERT INTO PROVISIONING_REQUEST (
    ID, CUSTOMER_ID, REQUEST_CODE, ORDER_ID, SERVICE_CODE, SERVICE_NAME, ACCOUNT_ID, ACCOUNT_NAME,
    PROFILE_TYPE_ID_FK, SERVICE_INTENT_ID_FK, INTENT, REASON_CATEGORY, AUDIT_SCOPE,
    TARGET_SERVICE_ID_FK, REQUEST_STATE, WORKFLOW_ID_FK, OWNER, WAITING_ON,
    SLA_BREACHED, NOTES, DECOMMISSION_CONFIRMED, IS_ARCHIVED, APPROVAL_STATUS,
    APPROVED_BY_USER_ID_FK, APPROVED_TIME, APPROVAL_COMMENTS, CREATED_TIME, MODIFIED_TIME,
    IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
-- Request 1: Featured In-Progress Modify Request (ORD-2026-004417 from UI orders.ts)
-- Reconciles drift on SVC-L2-018842 by modifying Bandwidth 100M -> 200M!
('ORD-2026-004417', 1, 'NS-000114', 'OMS-ORD-04417', 'NS-000114', 'L2VPN Transparent', 'ACC-04417', 'Excitel Business Solutions', 5, 2, 'Modify', 'Scheduled customer maintenance window', NULL, 'SVC-L2-018842', 'In progress', 700100200300400103, 'Priya S.', 'Worker Execution', FALSE, 'Bandwidth upgrade to 200 Mbps requested during scheduled window.', FALSE, FALSE, 'APPROVED', 523456789012345601, DATE_SUB(NOW(6), INTERVAL 1 HOUR), 'Approved for execution during daytime window.', DATE_SUB(NOW(6), INTERVAL 2 DAY), NOW(6), 0, 523456789012345602, 523456789012345602),

-- Request 2: Validated Create Request (Awaiting NOC Lead on Screen 1)
('ORD-2026-004412', 1, 'NS-000118', 'OMS-ORD-04412', 'NS-000118', 'L3VPN Hub & Spoke', 'ACC-00218', 'RailTel Corporation', 1, 1, 'Create', NULL, NULL, NULL, 'Validated', 700100200300400101, 'Ravi K.', 'NOC lead', FALSE, 'Initial greenfield deployment for RailTel branch connectivity.', FALSE, FALSE, 'PENDING', NULL, NULL, NULL, DATE_SUB(NOW(6), INTERVAL 1 DAY), NOW(6), 0, 523456789012345601, 523456789012345601),

-- Request 3: Ready Create Request (Completed activation)
('ORD-2026-004416', 1, 'NS-000122', 'OMS-ORD-04416', 'NS-000122', 'IBW Internet Access', 'ACC-00031', 'Bharti Airtel Enterprise', 6, 3, 'Create', NULL, NULL, NULL, 'Ready', 700100200300400101, 'Anil M.', 'Execution queue', FALSE, NULL, FALSE, FALSE, 'APPROVED', 523456789012345601, DATE_SUB(NOW(6), INTERVAL 3 DAY), 'Passed pre-validation checks cleanly.', DATE_SUB(NOW(6), INTERVAL 4 DAY), NOW(6), 0, 523456789012345603, 523456789012345603),

-- Request 4: Failed Request (SLA Breached, awaiting Engineering Review)
('ORD-2026-004419', 1, 'NS-000125', 'OMS-ORD-04419', 'NS-000125', 'L3VPN Hub & Spoke', 'ACC-03104', 'Tata Communications', 1, 1, 'Create', NULL, NULL, NULL, 'Failed', 700100200300400101, 'Priya S.', 'Assigned engineer', TRUE, 'Pre-check script timeout on Z endpoint interface.', FALSE, FALSE, 'APPROVED', 523456789012345601, DATE_SUB(NOW(6), INTERVAL 15 DAY), 'Approved standard deployment.', DATE_SUB(NOW(6), INTERVAL 16 DAY), NOW(6), 0, 523456789012345602, 523456789012345602),

-- Request 5: Invalid Draft (Orphan example from orders.ts line 366)
('ORD-2026-003118', 1, 'NS-000000', 'OMS-ORD-03118', 'NS-000000', 'Unclassified draft', '—', '—', NULL, NULL, 'Create', NULL, NULL, NULL, 'Invalid', NULL, NULL, 'Unassigned', FALSE, NULL, FALSE, FALSE, 'NOT_REQUIRED', NULL, NULL, NULL, DATE_SUB(NOW(6), INTERVAL 293 DAY), NOW(6), 0, 523456789012345601, 523456789012345601),

-- Request 6: Day-2 Modify Request on Screen 3 (RailTel Bandwidth 500M -> 1000M)
('ORD-2026-009102', 1, 'NS-000140', 'OMS-ORD-09102', 'NS-000140', 'L3VPN Hub & Spoke', 'ACC-00218', 'RailTel Corporation', 1, 1, 'Modify', 'Capacity upgrade', NULL, 'SVC-L3-010412', 'Validated', 700100200300400101, 'Ravi K.', 'NOC lead', FALSE, 'RailTel requested bandwidth scaling during scheduled maintenance.', FALSE, FALSE, 'PENDING', NULL, NULL, NULL, DATE_SUB(NOW(6), INTERVAL 6 HOUR), NOW(6), 0, 523456789012345601, 523456789012345601),

-- Request 7: Day-2 Suspend Request (Administrative temporary hold)
('ORD-2026-009105', 1, 'NS-000145', 'OMS-ORD-09105', 'NS-000145', 'IBW Internet Access', 'ACC-00031', 'Bharti Airtel Enterprise', 6, 3, 'Suspend', 'Billing arrears / payment dispute', NULL, 'SVC-IBW-010992', 'Validated', 700100200300400105, 'Priya S.', 'Finance Hold', FALSE, 'Temporary freeze per finance escalation notice.', FALSE, FALSE, 'PENDING', NULL, NULL, NULL, DATE_SUB(NOW(6), INTERVAL 3 HOUR), NOW(6), 0, 523456789012345601, 523456789012345601),

-- Request 8: Day-2 Cease Request with Decommission Confirmation Check
('ORD-2026-009108', 1, 'NS-000150', 'OMS-ORD-09108', 'NS-000150', 'L3VPN Hub & Spoke', 'ACC-03104', 'Tata Communications', 1, 1, 'Cease', 'Contract termination / customer request', NULL, 'SVC-L3-010412', 'Validated', 700100200300400106, 'Anil M.', 'NOC lead', FALSE, 'Contract termination signed off by customer. Quarantine allocated resources for 30 days.', TRUE, FALSE, 'PENDING', NULL, NULL, NULL, DATE_SUB(NOW(6), INTERVAL 1 HOUR), NOW(6), 0, 523456789012345603, 523456789012345603);

-- Request Delta Diff: Attribute modifications displayed on Screen 3: Change & Cease
INSERT INTO REQUEST_DELTA (
    ID, CUSTOMER_ID, PROVISIONING_REQUEST_ID_FK, ATTRIBUTE_NAME, CURRENT_VALUE, REQUESTED_VALUE, TRAFFIC_IMPACT,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 'ORD-2026-004417', 'Bandwidth', '100 Mbps', '200 Mbps', 'Hitless', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(2, 1, 'ORD-2026-009102', 'Bandwidth', '500 Mbps', '1000 Mbps', 'Hitless', NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(3, 1, 'ORD-2026-009105', 'Administrative State', 'Enabled', 'Suspended', 'Outage', NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(4, 1, 'ORD-2026-009108', 'Lifecycle State', 'Live', 'Ceased', 'Outage', NOW(6), NOW(6), 0, 523456789012345603, 523456789012345603);

-- Request Endpoints for In-Flight Execution
INSERT INTO SERVICE_ENDPOINT (
    ID, CUSTOMER_ID, SERVICE_ID_FK, PROVISIONING_REQUEST_ID_FK, ROLE,
    NETWORK_ELEMENT_ID_FK, PORT_NAME, SUB_INTERFACE, WORKFLOW_ID_FK,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
-- ORD-2026-004417 Endpoints
(5, 1, NULL, 'ORD-2026-004417', 'A', 600100200300400503, 'TenGigE0/0/0/1', 'TenGigE0/0/0/1.104', 700100200300400103, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(6, 1, NULL, 'ORD-2026-004417', 'Z', 600100200300400504, 'xe-1/1/0', 'xe-1/1/0.104', 700100200300400102, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
-- ORD-2026-004416 Endpoints
(7, 1, NULL, 'ORD-2026-004416', 'Source', 600100200300400501, 'xe-0/0/4', 'xe-0/0/4.300', 700100200300400101, NOW(6), NOW(6), 0, 523456789012345603, 523456789012345603);

-- Resolved Parameters: Dynamic substitution values for CLI placeholders
INSERT INTO REQUEST_PARAM_VALUE (
    ID, CUSTOMER_ID, PROVISIONING_REQUEST_ID_FK, SERVICE_ENDPOINT_ID_FK, PARAM_NAME, PARAM_VALUE, SOURCE,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 'ORD-2026-004417', 5, 'encapsulation', 'transparent', 'user', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(2, 1, 'ORD-2026-004417', 5, 'vlan', '104', 'pool', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(3, 1, 'ORD-2026-004417', 5, 'mtu', '1500', 'template', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(4, 1, 'ORD-2026-004417', 5, 'bandwidth_mbps', '200', 'user', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(5, 1, 'ORD-2026-004417', 5, 'control_word', 'true', 'template', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(6, 1, 'ORD-2026-004417', 5, 'pw_id', '4104', 'pool', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(7, 1, 'ORD-2026-004417', 5, 'Interface', 'TenGigE0/0/0/1', 'derived', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(8, 1, 'ORD-2026-004417', 5, 'Neighbor IP', '172.31.33.100', 'derived', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(9, 1, 'ORD-2026-004417', 6, 'Interface', 'xe-1/1/0', 'derived', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
(10, 1, 'ORD-2026-004417', 6, 'Neighbor IP', '172.31.63.20', 'derived', NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602);

-- ----------------------------------------------------------------------------
-- 8. DEVICE-CENTRIC EXECUTION QUEUE (Per Router Lock Queue)
-- ----------------------------------------------------------------------------
-- NCS540-BLR-PE01 has ORD-2026-004417 currently processing SSH configuration
INSERT INTO DEVICE_EXECUTION_QUEUE (
    ID, CUSTOMER_ID, NETWORK_ELEMENT_ID_FK, PROVISIONING_REQUEST_ID_FK, QUEUE_STATUS,
    PRIORITY, SCHEDULED_TIME, LOCKED_BY_WORKER, LOCKED_TIME,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
(1, 1, 600100200300400503, 'ORD-2026-004417', 'PROCESSING', 5, NOW(6), 'worker-thread-01', NOW(6), NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601),
(2, 1, 600100200300400501, 'ORD-2026-004412', 'QUEUED', 5, NOW(6), NULL, NULL, NOW(6), NOW(6), 0, 523456789012345601, 523456789012345601);

-- ----------------------------------------------------------------------------
-- 9. EXECUTION ATTEMPTS, RUNS & TASK TRANSCRIPTS (Request Detail Runs Drawer)
-- ----------------------------------------------------------------------------
INSERT INTO REQUEST_ATTEMPT (
    ID, CUSTOMER_ID, PROVISIONING_REQUEST_ID_FK, ATTEMPT_NUMBER, OUTCOME, STARTED_TIME, ENDED_TIME,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
('ATT-018f3a2c-0001', 1, 'ORD-2026-004417', 1, 'Running', DATE_SUB(NOW(6), INTERVAL 12 MINUTE), NULL, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
('ATT-018f3a2c-0002', 1, 'ORD-2026-004416', 1, 'Accepted', DATE_SUB(NOW(6), INTERVAL 3 DAY), DATE_ADD(DATE_SUB(NOW(6), INTERVAL 3 DAY), INTERVAL 42 SECOND), NOW(6), NOW(6), 0, 523456789012345603, 523456789012345603);

INSERT INTO ACTIVATION_RUN (
    ID, CUSTOMER_ID, REQUEST_ATTEMPT_ID_FK, PROVISIONING_REQUEST_ID_FK, SERVICE_ENDPOINT_ID_FK,
    NETWORK_ELEMENT_ID_FK, WORKFLOW_ID_FK, DIRECTION, OUTCOME, STARTED_TIME, ENDED_TIME,
    DURATION_MS, DEVICE_CLOCK, CLOCK_SKEW_MS,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
-- Run 1: ORD-2026-004417 A-end Run on Cisco NCS-540
('RUN-000001', 1, 'ATT-018f3a2c-0001', 'ORD-2026-004417', 5, 600100200300400503, 700100200300400103, 'forward', 'Running', DATE_SUB(NOW(6), INTERVAL 12 MINUTE), NULL, 0, DATE_SUB(NOW(6), INTERVAL 12 MINUTE), -3100, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
-- Run 2: ORD-2026-004417 Z-end Run on Juniper MX204
('RUN-000002', 1, 'ATT-018f3a2c-0001', 'ORD-2026-004417', 6, 600100200300400504, 700100200300400102, 'forward', 'Running', DATE_SUB(NOW(6), INTERVAL 12 MINUTE), NULL, 0, DATE_SUB(NOW(6), INTERVAL 12 MINUTE), -3100, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602);

-- Detailed Run Tasks for RUN-000001 (Matching task logs drawer in Request Detail)
INSERT INTO RUN_TASK (
    ID, CUSTOMER_ID, ACTIVATION_RUN_ID_FK, WORKFLOW_TASK_ID_FK, TASK_NAME, STAGE_NAME,
    STAGE_KIND, SEQUENCE, TASK_STATE, DIRECTION, COMMAND_SENT, REQUEST_PAYLOAD,
    RESPONSE_RAW, EXIT_CODE, PARSED_OUTPUT, FAILURE_REASON, STARTED_TIME, ENDED_TIME, DURATION_MS,
    CREATED_TIME, MODIFIED_TIME, IS_DELETED, CREATOR, LAST_MODIFIER
) VALUES
('TSK-018f3a2c-0001', 1, 'RUN-000001', 9, 'Check Port Physical', 'Pre Validation Checks', 'Pre validation', 1, 'Passed', 'forward', 'show interfaces TenGigE0/0/0/1 brief', '{"transport":"ssh","port":22}', 'Interface TenGigE0/0/0/1 is up, line protocol is up\nHardware is TenGigE, address is 008a.9622.0401', 0, 'up', NULL, DATE_SUB(NOW(6), INTERVAL 12 MINUTE), DATE_SUB(NOW(6), INTERVAL 11 MINUTE), 1420, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602),
('TSK-018f3a2c-0002', 1, 'RUN-000001', 10, 'Set L2VPN Xconnect', 'Set Pseudowire & Xconnect', 'Configuration', 2, 'Running', 'forward', 'interface TenGigE0/0/0/1.104 l2transport\n encapsulation dot1q 104\n rewrite ingress tag pop 1 symmetric\n!\nl2vpn\n xconnect group XG1\n  p2p P2P-104\n   interface TenGigE0/0/0/1.104\n   neighbor ipv4 172.31.33.100 pw-id 4104\n!\ncommit', '{"transport":"ssh","port":22}', 'RP/0/RP0/CPU0:NCS540# commit\nGenerating configuration delta...\n[Applying changes...]', 0, 'in_progress', NULL, DATE_SUB(NOW(6), INTERVAL 11 MINUTE), NULL, 0, NOW(6), NOW(6), 0, 523456789012345602, 523456789012345602);

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- END OF TELECOM LCM ORCHESTRATOR SEED SCRIPT
-- ============================================================================
