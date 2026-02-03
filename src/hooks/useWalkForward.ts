import { useMutation } from "@tanstack/react-query";
import { runWalkForward, WalkForwardConfig, WalkForwardResult } from "@/lib/walk-forward";

export function useWalkForward() {
  return useMutation({
    mutationFn: (config: WalkForwardConfig) => runWalkForward(config),
  });
}

export type { WalkForwardConfig, WalkForwardResult };
