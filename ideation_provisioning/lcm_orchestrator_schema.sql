-- ============================================================================
-- TELECOM LCM ORCHESTRATOR: COMPLETE PRODUCTION DATABASE SCHEMA DDL
-- Aligned with React Frontend UI (LCM-Orchestrator) & Architectural Standards
-- Standards: MySQL 8.0+ / InnoDB / utf8mb4 / utf8mb4_unicode_ci
-- Architecture: Decoupled Provisioning Orchestrator (OMS is an External Service)
--
-- Architectural Conventions:
--   1. ALL Column Names in UPPERCASE (e.g. REQUEST_CODE, DEVICE_NAME, CREATED_TIME)
--   2. All Foreign Keys use `<REFERENCED_TABLE>_ID_FK` naming format
--   3. Mandatory Universal Governance Columns on EVERY table:
--        CREATED_TIME    DATETIME(6) NULL DEFAULT NULL
--        MODIFIED_TIME   DATETIME(6) NULL DEFAULT NULL
--        IS_DELETED      TINYINT(1) NOT NULL DEFAULT 0
--        CREATOR         BIGINT UNSIGNED NULL DEFAULT NULL (FK to USER.ID)
--        LAST_MODIFIER   BIGINT UNSIGNED NULL DEFAULT NULL (FK to USER.ID)
--        CUSTOMER_ID     INT NULL DEFAULT NULL
--   4. User Identity: Platform users synced to `USER` table. CREATOR and LAST_MODIFIER
--      map directly to `USER.ID`. No redundant creator_name strings.
--   5. Fixed Domain Enums: ENUM types used for fixed domains, taxonomy, and lifecycles.
--   6. Decoupled Order Management: Order Management is a separate external microservice accessed
--      via Feign client. Core entity is PROVISIONING_REQUEST with an ORDER_ID field for external linkage.
--   7. Full UI Screen Fidelity: Schema directly drives Screen 1 (Requests), Screen 2 (Services),
--      Screen 3 (Change & Cease), Screen 4 (Workflows), Screen 5 (Catalog), Screen 6 (Resource Pools),
--      and the Request Detail Runs & Drawer diagnostics!
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS RUN_TASK;
DROP TABLE IF EXISTS ACTIVATION_RUN;
DROP TABLE IF EXISTS REQUEST_ATTEMPT;
DROP TABLE IF EXISTS DEVICE_EXECUTION_QUEUE;
DROP TABLE IF EXISTS REQUEST_DELTA;
DROP TABLE IF EXISTS REQUEST_PARAM_VALUE;
DROP TABLE IF EXISTS SERVICE_HISTORY;
DROP TABLE IF EXISTS SERVICE_ATTRIBUTE;
DROP TABLE IF EXISTS SERVICE_ENDPOINT;
DROP TABLE IF EXISTS SERVICE_REVISION;
DROP TABLE IF EXISTS PROVISIONING_REQUEST;
DROP TABLE IF EXISTS SERVICE;
DROP TABLE IF EXISTS RESOURCE_POOL_ENTRY;
DROP TABLE IF EXISTS RESOURCE_POOL;
DROP TABLE IF EXISTS TASK_VALIDATION_RULE;
DROP TABLE IF EXISTS WORKFLOW_TASK;
DROP TABLE IF EXISTS WORKFLOW_STAGE;
DROP TABLE IF EXISTS WORKFLOW_SUPPORTED_MODEL;
DROP TABLE IF EXISTS WORKFLOW_REQUIRED_PARAM;
DROP TABLE IF EXISTS WORKFLOW;
DROP TABLE IF EXISTS INTENT_PARAM_SPEC;
DROP TABLE IF EXISTS SERVICE_INTENT;
DROP TABLE IF EXISTS PROFILE_TYPE;
DROP TABLE IF EXISTS NETWORK_ELEMENT;
DROP TABLE IF EXISTS `USER`;

-- ----------------------------------------------------------------------------
-- 1. USER & PLATFORM CDC SYNC MODULE
-- ----------------------------------------------------------------------------

