// =============================================================================
// GATE.IO REQUEST SIGNING — single canonical implementation
// =============================================================================
// The HMAC-SHA512 signing of Gate.io v4 requests was duplicated across ~15 edge
// functions. This is the ONE implementation, using Web Crypto (Deno built-in),
// fully unit-tested (incl. an RFC 4231 HMAC-SHA512 test vector). New code uses
// this; legacy functions migrate to it incrementally.
// =============================================================================

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-512 of a string, hex-encoded. */
export async function sha512Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-512", enc.encode(message)));
}

/** HMAC-SHA512(message, secret), hex-encoded. */
export async function hmacSha512Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/**
 * Build the Gate.io v4 `SIGN` header value:
 *   SIGN = HMAC-SHA512( METHOD \n PATH \n query \n SHA512(body) \n timestamp )
 * `path` must include the `/api/v4` prefix; `body` is the raw JSON string ("" for GET).
 */
export async function gateSign(
  method: string,
  path: string,
  query: string,
  body: string,
  timestamp: string,
  secret: string,
): Promise<string> {
  const hashedPayload = await sha512Hex(body ?? "");
  const signatureString = `${method}\n${path}\n${query}\n${hashedPayload}\n${timestamp}`;
  return hmacSha512Hex(signatureString, secret);
}

/** Build the full signed header set for a Gate.io v4 private request. */
export async function gateAuthHeaders(
  method: string,
  path: string,
  query: string,
  body: string,
  apiKey: string,
  apiSecret: string,
  timestamp: string = Math.floor(Date.now() / 1000).toString(),
): Promise<Record<string, string>> {
  const sign = await gateSign(method, path, query, body, timestamp, apiSecret);
  return {
    KEY: apiKey,
    SIGN: sign,
    Timestamp: timestamp,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}
