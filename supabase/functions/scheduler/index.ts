import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

async function runSchedulerLoop(durationSeconds: number, intervalSeconds: number, mode: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const startTime = Date.now();
  const endTime = startTime + (durationSeconds * 1000);
  let cycleCount = 0;
  
  console.log(`[Scheduler] Starting ${durationSeconds}s loop with ${intervalSeconds}s intervals (mode: ${mode})`);
  
  while (Date.now() < endTime) {
    cycleCount++;
    
    try {
      if (mode === 'micro' || mode === 'hybrid') {
        // Call micro-scalper for high-frequency trading
        const { data: microData, error: microError } = await supabase.functions.invoke('micro-scalper', {
          body: { durationSeconds: Math.min(intervalSeconds - 2, 28) },
        });
        
        if (microError) {
          console.error(`[Scheduler] Micro-scalper error:`, microError);
        } else {
          console.log(`[Scheduler] Micro-scalper: ${microData?.message || 'started'}`);
        }
      }
      
      if (mode === 'standard' || mode === 'hybrid') {
        // Call the orchestrator for standard trading
        const { data: orchData, error: orchError } = await supabase.functions.invoke('autonomous-orchestrator', {
          body: { command: 'cycle' },
        });
        
        if (orchError) {
          console.error(`[Scheduler] Orchestrator error:`, orchError);
        } else if (orchData?.success === false && orchData?.error?.includes('stopped')) {
          console.log('[Scheduler] System stopped, ending loop');
          break;
        } else {
          console.log(`[Scheduler] Orchestrator: E:${orchData?.entries || 0} X:${orchData?.exits || 0} | $${orchData?.balance?.toFixed(2) || 'N/A'}`);
        }
      }
      
      // Call position manager for trailing stops and TPs
      const { data: posData, error: posError } = await supabase.functions.invoke('position-manager', {
        body: { command: 'manage' },
      });
      
      if (posError) {
        console.error(`[Scheduler] Position manager error:`, posError);
      } else if (posData?.tpResults?.pnl) {
        console.log(`[Scheduler] Position manager: Stops:${posData.stopUpdates?.length || 0} TPs:${posData.tpTriggers?.length || 0} P&L:$${posData.tpResults.pnl.toFixed(2)}`);
      }
      
    } catch (err) {
      console.error(`[Scheduler] Error:`, err);
    }
    
    // Wait for next interval
    if (Date.now() < endTime) {
      await new Promise(r => setTimeout(r, intervalSeconds * 1000));
    }
  }
  
  console.log(`[Scheduler] Loop finished after ${cycleCount} cycles`);
  return { cyclesCompleted: cycleCount, duration: Date.now() - startTime };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const durationMinutes = body.durationMinutes || 60;
    const intervalSeconds = body.intervalSeconds || 15; // Faster default - 15 seconds
    const mode = body.mode || 'micro'; // 'micro', 'standard', or 'hybrid'
    
    // Calculate total duration in seconds (max 10 minutes per function call)
    const maxDurationSeconds = Math.min(durationMinutes * 60, 600);
    
    console.log(`[Scheduler] Starting for ${maxDurationSeconds}s with ${intervalSeconds}s intervals (mode: ${mode})`);
    
    // Start the background loop
    EdgeRuntime.waitUntil(runSchedulerLoop(maxDurationSeconds, intervalSeconds, mode));
    
    // Return immediately while loop runs in background
    return new Response(JSON.stringify({
      success: true,
      message: `Scheduler started for ${maxDurationSeconds} seconds with ${intervalSeconds}s intervals`,
      mode,
      estimatedCycles: Math.floor(maxDurationSeconds / intervalSeconds),
      note: 'Micro-scalping mode enabled for high-frequency trading',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[Scheduler] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});