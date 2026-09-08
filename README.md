# LCM Orchestrator

A working React application for zero-touch provisioning and lifecycle management of
network services — L2VPN, L3VPN and IBW. Every screen is interactive against an
in-memory dataset: filters filter, tabs switch, the wizard walks, and a run executes
task by task in front of you. There is no backend.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-check + production bundle into dist/
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
```

Requires Node 20 or 22 (`.nvmrc` pins 22). Node 25 is an odd-numbered non-LTS release
and breaks some native build dependencies.

## Deploy to Vercel

`vercel.json` is committed and the app is ready to deploy as-is.

```bash
npx vercel        # preview deployment
npx vercel --prod # production
```

Or import the repository at vercel.com — the framework preset detects as Vite, the
build command is `npm run build` and the output directory is `dist`. No environment
variables are needed; the dataset is compiled into the bundle.

Routing uses `BrowserRouter`, so URLs are clean paths (`/inventory/SVC-L2-018842`).
`vercel.json` carries the SPA rewrite that makes a hard load or a refresh of any deep
route serve `index.html` instead of 404-ing, plus immutable cache headers on
`/assets/*`.

## Modules

**Operate**

| Screen | Route | What it does |
| --- | --- | --- |
| Dashboard | `/` | Delivery pipeline, ageing by stage, live runs, blockers to activation |
| Provisioning Requests | `/requests` | Category summary donuts, lane counts, the full request queue |
| New network service | `/requests/new` | The seven-step creation flow |
| Request detail | `/requests/:id` | Network service · Parameters · Lifecycle operation · Runs |
| Provisioning Execution | `/execution` | Verify details, approve or reject, validate credentials, execute |
| Service Inventory | `/inventory` | The installed base: state, conformance, ghosts, drift |
| Service detail | `/inventory/:id` | Path, intent vs realised, evidence, history, resources held |
| Change & Cease | `/change` | Modify, suspend, resume, cease and re-prove orders |

**Configure**

| Screen | Route | What it does |
| --- | --- | --- |
| Workflows | `/workflows` | The template engine, with an intent × vendor coverage matrix |
| Workflow builder | `/workflows/:id` | Profile binding, stages, tasks, commands, controls, validator, dry run |
| Profile Types | `/profile-types` | The Category → Type → Subtype master, with a create dialog |
| Resource Pools | `/pools` | VLAN, pseudowire ID, RD/RT, IP block and ASN allocation |

**Analyse**

| Screen | Route | What it does |
| --- | --- | --- |
| Evidence | `/evidence` | Assertion records: claim, parse rule, expected, actual, verdict |
| Reports | `/reports` | Standing questions with dated answers and a snapshot per run |

Screens marked new relative to the current platform: Dashboard, Service Inventory,
Service detail, Change & Cease, Resource Pools and Evidence. The other five mirror
the modules you run today.

## What is actually interactive

- **Filters, search, sort and pagination** on every data grid
- **Row click** opens the matching detail screen or drawer
- **The seven-step wizard** — category and type, endpoints, workflow template
  (auto-populated and preselected), parameters, values, preview and validation,
  then a created service. Validation blocks submission with named problems.
- **Run execution** — stages advance and tasks flip from Not started to Running to
  Passed on a timer, with live progress on the request row and the dashboard
- **Approve / reject / credential validation / execute / abort and roll back / retry**
- **Request and Response drawer** on any task, showing the command, the payload sent,
  the response captured, the parse result and why the verdict was reached
- **Raise a change** against a live service — the new order appears in Change & Cease
  and in Provisioning Requests immediately
- **Create a profile type** — appears in the master list and in workflow scoping
- **Re-prove a service** — refreshes its evidence and conformance
- **Workflow validator** — computes blockers from the actual task definitions and
  disables Publish until they clear
- **Notifications and toasts** for every state change
- **Drill-down from every KPI, chart and widget** — see below

## Drill-down

Every number on the dashboard opens the list behind it, filtered. KPI tiles, the
requests-by-stage bars, the conformance donut and its legend, the intent bar, the
category cards, the capacity-warning bars and the two footer figures are all
navigation. So are the stat tiles, charts and coverage matrix on the module screens.

Filters live in the URL rather than component state, which is what makes a
drill-down behave:

| | |
| --- | --- |
| `/inventory?conf=Ghost` | the 44 ghost services |
| `/inventory?cat=L3VPN&state=Live` | filters compose |
| `/requests?state=Designed,Awaiting approval` | a lane spanning several stages |
| `/workflows?intent=INT-L2-P2P&vendor=CISCO` | one square of the coverage matrix |
| `/pools?pool=POOL-IP-001` | opens that pool's drawer directly |
| `/evidence?verdict=Failed` | only the assertions that failed |

Because the filter is in the URL, a filtered view is a link you can paste to a
colleague, it survives a reload, and Back steps out of the filter rather than off
the screen. On arrival a banner names the active filters, each one removable, with
Clear all beside them — a filtered grid never looks like a screen that lost its data.

## Structure

```
src/
├─ types/index.ts        domain model (Order, Service, Run, Workflow, Pool, …)
├─ data/                 deterministic seed — 170 orders, 2,457 services,
│                        184 workflows, 27 profile types, 10 pools, 9 reports
├─ store/useStore.ts     zustand store: every action lives here
├─ components/
│  ├─ ui.tsx             Card, Badge, Button, DataTable, Drawer, Modal, Tabs, …
│  ├─ charts.tsx         hand-rolled SVG charts, no chart library
│  └─ AppShell.tsx       sidebar, breadcrumb, notifications, toasts
├─ lib/format.ts         tone maps and date/duration/currency formatting
└─ pages/                one file per screen
```

The dataset is seeded from a fixed PRNG, so a reload always shows the same numbers.
Distributions are exact: services split 2,143 live / 41 activating / 96 degraded /
58 suspended / 119 ceased, and 1,881 conformant / 214 drifted / 316 never proven /
46 ghost. Both axes reconcile to 2,457.

## Wiring it to a real backend

Every read goes through a selector on `useStore`, and every write goes through an
action in `src/store/useStore.ts`. Replacing the mock is a matter of changing those
action bodies to call your API and letting the seed in `src/data/` fall away — no
component reaches for data directly.

## Design notes

Type is 14px base, 13px in grids. Colour is not decorative: `#2a78d6` is the single
magnitude hue and the status trio is `#0ca30c` / `#fab219` / `#d03b3b`. Amber sits
below 3:1 on white by design, so every status fill in a chart carries a direct
label. No dual-axis charts, no categorical palette, no colour-only encoding.

Verified at 1560px: type-checks clean, production build succeeds, all ten routes
render with no console errors, no horizontal overflow, and table headers expose the
`columnheader` role.
# LCM-Orchestrator
