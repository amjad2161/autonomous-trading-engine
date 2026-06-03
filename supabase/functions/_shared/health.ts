// =============================================================================
// REAL-TIME HEALTH & GOVERNANCE CORES (Spec v1.1 — A1.1, A1.2, A1.5, B1)
// =============================================================================
// Pure functions that turn live measurements into operating decisions:
//   - riskPosture(kpis)        : KPIs -> NORMAL..HALT (B1)
//   - executionHealth(kpis)    : 0..1 execution-quality score
//   - toxicityScore(footprint) : 0..1 order-flow toxicity (A1.3 features)
//   - selectPersonality(...)   : trading personality with hysteresis (A1.5)
//   - routeCapital(...)        : cash/trading/reserve targets (A1.1)
//   - latencyScore(...)        : latency budget adherence (A1.2)
//
// Everything is pure and side-effect free, so it is fully unit-testable and the
// engine's behaviour is deterministic given its inputs.
// =============================================================================

// ---------- B1: real-time KPIs -> risk posture ------------------------------

export interface RealtimeKPIs {
  dataFreshnessMs?: number;   // age of newest market data
  executionLatencyMs?: number;
  fillRatePct?: number;       // 0..100
  slippagePct?: number;       // average realised slippage
  spreadBps?: number;
  errorRatePerMin?: number;   // REST/WS errors per minute
  dailyDrawdownPct?: number;  // positive number, e.g. 3 = -3%
}

export interface KpiThresholds {
  dataFreshnessMs: number;
  executionLatencyMs: number;
  fillRatePct: number;        // minimum acceptable
  slippagePct: number;        // maximum acceptable
  errorRatePerMin: number;
  ddHaltPct: number;          // halt above this drawdown
  ddRiskOffPct: number;       // risk-off above this drawdown
}

export const DEFAULT_THRESHOLDS: KpiThresholds = {
  dataFreshnessMs: 3000,
  executionLatencyMs: 1500,
  fillRatePct: 50,
  slippagePct: 0.5,
  errorRatePerMin: 20,
  ddHaltPct: 8,
  ddRiskOffPct: 4,
};

// Ordered worst -> best for easy "take the most severe" logic.
export type RiskPosture = "HALT" | "FREEZE" | "RISK_OFF" | "MAKER_ONLY" | "RAISE_EDGE" | "NORMAL";

const SEVERITY: RiskPosture[] = ["NORMAL", "RAISE_EDGE", "MAKER_ONLY", "RISK_OFF", "FREEZE", "HALT"];

function worst(a: RiskPosture, b: RiskPosture): RiskPosture {
  return SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;
}

export interface PostureResult {
  posture: RiskPosture;
  reasons: string[];
}

/**
 * Map live KPIs to an operating posture. Takes the MOST severe trigger.
 * - data stale / error burst  -> FREEZE
 * - drawdown beyond halt      -> HALT
 * - drawdown beyond risk-off  -> RISK_OFF
 * - high latency / high slip  -> MAKER_ONLY
 * - low fill rate             -> RAISE_EDGE
 */
export function riskPosture(kpis: RealtimeKPIs, t: KpiThresholds = DEFAULT_THRESHOLDS): PostureResult {
  let posture: RiskPosture = "NORMAL";
  const reasons: string[] = [];

  if (kpis.dataFreshnessMs !== undefined && kpis.dataFreshnessMs > t.dataFreshnessMs) {
    posture = worst(posture, "FREEZE");
    reasons.push(`data stale ${kpis.dataFreshnessMs}ms`);
  }
  if (kpis.errorRatePerMin !== undefined && kpis.errorRatePerMin > t.errorRatePerMin) {
    posture = worst(posture, "FREEZE");
    reasons.push(`error burst ${kpis.errorRatePerMin}/min`);
  }
  if (kpis.dailyDrawdownPct !== undefined && kpis.dailyDrawdownPct >= t.ddHaltPct) {
    posture = worst(posture, "HALT");
    reasons.push(`drawdown ${kpis.dailyDrawdownPct}% >= halt`);
  } else if (kpis.dailyDrawdownPct !== undefined && kpis.dailyDrawdownPct >= t.ddRiskOffPct) {
    posture = worst(posture, "RISK_OFF");
    reasons.push(`drawdown ${kpis.dailyDrawdownPct}% >= risk-off`);
  }
  if (kpis.executionLatencyMs !== undefined && kpis.executionLatencyMs > t.executionLatencyMs) {
    posture = worst(posture, "MAKER_ONLY");
    reasons.push(`latency ${kpis.executionLatencyMs}ms`);
  }
  if (kpis.slippagePct !== undefined && kpis.slippagePct > t.slippagePct) {
    posture = worst(posture, "MAKER_ONLY");
    reasons.push(`slippage ${kpis.slippagePct}%`);
  }
  if (kpis.fillRatePct !== undefined && kpis.fillRatePct < t.fillRatePct) {
    posture = worst(posture, "RAISE_EDGE");
    reasons.push(`fill rate ${kpis.fillRatePct}%`);
  }

  return { posture, reasons };
}

/** True when the posture forbids opening NEW entries (exits always allowed). */
export function postureBlocksEntries(p: RiskPosture): boolean {
  return p === "HALT" || p === "FREEZE" || p === "RISK_OFF";
}

// ---------- execution health (0..1) -----------------------------------------

