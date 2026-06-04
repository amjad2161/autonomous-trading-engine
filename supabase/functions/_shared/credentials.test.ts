// Deno tests for credentials encryption + resolution. deno test supabase/functions/_shared/

import { assert, assertEquals, assertRejects } from "./_test_assert.ts";
import {
  decryptSecret, encryptSecret, getGateCredentials, loadStoredCredentials, storeCredentials, type DbClient,
} from "./credentials.ts";

// In-memory fake of the bits of the Supabase client we use.
function fakeClient() {
  // deno-lint-ignore no-explicit-any
  let row: any = null;
  const client: DbClient = {
    from: (_t: string) => ({
      // deno-lint-ignore no-explicit-any
      upsert: (r: any) => { row = r; return Promise.resolve({}); },
      select: (_c: string) => ({
        eq: (_k: string, _v: unknown) => ({ maybeSingle: () => Promise.resolve({ data: row }) }),
      }),
    }),
  };
  return client;
}

function resetEnv() {
  for (const k of ["GATE_API_KEY", "GATE_API_SECRET", "CREDENTIALS_MASTER_KEY", "FUNCTION_SHARED_SECRET"]) Deno.env.delete(k);
}

Deno.test("encrypt/decrypt round-trips; ciphertext != plaintext", async () => {
  const blob = await encryptSecret("super-secret-key", "master-123");
  assert(!blob.includes("super-secret-key"));
  assertEquals(await decryptSecret(blob, "master-123"), "super-secret-key");
});

Deno.test("decrypt with the WRONG master key fails (tamper/forgery rejected)", async () => {
  const blob = await encryptSecret("abc", "right-master");
  await assertRejects(() => decryptSecret(blob, "wrong-master"));
});

Deno.test("store then load round-trips through encryption (fake DB)", async () => {
  resetEnv();
  Deno.env.set("FUNCTION_SHARED_SECRET", "the-master");
  const db = fakeClient();
  await storeCredentials(db, "key_ABC123", "secret_DEF456");
  const got = await loadStoredCredentials(db);
  assertEquals(got, { apiKey: "key_ABC123", apiSecret: "secret_DEF456" });
});

Deno.test("getGateCredentials: env wins when present", async () => {
  resetEnv();
  Deno.env.set("GATE_API_KEY", "env-key");
  Deno.env.set("GATE_API_SECRET", "env-secret");
  assertEquals(await getGateCredentials(), { apiKey: "env-key", apiSecret: "env-secret" });
});

Deno.test("getGateCredentials: falls back to DB when env absent", async () => {
  resetEnv();
  Deno.env.set("FUNCTION_SHARED_SECRET", "the-master");
  const db = fakeClient();
  await storeCredentials(db, "db-key", "db-secret");
  assertEquals(await getGateCredentials(db), { apiKey: "db-key", apiSecret: "db-secret" });
});

Deno.test("getGateCredentials: throws when nothing configured", async () => {
  resetEnv();
  await assertRejects(() => getGateCredentials());
});
