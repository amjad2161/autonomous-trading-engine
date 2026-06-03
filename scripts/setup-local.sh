#!/usr/bin/env bash
# =============================================================================
# setup-local.sh — one command to bring up the whole stack on YOUR machine.
# =============================================================================
# Installs deps, starts the local Supabase stack (Postgres + Edge Functions),
# applies migrations, and prints exactly what to do next. Idempotent-ish: safe
# to re-run. It NEVER asks for or stores your Gate.io key — that goes in a local
# .env file you create (see the printed steps).
# =============================================================================
set -euo pipefail

say() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
warn() { printf "\033[1;33m[!] %s\033[0m\n" "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { warn "Missing required tool: $1"; MISSING=1; }; }

MISSING=0
say "Checking prerequisites"
need node; need npm; need docker; need supabase
if [ "${MISSING:-0}" = "1" ]; then
  warn "Install the missing tools and re-run. (supabase CLI: https://supabase.com/docs/guides/cli)"
  exit 1
fi
echo "node $(node -v) | npm $(npm -v) | supabase $(supabase --version 2>/dev/null || echo '?')"

say "Installing dependencies (npm install)"
npm install

say "Starting local Supabase (Docker) — Postgres + Edge Functions"
supabase start

say "Applying database migrations (supabase db reset)"
supabase db reset --no-seed 2>/dev/null || supabase db reset

say "Local stack is up. Status:"
supabase status || true

cat <<'NEXT'

──────────────────────────────────────────────────────────────────────────────
NEXT STEPS (you do these — keys stay on YOUR machine, never in code):

1) Frontend env  ->  .env   (copy from .env.example; VITE_* are public)
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_PUBLISHABLE_KEY=<anon key from `supabase status`>
   VITE_FUNCTION_SECRET=<pick a long random string>

2) Server secrets ->  supabase/functions/.env.local   (gitignored)
   GATE_API_KEY=<NEW least-privilege key: spot+read, NO withdraw>
   GATE_API_SECRET=<...>
   TRADING_MODE=DRY_RUN
   FUNCTION_SHARED_SECRET=<same value as VITE_FUNCTION_SECRET>
   MAX_TRADE_USDT=15
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status`>

3) Serve functions:
   supabase functions serve --no-verify-jwt --env-file supabase/functions/.env.local

4) Run it (three terminals):
   npm run dev      # dashboard
   SUPABASE_ANON_KEY=<anon> FUNCTION_SECRET=<secret> npm run ticker   # the loop
   SUPABASE_ANON_KEY=<anon> FUNCTION_SECRET=<secret> npm run ws       # WS freshness

5) Before LIVE: run the `edge-test` function on real data; it must show a real
   out-of-sample edge. Only then set TRADING_MODE=LIVE (start with CANARY_CAPITAL_PCT=10).

Full details: docs/RUN-LOCAL.md
──────────────────────────────────────────────────────────────────────────────
NEXT
