import { supabase } from "@/integrations/supabase/client";

export interface Opportunity {
  id: string;
  type: 'arbitrage' | 'spread' | 'breakout' | 'reversion' | 'momentum' | 'volume_spike';
  symbol: string;
  expectedEdge: number;
  confidence: number;
  expiresIn: number;
  riskLevel: 'low' | 'medium' | 'high';
  details: string;
  route?: string[];
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
}

export interface ScanResult {
  success: boolean;
  opportunities: Opportunity[];
  scannedPairs: number;
  timestamp: number;
  error?: string;
}


export async function scanOpportunities(
  minSpread = 0.15,
  minVolume = 50000
): Promise<ScanResult> {
  // SECURITY: Never send credentials from client - server uses env vars only
  const { data, error } = await supabase.functions.invoke('opportunity-scanner', {
    body: { minSpread, minVolume }
  });

  if (error) {
    throw new Error(`Scanner failed: ${error.message}`);
  }

  return data as ScanResult;
}
