// =============================================================================
// SCENARIO MICRO-SIM  (Master Spec #50)
// =============================================================================
// A pre-trade Monte-Carlo: given entry/TP/SL and per-step vol/drift, estimate
// P(hit TP first), P(hit SL first), P(timeout) and the expected return. Use it
// to skip trades whose tail risk is bad even if the headline edge looks fine.
// Deterministic given a seed (seedable PRNG) so it is fully unit-testable.
// =============================================================================

/** mulberry32 — small, fast, seedable PRNG in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller, driven by a uniform PRNG. */
function gaussian(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface ScenarioParams {
  entryPrice: number;
  tpPrice: number;          // take-profit level (above entry for a long)
  slPrice: number;          // stop-loss level (below entry for a long)
  volStepPct: number;       // per-step volatility, percent
  driftStepPct?: number;    // per-step drift, percent (default 0)
  maxSteps?: number;        // horizon (default 60)
  paths?: number;           // Monte-Carlo paths (default 2000)
  seed?: number;            // default 12345 (deterministic)
}

export interface ScenarioResult {
  pTP: number;
  pSL: number;
  pTimeout: number;
  expectedReturnPct: number;
}

/** Run the simulation. Long-only convention (TP above, SL below entry). */
export function simulateTradeOutcome(p: ScenarioParams): ScenarioResult {
  const maxSteps = p.maxSteps ?? 60;
  const paths = p.paths ?? 2000;
  const drift = (p.driftStepPct ?? 0) / 100;
  const vol = Math.max(0, p.volStepPct) / 100;
  const rng = mulberry32(p.seed ?? 12345);

  let tp = 0, sl = 0, timeout = 0, retSum = 0;
  for (let i = 0; i < paths; i++) {
    let price = p.entryPrice;
    let resolved = false;
    for (let s = 0; s < maxSteps; s++) {
      price *= Math.exp((drift - 0.5 * vol * vol) + vol * gaussian(rng));
      if (price >= p.tpPrice) { tp++; retSum += (p.tpPrice - p.entryPrice) / p.entryPrice; resolved = true; break; }
      if (price <= p.slPrice) { sl++; retSum += (p.slPrice - p.entryPrice) / p.entryPrice; resolved = true; break; }
    }
    if (!resolved) { timeout++; retSum += (price - p.entryPrice) / p.entryPrice; }
  }
  return {
    pTP: tp / paths,
    pSL: sl / paths,
    pTimeout: timeout / paths,
    expectedReturnPct: (retSum / paths) * 100,
  };
}

/** Gate: is the trade's tail risk acceptable (P(SL) below a ceiling)? (#50) */
export function scenarioAcceptable(r: ScenarioResult, maxPSL = 0.6): boolean {
  return r.pSL <= maxPSL && r.expectedReturnPct > 0;
}
