#!/usr/bin/env node
// =============================================================================
// preflight.mjs — one READ-ONLY command that answers "is it safe to run?"
//   npm run preflight        (works in Windows PowerShell, macOS, and Linux)
//
// A Node port of preflight.sh so it runs natively where bash is unavailable. It
// never changes a single file or setting. It inspects your config, the safety
// floor, and the core tests, then prints a clear GO / NO-GO and the exact steps
// that are yours to do.
// =============================================================================
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.chdir(join(dirname(fileURLToPath(import.meta.url)), ".."));
const isWin = process.platform === "win32";

let PASS = 0, WARN = 0, FAIL = 0;
const ok   = (s) => { console.log(`  \x1b[1;32m✓\x1b[0m ${s}`); PASS++; };
const warn = (s) => { console.log(`  \x1b[1;33m!\x1b[0m ${s}`); WARN++; };
const bad  = (s) => { console.log(`  \x1b[1;31m✗\x1b[0m ${s}`); FAIL++; };
const sect = (s) => console.log(`\n\x1b[1;36m== ${s} ==\x1b[0m`);

const has = (cmd) => {
  try { execSync(isWin ? `where ${cmd}` : `command -v ${cmd}`, { stdio: "ignore", shell: true }); return true; }
  catch { return false; }
};
const getv = (file, key) => {
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(key + "="));
  return line ? line.slice(key.length + 1) : "";
};

const ENVF = join("supabase", "functions", ".env.local");
const FEENV = ".env";

// ---- 1. tools ---------------------------------------------------------------
sect("Tools");
for (const t of ["node", "npm"]) has(t) ? ok(`${t} present`) : bad(`${t} missing`);
has("supabase") ? ok("supabase CLI present") : warn("supabase CLI missing (needed to serve locally)");
has("docker")   ? ok("docker present")        : warn("docker missing (needed for local Supabase)");
has("deno")     ? ok("deno present (can run core tests)") : warn("deno missing (core tests fall back to 'npm test' — still verified)");

// ---- 2. safety floor (server env) ------------------------------------------
sect(`Safety configuration (${ENVF})`);
if (existsSync(ENVF)) {
  ok(`${ENVF} exists`);
  const mode = getv(ENVF, "TRADING_MODE") || "DRY_RUN";
  if (mode === "DRY_RUN") {
    ok("TRADING_MODE=DRY_RUN (reads market data, never sends a live order)");
  } else if (mode === "LIVE") {
    const vp = getv(ENVF, "VALIDATION_PASSED");
    if (vp === "1" || vp === "true") warn("TRADING_MODE=LIVE and validation passed — this trades REAL money");
    else bad("TRADING_MODE=LIVE without VALIDATION_PASSED=1 — unsafe to go live");
  } else {
    warn(`TRADING_MODE='${mode}' (unrecognized; treated as non-live)`);
  }
  const ks = getv(ENVF, "KILL_SWITCH") || "0";
  ks === "0" ? ok("KILL_SWITCH=0 (engine permitted)") : warn(`KILL_SWITCH=${ks} (engine is halted)`);
  const sec = getv(ENVF, "FUNCTION_SHARED_SECRET");
  (sec && sec.length >= 16) ? ok(`FUNCTION_SHARED_SECRET set (${sec.length} chars)`)
                            : bad("FUNCTION_SHARED_SECRET missing/too short — signed calls will 401");
  for (const cap of ["MAX_TRADE_USDT", "MAX_DAILY_LOSS_USDT", "MAX_OPEN_POSITIONS"]) {
    const v = getv(ENVF, cap);
    v ? ok(`${cap}=${v}`) : warn(`${cap} unset (a built-in default applies)`);
  }
  const gk = getv(ENVF, "GATE_API_KEY"), gs = getv(ENVF, "GATE_API_SECRET");
  if (gk && gs) ok("Gate.io keys present in env");
  else if (!gk && !gs) warn("Gate.io keys not in env — type them in the dashboard (Settings); they are stored encrypted");
  else bad("Only ONE of GATE_API_KEY / GATE_API_SECRET is set — set both or clear both");
} else {
  bad(`${ENVF} missing — run: npm run setup`);
}

