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
  minEdge: 0.5,
  minVolume: 1_000_000,
  maxSpread: 0.3,
  
  // Momentum strategy
  momentumMinChange: 1.5,
  momentumMaxChange: 12,
  
  // Mean reversion strategy
  reversionMinDrop: -4,
  reversionMaxDrop: -15,
  
  // Position sizing
  basePositionUsdt: 10,
  minPositionUsdt: 5,
  maxPositionUsdt: 50,
  
  // Risk management
  takeProfitPct: 1.5,
  stopLossPct: 1.0,
  
  // Auto-liquidation settings
  minDustValueUsdt: 0.5, // Minimum value to consider for liquidation
  
  // Filters
  excludeSymbols: ['USDT_USDT', 'USDC_USDT', 'DAI_USDT'],
  excludePatterns: ['3L_USDT', '5L_USDT', '3S_USDT', '5S_USDT', '2L_USDT', '2S_USDT'],
  stablecoins: ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD'],
  
  maxConcurrentTrades: 3,
  cooldownMinutes: 5,
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

// Get all spot balances
async function getAllBalances(apiKey: string, apiSecret: string): Promise<Array<{
  currency: string;
  available: number;
  locked: number;
}>> {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts', apiKey, apiSecret) as Array<{
      currency: string;
      available: string;
      locked: string;
    }>;
    
    return accounts
      .map(a => ({
        currency: a.currency,
        available: parseFloat(a.available),
        locked: parseFloat(a.locked),
      }))
      .filter(a => a.available > 0 || a.locked > 0);
  } catch (e) {
    console.error('Failed to get balances:', e);
    return [];
  }
}

// Get ticker prices for multiple symbols
async function getTickerPrices(): Promise<Map<string, number>> {
  try {
    const tickers = await fetch('https://api.gateio.ws/api/v4/spot/tickers').then(r => r.json()) as Array<{
      currency_pair: string;
      last: string;
    }>;
    
    const map = new Map<string, number>();
    for (const t of tickers) {
      map.set(t.currency_pair, parseFloat(t.last));
    }
    return map;
  } catch (e) {
    console.error('Failed to get ticker prices:', e);
    return new Map();
  }
}

// Get currency pair info
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

// Auto-liquidate non-USDT holdings to USDT
async function autoLiquidate(
  apiKey: string, 
  apiSecret: string,
  balances: Array<{ currency: string; available: number }>,
  prices: Map<string, number>,
  pairInfo: Map<string, { minAmount: number; amountPrecision: number }>
): Promise<{ liquidated: number; details: Array<{ currency: string; amount: number; valueUsdt: number; status: string }> }> {
  const details: Array<{ currency: string; amount: number; valueUsdt: number; status: string }> = [];
  let totalLiquidated = 0;
  
  for (const balance of balances) {
    // Skip USDT and stablecoins
    if (CONFIG.stablecoins.includes(balance.currency)) {
      continue;
    }
    
    // Check if there's a _USDT pair for this currency
    const symbol = `${balance.currency}_USDT`;
    const price = prices.get(symbol);
    
    if (!price) {
      console.log(`⏭️ No USDT pair for ${balance.currency}, skipping`);
      continue;
    }
    
    const valueUsdt = balance.available * price;
    
    // Skip if value is too small
    if (valueUsdt < CONFIG.minDustValueUsdt) {
      console.log(`⏭️ ${balance.currency} value too small ($${valueUsdt.toFixed(4)}), skipping`);
      continue;
    }
    
    // Get pair info for precision
    const info = pairInfo.get(symbol);
    if (!info) {
      console.log(`⏭️ No pair info for ${symbol}, skipping`);
      continue;
    }
    
    // Check if amount meets minimum
    if (balance.available < info.minAmount) {
      console.log(`⏭️ ${balance.currency} amount ${balance.available} below minimum ${info.minAmount}, skipping`);
      details.push({ currency: balance.currency, amount: balance.available, valueUsdt, status: 'below_minimum' });
      continue;
    }
    
    // Round amount to precision
    const multiplier = Math.pow(10, info.amountPrecision);
    const sellAmount = Math.floor(balance.available * multiplier) / multiplier;
    
    if (sellAmount < info.minAmount) {
      console.log(`⏭️ Rounded ${balance.currency} amount ${sellAmount} below minimum, skipping`);
      details.push({ currency: balance.currency, amount: balance.available, valueUsdt, status: 'rounded_below_min' });
      continue;
    }
    
    try {
      console.log(`💱 Liquidating ${sellAmount} ${balance.currency} (~$${valueUsdt.toFixed(2)})`);
      
      const orderBody = {
        currency_pair: symbol,
        side: 'sell',
        type: 'market',
        amount: sellAmount.toFixed(info.amountPrecision),
        time_in_force: 'ioc',
      };
      
      const result = await gateRequest('POST', '/spot/orders', apiKey, apiSecret, orderBody) as {
        id?: string;
        status?: string;
        filled_total?: string;
      };
      
      const filledUsdt = parseFloat(result.filled_total || '0');
      totalLiquidated += filledUsdt;
      
      console.log(`✅ Sold ${balance.currency}: +$${filledUsdt.toFixed(2)} USDT`);
      details.push({ currency: balance.currency, amount: sellAmount, valueUsdt: filledUsdt, status: 'sold' });
      
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error';
      console.error(`❌ Failed to sell ${balance.currency}:`, errorMsg);
      details.push({ currency: balance.currency, amount: balance.available, valueUsdt, status: 'failed' });
    }
  }
  
  return { liquidated: totalLiquidated, details };
}

