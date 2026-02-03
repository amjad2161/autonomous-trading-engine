import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'all';
    
    console.log(`\n⏰ [CRON TRIGGER] Action: ${action} | Time: ${new Date().toISOString()}`);
    
    const results: Record<string, unknown> = {
      triggered_at: new Date().toISOString(),
      action,
    };

    // Run based on action parameter
    if (action === 'all' || action === 'brain') {
      // Trigger Master Brain (main trading engine)
      const brainResponse = await supabase.functions.invoke('master-brain', {
        body: { durationSeconds: 280 }, // Run for ~5 minutes
      });
      results.master_brain = brainResponse.error ? { error: brainResponse.error.message } : brainResponse.data;
      console.log(`[CRON] Master Brain: ${brainResponse.error ? 'ERROR' : 'Started'}`);
    }

    if (action === 'all' || action === 'optimize') {
      // Trigger AI Optimizer (every call, it will decide if optimization is needed)
      const optimizerResponse = await supabase.functions.invoke('ai-optimizer', {
        body: {},
      });
      results.ai_optimizer = optimizerResponse.error ? { error: optimizerResponse.error.message } : optimizerResponse.data;
      console.log(`[CRON] AI Optimizer: ${optimizerResponse.error ? 'ERROR' : 'Complete'}`);
    }

    if (action === 'positions') {
      // Just manage positions
      const posResponse = await supabase.functions.invoke('position-manager', {
        body: { command: 'manage' },
      });
      results.position_manager = posResponse.error ? { error: posResponse.error.message } : posResponse.data;
      console.log(`[CRON] Position Manager: ${posResponse.error ? 'ERROR' : 'Complete'}`);
    }

    if (action === 'liquidate') {
      // Run auto-liquidation
      const liqResponse = await supabase.functions.invoke('auto-liquidate', {
        body: {},
      });
      results.auto_liquidate = liqResponse.error ? { error: liqResponse.error.message } : liqResponse.data;
      console.log(`[CRON] Auto Liquidate: ${liqResponse.error ? 'ERROR' : 'Complete'}`);
    }

    // Log the cron execution
    await supabase.from('system_log').insert({
      component: 'cron-trigger',
      level: 'info',
      message: `Cron executed: ${action}`,
      details: results,
    });

    console.log(`⏰ [CRON TRIGGER] Complete!`);

    return new Response(JSON.stringify({
      success: true,
      ...results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('⏰ [CRON TRIGGER] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
