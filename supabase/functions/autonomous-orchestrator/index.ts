import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Gate.io API helpers
async function sha512Hash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return encodeHex(new Uint8Array(hashBuffer));
}

async function generateSignature(method: string, url: string, queryString: string, payloadString: string, timestamp: string, secret: string): Promise<string> {
  const hashedPayload = await sha512Hash(payloadString);
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', secret).update(signatureString).digest('hex');
}

async function gateRequest(endpoint: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', params: Record<string, string> = {}, body?: Record<string, unknown>) {
  const GATE_API_KEY = Deno.env.get('GATE_API_KEY')!;
  const GATE_API_SECRET = Deno.env.get('GATE_API_SECRET')!;
  const baseUrl = 'https://api.gateio.ws';
  const apiPrefix = '/api/v4';
  const url = `${apiPrefix}${endpoint}`;
  const queryString = new URLSearchParams(params).toString();
  const fullUrl = queryString ? `${baseUrl}${url}?${queryString}` : `${baseUrl}${url}`;
  const payloadString = body ? JSON.stringify(body) : '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await generateSignature(method, url, queryString, payloadString, timestamp, GATE_API_SECRET);

  const response = await fetch(fullUrl, {
    method,
    headers: { 'KEY': GATE_API_KEY, 'SIGN': signature, 'Timestamp': timestamp, 'Content-Type': 'application/json' },
    body: payloadString || undefined,
  });
  return response.json();
}

// Log to database
async function log(level: string, component: string, message: string, details?: unknown) {
  console.log(`[${component}] ${message}`);
  await supabase.from('system_log').insert({ level, component, message, details });
}