// Check if symbol is a leveraged token
function isLeveragedToken(symbol: string): boolean {
  for (const pattern of CONFIG.excludePatterns) {
    if (symbol.endsWith(pattern) || symbol.includes(pattern.replace('_USDT', ''))) {
      return true;
    }
  }
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
  let liquidationResult: { liquidated: number; details: unknown[] } | null = null;

  try {
    const { paperMode = true } = await req.json().catch(() => ({}));
    
    console.log(`⚡ [HYPER] Cycle start (paper: ${paperMode})`);

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

    // Get all data in parallel
    const [balances, prices, pairInfo] = await Promise.all([
      getAllBalances(apiKey, apiSecret),
      getTickerPrices(),
      getCurrencyPairs(),
    ]);
    
    // Find USDT balance
    const usdtBalance = balances.find(b => b.currency === 'USDT')?.available || 0;
    console.log(`💰 Initial USDT: $${usdtBalance.toFixed(2)}`);
    
    // List other holdings
    const otherHoldings = balances.filter(b => !CONFIG.stablecoins.includes(b.currency));
    if (otherHoldings.length > 0) {
      console.log(`📦 Other holdings: ${otherHoldings.map(h => `${h.currency}:${h.available.toFixed(4)}`).join(', ')}`);
    }

    // AUTO-LIQUIDATE if USDT is too low but we have other assets
    let finalUsdtBalance = usdtBalance;
    
    if (usdtBalance < CONFIG.minPositionUsdt && otherHoldings.length > 0 && !paperMode) {
      console.log(`🔄 USDT below minimum, attempting auto-liquidation...`);
      
      liquidationResult = await autoLiquidate(apiKey, apiSecret, otherHoldings, prices, pairInfo);
      
      if (liquidationResult.liquidated > 0) {
        console.log(`💵 Total liquidated: +$${liquidationResult.liquidated.toFixed(2)} USDT`);
        
        // Re-fetch USDT balance after liquidation
        const newBalances = await getAllBalances(apiKey, apiSecret);
        finalUsdtBalance = newBalances.find(b => b.currency === 'USDT')?.available || 0;
        console.log(`💰 New USDT balance: $${finalUsdtBalance.toFixed(2)}`);
      } else {
        console.log(`⚠️ No assets could be liquidated`);
      }
    }

    // Check if we have enough to trade
    if (finalUsdtBalance < CONFIG.minPositionUsdt) {
      console.log(`⚠️ Insufficient balance after liquidation ($${finalUsdtBalance.toFixed(2)} < $${CONFIG.minPositionUsdt})`);
      cycleStatus = 'skipped_low_balance';
      
      // Update heartbeat
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
        status: cycleStatus,
        balance: finalUsdtBalance,
        liquidation: liquidationResult,
        message: 'No USDT and no liquidatable assets',
        duration: Date.now() - startTime,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate position size
    const positionSize = Math.min(
      Math.max(finalUsdtBalance * 0.1, CONFIG.minPositionUsdt),
      CONFIG.maxPositionUsdt,
      finalUsdtBalance * 0.5
    );
    console.log(`📊 Position size: $${positionSize.toFixed(2)}`);

    // Get recent trades for cooldown
    const { data: recentTrades } = await supabase
      .from('trade_history')
      .select('symbol, created_at')
      .gte('created_at', new Date(Date.now() - CONFIG.cooldownMinutes * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });
    
    const cooldownSymbols = new Set(recentTrades?.map(t => t.symbol) || []);

    // Fetch fresh tickers for opportunity scanning
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
        
        if (!symbol.endsWith('_USDT')) return false;
        if (CONFIG.excludeSymbols.includes(symbol)) return false;
        if (cooldownSymbols.has(symbol)) return false;
        if (volume < CONFIG.minVolume) return false;
        if (spread > CONFIG.maxSpread) return false;
        if (bid <= 0 || ask <= 0) return false;
        if (isLeveragedToken(symbol)) return false;
        
        const info = pairInfo.get(symbol);
        if (info) {
          const minOrderValue = info.minAmount * parseFloat(t.last);
          if (minOrderValue > positionSize) return false;
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
        
        if (change >= CONFIG.momentumMinChange && change <= CONFIG.momentumMaxChange) {
          edge = change * 0.08 - spread - 0.1;
          side = 'buy';
          strategy = 'momentum-long';
        } else if (change <= CONFIG.reversionMinDrop && change >= CONFIG.reversionMaxDrop) {
          edge = Math.abs(change) * 0.12 - spread - 0.1;
          side = 'buy';
          strategy = 'reversion-long';
        } else if (change > CONFIG.momentumMaxChange && change < 30) {
          edge = change * 0.04 - spread - 0.1;
          side = 'sell';
          strategy = 'fade-pump';
        }
        
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

    console.log(`⚡ [HYPER] Found ${opportunities.length} opportunities`);

    // Execute best opportunity
    if (opportunities.length > 0) {
      const best = opportunities[0];
      
      console.log(`🎯 Best: ${best.symbol} | ${best.strategy} | Edge: ${best.edge.toFixed(2)}%`);
      
      let amount = positionSize / best.price;
      if (amount < best.minAmount) {
        amount = best.minAmount * 1.1;
      }
      
      const multiplier = Math.pow(10, best.amountPrecision);
      amount = Math.floor(amount * multiplier) / multiplier;
      
      const amountStr = amount.toFixed(best.amountPrecision);
      const orderValue = amount * best.price;
      
      console.log(`📦 Order: ${amountStr} ${best.symbol.split('_')[0]} (~$${orderValue.toFixed(2)})`);
      
      let orderId: string | undefined;
      let executedPrice = best.price;
      let orderStatus = paperMode ? 'simulated' : 'pending';
      
      if (!paperMode) {
        if (orderValue > finalUsdtBalance) {
          console.log(`⚠️ Order value exceeds balance, skipping`);
          orderStatus = 'skipped_balance';
        } else {
          try {
            const orderBody = {
              currency_pair: best.symbol,
              side: best.side,
              type: 'market',
              amount: amountStr,
              time_in_force: 'ioc',
            };
            
            const orderResult = await gateRequest('POST', '/spot/orders', apiKey, apiSecret, orderBody) as {
              id?: string;
              avg_deal_price?: string;
            };
            
            orderId = orderResult.id;
            executedPrice = parseFloat(orderResult.avg_deal_price || best.price.toString());
            orderStatus = 'executed';
            
            console.log(`✅ Order executed: ${orderId} @ ${executedPrice}`);
          } catch (orderError) {
            const errorMsg = orderError instanceof Error ? orderError.message : 'Unknown';
            console.error(`❌ Order failed:`, errorMsg);
            orderStatus = 'failed';
            
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
      }
      
      if (orderStatus === 'executed' || orderStatus === 'simulated') {
        const estimatedPnL = best.edge * 0.6;
        
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
        
        console.log(`💹 ${best.side.toUpperCase()} ${best.symbol} | Edge: ${best.edge.toFixed(2)}%`);
      }
    } else {
      console.log(`⏳ No opportunities meet criteria`);
      cycleStatus = 'no_opportunities';
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
      status: cycleStatus,
      trade: tradeResult,
      liquidation: liquidationResult,
      cumulativeTrades,
      cumulativePnL,
      duration,
      balance: finalUsdtBalance,
      positionSize,
      marketsScanned: tickers.length,
      opportunitiesFound: opportunities.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('⚡ [HYPER] Critical error:', errorMsg);
    
    try {
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
      console.error('Failed to update heartbeat:', e);
    }
    
    return new Response(JSON.stringify({
      success: false,
      status: 'error',
      error: errorMsg,
      liquidation: liquidationResult,
      duration: Date.now() - startTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
