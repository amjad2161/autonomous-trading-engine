#!/usr/bin/env node
// =============================================================================
// WS telemetry — feeds market-data freshness to INV-01 (wsStale).
// =============================================================================
// Connects to Gate.io's PUBLIC spot WebSocket on YOUR machine and sends a
// throttled "ws_heartbeat" to the config function. The orchestrator reads the
// last heartbeat time: if it goes stale (no fresh ticks within WS_STALE_MS),
// INV-01 blocks new entries. Stop this (or lose connectivity) -> the system
// fails safe and stops opening positions.
//
// Uses Node's built-in global WebSocket + fetch (Node 21+/22). No dependencies.
//
// Usage:
//   SUPABASE_ANON_KEY=<anon> FUNCTION_SECRET=<secret> node scripts/ws-telemetry.mjs
// Env:
//   SUPABASE_FUNCTIONS_URL  default http://127.0.0.1:54321/functions/v1
//   SUPABASE_ANON_KEY, FUNCTION_SECRET
//   WS_PAIRS                default "BTC_USDT,ETH_USDT,SOL_USDT"
//   HEARTBEAT_MS            default 1000 (min interval between heartbeats)
// =============================================================================

const GATE_WS = "wss://api.gateio.ws/ws/v4/";
const BASE = process.env.SUPABASE_FUNCTIONS_URL || "http://127.0.0.1:54321/functions/v1";
const ANON = process.env.SUPABASE_ANON_KEY || "";
const SECRET = process.env.FUNCTION_SECRET || "";
const PAIRS = (process.env.WS_PAIRS || "BTC_USDT,ETH_USDT,SOL_USDT").split(",").map((s) => s.trim());
const HEARTBEAT_MS = Math.max(250, Number(process.env.HEARTBEAT_MS || 1000));

if (typeof WebSocket === "undefined") {
  console.error("This script needs Node 21+ (built-in WebSocket). Upgrade Node or use a WS polyfill.");
  process.exit(1);
}

let lastBeat = 0;
async function heartbeat() {
  const now = Date.now();
  if (now - lastBeat < HEARTBEAT_MS) return;
  lastBeat = now;
  try {
    const h = { "Content-Type": "application/json" };
    if (ANON) { h["Authorization"] = `Bearer ${ANON}`; h["apikey"] = ANON; }
    if (SECRET) h["x-function-secret"] = SECRET;
    await fetch(`${BASE}/config`, { method: "POST", headers: h, body: JSON.stringify({ command: "ws_heartbeat" }) });
  } catch (e) {
    console.error(`[ws] heartbeat failed: ${e?.message || e}`);
  }
}

function connect() {
  console.log(`[ws] connecting ${GATE_WS}  pairs=${PAIRS.join(",")}`);
  const ws = new WebSocket(GATE_WS);

  ws.addEventListener("open", () => {
    console.log("[ws] open — subscribing book_ticker");
    ws.send(JSON.stringify({
      time: Math.floor(Date.now() / 1000),
      channel: "spot.book_ticker",
      event: "subscribe",
      payload: PAIRS,
    }));
  });

  ws.addEventListener("message", (ev) => {
    // Any market update = the feed is fresh -> heartbeat (throttled).
    try {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.event === "update" || msg.channel === "spot.book_ticker") heartbeat();
    } catch { /* ignore non-JSON */ }
  });

  ws.addEventListener("close", () => {
    console.warn("[ws] closed — reconnecting in 3s (freshness will go stale -> INV-01 blocks entries)");
    setTimeout(connect, 3000);
  });
  ws.addEventListener("error", (e) => {
    console.error(`[ws] error: ${e?.message || "socket error"}`);
    try { ws.close(); } catch { /* noop */ }
  });
}

process.on("SIGINT", () => { console.log("\n[ws] stopping. Freshness will go stale and the system will stop opening entries."); process.exit(0); });
connect();
