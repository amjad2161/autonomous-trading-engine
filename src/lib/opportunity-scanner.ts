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

// Server mode - credentials are stored on the server
const USE_SERVER_CREDENTIALS = true;

export async function scanOpportunities(
  minSpread = 0.15,
  minVolume = 50000
): Promise<ScanResult> {
  // In server mode, don't send credentials - server will use env vars
  const credentials = USE_SERVER_CREDENTIALS ? undefined : null;
  
  const { data, error } = await supabase.functions.invoke('opportunity-scanner', {
    body: { credentials, minSpread, minVolume }
  });

  if (error) {
    throw new Error(`Scanner failed: ${error.message}`);
  }

  return data as ScanResult;
}
