-- =============================================================================
-- Re-key trading_system_state by a stable TEXT id ('master-brain').
-- =============================================================================
-- The table was created with `id UUID DEFAULT gen_random_uuid()`, but the entire
-- application treats it as a singleton keyed by the TEXT id 'master-brain'
-- (dashboard MasterControlPanel/GoalsPanel and the master-brain edge function all
-- do `.eq('id','master-brain')` / upsert `{ id: 'master-brain' }`). Against a UUID
-- column, every one of those queries failed with HTTP 400
-- ("invalid input syntax for type uuid: master-brain"), so system state never
-- synced to the dashboard. No foreign keys reference this table, so re-keying is
-- safe.

-- 1. Convert the primary key column from uuid to text.
ALTER TABLE public.trading_system_state ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.trading_system_state ALTER COLUMN id TYPE text USING id::text;

-- 2. Point the existing singleton row (most recently updated, if any) at the
--    canonical id the app expects, preserving its accumulated counters/settings.
UPDATE public.trading_system_state
   SET id = 'master-brain'
 WHERE id = (
   SELECT id FROM public.trading_system_state
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1
 );

-- 3. Guarantee the row exists even on an empty table.
INSERT INTO public.trading_system_state (id)
VALUES ('master-brain')
ON CONFLICT (id) DO NOTHING;

-- 4. Drop any leftover non-canonical rows so the `.limit(1).single()` reads used
--    by the other engines are deterministic (exactly one state row).
DELETE FROM public.trading_system_state WHERE id <> 'master-brain';
