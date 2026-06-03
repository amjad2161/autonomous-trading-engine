// Deno tests for the canonical Gate.io signer. deno test supabase/functions/_shared/

import { assert, assertEquals } from "./_test_assert.ts";
import { gateAuthHeaders, gateSign, hmacSha512Hex, sha512Hex } from "./gate-sign.ts";

Deno.test("hmacSha512Hex matches RFC 4231 test case 1", async () => {
  // key = 20 * 0x0b, data = "Hi There"
  const key = "\x0b".repeat(20);
  const out = await hmacSha512Hex("Hi There", key);
  assertEquals(
    out,
    "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cde" +
      "daa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
  );
});

Deno.test("sha512Hex of empty string is the known constant", async () => {
  assertEquals(
    await sha512Hex(""),
    "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce" +
      "47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
  );
});

Deno.test("gateSign is deterministic and secret-sensitive; 128 hex chars", async () => {
  const a = await gateSign("GET", "/api/v4/spot/accounts", "", "", "1700000000", "secret1");
  const b = await gateSign("GET", "/api/v4/spot/accounts", "", "", "1700000000", "secret1");
  const c = await gateSign("GET", "/api/v4/spot/accounts", "", "", "1700000000", "secret2");
  assertEquals(a, b);            // deterministic
  assert(a !== c);              // different secret -> different sig
  assertEquals(a.length, 128);  // HMAC-SHA512 = 64 bytes
});

Deno.test("gateAuthHeaders includes KEY/SIGN/Timestamp", async () => {
  const h = await gateAuthHeaders("POST", "/api/v4/spot/orders", "", '{"x":1}', "k", "s", "1700000000");
  assertEquals(h.KEY, "k");
  assertEquals(h.Timestamp, "1700000000");
  assertEquals(h.SIGN.length, 128);
});