-- Central Platform Sync: Engineers synced from corporate Platform via CDC (Kafka / Webhook)
CREATE TABLE `USER` (
    ID                      BIGINT UNSIGNED NOT NULL COMMENT 'TSID / Platform Primary Key: 64-bit unique engineer ID',
    USERNAME                VARCHAR(64) NOT NULL UNIQUE COMMENT 'Corporate login handle (e.g. ravi.k, priya.s)',
    FULL_NAME               VARCHAR(128) NOT NULL COMMENT 'Full display name of engineer (e.g. Ravi K., Priya S.)',
    EMAIL                   VARCHAR(128) NOT NULL UNIQUE COMMENT 'Corporate email for notification alerts',
    ROLE_CODE               ENUM('ADMIN', 'NOC_LEAD', 'OPERATOR', 'ARCHITECT') NOT NULL DEFAULT 'OPERATOR' COMMENT 'Role code synced from platform',
    DEPARTMENT              VARCHAR(64) NOT NULL DEFAULT 'NOC Operations' COMMENT 'Organizational unit / team',
    IS_ACTIVE               BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Account active status',
    LAST_LOGIN_TIME         DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp of latest platform authentication',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_USR_CUSTOMER (CUSTOMER_ID, IS_DELETED),
    INDEX IDX_USR_ROLE (ROLE_CODE),
    CONSTRAINT FK_USR_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_USR_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Engineers synced from platform via CDC who operate, approve, or execute workflows';

-- ----------------------------------------------------------------------------
-- 2. NETWORK INVENTORY MODULE
-- ----------------------------------------------------------------------------

-- Network Elements: Physical and virtual routers, switches, OLTs, and CPEs.
-- Directly models the hardware estate from UI catalog.ts (ASR9006, MX204, 7750 SR, NCS-540, etc.).
CREATE TABLE NETWORK_ELEMENT (
    ID                      BIGINT UNSIGNED NOT NULL COMMENT 'TSID Primary Key: 64-bit time-sorted ID crossing service boundaries',
    DEVICE_NAME             VARCHAR(128) NOT NULL UNIQUE COMMENT 'Hostname of device in network (e.g. ASR9k-MUM-PE01, MX204-BLR-PE02)',
    SITE_CODE               VARCHAR(32) NOT NULL COMMENT 'Physical telecom site location (e.g. MH-MUM-0301, DL-BLR-0412)',
    CITY                    VARCHAR(64) NOT NULL DEFAULT 'Mumbai' COMMENT 'Site metropolitan city (e.g. Mumbai, Bengaluru, Pune, Chennai)',
    REGION                  ENUM('North', 'South', 'East', 'West') NOT NULL DEFAULT 'West' COMMENT 'Telecom operational region',
    VENDOR                  VARCHAR(64) NOT NULL COMMENT 'Manufacturer / hardware vendor name (e.g. CISCO, JUNIPER, NOKIA)',
    MODEL                   VARCHAR(64) NOT NULL COMMENT 'Chassis hardware model: ASR9006, MX204, 7750 SR-1, NCS-540, ISAM FX-16',
    DEVICE_KIND             ENUM('Router', 'Switch', 'CPE', 'Radio', 'Optical', 'VNF', 'OLT', 'ONT') NOT NULL DEFAULT 'Router' COMMENT 'Device classification',
    MANAGEMENT_IP           VARCHAR(45) NOT NULL COMMENT 'IPv4/IPv6 address used by background workers for SSH/Netconf execution',
    OS_VERSION              VARCHAR(64) NULL DEFAULT NULL COMMENT 'Firmware release (IOS-XR 7.9.2, JunOS 22.4R3, SR OS 23.7.R1)',
    ADMIN_STATE             ENUM('In Service', 'Maintenance', 'Retired') NOT NULL DEFAULT 'In Service' COMMENT 'Inventory lifecycle state',
    OPER_STATE              ENUM('Up', 'Down', 'Degraded') NOT NULL DEFAULT 'Up' COMMENT 'Observed telemetry state polled from network',
    LAST_DISCOVERED_TIME    DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp of latest network discovery/CDC scan',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_NE_CUSTOMER (CUSTOMER_ID, IS_DELETED),
    INDEX IDX_NE_SITE (SITE_CODE),
    INDEX IDX_NE_VENDOR_KIND (VENDOR, DEVICE_KIND),
    INDEX IDX_NE_OPER (OPER_STATE),
    CONSTRAINT FK_NE_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_NE_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Physical and virtual network elements provisioned by the orchestrator';

-- ----------------------------------------------------------------------------
-- 3. PRODUCT CATALOG, SERVICE INTENTS & WORKFLOW TEMPLATES (CONFIGURE)
-- ----------------------------------------------------------------------------

-- Master 3-tier product taxonomy hierarchy displayed on Screen 5: Profile Types
-- Domain is strictly validated as an ENUM. Creator is linked via CREATOR FK to USER(ID) (no redundant creator_name string).
CREATE TABLE PROFILE_TYPE (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for profile type',
    DOMAIN                  ENUM('Transport', 'Access', 'Radio', 'Fiber') NOT NULL COMMENT 'Telecom domain: Transport, Access, Radio, Fiber',
    CATEGORY                VARCHAR(32) NOT NULL COMMENT 'Product category: L2VPN, L3VPN, IBW, VLAN, Microwave, DWDM, RAN VNF, GPON',
    TYPE                    VARCHAR(64) NOT NULL COMMENT 'Functional topology: Point-to-point, Hub & Spoke, Fully-Mesh, BGP, Transparent',
    SUBTYPE                 VARCHAR(64) NOT NULL COMMENT 'Encapsulation flavor: Tagged, Untagged, VRF, BGP, Other, Residential, Business',
    DESCRIPTION             TEXT NULL COMMENT 'Technical specification note displayed in Screen 5',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_PROFILE_HIERARCHY (CUSTOMER_ID, CATEGORY, TYPE, SUBTYPE),
    INDEX IDX_PROF_DOMAIN (CUSTOMER_ID, DOMAIN, CATEGORY),
    CONSTRAINT FK_PROF_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_PROF_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Master 3-tier product taxonomy hierarchy (Screen 5 Catalog)';

-- Service Intent Catalog: Blueprint contracts defining network topology & endpoint cardinality
-- Directly matches INTENTS array in catalog.ts and ServiceIntents.tsx UI
CREATE TABLE SERVICE_INTENT (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for service intent contract',
    INTENT_CODE             VARCHAR(64) NOT NULL UNIQUE COMMENT 'Public contract code: INT-IBW-ACCESS, INT-L2-P2P, INT-L3-HUBSPOKE, INT-GPON-RESI',
    PROFILE_TYPE_ID_FK      INT UNSIGNED NOT NULL COMMENT 'FK to master PROFILE_TYPE (Derives Domain, Category, Type, Subtype)',
    NAME                    VARCHAR(128) NOT NULL COMMENT 'Descriptive title shared across all versions: L3VPN Hub & Spoke, L2VPN Point-to-point',
    TOPOLOGY                ENUM('Single-ended', 'Two-ended', 'Star', 'Full mesh') NOT NULL DEFAULT 'Two-ended' COMMENT 'Topology',
    ENDPOINT_ARITY          VARCHAR(64) NOT NULL DEFAULT 'exactly 2' COMMENT 'Endpoint requirement: exactly 1, exactly 2, 1 hub + 1…n spokes',
    VERSION                 INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Intent contract revision',
    STATE                   ENUM('Draft', 'Active', 'Retired') NOT NULL DEFAULT 'Draft' COMMENT 'Contract lifecycle state: Draft (authoring), Active (selectable), Retired (frozen)',
    LIVE_SERVICES_COUNT     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Number of live services bound to this contract',
    DESCRIPTION             TEXT NULL COMMENT 'Architectural description of service contract',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_INTENT_CUSTOMER (CUSTOMER_ID, IS_DELETED),
    INDEX IDX_INTENT_NAME_VER (NAME, VERSION),
    INDEX IDX_INTENT_STATE (STATE),
    INDEX IDX_INTENT_PROFILE (PROFILE_TYPE_ID_FK),
    CONSTRAINT FK_INT_PROFILE FOREIGN KEY (PROFILE_TYPE_ID_FK) REFERENCES PROFILE_TYPE (ID) ON DELETE RESTRICT,
    CONSTRAINT FK_INT_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_INT_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Service Catalog contracts defining parameters, topology, and endpoint requirements';

-- Intent Parameter Specifications: Parameters needed to fulfill an intent (with Min/Max ranges & enum options)
CREATE TABLE INTENT_PARAM_SPEC (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for intent parameter specification',
    SERVICE_INTENT_ID_FK    INT UNSIGNED NOT NULL COMMENT 'FK to parent SERVICE_INTENT',
    SEQUENCE                INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Display/form ordering sequence (UI reorder up/down)',
    PARAM_NAME              VARCHAR(64) NOT NULL COMMENT 'Parameter name: bandwidth_mbps, vlan, vrf, mtu, ip_block, rd, rt_import',
    PARAM_TYPE              ENUM('integer', 'string', 'boolean', 'ipv4', 'enum') NOT NULL COMMENT 'Data type',
    OPTIONS_CSV             VARCHAR(512) NULL DEFAULT NULL COMMENT 'Comma-separated options for enum type (e.g. tagged, transparent)',
    MIN_VALUE               VARCHAR(64) NULL DEFAULT NULL COMMENT 'Minimum allowable value/range (e.g. 1 for Bandwidth, 2 for VLAN)',
    MAX_VALUE               VARCHAR(64) NULL DEFAULT NULL COMMENT 'Maximum allowable value/range (e.g. 10000 for Bandwidth, 4094 for VLAN)',
    CONSTRAINT_EXPR         VARCHAR(255) NULL COMMENT 'Validation rule/regex note (e.g. 2–4094 · from pool · unique per port)',
    MODIFIABLE              ENUM('hitless', 'bounce', 'recreate', 'no') NOT NULL DEFAULT 'hitless' COMMENT 'Day-2 modify behavior',
    FROM_POOL_KIND          ENUM('VLAN', 'RD/RT', 'Pseudowire ID', 'IP block', 'Sub-interface', 'ASN slot', 'CPE Serial', 'Frequency Channel', 'Wavelength', 'PCI', 'ONT Serial', 'PON Port') NULL DEFAULT NULL COMMENT 'Pool type if auto-allocated (12 UI pools)',
    IS_REQUIRED             BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Mandatory flag in UI Wizard Step 3',
    DEFAULT_VALUE           VARCHAR(255) NULL DEFAULT NULL COMMENT 'Default value if not specified (e.g. 100, 1500, tagged)',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_INTENT_PARAM (SERVICE_INTENT_ID_FK, PARAM_NAME),
    INDEX IDX_IPS_SEQ (SERVICE_INTENT_ID_FK, SEQUENCE),
    CONSTRAINT FK_IPS_INTENT FOREIGN KEY (SERVICE_INTENT_ID_FK) REFERENCES SERVICE_INTENT (ID) ON DELETE CASCADE,
    CONSTRAINT FK_IPS_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_IPS_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Dynamic parameter schemas driving Wizard Step 3 forms with min/max range limits';

-- Workflow CLI Recipes: Screen 4 Workflows. Profile taxonomy derived via SERVICE_INTENT.PROFILE_TYPE_ID_FK.
CREATE TABLE WORKFLOW (
    ID                      BIGINT UNSIGNED NOT NULL COMMENT 'TSID Primary Key: 64-bit time-sorted ID crossing service boundaries',
    CODE                    VARCHAR(32) NOT NULL UNIQUE COMMENT 'Public human-readable code (e.g. CF-000248)',
    SERVICE_INTENT_ID_FK    INT UNSIGNED NOT NULL COMMENT 'FK to SERVICE_INTENT contract (derives master PROFILE_TYPE)',
    NAME                    VARCHAR(128) NOT NULL UNIQUE COMMENT 'Full composite title: Category | Type | Subtype | Vendor | Role',
    DISPLAY_NAME            VARCHAR(128) NOT NULL COMMENT 'Short display title shown in navigation breadcrumbs',
    VENDOR                  VARCHAR(64) NOT NULL COMMENT 'Hardware vendor CLI target (e.g. CISCO, JUNIPER, NOKIA, HUAWEI, etc.)',
    DEVICE_KIND             ENUM('Router', 'Switch', 'CPE', 'Radio', 'Optical', 'VNF', 'OLT', 'ONT') NOT NULL DEFAULT 'Router' COMMENT 'Device classification (8 UI kinds)',
    OS_RANGE                VARCHAR(128) NULL DEFAULT NULL COMMENT 'Supported device OS range (e.g. 7.3 – 7.11, JunOS 21.4R – 23.4R)',
    ENDPOINT_ROLE           ENUM('Source', 'Destination', 'Hub', 'Spoke', 'A', 'Z') NULL DEFAULT NULL COMMENT 'Role',
    STATE                   ENUM('Draft', 'Assigned', 'Awaiting approval', 'Active', 'Rejected', 'Retired') NOT NULL DEFAULT 'Draft' COMMENT 'Template state',
    OPERATION               ENUM('Create', 'Modify', 'Suspend', 'Resume', 'Cease', 'Re-prove') NOT NULL DEFAULT 'Create' COMMENT 'Lifecycle operation target (Create for provisioning; Modify/Suspend/Cease for Day-2)',
    VERSION                 INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Workflow template revision version',
    RUNS_30D                INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Number of execution runs in past 30 days',
    FIRST_PASS_RATE         DECIMAL(5,2) NOT NULL DEFAULT 0.00 COMMENT 'Percentage of successful first attempts',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_WF_CUSTOMER (CUSTOMER_ID, IS_DELETED),
    INDEX IDX_WF_INTENT_VENDOR (SERVICE_INTENT_ID_FK, VENDOR),
    INDEX IDX_WF_OP_VENDOR (OPERATION, VENDOR, STATE),
    INDEX IDX_WF_STATE (STATE),
    CONSTRAINT FK_WF_INTENT FOREIGN KEY (SERVICE_INTENT_ID_FK) REFERENCES SERVICE_INTENT (ID) ON DELETE RESTRICT,
    CONSTRAINT FK_WF_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_WF_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Master CLI workflow template recipes displayed on Screen 4: Workflows';

-- Hardware Chassis Matrix: Maps a workflow to multiple hardware chassis models (models[] in UI)
CREATE TABLE WORKFLOW_SUPPORTED_MODEL (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key',
    WORKFLOW_ID_FK          BIGINT UNSIGNED NOT NULL COMMENT 'FK to parent WORKFLOW',
    MODEL_NAME              VARCHAR(64) NOT NULL COMMENT 'Chassis model name (e.g. ASR9006, ASR-9010, MX204)',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_WF_MODEL (WORKFLOW_ID_FK, MODEL_NAME),
    CONSTRAINT FK_WSM_WF FOREIGN KEY (WORKFLOW_ID_FK) REFERENCES WORKFLOW (ID) ON DELETE CASCADE,
    CONSTRAINT FK_WSM_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_WSM_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Hardware chassis model matrix supported by a CLI workflow template';

-- Workflow Required Parameters: Many-to-many junction mapping workflow templates to required intent parameter specs
CREATE TABLE WORKFLOW_REQUIRED_PARAM (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for required param mapping',
    WORKFLOW_ID_FK          BIGINT UNSIGNED NOT NULL COMMENT 'FK to parent WORKFLOW (TSID)',
    INTENT_PARAM_SPEC_ID_FK INT UNSIGNED NOT NULL COMMENT 'FK to required INTENT_PARAM_SPEC',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_WRP_MAPPING (WORKFLOW_ID_FK, INTENT_PARAM_SPEC_ID_FK),
    INDEX IDX_WRP_PARAM (INTENT_PARAM_SPEC_ID_FK),
    CONSTRAINT FK_WRP_WF FOREIGN KEY (WORKFLOW_ID_FK) REFERENCES WORKFLOW (ID) ON DELETE CASCADE,
    CONSTRAINT FK_WRP_IPS FOREIGN KEY (INTENT_PARAM_SPEC_ID_FK) REFERENCES INTENT_PARAM_SPEC (ID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Many-to-many junction mapping workflow templates to required intent parameter specifications';

-- Workflow Stages: Pipeline nodes (Pre Validation -> Configuration -> Post Validation)
CREATE TABLE WORKFLOW_STAGE (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for workflow stage',
    WORKFLOW_ID_FK          BIGINT UNSIGNED NOT NULL COMMENT 'FK to parent WORKFLOW',
    NAME                    VARCHAR(64) NOT NULL COMMENT 'Technical stage category name (e.g. Set service configuration)',
    DISPLAY_NAME            VARCHAR(64) NOT NULL COMMENT 'Title displayed on canvas (e.g. Set VRF Configuration)',
    KIND                    ENUM('Pre validation', 'Configuration', 'Post validation') NOT NULL COMMENT 'Stage classification',
    SEQUENCE                INT UNSIGNED NOT NULL COMMENT 'Sequential execution order: 1, 2, 3',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_WF_STAGE_SEQ (WORKFLOW_ID_FK, SEQUENCE),
    CONSTRAINT FK_STAGE_WF FOREIGN KEY (WORKFLOW_ID_FK) REFERENCES WORKFLOW (ID) ON DELETE CASCADE,
    CONSTRAINT FK_STAGE_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_STAGE_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Ordered stages in a workflow pipeline';

-- Workflow Tasks: Atomic CLI tasks with selective rollback, stop-rollback breaker, retries, and UI flags
CREATE TABLE WORKFLOW_TASK (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for task definition',
    WORKFLOW_STAGE_ID_FK    INT UNSIGNED NOT NULL COMMENT 'FK to parent WORKFLOW_STAGE',
    NAME                    VARCHAR(128) NOT NULL COMMENT 'Technical task name',
    DISPLAY_NAME            VARCHAR(128) NOT NULL COMMENT 'Human-readable title displayed in task tree',
    SEQUENCE                INT UNSIGNED NOT NULL COMMENT 'Execution order within its stage',
    KIND                    ENUM('read', 'write') NOT NULL DEFAULT 'read' COMMENT 'Operation kind: read (show) or write (config push)',
    SET_COMMAND             TEXT NOT NULL COMMENT 'CLI command template containing ${Parameter} placeholders sent to router',
    IS_ROLLBACK_ENABLED     BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Flag enabling rollback execution if downstream fails',
    ROLLBACK_TEMPLATE       TEXT NULL COMMENT 'Inverse/undo CLI command template executed on rollback',
    IS_ROLLBACK_STOP_POINT  BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Stop-Rollback Breaker: Backwards rollback sequence halts here and will not roll back prior tasks',
    SKIP_ALLOWED            BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'UI behavior flag: Is skip allowed on this task',
    MANUAL_COMPLETE_ALLOWED BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'UI behavior flag: Is manual complete required/allowed',
    MAX_RETRY_COUNT         INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Number of automated retries before declaring failure',
    RETRY_INTERVAL_SECONDS  INT UNSIGNED NOT NULL DEFAULT 5 COMMENT 'Seconds to wait between retry attempts',
    TIMEOUT_MS              INT UNSIGNED NOT NULL DEFAULT 60000 COMMENT 'Timeout limit in milliseconds for router response',
    DELAY_MS                INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Delay in milliseconds before task execution',
    AFFECTS_ATTRIBUTE       VARCHAR(64) NULL DEFAULT NULL COMMENT 'Attribute altered (Bandwidth, VRF, Interface) for Delta Diff Engine',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_STAGE_TASK_SEQ (WORKFLOW_STAGE_ID_FK, SEQUENCE),
    INDEX IDX_TASK_AFFECTS (AFFECTS_ATTRIBUTE),
    CONSTRAINT FK_TASK_STAGE FOREIGN KEY (WORKFLOW_STAGE_ID_FK) REFERENCES WORKFLOW_STAGE (ID) ON DELETE CASCADE,
    CONSTRAINT FK_TASK_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_TASK_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Atomic CLI task definitions containing command templates, rollback breakers, and retry controls';

-- Task Validation Rules: Multi-operator output assertions matching UI VALIDATION_TYPES
CREATE TABLE TASK_VALIDATION_RULE (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for validation rule',
    WORKFLOW_TASK_ID_FK     INT UNSIGNED NOT NULL COMMENT 'FK to target WORKFLOW_TASK',
    SEQUENCE                INT UNSIGNED NOT NULL COMMENT 'Rule evaluation order',
    JOIN_TYPE               ENUM('AND', 'OR') NOT NULL DEFAULT 'AND' COMMENT 'Boolean combinator',
    OPERATOR                ENUM('CONTAINS', 'NOT_CONTAINS', 'EQUALS', 'NOT_EQUALS', 'REGEX_MATCH', 'NOT_EMPTY') NOT NULL DEFAULT 'CONTAINS' COMMENT 'Assertion operator',
    EXPECTED_VALUE          VARCHAR(255) NOT NULL COMMENT 'Search literal or regular expression pattern evaluated against router response',
    IS_ROLLBACK_RULE        BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'True if rule tests rollback output; False if forward setCommand',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    CONSTRAINT FK_RULE_TASK FOREIGN KEY (WORKFLOW_TASK_ID_FK) REFERENCES WORKFLOW_TASK (ID) ON DELETE CASCADE,
    CONSTRAINT FK_RULE_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_RULE_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Assertion rules evaluated against router CLI output string to determine task pass/fail';

-- ----------------------------------------------------------------------------
-- 4. RESOURCE POOLS & ALLOCATION MODULE
-- ----------------------------------------------------------------------------

-- Resource Pools: Addressable capacity containers displayed on Screen 6: Resource Pools
-- Models SEEDS in misc.ts: POOL-VLAN-001, POOL-IP-001, POOL-PWID-001, POOL-RDRT-001, POOL-ASN-001, etc.
CREATE TABLE RESOURCE_POOL (
    ID                      BIGINT UNSIGNED NOT NULL COMMENT 'TSID Primary Key: 64-bit time-sorted ID crossing service boundaries',
    CODE                    VARCHAR(32) NOT NULL UNIQUE COMMENT 'Public pool code (e.g. POOL-VLAN-001, POOL-IP-001, POOL-PWID-001)',
    KIND                    ENUM('VLAN', 'IP block', 'RD/RT', 'Pseudowire ID', 'Sub-interface', 'ASN slot', 'CPE Serial', 'Wavelength', 'PCI') NOT NULL COMMENT 'Value kind',
    SCOPE                   VARCHAR(128) NOT NULL COMMENT 'Applicability boundary: Global, or site/port scoped (e.g. DL-BLR-0412 · xe-0/0/0)',
    TOTAL_CAPACITY          INT UNSIGNED NOT NULL COMMENT 'Total addressable capacity count',
    ALLOCATED_COUNT         INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Count of values committed to live circuits',
    QUARANTINED_COUNT       INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Count of values in quarantine hold',
    RESERVED_COUNT          INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Count of values locked by in-flight requests',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_POOL_CUSTOMER (CUSTOMER_ID, IS_DELETED),
    INDEX IDX_POOL_KIND_SCOPE (KIND, SCOPE),
    CONSTRAINT FK_POOL_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_POOL_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Network resource ranges managed on Screen 6: Resource Pools';

-- Resource Pool Entries: Discrete values inside pool (VLAN 104, IP 10.244.0.0/30, 65001:1001)
CREATE TABLE RESOURCE_POOL_ENTRY (
    ID                          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for individual value',
    RESOURCE_POOL_ID_FK         BIGINT UNSIGNED NOT NULL COMMENT 'FK to parent RESOURCE_POOL',
    RESOURCE_VALUE              VARCHAR(64) NOT NULL COMMENT 'Concrete value dispensed to router (e.g. 104, 10.244.0.0/30)',
    STATE                       ENUM('Free', 'Allocated', 'Quarantined', 'Reserved') NOT NULL DEFAULT 'Free' COMMENT 'Allocation state',
    SERVICE_ID_FK               VARCHAR(36) NULL DEFAULT NULL COMMENT 'UUID v7 FK to SERVICE holding this value if Allocated',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NULL DEFAULT NULL COMMENT 'UUID v7 FK to PROVISIONING_REQUEST reserving this value',
    RELEASED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp when service ceased and released value',
    QUARANTINE_UNTIL            DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp when quarantine expires',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_POOL_VALUE (RESOURCE_POOL_ID_FK, RESOURCE_VALUE),
    INDEX IDX_POOL_ALLOC (RESOURCE_POOL_ID_FK, STATE, ID),
    CONSTRAINT FK_ENTRY_POOL FOREIGN KEY (RESOURCE_POOL_ID_FK) REFERENCES RESOURCE_POOL (ID) ON DELETE CASCADE,
    CONSTRAINT FK_ENTRY_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_ENTRY_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Individual addressable units within a pool (VLAN 104, IP 10.1.1.0/30)';

-- ----------------------------------------------------------------------------
-- 5. LIVE SERVICE INSTALLED BASE (OPERATE - INVENTORY)
-- ----------------------------------------------------------------------------

-- Live Services: Permanent operational circuit asset registry displayed on Screen 2: Service Inventory.
-- Fully carries Customer Name/ID, Monthly INR revenue, Bandwidth, and Conformance Telemetry.
CREATE TABLE SERVICE (
    ID                      VARCHAR(36) NOT NULL COMMENT 'UUID v7 Primary Key: Public circuit identifier in UI (e.g. SVC-L3-010412, SVC-L2-018842)',
    SERVICE_CODE            VARCHAR(32) NOT NULL UNIQUE COMMENT 'Commercial service code (e.g. NS-000114)',
    NAME                    VARCHAR(128) NOT NULL COMMENT 'Customer circuit title (e.g. Excitel HQ Primary WAN, HDFC Bank ATM Corporate WAN)',
    ACCOUNT_ID              VARCHAR(64) NOT NULL DEFAULT 'ACC-04417' COMMENT 'Customer billing account ID (e.g. ACC-04417, ACC-00218, ACC-00031)',
    ACCOUNT_NAME            VARCHAR(128) NOT NULL DEFAULT 'Excitel Business Solutions' COMMENT 'Customer corporate name displayed in UI Customer column',
    PROFILE_TYPE_ID_FK      INT UNSIGNED NULL DEFAULT NULL COMMENT 'FK to master PROFILE_TYPE (Derives Category, Type, Subtype)',
    SERVICE_INTENT_ID_FK    INT UNSIGNED NULL DEFAULT NULL COMMENT 'FK to SERVICE_INTENT contract',
    SERVICE_STATE           ENUM('Designed', 'Activating', 'Live', 'Degraded', 'Suspended', 'Ceased', 'Purged') NOT NULL DEFAULT 'Live' COMMENT 'Contract state',
    OPER_STATE              ENUM('Up', 'Down', 'Degraded', 'Unknown') NOT NULL DEFAULT 'Up' COMMENT 'Observed telemetry state polled from router',
    CONFORMANCE             ENUM('Conformant', 'Drifted', 'Never proven', 'Ghost', 'Not checked') NOT NULL DEFAULT 'Conformant' COMMENT 'Verdict',
    DRIFT_COUNT             INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Count of attribute discrepancies between DB and physical router (displayed as ×N badge)',
    BANDWIDTH_MBPS          INT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Committed bandwidth throughput in Mbps',
    MONTHLY_VALUE_INR       DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Monthly recurring revenue in INR (rendered as ₹XX,XXX/mo on Screen 2)',
    LIVE_SINCE              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'Timestamp when service originally went Live (drives Age column)',
    LAST_PROVEN_TIME        DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp when latest audit or re-prove verification passed (drives Last Proven column)',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_SVC_CUSTOMER (CUSTOMER_ID, IS_DELETED),
    INDEX IDX_SVC_LIST (SERVICE_STATE, CONFORMANCE, LIVE_SINCE DESC),
    INDEX IDX_SVC_ACCOUNT (ACCOUNT_ID),
    INDEX IDX_SVC_PROFILE (PROFILE_TYPE_ID_FK),
    INDEX IDX_SVC_INTENT (SERVICE_INTENT_ID_FK),
    CONSTRAINT FK_SVC_PROFILE FOREIGN KEY (PROFILE_TYPE_ID_FK) REFERENCES PROFILE_TYPE (ID) ON DELETE SET NULL,
    CONSTRAINT FK_SVC_INTENT FOREIGN KEY (SERVICE_INTENT_ID_FK) REFERENCES SERVICE_INTENT (ID) ON DELETE SET NULL,
    CONSTRAINT FK_SVC_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_SVC_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Permanent live circuit asset registry displayed on Screen 2: Service Inventory';

-- Service Revisions: Day-2 modification history snapshots
CREATE TABLE SERVICE_REVISION (
    ID                          VARCHAR(36) NOT NULL COMMENT 'UUID v7 Primary Key: Unique revision record ID',
    SERVICE_ID_FK               VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent SERVICE',
    REVISION_NUMBER             INT UNSIGNED NOT NULL COMMENT 'Sequential revision number (1 = create, 2 = modify)',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NULL DEFAULT NULL COMMENT 'UUID v7 FK to PROVISIONING_REQUEST that produced this revision',
    CHANGE_SUMMARY              TEXT NOT NULL COMMENT 'Diff description (e.g. Bandwidth 100 Mbps -> 500 Mbps)',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp when revision went live',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record update timestamp',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_SVC_REVISION (SERVICE_ID_FK, REVISION_NUMBER),
    CONSTRAINT FK_REV_SERVICE FOREIGN KEY (SERVICE_ID_FK) REFERENCES SERVICE (ID) ON DELETE CASCADE,
    CONSTRAINT FK_REV_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_REV_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Historical versioning snapshots of service changes across Day-2 modifications';

-- Service Endpoints: Unified endpoint table.
-- Links directly to NETWORK_ELEMENT_ID_FK without duplicating device properties (Site, IP, Vendor are derived from router).
CREATE TABLE SERVICE_ENDPOINT (
    ID                          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for circuit endpoint',
    SERVICE_ID_FK               VARCHAR(36) NULL DEFAULT NULL COMMENT 'UUID v7 FK to parent SERVICE (Populated when Live)',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NULL DEFAULT NULL COMMENT 'UUID v7 FK to parent PROVISIONING_REQUEST (Populated during in-flight execution)',
    ROLE                        ENUM('Source', 'Destination', 'Hub', 'Spoke', 'A', 'Z') NOT NULL COMMENT 'Endpoint role',
    NETWORK_ELEMENT_ID_FK       BIGINT UNSIGNED NOT NULL COMMENT 'TSID FK to terminating NETWORK_ELEMENT (Router derives Site, IP, Vendor)',
    PORT_NAME                   VARCHAR(64) NOT NULL COMMENT 'Physical port name on router (e.g. TenGigE0/0/0/3, xe-0/0/3, 1/1/c1/1)',
    SUB_INTERFACE               VARCHAR(64) NULL DEFAULT NULL COMMENT 'Logical sub-interface (e.g. TenGigE0/0/0/3.104, xe-0/0/3.104)',
    WORKFLOW_ID_FK              BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'TSID FK to specific workflow for this endpoint',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_SEP_CUSTOMER (CUSTOMER_ID, IS_DELETED),
    INDEX IDX_SEP_SERVICE (SERVICE_ID_FK),
    INDEX IDX_SEP_REQ (PROVISIONING_REQUEST_ID_FK),
    INDEX IDX_SEP_NE (NETWORK_ELEMENT_ID_FK),
    CONSTRAINT FK_SEP_SERVICE FOREIGN KEY (SERVICE_ID_FK) REFERENCES SERVICE (ID) ON DELETE CASCADE,
    CONSTRAINT FK_SEP_NE FOREIGN KEY (NETWORK_ELEMENT_ID_FK) REFERENCES NETWORK_ELEMENT (ID) ON DELETE RESTRICT,
    CONSTRAINT FK_SEP_WF FOREIGN KEY (WORKFLOW_ID_FK) REFERENCES WORKFLOW (ID) ON DELETE SET NULL,
    CONSTRAINT FK_SEP_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_SEP_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Unified termination router endpoints for provisioning requests and live services';

-- Service Attributes: Intent vs Realised comparison matrix for automated drift detection (Service Detail Realised tab)
CREATE TABLE SERVICE_ATTRIBUTE (
    ID                      INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for attribute record',
    SERVICE_ID_FK           VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent SERVICE',
    ATTRIBUTE_NAME          VARCHAR(64) NOT NULL COMMENT 'Parameter name: Service type, Bandwidth, MTU, VLAN, Route distinguisher, PE-CE protocol',
    INTENT_VALUE            TEXT NOT NULL COMMENT 'Contracted value recorded in DB intent (e.g. 100 Mbps, 65001:104)',
    ON_DEVICE_VALUE         TEXT NULL COMMENT 'Actual value read from router running config by CDC poller',
    SOURCE_SYSTEM           ENUM('Order', 'Reserved', 'Derived', 'Discovered', 'Manual', 'Inventory') NOT NULL DEFAULT 'Order' COMMENT 'Origin',
    VERDICT                 ENUM('Match', 'Drift', 'Absent', 'Not checked') NOT NULL DEFAULT 'Not checked' COMMENT 'Outcome: Match, Drift, Absent, Not checked',
    VERIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp of latest comparison check',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_SVA_LOOKUP (SERVICE_ID_FK, VERDICT),
    CONSTRAINT FK_SVA_SERVICE FOREIGN KEY (SERVICE_ID_FK) REFERENCES SERVICE (ID) ON DELETE CASCADE,
    CONSTRAINT FK_SVA_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_SVA_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Intent vs Realised attribute matrix for automated drift detection';

-- Service History: Chronological audit trail comparing portal changes vs out-of-band CLI edits (Service Detail History tab)
CREATE TABLE SERVICE_HISTORY (
    ID                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal PK for unbounded append-only audit log',
    SERVICE_ID_FK               VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent SERVICE',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NULL DEFAULT NULL COMMENT 'UUID v7 FK to PROVISIONING_REQUEST if raised via portal; NULL if CLI edit',
    CHANGE_DESCRIPTION          TEXT NOT NULL COMMENT 'Summary of change performed on the circuit (e.g. Created · service went Live)',
    IS_OUT_OF_BAND              BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'True if edited directly on router CLI bypassing orchestrator',
    OCCURRED_TIME               DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'Timestamp when change took place',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_HIST_SERVICE (SERVICE_ID_FK, OCCURRED_TIME DESC),
    CONSTRAINT FK_SVH_SERVICE FOREIGN KEY (SERVICE_ID_FK) REFERENCES SERVICE (ID) ON DELETE CASCADE,
    CONSTRAINT FK_SVH_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_SVH_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Chronological change audit trail comparing portal changes vs out-of-band CLI edits';

-- ----------------------------------------------------------------------------
-- 6. PROVISIONING REQUESTS & EXECUTION ENGINE (OPERATE - REQUESTS & CHANGES)
-- ----------------------------------------------------------------------------

-- Provisioning Requests: In-flight execution orders displayed on Screen 1: Requests & Screen 3: Change & Cease.
-- Holds ORDER_ID for external OMS Feign client calls, Customer Name/ID for UI display, and lifecycle states.
CREATE TABLE PROVISIONING_REQUEST (
    ID                      VARCHAR(36) NOT NULL COMMENT 'UUID v7 Primary Key: Public request ID in UI (e.g. ORD-2026-004417, ORD-2026-004412)',
    REQUEST_CODE            VARCHAR(32) NOT NULL UNIQUE COMMENT 'Tracking code shown in UI Subtitle (e.g. NS-000114, NS-000118)',
    ORDER_ID                VARCHAR(64) NULL DEFAULT NULL COMMENT 'External Order Management System (OMS) Order ID accessed via Feign client',
    SERVICE_CODE            VARCHAR(32) NOT NULL COMMENT 'Commercial service code (e.g. NS-000114)',
    SERVICE_NAME            VARCHAR(128) NOT NULL COMMENT 'Circuit descriptive label (e.g. Excitel Branch Interconnect, RailTel High-Speed Lease)',
    ACCOUNT_ID              VARCHAR(64) NOT NULL DEFAULT 'ACC-04417' COMMENT 'Customer account ID (e.g. ACC-04417, ACC-00218)',
    ACCOUNT_NAME            VARCHAR(128) NOT NULL DEFAULT 'Excitel Business Solutions' COMMENT 'Customer company name shown in UI Customer column',
    PROFILE_TYPE_ID_FK      INT UNSIGNED NULL DEFAULT NULL COMMENT 'FK to master PROFILE_TYPE (Derives Category, Type, Subtype)',
    SERVICE_INTENT_ID_FK    INT UNSIGNED NULL DEFAULT NULL COMMENT 'FK to SERVICE_INTENT contract',
    INTENT                  ENUM('Create', 'Modify', 'Suspend', 'Resume', 'Cease', 'Re-prove') NOT NULL DEFAULT 'Create' COMMENT 'Action',
    REASON_CATEGORY         VARCHAR(128) NULL DEFAULT NULL COMMENT 'Structured Day-2 preset reason (e.g. Scheduled customer maintenance window, Churn, Billing arrears)',
    AUDIT_SCOPE             VARCHAR(128) NULL DEFAULT NULL COMMENT 'Verification scope for Re-prove requests (e.g. Full end-to-end, Synthetic SLA probe)',
    TARGET_SERVICE_ID_FK    VARCHAR(36) NULL DEFAULT NULL COMMENT 'UUID v7 FK to SERVICE if this request is Day-2 Modify/Cease',
    REQUEST_STATE           ENUM('Draft', 'Planned', 'Validated', 'Invalid', 'Approved', 'Rejected', 'Queued', 'In progress', 'Ready', 'Failed', 'Reinstantiate') NOT NULL DEFAULT 'Draft' COMMENT 'Lifecycle state',
    WORKFLOW_ID_FK          BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'TSID FK to bound WORKFLOW template',
    OWNER                   VARCHAR(64) NULL DEFAULT NULL COMMENT 'Engineer owner (e.g. Priya S., Ravi K., Anil M.)',
    WAITING_ON              VARCHAR(64) NULL DEFAULT NULL COMMENT 'Stakeholder holding current action (NOC Lead, Worker Queue, Engineering Review)',
    SLA_BREACHED            BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Boolean flag indicating if delivery SLA was breached',
    NOTES                   TEXT NULL COMMENT 'Operator notes or change justification',
    DECOMMISSION_CONFIRMED  BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Audit confirmation flag: True if operator verified customer decommissioning approval for permanent teardown',
    IS_ARCHIVED             BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'True if closed history; False if in-flight active queue',
    -- Inline Approval Lifecycle
    APPROVAL_STATUS         ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED' COMMENT 'Approval status',
    APPROVED_BY_USER_ID_FK  BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'FK to USER who recorded approval decision',
    APPROVED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp of approval decision',
    APPROVAL_COMMENTS       TEXT NULL COMMENT 'Approval justification or rejection reason',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Request creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Request modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_REQ_CUSTOMER (CUSTOMER_ID, IS_DELETED),
    INDEX IDX_REQ_ORDER_EXT (ORDER_ID),
    INDEX IDX_REQ_LIST (IS_ARCHIVED, REQUEST_STATE, CREATED_TIME DESC),
    INDEX IDX_REQ_CHANGE (INTENT, REQUEST_STATE, CREATED_TIME DESC),
    INDEX IDX_REQ_TARGET (TARGET_SERVICE_ID_FK),
    INDEX IDX_REQ_PROFILE (PROFILE_TYPE_ID_FK),
    INDEX IDX_REQ_INTENT (SERVICE_INTENT_ID_FK),
    INDEX IDX_REQ_ACCOUNT (ACCOUNT_ID),
    CONSTRAINT FK_REQ_PROFILE FOREIGN KEY (PROFILE_TYPE_ID_FK) REFERENCES PROFILE_TYPE (ID) ON DELETE SET NULL,
    CONSTRAINT FK_REQ_INTENT FOREIGN KEY (SERVICE_INTENT_ID_FK) REFERENCES SERVICE_INTENT (ID) ON DELETE SET NULL,
    CONSTRAINT FK_REQ_WORKFLOW FOREIGN KEY (WORKFLOW_ID_FK) REFERENCES WORKFLOW (ID) ON DELETE SET NULL,
    CONSTRAINT FK_REQ_TARGET_SVC FOREIGN KEY (TARGET_SERVICE_ID_FK) REFERENCES SERVICE (ID) ON DELETE SET NULL,
    CONSTRAINT FK_REQ_APPROVER FOREIGN KEY (APPROVED_BY_USER_ID_FK) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_REQ_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_REQ_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='In-flight provisioning requests displayed on Screen 1: Requests and Screen 3: Change & Cease';

-- Resolved Parameters: Concrete values dynamically substituted into CLI placeholders (Request Detail Service Tab)
CREATE TABLE REQUEST_PARAM_VALUE (
    ID                          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for parameter record',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent PROVISIONING_REQUEST',
    SERVICE_ENDPOINT_ID_FK      INT UNSIGNED NULL DEFAULT NULL COMMENT 'FK to specific SERVICE_ENDPOINT if localized to router',
    PARAM_NAME                  VARCHAR(64) NOT NULL COMMENT 'Placeholder name: Bandwidth, vlan, vrf, mtu, ip_block, rd, rt',
    PARAM_VALUE                 TEXT NOT NULL COMMENT 'Concrete value: 104, 10.244.0.0/30, 65001:104, 500',
    SOURCE                      ENUM('user', 'template', 'pool', 'derived') NOT NULL DEFAULT 'user' COMMENT 'Origin',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_RPV_REQ (PROVISIONING_REQUEST_ID_FK),
    CONSTRAINT FK_RPV_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE CASCADE,
    CONSTRAINT FK_RPV_ENDPOINT FOREIGN KEY (SERVICE_ENDPOINT_ID_FK) REFERENCES SERVICE_ENDPOINT (ID) ON DELETE CASCADE,
    CONSTRAINT FK_RPV_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_RPV_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Resolved parameter values dynamically substituted into CLI ${Placeholders}';

-- Request Delta Diff: Attribute modifications displayed on Screen 3: Change & Cease
CREATE TABLE REQUEST_DELTA (
    ID                          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal primary key for delta record',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent PROVISIONING_REQUEST',
    ATTRIBUTE_NAME              VARCHAR(64) NOT NULL COMMENT 'Attribute undergoing modification (e.g. Bandwidth, VLAN, MTU)',
    CURRENT_VALUE               VARCHAR(255) NOT NULL COMMENT 'Value running on live router currently (e.g. 100 Mbps)',
    REQUESTED_VALUE             VARCHAR(255) NOT NULL COMMENT 'New requested value (e.g. 500 Mbps)',
    TRAFFIC_IMPACT              ENUM('Hitless', 'Interrupts service') NOT NULL DEFAULT 'Hitless' COMMENT 'Traffic impact badge',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_DEL_REQ (PROVISIONING_REQUEST_ID_FK),
    CONSTRAINT FK_DEL_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE CASCADE,
    CONSTRAINT FK_DEL_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_DEL_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Attribute diff comparison records for Day-2 change requests (Current vs Requested)';

-- Device-Centric Execution Queue: Serializes provisioning execution PER NETWORK ELEMENT.
-- Ensures that only 1 request executes on a given router at a time to prevent CLI session lock collisions.
CREATE TABLE DEVICE_EXECUTION_QUEUE (
    ID                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Internal PK sequence for queue dispatch',
    NETWORK_ELEMENT_ID_FK       BIGINT UNSIGNED NOT NULL COMMENT 'TSID FK to target router (Queue is serialized per device)',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to target PROVISIONING_REQUEST',
    QUEUE_STATUS                ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED' COMMENT 'Status',
    PRIORITY                    INT UNSIGNED NOT NULL DEFAULT 5 COMMENT 'Priority: 1 (Urgent/Emergency), 5 (Normal), 10 (Low)',
    SCHEDULED_TIME              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'Execution window time (enforces maintenance window)',
    LOCKED_BY_WORKER            VARCHAR(64) NULL DEFAULT NULL COMMENT 'Worker thread ID currently executing this request',
    LOCKED_TIME                 DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp when worker acquired device lock',
    RELEASED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Timestamp when worker released device lock',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_DQ_SCHED (NETWORK_ELEMENT_ID_FK, QUEUE_STATUS, PRIORITY, SCHEDULED_TIME),
    INDEX IDX_DQ_REQ (PROVISIONING_REQUEST_ID_FK),
    CONSTRAINT FK_DQUEUE_NE FOREIGN KEY (NETWORK_ELEMENT_ID_FK) REFERENCES NETWORK_ELEMENT (ID) ON DELETE CASCADE,
    CONSTRAINT FK_DQUEUE_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE CASCADE,
    CONSTRAINT FK_DQUEUE_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_DQUEUE_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Per-device execution queue serializing SSH sessions to prevent router CLI locking conflicts';

-- Request Attempts: Groups execution runs per provisioning request (supports retries after failure)
CREATE TABLE REQUEST_ATTEMPT (
    ID                          VARCHAR(36) NOT NULL COMMENT 'UUID v7 Primary Key: Unique attempt record ID',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent PROVISIONING_REQUEST',
    ATTEMPT_NUMBER              INT UNSIGNED NOT NULL COMMENT 'Attempt counter: 1 (first try), 2 (retry after failure)',
    OUTCOME                     ENUM('Running', 'Accepted', 'Failed', 'Rolled back', 'Aborted') NOT NULL DEFAULT 'Running' COMMENT 'Verdict',
    STARTED_TIME                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'Attempt start timestamp',
    ENDED_TIME                  DATETIME(6) NULL DEFAULT NULL COMMENT 'Attempt finish timestamp',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    UNIQUE KEY UK_REQ_ATTEMPT (PROVISIONING_REQUEST_ID_FK, ATTEMPT_NUMBER),
    CONSTRAINT FK_ATT_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE CASCADE,
    CONSTRAINT FK_ATT_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_ATT_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Execution attempts grouping runs per request (supports retries after failure)';

-- Activation Runs: Individual router execution job (One run per endpoint per attempt)
CREATE TABLE ACTIVATION_RUN (
    ID                          VARCHAR(36) NOT NULL COMMENT 'UUID v7 Primary Key: Unique run record ID',
    REQUEST_ATTEMPT_ID_FK       VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent REQUEST_ATTEMPT',
    PROVISIONING_REQUEST_ID_FK  VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent PROVISIONING_REQUEST',
    SERVICE_ENDPOINT_ID_FK      INT UNSIGNED NULL DEFAULT NULL COMMENT 'FK to target SERVICE_ENDPOINT',
    NETWORK_ELEMENT_ID_FK       BIGINT UNSIGNED NOT NULL COMMENT 'TSID FK to target NETWORK_ELEMENT',
    WORKFLOW_ID_FK              BIGINT UNSIGNED NOT NULL COMMENT 'TSID FK to WORKFLOW template executed',
    DIRECTION                   ENUM('forward', 'rollback') NOT NULL DEFAULT 'forward' COMMENT 'Direction',
    OUTCOME                     ENUM('Running', 'Accepted', 'Failed', 'Rolled back', 'Aborted') NOT NULL DEFAULT 'Running' COMMENT 'Outcome',
    STARTED_TIME                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'Start timestamp of SSH session',
    ENDED_TIME                  DATETIME(6) NULL DEFAULT NULL COMMENT 'Finish timestamp of SSH session',
    DURATION_MS                 INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total execution duration in milliseconds',
    DEVICE_CLOCK                DATETIME(6) NULL DEFAULT NULL COMMENT 'Clock time captured on physical router terminal prompt',
    CLOCK_SKEW_MS               INT NOT NULL DEFAULT 0 COMMENT 'Clock skew difference in milliseconds',
    CREATED_TIME                DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME               DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED                  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER               BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID                 INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_RUN_REQ (PROVISIONING_REQUEST_ID_FK),
    INDEX IDX_RUN_ATTEMPT (REQUEST_ATTEMPT_ID_FK),
    CONSTRAINT FK_RUN_ATTEMPT FOREIGN KEY (REQUEST_ATTEMPT_ID_FK) REFERENCES REQUEST_ATTEMPT (ID) ON DELETE CASCADE,
    CONSTRAINT FK_RUN_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE CASCADE,
    CONSTRAINT FK_RUN_ENDPOINT FOREIGN KEY (SERVICE_ENDPOINT_ID_FK) REFERENCES SERVICE_ENDPOINT (ID) ON DELETE SET NULL,
    CONSTRAINT FK_RUN_NE FOREIGN KEY (NETWORK_ELEMENT_ID_FK) REFERENCES NETWORK_ELEMENT (ID) ON DELETE RESTRICT,
    CONSTRAINT FK_RUN_WF FOREIGN KEY (WORKFLOW_ID_FK) REFERENCES WORKFLOW (ID) ON DELETE RESTRICT,
    CONSTRAINT FK_RUN_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_RUN_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Individual router execution job (One run per endpoint per attempt)';

-- Run Tasks: Detailed task-level execution transcript displayed in Request Detail Runs tab & Drawer
CREATE TABLE RUN_TASK (
    ID                      VARCHAR(36) NOT NULL COMMENT 'UUID v7 Primary Key: Unique task transcript record ID',
    ACTIVATION_RUN_ID_FK    VARCHAR(36) NOT NULL COMMENT 'UUID v7 FK to parent ACTIVATION_RUN',
    WORKFLOW_TASK_ID_FK     INT UNSIGNED NULL DEFAULT NULL COMMENT 'FK to original WORKFLOW_TASK definition',
    TASK_NAME               VARCHAR(128) NOT NULL COMMENT 'Task title (e.g. Set Policer & VRF, Check Interface)',
    STAGE_NAME              VARCHAR(64) NOT NULL COMMENT 'Stage title (e.g. Set service configuration, Pre validation)',
    STAGE_KIND              ENUM('Pre validation', 'Configuration', 'Post validation') NOT NULL COMMENT 'Stage classification',
    SEQUENCE                INT UNSIGNED NOT NULL COMMENT 'Execution index within the run',
    TASK_STATE              ENUM('Passed', 'Failed', 'Running', 'Skipped', 'Blocked', 'Not started') NOT NULL DEFAULT 'Not started' COMMENT 'State',
    DIRECTION               ENUM('forward', 'rollback') NOT NULL DEFAULT 'forward' COMMENT 'Direction',
    COMMAND_SENT            TEXT NOT NULL COMMENT 'Exact rendered CLI command sent across SSH channel',
    REQUEST_PAYLOAD         TEXT NULL COMMENT 'JSON/RPC request payload if netconf/restconf',
    RESPONSE_RAW            MEDIUMTEXT NULL COMMENT 'Raw terminal output string returned by router prompt',
    EXIT_CODE               INT NOT NULL DEFAULT 0 COMMENT 'SSH / transport exit status code (0 = success, non-zero = error)',
    PARSED_OUTPUT           TEXT NULL COMMENT 'Parsed verdict or extracted regex group value',
    FAILURE_REASON          TEXT NULL COMMENT 'Explanation of validation rule breach or error if task failed',
    STARTED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Task start timestamp',
    ENDED_TIME              DATETIME(6) NULL DEFAULT NULL COMMENT 'Task completion timestamp',
    DURATION_MS             INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Duration in milliseconds',
    CREATED_TIME            DATETIME(6) NULL DEFAULT NULL COMMENT 'Record creation timestamp (microsecond precision)',
    MODIFIED_TIME           DATETIME(6) NULL DEFAULT NULL COMMENT 'Record modification timestamp (microsecond precision)',
    IS_DELETED              TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Universal Soft-Delete flag: 0=active, 1=deleted',
    CREATOR                 BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who created this record (FK to USER.ID)',
    LAST_MODIFIER           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'User ID who last modified this record (FK to USER.ID)',
    CUSTOMER_ID             INT NULL DEFAULT NULL COMMENT 'Multi-tenant customer / operator partition ID',
    PRIMARY KEY (ID),
    INDEX IDX_RT_RUN_SEQ (ACTIVATION_RUN_ID_FK, SEQUENCE),
    CONSTRAINT FK_RT_RUN FOREIGN KEY (ACTIVATION_RUN_ID_FK) REFERENCES ACTIVATION_RUN (ID) ON DELETE CASCADE,
    CONSTRAINT FK_RT_TASKDEF FOREIGN KEY (WORKFLOW_TASK_ID_FK) REFERENCES WORKFLOW_TASK (ID) ON DELETE SET NULL,
    CONSTRAINT FK_RT_CREATOR FOREIGN KEY (CREATOR) REFERENCES `USER` (ID) ON DELETE SET NULL,
    CONSTRAINT FK_RT_MODIFIER FOREIGN KEY (LAST_MODIFIER) REFERENCES `USER` (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Execution log of an individual task displayed in the Request Detail Runs tab & Drawer';

-- Circular references for resource pool entries and endpoints
ALTER TABLE RESOURCE_POOL_ENTRY
    ADD CONSTRAINT FK_ENTRY_SVC FOREIGN KEY (SERVICE_ID_FK) REFERENCES SERVICE (ID) ON DELETE SET NULL,
    ADD CONSTRAINT FK_ENTRY_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE SET NULL;

-- Endpoint in-flight link back to request
ALTER TABLE SERVICE_ENDPOINT
    ADD CONSTRAINT FK_SEP_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE SET NULL;

-- Revision committed by request
ALTER TABLE SERVICE_REVISION
    ADD CONSTRAINT FK_REV_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE SET NULL;

-- History linked to request
ALTER TABLE SERVICE_HISTORY
    ADD CONSTRAINT FK_SVH_REQ FOREIGN KEY (PROVISIONING_REQUEST_ID_FK) REFERENCES PROVISIONING_REQUEST (ID) ON DELETE SET NULL;

SET FOREIGN_KEY_CHECKS = 1;
