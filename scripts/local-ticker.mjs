#!/usr/bin/env node
// =============================================================================
// Local ticker — drives the autonomous loop on YOUR machine.
// =============================================================================
// In the cloud, a Supabase "scheduler" function re-triggers the orchestrator.
// When you run everything locally, this tiny script plays that role: it invokes
// the orchestrator's `cycle` command every TICK_SECONDS against your local
// `supabase functions serve` endpoint. Stop it (Ctrl-C) to halt — it's your box.
//
// Usage:
//   node scripts/local-ticker.mjs            # uses env / defaults below
//   TICK_SECONDS=15 node scripts/local-ticker.mjs
//
// Env (all optional, sensible local defaults):
//   SUPABASE_FUNCTIONS_URL  default http://127.0.0.1:54321/functions/v1
//   SUPABASE_ANON_KEY       local anon key from `supabase start` output
//   FUNCTION_SECRET         must match FUNCTION_SHARED_SECRET on the server
//   TICK_SECONDS            default 30
// =============================================================================

const BASE = process.env.SUPABASE_FUNCTIONS_URL || "http://127.0.0.1:54321/functions/v1";
const ANON = process.env.SUPABASE_ANON_KEY || "";
const SECRET = process.env.FUNCTION_SECRET || "";
const TICK = Math.max(5, Number(process.env.TICK_SECONDS || 30)) * 1000;

function headers() {
  const h = { "Content-Type": "application/json" };
  if (ANON) { h["Authorization"] = `Bearer ${ANON}`; h["apikey"] = ANON; }
  if (SECRET) h["x-function-secret"] = SECRET;
  return h;
}

async function invoke(fn, body) {
  const res = await fetch(`${BASE}/${fn}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

let running = true;
process.on("SIGINT", () => { running = false; console.log("\n[ticker] stopping…"); });
process.on("SIGTERM", () => { running = false; });

async function main() {
  console.log(`[ticker] target=${BASE}  interval=${TICK / 1000}s  secret=${SECRET ? "set" : "MISSING"}`);
  // Make sure the loop is started (idempotent).
  const start = await invoke("autonomous-orchestrator", { command: "start" });
  console.log(`[ticker] start -> ${start.status}`);

  while (running) {
    const t0 = Date.now();
    try {
      const r = await invoke("autonomous-orchestrator", { command: "cycle" });
      const k = r.data?.kpis;
      console.log(`[${new Date().toISOString()}] cycle ${r.status}` + (k ? ` | trades=${k.count} pnl=${k.totalPnlUsdt} pf=${k.profitFactor}` : ""));
      if (Array.isArray(r.data?.alerts) && r.data.alerts.length) {
        for (const a of r.data.alerts) console.warn(`   ⚠️ ${a.level}: ${a.message}`);
      }
    } catch (e) {
      console.error(`[ticker] cycle error: ${e?.message || e}`);
    }
    const elapsed = Date.now() - t0;
    await new Promise((r) => setTimeout(r, Math.max(0, TICK - elapsed)));
  }

  // On stop, leave the system in a safe state (orchestrator keeps its own state;
  // flip is_active off so nothing acts until you start again).
  const stop = await invoke("autonomous-orchestrator", { command: "stop" });
  console.log(`[ticker] stop -> ${stop.status}. Bye.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