// ---- 3. frontend env + secret match ----------------------------------------
sect(`Frontend configuration (${FEENV})`);
if (existsSync(FEENV)) {
  ok(`${FEENV} exists`);
  const fes = getv(FEENV, "VITE_FUNCTION_SECRET");
  const sec = getv(ENVF, "FUNCTION_SHARED_SECRET");
  if (fes && sec) {
    fes === sec ? ok("VITE_FUNCTION_SECRET matches the server secret")
                : bad("secret MISMATCH — every signed call 401s. Delete BOTH env files and re-run setup");
  } else {
    warn("function secret not set on both sides yet");
  }
  getv(FEENV, "VITE_SUPABASE_URL") ? ok("VITE_SUPABASE_URL set") : warn("VITE_SUPABASE_URL unset");
} else {
  warn(`${FEENV} missing — it is created by: npm run setup`);
}

// ---- 4. core safety/strategy tests (read-only) -----------------------------
sect("Core safety & strategy tests");
const log = join(tmpdir(), "ate-preflight-tests.log");
const lastMatch = (s, re) => { const m = (s.match(re) || []); return m.length ? m[m.length - 1] : ""; };
if (has("deno")) {
  try {
    const out = execSync(`deno test -A supabase/functions/_shared`, { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
    ok(`core tests passed (${lastMatch(out, /[0-9]+ passed[^;\n]*/g) || "ok"})`);
  } catch (e) {
    bad(`core tests FAILED — output:\n${String(e.stdout || e.message).split("\n").slice(-8).join("\n")}`);
  }
} else if (has("npm") && existsSync("node_modules")) {
  // No Deno? The same safety suite runs under vitest via the Deno shim, so the
  // safety math is still verified — no need to install Deno just to check it.
  try {
    const out = execSync(`npm test --silent`, { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
    ok(`core tests passed via npm test (${lastMatch(out, /[0-9]+ passed/g) || "ok"}) — Deno not required`);
  } catch (e) {
    bad(`core tests FAILED — output:\n${String(e.stdout || e.message).split("\n").slice(-8).join("\n")}`);
  }
} else {
  warn("neither deno nor installed node_modules — core tests skipped (run: npm install)");
}

// ---- 5. local stack (optional) ---------------------------------------------
sect("Local stack (optional)");
let stackUp = false;
if (has("supabase")) {
  try { execSync("supabase status", { stdio: "ignore", shell: true }); stackUp = true; } catch { /* not running */ }
}
stackUp ? ok("local Supabase is running") : warn("local Supabase not running — start everything with: npm run setup");

// ---- verdict ----------------------------------------------------------------
sect("Verdict");
console.log(`  PASS=${PASS}   WARN=${WARN}   FAIL=${FAIL}`);
console.log(FAIL === 0
  ? "\n\x1b[1;32m✓ GO — safe to start in DRY_RUN.\x1b[0m"
  : "\n\x1b[1;31m✗ NO-GO — fix the ✗ items above before starting.\x1b[0m");

console.log(`
The three steps that are yours alone (no one else can do them):
  1) npm run setup        — brings up the whole stack on YOUR machine
  2) On Gate.io           — revoke any leaked key; create a NEW key with
                            Spot + Read ONLY (NO withdraw/transfer), IP-restricted
  3) Dashboard → Settings — paste the new key + secret → Save
                            (it verifies, encrypts, connects). DRY_RUN = reads only.

When all three are done and you want to go live, flip TRADING_MODE only after a
passing validation run — preflight will tell you if it is safe.`);

process.exit(FAIL === 0 ? 0 : 1);
