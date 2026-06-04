#!/usr/bin/env node
// =============================================================================
// setup-local.mjs — cross-platform "one command to bring up the whole stack".
//   npm run setup            (works in Windows PowerShell, macOS, and Linux)
//
// A Node port of setup-local.sh so it runs natively where bash is unavailable
// (notably Windows PowerShell). Same behavior and same safety guarantees:
//   • Idempotent: NEVER overwrites your env files or saved keys.
//   • Gate.io keys are NOT entered here — you type them in the dashboard, where
//     they are verified and stored encrypted locally.
//   • Defaults to DRY_RUN (reads real data, places no live orders).
// =============================================================================
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync, openSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const isWin = process.platform === "win32";

const say  = (s) => console.log(`\n\x1b[1;36m==> ${s}\x1b[0m`);
const warn = (s) => console.log(`\x1b[1;33m[!] ${s}\x1b[0m`);
const ok   = (s) => console.log(`\x1b[1;32m${s}\x1b[0m`);
const die  = (s) => { warn(s); process.exit(1); };

// Resolve a command on PATH cross-platform without throwing.
function has(cmd) {
  try {
    execSync(isWin ? `where ${cmd}` : `command -v ${cmd}`, { stdio: "ignore", shell: true });
    return true;
  } catch { return false; }
}
function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", shell: true, ...opts });
}
function capture(cmd) {
  try { return execSync(cmd, { encoding: "utf8", shell: true }); } catch { return ""; }
}

// ---- 0. prerequisites -------------------------------------------------------
say("Checking prerequisites");
const missing = [];
if (!has("node"))     missing.push("Node 18+: https://nodejs.org");
if (!has("npm"))      missing.push("npm (comes with Node)");
if (!has("docker"))   missing.push("Docker Desktop: https://www.docker.com/products/docker-desktop");
if (!has("supabase")) missing.push("Supabase CLI: https://supabase.com/docs/guides/cli");
if (missing.length) {
  warn("Missing prerequisites:");
  for (const m of missing) console.log("    - " + m);
  die("Install the tools above, then re-run:  npm run setup");
}
try { execSync("docker info", { stdio: "ignore", shell: true }); }
catch { die("Docker is installed but not running — start Docker Desktop and re-run."); }
ok(`node ${capture("node -v").trim()} | supabase ${capture("supabase --version").trim() || "?"}`);

// ---- 1. dependencies --------------------------------------------------------
say("Installing dependencies");
// Prefer `npm ci`: it installs strictly from package-lock.json and never
// REWRITES it, so it can't dirty the git tree and make the next `git pull` fail
// with "local changes would be overwritten" (a silent trap that strands users on
// stale code). Fall back to `npm install` if the lockfile is missing/out of sync.
if (existsSync("package-lock.json")) {
  try { run("npm ci"); }
  catch { warn("npm ci failed (lockfile out of sync?) — falling back to npm install"); run("npm install"); }
} else {
  run("npm install");
}

const randSecret = () => randomBytes(32).toString("hex");

// ---- 2. server env (.env.local) — created once, never overwritten -----------
const ENVF = join("supabase", "functions", ".env.local");
if (!existsSync(ENVF)) {
  say(`Creating ${ENVF} (DRY_RUN; Gate.io keys go in the dashboard, not here)`);
  writeFileSync(ENVF,
`TRADING_MODE=DRY_RUN
KILL_SWITCH=0
MAX_TRADE_USDT=15
MAX_DAILY_LOSS_USDT=15
MAX_OPEN_POSITIONS=2
FUNCTION_SHARED_SECRET=${randSecret()}
GATE_API_KEY=
GATE_API_SECRET=
`);
} else {
  say(`${ENVF} exists — keeping it (your keys are safe).`);
}

// ---- 3. start local Supabase + apply migrations (no wipe) -------------------
say("Starting local Supabase (Docker) — first run pulls images, be patient");
run("supabase start");
say("Applying migrations");
try { run("supabase migration up", { stdio: "ignore" }); }
catch { warn("migration up unavailable; if tables are missing run 'supabase db reset' once (clears local data)."); }

