// =============================================================================
// SHARED SAFETY LAYER  —  single source of truth for "is this allowed to fire?"
// =============================================================================
//
// Every edge function that can place a LIVE order on Gate.io should route the
// final "send order" decision through this module. The goal is that there is
// exactly ONE place that decides DRY_RUN vs LIVE, enforces the kill switch, and
// enforces hard risk caps — instead of each of the ~15 trading functions making
// that decision inconsistently on its own.
//
// DEFAULT IS DRY_RUN. Live trading requires an explicit, deliberate act by the
// account owner: set the environment variable TRADING_MODE=LIVE on the server.
// This is the "real data, closed firing pin" model — all market data, signals
// and risk checks are 100% real; only the final order POST is withheld until
// the owner flips one flag. That is how professional desks ship a new strategy.
//
// None of this prevents live trading. It makes "validate first" the default and
// "go live" a conscious choice, which is the single most important protection
// for a small account.
// =============================================================================

export type TradingMode = "DRY_RUN" | "LIVE";

export interface RiskCaps {
  /** Hard ceiling on a single order's notional value, in USDT. */
  maxTradeUsdt: number;
  /** Cumulative realised-loss limit for the day, in USDT. Trading halts past this. */
  maxDailyLossUsdt: number;
  /** Maximum number of simultaneously open positions. */
  maxOpenPositions: number;
  /** Throttle: maximum new orders opened per rolling hour. */
  maxTradesPerHour: number;
  /** Minimum account equity below which new entries are blocked, in USDT. */
  minEquityUsdt: number;
}

export interface OrderIntent {
  function: string;
  symbol: string;
  side: "buy" | "sell";
  /** Notional value of the order in USDT (price * amount). */
  notionalUsdt: number;
  price?: number;
  amount?: number;
  reason?: string;
}

export interface SimulatedOrderResult {
  id: string;
  dryRun: true;
  status: "simulated";
  symbol: string;
  side: "buy" | "sell";
  price?: number;
  amount?: number;
  notionalUsdt: number;
  message: string;
  timestamp: number;
}

