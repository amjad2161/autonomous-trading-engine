import { useMutation } from "@tanstack/react-query";
import { runBacktest, BacktestConfig, BacktestResult } from "@/lib/backtest";

export function useBacktest() {
  return useMutation({
    mutationFn: (config: BacktestConfig) => runBacktest(config),
  });
}

export type { BacktestConfig, BacktestResult };