// Update system state
async function updateState(updates: Record<string, unknown>) {
  const { data } = await supabase.from('trading_system_state').select('*').limit(1).single();
  if (data) {
    await supabase.from('trading_system_state').update({
      ...updates,
      last_heartbeat: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', data.id);
  }
}

// Get system state
async function getState() {
  const { data } = await supabase.from('trading_system_state').select('*').limit(1).single();
  return data;
}

// ==================== SMART SCALPING ARM ====================
// Focus on quick scalps with clear entry/exit, not hold and liquidate
async function runTradingArm(settings: Record<string, unknown>) {
  await log('info', 'TRADING', 'Starting smart scalping scan...');
  
  const tickers = await gateRequest('/spot/tickers');
  const opportunities = [];
  const MIN_VOLUME = 100000; // Higher volume for better execution
  const minEdge = (settings.minEdge as number) || 1.5;
  
  // Get current positions to avoid overbuying
  const balances = await gateRequest('/spot/accounts');
  const holdings = new Map<string, number>(balances.map((b: { currency: string; available: string }) => 
    [b.currency, parseFloat(b.available)]
  ));
  const usdtBalance = holdings.get('USDT') || 0;
  
  // First: Check if we have positions that reached take-profit or stop-loss
  const exitResults = { sold: 0, profit: 0 };
  
  for (const [currency, amount] of holdings.entries()) {
    if (currency === 'USDT' || amount <= 0) continue;
    
    const pair = `${currency}_USDT`;
    const ticker = tickers.find((t: { currency_pair: string }) => t.currency_pair === pair);
    if (!ticker) continue;
    
    const currentPrice = parseFloat(ticker.last);
    const bid = parseFloat(ticker.highest_bid);
    const change24h = parseFloat(ticker.change_percentage);
    const value = amount * currentPrice;
    
    // Skip tiny balances
    if (value < 1) continue;
    
    // Check recent trade history for entry price
    const { data: recentTrades } = await supabase
      .from('trade_history')
      .select('*')
      .eq('symbol', pair.replace('_', '/'))
      .eq('side', 'buy')
      .order('executed_at', { ascending: false })
      .limit(1);
    
    const entryPrice = recentTrades?.[0]?.price || currentPrice;
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    
    // EXIT CONDITIONS:
    // 1. Take Profit: +2% profit
    // 2. Stop Loss: -1.5% loss
    // 3. Time Exit: if momentum reversed (was +10%, now < +5%)
    
    const shouldTakeProfit = pnlPercent >= 2;
    const shouldStopLoss = pnlPercent <= -1.5;
    const momentumReversed = change24h < 5 && entryPrice > 0;
    
    if (shouldTakeProfit || shouldStopLoss || (momentumReversed && value > 5)) {
      const reason = shouldTakeProfit ? 'take_profit' : (shouldStopLoss ? 'stop_loss' : 'momentum_exit');
      
      try {
        const order = await gateRequest('/spot/orders', 'POST', {}, {
          currency_pair: pair,
          side: 'sell',
          amount: amount.toFixed(6),
          price: bid.toString(),
          type: 'limit',
          time_in_force: 'ioc',
        });
        
        if (order.id) {
          const realizedPnL = (bid - entryPrice) * amount;
          exitResults.sold++;
          exitResults.profit += realizedPnL;
          
          await supabase.from('trade_history').insert({
            order_id: order.id,
            symbol: pair.replace('_', '/'),
            side: 'sell',
            type: reason,
            amount: amount,
            price: bid,
            expected_edge: pnlPercent,
            actual_pnl: realizedPnL,
            status: 'filled',
          });
          
          await log('info', 'TRADING', `${reason.toUpperCase()}: Sold ${currency} at ${pnlPercent.toFixed(2)}% | P&L: $${realizedPnL.toFixed(2)}`);
        }
      } catch (err) {
        await log('error', 'TRADING', `Exit failed for ${currency}`, { error: err instanceof Error ? err.message : 'Unknown' });
      }
      
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  // If we sold positions, update the balance
  if (exitResults.sold > 0) {
    const state = await getState();
    if (state) {
      await updateState({
        total_pnl: (state.total_pnl || 0) + exitResults.profit,
      });
    }
  }
  
  // NEW ENTRY CONDITIONS - Only enter if we have capacity and good setups
  const maxPositions = 3;
  const currentPositions = Array.from(holdings.entries()).filter(
    ([curr, amt]: [string, number]) => curr !== 'USDT' && amt * 
      parseFloat(tickers.find((t: { currency_pair: string }) => t.currency_pair === `${curr}_USDT`)?.last || '0') > 5
  ).length;
  
  if (currentPositions >= maxPositions) {
    await log('info', 'TRADING', `Max positions reached (${currentPositions}/${maxPositions}), waiting for exits`);
    return { scanned: tickers.length, found: 0, executed: 0, successful: exitResults.sold, exitProfit: exitResults.profit };
  }
  
  // Find SCALP opportunities - quick in-and-out trades
  for (const ticker of tickers) {
    const volume = parseFloat(ticker.quote_volume);
    if (volume < MIN_VOLUME) continue;
    
    const change = parseFloat(ticker.change_percentage);
    const last = parseFloat(ticker.last);
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const spread = ((ask - bid) / last) * 100;
    const high = parseFloat(ticker.high_24h);
    const low = parseFloat(ticker.low_24h);
    
    // Skip pairs we already hold
    const currency = ticker.currency_pair.split('_')[0];
    const currentHolding = holdings.get(currency);
    if (currentHolding && currentHolding > 0) continue;
    
    // SCALP STRATEGY 1: Tight spread + high volume = market maker opportunity
    if (spread > 0.4 && spread < 1.5 && volume > 200000) {
      const netEdge = spread * 0.4 - 0.4; // Conservative estimate after fees
      if (netEdge >= minEdge) {
        opportunities.push({ 
          type: 'spread_scalp', 
          pair: ticker.currency_pair, 
          edge: netEdge, 
          price: bid + (ask - bid) * 0.3, // Enter between bid-ask
          confidence: Math.min(90, 60 + volume / 50000),
          takeProfit: ask * 0.999, // Sell at ask minus small buffer
          stopLoss: bid * 0.985,
        });
      }
    }
    
    // SCALP STRATEGY 2: Bounce from support (near 24h low with reversal)
    const distanceFromLow = ((last - low) / low) * 100;
    if (distanceFromLow < 3 && change > -5 && change < 0 && volume > 150000) {
      // Price near low but not crashing - potential bounce
      const bounceEdge = 2.5; // Target 2.5% bounce
      opportunities.push({
        type: 'bounce_scalp',
        pair: ticker.currency_pair,
        edge: bounceEdge,
        price: last,
        confidence: Math.min(85, 55 + volume / 100000),
        takeProfit: last * 1.025,
        stopLoss: low * 0.99,
      });
    }
    
    // SCALP STRATEGY 3: Breakout continuation (just broke high)
    const distanceFromHigh = ((high - last) / high) * 100;
    if (distanceFromHigh < 1 && change > 5 && change < 15 && volume > 300000) {
      // Near high with momentum - ride the breakout
      const breakoutEdge = 2;
      opportunities.push({
        type: 'breakout_scalp',
        pair: ticker.currency_pair,
        edge: breakoutEdge,
        price: last,
        confidence: Math.min(80, 50 + change),
        takeProfit: last * 1.03,
        stopLoss: last * 0.985,
      });
    }
  }
  
  opportunities.sort((a, b) => (b.edge * b.confidence) - (a.edge * a.confidence));
  
  const maxTradeSize = Math.min((settings.maxTradeSize as number) || 20, usdtBalance * 0.25);
  const results = { scanned: tickers.length, found: opportunities.length, executed: 0, successful: exitResults.sold, exitProfit: exitResults.profit };
  
  // Only take 1 new position per cycle to manage risk
  for (const opp of opportunities.slice(0, 1)) {
    if (opp.confidence < 55 || opp.edge > 10) continue;
    
    const tradeAmount = Math.min(maxTradeSize, usdtBalance * 0.2);
    if (tradeAmount < 5) continue;
    
    const amount = (tradeAmount / opp.price).toFixed(6);
    
    try {
      const order = await gateRequest('/spot/orders', 'POST', {}, {
        currency_pair: opp.pair,
        side: 'buy',
        amount,
        price: opp.price.toFixed(8),
        type: 'limit',
        time_in_force: 'ioc',
      });
      
      results.executed++;
      
      if (order.id) {
        results.successful++;
        await supabase.from('trade_history').insert({
          order_id: order.id,
          symbol: opp.pair.replace('_', '/'),
          side: 'buy',
          type: opp.type,
          amount: parseFloat(amount),
          price: opp.price,
          expected_edge: opp.edge,
          status: 'filled',
        });
        await log('info', 'TRADING', `ENTRY: ${opp.type} ${opp.pair} @ ${opp.price} | TP: ${opp.takeProfit?.toFixed(6)} | SL: ${opp.stopLoss?.toFixed(6)}`, { orderId: order.id, edge: opp.edge });
      }
    } catch (err) {
      await log('error', 'TRADING', `Entry failed: ${opp.pair}`, { error: err instanceof Error ? err.message : 'Unknown' });
    }
  }
  
  return results;
}

// ==================== DUST CLEANER (only clean tiny balances, not positions) ====================
async function runLiquidationArm() {
  await log('info', 'DUST_CLEANER', 'Cleaning dust balances only...');
  
  const balances = await gateRequest('/spot/accounts');
  const tickers = await gateRequest('/spot/tickers');
  const tickerMap = new Map<string, { highest_bid: string }>(
    tickers.map((t: { currency_pair: string; highest_bid: string }) => [t.currency_pair, t])
  );
  
  let cleaned = 0;
  
  for (const balance of balances) {
    if (balance.currency === 'USDT' || parseFloat(balance.available) <= 0) continue;
    
    const pair = `${balance.currency}_USDT`;
    const ticker = tickerMap.get(pair);
    if (!ticker) continue;
    
    const value = parseFloat(balance.available) * parseFloat(ticker.highest_bid);
    
    // ONLY clean dust (< $1) - not real positions!
    if (value >= 1) continue;
    
    if (value < 0.1) continue; // Too small to bother
    
    try {
      const order = await gateRequest('/spot/orders', 'POST', {}, {
        currency_pair: pair,
        side: 'sell',
        amount: balance.available,
        price: ticker.highest_bid,
        type: 'limit',
        time_in_force: 'ioc',
      });
      
      if (order.id) {
        cleaned += value;
        await log('info', 'DUST_CLEANER', `Cleaned dust: ${balance.currency} ($${value.toFixed(2)})`);
      }
    } catch (err) {
      // Skip on error
    }
  }
  
  return { cleaned };
}

// ==================== REWARDS ARM (Airdrops, NFTs, etc.) ====================
async function runRewardsArm() {
  await log('info', 'REWARDS', 'Scanning for rewards, airdrops, and NFTs...');
  
  const rewards = [];
  
  try {
    // Check for pending rewards/bonuses
    const bonuses = await gateRequest('/wallet/saved_address');
    
    // Check for any claimable items in the account
    const accountInfo = await gateRequest('/account/detail');
    
    // Check sub-accounts for any rewards
    const subAccounts = await gateRequest('/sub_accounts');
    
    // Check for any margin account bonuses
    try {
      const marginAccount = await gateRequest('/margin/accounts');
      if (marginAccount && !marginAccount.message) {
        rewards.push({ type: 'margin_check', details: 'Margin account scanned' });
      }
    } catch (e) {
      // Margin not enabled
    }
    
    // Check for futures bonuses
    try {
      const futuresAccount = await gateRequest('/futures/usdt/accounts');
      if (futuresAccount && !futuresAccount.message && futuresAccount.total) {
        const futuresBalance = parseFloat(futuresAccount.total);
        if (futuresBalance > 0) {
          rewards.push({ type: 'futures_balance', value: futuresBalance, details: 'Futures balance found' });
        }
      }
    } catch (e) {
      // Futures not enabled
    }
    
    // Check earn/staking rewards
    try {
      const earnPositions = await gateRequest('/earn/uni/lends');
      if (Array.isArray(earnPositions) && earnPositions.length > 0) {
        for (const pos of earnPositions) {
          rewards.push({ type: 'earn_position', currency: pos.currency, amount: pos.amount });
        }
      }
    } catch (e) {
      // Earn not available
    }
    
    // Log any found rewards
    for (const reward of rewards) {
      await supabase.from('rewards_collected').insert({
        reward_type: reward.type,
        name: reward.currency || reward.type,
        value_usdt: reward.value || 0,
        details: reward,
      });
    }
    
  } catch (err) {
    await log('warn', 'REWARDS', 'Error scanning rewards', { error: err instanceof Error ? err.message : 'Unknown' });
  }
  
  return { checked: true, rewardsFound: rewards.length };
}

// ==================== ARBITRAGE ARM ====================
interface ArbitrageOpportunity {
  route: string[];
  pairs: string[];
  sides: ('buy' | 'sell')[];
  prices: number[];
  amounts: number[];
  profit: number;
  profitUSDT: number;
}

async function executeArbitrageTrade(
  pair: string, 
  side: 'buy' | 'sell', 
  amount: string, 
  price: string
): Promise<{ success: boolean; orderId?: string; filled?: string; error?: string }> {
  try {
    const order = await gateRequest('/spot/orders', 'POST', {}, {
      currency_pair: pair,
      side,
      amount,
      price,
      type: 'limit',
      time_in_force: 'ioc', // Immediate or Cancel for fast execution
    });
    
    if (order.id) {
      return { 
        success: true, 
        orderId: order.id, 
        filled: order.filled_total || order.amount 
      };
    } else {
      return { success: false, error: JSON.stringify(order) };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

async function runArbitrageArm(settings: Record<string, unknown>) {
  await log('info', 'ARBITRAGE', 'Scanning for triangular arbitrage...');
  
  const tickers = await gateRequest('/spot/tickers');
  const tickerMap = new Map<string, { last: string; highest_bid: string; lowest_ask: string }>(
    tickers.map((t: { currency_pair: string; last: string; highest_bid: string; lowest_ask: string }) => 
      [t.currency_pair, t]
    )
  );
  
  const opportunities: ArbitrageOpportunity[] = [];
  const bases = ['USDT']; // Focus on USDT-based arbitrage for simplicity
  
  // Get available USDT balance
  const balances = await gateRequest('/spot/accounts');
  const usdtBalance = balances.find((b: { currency: string }) => b.currency === 'USDT');
  const availableUSDT = usdtBalance ? parseFloat(usdtBalance.available) : 0;
  const maxArbAmount = Math.min(availableUSDT * 0.3, (settings.maxTradeSize as number || 25)); // Use 30% of balance max
  
  if (availableUSDT < 10) {
    await log('info', 'ARBITRAGE', 'Insufficient USDT for arbitrage');
    return { scanned: tickers.length, found: 0, executed: 0, profit: 0 };
  }
  
  // Find triangular arbitrage: USDT → A → B → USDT
  for (const ticker1 of tickers) {
    if (!ticker1.currency_pair.endsWith('_USDT')) continue;
    
    const currencyA = ticker1.currency_pair.split('_')[0];
    const priceA_USDT = parseFloat(ticker1.lowest_ask); // We buy A with USDT
    if (priceA_USDT <= 0) continue;
    
    // Find pairs: A → B
    for (const ticker2 of tickers) {
      if (!ticker2.currency_pair.startsWith(currencyA + '_')) continue;
      
      const currencyB = ticker2.currency_pair.split('_')[1];
      if (currencyB === 'USDT') continue;
      
      const priceA_B = parseFloat(ticker2.highest_bid); // We sell A for B
      if (priceA_B <= 0) continue;
      
      // Find pair: B → USDT
      const pairB_USDT = `${currencyB}_USDT`;
      const tickerB = tickerMap.get(pairB_USDT);
      if (!tickerB) continue;
      
      const priceB_USDT = parseFloat(tickerB.highest_bid); // We sell B for USDT
      if (priceB_USDT <= 0) continue;
      
      // Calculate arbitrage profit
      // Start with 1 USDT:
      // Step 1: Buy A with USDT → get (1 / priceA_USDT) A
      // Step 2: Sell A for B → get (amountA * priceA_B) B  
      // Step 3: Sell B for USDT → get (amountB * priceB_USDT) USDT
      
      const amountA = 1 / priceA_USDT;
      const amountB = amountA * priceA_B;
      const finalUSDT = amountB * priceB_USDT;
      
      // Account for 0.2% fee per trade (0.6% total)
      const profitBeforeFees = (finalUSDT - 1) * 100;
      const profitAfterFees = profitBeforeFees - 0.6;
      
      if (profitAfterFees > 0.5) { // Minimum 0.5% profit after fees
        const profitUSDT = maxArbAmount * (profitAfterFees / 100);
        
        opportunities.push({
          route: ['USDT', currencyA, currencyB, 'USDT'],
          pairs: [ticker1.currency_pair, ticker2.currency_pair, pairB_USDT],
          sides: ['buy', 'sell', 'sell'],
          prices: [priceA_USDT, priceA_B, priceB_USDT],
          amounts: [maxArbAmount / priceA_USDT, 0, 0], // Will calculate dynamically
          profit: profitAfterFees,
          profitUSDT,
        });
      }
    }
  }
  
  opportunities.sort((a, b) => b.profit - a.profit);
  
  let executedCount = 0;
  let totalProfit = 0;
  
  // Execute best arbitrage opportunity if profit > 1%
  if (opportunities.length > 0) {
    const best = opportunities[0];
    
    await log('info', 'ARBITRAGE', `Found ${opportunities.length} opportunities. Best: ${best.route.join('→')} +${best.profit.toFixed(2)}%`);
    
    // Only execute if profit is significant (>1%) and we haven't done too many
    if (best.profit > 1.0 && executedCount < 2) {
      await log('info', 'ARBITRAGE', `Executing arbitrage: ${best.route.join('→')}`, best);
      
      try {
        // Step 1: Buy currency A with USDT
        const step1Amount = (maxArbAmount / best.prices[0]).toFixed(6);
        const step1Result = await executeArbitrageTrade(
          best.pairs[0], 
          'buy', 
          step1Amount, 
          best.prices[0].toString()
        );
        
        if (!step1Result.success) {
          await log('error', 'ARBITRAGE', `Step 1 failed: ${step1Result.error}`);
          await supabase.from('opportunity_log').insert({
            opportunity_type: 'triangular_arbitrage',
            symbol: best.route.join(' → '),
            expected_edge: best.profit,
            confidence: 80,
            action_taken: 'executed',
            result: `failed_step1: ${step1Result.error}`,
          });
        } else {
          await log('info', 'ARBITRAGE', `Step 1 success: Bought ${step1Amount} ${best.route[1]}`);
          
          // Wait a bit for order to settle
          await new Promise(r => setTimeout(r, 500));
          
          // Get actual balance of currency A
          const updatedBalances = await gateRequest('/spot/accounts');
          const currencyABalance = updatedBalances.find((b: { currency: string }) => b.currency === best.route[1]);
          const actualAmountA = currencyABalance ? parseFloat(currencyABalance.available) : 0;
          
          if (actualAmountA > 0) {
            // Step 2: Sell currency A for currency B
            const step2Amount = actualAmountA.toFixed(6);
            const step2Result = await executeArbitrageTrade(
              best.pairs[1],
              'sell',
              step2Amount,
              best.prices[1].toString()
            );
            
            if (!step2Result.success) {
              await log('error', 'ARBITRAGE', `Step 2 failed: ${step2Result.error}`);
              // Try to recover by selling A back to USDT
              await executeArbitrageTrade(best.pairs[0], 'sell', step2Amount, (best.prices[0] * 0.99).toString());
            } else {
              await log('info', 'ARBITRAGE', `Step 2 success: Sold ${step2Amount} ${best.route[1]} for ${best.route[2]}`);
              
              await new Promise(r => setTimeout(r, 500));
              
              // Get balance of currency B
              const balancesAfterStep2 = await gateRequest('/spot/accounts');
              const currencyBBalance = balancesAfterStep2.find((b: { currency: string }) => b.currency === best.route[2]);
              const actualAmountB = currencyBBalance ? parseFloat(currencyBBalance.available) : 0;
              
              if (actualAmountB > 0) {
                // Step 3: Sell currency B for USDT
                const step3Amount = actualAmountB.toFixed(6);
                const step3Result = await executeArbitrageTrade(
                  best.pairs[2],
                  'sell',
                  step3Amount,
                  best.prices[2].toString()
                );
                
                if (step3Result.success) {
                  executedCount++;
                  totalProfit += best.profitUSDT;
                  
                  await log('info', 'ARBITRAGE', `✅ Arbitrage complete! Estimated profit: $${best.profitUSDT.toFixed(2)}`);
                  
                  // Record successful trade
                  await supabase.from('trade_history').insert({
                    order_id: `arb-${step1Result.orderId}-${step3Result.orderId}`,
                    symbol: best.route.join('→'),
                    side: 'arbitrage',
                    type: 'triangular_arbitrage',
                    amount: maxArbAmount,
                    price: best.profit,
                    expected_edge: best.profit,
                    status: 'filled',
                  });
                  
                  await supabase.from('opportunity_log').insert({
                    opportunity_type: 'triangular_arbitrage',
                    symbol: best.route.join(' → '),
                    expected_edge: best.profit,
                    confidence: 90,
                    action_taken: 'executed',
                    result: `success: +$${best.profitUSDT.toFixed(2)}`,
                  });
                } else {
                  await log('error', 'ARBITRAGE', `Step 3 failed: ${step3Result.error}`);
                }
              }
            }
          }
        }
      } catch (err) {
        await log('error', 'ARBITRAGE', `Arbitrage execution error: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    } else {
      // Just log the opportunities without executing
      for (const opp of opportunities.slice(0, 5)) {
        await supabase.from('opportunity_log').insert({
          opportunity_type: 'triangular_arbitrage',
          symbol: opp.route.join(' → '),
          expected_edge: opp.profit,
          confidence: Math.min(95, 50 + opp.profit * 10),
          action_taken: opp.profit > 1.0 ? 'skipped_limit' : 'logged',
          result: 'pending',
        });
      }
    }
  }
  
  return { 
    scanned: tickers.length, 
    found: opportunities.length, 
    executed: executedCount,
    profit: totalProfit,
    best: opportunities[0] 
  };
}

// ==================== MAIN ORCHESTRATOR ====================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const command = body.command || 'cycle';
    
    // Check if system is active
    const state = await getState();
    if (!state?.is_active && command !== 'start' && command !== 'status') {
      return new Response(JSON.stringify({ success: false, error: 'System is stopped. Send command: "start" to activate.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Handle commands
    if (command === 'stop') {
      await updateState({ is_active: false });
      await log('warn', 'ORCHESTRATOR', 'System STOPPED by user command');
      return new Response(JSON.stringify({ success: true, message: 'System stopped' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (command === 'start') {
      await updateState({ is_active: true, started_at: new Date().toISOString() });
      await log('info', 'ORCHESTRATOR', 'System STARTED by user command');
    }
    
    if (command === 'status') {
      const recentTrades = await supabase.from('trade_history').select('*').order('created_at', { ascending: false }).limit(10);
      const recentLogs = await supabase.from('system_log').select('*').order('created_at', { ascending: false }).limit(20);
      
      return new Response(JSON.stringify({
        success: true,
        state,
        recentTrades: recentTrades.data,
        recentLogs: recentLogs.data,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Run full cycle
    await log('info', 'ORCHESTRATOR', '=== Starting autonomous cycle ===');
    const cycleStart = Date.now();
    const settings = state?.settings || {};
    
    // Run all arms in parallel
    const [tradingResult, liquidationResult, rewardsResult, arbitrageResult] = await Promise.all([
      runTradingArm(settings),
      settings.autoLiquidate !== false ? runLiquidationArm() : Promise.resolve({ liquidated: 0 }),
      runRewardsArm(),
      runArbitrageArm(settings),
    ]);
    
    // Get final balance
    const balances = await gateRequest('/spot/accounts');
    const usdtBalance = balances.find((b: { currency: string }) => b.currency === 'USDT');
    const currentBalance = usdtBalance ? parseFloat(usdtBalance.available) : 0;
    
    // Update state
    const newCycles = (state?.total_cycles || 0) + 1;
    const newTrades = (state?.total_trades || 0) + tradingResult.executed;
    const newSuccessful = (state?.successful_trades || 0) + tradingResult.successful;
    
    await updateState({
      total_cycles: newCycles,
      total_trades: newTrades,
      successful_trades: newSuccessful,
      current_balance: currentBalance,
    });
    
    const cycleDuration = Date.now() - cycleStart;
    await log('info', 'ORCHESTRATOR', `=== Cycle complete in ${cycleDuration}ms ===`, {
      trading: tradingResult,
      liquidation: liquidationResult,
      rewards: rewardsResult,
      arbitrage: arbitrageResult,
      balance: currentBalance,
    });
    
    return new Response(JSON.stringify({
      success: true,
      cycle: newCycles,
      duration: cycleDuration,
      results: {
        trading: tradingResult,
        liquidation: liquidationResult,
        rewards: rewardsResult,
        arbitrage: arbitrageResult,
      },
      balance: currentBalance,
      isActive: state?.is_active,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[ORCHESTRATOR] Error:', error);
    await log('error', 'ORCHESTRATOR', 'Cycle failed', { error: error instanceof Error ? error.message : 'Unknown' });
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