export function executionHealth(kpis: RealtimeKPIs, t: KpiThresholds = DEFAULT_THRESHOLDS): number {
  const parts: number[] = [];
  if (kpis.executionLatencyMs !== undefined) parts.push(clamp01(1 - kpis.executionLatencyMs / (t.executionLatencyMs * 2)));
  if (kpis.fillRatePct !== undefined) parts.push(clamp01(kpis.fillRatePct / 100));
  if (kpis.slippagePct !== undefined) parts.push(clamp01(1 - kpis.slippagePct / (t.slippagePct * 2)));
  if (kpis.errorRatePerMin !== undefined) parts.push(clamp01(1 - kpis.errorRatePerMin / (t.errorRatePerMin * 2)));
  if (parts.length === 0) return 1;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

// ---------- A1.3: toxicity from liquidity footprint -------------------------

export interface FootprintFeatures {
  /** Walls disappearing right before a move (0..1). */
  wallVanishRate?: number;
  /** How fast depth replenishes after being hit (0..1, higher = healthier). */
  depthReplenishSpeed?: number;
  /** Aggressive buy/sell imbalance magnitude (0..1). */
  aggressiveImbalance?: number;
}

/** 0 = benign book, 1 = toxic (spoofy / vanishing liquidity). */
export function toxicityScore(f: FootprintFeatures): number {
  const vanish = clamp01(f.wallVanishRate ?? 0);
  const imbalance = clamp01(f.aggressiveImbalance ?? 0);
  const replenish = clamp01(f.depthReplenishSpeed ?? 0.5);
  // toxic when walls vanish + flow imbalanced + book does NOT replenish
  return clamp01(0.45 * vanish + 0.35 * imbalance + 0.20 * (1 - replenish));
}

// ---------- A1.5: adaptive personality with hysteresis ----------------------

export type Personality = "AGGRESSIVE" | "MAKER_HEAVY" | "CONSERVATIVE" | "MAKER_ONLY" | "FREEZE";

export interface PersonalityInputs {
  toxicity: number;        // 0..1
  executionHealth: number; // 0..1
  latencyMs?: number;
  latencyBudgetMs?: number;
  previous?: Personality;  // for hysteresis (avoid flicker)
}

/**
 * Choose a trading personality from market/execution conditions.
 * Hysteresis: only step ONE level at a time toward the target to avoid
 * rapid flip-flopping between regimes.
 */
export function selectPersonality(inp: PersonalityInputs): Personality {
  const order: Personality[] = ["FREEZE", "MAKER_ONLY", "CONSERVATIVE", "MAKER_HEAVY", "AGGRESSIVE"];
  const latencyBad = inp.latencyMs !== undefined && inp.latencyBudgetMs !== undefined && inp.latencyMs > inp.latencyBudgetMs;

  let target: Personality;
  if (inp.toxicity >= 0.75 || latencyBad) target = "MAKER_ONLY";
  else if (inp.toxicity >= 0.5) target = "CONSERVATIVE";
  else if (inp.toxicity < 0.25 && inp.executionHealth >= 0.7) target = "AGGRESSIVE";
  else if (inp.executionHealth >= 0.6) target = "MAKER_HEAVY";
  else target = "CONSERVATIVE";

  if (inp.executionHealth < 0.25) target = "FREEZE";

  if (!inp.previous) return target;
  const from = order.indexOf(inp.previous);
  const to = order.indexOf(target);
  if (from === to) return inp.previous;
  // De-risk IMMEDIATELY (toxic/broken conditions must not linger); only damp the
  // move toward MORE aggression, one level at a time. order = safe..aggressive.
  return to < from ? target : order[from + 1];
}

// ---------- A1.1: capital routing -------------------------------------------

export interface CapitalTargets {
  cashTargetPct: number;
  tradingTargetPct: number;
  reserveTargetPct: number;
  action: "EXPAND_TRADING" | "HOLD" | "DE_RISK";
  rationale: string;
}

/**
 * Decide capital-pool targets from toxicity, execution health and drawdown.
 * Higher toxicity / worse health / deeper drawdown -> more cash, less trading.
 */
export function routeCapital(toxicity: number, execHealth: number, dailyDrawdownPct: number): CapitalTargets {
  // baseline
  let cash = 55, trading = 30, reserve = 15;
  let action: CapitalTargets["action"] = "HOLD";
  const notes: string[] = [];

  if (toxicity > 0.6 || execHealth < 0.4 || dailyDrawdownPct >= 4) {
    cash = 75; trading = 10; reserve = 15;
    action = "DE_RISK";
    notes.push("toxic/unhealthy/drawdown -> de-risk to cash");
  } else if (toxicity < 0.3 && execHealth > 0.7 && dailyDrawdownPct < 2) {
    cash = 45; trading = 40; reserve = 15;
    action = "EXPAND_TRADING";
    notes.push("calm + healthy -> expand trading (gradually)");
  } else {
    notes.push("neutral -> hold allocation");
  }

  return { cashTargetPct: cash, tradingTargetPct: trading, reserveTargetPct: reserve, action, rationale: notes.join("; ") };
}

// ---------- A1.2: latency score ---------------------------------------------

/** 1 = within budget, decaying toward 0 as latency exceeds budget. */
export function latencyScore(actualMs: number, budgetMs: number): number {
  if (budgetMs <= 0) return 0;
  return clamp01(1 - Math.max(0, actualMs - budgetMs) / budgetMs);
}

// ---------- util ------------------------------------------------------------

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
