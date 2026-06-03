// =============================================================================
// OBSERVABILITY METRICS & ALERTS  (Master Spec §2.9; #64, #98, #99, #100)
// =============================================================================
// Pure KPI aggregation from trade history + alert decisions. Feed these to the
// dashboard, the risk posture, and the governance gates.
// =============================================================================

export interface TradeRow {
  pnlUsdt: number;
  filled?: boolean;
  slippagePct?: number;
}

export interface Kpis {
  count: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnlUsdt: number;
  avgPnlUsdt: number;
  profitFactor: number;   // gross profit / gross loss
  fillRatePct: number;
  avgSlippagePct: number;
  maxDrawdownPct: number; // on the cumulative-pnl curve, as % of peak-ish scale
}

/** Max drawdown (absolute) of a cumulative series, returned as a positive number. */
export function maxDrawdown(cumulative: number[]): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of cumulative) {
    if (v > peak) peak = v;
    maxDD = Math.max(maxDD, peak - v);
  }
  return maxDD;
}

export function computeKpis(trades: TradeRow[]): Kpis {
  const count = trades.length;
  let wins = 0, losses = 0, gp = 0, gl = 0, total = 0, filledCount = 0, slipSum = 0, slipN = 0;
  const cum: number[] = [];
  let running = 0;
  for (const t of trades) {
    total += t.pnlUsdt;
    running += t.pnlUsdt;
    cum.push(running);
    if (t.pnlUsdt > 0) { wins++; gp += t.pnlUsdt; }
    else if (t.pnlUsdt < 0) { losses++; gl += -t.pnlUsdt; }
    if (t.filled !== false) filledCount++;
    if (t.slippagePct !== undefined) { slipSum += t.slippagePct; slipN++; }
  }
  const dd = maxDrawdown(cum);
  // Reference scale for % drawdown, computed without spreading a large array
  // (Math.max(...bigArray) can blow the call stack / arg limit).
  let peak = 1;
  for (const c of cum) { const a = Math.abs(c); if (a > peak) peak = a; }
  if (Math.abs(total) > peak) peak = Math.abs(total);
  return {
    count,
    wins,
    losses,
    winRatePct: count ? (wins / count) * 100 : 0,
    totalPnlUsdt: round2(total),
    avgPnlUsdt: count ? round2(total / count) : 0,
    profitFactor: gl > 0 ? round2(gp / gl) : (gp > 0 ? Infinity : 0),
    fillRatePct: count ? (filledCount / count) * 100 : 0,
    avgSlippagePct: slipN ? round4(slipSum / slipN) : 0,
    maxDrawdownPct: round2((dd / peak) * 100),
  };
}

export interface AlertThresholds {
  minWinRatePct: number;
  minProfitFactor: number;
  maxDrawdownPct: number;
  maxAvgSlippagePct: number;
}

export const DEFAULT_ALERTS: AlertThresholds = {
  minWinRatePct: 40,
  minProfitFactor: 1.0,
  maxDrawdownPct: 8,
  maxAvgSlippagePct: 0.5,
};

export interface Alert {
  level: "warn" | "critical";
  message: string;
}

/** Turn KPIs into actionable alerts (#99). */
export function alertDecisions(k: Kpis, t: AlertThresholds = DEFAULT_ALERTS): Alert[] {
  const alerts: Alert[] = [];
  if (k.count >= 10 && k.profitFactor < t.minProfitFactor) {
    alerts.push({ level: "critical", message: `profit factor ${k.profitFactor} < ${t.minProfitFactor}` });
  }
  // Negative expectancy: avg P&L per trade < 0 over a meaningful sample = no edge.
  if (k.count >= 10 && k.avgPnlUsdt < 0) {
    alerts.push({ level: "critical", message: `negative expectancy: avg ${k.avgPnlUsdt}/trade over ${k.count} trades` });
  }
  if (k.maxDrawdownPct > t.maxDrawdownPct) {
    alerts.push({ level: "critical", message: `drawdown ${k.maxDrawdownPct}% > ${t.maxDrawdownPct}%` });
  }
  if (k.count >= 10 && k.winRatePct < t.minWinRatePct) {
    alerts.push({ level: "warn", message: `win rate ${k.winRatePct.toFixed(0)}% < ${t.minWinRatePct}%` });
  }
  if (k.avgSlippagePct > t.maxAvgSlippagePct) {
    alerts.push({ level: "warn", message: `avg slippage ${k.avgSlippagePct}% > ${t.maxAvgSlippagePct}%` });
  }
  return alerts;
}

function round2(x: number): number { return Math.round(x * 100) / 100; }
function round4(x: number): number { return Math.round(x * 1e4) / 1e4; }
