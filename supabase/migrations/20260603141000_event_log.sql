-- Event sourcing log for the Deterministic Replay Engine (Master Spec A2.2, #25).
-- Append-only stream of events used to reconstruct exact state via replay().

CREATE TABLE IF NOT EXISTS public.event_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seq BIGSERIAL,
  ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  type TEXT NOT NULL,            -- 'fill' | 'deposit' | 'decision' | 'order_sent' | 'note' | ...
  symbol TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Ordered replay + recent-incident queries.
CREATE INDEX IF NOT EXISTS event_log_seq_idx ON public.event_log (seq);
CREATE INDEX IF NOT EXISTS event_log_ts_idx ON public.event_log (ts);
CREATE INDEX IF NOT EXISTS event_log_type_idx ON public.event_log (type);

ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;

-- Edge functions use the service role; convention matches the other tables.
CREATE POLICY "Allow all access to event_log" ON public.event_log FOR ALL USING (true) WITH CHECK (true);
