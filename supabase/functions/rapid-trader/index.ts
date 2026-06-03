import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gateFetch } from "../_shared/gate-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Ticker {
  currency_pair: string;
  last: string;
  highest_bid: string;
  lowest_ask: string;
  quote_volume: string;
  base_volume: string;
}

interface TradeResult {
  pair: string;
  buyPrice: number;
  sellPrice: number;
  amount: string;
  profit: number;
  profitPercent: number;
  buyOrderId?: string;
  sellOrderId?: string;
  status: 'success' | 'partial' | 'failed';
  error?: string;
  durationMs: number;
}

const gateRequest = (endpoint: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', params: Record<string, string> = {}, body?: Record<string, unknown>) =>
  gateFetch('rapid-trader', endpoint, method, params, body);

// Find pairs with tightest spreads for rapid trading
function findRapidOpportunities(tickers: Ticker[], minVolume: number = 100000): Array<{
  pair: string;
  bid: number;
  ask: number;
  spread: number;
  spreadPercent: number;
  volume: number;
}> {
  const opportunities: Array<{
    pair: string;
    bid: number;
    ask: number;
    spread: number;
    spreadPercent: number;
    volume: number;
  }> = [];

  for (const ticker of tickers) {
    if (!ticker.currency_pair.endsWith('_USDT')) continue;
    
    // Skip leveraged tokens
    if (/[35][LS]_/.test(ticker.currency_pair)) continue;
    
    const bid = parseFloat(ticker.highest_bid);
    const ask = parseFloat(ticker.lowest_ask);
    const volume = parseFloat(ticker.quote_volume);
    
    if (!bid || !ask || bid <= 0 || ask <= 0) continue;
    if (volume < minVolume) continue;
    
    const spread = ask - bid;
    const spreadPercent = (spread / bid) * 100;
    
    // Look for very tight spreads (0.05% - 0.5%)
    // We need spread > fees (0.2% round trip) to profit
    if (spreadPercent >= 0.25 && spreadPercent <= 1.0) {
      opportunities.push({
        pair: ticker.currency_pair,
        bid,
        ask,
        spread,
        spreadPercent,
        volume,
      });
    }
  }

  // Sort by spread (tightest first for fastest execution)
  return opportunities.sort((a, b) => a.spreadPercent - b.spreadPercent);
}

// Execute a complete round-trip trade (buy then sell)
async function executeRoundTrip(
  pair: string,
  bid: number,
  ask: number,
  tradeAmountUSDT: number
): Promise<TradeResult> {
  const startTime = Date.now();
  const result: TradeResult = {
    pair,
    buyPrice: 0,
    sellPrice: 0,
    amount: '0',
    profit: 0,
    profitPercent: 0,
    status: 'failed',
    durationMs: 0,
  };

  try {
    // Calculate amount to buy (slightly below ask for better fill)
    const buyPrice = ask * 0.9999; // Slightly below ask
    const amount = (tradeAmountUSDT / buyPrice).toFixed(6);
    result.amount = amount;
    result.buyPrice = buyPrice;

    console.log(`[RapidTrader] BUY ${amount} ${pair} @ ${buyPrice}`);

    // Execute BUY order (IOC for immediate execution)
    const buyOrder = await gateRequest('/spot/orders', 'POST', {}, {
      currency_pair: pair,
      side: 'buy',
      amount,
      price: buyPrice.toString(),
      type: 'limit',
      time_in_force: 'ioc',
    });

    if (!buyOrder.id) {
      result.error = `Buy failed: ${JSON.stringify(buyOrder)}`;
      result.durationMs = Date.now() - startTime;
      return result;
    }

    result.buyOrderId = buyOrder.id;
    const filledAmount = parseFloat(buyOrder.filled_amount || buyOrder.amount || amount);

    if (filledAmount <= 0) {
      result.error = 'Buy order not filled';
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Immediate SELL at bid price (or slightly above for profit)
    const sellPrice = bid * 1.0001; // Slightly above bid
    result.sellPrice = sellPrice;

    console.log(`[RapidTrader] SELL ${filledAmount} ${pair} @ ${sellPrice}`);

    // Small delay to let order book update
    await new Promise(r => setTimeout(r, 50));

    const sellOrder = await gateRequest('/spot/orders', 'POST', {}, {
      currency_pair: pair,
      side: 'sell',
      amount: filledAmount.toFixed(6),
      price: sellPrice.toString(),
      type: 'limit',
      time_in_force: 'ioc',
    });

    if (!sellOrder.id) {
      result.error = `Sell failed (holding position): ${JSON.stringify(sellOrder)}`;
      result.status = 'partial';
      result.durationMs = Date.now() - startTime;
      return result;
    }

    result.sellOrderId = sellOrder.id;
    const soldAmount = parseFloat(sellOrder.filled_amount || sellOrder.amount || '0');

    if (soldAmount <= 0) {
      result.error = 'Sell order not filled (holding position)';
      result.status = 'partial';
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // Calculate profit
    const buyCost = filledAmount * result.buyPrice * 1.001; // +0.1% fee
    const sellRevenue = soldAmount * result.sellPrice * 0.999; // -0.1% fee
    result.profit = sellRevenue - buyCost;
    result.profitPercent = (result.profit / buyCost) * 100;
    result.status = 'success';
    result.durationMs = Date.now() - startTime;

    console.log(`[RapidTrader] COMPLETE: ${pair} profit=$${result.profit.toFixed(4)} (${result.profitPercent.toFixed(3)}%) in ${result.durationMs}ms`);

    return result;

  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Unknown error';
    result.durationMs = Date.now() - startTime;
    return result;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    
    // Configuration
    const config = {
      maxTradesPerCycle: body.maxTradesPerCycle || 10,      // Max trades per run
      tradeAmountUSDT: body.tradeAmountUSDT || 5,           // USDT per trade
      minVolume: body.minVolume || 100000,                   // Min 24h volume
      targetProfitPercent: body.targetProfitPercent || 0.05, // Target 0.05% per trade
      maxSpreadPercent: body.maxSpreadPercent || 1.0,        // Max spread to consider
      delayBetweenTrades: body.delayBetweenTrades || 100,    // ms between trades
    };

    console.log('[RapidTrader] Starting cycle with config:', JSON.stringify(config));

    const results = {
      timestamp: Date.now(),
      config,
      balance: { before: 0, after: 0 },
      opportunities: 0,
      trades: [] as TradeResult[],
      summary: {
        totalTrades: 0,
        successfulTrades: 0,
        partialTrades: 0,
        failedTrades: 0,
        totalProfit: 0,
        avgProfitPercent: 0,
        avgDurationMs: 0,
      },
    };

    // Get current balance
    const balances = await gateRequest('/spot/accounts');
    const usdtBalance = balances.find((b: { currency: string }) => b.currency === 'USDT');
    results.balance.before = usdtBalance ? parseFloat(usdtBalance.available) : 0;

    console.log(`[RapidTrader] USDT Balance: $${results.balance.before.toFixed(2)}`);

    // Check minimum balance
    const minRequired = config.tradeAmountUSDT * 1.1; // +10% buffer
    if (results.balance.before < minRequired) {
      return new Response(JSON.stringify({
        success: false,
        error: `Insufficient balance: $${results.balance.before.toFixed(2)} < $${minRequired.toFixed(2)} required`,
        ...results,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all tickers
    const tickers: Ticker[] = await gateRequest('/spot/tickers');
    console.log(`[RapidTrader] Scanned ${tickers.length} pairs`);

    // Find rapid trading opportunities
    const opportunities = findRapidOpportunities(tickers, config.minVolume);
    results.opportunities = opportunities.length;

    console.log(`[RapidTrader] Found ${opportunities.length} opportunities with tight spreads`);

    if (opportunities.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No suitable opportunities found',
        ...results,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Execute trades on best opportunities
    let availableUSDT = results.balance.before;
    const tradesToExecute = Math.min(config.maxTradesPerCycle, opportunities.length);

    for (let i = 0; i < tradesToExecute; i++) {
      const opp = opportunities[i];
      
      // Check if we have enough balance
      if (availableUSDT < config.tradeAmountUSDT) {
        console.log(`[RapidTrader] Insufficient balance for more trades`);
        break;
      }

      // Execute round-trip trade
      const tradeResult = await executeRoundTrip(
        opp.pair,
        opp.bid,
        opp.ask,
        config.tradeAmountUSDT
      );

      results.trades.push(tradeResult);

      // Update stats
      results.summary.totalTrades++;
      if (tradeResult.status === 'success') {
        results.summary.successfulTrades++;
        results.summary.totalProfit += tradeResult.profit;
      } else if (tradeResult.status === 'partial') {
        results.summary.partialTrades++;
        // For partial trades, we still hold the asset - don't count as available
        availableUSDT -= config.tradeAmountUSDT;
      } else {
        results.summary.failedTrades++;
      }

      // Rate limiting - small delay between trades
      if (i < tradesToExecute - 1) {
        await new Promise(r => setTimeout(r, config.delayBetweenTrades));
      }
    }

    // Calculate averages
    const successfulTrades = results.trades.filter(t => t.status === 'success');
    if (successfulTrades.length > 0) {
      results.summary.avgProfitPercent = successfulTrades.reduce((sum, t) => sum + t.profitPercent, 0) / successfulTrades.length;
      results.summary.avgDurationMs = successfulTrades.reduce((sum, t) => sum + t.durationMs, 0) / successfulTrades.length;
    }

    // Get final balance
    await new Promise(r => setTimeout(r, 500));
    const finalBalances = await gateRequest('/spot/accounts');
    const finalUSDT = finalBalances.find((b: { currency: string }) => b.currency === 'USDT');
    results.balance.after = finalUSDT ? parseFloat(finalUSDT.available) : 0;

    const totalDuration = Date.now() - startTime;

    console.log(`[RapidTrader] Cycle complete in ${totalDuration}ms:`, JSON.stringify(results.summary));

    return new Response(JSON.stringify({
      success: true,
      durationMs: totalDuration,
      ...results,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[RapidTrader] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: Date.now() - startTime,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
