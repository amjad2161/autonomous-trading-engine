// =============================================================================
// OPPORTUNITY NORMALIZATION & DEDUP  (Master Spec #41, #42, #43, #46)
// =============================================================================
// A unified shape every scanner emits, plus dedup/rank/expiry helpers so the
// planner compares apples to apples. Pure, no I/O.
// =============================================================================

export interface Opportunity {
  source: string;            // which scanner produced it
  symbol: string;
  legs?: string[];           // for multi-leg (arb) opportunities
  expectedNetEdgePct: number; // AFTER estimated costs
  requiredSizeUsdt: number;
  riskTags: string[];
  createdAtMs: number;
  expiryMs: number;          // absolute time it becomes stale
}

/** Coerce arbitrary scanner output into the standard Opportunity shape (#42). */
export function normalizeOpportunity(raw: Record<string, unknown>, source = "unknown"): Opportunity {
  const now = Date.now();
  const ttl = Number(raw.ttlMs ?? 0);
  return {
    source: String(raw.source ?? source),
    symbol: String(raw.symbol ?? raw.currency_pair ?? "?"),
    legs: Array.isArray(raw.legs) ? (raw.legs as unknown[]).map(String) : undefined,
    expectedNetEdgePct: Number(raw.expectedNetEdgePct ?? raw.netEdge ?? raw.edge ?? 0),
    requiredSizeUsdt: Number(raw.requiredSizeUsdt ?? raw.sizeUsdt ?? 0),
    riskTags: Array.isArray(raw.riskTags) ? (raw.riskTags as unknown[]).map(String) : [],
    createdAtMs: Number(raw.createdAtMs ?? now),
    expiryMs: Number(raw.expiryMs ?? (ttl > 0 ? now + ttl : now + 10_000)),
  };
}

/** Drop opportunities whose expiry has passed (#41). */
export function filterExpired(list: Opportunity[], nowMs: number = Date.now()): Opportunity[] {
  return list.filter((o) => o.expiryMs > nowMs);
}

/**
 * Dedupe by symbol (and leg-set for arbs), keeping the highest net edge (#43).
 * Prevents the planner acting on the same signal twice from different scanners.
 */
export function dedupeOpportunities(list: Opportunity[]): Opportunity[] {
  const best = new Map<string, Opportunity>();
  for (const o of list) {
    const key = o.legs && o.legs.length ? `${o.symbol}|${o.legs.join(">")}` : o.symbol;
    const cur = best.get(key);
    if (!cur || o.expectedNetEdgePct > cur.expectedNetEdgePct) best.set(key, o);
  }
  return [...best.values()];
}

/** Rank by net edge, best first (#46). */
export function rankOpportunities(list: Opportunity[]): Opportunity[] {
  return [...list].sort((a, b) => b.expectedNetEdgePct - a.expectedNetEdgePct);
}

/**
 * Full pipeline: normalize → drop expired → dedupe → rank → take top N.
 * The single funnel a planner should use over raw multi-scanner output.
 */
export function planFromScanners(raw: Record<string, unknown>[], topN = 5, nowMs: number = Date.now()): Opportunity[] {
  const normalized = raw.map((r) => normalizeOpportunity(r));
  return rankOpportunities(dedupeOpportunities(filterExpired(normalized, nowMs))).slice(0, Math.max(0, topN));
}

// Clock-drift guard (#18): exchange time vs local time. Large drift breaks
// signed requests and time-sensitive logic → tighten filters / risk-off.
export function clockDriftMs(serverTimeMs: number, localMs: number = Date.now()): number {
  return Math.abs(serverTimeMs - localMs);
}
export function clockDriftOk(driftMs: number, maxMs = 2000): boolean {
  return driftMs <= maxMs;
}
