-- =============================================================================
-- Enable Postgres realtime for trading_system_state.
-- =============================================================================
-- HyperEnginePanel (and the dashboard's live state) subscribe to
-- postgres_changes on public.trading_system_state, but the table was never added
-- to the supabase_realtime publication (only trading_goals was). As a result the
-- realtime subscription never delivers row changes and the UI silently relies on
-- a 10-second polling fallback — i.e. system state does not update live. Add the
-- table to the publication (idempotently) and set REPLICA IDENTITY FULL so UPDATE
-- payloads carry the full new row the UI reads via payload.new.

ALTER TABLE public.trading_system_state REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trading_system_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trading_system_state;
  END IF;
END $$;
