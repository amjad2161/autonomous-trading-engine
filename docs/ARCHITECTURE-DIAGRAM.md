# Architecture Diagrams — flows, state machines, kill-switch ladder

> Text/Mermaid diagrams of the system. Renders on GitHub. Companions:
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`MASTER-SPEC.md`](./MASTER-SPEC.md).

## 1. System data flow

```mermaid
flowchart LR
  subgraph Browser["React PWA dashboard"]
    UI[Tabs: Hyper / Autopilot / Control / Backtest / Settings]
    MODE[TradingModePanel - mode selector]
  end
  subgraph Edge["Supabase Edge Functions (Deno)"]
    ORCH[autonomous-orchestrator]
    GATE[gate-api proxy]
    CFG[config]
    SHARED[[_shared: safety / auth / profiles / invariants / health / scoring / governance / order-state]]
  end
  DB[(Postgres: state / trades / logs)]
  GIO[(Gate.io v4 REST/WS)]

  UI -- functions.invoke --> ORCH
  MODE -- get/set mode --> CFG
  UI -- read --> GATE
  ORCH --> SHARED
  GATE --> SHARED
  ORCH <--> DB
  CFG <--> DB
  ORCH -- signed orders (gated) --> GIO
  GATE -- signed reads/orders (gated) --> GIO
```

## 2. Autonomous cycle — decision flow (exits-first, gated)

```mermaid
flowchart TD
  A[Cycle tick] --> B{is_active?}
  B -- no --> Z[idle]
  B -- yes --> C[Reconcile + manage positions]
  C --> EXITS[Process EXITS first: SL / TP / trailing / time-stop]
  EXITS --> D[Resolve config: profile + autopilot + adaptive]
  D --> INV{Invariants OK?\nINV-01..05}
  INV -- breach --> BLK[Block NEW entries - log RISK]
  INV -- ok --> POS{Risk posture\nallows entries?}
  POS -- FREEZE/HALT/RISK_OFF --> BLK
  POS -- ok --> AUTO{Autopilot ON?}
  AUTO -- no --> BLK
  AUTO -- yes --> SCAN[Scan + score by NET EDGE]
  SCAN --> GATE2{net edge >= min\nafter costs?}
  GATE2 -- no --> BLK
  GATE2 -- yes --> SIZE[Dynamic size = min of all caps\nx mode cap x canary fraction]
  SIZE --> SAFE{Safety gate\nDRY_RUN? caps? kill?}
  SAFE -- DRY_RUN --> SIM[Simulated fill - no live order]
  SAFE -- LIVE+ok --> SEND[Send maker-first limit order]
  SEND --> SM[Order state machine]
```

## 3. Order state machine (`_shared/order-state.ts`)

```mermaid
stateDiagram-v2
  [*] --> NEW
  NEW --> ACK: ack
  NEW --> REJECTED: reject
  NEW --> CANCELLED: cancel
  NEW --> EXPIRED: expire
  ACK --> PARTIAL: partial_fill
  ACK --> FILLED: fill
  ACK --> CANCELLED: cancel
  ACK --> EXPIRED: expire
  ACK --> REJECTED: reject
  PARTIAL --> PARTIAL: partial_fill
  PARTIAL --> FILLED: fill
  PARTIAL --> CANCELLED: cancel
  PARTIAL --> EXPIRED: expire
  FILLED --> [*]
  CANCELLED --> [*]
  REJECTED --> [*]
  EXPIRED --> [*]
```

Invalid events are safe no-ops (idempotent); terminal states ignore further
events; `remainingQty` drives exit logic on partial fills.

## 4. Kill-switch / risk-posture ladder (`_shared/health.ts`)

```
 NORMAL ──▶ RAISE_EDGE ──▶ MAKER_ONLY ──▶ RISK_OFF ──▶ FREEZE ──▶ HALT
   │            │              │             │            │          │
 trade      demand more     maker-only,   no new        no new     full
 normally   edge, fewer     exit faster   entries       entries    stop,
            positions                     (exits ok)    + reconcile reconcile
```
`riskPosture(KPIs)` takes the **most severe** trigger; `postureBlocksEntries()`
gates new entries. Underneath sits the owner-only **safety floor** (DRY_RUN,
caps, KILL_SWITCH, no leverage) which nothing auto-changes.

## 5. Governance promotion (`_shared/governance.ts`)

```mermaid
flowchart LR
  SH[SHADOW\npaper twin] -- passesAcceptance --> CA[CANARY\n5-10% capital]
  CA -- passesAcceptance --> LI[LIVE\nfull approval]
  CA -- shouldRollback --> SH
  LI -- shouldRollback --> CA
```
A candidate may only adjust **soft params**; promotion requires passing
acceptance tests (fill rate, slippage, drawdown, profit factor); any material
KPI degradation auto-rolls-back. Hard guardrails are never in scope.

## 6. Two-level + floor control summary

```
 [ is_active ]  AND  [ Autopilot ON ]  AND  [ invariants ok ]  AND  [ posture ok ]
        │                  │                      │                      │
        └──────────────── all true ──────────────┴──────────▶ may open NEW entries
                                                                     │
                              still passes ──▶ [ SAFETY FLOOR: DRY_RUN? caps? kill? ] ──▶ order
```
