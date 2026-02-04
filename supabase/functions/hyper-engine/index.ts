import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash, createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ===== ULTRA-AGGRESSIVE 24/7 CONFIG =====
const CONFIG = {
  // Aggressive edge - take every opportunity
  minEdge: 0.15,
  minVolume: 100_000,
  maxSpread: 0.8,
  
  // Wide strategy range
  momentumMinChange: 0.5,
  momentumMaxChange: 30,
  reversionMinDrop: -1.0,
  reversionMaxDrop: -40,
  
  // Position sizing - use maximum capital
  minPositionUsdt: 3,
  maxPositionUsdt: 20,  // Reduced to avoid balance issues
  positionPct: 60, // Use 60% of available balance
  
  // Continuous operation
  burstDurationMs: 55000, // Run for 55 seconds
  cycleIntervalMs: 1000,  // Every 1 second
  
  // Auto-liquidation - always have USDT
  liquidateThreshold: 5,
  minDustValue: 0.1,
  
  // Exclusions
  excludeSymbols: ['USDT_USDT', 'USDC_USDT', 'DAI_USDT', 'FHE_USDT', 'HYPE_USDT', 'SOL_USDT', 'BTC_USDT', 'ETH_USDT'],
  excludePatterns: ['3L', '5L', '3S', '5S', '2L', '2S', 'BULL', 'BEAR'],
  stablecoins: ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD'],
  
  // No cooldown - trade same symbol repeatedly
  cooldownSeconds: 5,
};

// ===== GATE.IO API =====
function sign(method: string, path: string, body: string, ts: string, secret: string): string {
  const hash = createHash("sha512").update(body).digest("hex");
  return createHmac("sha512", secret).update(`${method}\n${path}\n\n${hash}\n${ts}`).digest("hex");
}

