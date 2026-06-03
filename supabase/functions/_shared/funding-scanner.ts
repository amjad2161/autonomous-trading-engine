// =============================================================================
// FUNDING SCANNER — rank perps by NET carry, emit delta-neutral OPEN candidates
// =============================================================================
// Pure ranking/selection over a snapshot of perp funding data. The live fetch
// (ccxt / Gate.io) feeds this; the decision logic is here, fully testable.
// =============================================================================

import { fundingArbSignal, type FundingArbOpts, type FundingInputs, DEFAULT_FUNDING_OPTS } from "./funding-arb.ts";

export interface PerpFunding extends FundingInputs {
  symbol: string;
  quoteVolumeUsdt: number; // 24h quote volume, for a liquidity filter
}

export interface ScannedOpportunity {
  symbol: string;
  annualizedPct: number;
  fundingBpsPerInterval: number;
  basisBps: number;
  breakevenIntervals: number;
  quoteVolumeUsdt: number;
  reason: string;
}

/**
 * Rank perps by net funding carry. Keeps only those whose signal says OPEN and
 * that clear the liquidity floor, sorted by annualized carry (best first).
 */
export function scanFundingOpportunities(
  perps: PerpFunding[],
  opts: FundingArbOpts = DEFAULT_FUNDING_OPTS,
  minVolumeUsdt = 1_000_000,
): ScannedOpportunity[] {
  const out: ScannedOpportunity[] = [];
  for (const p of perps) {
    if (!(p.quoteVolumeUsdt >= minVolumeUsdt)) continue; // illiquid -> skip
    const s = fundingArbSignal(p, opts);
    if (s.action !== "OPEN") continue;
    out.push({
      symbol: p.symbol,
      annualizedPct: s.annualizedPct,
      fundingBpsPerInterval: s.fundingBpsPerInterval,
      basisBps: s.basisBps,
      breakevenIntervals: s.breakevenIntervals,
      quoteVolumeUsdt: p.quoteVolumeUsdt,
      reason: s.reason,
    });
  }
  return out.sort((a, b) => b.annualizedPct - a.annualizedPct);
}

/** Top-N opportunities (already ranked). */
export function topN(opps: ScannedOpportunity[], n: number): ScannedOpportunity[] {
  return opps.slice(0, Math.max(0, n));
}
