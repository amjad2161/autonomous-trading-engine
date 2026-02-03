import { supabase } from "@/integrations/supabase/client";
import { GateCredentials } from "@/hooks/useCredentials";
import { Opportunity } from "@/lib/opportunity-scanner";
import { AutoExecuteSettings } from "@/hooks/useAutoExecute";

export interface TradeResult {
  success: boolean;
  type: 'spread' | 'arbitrage';
  orderId?: string;
  executedAmount?: string;
  executedPrice?: string;
  error?: string;
  timestamp: number;
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

export async function executeTrade(
  opportunity: Opportunity,
  settings: AutoExecuteSettings,
  tradeAmount: number
): Promise<TradeResult> {
  const credentials = getStoredCredentials();
  
  if (!credentials) {
    return {
      success: false,
      type: opportunity.type as 'spread' | 'arbitrage',
      error: 'No credentials found',
      timestamp: Date.now(),
    };
  }

  // Calculate amount based on trade size and price
  // For simplicity, we'll use a fixed small amount for the trade
  const amount = (tradeAmount / 100).toFixed(6); // Divide by approximate price
  
  const { data, error } = await supabase.functions.invoke('execute-trade', {
    body: {
      credentials,
      opportunityType: opportunity.type,
      symbol: opportunity.symbol,
      side: 'buy', // Default to buy for market making
      amount,
      maxTradeSize: settings.maxTradeSize,
      minEdge: settings.minEdge,
      expectedEdge: opportunity.expectedEdge,
      route: opportunity.route,
    }
  });

  if (error) {
    return {
      success: false,
      type: opportunity.type as 'spread' | 'arbitrage',
      error: error.message,
      timestamp: Date.now(),
    };
  }

  return data as TradeResult;
}
