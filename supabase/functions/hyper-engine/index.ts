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
  basePositionUsdt: 10,      // Base position size in USDT
  minPositionUsdt: 5,        // Minimum position size
  maxPositionUsdt: 50,       // Maximum position size
  
  // Risk management
  takeProfitPct: 1.5,        // Take profit (%)
  stopLossPct: 1.0,          // Stop loss (%)
  
  // Filters - EXCLUDE leveraged tokens (3L, 5L, 3S, 5S patterns)
  excludeSymbols: ['USDT_USDT', 'USDC_USDT', 'DAI_USDT'],
  excludePatterns: ['3L_USDT', '5L_USDT', '3S_USDT', '5S_USDT', '2L_USDT', '2S_USDT'],
  
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

// Fetch USDT balance
async function getUsdtBalance(apiKey: string, apiSecret: string): Promise<number> {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts', apiKey, apiSecret) as Array<{
      currency: string;
      available: string;
    }>;
    const usdtAccount = accounts.find(a => a.currency === 'USDT');
    return usdtAccount ? parseFloat(usdtAccount.available) : 0;
  } catch (e) {
    console.error('Failed to get balance:', e);
    return 0;
  }
}

// Fetch currency info for minimum order sizes
async function getCurrencyPairs(): Promise<Map<string, { minAmount: number; amountPrecision: number }>> {
  try {
    const pairs = await fetch('https://api.gateio.ws/api/v4/spot/currency_pairs').then(r => r.json()) as Array<{
      id: string;
      min_base_amount?: string;
      amount_precision?: number;
    }>;
    
    const map = new Map<string, { minAmount: number; amountPrecision: number }>();
    for (const p of pairs) {
      map.set(p.id, {
        minAmount: parseFloat(p.min_base_amount || '0.0001'),
        amountPrecision: p.amount_precision || 4,
      });
    }
    return map;
  } catch (e) {
    console.error('Failed to get currency pairs:', e);
    return new Map();
  }
}

