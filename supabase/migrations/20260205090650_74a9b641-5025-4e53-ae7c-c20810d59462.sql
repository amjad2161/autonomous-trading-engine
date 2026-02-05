-- Drop existing permissive RLS policies and replace with service role only policies

-- trading_system_state
DROP POLICY IF EXISTS "Allow all access to trading_system_state" ON public.trading_system_state;
CREATE POLICY "Service role access only"
ON public.trading_system_state
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- trade_history
DROP POLICY IF EXISTS "Allow all access to trade_history" ON public.trade_history;
CREATE POLICY "Service role access only"
ON public.trade_history
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- opportunity_log
DROP POLICY IF EXISTS "Allow all access to opportunity_log" ON public.opportunity_log;
CREATE POLICY "Service role access only"
ON public.opportunity_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- rewards_collected
DROP POLICY IF EXISTS "Allow all access to rewards_collected" ON public.rewards_collected;
CREATE POLICY "Service role access only"
ON public.rewards_collected
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- system_log
DROP POLICY IF EXISTS "Allow all access to system_log" ON public.system_log;
CREATE POLICY "Service role access only"
ON public.system_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- trading_goals
DROP POLICY IF EXISTS "Allow all access to trading_goals" ON public.trading_goals;
CREATE POLICY "Service role access only"
ON public.trading_goals
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- goal_progress
DROP POLICY IF EXISTS "Allow all access to goal_progress" ON public.goal_progress;
CREATE POLICY "Service role access only"
ON public.goal_progress
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);