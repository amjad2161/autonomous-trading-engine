import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash, createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== AGGRESSIVE BURST MODE CONFIG =====
const CONFIG = {
  minEdge: 0.35,
  minVolume: 300_000,
  maxSpread: 0.5,
  momentumMinChange: 1.0,
  momentumMaxChange: 18,
  reversionMinDrop: -2.5,
  reversionMaxDrop: -25,
  basePositionUsdt: 10,
  minPositionUsdt: 3.5,
  maxPositionUsdt: 50,
  maxDailyLossPct: 5.0,
  minDustValueUsdt: 0.3,
  liquidateIfUsdtBelow: 20,
  excludeSymbols: ['USDT_USDT', 'USDC_USDT', 'DAI_USDT'],
  excludePatterns: ['3L_USDT', '5L_USDT', '3S_USDT', '5S_USDT', '2L_USDT', '2S_USDT'],
  stablecoins: ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD'],
  cooldownMinutes: 1,
  burstIntervalMs: 2000,
  burstDurationMs: 50000,
};

function generateSignature(method: string, path: string, queryString: string, body: string, timestamp: string, secret: string): string {
  const hashedPayload = createHash("sha512").update(body).digest("hex");
  return createHmac("sha512", secret).update(`${method}\n${path}\n${queryString}\n${hashedPayload}\n${timestamp}`).digest("hex");
}

async function gateRequest(method: string, endpoint: string, apiKey: string, apiSecret: string, body: Record<string, unknown> | null = null): Promise<unknown> {
  const path = `/api/v4${endpoint}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const response = await fetch(`https://api.gateio.ws${path}`, {
    method,
    headers: { "KEY": apiKey, "SIGN": generateSignature(method, path, "", bodyStr, timestamp, apiSecret), "Timestamp": timestamp, "Content-Type": "application/json" },
    body: body ? bodyStr : undefined,
  });
  if (!response.ok) throw new Error(`Gate.io: ${response.status} - ${await response.text()}`);
  return response.json();
}

async function getAllBalances(apiKey: string, apiSecret: string): Promise<Array<{ currency: string; available: number }>> {
  try {
    const accounts = await gateRequest('GET', '/spot/accounts', apiKey, apiSecret) as Array<{ currency: string; available: string }>;
    return accounts.map(a => ({ currency: a.currency, available: parseFloat(a.available) })).filter(a => a.available > 0);
  } catch { return []; }
}

async function getTickerPrices(): Promise<Map<string, { price: number; change: number; volume: number; bid: number; ask: number }>> {
  try {
    const tickers = await fetch('https://api.gateio.ws/api/v4/spot/tickers').then(r => r.json()) as Array<{
      currency_pair: string; last: string; change_percentage: string; quote_volume: string; highest_bid: string; lowest_ask: string;
    }>;
    const map = new Map();
    for (const t of tickers) {
      map.set(t.currency_pair, { price: parseFloat(t.last), change: parseFloat(t.change_percentage), volume: parseFloat(t.quote_volume), bid: parseFloat(t.highest_bid), ask: parseFloat(t.lowest_ask) });
    }
    return map;
  } catch { return new Map(); }
}

async function getCurrencyPairs(): Promise<Map<string, { minAmount: number; precision: number }>> {
  try {
    const pairs = await fetch('https://api.gateio.ws/api/v4/spot/currency_pairs').then(r => r.json()) as Array<{ id: string; min_base_amount?: string; amount_precision?: number }>;
    const map = new Map();
    for (const p of pairs) map.set(p.id, { minAmount: parseFloat(p.min_base_amount || '0.0001'), precision: p.amount_precision || 4 });
    return map;
  } catch { return new Map(); }
}

function isLeveragedToken(symbol: string): boolean {
  return CONFIG.excludePatterns.some(p => symbol.includes(p.replace('_USDT', ''))) || /\d+(L|S)_USDT$/.test(symbol);
}

// deno-lint-ignore no-explicit-any
async function getTodayPnL(supabase: any): Promise<{ totalPnL: number; tradeCount: number }> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase.from('trade_history').select('actual_pnl').gte('created_at', todayStart.toISOString());
  const arr = data as Array<{ actual_pnl: number | null }> | null;
  return { totalPnL: arr?.reduce((s, t) => s + (t.actual_pnl || 0), 0) || 0, tradeCount: arr?.length || 0 };
}

