import { useMutation } from "@tanstack/react-query";
import { runOptimization, OptimizeConfig, OptimizationResult } from "@/lib/optimize";

export function useOptimization() {
  return useMutation({
    mutationFn: (config: OptimizeConfig) => runOptimization(config),
  });
}

export type { OptimizeConfig, OptimizationResult };
