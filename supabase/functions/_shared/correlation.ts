// =============================================================================
// CORRELATION-AWARE EXPOSURE  (Master Spec #8, #53)
// =============================================================================
// Avoid stacking "the same risk" five times. Pure helpers: a static group map
// (assets that tend to move together) + a returns-based Pearson correlation, and
// a group-exposure cap gate. No I/O.
// =============================================================================

/** Base-asset -> correlation group. Extend freely; unknown -> its own group. */
export const CORRELATION_GROUPS: Record<string, string> = {
  BTC: "majors", ETH: "majors", WBTC: "majors",
  SOL: "l1", AVAX: "l1", ADA: "l1", DOT: "l1", NEAR: "l1", APT: "l1", SUI: "l1",
  BNB: "exchange", OKB: "exchange", GT: "exchange", CRO: "exchange",
  DOGE: "meme", SHIB: "meme", PEPE: "meme", WIF: "meme", BONK: "meme",
  UNI: "defi", AAVE: "defi", MKR: "defi", LDO: "defi", CRV: "defi",
  USDT: "stable", USDC: "stable", DAI: "stable", FDUSD: "stable",
};

/** Group for a symbol like "BTC_USDT" or a bare base "BTC". */
export function assetGroup(symbol: string): string {
  const base = symbol.split("_")[0].toUpperCase();
  return CORRELATION_GROUPS[base] ?? base.toLowerCase();
}

export interface ExposureItem {
  symbol: string;
  notionalUsdt: number;
}

/** Total USDT exposure within the group of `symbol`. */
export function groupExposureUsdt(items: ExposureItem[], symbol: string): number {
  const g = assetGroup(symbol);
  return items
    .filter((it) => assetGroup(it.symbol) === g)
    .reduce((s, it) => s + (it.notionalUsdt > 0 ? it.notionalUsdt : 0), 0);
}

/**
 * Correlation gate: may we add `addNotionalUsdt` of `symbol` without exceeding
 * the per-group exposure cap? Returns { ok, group, current, cap }.
 */
export function correlationGate(
  items: ExposureItem[],
  symbol: string,
  addNotionalUsdt: number,
  groupCapUsdt: number,
): { ok: boolean; group: string; current: number; cap: number } {
  const current = groupExposureUsdt(items, symbol);
  return {
    ok: current + addNotionalUsdt <= groupCapUsdt,
    group: assetGroup(symbol),
    current,
    cap: groupCapUsdt,
  };
}

/** Pearson correlation of two equal-length return series (-1..1). */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}
