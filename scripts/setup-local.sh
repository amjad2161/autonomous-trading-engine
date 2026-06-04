#!/usr/bin/env bash
# =============================================================================
# setup-local.sh — one command to bring up the whole stack on YOUR machine.
#   bash scripts/setup-local.sh
# After it finishes you only open http://localhost:5173 -> Settings -> paste keys.
#
# Idempotent: NEVER overwrites your env files or your saved keys (uses
# `migration up`, not a wiping `db reset`). Gate.io keys are NOT entered here —
# you type them in the dashboard (verified + stored encrypted locally).
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
warn() { printf "\033[1;33m[!] %s\033[0m\n" "$1"; }
ok()   { printf "\033[1;32m%s\033[0m\n" "$1"; }

# ---- 0. prerequisites -------------------------------------------------------
MISSING=0
need() { command -v "$1" >/dev/null 2>&1 || { warn "Missing: $1  ($2)"; MISSING=1; }; }
say "Checking prerequisites"
need node     "Node 18+: https://nodejs.org"
need npm      "comes with Node"
need docker   "Docker Desktop: https://www.docker.com/products/docker-desktop"
need supabase "Supabase CLI: https://supabase.com/docs/guides/cli"
[ "${MISSING:-0}" = "1" ] && { warn "Install the tools above, then re-run."; exit 1; }
docker info >/dev/null 2>&1 || { warn "Docker is installed but not running — start Docker Desktop and re-run."; exit 1; }
echo "node $(node -v) | supabase $(supabase --version 2>/dev/null || echo '?')"

# ---- 1. dependencies --------------------------------------------------------
say "Installing dependencies (npm install)"
npm install

rand_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; fi
}

# ---- 2. server env (.env.local) — created once, never overwritten -----------
ENVF="supabase/functions/.env.local"
if [ ! -f "$ENVF" ]; then
  say "Creating $ENVF (DRY_RUN; Gate.io keys go in the dashboard, not here)"
  cat > "$ENVF" <<EOF
TRADING_MODE=DRY_RUN
KILL_SWITCH=0
MAX_TRADE_USDT=15
MAX_DAILY_LOSS_USDT=15
MAX_OPEN_POSITIONS=2
FUNCTION_SHARED_SECRET=$(rand_secret)
GATE_API_KEY=
GATE_API_SECRET=
EOF
else
  say "$ENVF exists — keeping it (your keys are safe)."
fi

# ---- 3. start local Supabase + apply migrations (no wipe) --------------------
say "Starting local Supabase (Docker) — first run pulls images, be patient"
supabase start
say "Applying migrations"
supabase migration up 2>/dev/null || warn "migration up unavailable; if tables are missing run 'supabase db reset' once (note: that clears local data)."

# capture local keys (robust JSON parse with safe fallbacks)
parse() { supabase status -o json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)['$1']||'')}catch{console.log('')}})"; }
API_URL="$(parse API_URL)"; [ -z "$API_URL" ] && API_URL="http://127.0.0.1:54321"
ANON="$(parse ANON_KEY)"
SRK="$(parse SERVICE_ROLE_KEY)"
SECRET="$(grep -E '^FUNCTION_SHARED_SECRET=' "$ENVF" | head -1 | cut -d= -f2-)"

grep -q '^SUPABASE_URL=' "$ENVF"              || echo "SUPABASE_URL=$API_URL" >> "$ENVF"
grep -q '^SUPABASE_SERVICE_ROLE_KEY=' "$ENVF" || echo "SUPABASE_SERVICE_ROLE_KEY=$SRK" >> "$ENVF"

# ---- 4. frontend env (.env) — created once ----------------------------------
if [ ! -f ".env" ]; then
  say "Creating frontend .env"
  cat > .env <<EOF
VITE_SUPABASE_URL=$API_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON
VITE_SUPABASE_PROJECT_ID=local
VITE_FUNCTION_SECRET=$SECRET
EOF
else
  say ".env exists — keeping it."
fi

# ---- 5. serve functions (background) + dashboard (foreground) ----------------
say "Serving edge functions in the background (logs: /tmp/ate-functions.log)"
supabase functions serve --no-verify-jwt --env-file "$ENVF" >/tmp/ate-functions.log 2>&1 &
FN_PID=$!
trap 'kill $FN_PID 2>/dev/null || true' EXIT

printf "\n"; ok "✓ Ready."
cat <<'NEXT'
   1) Open:      http://localhost:5173
   2) Settings:  paste your NEW Gate.io key + secret -> Save
                 (it verifies, encrypts, and connects). DRY_RUN = reads, never trades.
   3) Autopilot: turn it ON to watch it shadow-trade on real data.

   First create a least-privilege key (spot+read, NO withdraw) and revoke any old one.
NEXT
say "Starting the dashboard (Ctrl-C stops everything)…"
npm run dev
