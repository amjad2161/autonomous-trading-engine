import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This function runs a continuous loop, calling the orchestrator every N seconds
// Use EdgeRuntime.waitUntil() to keep running in background

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

async function runSchedulerLoop(durationSeconds: number, intervalSeconds: number) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const startTime = Date.now();
  const endTime = startTime + (durationSeconds * 1000);
  let cycleCount = 0;
  
  console.log(`[Scheduler] Starting ${durationSeconds}s loop with ${intervalSeconds}s intervals`);
  
  while (Date.now() < endTime) {
    cycleCount++;
    console.log(`[Scheduler] Cycle ${cycleCount}...`);
    
    try {
      // Call the orchestrator
      const { data, error } = await supabase.functions.invoke('autonomous-orchestrator', {
        body: { command: 'cycle' },
      });
      
      if (error) {
        console.error(`[Scheduler] Orchestrator error:`, error);
      } else if (data?.success === false && data?.error?.includes('stopped')) {
        console.log('[Scheduler] System stopped, ending loop');
        break;
      } else {
        console.log(`[Scheduler] Cycle ${cycleCount} complete. Balance: $${data?.balance?.toFixed(2) || 'N/A'}`);
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
    const durationMinutes = body.durationMinutes || 60; // Default 1 hour
    const intervalSeconds = body.intervalSeconds || 30; // Default 30 seconds
    
    // Calculate total duration in seconds (max 10 minutes per function call due to limits)
    const maxDurationSeconds = Math.min(durationMinutes * 60, 600); // Cap at 10 minutes
    
    console.log(`[Scheduler] Starting scheduler for ${maxDurationSeconds}s with ${intervalSeconds}s intervals`);
    
    // Start the background loop
    EdgeRuntime.waitUntil(runSchedulerLoop(maxDurationSeconds, intervalSeconds));
    
    // Return immediately while loop runs in background
    return new Response(JSON.stringify({
      success: true,
      message: `Scheduler started for ${maxDurationSeconds} seconds with ${intervalSeconds}s intervals`,
      estimatedCycles: Math.floor(maxDurationSeconds / intervalSeconds),
      note: 'System will run autonomously. Check status with orchestrator "status" command.',
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
