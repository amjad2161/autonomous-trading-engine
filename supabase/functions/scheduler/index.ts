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

type SchedulerMode = 'hybrid' | 'micro' | 'standard' | 'ultimate';

async function runSchedulerLoop(durationSeconds: number, intervalSeconds: number, mode: SchedulerMode) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const startTime = Date.now();
  const endTime = startTime + (durationSeconds * 1000);
  let cycleCount = 0;
  
  console.log(`[Scheduler] Starting ${durationSeconds}s loop with ${intervalSeconds}s intervals (mode: ${mode})`);
  
  while (Date.now() < endTime) {
    cycleCount++;
    
    try {
      // ========== ULTIMATE MODE - All strategies combined ==========
      if (mode === 'ultimate') {
        const remainingTime = Math.floor((endTime - Date.now()) / 1000);
        const sessionDuration = Math.min(remainingTime - 5, intervalSeconds - 2, 58);
        
        if (sessionDuration > 10) {
          const { data: ultimateData, error: ultimateError } = await supabase.functions.invoke('ultimate-trader', {
            body: { durationSeconds: sessionDuration },
          });
          
          if (ultimateError) {
            console.error(`[Scheduler] Ultimate trader error:`, ultimateError);
          } else {
            console.log(`[Scheduler] Ultimate: ${ultimateData?.totalTrades || 0} trades | PnL: ${ultimateData?.totalPnL?.toFixed(2) || '0'}%`);
          }
        }
      }
      
      // ========== MICRO MODE - High frequency scalping ==========
      if (mode === 'micro' || mode === 'hybrid') {
        const { data: microData, error: microError } = await supabase.functions.invoke('micro-scalper', {
          body: { durationSeconds: Math.min(intervalSeconds - 2, 28) },
        });
        
        if (microError) {
          console.error(`[Scheduler] Micro-scalper error:`, microError);
        } else {
          console.log(`[Scheduler] Micro-scalper: ${microData?.message || 'started'}`);
        }
      }
      
      // ========== STANDARD MODE - Orchestrator ==========
      if (mode === 'standard' || mode === 'hybrid') {
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
      
      // ========== POSITION MANAGER - Always runs ==========
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
    
    // Wait for next interval (shorter for ultimate mode)
    if (Date.now() < endTime) {
      const waitTime = mode === 'ultimate' ? Math.min(intervalSeconds, 60) : intervalSeconds;
      await new Promise(r => setTimeout(r, waitTime * 1000));
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
    const intervalSeconds = body.intervalSeconds || 15;
    const mode: SchedulerMode = body.mode || 'ultimate'; // Default to ultimate mode!
    
    // Calculate total duration in seconds (max 10 minutes per function call)
    const maxDurationSeconds = Math.min(durationMinutes * 60, 600);
    
    console.log(`[Scheduler] Starting for ${maxDurationSeconds}s with ${intervalSeconds}s intervals (mode: ${mode})`);
    
    // Start the background loop
    EdgeRuntime.waitUntil(runSchedulerLoop(maxDurationSeconds, intervalSeconds, mode));
    
    const modeDescriptions: Record<SchedulerMode, string> = {
      ultimate: '🚀 All strategies: Whale Tracking + Grid Trading + Smart DCA + Momentum',
      hybrid: 'Micro-scalping + Orchestrator combined',
      micro: 'High-frequency micro-scalping only',
      standard: 'Standard orchestrator only',
    };
    
    return new Response(JSON.stringify({
      success: true,
      message: `Scheduler started for ${maxDurationSeconds} seconds with ${intervalSeconds}s intervals`,
      mode,
      modeDescription: modeDescriptions[mode],
      estimatedCycles: Math.floor(maxDurationSeconds / intervalSeconds),
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