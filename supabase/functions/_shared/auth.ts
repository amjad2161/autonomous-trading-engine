// =============================================================================
// SHARED AUTH GUARD  —  close the "world-invokable function" hole
// =============================================================================
//
// PROBLEM this addresses:
//   Every function in supabase/config.toml is deployed with `verify_jwt = false`,
//   and the in-function check is presence-only ("is there *an* Authorization
//   header?"). That means anyone who learns the project URL can invoke
//   execute-trade / update-secrets / the live traders and make the SERVER sign
//   requests with ITS OWN Gate.io keys. The caller never needs the keys.
//
// WHAT this does:
//   Replaces presence-only auth with a real shared-secret check. When the
//   environment variable FUNCTION_SHARED_SECRET is configured, callers must
//   present a matching `x-function-secret` header (constant-time compared).
//
// BACKWARD COMPATIBILITY:
//   If FUNCTION_SHARED_SECRET is NOT set, the guard falls back to the old
//   presence-only behaviour but logs a CRITICAL warning, so nothing breaks the
//   moment you deploy this — but you are loudly told the door is still open.
//   To actually close it: set FUNCTION_SHARED_SECRET on the server and have the
//   frontend send the same value as `x-function-secret`.
//
// NOTE / honest caveat:
//   A secret embedded in a public single-page app is not a true secret. For a
//   personal desktop dashboard this still stops anonymous internet scanners. For
//   real multi-user security, enable Supabase Auth + RLS and flip verify_jwt
//   back to true. See docs/SECURITY-AND-ROADMAP.md.
// =============================================================================

export class AuthError extends Error {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

/** Constant-time string comparison to avoid leaking the secret via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Enforce auth on a request. Throws AuthError (401) when the caller is not
 * authorised. Call this first inside every privileged function's handler.
 *
 * @param req         The incoming Request.
 * @param opts.require When true, refuse to run if FUNCTION_SHARED_SECRET is not
 *                     configured (fail-closed). Use this for the most dangerous
 *                     functions (update-secrets, withdrawals, etc.).
 */
export function requireAuth(req: Request, opts: { require?: boolean } = {}): void {
  const expected = (Deno.env.get("FUNCTION_SHARED_SECRET") ?? "").trim();

  if (expected) {
    const provided = (req.headers.get("x-function-secret") ?? "").trim();
    if (!provided || !timingSafeEqual(provided, expected)) {
      throw new AuthError("Invalid or missing function secret");
    }
    return; // authenticated
  }

  // No shared secret configured.
  if (opts.require) {
    console.error(
      "[AUTH] CRITICAL: FUNCTION_SHARED_SECRET is not set and this function " +
        "requires it. Refusing to run. Set the secret to enable this endpoint.",
    );
    throw new AuthError("Server auth not configured");
  }

  // Fail-open fallback (legacy behaviour) — but make the risk loud.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new AuthError("Authorization required");
  }
  console.warn(
    "[AUTH] WARNING: FUNCTION_SHARED_SECRET not set — this privileged endpoint " +
      "is protected by presence-only auth and can be invoked by anyone with the " +
      "URL. Configure FUNCTION_SHARED_SECRET to close this hole.",
  );
}

/** Standard 401 response builder. */
export function unauthorizedResponse(corsHeaders: Record<string, string>, message = "Unauthorized"): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
