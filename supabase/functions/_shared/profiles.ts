// =============================================================================
// TRADING PROFILES / MODES  —  the "autopilot selector" brain
// =============================================================================
//
// This module turns a single user choice ("how should the bot behave right now?")
// into a concrete set of trading parameters the engine acts on.
//
// IMPORTANT SAFETY FRAMING:
//   A profile controls AGGRESSION (position size, edge threshold, trade
//   frequency, stop/target width) — it does NOT control SAFETY. The hard floor
//   (per-order USDT cap, kill switch, DRY_RUN default, validation gate, no
//   leverage) lives in safety.ts and is owner-only via server env. Even the
//   AGGRESSIVE profile is then clamped by that floor. So:
//       aggressive  ≠  leveraged   ≠  unsafe.
//   Aggression is "more of the allowed thing", never "escape the cage".
//
// MODES:
//   CONSERVATIVE  small size, few high-conviction trades, tight risk
//   BALANCED      moderate (sensible default)
//   AGGRESSIVE    larger size, more trades, lower edge bar — still capped
//   CUSTOM        BALANCED overlaid with user-supplied overrides
//   AUTO          adaptive: reads the market regime + the account and picks
//                 effective params on the fly ("autopilot by the market and
//                 its balance")
// =============================================================================

export type ProfileName = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE" | "CUSTOM" | "AUTO";

export interface ProfileParams {
  /** Fraction of equity put at risk per trade (percent). */
  riskPerTradePct: number;
  /** Target per-order notional in USDT (still clamped by the hard env cap). */
  maxTradeUsdt: number;
  /** Max simultaneously open positions. */
  maxOpenPositions: number;
  /** New-order throttle per rolling hour. */
  maxTradesPerHour: number;
  /** Minimum expected edge (percent) required to act. */
  minEdgePct: number;
  /** Take-profit distance (percent). */
  takeProfitPct: number;
  /** Stop-loss distance (percent). */
  stopLossPct: number;
  /** Max tolerated slippage (percent). */
  slippageTolerancePct: number;
  /** Cooldown between trades on the same symbol (seconds). */
  cooldownSec: number;
}

export interface ResolvedConfig extends ProfileParams {
  profile: ProfileName;
  /** Whether the autonomous loop should actually act (master autopilot switch). */
  autopilot: boolean;
  /** Whether AUTO/adaptive sizing is in effect. */
  adaptive: boolean;
  /** Human-readable note about why these params were chosen (for the UI/logs). */
  rationale: string;
}

// --- Base presets -----------------------------------------------------------

export const PROFILES: Record<"CONSERVATIVE" | "BALANCED" | "AGGRESSIVE", ProfileParams> = {
  CONSERVATIVE: {
    riskPerTradePct: 0.5,
    maxTradeUsdt: 10,
    maxOpenPositions: 2,
    maxTradesPerHour: 4,
    minEdgePct: 0.6,
    takeProfitPct: 1.2,
    stopLossPct: 0.6,
    slippageTolerancePct: 0.2,
    cooldownSec: 120,
  },
  BALANCED: {
    riskPerTradePct: 1.0,
    maxTradeUsdt: 20,
    maxOpenPositions: 3,
    maxTradesPerHour: 10,
    minEdgePct: 0.4,
    takeProfitPct: 1.5,
    stopLossPct: 0.8,
    slippageTolerancePct: 0.3,
    cooldownSec: 45,
  },
  AGGRESSIVE: {
    riskPerTradePct: 2.0,
    maxTradeUsdt: 40,
    maxOpenPositions: 5,
    maxTradesPerHour: 25,
    minEdgePct: 0.25,
    takeProfitPct: 2.0,
    stopLossPct: 1.0,
    slippageTolerancePct: 0.5,
    cooldownSec: 10,
  },
};

// Absolute envelope every resolved profile is clamped into (sanity bounds that
// even CUSTOM/AUTO cannot exceed — the per-USDT hard cap still applies on top
// in safety.ts).
const BOUNDS = {
  riskPerTradePct: [0.1, 3.0],
  maxTradeUsdt: [1, 100],
  maxOpenPositions: [1, 8],
  maxTradesPerHour: [1, 40],
  minEdgePct: [0.1, 5.0],
  takeProfitPct: [0.3, 10.0],
  stopLossPct: [0.2, 5.0],
  slippageTolerancePct: [0.05, 1.0],
  cooldownSec: [3, 600],
} as const;

function clampNum(v: number, [lo, hi]: readonly [number, number]): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

export function clampParams(p: ProfileParams): ProfileParams {
  return {
    riskPerTradePct: clampNum(p.riskPerTradePct, BOUNDS.riskPerTradePct),
    maxTradeUsdt: clampNum(p.maxTradeUsdt, BOUNDS.maxTradeUsdt),
    maxOpenPositions: Math.round(clampNum(p.maxOpenPositions, BOUNDS.maxOpenPositions)),
    maxTradesPerHour: Math.round(clampNum(p.maxTradesPerHour, BOUNDS.maxTradesPerHour)),
    minEdgePct: clampNum(p.minEdgePct, BOUNDS.minEdgePct),
    takeProfitPct: clampNum(p.takeProfitPct, BOUNDS.takeProfitPct),
    stopLossPct: clampNum(p.stopLossPct, BOUNDS.stopLossPct),
    slippageTolerancePct: clampNum(p.slippageTolerancePct, BOUNDS.slippageTolerancePct),
    cooldownSec: Math.round(clampNum(p.cooldownSec, BOUNDS.cooldownSec)),
  };
}

