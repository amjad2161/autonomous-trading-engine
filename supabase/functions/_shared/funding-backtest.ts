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
  const dd = maxDrawdown(cum);
  let peakPos = 0;
  for (const c of cum) { if (c > peakPos) peakPos = c; }
  const maxDrawdownPct = peakPos > 0 ? round2((dd / peakPos) * 100) : 0;

  // Reliable only if net-positive AND funding stayed positive most of the time.
  const reliableCarry = netCarryPct > 0 && pctTimePositive >= 60;
  const verdict = reliableCarry
    ? `net carry +${netCarryPct.toFixed(3)}% over ${n} intervals (funding positive ${pctTimePositive.toFixed(0)}% of the time)`
    : `NO reliable carry: net ${netCarryPct.toFixed(3)}%, funding positive only ${pctTimePositive.toFixed(0)}% of the time — do not deploy`;

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
