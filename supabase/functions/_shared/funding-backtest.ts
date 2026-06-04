// =============================================================================
// FUNDING BACKTEST — the truth detector for the carry strategy
// =============================================================================
// Replays a historical funding-rate series for a delta-neutral position (price-
// neutral, so P&L ≈ collected funding minus the one-time round-trip cost) and
// reports whether the carry was actually net-positive and reliable. Pure;
// reuses the shared sharpe() and maxDrawdown() helpers.
// =============================================================================

import { sharpe } from "./validation.ts";
import { maxDrawdown } from "./metrics.ts";

export interface FundingBacktestResult {
  intervals: number;
  grossCarryPct: number;
  netCarryPct: number;
  pctTimePositive: number;
  meanFundingBps: number;
  carrySharpe: number;
  maxDrawdownPct: number;
  reliableCarry: boolean;
  verdict: string;
}

/**
 * @param fundingRates per-interval funding fractions (e.g. 0.0001 = 0.01%).
 * @param roundTripCostBps one-time open+close cost of both legs (bps).
 */
export function backtestFunding(fundingRates: number[], roundTripCostBps = 8): FundingBacktestResult {
  const n = fundingRates.length;
  if (n === 0) {
    return { intervals: 0, grossCarryPct: 0, netCarryPct: 0, pctTimePositive: 0, meanFundingBps: 0, carrySharpe: 0, maxDrawdownPct: 0, reliableCarry: false, verdict: "no data" };
  }
  const perPct = fundingRates.map((f) => f * 100); // funding collected per interval, %
  const grossCarryPct = perPct.reduce((a, b) => a + b, 0);
  const rtPct = roundTripCostBps / 100; // bps -> %
  const netCarryPct = grossCarryPct - rtPct;
  const positive = fundingRates.filter((f) => f > 0).length;
  const pctTimePositive = (positive / n) * 100;
  const meanFundingBps = (fundingRates.reduce((a, b) => a + b, 0) / n) * 10000;
  const carrySharpe = sharpe(perPct);

  // Cumulative carry curve, net of one round-trip at entry.
  const cum: number[] = [];
  let run = -rtPct;
  for (const p of perPct) { run += p; cum.push(run); }
  // Max peak-to-trough drop of the cumulative-carry curve, in percentage POINTS
  // (the curve is already in %). This is delta-neutral carry, so it is small and
  // meaningful as-is; normalizing by the carry peak produced unstable ratios.
  const maxDrawdownPct = round2(maxDrawdown(cum));

  // "Losing" = funding actually negative. Zero-funding intervals cost nothing,
  // so they must NOT count against reliability (the old >=60% positive gate
  // rejected genuinely never-losing carry that had many flat intervals).
  const pctTimeLosing = (fundingRates.filter((f) => f < 0).length / n) * 100;
  const reliableCarry = netCarryPct > 0 && pctTimeLosing <= 40;
  const verdict = reliableCarry
    ? `net carry +${netCarryPct.toFixed(3)}% over ${n} intervals (funding negative only ${pctTimeLosing.toFixed(0)}% of the time)`
    : `NO reliable carry: net ${netCarryPct.toFixed(3)}%, funding negative ${pctTimeLosing.toFixed(0)}% of the time — do not deploy`;

  return {
    intervals: n,
    grossCarryPct: round2(grossCarryPct),
    netCarryPct: round2(netCarryPct),
    pctTimePositive: round2(pctTimePositive),
    meanFundingBps: round2(meanFundingBps),
    carrySharpe: round2(carrySharpe),
    maxDrawdownPct,
    reliableCarry,
    verdict,
  };
}

function round2(x: number): number { return Math.round(x * 100) / 100; }