// Check if symbol is a leveraged token
function isLeveragedToken(symbol: string): boolean {
  for (const pattern of CONFIG.excludePatterns) {
    if (symbol.endsWith(pattern) || symbol.includes(pattern.replace('_USDT', ''))) {
      return true;
    }
  }
  // Additional check for common leveraged token patterns
  const leveragedRegex = /\d+(L|S)_USDT$/;
  return leveragedRegex.test(symbol);
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

  const startTime = Date.now();
  let cycleStatus = 'completed';
  let cycleError: string | null = null;
  let tradeResult: {
    symbol: string;
    side: string;
    edge: number;
    pnl: number;
    strategy: string;
    price: number;
    orderId?: string;
    status: string;
  } | null = null;

  try {
    const { paperMode = true } = await req.json().catch(() => ({}));
    
    console.log(`⚡ [HYPER] Cycle start (paper: ${paperMode})`);

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

    // Check USDT balance first
    const usdtBalance = await getUsdtBalance(apiKey, apiSecret);
    console.log(`💰 Available USDT: ${usdtBalance.toFixed(2)}`);
    
    // If balance is too low, skip trading but still update heartbeat
    if (usdtBalance < CONFIG.minPositionUsdt) {
      console.log(`⚠️ Insufficient balance (${usdtBalance.toFixed(2)} < ${CONFIG.minPositionUsdt}). Skipping cycle.`);
      cycleStatus = 'skipped_low_balance';
      
      // Still update heartbeat
      const nowIso = new Date().toISOString();
      if (state?.id) {
        await supabase
          .from('trading_system_state')
          .update({
            is_active: true,
            total_cycles: cycleCount,
            last_heartbeat: nowIso,
            updated_at: nowIso,
          })
          .eq('id', state.id);
      }

      return new Response(JSON.stringify({
        success: true,
        cycle: cycleCount,
        status: 'skipped_low_balance',
        balance: usdtBalance,
        message: 'Insufficient USDT balance',
        duration: Date.now() - startTime,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate dynamic position size based on balance
    const positionSize = Math.min(
      Math.max(usdtBalance * 0.1, CONFIG.minPositionUsdt), // 10% of balance, min $5
      CONFIG.maxPositionUsdt, // max $50
      usdtBalance * 0.5 // never more than 50% of balance
    );
    console.log(`📊 Position size: ${positionSize.toFixed(2)} USDT`);

    // Get currency pair info for minimum amounts
    const pairInfo = await getCurrencyPairs();

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
        
        // Basic filters
        if (!symbol.endsWith('_USDT')) return false;
        if (CONFIG.excludeSymbols.includes(symbol)) return false;
        if (cooldownSymbols.has(symbol)) return false;
        if (volume < CONFIG.minVolume) return false;
        if (spread > CONFIG.maxSpread) return false;
        if (bid <= 0 || ask <= 0) return false;
        
        // CRITICAL: Exclude leveraged tokens
        if (isLeveragedToken(symbol)) {
          return false;
        }
        
        // Check minimum order amount
        const info = pairInfo.get(symbol);
        if (info) {
          const minOrderValue = info.minAmount * parseFloat(t.last);
          if (minOrderValue > positionSize) {
            return false; // Skip if min order is larger than our position
          }
        }
        
        return true;
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
        // Momentum short: fading extreme pumps (only if truly extreme)
        else if (change > CONFIG.momentumMaxChange && change < 30) {
          edge = change * 0.04 - spread - 0.1;
          side = 'sell';
          strategy = 'fade-pump';
        }
        
        // Get pair info for amount calculation
        const info = pairInfo.get(t.currency_pair);
        
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
          minAmount: info?.minAmount || 0.0001,
          amountPrecision: info?.amountPrecision || 4,
        };
      })
      .filter(o => o.edge >= CONFIG.minEdge)
      .sort((a, b) => b.edge - a.edge);

    console.log(`⚡ [HYPER] Found ${opportunities.length} opportunities (filtered leveraged tokens)`);

    // Execute best opportunity
    if (opportunities.length > 0) {
      const best = opportunities[0];
      
      console.log(`🎯 Best: ${best.symbol} | ${best.strategy} | Edge: ${best.edge.toFixed(2)}% | Change: ${best.change.toFixed(2)}%`);
      
      // Calculate position size with precision
      let amount = positionSize / best.price;
      
      // Ensure amount meets minimum and precision requirements
      if (amount < best.minAmount) {
        console.log(`⚠️ Amount ${amount} below minimum ${best.minAmount}, adjusting...`);
        amount = best.minAmount * 1.1; // Add 10% buffer
      }
      
      // Round to precision
      const multiplier = Math.pow(10, best.amountPrecision);
      amount = Math.floor(amount * multiplier) / multiplier;
      
      const amountStr = amount.toFixed(best.amountPrecision);
      const orderValue = amount * best.price;
      
      console.log(`📦 Order: ${amountStr} ${best.symbol.split('_')[0]} (~$${orderValue.toFixed(2)})`);
      
      let orderId: string | undefined;
      let executedPrice = best.price;
      let orderStatus = paperMode ? 'simulated' : 'pending';
      
      if (!paperMode) {
        try {
          // Double-check we have enough balance for this order
          if (orderValue > usdtBalance) {
            console.log(`⚠️ Order value ${orderValue.toFixed(2)} exceeds balance ${usdtBalance.toFixed(2)}, skipping`);
            orderStatus = 'skipped_balance';
          } else {
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
            orderStatus = 'executed';
            
            console.log(`✅ Order executed: ${orderId} @ ${executedPrice}`);
          }
        } catch (orderError) {
          const errorMsg = orderError instanceof Error ? orderError.message : 'Unknown error';
          console.error(`❌ Order failed (non-fatal):`, errorMsg);
          orderStatus = 'failed';
          cycleError = errorMsg;
          
          // Log failed trade but DON'T throw - continue the cycle
          await supabase.from('trade_history').insert({
            symbol: best.symbol,
            side: best.side,
            type: best.strategy,
            price: best.price,
            amount: parseFloat(amountStr),
            expected_edge: best.edge,
            actual_pnl: 0,
            status: 'failed',
            error: errorMsg,
          });
        }
      }
      
      // Only record successful/simulated trades
      if (orderStatus === 'executed' || orderStatus === 'simulated') {
        // Estimate PnL based on edge (real PnL comes from position exit)
        const estimatedPnL = best.edge * 0.6; // Conservative estimate
        
        tradeResult = {
          symbol: best.symbol,
          side: best.side,
          edge: best.edge,
          pnl: estimatedPnL,
          strategy: best.strategy,
          price: executedPrice,
          orderId,
          status: orderStatus,
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
          status: orderStatus,
        });
        
        console.log(`💹 ${best.side.toUpperCase()} ${best.symbol} | Strategy: ${best.strategy} | Edge: ${best.edge.toFixed(2)}%`);
      }
    } else {
      console.log(`⏳ No opportunities meet criteria`);
      cycleStatus = 'no_opportunities';
    }

    // ALWAYS update state/heartbeat, even on failures
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
    console.log(`⚡ [HYPER] Cycle ${cycleCount} done in ${duration}ms | Status: ${cycleStatus}`);

    return new Response(JSON.stringify({
      success: true,
      cycle: cycleCount,
      status: cycleStatus,
      trade: tradeResult,
      cumulativeTrades,
      cumulativePnL,
      duration,
      balance: usdtBalance,
      positionSize,
      marketsScanned: tickers.length,
      opportunitiesFound: opportunities.length,
      error: cycleError,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('⚡ [HYPER] Critical error:', errorMsg);
    
    // Still try to update heartbeat on critical errors
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      
      const { data: state } = await supabase
        .from('trading_system_state')
        .select('id, total_cycles')
        .limit(1)
        .maybeSingle();
      
      if (state?.id) {
        const nowIso = new Date().toISOString();
        await supabase
          .from('trading_system_state')
          .update({
            total_cycles: (state.total_cycles || 0) + 1,
            last_heartbeat: nowIso,
            updated_at: nowIso,
          })
          .eq('id', state.id);
      }
    } catch (e) {
      console.error('Failed to update heartbeat on error:', e);
    }
    
    return new Response(JSON.stringify({
      success: false,
      status: 'error',
      error: errorMsg,
      duration: Date.now() - startTime,
    }), {
      status: 200, // Return 200 even on error to not break cron
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
