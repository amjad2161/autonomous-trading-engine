// =============================================================================
// SHARED INDICATOR MATH  — extracted from the duplicated copies in
// backtest / optimize-strategy / walk-forward. Pure, unit-tested.
// =============================================================================

/** Simple Moving Average. result[i] = mean of the last `period` values; NaN before warm-up. */
export function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

/** Rolling population standard deviation over `period`; NaN before warm-up. */
export function stdDev(data: number[], period: number): number[] {
  const means = sma(data, period);
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      const mean = means[i];
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      result.push(Math.sqrt(variance));
    }
  }
  return result;
}
