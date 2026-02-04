-- Create trading_goals table for storing user goals
CREATE TABLE public.trading_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_type TEXT NOT NULL, -- 'daily_profit', 'balance_target', 'growth_percentage', 'winning_trades'
  target_value NUMERIC NOT NULL,
  current_value NUMERIC DEFAULT 0,
  start_value NUMERIC DEFAULT 0,
  deadline TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'active', -- 'active', 'achieved', 'failed', 'paused'
  priority INTEGER DEFAULT 1,
  auto_adjust_aggression BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  achieved_at TIMESTAMP WITH TIME ZONE,
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.trading_goals ENABLE ROW LEVEL SECURITY;

-- Allow all operations (no auth in this system)
CREATE POLICY "Allow all access to trading_goals" 
ON public.trading_goals 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Add realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.trading_goals;

-- Create goal_progress table for tracking historical progress
CREATE TABLE public.goal_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_id UUID REFERENCES public.trading_goals(id) ON DELETE CASCADE,
  recorded_value NUMERIC NOT NULL,
  progress_percentage NUMERIC,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.goal_progress ENABLE ROW LEVEL SECURITY;

-- Allow all operations
CREATE POLICY "Allow all access to goal_progress" 
ON public.goal_progress 
FOR ALL 
USING (true)
WITH CHECK (true);