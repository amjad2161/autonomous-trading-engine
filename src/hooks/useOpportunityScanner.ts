import { useQuery } from "@tanstack/react-query";
import { scanOpportunities, Opportunity, ScanResult } from "@/lib/opportunity-scanner";

export function useOpportunityScanner(enabled = true) {
  return useQuery({
    queryKey: ['opportunities'],
    queryFn: () => scanOpportunities(0.15, 50000),
    refetchInterval: 10000, // Scan every 10 seconds
    enabled,
    retry: 1,
    staleTime: 5000,
  });
}

export type { Opportunity, ScanResult };
