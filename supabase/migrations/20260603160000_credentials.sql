-- Encrypted Gate.io credentials entered via the dashboard (the "type keys in the
-- UI" flow). Single row (id=1). Values are AES-GCM encrypted at rest under the
-- server master key (FUNCTION_SHARED_SECRET / CREDENTIALS_MASTER_KEY).
-- See supabase/functions/_shared/credentials.ts.

CREATE TABLE IF NOT EXISTS public.credentials (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enc_key TEXT NOT NULL,
  enc_secret TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT credentials_singleton CHECK (id = 1)
);

-- RLS ON with NO policy: anon / authenticated clients can neither read nor write.
-- Only the SERVICE ROLE (used by the edge functions) bypasses RLS, so the
-- encrypted secret never reaches the browser.
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