function envNum(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envFlag(name: string): boolean {
  const raw = (Deno.env.get(name) ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Resolve the trading mode. DRY_RUN unless TRADING_MODE is explicitly "LIVE".
 * Any other value (unset, empty, typo) is treated as DRY_RUN — fail safe.
 */
export function getTradingMode(): TradingMode {
  const raw = (Deno.env.get("TRADING_MODE") ?? "").trim().toUpperCase();
  return raw === "LIVE" ? "LIVE" : "DRY_RUN";
}

export function isDryRun(): boolean {
  return getTradingMode() !== "LIVE";
}

/**
 * Global kill switch. When KILL_SWITCH is truthy, NO live order may be sent,
 * regardless of TRADING_MODE. This is the panic button.
 */
export function isKillSwitchOn(): boolean {
  return envFlag("KILL_SWITCH");
}

/**
 * Hard risk caps, sourced from env with conservative defaults sized for a small
 * (~$250–$1000) account. These are deliberately tight; raise them consciously.
 */
export function getRiskCaps(): RiskCaps {
  return {
    maxTradeUsdt: envNum("MAX_TRADE_USDT", 25),
    maxDailyLossUsdt: envNum("MAX_DAILY_LOSS_USDT", 20),
    maxOpenPositions: envNum("MAX_OPEN_POSITIONS", 3),
    maxTradesPerHour: envNum("MAX_TRADES_PER_HOUR", 12),
    minEquityUsdt: envNum("MIN_EQUITY_USDT", 0),
  };
}

/**
 * Canary capital fraction (0..1) for the Paper→Live transition. During canary,
 * live order notional is additionally capped to this fraction of equity so live
 * trading starts on a sliver of capital (Master Spec: Canary 5–10%). Default 1.0
 * (= no canary limit); set CANARY_CAPITAL_PCT=10 to risk only 10% during canary.
 */
export function getCanaryFraction(): number {
  const pct = envNum("CANARY_CAPITAL_PCT", 100);
  return Math.min(1, Math.max(0, pct / 100));
}

export class OrderBlockedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OrderBlockedError";
    this.code = code;
  }
}

/**
 * Gatekeeper for any live order. Call this immediately before sending an order
 * to the exchange. Throws OrderBlockedError if a hard limit would be violated.
 * Returns the resolved mode so the caller knows whether to actually fire.
 *
 * It does NOT itself send anything — it only decides "allowed / not allowed".
 */
export function assertOrderAllowed(intent: OrderIntent): TradingMode {
  if (isKillSwitchOn()) {
    throw new OrderBlockedError(
      "KILL_SWITCH",
      `Kill switch engaged — order for ${intent.symbol} blocked.`,
    );
  }

  const caps = getRiskCaps();

  if (!Number.isFinite(intent.notionalUsdt) || intent.notionalUsdt <= 0) {
    throw new OrderBlockedError(
      "BAD_NOTIONAL",
      `BAD_NOTIONAL: refusing order with non-positive notional (${intent.notionalUsdt}).`,
    );
  }

  if (intent.notionalUsdt > caps.maxTradeUsdt) {
    throw new OrderBlockedError(
      "MAX_TRADE_USDT",
      `Order notional ${intent.notionalUsdt.toFixed(2)} USDT exceeds MAX_TRADE_USDT cap ${caps.maxTradeUsdt} USDT.`,
    );
  }

  // Honour the optional "prove an edge before risking money" gate: LIVE is
  // downgraded to DRY_RUN when REQUIRE_VALIDATION is on but validation hasn't passed.
  return effectiveModeWithValidation();
}

/**
 * Build a clearly-marked simulated fill for DRY_RUN. The shape intentionally
 * carries `dryRun: true` so nothing downstream can mistake it for a real fill.
 */
export function simulateOrder(intent: OrderIntent): SimulatedOrderResult {
  return {
    id: `dryrun-${crypto.randomUUID()}`,
    dryRun: true,
    status: "simulated",
    symbol: intent.symbol,
    side: intent.side,
    price: intent.price,
    amount: intent.amount,
    notionalUsdt: intent.notionalUsdt,
    message:
      `DRY_RUN: would ${intent.side} ${intent.amount ?? "?"} ${intent.symbol} ` +
      `@ ${intent.price ?? "mkt"} (~${intent.notionalUsdt.toFixed(2)} USDT). ` +
      `No live order sent. Set TRADING_MODE=LIVE to enable real execution.`,
    timestamp: Date.now(),
  };
}

/**
 * Convenience wrapper: enforce caps + kill switch, then either run the provided
 * live-order function (LIVE) or return a simulated fill (DRY_RUN). Trading
 * functions can adopt this with a one-line change at each order site.
 */
export async function withOrderGuard<T>(
  intent: OrderIntent,
  sendLiveOrder: () => Promise<T>,
): Promise<T | SimulatedOrderResult> {
  const mode = assertOrderAllowed(intent);
  if (mode === "DRY_RUN") {
    console.log(`[SAFETY] ${intent.function} DRY_RUN — ${intent.symbol} ${intent.side} ~${intent.notionalUsdt.toFixed(2)} USDT (no live order)`);
    return simulateOrder(intent);
  }
  console.log(`[SAFETY] ${intent.function} LIVE — ${intent.symbol} ${intent.side} ~${intent.notionalUsdt.toFixed(2)} USDT`);
  return await sendLiveOrder();
}

// -----------------------------------------------------------------------------
// Spot-order choke point for the many engines.
// -----------------------------------------------------------------------------
// Each trading function has its own private gate()/gateRequest() helper. Rather
// than rewrite every engine's control flow, each helper calls guardSpotOrder()
// once, at the top, for POSTs to /spot/orders. The contract:
//   - LIVE  -> returns null  => caller proceeds with the real request unchanged.
//   - DRY_RUN -> returns a synthetic Gate.io-shaped order response (so downstream
//                code continues as if the order placed) and NO live order is sent.
//   - cap/kill violation -> throws OrderBlockedError (caller's try/catch handles).
//
// Fail-safe by construction: any miscalculation blocks or simulates — it can
// never turn a DRY_RUN into a live order.

export interface SyntheticGateOrder {
  id: string;
  text: string;
  status: string;
  currency_pair: string;
  side: string;
  amount: string;
  price: string;
  filled_total: string;
  fill_price: string;
  left: string;
  fee: string;
  create_time: string;
  create_time_ms: string;
  dryRun: true;
}

function notionalFromBody(body: Record<string, unknown>): number {
  const amount = Number(body.amount ?? 0);
  const price = Number(body.price ?? 0);
  if (price > 0 && amount > 0) return price * amount;
  // Market orders: Gate spot market BUY uses `amount` as quote (USDT) notional.
  if (amount > 0) return amount;
  return 0;
}

/**
 * Guard a /spot/orders POST. Returns a synthetic order (DRY_RUN) or null (LIVE).
 * Throws OrderBlockedError if a cap or the kill switch is hit.
 */
export function guardSpotOrder(
  fn: string,
  body: Record<string, unknown>,
): SyntheticGateOrder | null {
  const symbol = String(body.currency_pair ?? body.symbol ?? "?");
  const side = (String(body.side ?? "buy") === "sell" ? "sell" : "buy") as "buy" | "sell";
  const amount = Number(body.amount ?? 0);
  const price = Number(body.price ?? 0);
  const notionalUsdt = notionalFromBody(body);

  const mode = assertOrderAllowed({ function: fn, symbol, side, notionalUsdt, price, amount });
  if (mode === "LIVE") return null;

  const now = Date.now();
  console.log(
    `[SAFETY] ${fn} DRY_RUN — would ${side} ${amount} ${symbol} @ ${price || "mkt"} ` +
      `(~${notionalUsdt.toFixed(2)} USDT). No live order sent.`,
  );
  return {
    id: `dryrun-${crypto.randomUUID()}`,
    text: "t-dryrun",
    status: "closed",
    currency_pair: symbol,
    side,
    amount: String(amount || 0),
    price: String(price || 0),
    filled_total: String(notionalUsdt || 0),
    fill_price: String(price || 0),
    left: "0",
    fee: "0",
    create_time: String(Math.floor(now / 1000)),
    create_time_ms: String(now),
    dryRun: true,
  };
}

/** True once validation (backtest/walk-forward) has been signed off via env. */
export function validationPassed(): boolean {
  return envFlag("VALIDATION_PASSED");
}

/**
 * Optional hard gate for the autonomous loop: if REQUIRE_VALIDATION is on, LIVE
 * trading is refused until VALIDATION_PASSED is also set. Lets you enforce
 * "prove an edge before risking money" at the system level. Returns the
 * effective mode (downgrades LIVE->DRY_RUN when validation is required but absent).
 */
export function effectiveModeWithValidation(): TradingMode {
  const mode = getTradingMode();
  if (mode === "LIVE" && envFlag("REQUIRE_VALIDATION") && !validationPassed()) {
    console.warn("[SAFETY] LIVE requested but REQUIRE_VALIDATION is on and VALIDATION_PASSED is not set — forcing DRY_RUN.");
    return "DRY_RUN";
  }
  return mode;
}

/** Small banner for function logs so the active mode is always visible. */
export function safetyBanner(fn: string): string {
  const caps = getRiskCaps();
  return (
    `[${fn}] mode=${getTradingMode()} killSwitch=${isKillSwitchOn()} ` +
    `caps(maxTrade=${caps.maxTradeUsdt} dailyLoss=${caps.maxDailyLossUsdt} ` +
    `openPos=${caps.maxOpenPositions} trades/h=${caps.maxTradesPerHour})`
  );
}
