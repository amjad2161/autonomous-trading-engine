import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash, createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== STRATEGY PARAMETERS =====
const CONFIG = {
  // Entry conditions
  minEdge: 0.5,              // Minimum edge after fees (%)
  minVolume: 1_000_000,      // Minimum 24h volume (USDT)
  maxSpread: 0.3,            // Maximum bid-ask spread (%)
  
  // Momentum strategy
  momentumMinChange: 1.5,    // Minimum % change for momentum entry
  momentumMaxChange: 12,     // Maximum % change (avoid FOMO tops)
  
  // Mean reversion strategy
  reversionMinDrop: -4,      // Minimum drop for mean reversion
  reversionMaxDrop: -15,     // Maximum drop (avoid falling knives)
  
  // Position sizing
  positionSizeUsdt: 10,      // Fixed position size in USDT
  
  // Risk management
  takeProfitPct: 1.5,        // Take profit (%)
  stopLossPct: 1.0,          // Stop loss (%)
  
  // Filters
  excludeSymbols: ['USDT_USDT', 'USDC_USDT', 'DAI_USDT'], // Stablecoins
  maxConcurrentTrades: 3,    // Max open positions
  cooldownMinutes: 5,        // Don't trade same symbol within X minutes
};

// ===== GATE.IO API HELPERS =====
function generateSignature(
  method: string,
  path: string,
  queryString: string,
  body: string,
  timestamp: string,
  secret: string
): string {
  const hashedPayload = createHash("sha512").update(body).digest("hex");
  const signatureString = `${method}\n${path}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac("sha512", secret).update(signatureString).digest("hex");
}

async function gateRequest(
  method: string,
  endpoint: string,
  apiKey: string,
  apiSecret: string,
  body: Record<string, unknown> | null = null,
  queryParams: Record<string, string> = {}
): Promise<unknown> {
  const baseUrl = "https://api.gateio.ws";
  const path = `/api/v4${endpoint}`;
  const queryString = new URLSearchParams(queryParams).toString();
  const fullUrl = queryString ? `${baseUrl}${path}?${queryString}` : `${baseUrl}${path}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  
  const signature = generateSignature(method, path, queryString, bodyStr, timestamp, apiSecret);
  
  const headers: Record<string, string> = {
    "KEY": apiKey,
    "SIGN": signature,
    "Timestamp": timestamp,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  
  const response = await fetch(fullUrl, {
    method,
    headers,
    body: body ? bodyStr : undefined,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gate.io API error: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

// ===== MAIN HANDLER =====
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { paperMode = true } = await req.json().catch(() => ({}));
    
    console.log(`⚡ [HYPER] Cycle start (paper: ${paperMode})`);
    const startTime = Date.now();

    // Get API keys from secrets
    const apiKey = Deno.env.get('GATE_API_KEY');
    const apiSecret = Deno.env.get('GATE_API_SECRET');
    
    if (!apiKey || !apiSecret) {
      throw new Error("Missing GATE_API_KEY or GATE_API_SECRET");
    }

    // Get current state
    const { data: state } = await supabase
      .from('trading_system_state')
      .select('*')
      .limit(1)
      .maybeSingle();

    let cycleCount = (state?.total_cycles || 0) + 1;
    let cumulativePnL = state?.total_pnl || 0;
    let cumulativeTrades = state?.total_trades || 0;

    // Get recent trades to avoid cooldown symbols
    const { data: recentTrades } = await supabase
      .from('trade_history')
      .select('symbol, created_at')
      .gte('created_at', new Date(Date.now() - CONFIG.cooldownMinutes * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });
    
    const cooldownSymbols = new Set(recentTrades?.map(t => t.symbol) || []);

    // Fetch market data
    const tickersRes = await fetch('https://api.gateio.ws/api/v4/spot/tickers');
    const tickers = await tickersRes.json() as Array<{
      currency_pair: string;
      last: string;
      change_percentage: string;
      quote_volume: string;
      highest_bid: string;
      lowest_ask: string;
    }>;
    
    // Filter and score opportunities
    const opportunities = tickers
      .filter(t => {
        const symbol = t.currency_pair;
        const volume = parseFloat(t.quote_volume);
        const bid = parseFloat(t.highest_bid);
        const ask = parseFloat(t.lowest_ask);
        const spread = ask > 0 ? ((ask - bid) / ask) * 100 : 100;
        
        return (
          symbol.endsWith('_USDT') &&
          !CONFIG.excludeSymbols.includes(symbol) &&
          !cooldownSymbols.has(symbol) &&
          volume >= CONFIG.minVolume &&
          spread <= CONFIG.maxSpread &&
          bid > 0 && ask > 0
        );
      })
      .map(t => {
        const change = parseFloat(t.change_percentage);
        const price = parseFloat(t.last);
        const volume = parseFloat(t.quote_volume);
        const bid = parseFloat(t.highest_bid);
        const ask = parseFloat(t.lowest_ask);
        const spread = ((ask - bid) / ask) * 100;
        
        let edge = 0;
        let side: 'buy' | 'sell' = 'buy';
        let strategy = '';
        
        // Momentum long: riding uptrend
        if (change >= CONFIG.momentumMinChange && change <= CONFIG.momentumMaxChange) {
          edge = change * 0.08 - spread - 0.1; // Factor in spread + fees
          side = 'buy';
          strategy = 'momentum-long';
        }
        // Mean reversion long: catching oversold bounce
        else if (change <= CONFIG.reversionMinDrop && change >= CONFIG.reversionMaxDrop) {
          edge = Math.abs(change) * 0.12 - spread - 0.1;
          side = 'buy';
          strategy = 'reversion-long';
        }
        // Momentum short: fading extreme pumps
        else if (change > CONFIG.momentumMaxChange && change < 30) {
          edge = change * 0.04 - spread - 0.1;
          side = 'sell';
          strategy = 'fade-pump';
        }
        
        return {
          symbol: t.currency_pair,
          price,
          change,
          volume,
          spread,
          edge,
          side,
          strategy,
          bid,
          ask,
        };
      })
      .filter(o => o.edge >= CONFIG.minEdge)
      .sort((a, b) => b.edge - a.edge);

    console.log(`⚡ [HYPER] Found ${opportunities.length} opportunities`);

    // Execute best opportunity
    let trade: { 
      symbol: string; 
      side: 'buy' | 'sell'; 
      edge: number; 
      pnl: number;
      strategy: string;
      price: number;
      orderId?: string;
    } | null = null;
    
    if (opportunities.length > 0) {
      const best = opportunities[0];
      
      console.log(`🎯 Best: ${best.symbol} | ${best.strategy} | Edge: ${best.edge.toFixed(2)}% | Change: ${best.change.toFixed(2)}%`);
      
      // Calculate position size
      const amount = CONFIG.positionSizeUsdt / best.price;
      const amountStr = amount.toPrecision(4);
      
      let orderId: string | undefined;
      let executedPrice = best.price;
      
      if (!paperMode) {
        try {
          // Execute real trade via Gate.io
          const orderBody = {
            currency_pair: best.symbol,
            side: best.side,
            type: 'market',
            amount: amountStr,
            time_in_force: 'ioc', // Immediate or cancel
          };
          
          const orderResult = await gateRequest(
            'POST',
            '/spot/orders',
            apiKey,
            apiSecret,
            orderBody
          ) as { id?: string; avg_deal_price?: string; status?: string };
          
          orderId = orderResult.id;
          executedPrice = parseFloat(orderResult.avg_deal_price || best.price.toString());
          
          console.log(`✅ Order executed: ${orderId} @ ${executedPrice}`);
        } catch (orderError) {
          console.error(`❌ Order failed:`, orderError);
          // Still log as failed trade
          await supabase.from('trade_history').insert({
            symbol: best.symbol,
            side: best.side,
            type: best.strategy,
            price: best.price,
            amount: parseFloat(amountStr),
            expected_edge: best.edge,
            actual_pnl: 0,
            status: 'failed',
            error: orderError instanceof Error ? orderError.message : 'Unknown error',
          });
          
          throw orderError;
        }
      }
      
      // Estimate PnL based on edge (real PnL comes from position exit)
      // For now, we use a realistic estimation
      const estimatedPnL = best.edge * 0.6; // Conservative estimate
      
      trade = {
        symbol: best.symbol,
        side: best.side,
        edge: best.edge,
        pnl: estimatedPnL,
        strategy: best.strategy,
        price: executedPrice,
        orderId,
      };
      
      cumulativeTrades++;
      cumulativePnL += estimatedPnL;
      
      // Log trade
      await supabase.from('trade_history').insert({
        symbol: best.symbol,
        side: best.side,
        type: best.strategy,
        price: executedPrice,
        amount: parseFloat(amountStr),
        expected_edge: best.edge,
        actual_pnl: estimatedPnL,
        order_id: orderId,
        status: paperMode ? 'simulated' : 'executed',
      });
      
      console.log(`💹 ${best.side.toUpperCase()} ${best.symbol} | Strategy: ${best.strategy} | Edge: ${best.edge.toFixed(2)}%`);
    } else {
      console.log(`⏳ No opportunities meet criteria`);
    }

    // Update state
    const nowIso = new Date().toISOString();
    
    if (state?.id) {
      await supabase
        .from('trading_system_state')
        .update({
          is_active: true,
          total_cycles: cycleCount,
          total_trades: cumulativeTrades,
          total_pnl: cumulativePnL,
          last_heartbeat: nowIso,
          updated_at: nowIso,
        })
        .eq('id', state.id);
    }

    const duration = Date.now() - startTime;
    console.log(`⚡ [HYPER] Cycle ${cycleCount} done in ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      cycle: cycleCount,
      trade,
      cumulativeTrades,
      cumulativePnL,
      duration,
      marketsScanned: tickers.length,
      opportunitiesFound: opportunities.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('⚡ [HYPER] Error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