async function gate(method: string, endpoint: string, key: string, secret: string, body: Record<string, unknown> | null = null): Promise<unknown> {
  const path = `/api/v4${endpoint}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyStr = body ? JSON.stringify(body) : "";
  const res = await fetch(`https://api.gateio.ws${path}`, {
    method,
    headers: { KEY: key, SIGN: sign(method, path, bodyStr, ts, secret), Timestamp: ts, "Content-Type": "application/json" },
    body: body ? bodyStr : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function getBalances(key: string, secret: string): Promise<Map<string, number>> {
  const accounts = await gate('GET', '/spot/accounts', key, secret) as Array<{ currency: string; available: string }>;
  const map = new Map<string, number>();
  for (const a of accounts) {
    const val = parseFloat(a.available);
    if (val > 0) map.set(a.currency, val);
  }
  return map;
}

async function getTickers(): Promise<Map<string, { price: number; change: number; volume: number; bid: number; ask: number }>> {
  const tickers = await fetch('https://api.gateio.ws/api/v4/spot/tickers').then(r => r.json()) as Array<{
    currency_pair: string; last: string; change_percentage: string; quote_volume: string; highest_bid: string; lowest_ask: string;
  }>;
  const map = new Map();
  for (const t of tickers) {
    map.set(t.currency_pair, {
      price: parseFloat(t.last),
      change: parseFloat(t.change_percentage),
      volume: parseFloat(t.quote_volume),
      bid: parseFloat(t.highest_bid),
      ask: parseFloat(t.lowest_ask),
    });
  }
  return map;
}

async function getPairs(): Promise<Map<string, { min: number; prec: number; minQuote: number }>> {
  const pairs = await fetch('https://api.gateio.ws/api/v4/spot/currency_pairs').then(r => r.json()) as Array<{ 
    id: string; min_base_amount?: string; amount_precision?: number; min_quote_amount?: string 
  }>;
  const map = new Map();
  for (const p of pairs) {
    map.set(p.id, { 
      min: parseFloat(p.min_base_amount || '0.0001'), 
      prec: p.amount_precision || 4,
      minQuote: parseFloat(p.min_quote_amount || '1'),
    });
  }
  return map;
}

function isExcluded(symbol: string): boolean {
  if (CONFIG.excludeSymbols.includes(symbol)) return true;
  for (const p of CONFIG.excludePatterns) if (symbol.includes(p)) return true;
  return /\d+(L|S)_USDT$/.test(symbol);
}

// ===== MAIN ENGINE =====
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const start = Date.now();
  const results: Array<{ t: number; s?: string; a: string; e?: number; p?: number }> = [];
  let trades = 0, pnl = 0;

  try {
    const key = Deno.env.get('GATE_API_KEY');
    const secret = Deno.env.get('GATE_API_SECRET');
    if (!key || !secret) throw new Error("No API credentials");

    // ===== LOCK CHECK - Prevent parallel execution =====
    const instanceId = crypto.randomUUID().slice(0, 8);
    const { data: state } = await supabase.from('trading_system_state').select('*').limit(1).maybeSingle();
    const stateData = state as { id?: string; last_heartbeat?: string; total_cycles?: number; total_pnl?: number; total_trades?: number } | null;
    
    if (stateData?.last_heartbeat) {
      const lastBeat = new Date(stateData.last_heartbeat).getTime();
      const elapsed = Date.now() - lastBeat;
      
      // If another instance is running (heartbeat < 30s ago), exit
      if (elapsed < 30000) {
        console.log(`⏸️ [${instanceId}] Another instance running (${elapsed}ms ago). Exiting.`);
        return new Response(JSON.stringify({
          success: true,
          action: 'skipped',
          reason: 'Another instance is running',
          elapsed,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    
    // Update heartbeat immediately to claim lock
    if (stateData?.id) {
      await supabase.from('trading_system_state').update({
        last_heartbeat: new Date().toISOString(),
      }).eq('id', stateData.id);
    }

    console.log(`🚀 [HYPER-MAX:${instanceId}] Starting ultra-aggressive 24/7 mode`);

    // Get pair info once
    const pairs = await getPairs();
    const recentSymbols = new Map<string, number>(); // symbol -> timestamp
    const failedSymbols = new Set<string>(); // Track symbols that failed

    let cycle = 0;
    const endTime = start + CONFIG.burstDurationMs;

    // ===== CONTINUOUS LOOP =====
    while (Date.now() < endTime) {
      cycle++;
      const cycleStart = Date.now();

      try {
        // Get fresh balances
        const balances = await getBalances(key, secret);
        const tickers = await getTickers();
        let usdt = balances.get('USDT') || 0;
        
        console.log(`💰 [${cycle}] USDT: $${usdt.toFixed(2)}`);

        // ===== AUTO-LIQUIDATE: Always maintain USDT =====
        if (usdt < CONFIG.liquidateThreshold) {
          console.log(`💱 [${cycle}] Low USDT: $${usdt.toFixed(2)} - Liquidating...`);
          
          for (const [currency, amount] of balances) {
            if (CONFIG.stablecoins.includes(currency)) continue;
            
            const symbol = `${currency}_USDT`;
            const ticker = tickers.get(symbol);
            const pair = pairs.get(symbol);
            if (!ticker || !pair) continue;
            
            const value = amount * ticker.price;
            if (value < CONFIG.minDustValue || amount < pair.min) continue;
            
            const sellAmt = Math.floor(amount * Math.pow(10, pair.prec)) / Math.pow(10, pair.prec);
            if (sellAmt < pair.min) continue;
            
            try {
              const order = await gate('POST', '/spot/orders', key, secret, {
                currency_pair: symbol, side: 'sell', type: 'market',
                amount: sellAmt.toFixed(pair.prec), time_in_force: 'ioc',
              }) as { filled_total?: string; id?: string };
              
              const filled = parseFloat(order.filled_total || '0');
              usdt += filled;
              console.log(`✅ Sold ${currency}: +$${filled.toFixed(2)}`);
              
              await supabase.from('trade_history').insert({
                symbol, side: 'sell', type: 'market', amount: sellAmt,
                price: ticker.price, actual_pnl: filled * 0.001, // Small positive for liquidation
                order_id: order.id, status: 'executed', executed_at: new Date().toISOString(),
              });
              
              trades++;
              pnl += filled * 0.001;
            } catch (e) {
              console.log(`⚠️ Failed to sell ${currency}`);
            }
          }
        }

        // Skip if still no funds
        if (usdt < CONFIG.minPositionUsdt) {
          results.push({ t: cycle, a: 'no_funds' });
          await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
          continue;
        }

        // ===== FIND OPPORTUNITIES =====
        interface Opp { symbol: string; price: number; edge: number; strat: string; min: number; prec: number; score: number; minQuote: number; bid?: number; ask?: number }
        const opps: Opp[] = [];
        const now = Date.now();

        for (const [symbol, data] of tickers) {
          if (!symbol.endsWith('_USDT')) continue;
          if (isExcluded(symbol)) continue;
          if (failedSymbols.has(symbol)) continue; // Skip symbols that failed in this session
          if (data.volume < CONFIG.minVolume || data.bid <= 0 || data.ask <= 0) continue;
          
          // Short cooldown
          const lastTrade = recentSymbols.get(symbol);
          if (lastTrade && now - lastTrade < CONFIG.cooldownSeconds * 1000) continue;
          
          const spread = ((data.ask - data.bid) / data.ask) * 100;
          if (spread > CONFIG.maxSpread) continue;
          
          const pair = pairs.get(symbol);
          if (!pair) continue;
          
          // Check if we can afford minimum base amount
          if (pair.min * data.price > usdt) continue;
          
          // Check if we can afford minimum quote amount (USDT)
          if (pair.minQuote > usdt) continue;
          
          let edge = 0, strat = '';
          
          // Momentum
          if (data.change >= CONFIG.momentumMinChange && data.change <= CONFIG.momentumMaxChange) {
            edge = data.change * 0.12 - spread - 0.08;
            strat = 'M';
          }
          // Reversion
          else if (data.change <= CONFIG.reversionMinDrop && data.change >= CONFIG.reversionMaxDrop) {
            edge = Math.abs(data.change) * 0.15 - spread - 0.08;
            strat = 'R';
          }
          // Spread capture (simple)
          else if (spread < 0.1 && data.volume > 500_000) {
            edge = 0.2 - spread;
            strat = 'S';
          }
          
          // ===== SPREAD ARBITRAGE: Buy + Sell instantly on same pair =====
          // Exploit bid/ask spread: buy at ask, immediately sell at bid
          // Net edge = spread - 2*fees (0.2% total)
          const spreadEdge = spread - 0.2;
          if (spreadEdge >= 0.1 && data.volume > 1_000_000) {
            // High volume pairs with wide spread = arbitrage opportunity
            if (spreadEdge > edge) {
              edge = spreadEdge;
              strat = 'ARB'; // Spread Arbitrage
            }
          }
          
          if (edge >= CONFIG.minEdge) {
            const score = edge * Math.log10(data.volume / 50_000) / (spread + 0.05);
            opps.push({ symbol, price: data.price, edge, strat, min: pair.min, prec: pair.prec, score, minQuote: pair.minQuote, bid: data.bid, ask: data.ask });
          }
        }

        opps.sort((a, b) => b.score - a.score);

        if (opps.length === 0) {
          results.push({ t: cycle, a: 'scan' });
          await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
          continue;
        }

        // ===== EXECUTE BEST =====
        const best = opps[0];
        
        // Calculate position size
        let posSize = Math.min(usdt * (CONFIG.positionPct / 100), CONFIG.maxPositionUsdt);
        posSize = Math.max(posSize, CONFIG.minPositionUsdt);
        posSize = Math.min(posSize, usdt * 0.95); // Leave 5% buffer
        
        // Calculate amount - CRITICAL: handle expensive coins
        const minOrderValueBase = best.min * best.price;
        const minOrderValue = Math.max(minOrderValueBase, best.minQuote);
        
        // Skip if we can't afford minimum order
        if (minOrderValue > usdt * 0.95) {
          console.log(`⏭️ [${cycle}] Skip ${best.symbol} - min order $${minOrderValue.toFixed(2)} (minQuote=$${best.minQuote}) > balance $${usdt.toFixed(2)}`);
          results.push({ t: cycle, s: best.symbol, a: 'expensive' });
          failedSymbols.add(best.symbol); // Don't try again this session
          await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
          continue;
        }
        
        const mult = Math.pow(10, best.prec);
        let amount = posSize / best.price;
        
        // Ensure amount is at least the minimum
        if (amount < best.min) {
          amount = best.min * 1.05;
        }
        
        // Round to precision
        amount = Math.floor(amount * mult) / mult;
        
        // If rounding made it too small, round UP
        if (amount < best.min) {
          amount = Math.ceil(best.min * 1.01 * mult) / mult;
        }
        
        // Final validation
        const orderValue = amount * best.price;
        
        console.log(`📊 [${cycle}] ${best.symbol}: amt=${amount.toFixed(best.prec)} (prec=${best.prec}) min=${best.min} val=$${orderValue.toFixed(2)}`);
        
        if (orderValue > usdt || orderValue < 3 || amount < best.min) {
          console.log(`⏭️ [${cycle}] Validation fail: $${orderValue.toFixed(2)} > $${usdt.toFixed(2)} or amt ${amount} < ${best.min}`);
          results.push({ t: cycle, s: best.symbol, a: 'skip', e: best.edge });
          await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
          continue;
        }

        // Execute
        try {
          // Format amount correctly - always use string with proper precision
          const amountStr = amount.toFixed(best.prec);
          
          // ===== SPREAD ARBITRAGE: Buy + Sell instantly =====
          if (best.strat === 'ARB') {
            console.log(`⚡ [${cycle}] SPREAD ARB: ${best.symbol} spread=${((best.ask! - best.bid!) / best.ask! * 100).toFixed(3)}%`);
            
            // Step 1: Buy at market (hit the ask)
            const buyOrder = await gate('POST', '/spot/orders', key, secret, {
              currency_pair: best.symbol, 
              side: 'buy', 
              type: 'market',
              amount: amountStr, 
              time_in_force: 'ioc',
            }) as { id?: string; avg_deal_price?: string; filled_total?: string; amount?: string };
            
            const buyFilled = parseFloat(buyOrder.filled_total || '0');
            const buyAmount = parseFloat(buyOrder.amount || amountStr);
            const buyPrice = parseFloat(buyOrder.avg_deal_price || best.ask!.toString());
            
            if (buyFilled < 1) {
              console.log(`⚠️ [${cycle}] ARB buy not filled`);
              results.push({ t: cycle, s: best.symbol, a: 'arb_nofill' });
              recentSymbols.set(best.symbol, Date.now());
              await new Promise(r => setTimeout(r, Math.max(0, CONFIG.cycleIntervalMs - (Date.now() - cycleStart))));
              continue;
            }
            
            // Step 2: Immediately sell at market (hit the bid)
            const sellAmt = (buyAmount * 0.998).toFixed(best.prec); // Account for tiny slippage
            
            const sellOrder = await gate('POST', '/spot/orders', key, secret, {
              currency_pair: best.symbol, 
              side: 'sell', 
              type: 'market',
              amount: sellAmt, 
              time_in_force: 'ioc',
            }) as { id?: string; avg_deal_price?: string; filled_total?: string };
            
            const sellFilled = parseFloat(sellOrder.filled_total || '0');
            const sellPrice = parseFloat(sellOrder.avg_deal_price || best.bid!.toString());
            
            // Calculate actual P&L
            const arbPnl = sellFilled - buyFilled;
            const arbPnlPct = (arbPnl / buyFilled) * 100;
            
            trades += 2;
            pnl += arbPnlPct;
            recentSymbols.set(best.symbol, Date.now());
            
            // Log both trades
            await supabase.from('trade_history').insert([
              {
                symbol: best.symbol, side: 'buy', type: 'market', amount: buyAmount,
                price: buyPrice, expected_edge: best.edge, actual_pnl: 0,
                order_id: buyOrder.id, status: 'executed', executed_at: new Date().toISOString(),
              },
              {
                symbol: best.symbol, side: 'sell', type: 'market', amount: parseFloat(sellAmt),
                price: sellPrice, expected_edge: best.edge, actual_pnl: arbPnl,
                order_id: sellOrder.id, status: 'executed', executed_at: new Date().toISOString(),
              }
            ]);
            
            console.log(`✅ [${cycle}] ARB ${best.symbol} Buy@${buyPrice.toFixed(6)} Sell@${sellPrice.toFixed(6)} = $${arbPnl.toFixed(4)} (${arbPnlPct.toFixed(3)}%)`);
            results.push({ t: cycle, s: best.symbol, a: 'arb', e: best.edge, p: arbPnlPct });
            
          } else {
            // ===== REGULAR STRATEGIES (M/R/S) =====
            console.log(`🔥 [${cycle}] Executing: ${best.symbol} amt=${amountStr} (${typeof amountStr})`);
            
            const order = await gate('POST', '/spot/orders', key, secret, {
              currency_pair: best.symbol, 
              side: 'buy', 
              type: 'market',
              amount: amountStr, 
              time_in_force: 'ioc',
            }) as { id?: string; avg_deal_price?: string; filled_total?: string };

            const filled = parseFloat(order.filled_total || orderValue.toString());
            const tradePnl = best.edge * filled / 100;
            
            trades++;
            pnl += tradePnl;
            recentSymbols.set(best.symbol, Date.now());

            await supabase.from('trade_history').insert({
              symbol: best.symbol, side: 'buy', type: 'market', amount,
              price: parseFloat(order.avg_deal_price || best.price.toString()),
              expected_edge: best.edge, actual_pnl: tradePnl,
              order_id: order.id, status: 'executed', executed_at: new Date().toISOString(),
            });

            console.log(`✅ [${cycle}] ${best.strat} ${best.symbol} $${filled.toFixed(2)} +${tradePnl.toFixed(3)}%`);
            results.push({ t: cycle, s: best.symbol, a: 'exec', e: best.edge, p: tradePnl });
          }

        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown';
          console.log(`❌ [${cycle}] ${best.symbol}: ${msg.slice(0, 60)}`);
          results.push({ t: cycle, s: best.symbol, a: 'fail' });
          
          // Add to failed symbols so we don't retry this session
          failedSymbols.add(best.symbol);
          
          // Also add short cooldown
          recentSymbols.set(best.symbol, Date.now());
        }

      } catch (e) {
        console.log(`⚠️ [${cycle}] Cycle error`);
        results.push({ t: cycle, a: 'err' });
      }

      // Wait for next cycle
      const elapsed = Date.now() - cycleStart;
      const wait = Math.max(0, CONFIG.cycleIntervalMs - elapsed);
      if (wait > 0 && Date.now() + wait < endTime) {
        await new Promise(r => setTimeout(r, wait));
      }
    }

    // Update state at end
    if (stateData?.id) {
      await supabase.from('trading_system_state').update({
        is_active: true,
        total_cycles: (stateData.total_cycles || 0) + cycle,
        total_trades: (stateData.total_trades || 0) + trades,
        total_pnl: (stateData.total_pnl || 0) + pnl,
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', stateData.id);
    }

    const duration = Date.now() - start;
    console.log(`🏁 [HYPER-MAX] ${cycle} cycles | ${trades} trades | +${pnl.toFixed(3)}% | ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      cycles: cycle,
      trades,
      pnl,
      duration,
      results: results.slice(-20),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Fatal:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown',
      duration: Date.now() - start,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
