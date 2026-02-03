import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TradeStats {
  strategy: string;
  totalTrades: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  avgHoldTime: number;
  bestTrade: number;
  worstTrade: number;
}

interface PerformanceAnalysis {
  overallWinRate: number;
  totalPnl: number;
  strategyStats: TradeStats[];
  patterns: {
    bestTimeOfDay: string;
    bestRegime: string;
    worstRegime: string;
    avgTradesPerDay: number;
  };
  recommendations: string[];
  parameterAdjustments: Record<string, number>;
}

// ============ AI ANALYSIS ============
async function analyzeWithAI(
  stats: TradeStats[],
  recentTrades: Array<{ symbol: string; type: string; side: string; actual_pnl: number; created_at: string }>,
  currentConfig: Record<string, unknown>
): Promise<{ analysis: string; adjustments: Record<string, number> }> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  if (!LOVABLE_API_KEY) {
    console.log('[AI Optimizer] No Lovable API key, using rule-based optimization');
    return ruleBasedOptimization(stats);
  }

  const prompt = `You are a trading strategy optimizer AI. Analyze this trading performance data and suggest parameter adjustments.

## Current Strategy Statistics:
${stats.map(s => `
- ${s.strategy}: ${s.totalTrades} trades, ${(s.winRate * 100).toFixed(1)}% win rate, $${s.totalPnl.toFixed(2)} total PnL, avg $${s.avgPnl.toFixed(2)} per trade
`).join('')}

## Recent Trades (last 50):
${recentTrades.slice(0, 20).map(t => `${t.type} ${t.symbol}: $${(t.actual_pnl || 0).toFixed(2)}`).join(', ')}

## Current Configuration:
${JSON.stringify(currentConfig, null, 2)}

Based on this data, provide:
1. A brief analysis of what's working and what's not (2-3 sentences)
2. Specific parameter adjustments as a JSON object

Respond ONLY with a JSON object in this exact format:
{
  "analysis": "Your brief analysis here",
  "adjustments": {
    "momentum_allocation": 0.35,
    "whale_allocation": 0.25,
    "grid_allocation": 0.15,
    "dca_allocation": 0.25,
    "take_profit_multiplier": 1.1,
    "stop_loss_multiplier": 0.95,
    "min_edge_threshold": 0.4,
    "max_position_size": 0.12
  }
}

Only include adjustments for parameters that need changing. Values should be realistic (allocations sum to 1.0, multipliers between 0.8-1.5).`;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a quantitative trading analyst. Respond only with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.error('[AI Optimizer] AI request failed:', response.status);
      return ruleBasedOptimization(stats);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        analysis: parsed.analysis || 'AI analysis completed',
        adjustments: parsed.adjustments || {},
      };
    }
    
    return ruleBasedOptimization(stats);
  } catch (e) {
    console.error('[AI Optimizer] AI error:', e);
    return ruleBasedOptimization(stats);
  }
}

function ruleBasedOptimization(stats: TradeStats[]): { analysis: string; adjustments: Record<string, number> } {
  const adjustments: Record<string, number> = {};
  const analyses: string[] = [];
  
  for (const stat of stats) {
    if (stat.totalTrades < 5) continue;
    
    // Reduce allocation for losing strategies
    if (stat.winRate < 0.4) {
      adjustments[`${stat.strategy}_allocation`] = Math.max(0.05, 0.15 - (0.4 - stat.winRate) * 0.5);
      analyses.push(`${stat.strategy} underperforming (${(stat.winRate * 100).toFixed(0)}% win rate)`);
    }
    
    // Increase allocation for winning strategies
    if (stat.winRate > 0.6 && stat.avgPnl > 0) {
      adjustments[`${stat.strategy}_allocation`] = Math.min(0.5, 0.3 + (stat.winRate - 0.6) * 0.5);
      analyses.push(`${stat.strategy} performing well (${(stat.winRate * 100).toFixed(0)}% win rate)`);
    }
    
    // Adjust TP/SL based on avg PnL
    if (stat.avgPnl < -0.5) {
      adjustments['stop_loss_multiplier'] = 0.9; // Tighter stops
    }
    if (stat.bestTrade > stat.avgPnl * 3) {
      adjustments['take_profit_multiplier'] = 1.15; // Let winners run more
    }
  }
  
  return {
    analysis: analyses.length > 0 ? analyses.join('. ') : 'Insufficient data for analysis',
    adjustments,
  };
}