// --- Adaptive (AUTO) engine -------------------------------------------------

export interface MarketRegime {
  /** Recent volatility, percent (e.g. 24h range or stddev of returns). */
  volatilityPct: number;
  /** Trend strength in [-1, 1]; sign = direction, magnitude = conviction. */
  trendStrength: number;
  /** Account equity in USDT. */
  balanceUsdt: number;
  /** Current drawdown from peak, percent (0 = at peak). */
  drawdownPct: number;
}

/**
 * AUTO mode: choose effective params from the market regime and the account.
 * Philosophy: lean INTO clean trends with healthy balance, lean OUT of chop,
 * thin balance and drawdowns. Starts from BALANCED and scales each knob, then
 * clamps to BOUNDS. Returns params + a human rationale.
 */
export function adaptiveParams(m: MarketRegime): { params: ProfileParams; rationale: string } {
  const base = { ...PROFILES.BALANCED };
  const notes: string[] = [];

  // Volatility: high vol -> smaller size, wider stops, higher edge bar.
  const vol = Math.max(0, m.volatilityPct);
  if (vol > 4) {
    base.maxTradeUsdt *= 0.6;
    base.riskPerTradePct *= 0.6;
    base.stopLossPct *= 1.4;
    base.minEdgePct *= 1.4;
    notes.push(`high vol ${vol.toFixed(1)}% → smaller size, wider stop`);
  } else if (vol < 1) {
    base.maxTradeUsdt *= 1.15;
    base.minEdgePct *= 0.9;
    notes.push(`calm ${vol.toFixed(1)}% → slightly larger size`);
  }

  // Trend: strong, clean trend -> a bit more size/frequency.
  const conviction = Math.min(1, Math.abs(m.trendStrength));
  if (conviction > 0.5) {
    base.maxTradeUsdt *= 1 + 0.3 * conviction;
    base.maxTradesPerHour *= 1 + 0.4 * conviction;
    base.minEdgePct *= 0.85;
    notes.push(`trend conviction ${conviction.toFixed(2)} → lean in`);
  } else {
    // Chop -> demand more edge, trade less.
    base.minEdgePct *= 1.25;
    base.maxTradesPerHour *= 0.7;
    notes.push("weak/no trend → demand more edge, trade less");
  }

  // Thin balance -> force conservative absolute sizing.
  // Treat a zero/unknown balance as thin too (conservative is the safe default).
  if (m.balanceUsdt < 300) {
    base.maxTradeUsdt = Math.min(base.maxTradeUsdt, PROFILES.CONSERVATIVE.maxTradeUsdt);
    base.maxOpenPositions = Math.min(base.maxOpenPositions, 2);
    notes.push(`thin balance $${m.balanceUsdt.toFixed(0)} → conservative sizing`);
  }

  // Drawdown -> de-risk progressively.
  if (m.drawdownPct > 5) {
    const cut = Math.min(0.7, m.drawdownPct / 20);
    base.maxTradeUsdt *= 1 - cut;
    base.riskPerTradePct *= 1 - cut;
    base.maxTradesPerHour *= 1 - cut;
    notes.push(`drawdown ${m.drawdownPct.toFixed(1)}% → de-risk ${(cut * 100).toFixed(0)}%`);
  }

  return { params: clampParams(base), rationale: notes.join("; ") || "balanced regime" };
}

// --- Resolution -------------------------------------------------------------

/**
 * Resolve the active config from a stored settings object (DB) and, for AUTO,
 * an optional market regime. This is the single function the engine calls to
 * learn "how aggressive am I right now and am I even allowed to act".
 *
 * settings shape (all optional):
 *   { profile, autopilot, adaptive, custom: Partial<ProfileParams>, ... }
 */
export function resolveConfig(
  settings: Record<string, unknown> | null | undefined,
  market?: MarketRegime,
): ResolvedConfig {
  const s = settings ?? {};
  const rawName = String(s.profile ?? "BALANCED").toUpperCase() as ProfileName;
  const name: ProfileName = ["CONSERVATIVE", "BALANCED", "AGGRESSIVE", "CUSTOM", "AUTO"].includes(rawName)
    ? rawName
    : "BALANCED";
  const autopilot = s.autopilot === undefined ? false : Boolean(s.autopilot);
  const adaptive = name === "AUTO" || Boolean(s.adaptive);

  let params: ProfileParams;
  let rationale: string;

  if (name === "AUTO" && market) {
    const a = adaptiveParams(market);
    params = a.params;
    rationale = `AUTO: ${a.rationale}`;
  } else if (name === "CUSTOM") {
    const custom = (s.custom ?? {}) as Partial<ProfileParams>;
    params = clampParams({ ...PROFILES.BALANCED, ...custom });
    rationale = "CUSTOM overrides on BALANCED base";
  } else if (name === "AUTO") {
    // AUTO requested but no market snapshot available -> safe BALANCED fallback.
    params = clampParams({ ...PROFILES.BALANCED });
    rationale = "AUTO requested without market snapshot → BALANCED fallback";
  } else {
    params = clampParams({ ...PROFILES[name as "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE"] });
    rationale = `${name} preset`;
  }

  return { profile: name, autopilot, adaptive, rationale, ...params };
}
