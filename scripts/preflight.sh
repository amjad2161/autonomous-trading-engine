#!/usr/bin/env bash
# =============================================================================
# preflight.sh — one READ-ONLY command that answers "is it safe to run?"
#   npm run preflight   (or: bash scripts/preflight.sh)
#
# It never changes a single file or setting. It inspects your config, the safety
# floor, and the core tests, then prints a clear GO / NO-GO and the exact steps
# that are yours to do. This closes the gap between "code is ready" and "I can
# see it's ready" before any money is involved.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0; WARN=0; FAIL=0
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  \033[1;33m!\033[0m %s\n" "$1"; WARN=$((WARN+1)); }
bad()  { printf "  \033[1;31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
sect() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
getv() { grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2-; }

ENVF="supabase/functions/.env.local"
FEENV=".env"

# ---- 1. tools ---------------------------------------------------------------
sect "Tools"
for t in node npm; do command -v "$t" >/dev/null 2>&1 && ok "$t present" || bad "$t missing"; done
command -v supabase >/dev/null 2>&1 && ok "supabase CLI present" || warn "supabase CLI missing (needed to serve locally)"
command -v docker   >/dev/null 2>&1 && ok "docker present"        || warn "docker missing (needed for local Supabase)"
command -v deno     >/dev/null 2>&1 && ok "deno present (can run core tests)" || warn "deno missing (core tests will be skipped)"

# ---- 2. safety floor (server env) ------------------------------------------
sect "Safety configuration ($ENVF)"
if [ -f "$ENVF" ]; then
  ok "$ENVF exists"
  MODE="$(getv TRADING_MODE "$ENVF")"; MODE="${MODE:-DRY_RUN}"
  if [ "$MODE" = "DRY_RUN" ]; then
    ok "TRADING_MODE=DRY_RUN (reads market data, never sends a live order)"
  elif [ "$MODE" = "LIVE" ]; then
    VP="$(getv VALIDATION_PASSED "$ENVF")"
    if [ "$VP" = "1" ] || [ "$VP" = "true" ]; then
      warn "TRADING_MODE=LIVE and validation passed — this trades REAL money"
    else
      bad  "TRADING_MODE=LIVE without VALIDATION_PASSED=1 — unsafe to go live"
    fi
  else
    warn "TRADING_MODE='$MODE' (unrecognized; treated as non-live)"
  fi
  KS="$(getv KILL_SWITCH "$ENVF")"
  if [ "${KS:-0}" = "0" ]; then ok "KILL_SWITCH=0 (engine permitted)"; else warn "KILL_SWITCH=$KS (engine is halted)"; fi
  SEC="$(getv FUNCTION_SHARED_SECRET "$ENVF")"
  if [ -n "$SEC" ] && [ "${#SEC}" -ge 16 ]; then ok "FUNCTION_SHARED_SECRET set (${#SEC} chars)"; else bad "FUNCTION_SHARED_SECRET missing/too short — signed calls will 401"; fi
  for cap in MAX_TRADE_USDT MAX_DAILY_LOSS_USDT MAX_OPEN_POSITIONS; do
    v="$(getv "$cap" "$ENVF")"; if [ -n "$v" ]; then ok "$cap=$v"; else warn "$cap unset (a built-in default applies)"; fi
  done
  GK="$(getv GATE_API_KEY "$ENVF")"; GS="$(getv GATE_API_SECRET "$ENVF")"
  if [ -n "$GK" ] && [ -n "$GS" ]; then
    ok "Gate.io keys present in env"
  elif [ -z "$GK" ] && [ -z "$GS" ]; then
    warn "Gate.io keys not in env — type them in the dashboard (Settings); they are stored encrypted"
  else
    bad "Only ONE of GATE_API_KEY / GATE_API_SECRET is set — set both or clear both"
  fi
else
  bad "$ENVF missing — run: npm run setup"
fi

# ---- 3. frontend env + secret match ----------------------------------------
sect "Frontend configuration ($FEENV)"
if [ -f "$FEENV" ]; then
  ok "$FEENV exists"
  FES="$(getv VITE_FUNCTION_SECRET "$FEENV")"
  SEC="$(getv FUNCTION_SHARED_SECRET "$ENVF")"
  if [ -n "$FES" ] && [ -n "$SEC" ]; then
    if [ "$FES" = "$SEC" ]; then ok "VITE_FUNCTION_SECRET matches the server secret"; else bad "secret MISMATCH — every signed call 401s. Delete BOTH env files and re-run setup"; fi
  else
    warn "function secret not set on both sides yet"
  fi
  [ -n "$(getv VITE_SUPABASE_URL "$FEENV")" ] && ok "VITE_SUPABASE_URL set" || warn "VITE_SUPABASE_URL unset"
else
  warn "$FEENV missing — it is created by: npm run setup"
fi

# ---- 4. core safety/strategy tests (read-only) -----------------------------
sect "Core safety & strategy tests"
if command -v deno >/dev/null 2>&1; then
  if deno test -A supabase/functions/_shared >/tmp/ate-preflight-tests.log 2>&1; then
    ok "core tests passed ($(grep -Eo '[0-9]+ passed[^;]*' /tmp/ate-preflight-tests.log | tail -1))"
  else
    bad "core tests FAILED — inspect /tmp/ate-preflight-tests.log"
  fi
else
  warn "deno not installed — core tests skipped (install Deno to verify the safety math)"
fi

# ---- 5. local stack (optional) ---------------------------------------------
sect "Local stack (optional)"
if command -v supabase >/dev/null 2>&1 && supabase status >/dev/null 2>&1; then
  ok "local Supabase is running"
else
  warn "local Supabase not running — start everything with: npm run setup"
fi

# ---- verdict ----------------------------------------------------------------
sect "Verdict"
printf "  PASS=%d   WARN=%d   FAIL=%d\n" "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -eq 0 ]; then
  printf "\n\033[1;32m✓ GO — safe to start in DRY_RUN.\033[0m\n"
else
  printf "\n\033[1;31m✗ NO-GO — fix the ✗ items above before starting.\033[0m\n"
fi

cat <<'NEXT'

The three steps that are yours alone (no one else can do them):
  1) npm run setup        — brings up the whole stack on YOUR machine
  2) On Gate.io           — revoke any leaked key; create a NEW key with
                            Spot + Read ONLY (NO withdraw/transfer), IP-restricted
  3) Dashboard → Settings — paste the new key + secret → Save
                            (it verifies, encrypts, connects). DRY_RUN = reads only.

When all three are done and you want to go live, flip TRADING_MODE only after a
passing validation run — preflight will tell you if it is safe.
NEXT

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
