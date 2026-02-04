-- Add kill_switch_reset_at column to track manual resets
ALTER TABLE public.trading_system_state 
ADD COLUMN IF NOT EXISTS kill_switch_reset_at TIMESTAMP WITH TIME ZONE;

-- Add comment for documentation
COMMENT ON COLUMN public.trading_system_state.kill_switch_reset_at IS 'Timestamp when kill-switch was manually reset. If set to today, trading resumes.';