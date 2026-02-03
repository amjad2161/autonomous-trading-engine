import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Single-cycle execution - no loops, minimal CPU usage
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
    
    console.log(`⚡ [HYPER] Single cycle (paper: ${paperMode})`);
    const startTime = Date.now();

    // Get current state
    const { data: state, error: stateError } = await supabase
      .from('trading_system_state')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (stateError) {
      console.error("⚡ [HYPER] Failed to read trading_system_state:", stateError);
    }

    let cycleCount = (state?.total_cycles || 0) + 1;
    let cumulativePnL = state?.total_pnl || 0;
    let cumulativeTrades = state?.total_trades || 0;

    // Fetch market data (single request)
    const tickersRes = await fetch('https://api.gateio.ws/api/v4/spot/tickers');
    const tickers = await tickersRes.json() as Array<{
      currency_pair: string;
      last: string;
      change_percentage: string;
      quote_volume: string;
    }>;
    
    // Filter top volatile pairs
    const pairs = tickers
      .filter(t => t.currency_pair.endsWith('_USDT') && parseFloat(t.quote_volume) > 500000)
      .map(t => ({
        symbol: t.currency_pair,
        price: parseFloat(t.last),
        change: parseFloat(t.change_percentage),
        volume: parseFloat(t.quote_volume),
      }))
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 10);
    
    // Find single best opportunity
    let trade: { symbol: string; side: 'buy' | 'sell'; edge: number; pnl: number } | null = null;
    
    for (const pair of pairs) {
      let edge = 0;
      let side: 'buy' | 'sell' = 'buy';
      
      if (pair.change > 2 && pair.change < 8) {
        edge = pair.change * 0.12;
        side = 'buy';
      } else if (pair.change < -3 && pair.change > -10) {
        edge = Math.abs(pair.change) * 0.10;
        side = 'buy';
      } else if (pair.change > 10) {
        edge = pair.change * 0.06;
        side = 'sell';
      }
      
      if (edge >= 0.15) {
        // Simulate trade result
        const won = Math.random() < 0.55;
        const pnl = won ? edge * 0.7 : -edge * 0.5;
        
        trade = { symbol: pair.symbol, side, edge, pnl };
        cumulativeTrades++;
        cumulativePnL += pnl;
        
        // Log trade
        await supabase.from('trade_history').insert({
          symbol: pair.symbol,
          side,
          type: 'hyper-scalp',
          price: pair.price,
          amount: 0.08,
          expected_edge: edge,
          actual_pnl: pnl,
          status: paperMode ? 'simulated' : 'executed',
        });
        
        console.log(`💹 ${side.toUpperCase()} ${pair.symbol} | Edge: ${edge.toFixed(2)}% | PnL: ${pnl.toFixed(2)}%`);
        break;
      }
    }

    // Update state
    const nowIso = new Date().toISOString();

    if (state?.id) {
      const { error: updateError } = await supabase
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

      if (updateError) {
        console.error("⚡ [HYPER] Failed to update trading_system_state:", updateError);
      }
    } else {
      // Fallback: if state row doesn't exist for some reason, create one.
      const { error: insertError } = await supabase
        .from('trading_system_state')
        .insert({
          is_active: true,
          total_cycles: cycleCount,
          total_trades: cumulativeTrades,
          total_pnl: cumulativePnL,
          last_heartbeat: nowIso,
          updated_at: nowIso,
        });

      if (insertError) {
        console.error("⚡ [HYPER] Failed to insert trading_system_state:", insertError);
      }
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
      marketsScanned: pairs.length,
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
