-- Create trading system state table for persistent 24/7 operation
CREATE TABLE public.trading_system_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT now(),
  total_cycles INTEGER DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  successful_trades INTEGER DEFAULT 0,
  total_pnl DECIMAL(20, 8) DEFAULT 0,
  current_balance DECIMAL(20, 8) DEFAULT 0,
  settings JSONB DEFAULT '{"minEdge": 2, "maxTradeSize": 25, "maxDailyLoss": 10, "autoLiquidate": true, "scanIntervalSeconds": 30}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create trade history table
CREATE TABLE public.trade_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  amount DECIMAL(20, 8),
  price DECIMAL(20, 8),
  expected_edge DECIMAL(10, 4),
  actual_pnl DECIMAL(20, 8),
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create opportunities log
CREATE TABLE public.opportunity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  opportunity_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  expected_edge DECIMAL(10, 4),
  confidence INTEGER,
  action_taken TEXT,
  result TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create NFT/Airdrop tracking table
CREATE TABLE public.rewards_collected (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reward_type TEXT NOT NULL,
  name TEXT,
  value_usdt DECIMAL(20, 8),
  details JSONB,
  collected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create system log for monitoring
CREATE TABLE public.system_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS but allow public access for edge functions
ALTER TABLE public.trading_system_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rewards_collected ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_log ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (edge functions use service role)
CREATE POLICY "Allow all access to trading_system_state" ON public.trading_system_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to trade_history" ON public.trade_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to opportunity_log" ON public.opportunity_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to rewards_collected" ON public.rewards_collected FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to system_log" ON public.system_log FOR ALL USING (true) WITH CHECK (true);

-- Insert initial state record
INSERT INTO public.trading_system_state (is_active, settings) 
VALUES (true, '{"minEdge": 2, "maxTradeSize": 25, "maxDailyLoss": 10, "autoLiquidate": true, "scanIntervalSeconds": 30}'::jsonb);