// ============ MAIN HANDLER ============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    console.log('\n🤖 [AI OPTIMIZER] Starting performance analysis...');
    
    // Fetch recent trades
    const { data: trades, error: tradesError } = await supabase
      .from('trade_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    
    if (tradesError) throw tradesError;
    
    if (!trades || trades.length < 10) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Not enough trade history for analysis (need at least 10 trades)',
        tradesCount: trades?.length || 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`[AI Optimizer] Analyzing ${trades.length} trades...`);
    
    // Calculate statistics by strategy
    const strategyMap = new Map<string, { wins: number; losses: number; pnls: number[]; holdTimes: number[] }>();
    
    for (const trade of trades) {
      const strategy = trade.type || 'unknown';
      const pnl = trade.actual_pnl || 0;
      
      if (!strategyMap.has(strategy)) {
        strategyMap.set(strategy, { wins: 0, losses: 0, pnls: [], holdTimes: [] });
      }
      
      const stats = strategyMap.get(strategy)!;
      stats.pnls.push(pnl);
      
      if (pnl > 0) stats.wins++;
      else stats.losses++;
    }
    
    // Build stats array
    const strategyStats: TradeStats[] = [];
    
    for (const [strategy, data] of strategyMap) {
      const total = data.wins + data.losses;
      const totalPnl = data.pnls.reduce((a, b) => a + b, 0);
      
      strategyStats.push({
        strategy,
        totalTrades: total,
        winRate: total > 0 ? data.wins / total : 0,
        avgPnl: total > 0 ? totalPnl / total : 0,
        totalPnl,
        avgHoldTime: 0,
        bestTrade: Math.max(...data.pnls, 0),
        worstTrade: Math.min(...data.pnls, 0),
      });
    }
    
    // Get current config from system state
    const { data: systemState } = await supabase
      .from('trading_system_state')
      .select('settings')
      .eq('id', 'master-brain')
      .single();
    
    const currentConfig = systemState?.settings || {};
    
    // Run AI analysis
    const { analysis, adjustments } = await analyzeWithAI(strategyStats, trades, currentConfig);
    
    console.log(`[AI Optimizer] Analysis: ${analysis}`);
    console.log(`[AI Optimizer] Adjustments:`, adjustments);
    
    // Calculate overall metrics
    const overallWinRate = trades.filter(t => (t.actual_pnl || 0) > 0).length / trades.length;
    const totalPnl = trades.reduce((sum, t) => sum + (t.actual_pnl || 0), 0);
    
    // Save optimization results
    const optimizationResult = {
      timestamp: new Date().toISOString(),
      tradesAnalyzed: trades.length,
      overallWinRate,
      totalPnl,
      strategyStats,
      aiAnalysis: analysis,
      adjustments,
    };
    
    // Update system state with new optimized settings
    if (Object.keys(adjustments).length > 0) {
      const newSettings = {
        ...currentConfig,
        optimized: true,
        lastOptimization: new Date().toISOString(),
        ...adjustments,
      };
      
      await supabase.from('trading_system_state').upsert({
        id: 'master-brain',
        settings: newSettings,
        updated_at: new Date().toISOString(),
      });
      
      console.log('[AI Optimizer] Settings updated successfully');
    }
    
    // Log to system_log
    await supabase.from('system_log').insert({
      component: 'ai-optimizer',
      level: 'info',
      message: `AI optimization complete: ${analysis}`,
      details: optimizationResult,
    });
    
    console.log('\n🤖 [AI OPTIMIZER] Analysis complete!');
    console.log(`   Win Rate: ${(overallWinRate * 100).toFixed(1)}%`);
    console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`   Adjustments: ${Object.keys(adjustments).length} parameters updated`);

    return new Response(JSON.stringify({
      success: true,
      analysis: {
        overallWinRate,
        totalPnl,
        tradesAnalyzed: trades.length,
        strategyStats,
      },
      aiAnalysis: analysis,
      adjustments,
      message: Object.keys(adjustments).length > 0 
        ? `Applied ${Object.keys(adjustments).length} parameter adjustments`
        : 'No adjustments needed at this time',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('🤖 [AI OPTIMIZER] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
