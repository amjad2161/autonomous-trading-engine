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
    return JSON.parse(text);
  } catch {
    console.log(`[COLLECT] Raw response: ${text}`);
    return { error: text };
  }
}

// Currencies to keep (not liquidate to USDT)
const KEEP_CURRENCIES = ['USDT', 'USD'];
const MIN_VALUE_TO_LIQUIDATE = 0.1; // Minimum $0.10 to liquidate

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('[COLLECT-ALL] 🚀 Starting full collection & liquidation...');
    
    const results = {
      earn: { collected: 0, items: [] as string[] },
      staking: { redeemed: 0, items: [] as string[] },
      savings: { withdrawn: 0, items: [] as string[] },
      margin: { transferred: 0, items: [] as string[] },
      futures: { transferred: 0, items: [] as string[] },
      spot: { liquidated: 0, items: [] as string[] },
      errors: [] as string[],
    };

    // ===== 1. EARN PRODUCTS - Redeem all =====
    console.log('[COLLECT-ALL] 📦 Checking Earn products...');
    try {
      const earnProducts = await gateRequest('/earn/uni/lends');
      if (Array.isArray(earnProducts)) {
        for (const product of earnProducts) {
          if (parseFloat(product.amount || '0') > 0) {
            console.log(`[COLLECT-ALL] Redeeming ${product.currency} from Earn...`);
            try {
              await gateRequest('/earn/uni/lends', 'POST', {}, {
                currency: product.currency,
                amount: product.amount,
                type: 'redeem',
              });
              results.earn.collected++;
              results.earn.items.push(`${product.amount} ${product.currency}`);
            } catch (e) {
              results.errors.push(`Earn ${product.currency}: ${e}`);
            }
          }
        }
      }
    } catch (e) {
      console.log('[COLLECT-ALL] No Earn products or API not available');
    }

    // ===== 2. DUAL INVESTMENT - Redeem if possible =====
    console.log('[COLLECT-ALL] 💰 Checking Dual Investment...');
    try {
      const dualOrders = await gateRequest('/earn/dual/orders', 'GET', { status: 'EXERCISED' });
      if (Array.isArray(dualOrders)) {
        console.log(`[COLLECT-ALL] Found ${dualOrders.length} dual investment orders`);
      }
    } catch (e) {
      console.log('[COLLECT-ALL] No Dual Investment or API not available');
    }

    // ===== 3. STRUCTURED PRODUCTS =====
    console.log('[COLLECT-ALL] 📊 Checking Structured products...');
    try {
      const structuredOrders = await gateRequest('/earn/structured/orders');
      if (Array.isArray(structuredOrders)) {
        console.log(`[COLLECT-ALL] Found ${structuredOrders.length} structured orders`);
      }
    } catch (e) {
      console.log('[COLLECT-ALL] No Structured products or API not available');
    }

    // ===== 4. MARGIN ACCOUNT - Transfer to Spot =====
    console.log('[COLLECT-ALL] 📈 Checking Margin account...');
    try {
      const marginBalances = await gateRequest('/margin/accounts');
      if (Array.isArray(marginBalances)) {
        for (const account of marginBalances) {
          const available = parseFloat(account.available || '0');
          if (available > 0) {
            console.log(`[COLLECT-ALL] Transferring ${available} ${account.currency} from Margin...`);
            try {
              await gateRequest('/margin/account/book', 'POST', {}, {
                currency: account.currency,
                amount: account.available,
                from: 'margin',
                to: 'spot',
              });
              results.margin.transferred++;
              results.margin.items.push(`${account.available} ${account.currency}`);
            } catch (e) {
              results.errors.push(`Margin ${account.currency}: ${e}`);
            }
          }
        }
      }
    } catch (e) {
      console.log('[COLLECT-ALL] No Margin account or API not available');
    }

    // ===== 5. FUTURES ACCOUNT - Transfer to Spot =====
    console.log('[COLLECT-ALL] 🔮 Checking Futures account...');
    try {
      // USDT Futures
      const futuresAccounts = await gateRequest('/futures/usdt/accounts');
      if (futuresAccounts && parseFloat(futuresAccounts.available || '0') > 1) {
        console.log(`[COLLECT-ALL] Transferring ${futuresAccounts.available} USDT from Futures...`);
        try {
          await gateRequest('/wallet/transfers', 'POST', {}, {
            currency: 'USDT',
            amount: futuresAccounts.available,
            from: 'futures',
            to: 'spot',
          });
          results.futures.transferred++;
          results.futures.items.push(`${futuresAccounts.available} USDT`);
        } catch (e) {
          results.errors.push(`Futures USDT: ${e}`);
        }
      }
    } catch (e) {
      console.log('[COLLECT-ALL] No Futures account or API not available');
    }

    // ===== 6. CROSS MARGIN =====
    console.log('[COLLECT-ALL] 💳 Checking Cross Margin...');
    try {
      const crossMargin = await gateRequest('/margin/cross/accounts');
      if (crossMargin && crossMargin.balances) {
        for (const balance of crossMargin.balances) {
          const available = parseFloat(balance.available || '0');
          if (available > 0) {
            console.log(`[COLLECT-ALL] Transferring ${available} ${balance.currency} from Cross Margin...`);
            try {
              await gateRequest('/margin/cross/transfers', 'POST', {}, {
                currency: balance.currency,
                amount: balance.available,
                from: 'cross_margin',
                to: 'spot',
              });
              results.margin.transferred++;
              results.margin.items.push(`${balance.available} ${balance.currency} (cross)`);
            } catch (e) {
              results.errors.push(`Cross Margin ${balance.currency}: ${e}`);
            }
          }
        }
      }
    } catch (e) {
      console.log('[COLLECT-ALL] No Cross Margin or API not available');
    }

    // ===== 7. SMALL BALANCE CONVERT (Dust) =====
    console.log('[COLLECT-ALL] 🧹 Converting dust to GT...');
    try {
      // Get currencies that can be converted
      const convertible = await gateRequest('/wallet/small_balance');
      if (convertible && Array.isArray(convertible.currencies) && convertible.currencies.length > 0) {
        console.log(`[COLLECT-ALL] Found ${convertible.currencies.length} currencies to convert`);
        await gateRequest('/wallet/small_balance', 'POST', {}, {
          currency_pairs: convertible.currencies.map((c: string) => `${c}_GT`),
        });
        results.spot.items.push('Dust converted to GT');
      }
    } catch (e) {
      console.log('[COLLECT-ALL] No dust to convert or API not available');
    }

    // Wait for transfers to settle
    await new Promise(r => setTimeout(r, 1000));

    // ===== 8. GET ALL SPOT BALANCES & LIQUIDATE TO USDT =====
    console.log('[COLLECT-ALL] 💵 Liquidating all to USDT...');
    
    const balances = await gateRequest('/spot/accounts');
    const tickers = await gateRequest('/spot/tickers');
    const tickerMap = new Map(tickers.map((t: { currency_pair: string }) => [t.currency_pair, t]));
    
    let totalLiquidated = 0;
    
    if (Array.isArray(balances)) {
      for (const balance of balances) {
        const available = parseFloat(balance.available);
        if (available <= 0 || KEEP_CURRENCIES.includes(balance.currency)) {
          continue;
        }
        
        const usdtPair = `${balance.currency}_USDT`;
        const ticker = tickerMap.get(usdtPair) as { highest_bid: string } | undefined;
        
        if (!ticker) {
          console.log(`[COLLECT-ALL] No pair for ${balance.currency}`);
          continue;
        }
        
        const price = parseFloat(ticker.highest_bid);
        const estimatedValue = available * price;
        
        if (estimatedValue < MIN_VALUE_TO_LIQUIDATE) {
          continue;
        }
        
        console.log(`[COLLECT-ALL] Selling ${available} ${balance.currency} @ ${price} = ~$${estimatedValue.toFixed(2)}`);
        
        try {
          const order = await gateRequest('/spot/orders', 'POST', {}, {
            currency_pair: usdtPair,
            side: 'sell',
            amount: balance.available,
            price: ticker.highest_bid,
            type: 'limit',
            time_in_force: 'ioc',
          });
          
          if (order.id) {
            totalLiquidated += estimatedValue;
            results.spot.liquidated++;
            results.spot.items.push(`${balance.currency}: +$${estimatedValue.toFixed(2)}`);
          }
        } catch (e) {
          results.errors.push(`Sell ${balance.currency}: ${e}`);
        }
        
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Get final USDT balance
    const finalBalances = await gateRequest('/spot/accounts');
    const usdtBalance = finalBalances?.find?.((b: { currency: string }) => b.currency === 'USDT');
    
    const finalResult = {
      success: true,
      timestamp: Date.now(),
      summary: {
        earnRedeemed: results.earn.collected,
        marginTransferred: results.margin.transferred,
        futuresTransferred: results.futures.transferred,
        spotLiquidated: results.spot.liquidated,
        totalLiquidatedUSDT: totalLiquidated,
        finalUSDTBalance: usdtBalance ? parseFloat(usdtBalance.available) : 0,
      },
      details: results,
    };
    
    console.log('[COLLECT-ALL] ✅ Complete:', JSON.stringify(finalResult.summary));
    
    return new Response(JSON.stringify(finalResult), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[COLLECT-ALL] ❌ Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
