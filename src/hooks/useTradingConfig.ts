import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type ProfileName = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'CUSTOM' | 'AUTO';

export interface TradingConfigSettings {
  profile: ProfileName;
  autopilot: boolean;
  adaptive: boolean;
  custom: Record<string, number>;
}

export interface ResolvedConfig {
  profile: ProfileName;
  autopilot: boolean;
  adaptive: boolean;
  rationale: string;
  riskPerTradePct: number;
  maxTradeUsdt: number;
  maxOpenPositions: number;
  maxTradesPerHour: number;
  minEdgePct: number;
  takeProfitPct: number;
  stopLossPct: number;
  slippageTolerancePct: number;
  cooldownSec: number;
}

/**
 * Runtime command & control for the autopilot MODE (aggression). The hard safety
 * floor (caps, kill switch, DRY_RUN default, no leverage) is server-side env and
 * is NOT controlled here — this only changes how aggressive the bot is within
 * that floor.
 */
export function useTradingConfig() {
  const [settings, setSettings] = useState<TradingConfigSettings | null>(null);
  const [resolved, setResolved] = useState<ResolvedConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('config', { body: { command: 'get' } });
      if (error) throw error;
      if (data?.settings) setSettings(data.settings);
      if (data?.resolved) setResolved(data.resolved);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const save = useCallback(async (patch: Partial<TradingConfigSettings>) => {
    try {
      setIsSaving(true);
      const { data, error } = await supabase.functions.invoke('config', {
        body: { command: 'set', ...patch },
      });
      if (error) throw error;
      if (data?.settings) setSettings(data.settings);
      if (data?.resolved) setResolved(data.resolved);
      setError(null);
      return { success: true as const };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
      return { success: false as const };
    } finally {
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { settings, resolved, isLoading, isSaving, error, save, refresh: fetchConfig };
}