// capture local keys from `supabase status -o json`
let status = {};
try { status = JSON.parse(capture("supabase status -o json") || "{}"); } catch { /* keep {} */ }
// Be tolerant of CLI version differences in key casing (API_URL vs api_url, …).
const pick = (obj, ...keys) => {
  for (const k of keys) {
    const hit = Object.keys(obj).find((o) => o.toLowerCase() === k.toLowerCase());
    if (hit && obj[hit]) return String(obj[hit]);
  }
  return "";
};
const API_URL = pick(status, "API_URL", "api_url") || "http://127.0.0.1:54321";
const ANON    = pick(status, "ANON_KEY", "anon_key");
const SRK     = pick(status, "SERVICE_ROLE_KEY", "service_role_key");
if (!ANON || !SRK) {
  warn("Could not read ANON_KEY/SERVICE_ROLE_KEY from 'supabase status' — the dashboard");
  warn("may fail to reach the backend. Check 'supabase status' output manually if so.");
}

const readEnv = (file, key) => {
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(key + "="));
  return line ? line.slice(key.length + 1) : "";
};
const envLocal = readFileSync(ENVF, "utf8");
if (!/^SUPABASE_URL=/m.test(envLocal))              appendFileSync(ENVF, `SUPABASE_URL=${API_URL}\n`);
if (!/^SUPABASE_SERVICE_ROLE_KEY=/m.test(envLocal)) appendFileSync(ENVF, `SUPABASE_SERVICE_ROLE_KEY=${SRK}\n`);
const SECRET = readEnv(ENVF, "FUNCTION_SHARED_SECRET");

// ---- 4. frontend env (.env) — created once ----------------------------------
if (!existsSync(".env")) {
  say("Creating frontend .env");
  writeFileSync(".env",
`VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_PUBLISHABLE_KEY=${ANON}
VITE_SUPABASE_PROJECT_ID=local
VITE_FUNCTION_SECRET=${SECRET}
`);
} else {
  say(".env exists — keeping it.");
}

// Consistency: the frontend secret MUST equal the server master key, or every
// signed function call 401s. Warn loudly if a partial re-run left them mismatched.
const feSecret = readEnv(".env", "VITE_FUNCTION_SECRET");
if (feSecret && feSecret !== SECRET) {
  warn("Mismatch: VITE_FUNCTION_SECRET (.env) != FUNCTION_SHARED_SECRET (.env.local).");
  warn("Signed function calls will fail (401). Delete BOTH .env and .env.local, then re-run.");
}

// ---- 5. serve functions (background) + dashboard (foreground) ----------------
const logPath = join(tmpdir(), "ate-functions.log");
say(`Serving edge functions in the background (logs: ${logPath})`);
const out = openSync(logPath, "a");
const fn = spawn("supabase", ["functions", "serve", "--no-verify-jwt", "--env-file", ENVF], {
  stdio: ["ignore", out, out],
  shell: isWin,
  detached: !isWin, // own process group on unix so we can kill the whole tree
});

function cleanup() {
  try {
    if (isWin) execSync(`taskkill /pid ${fn.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-fn.pid, "SIGTERM");
  } catch { /* already gone */ }
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);

console.log("");
ok("✓ Ready.");
console.log(`   1) Open:      http://localhost:8080
   2) Settings:  paste your NEW Gate.io key + secret -> Save
                 (it verifies, encrypts, and connects). DRY_RUN = reads, never trades.
   3) Autopilot: turn it ON to watch it shadow-trade on real data.

   First create a least-privilege key (spot+read, NO withdraw) and revoke any old one.`);
say("Starting the dashboard (Ctrl-C stops everything)…");
const dev = spawn(isWin ? "npm.cmd" : "npm", ["run", "dev"], { stdio: "inherit", shell: isWin });
dev.on("exit", (code) => { cleanup(); process.exit(code ?? 0); });