// ===== MAIN HANDLER =====
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const startTime = Date.now();
  const results: Array<{ cycle: number; symbol?: string; edge?: number; status: string }> = [];
  let totalTrades = 0;
  let totalPnL = 0;

  try {
    const { paperMode = false, burstMode = true } = await req.json().catch(() => ({}));
    const apiKey = Deno.env.get('GATE_API_KEY');
    const apiSecret = Deno.env.get('GATE_API_SECRET');
    if (!apiKey || !apiSecret) throw new Error("Missing API credentials");

    console.log(`🚀 [HYPER] BURST MODE - 2s intervals, 50s duration`);

    const { data: state } = await supabase.from('trading_system_state').select('*').limit(1).maybeSingle();
    const stateTyped = state as { id?: string; total_cycles?: number; total_pnl?: number; total_trades?: number } | null;
    const todayStats = await getTodayPnL(supabase);
    
    // ===== AUTO-LIQUIDATE AT START =====
    const pairInfo = await getCurrencyPairs();
    const allBalances = await getAllBalances(apiKey, apiSecret);
    let usdtBalance = allBalances.find(b => b.currency === 'USDT')?.available || 0;
    const holdings = allBalances.filter(b => !CONFIG.stablecoins.includes(b.currency));
    
    if (usdtBalance < CONFIG.liquidateIfUsdtBelow && holdings.length > 0) {
      console.log(`🔄 Liquidating ${holdings.length} holdings (USDT: $${usdtBalance.toFixed(2)})`);
      const prices = await getTickerPrices();
      
      for (const h of holdings) {
        const symbol = `${h.currency}_USDT`;
        const priceData = prices.get(symbol);
        const info = pairInfo.get(symbol);
        if (!priceData || !info) continue;
        
        const valueUsdt = h.available * priceData.price;
        if (valueUsdt < 0.3 || h.available < info.minAmount) continue;
        
        const amount = Math.floor(h.available * Math.pow(10, info.precision)) / Math.pow(10, info.precision);
        if (amount < info.minAmount) continue;
        
        try {
          const result = await gateRequest('POST', '/spot/orders', apiKey, apiSecret, {
            currency_pair: symbol, side: 'sell', type: 'market', amount: amount.toFixed(info.precision), time_in_force: 'ioc',
          }) as { filled_total?: string };
          const filled = parseFloat(result.filled_total || '0');
          console.log(`💵 Sold ${h.currency}: +$${filled.toFixed(2)}`);
          usdtBalance += filled;
        } catch {
          console.log(`⚠️ Failed to sell ${h.currency}`);
        }
      }
      console.log(`💰 New balance: $${usdtBalance.toFixed(2)}`);
    }

    console.log(`📊 Today: ${todayStats.tradeCount} trades, P&L: ${todayStats.totalPnL.toFixed(2)}%`);

    let cycleNum = 0;
    const burstEndTime = startTime + CONFIG.burstDurationMs;

    // ===== BURST LOOP - Every 2 seconds =====
    while (burstMode ? Date.now() < burstEndTime : cycleNum === 0) {
      cycleNum++;
      const cycleStart = Date.now();

      try {
        const [balances, tickers] = await Promise.all([getAllBalances(apiKey, apiSecret), getTickerPrices()]);
        const currentUsdt = balances.find(b => b.currency === 'USDT')?.available || 0;

        if (currentUsdt < CONFIG.minPositionUsdt) {
          console.log(`🔥 [${cycleNum}] Low balance: $${currentUsdt.toFixed(2)}`);
          results.push({ cycle: cycleNum, status: 'low_balance' });
          
          // Wait for interval
          if (burstMode && Date.now() < burstEndTime) {
            const wait = Math.max(0, cycleNum * CONFIG.burstIntervalMs - (Date.now() - startTime));
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
          }
          continue;
        }

        const positionSize = Math.min(Math.max(currentUsdt * 0.75, CONFIG.minPositionUsdt), CONFIG.maxPositionUsdt, currentUsdt * 0.9);
        const { data: recentTrades } = await supabase.from('trade_history').select('symbol').gte('created_at', new Date(Date.now() - CONFIG.cooldownMinutes * 60000).toISOString());
        const cooldown = new Set((recentTrades as Array<{ symbol: string }> | null)?.map(t => t.symbol) || []);

        // Find opportunities
        const opportunities: Array<{ symbol: string; price: number; edge: number; strategy: string; minAmount: number; precision: number }> = [];
        
        for (const [symbol, data] of tickers) {
          if (!symbol.endsWith('_USDT') || CONFIG.excludeSymbols.includes(symbol) || cooldown.has(symbol)) continue;
          if (data.volume < CONFIG.minVolume || data.bid <= 0 || data.ask <= 0) continue;
          if (isLeveragedToken(symbol)) continue;

          const spread = ((data.ask - data.bid) / data.ask) * 100;
          if (spread > CONFIG.maxSpread) continue;

          const info = pairInfo.get(symbol);
          if (!info || info.minAmount * data.price > positionSize) continue;

          let edge = 0, strategy = '';
          if (data.change >= CONFIG.momentumMinChange && data.change <= CONFIG.momentumMaxChange) {
            edge = data.change * 0.09 - spread - 0.08;
            strategy = 'momentum';
          } else if (data.change <= CONFIG.reversionMinDrop && data.change >= CONFIG.reversionMaxDrop) {
            edge = Math.abs(data.change) * 0.13 - spread - 0.08;
            strategy = 'reversion';
          }

          if (edge >= CONFIG.minEdge && strategy) {
            opportunities.push({ symbol, price: data.price, edge, strategy, minAmount: info.minAmount, precision: info.precision });
          }
        }

        opportunities.sort((a, b) => b.edge - a.edge);

        if (opportunities.length === 0) {
          console.log(`🔥 [${cycleNum}] No opportunities (${Date.now() - cycleStart}ms)`);
          results.push({ cycle: cycleNum, status: 'no_opportunities' });
        } else {
          const best = opportunities[0];
          console.log(`🎯 [${cycleNum}] ${best.symbol} | ${best.strategy} | Edge: ${best.edge.toFixed(2)}%`);

          let amount = Math.max(positionSize / best.price, best.minAmount * 1.05);
          const mult = Math.pow(10, best.precision);
          amount = Math.floor(amount * mult) / mult;
          if (amount < best.minAmount) amount = Math.ceil(best.minAmount * mult) / mult;

          const orderValue = amount * best.price;
          if (orderValue > currentUsdt || orderValue < 3.5 || amount < best.minAmount) {
            console.log(`⚠️ [${cycleNum}] Validation failed: $${orderValue.toFixed(2)} vs $${currentUsdt.toFixed(2)}`);
            results.push({ cycle: cycleNum, symbol: best.symbol, edge: best.edge, status: 'validation_failed' });
          } else if (!paperMode) {
            try {
              const order = await gateRequest('POST', '/spot/orders', apiKey, apiSecret, {
                currency_pair: best.symbol, side: 'buy', type: 'market', amount: amount.toFixed(best.precision), time_in_force: 'ioc',
              }) as { id?: string; avg_deal_price?: string };

              const pnl = best.edge * (orderValue / 100);
              totalTrades++;
              totalPnL += pnl;

              await supabase.from('trade_history').insert({
                symbol: best.symbol, side: 'buy', type: 'market', amount, price: parseFloat(order.avg_deal_price || best.price.toString()),
                expected_edge: best.edge, actual_pnl: pnl, order_id: order.id, status: 'executed', executed_at: new Date().toISOString(),
              });

              console.log(`✅ [${cycleNum}] Executed ${order.id} +${pnl.toFixed(3)}%`);
              results.push({ cycle: cycleNum, symbol: best.symbol, edge: best.edge, status: 'executed' });
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Unknown';
              console.error(`❌ [${cycleNum}] Failed:`, msg);
              await supabase.from('trade_history').insert({
                symbol: best.symbol, side: 'buy', type: 'market', amount, price: best.price, expected_edge: best.edge, actual_pnl: 0, status: 'failed', error: msg,
              });
              results.push({ cycle: cycleNum, symbol: best.symbol, edge: best.edge, status: 'failed' });
            }
          } else {
            results.push({ cycle: cycleNum, symbol: best.symbol, edge: best.edge, status: 'paper' });
          }
        }
      } catch (e) {
        console.error(`❌ [${cycleNum}] Cycle error:`, e);
        results.push({ cycle: cycleNum, status: 'error' });
      }

      // Wait for next interval
      if (burstMode && Date.now() < burstEndTime) {
        const wait = Math.max(0, cycleNum * CONFIG.burstIntervalMs - (Date.now() - startTime));
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
    }

    // Update state
    const now = new Date().toISOString();
    if (stateTyped?.id) {
      await supabase.from('trading_system_state').update({
        is_active: true,
        total_cycles: (stateTyped.total_cycles || 0) + cycleNum,
        total_trades: (stateTyped.total_trades || 0) + totalTrades,
        total_pnl: (stateTyped.total_pnl || 0) + totalPnL,
        last_heartbeat: now,
        updated_at: now,
      }).eq('id', stateTyped.id);
    }

    const duration = Date.now() - startTime;
    console.log(`🏁 [HYPER] ${cycleNum} cycles, ${totalTrades} trades, +${totalPnL.toFixed(2)}% in ${duration}ms`);

    return new Response(JSON.stringify({
      success: true, burstMode, cycles: cycleNum, trades: totalTrades, pnl: totalPnL, duration, results: results.slice(-15),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Fatal:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown', duration: Date.now() - startTime }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
