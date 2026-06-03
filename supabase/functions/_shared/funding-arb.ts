// =============================================================================
// FUNDING-RATE / BASIS CARRY — delta-neutral (long spot + short perp)
// =============================================================================
// The most viable retail strategy from the analysis: collect perpetual funding
// while staying market-neutral. Pure, unit-tested, and CAPITAL-AGNOSTIC — sizing
// scales with equity, so the same logic works on $1k or $1M. The only thing that
// gates "is it worth it" is NET CARRY AFTER COSTS, never the account size.
//
// Mechanics: when funding > 0, shorts RECEIVE it. Long spot + short perp of equal
// notional has ~0 price exposure; you earn funding each interval, minus the
// one-time round-trip fees and any adverse basis move. Honest caveat: returns are
// modest and regime-dependent, and funding can flip negative — this is low-risk,
// not no-risk.
// =============================================================================

export interface FundingInputs {
  /** Funding rate per interval, as a FRACTION (e.g. 0.0001 = 0.01%). Positive = shorts receive. */
  fundingRate: number;
  fundingIntervalHours: number; // typically 8 on Gate.io
  spotPrice: number;
  perpMark: number;
  spotFeeBps: number; // per side (maker/taker), basis points
  perpFeeBps: number; // per side, basis points
}

/** Basis in bps: (perp - spot) / spot * 10000. Positive = perp rich. */
export function basisBps(spotPrice: number, perpMark: number): number {
  if (!(spotPrice > 0)) return 0;
  return ((perpMark - spotPrice) / spotPrice) * 10000;
}

/** Round-trip cost in bps: open (buy spot + short perp) + close (sell spot + cover perp) = 2 fills per leg. */
export function roundTripCostBps(spotFeeBps: number, perpFeeBps: number): number {
  return 2 * Math.max(0, spotFeeBps) + 2 * Math.max(0, perpFeeBps);
}

/** Funding collected per interval, in bps (positive funding -> positive for the short leg). */
export function fundingBpsPerInterval(fundingRate: number): number {
  return fundingRate * 10000;
}

/** Gross annualized carry %, ignoring the one-time fees (they amortize away over long holds). */
export function annualizedCarryPct(fundingRate: number, fundingIntervalHours: number): number {
  if (!(fundingIntervalHours > 0)) return 0;
  const intervalsPerYear = (365 * 24) / fundingIntervalHours;
  return fundingRate * intervalsPerYear * 100;
}

/** Funding intervals needed to recoup the round-trip cost. Infinity if carry <= 0. */
export function breakevenIntervals(roundTripBps: number, fundingPerIntervalBps: number): number {
  if (fundingPerIntervalBps <= 0) return Infinity;
  return roundTripBps / fundingPerIntervalBps;
}

export interface FundingArbSignal {
  action: "OPEN" | "SKIP" | "CLOSE";
  fundingBpsPerInterval: number;
  annualizedPct: number;
  basisBps: number;
  breakevenIntervals: number;
  reason: string;
}

export interface FundingArbOpts {
  /** Minimum funding per interval (bps) to bother opening. */
  minFundingBps: number;
  /** Max tolerated |basis| (bps) — wide basis = convergence risk. */
  maxBasisBps: number;
  /** Max breakeven intervals you're willing to wait. */
  maxBreakevenIntervals: number;
}

export const DEFAULT_FUNDING_OPTS: FundingArbOpts = {
  minFundingBps: 1, // 0.01% per interval
  maxBasisBps: 50, // 0.5%
  maxBreakevenIntervals: 12, // ~4 days at 8h
};

/**
 * Decide whether to open / skip / close a delta-neutral funding position.
 * Negative funding -> CLOSE (the carry has flipped against the short).
 */
export function fundingArbSignal(inp: FundingInputs, opts: FundingArbOpts = DEFAULT_FUNDING_OPTS): FundingArbSignal {
  const fbps = fundingBpsPerInterval(inp.fundingRate);
  const b = basisBps(inp.spotPrice, inp.perpMark);
  const rt = roundTripCostBps(inp.spotFeeBps, inp.perpFeeBps);
  const be = breakevenIntervals(rt, fbps);
  const annual = annualizedCarryPct(inp.fundingRate, inp.fundingIntervalHours);
  const base = { fundingBpsPerInterval: fbps, annualizedPct: annual, basisBps: b, breakevenIntervals: be };

  if (fbps <= 0) return { ...base, action: "CLOSE", reason: "funding flipped non-positive — carry gone" };
  if (fbps < opts.minFundingBps) return { ...base, action: "SKIP", reason: `funding ${fbps.toFixed(2)}bps < min ${opts.minFundingBps}bps` };
  if (Math.abs(b) > opts.maxBasisBps) return { ...base, action: "SKIP", reason: `basis ${b.toFixed(1)}bps exceeds ${opts.maxBasisBps}bps (convergence risk)` };
  if (be > opts.maxBreakevenIntervals) return { ...base, action: "SKIP", reason: `breakeven ${be.toFixed(1)} intervals > ${opts.maxBreakevenIntervals}` };
  return { ...base, action: "OPEN", reason: `net carry positive: ~${annual.toFixed(1)}%/yr, breakeven ${be.toFixed(1)} intervals` };
}

export interface DeltaNeutralLegs {
  notionalUsdt: number;
  spotQty: number;
  perpQty: number;
}

/**
 * Size both legs equally so the position is delta-neutral. CAPITAL-AGNOSTIC:
 * notional = equity * allocFraction (clamped to [0,1]); legs scale with equity.
 */
export function deltaNeutralLegs(equityUsdt: number, allocFraction: number, spotPrice: number): DeltaNeutralLegs {
  const frac = Math.min(1, Math.max(0, allocFraction));
  const notional = Math.max(0, equityUsdt) * frac;
  const qty = spotPrice > 0 ? notional / spotPrice : 0;
  return { notionalUsdt: notional, spotQty: qty, perpQty: qty };
}
