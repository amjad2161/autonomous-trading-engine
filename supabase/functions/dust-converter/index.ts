import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sha512Hash(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  return encodeHex(new Uint8Array(hashBuffer));
}

async function generateSignature(
  method: string,
  url: string,
  queryString: string,
  payloadString: string,
  timestamp: string,
  secret: string
): Promise<string> {
  const hashedPayload = await sha512Hash(payloadString);
  const signatureString = `${method}\n${url}\n${queryString}\n${hashedPayload}\n${timestamp}`;
  return createHmac('sha512', secret).update(signatureString).digest('hex');
}

async function gateRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  params: Record<string, string> = {},
  body?: Record<string, unknown>
) {
  const GATE_API_KEY = Deno.env.get('GATE_API_KEY');
  const GATE_API_SECRET = Deno.env.get('GATE_API_SECRET');
  
  if (!GATE_API_KEY || !GATE_API_SECRET) {
    throw new Error('Gate.io API credentials not configured');
  }

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
    headers: {
      'KEY': GATE_API_KEY,
      'SIGN': signature,
      'Timestamp': timestamp,
      'Content-Type': 'application/json',
    },
    body: payloadString || undefined,
  });

  const text = await response.text();
  try {
    return { data: JSON.parse(text), status: response.status, ok: response.ok };
  } catch {
    console.log(`[DUST] Raw response: ${text}`);
    return { data: { error: text }, status: response.status, ok: false };
  }
}

