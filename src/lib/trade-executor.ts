import { supabase } from "@/integrations/supabase/client";
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

// Server mode - credentials are stored on the server
const USE_SERVER_CREDENTIALS = true;

export async function executeTrade(
  opportunity: Opportunity,
  settings: AutoExecuteSettings,
  tradeAmount: number
): Promise<TradeResult> {
  // Calculate amount based on trade size and price
  const amount = (tradeAmount / 100).toFixed(6);
  
  const { data, error } = await supabase.functions.invoke('execute-trade', {
    body: {
      // In server mode, don't send credentials - server will use env vars
      credentials: USE_SERVER_CREDENTIALS ? undefined : null,
      opportunityType: opportunity.type,
      symbol: opportunity.symbol,
      side: 'buy',
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
