// =============================================================================
// CREDENTIALS RESOLUTION — env-first, encrypted-DB fallback
// =============================================================================
// Lets the user enter Gate.io keys IN THE DASHBOARD (stored encrypted in the
// local DB) instead of editing a file — while keeping the safest path (env)
// winning when present, so existing setups are unaffected.
//
// Resolution order:
//   1. GATE_API_KEY / GATE_API_SECRET env vars  (most secure; .env.local path)
//   2. encrypted credentials row in the DB       (the "type it in the UI" path)
//
// SECURITY TRADE-OFF (honest): a DB-stored key is less protected than an env var.
// It is encrypted at rest with AES-GCM under a master key (FUNCTION_SHARED_SECRET
// / CREDENTIALS_MASTER_KEY). Acceptable for a LOCAL single-user setup (DB on your
// machine); for a public deploy, prefer env vars. The credentials row is never
// returned to the browser (service-role read only; RLS denies anon).
//
// This module is import-light on purpose (no supabase-js import) so the test
// suite type-checks it offline. The DB client is passed in by callers.
// =============================================================================

export interface GateCredentials {
  apiKey: string;
  apiSecret: string;
}

// Minimal structural type for the bits of the Supabase client we use, so we
// don't import supabase-js (a remote module) into a unit-tested shared file.
// deno-lint-ignore no-explicit-any
export type DbClient = { from: (table: string) => any };

function masterKey(): string {
  const m = (Deno.env.get("CREDENTIALS_MASTER_KEY") || Deno.env.get("FUNCTION_SHARED_SECRET") || "").trim();
  if (!m) throw new Error("No master key (set FUNCTION_SHARED_SECRET or CREDENTIALS_MASTER_KEY) to store credentials");
  return m;
}

async function deriveAesKey(master: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(master));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** AES-GCM encrypt -> base64(iv|ciphertext). Pure (given master). */
export async function encryptSecret(plaintext: string, master: string): Promise<string> {
  const key = await deriveAesKey(master);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  let bin = "";
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decrypt base64(iv|ciphertext) from encryptSecret. Throws on wrong key/tamper. */
export async function decryptSecret(blob: string, master: string): Promise<string> {
  const raw = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const key = await deriveAesKey(master);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/** Encrypt + upsert the credentials (single row id=1). */
export async function storeCredentials(supabase: DbClient, apiKey: string, apiSecret: string): Promise<void> {
  const m = masterKey();
  const enc_key = await encryptSecret(apiKey, m);
  const enc_secret = await encryptSecret(apiSecret, m);
  await supabase.from("credentials").upsert({ id: 1, enc_key, enc_secret, updated_at: new Date().toISOString() });
}

/** Read + decrypt stored credentials, or null if none/undecryptable. */
export async function loadStoredCredentials(supabase: DbClient): Promise<GateCredentials | null> {
  const { data } = await supabase.from("credentials").select("enc_key,enc_secret").eq("id", 1).maybeSingle();
  if (!data?.enc_key || !data?.enc_secret) return null;
  try {
    const m = masterKey();
    return { apiKey: await decryptSecret(data.enc_key, m), apiSecret: await decryptSecret(data.enc_secret, m) };
  } catch {
    // A row exists but won't decrypt — almost always the master key was rotated.
    // Surface it (loudly) instead of silently behaving as "no credentials".
    console.warn("[credentials] a stored credentials row exists but could NOT be decrypted (master key rotated/changed?). Re-save your keys in the dashboard.");
    return null;
  }
}

/**
 * Resolve Gate.io credentials: env first, then the encrypted DB row (when a
 * client is supplied). Throws if neither is configured.
 */
export async function getGateCredentials(supabase?: DbClient): Promise<GateCredentials> {
  const k = Deno.env.get("GATE_API_KEY");
  const s = Deno.env.get("GATE_API_SECRET");
  if (k && s) return { apiKey: k, apiSecret: s };
  if ((k && !s) || (!k && s)) {
    console.warn("[credentials] only one of GATE_API_KEY / GATE_API_SECRET is set — ignoring the half-set env and trying stored credentials.");
  }
  if (supabase) {
    const stored = await loadStoredCredentials(supabase);
    if (stored) return stored;
  }
  throw new Error("No Gate.io credentials configured (set env vars or save them in the dashboard)");
}

/**
 * Make Gate.io credentials available via Deno.env for engines that read
 * GATE_API_KEY/GATE_API_SECRET directly. Resolves env-first; only when env is
 * unset does it load the encrypted DB row (the dashboard path) and inject it
 * into the process env for this isolate.
 *
 * WORST-CASE-SAFE: if env keys are already present it is a no-op (env wins, so
 * existing setups are byte-for-byte unaffected); if no credentials exist
 * anywhere, it swallows the error and leaves env untouched, so the caller
 * behaves exactly as before. Returns true iff credentials are now in env.
 */
export async function hydrateGateEnvFromDb(supabase?: DbClient): Promise<boolean> {
  if (Deno.env.get("GATE_API_KEY") && Deno.env.get("GATE_API_SECRET")) return true;
  try {
    const c = await getGateCredentials(supabase);
    if (c.apiKey && c.apiSecret) {
      Deno.env.set("GATE_API_KEY", c.apiKey);
      Deno.env.set("GATE_API_SECRET", c.apiSecret);
      return true;
    }
  } catch {
    // No credentials configured anywhere yet — leave env as-is; the engine will
    // report "not configured" exactly as it did before this helper existed.
  }
  return false;
}
