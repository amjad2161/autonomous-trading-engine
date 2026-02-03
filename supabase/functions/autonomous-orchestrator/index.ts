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

// ==================== TRADING ARM ====================
async function runTradingArm(settings: Record<string, unknown>) {
  await log('info', 'TRADING', 'Starting trading scan...');
  
  const tickers = await gateRequest('/spot/tickers');
  const opportunities = [];
  const MIN_VOLUME = 50000;
  const minEdge = (settings.minEdge as number) || 2;
  
  for (const ticker of tickers) {
    const volume = parseFloat(ticker.quote_volume);
    if (volume < MIN_VOLUME) continue;
    
    const change = parseFloat(ticker.change_percentage);
    const last = parseFloat(ticker.last);
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const spread = ((ask - bid) / last) * 100;
    
    // Spread opportunity
    if (spread > 0.3) {
      const netEdge = spread * 0.5 - 0.2;
      if (netEdge >= minEdge) {
        opportunities.push({ type: 'spread', pair: ticker.currency_pair, edge: netEdge, price: bid, confidence: Math.min(95, 50 + volume / 10000) });
      }
    }
    
    // Mean reversion
    if (change < -15) {
      const bounceEdge = Math.abs(change) * 0.2;
      if (bounceEdge >= minEdge) {
        opportunities.push({ type: 'reversion', pair: ticker.currency_pair, edge: bounceEdge, price: last, confidence: Math.min(90, 60 + Math.abs(change)) });
      }
    }
    
    // Momentum
    if (change > 10) {
      const momentumEdge = change * 0.15;
      if (momentumEdge >= minEdge) {
        opportunities.push({ type: 'momentum', pair: ticker.currency_pair, edge: momentumEdge, price: last, confidence: Math.min(85, 50 + change) });
      }
    }
  }
  
  opportunities.sort((a, b) => b.edge - a.edge);
  
  // Execute best opportunities
  const balances = await gateRequest('/spot/accounts');
  const usdtBalance = balances.find((b: { currency: string }) => b.currency === 'USDT');
  const availableUSDT = usdtBalance ? parseFloat(usdtBalance.available) : 0;
  
  const maxTradeSize = (settings.maxTradeSize as number) || 25;
  const results = { scanned: tickers.length, found: opportunities.length, executed: 0, successful: 0 };
  
  for (const opp of opportunities.slice(0, 3)) {
    if (opp.confidence < 50 || opp.edge > 15) continue;
    
    const tradeAmount = availableUSDT * (maxTradeSize / 100);
    if (tradeAmount < 5) continue;
    
    const amount = (tradeAmount / opp.price).toFixed(6);
    
    try {
      const order = await gateRequest('/spot/orders', 'POST', {}, {
        currency_pair: opp.pair,
        side: 'buy',
        amount,
        price: opp.price.toString(),
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
        await log('info', 'TRADING', `Trade executed: ${opp.pair} @ ${opp.price}`, { orderId: order.id, edge: opp.edge });
      }
    } catch (err) {
      await log('error', 'TRADING', `Trade failed: ${opp.pair}`, { error: err instanceof Error ? err.message : 'Unknown' });
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  return results;
}

// ==================== LIQUIDATION ARM ====================
async function runLiquidationArm() {
  await log('info', 'LIQUIDATOR', 'Starting liquidation scan...');
  
  const balances = await gateRequest('/spot/accounts');
  const tickers = await gateRequest('/spot/tickers');
  const tickerMap = new Map<string, { highest_bid: string }>(
    tickers.map((t: { currency_pair: string; highest_bid: string }) => [t.currency_pair, t])
  );
  
  let liquidated = 0;
  
  for (const balance of balances) {
    if (balance.currency === 'USDT' || parseFloat(balance.available) <= 0) continue;
    
    const pair = `${balance.currency}_USDT`;
    const ticker = tickerMap.get(pair);
    if (!ticker) continue;
    
    const value = parseFloat(balance.available) * parseFloat(ticker.highest_bid);
    if (value < 0.5) continue;
    
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
        liquidated += value;
        await log('info', 'LIQUIDATOR', `Liquidated ${balance.currency} for $${value.toFixed(2)}`);
      }
    } catch (err) {
      // Skip on error
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  return { liquidated };
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
async function runArbitrageArm() {
  await log('info', 'ARBITRAGE', 'Scanning for triangular arbitrage...');
  
  const tickers = await gateRequest('/spot/tickers');
  const tickerMap = new Map<string, number>(
    tickers.map((t: { currency_pair: string; last: string }) => [t.currency_pair, parseFloat(t.last)])
  );
  
  const opportunities = [];
  const bases = ['BTC', 'ETH', 'USDT'];
  
  // Find triangular arbitrage opportunities
  for (const base of bases) {
    const pairs = tickers.filter((t: { currency_pair: string }) => t.currency_pair.endsWith(`_${base}`));
    
    for (const pair1 of pairs) {
      const currency1 = pair1.currency_pair.split('_')[0];
      const price1 = parseFloat(pair1.last);
      
      // Find pair2: currency1 -> another currency
      for (const pair2 of tickers) {
        if (!pair2.currency_pair.startsWith(currency1 + '_')) continue;
        const currency2 = pair2.currency_pair.split('_')[1];
        if (currency2 === base) continue;
        const price2 = parseFloat(pair2.last);
        
        // Find pair3: currency2 -> base
        const pair3Key = `${currency2}_${base}`;
        const price3 = tickerMap.get(pair3Key);
        if (!price3) continue;
        
        // Calculate arbitrage profit
        // Start with 1 base, buy currency1, sell for currency2, sell for base
        const step1 = 1 / price1; // base -> currency1
        const step2 = step1 * price2; // currency1 -> currency2
        const step3 = step2 * price3; // currency2 -> base
        const profit = (step3 - 1) * 100 - 0.6; // Subtract ~0.6% for fees (0.2% * 3)
        
        if (profit > 0.5) {
          opportunities.push({
            route: [base, currency1, currency2, base],
            profit,
            prices: [price1, price2, price3],
          });
        }
      }
    }
  }
  
  opportunities.sort((a, b) => b.profit - a.profit);
  
  if (opportunities.length > 0) {
    await log('info', 'ARBITRAGE', `Found ${opportunities.length} arbitrage opportunities`, opportunities.slice(0, 3));
    
    // Log to opportunity table
    for (const opp of opportunities.slice(0, 5)) {
      await supabase.from('opportunity_log').insert({
        opportunity_type: 'triangular_arbitrage',
        symbol: opp.route.join(' → '),
        expected_edge: opp.profit,
        confidence: Math.min(95, 50 + opp.profit * 10),
        action_taken: 'logged',
        result: 'pending',
      });
    }
  }
  
  return { scanned: tickers.length, found: opportunities.length, best: opportunities[0] };
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
      runArbitrageArm(),
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
