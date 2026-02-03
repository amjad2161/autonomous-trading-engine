import { supabase } from "@/integrations/supabase/client";
import { GateCredentials } from "@/hooks/useCredentials";

export interface Opportunity {
  id: string;
  type: 'arbitrage' | 'spread' | 'breakout' | 'reversion';
  symbol: string;
  expectedEdge: number;
  confidence: number;
  expiresIn: number;
  riskLevel: 'low' | 'medium' | 'high';
  details: string;
  route?: string[];
}

export interface ScanResult {
  success: boolean;
  opportunities: Opportunity[];
  scannedPairs: number;
  timestamp: number;
  error?: string;
}

// Get credentials from localStorage
function getStoredCredentials(): GateCredentials | null {
  const stored = localStorage.getItem('gate_credentials');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export async function scanOpportunities(
  minSpread = 0.15,
  minVolume = 50000
): Promise<ScanResult> {
  const credentials = getStoredCredentials();
  
  const { data, error } = await supabase.functions.invoke('opportunity-scanner', {
    body: { credentials, minSpread, minVolume }
  });

  if (error) {
    throw new Error(`Scanner failed: ${error.message}`);
  }

  return data as ScanResult;
}