interface DustBalance {
  currency: string;
  available: string;
  estimatedValue: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action = 'scan', minValueUSDT = 0.01, targetUSDT = 5, convertToGT = true } = await req.json().catch(() => ({}));
    
    console.log(`[DUST-CONVERTER] 🧹 Action: ${action}, Min Value: $${minValueUSDT}, Target: $${targetUSDT}`);
    
    interface SellableBalance extends DustBalance {
      canSell: boolean;
      minOrderValue: number;
    }
    
    const results = {
      action,
      timestamp: Date.now(),
      dustBalances: [] as DustBalance[],
      sellableBalances: [] as SellableBalance[],
      convertibleCurrencies: [] as string[],
      converted: false,
      liquidatedUSDT: 0,
      gtReceived: 0,
      errors: [] as string[],
    };

    // Step 1: Get all spot balances
    console.log('[DUST-CONVERTER] 📊 Fetching spot balances...');
    const balancesResponse = await gateRequest('/spot/accounts');
    
    if (!balancesResponse.ok || !Array.isArray(balancesResponse.data)) {
      throw new Error('Failed to fetch balances');
    }

    // Step 2: Get all tickers for value estimation
    console.log('[DUST-CONVERTER] 📈 Fetching tickers for valuation...');
    const tickersResponse = await gateRequest('/spot/tickers');
    
    if (!tickersResponse.ok || !Array.isArray(tickersResponse.data)) {
      throw new Error('Failed to fetch tickers');
    }

    const tickerMap = new Map<string, { price: number; bid: string }>();
    for (const ticker of tickersResponse.data) {
      if (ticker.currency_pair?.endsWith('_USDT')) {
        tickerMap.set(ticker.currency_pair.replace('_USDT', ''), {
          price: parseFloat(ticker.last || '0'),
          bid: ticker.highest_bid || ticker.last,
        });
      }
    }

    // Step 3: Categorize balances - dust vs sellable
    const KEEP_CURRENCIES = ['USDT', 'USD', 'GT'];
    const MIN_TRADE_VALUE = 3; // Gate.io minimum $3 per trade
    
    for (const balance of balancesResponse.data) {
      const available = parseFloat(balance.available || '0');
      if (available <= 0 || KEEP_CURRENCIES.includes(balance.currency)) {
        continue;
      }

      const tickerInfo = tickerMap.get(balance.currency);
      if (!tickerInfo) continue;
      
      const estimatedValue = available * tickerInfo.price;

      if (estimatedValue >= MIN_TRADE_VALUE) {
        // This is SELLABLE - above minimum
        results.sellableBalances.push({
          currency: balance.currency,
          available: balance.available,
          estimatedValue,
          canSell: true,
          minOrderValue: MIN_TRADE_VALUE,
        });
        console.log(`[DUST-CONVERTER] 💰 SELLABLE: ${balance.currency} = $${estimatedValue.toFixed(2)}`);
      } else if (estimatedValue >= minValueUSDT) {
        // This is dust - below minimum
        results.dustBalances.push({
          currency: balance.currency,
          available: balance.available,
          estimatedValue,
        });
        console.log(`[DUST-CONVERTER] 💨 Dust: ${balance.currency} = $${estimatedValue.toFixed(4)}`);
      }
    }
    
    console.log(`[DUST-CONVERTER] Found ${results.sellableBalances.length} sellable, ${results.dustBalances.length} dust`);

    // Get current USDT balance
    const usdtBalance = balancesResponse.data.find((b: { currency: string }) => b.currency === 'USDT');
    const currentUSDT = parseFloat(usdtBalance?.available || '0');
    console.log(`[DUST-CONVERTER] 💵 Current USDT: $${currentUSDT.toFixed(2)}`);
    
    // Step 4: If action is 'force-liquidity', sell largest positions first to reach target
    if (action === 'force-liquidity' && results.sellableBalances.length > 0) {
      console.log(`[DUST-CONVERTER] 🔥 FORCE LIQUIDITY MODE - Target: $${targetUSDT}`);
      
      // Sort by value descending - sell biggest first
      results.sellableBalances.sort((a, b) => b.estimatedValue - a.estimatedValue);
      
      let neededUSDT = targetUSDT - currentUSDT;
      let totalLiquidated = 0;
      
      for (const asset of results.sellableBalances) {
        if (neededUSDT <= 0) {
          console.log(`[DUST-CONVERTER] ✅ Target reached, stopping liquidation`);
          break;
        }
        
        const pair = `${asset.currency}_USDT`;
        const tickerInfo = tickerMap.get(asset.currency);
        
        if (!tickerInfo) continue;
        
        console.log(`[DUST-CONVERTER] 🔄 Selling ${asset.currency} ($${asset.estimatedValue.toFixed(2)})...`);
        
        try {
          const orderResponse = await gateRequest('/spot/orders', 'POST', {}, {
            currency_pair: pair,
            side: 'sell',
            amount: asset.available,
            price: tickerInfo.bid,
            type: 'limit',
            time_in_force: 'ioc',
          });
          
          if (orderResponse.ok && orderResponse.data.id) {
            const filled = parseFloat(orderResponse.data.filled_total || '0') || asset.estimatedValue * 0.99;
            totalLiquidated += filled;
            neededUSDT -= filled;
            console.log(`[DUST-CONVERTER] ✅ Sold ${asset.currency} for ~$${filled.toFixed(2)}`);
          } else {
            results.errors.push(`${asset.currency}: ${orderResponse.data?.message || 'Failed'}`);
            console.log(`[DUST-CONVERTER] ❌ Failed to sell ${asset.currency}:`, orderResponse.data);
          }
        } catch (e) {
          results.errors.push(`${asset.currency}: ${e}`);
        }
        
        await new Promise(r => setTimeout(r, 250));
      }
      
      results.liquidatedUSDT = totalLiquidated;
    }

    console.log(`[DUST-CONVERTER] Found ${results.dustBalances.length} dust balances`);

    // Step 4: Check which currencies can be converted to GT
    if (results.dustBalances.length > 0) {
      console.log('[DUST-CONVERTER] 🔍 Checking convertible currencies...');
      
      const smallBalanceResponse = await gateRequest('/wallet/small_balance');
      
      if (smallBalanceResponse.ok && smallBalanceResponse.data) {
        const convertibleList = smallBalanceResponse.data.currencies || [];
        results.convertibleCurrencies = convertibleList;
        console.log(`[DUST-CONVERTER] ✅ Convertible currencies: ${convertibleList.length}`);
      }
    }

    // Step 5: Convert to GT if requested
    if (action === 'convert' && convertToGT && results.convertibleCurrencies.length > 0) {
      console.log('[DUST-CONVERTER] 🔄 Converting dust to GT...');
      
      // Get GT balance before conversion
      const gtBefore = balancesResponse.data.find((b: { currency: string }) => b.currency === 'GT');
      const gtBalanceBefore = parseFloat(gtBefore?.available || '0');

      // Execute conversion
      const convertResponse = await gateRequest('/wallet/small_balance', 'POST', {}, {
        currency: results.convertibleCurrencies,
        is_gt: true,
      });

      if (convertResponse.ok) {
        results.converted = true;
        console.log('[DUST-CONVERTER] ✅ Conversion submitted');

        // Wait a moment for conversion to process
        await new Promise(r => setTimeout(r, 1000));

        // Check GT balance after
        const newBalancesResponse = await gateRequest('/spot/accounts');
        if (newBalancesResponse.ok && Array.isArray(newBalancesResponse.data)) {
          const gtAfter = newBalancesResponse.data.find((b: { currency: string }) => b.currency === 'GT');
          const gtBalanceAfter = parseFloat(gtAfter?.available || '0');
          results.gtReceived = gtBalanceAfter - gtBalanceBefore;
          console.log(`[DUST-CONVERTER] 💰 GT received: ${results.gtReceived.toFixed(4)}`);
        }
      } else {
        results.errors.push(`Conversion failed: ${JSON.stringify(convertResponse.data)}`);
        console.log('[DUST-CONVERTER] ❌ Conversion failed:', convertResponse.data);
      }
    }

    // Step 6: Alternative - Try to sell dust directly for USDT if GT conversion not available
    if (action === 'liquidate') {
      console.log('[DUST-CONVERTER] 💵 Attempting direct USDT liquidation...');
      
      let totalLiquidated = 0;
      const liquidationAttempts: string[] = [];
      
      for (const dust of results.dustBalances) {
        const pair = `${dust.currency}_USDT`;
        const ticker = tickersResponse.data.find((t: { currency_pair: string }) => t.currency_pair === pair);
        
        if (!ticker) {
          console.log(`[DUST-CONVERTER] ⚠️ No trading pair for ${dust.currency}`);
          results.errors.push(`${dust.currency}: No USDT pair available`);
          continue;
        }

        console.log(`[DUST-CONVERTER] 🔄 Trying to sell ${dust.currency}...`);

        // Try to place market sell order directly
        try {
          const orderResponse = await gateRequest('/spot/orders', 'POST', {}, {
            currency_pair: pair,
            side: 'sell',
            amount: dust.available,
            price: ticker.highest_bid || ticker.last,
            type: 'limit',
            time_in_force: 'ioc', // Immediate or cancel
          });

          console.log(`[DUST-CONVERTER] Order response for ${dust.currency}:`, JSON.stringify(orderResponse.data));

          if (orderResponse.ok && orderResponse.data.id) {
            totalLiquidated += dust.estimatedValue;
            liquidationAttempts.push(`✅ ${dust.currency}: +$${dust.estimatedValue.toFixed(4)}`);
            console.log(`[DUST-CONVERTER] ✅ Sold ${dust.currency} for ~$${dust.estimatedValue.toFixed(2)}`);
          } else if (orderResponse.data?.label === 'ORDER_SIZE_MIN') {
            // Below minimum - try to get pair info for details
            const pairInfoResponse = await gateRequest(`/spot/currency_pairs/${pair}`);
            const minAmount = pairInfoResponse.data?.min_base_amount || 'unknown';
            results.errors.push(`${dust.currency}: Below min order (need ${minAmount}, have ${dust.available})`);
            liquidationAttempts.push(`⚠️ ${dust.currency}: Below min (${dust.available} < ${minAmount})`);
            console.log(`[DUST-CONVERTER] ⚠️ ${dust.currency}: Below minimum order size`);
          } else {
            results.errors.push(`${dust.currency}: ${orderResponse.data?.message || orderResponse.data?.label || 'Order failed'}`);
            liquidationAttempts.push(`❌ ${dust.currency}: ${orderResponse.data?.label || 'Failed'}`);
          }
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          results.errors.push(`${dust.currency}: ${errorMsg}`);
          liquidationAttempts.push(`❌ ${dust.currency}: ${errorMsg}`);
          console.log(`[DUST-CONVERTER] ❌ Error selling ${dust.currency}:`, e);
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 250));
      }

      results.gtReceived = totalLiquidated; // Repurpose field for USDT gained
      console.log(`[DUST-CONVERTER] 📊 Liquidation attempts:`, liquidationAttempts);
    }

    // Summary
    const summary = {
      success: true,
      currentUSDT,
      sellableCount: results.sellableBalances.length,
      sellableValue: results.sellableBalances.reduce((sum, s) => sum + s.estimatedValue, 0),
      dustFound: results.dustBalances.length,
      totalDustValue: results.dustBalances.reduce((sum, d) => sum + d.estimatedValue, 0),
      convertibleCount: results.convertibleCurrencies.length,
      converted: results.converted,
      liquidatedUSDT: results.liquidatedUSDT,
      gtReceived: results.gtReceived,
      errors: results.errors,
      sellableAssets: results.sellableBalances,
      dustAssets: results.dustBalances,
    };

    console.log('[DUST-CONVERTER] ✅ Complete:', JSON.stringify({
      dustFound: summary.dustFound,
      totalValue: summary.totalDustValue.toFixed(2),
      converted: summary.converted,
    }));

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[DUST-CONVERTER] ❌ Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
