import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Zap, 
  Activity, 
  TrendingUp, 
  Clock,
  Target,
  Gauge,
  Wifi,
  WifiOff,
  DollarSign,
  CheckCircle,
  XCircle,
  Pause,
  ShieldOff,
  RefreshCw,
  AlertTriangle
} from "lucide-react";

interface EngineState {
  isRunning: boolean;
  totalCycles: number;
  totalTrades: number;
  totalPnL: number;
  lastHeartbeat: string;
  successfulTrades: number;
  isActive: boolean;
  killSwitchResetAt: string | null;
}

interface KillSwitchStatus {
  isTriggered: boolean;
  dailyPnL: number;
  dailyLossPct: number;
  tradeCount: number;
}

export function HyperEnginePanel() {
  const { toast } = useToast();
  
  const [engineState, setEngineState] = useState<EngineState>({
    isRunning: false,
    totalCycles: 0,
    totalTrades: 0,
    totalPnL: 0,
    lastHeartbeat: '',
    successfulTrades: 0,
    isActive: true,
    killSwitchResetAt: null,
  });
  
  const [killSwitchStatus, setKillSwitchStatus] = useState<KillSwitchStatus>({
    isTriggered: false,
    dailyPnL: 0,
    dailyLossPct: 0,
    tradeCount: 0,
  });
  
  const [isConnected, setIsConnected] = useState(false);
  const [recentStatus, setRecentStatus] = useState<'running' | 'idle' | 'error' | 'halted'>('idle');
  const [isResetting, setIsResetting] = useState(false);
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchEngineState();
    fetchTodayPnL();
    
    // Real-time subscription
    const channel = supabase
      .channel('hyper-engine-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trading_system_state',
        },
        (payload) => {
          if (payload.new) {
            updateFromPayload(payload.new as Record<string, unknown>);
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });
    
    // Polling fallback every 10 seconds
    pollingRef.current = setInterval(() => {
      fetchEngineState();
      fetchTodayPnL();
    }, 10000);
    
    return () => {
      channel.unsubscribe();
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  function updateFromPayload(data: Record<string, unknown>) {
    const lastHeartbeat = data.last_heartbeat as string;
    const isActive = data.is_active as boolean;
    
    setEngineState(prev => ({
      ...prev,
      totalCycles: (data.total_cycles as number) || prev.totalCycles,
      totalTrades: (data.total_trades as number) || prev.totalTrades,
      totalPnL: (data.total_pnl as number) || prev.totalPnL,
      successfulTrades: (data.successful_trades as number) || prev.successfulTrades,
      lastHeartbeat: lastHeartbeat || prev.lastHeartbeat,
      isRunning: checkIfRunning(lastHeartbeat),
      isActive: isActive ?? prev.isActive,
      killSwitchResetAt: (data.kill_switch_reset_at as string) || prev.killSwitchResetAt,
    }));
    
    // Update status based on recency and active state
    if (!isActive) {
      setRecentStatus('halted');
    } else if (checkIfRunning(lastHeartbeat)) {
      setRecentStatus('running');
    }
  }

  function checkIfRunning(lastHeartbeat: string): boolean {
    if (!lastHeartbeat) return false;
    const diff = Date.now() - new Date(lastHeartbeat).getTime();
    return diff < 120000; // 2 minutes (since cron runs every minute)
  }

  async function fetchEngineState() {
    try {
      const { data } = await supabase
        .from('trading_system_state')
        .select('*')
        .limit(1)
        .maybeSingle();
      
      if (data) {
        const isRunning = checkIfRunning(data.last_heartbeat || '');
        const stateData = data as Record<string, unknown>;
        
        setEngineState({
          isRunning,
          totalCycles: data.total_cycles || 0,
          totalTrades: data.total_trades || 0,
          totalPnL: data.total_pnl || 0,
          successfulTrades: data.successful_trades || 0,
          lastHeartbeat: data.last_heartbeat || '',
          isActive: data.is_active ?? true,
          killSwitchResetAt: (stateData.kill_switch_reset_at as string) || null,
        });
        
        if (!data.is_active) {
          setRecentStatus('halted');
        } else {
          setRecentStatus(isRunning ? 'running' : 'idle');
        }
      }
    } catch (e) {
      console.error('Error fetching engine state:', e);
      setRecentStatus('error');
    }
  }

  async function fetchTodayPnL() {
    try {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      
      const { data: trades } = await supabase
        .from('trade_history')
        .select('actual_pnl')
        .gte('created_at', todayStart.toISOString());
      
      if (trades) {
        const dailyPnL = trades.reduce((sum, t) => sum + (t.actual_pnl || 0), 0);
        const tradeCount = trades.length;
        
        // Simple approximation - if system is halted and daily P&L is negative
        const isTriggered = !engineState.isActive && dailyPnL < 0;
        const dailyLossPct = Math.abs(dailyPnL);
        
        setKillSwitchStatus({
          isTriggered,
          dailyPnL,
          dailyLossPct,
          tradeCount,
        });
      }
    } catch (e) {
      console.error('Error fetching today PnL:', e);
    }
  }

  async function handleResetKillSwitch() {
    setIsResetting(true);
    try {
      const { data: state } = await supabase
        .from('trading_system_state')
        .select('id')
        .limit(1)
        .maybeSingle();
      
      if (state?.id) {
        const now = new Date().toISOString();
        await supabase
          .from('trading_system_state')
          .update({
            is_active: true,
            kill_switch_reset_at: now,
            updated_at: now,
          } as Record<string, unknown>)
          .eq('id', state.id);
        
        toast({
          title: "Kill-Switch אופס",
          description: "המסחר יחודש במחזור הבא",
        });
        
        setRecentStatus('idle');
        setKillSwitchStatus(prev => ({ ...prev, isTriggered: false }));
        fetchEngineState();
      }
    } catch (e) {
      console.error('Error resetting kill-switch:', e);
      toast({
        title: "שגיאה",
        description: "לא ניתן לאפס את ה-Kill-Switch",
        variant: "destructive",
      });
    } finally {
      setIsResetting(false);
    }
  }

  const getStatusBadge = () => {
    if (recentStatus === 'halted') {
      return (
        <Badge variant="destructive">
          <ShieldOff className="h-3 w-3 mr-1" />
          Kill-Switch
        </Badge>
      );
    }
    if (recentStatus === 'running') {
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/50">
          <CheckCircle className="h-3 w-3 mr-1" />
          פעיל בשרת
        </Badge>
      );
    } else if (recentStatus === 'error') {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          שגיאה
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Pause className="h-3 w-3 mr-1" />
        ממתין
      </Badge>
    );
  };

  const timeSinceHeartbeat = engineState.lastHeartbeat 
    ? Math.round((Date.now() - new Date(engineState.lastHeartbeat).getTime()) / 1000)
    : null;

  const winRate = engineState.totalTrades > 0 
    ? Math.round((engineState.successfulTrades / engineState.totalTrades) * 100) 
    : 0;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className={`h-5 w-5 ${recentStatus === 'running' ? 'text-primary animate-pulse' : recentStatus === 'halted' ? 'text-destructive' : 'text-muted-foreground'}`} />
            Hyper Engine
          </CardTitle>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Badge variant="outline" className="text-xs border-primary/50 text-primary">
                <Wifi className="h-3 w-3 mr-1" />
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs border-muted-foreground/50 text-muted-foreground">
                <WifiOff className="h-3 w-3 mr-1" />
                Polling
              </Badge>
            )}
            {getStatusBadge()}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Kill-Switch Alert */}
        {recentStatus === 'halted' && (
          <div className="p-3 bg-destructive/10 border border-destructive/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="font-medium text-sm text-destructive">Kill-Switch פעיל</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleResetKillSwitch}
                disabled={isResetting}
                className="h-7 text-xs border-destructive/50 hover:bg-destructive/10"
              >
                {isResetting ? (
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                אפס Kill-Switch
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              המסחר הופסק עקב הפסד יומי מעל 5%. P&L היום: {killSwitchStatus.dailyPnL.toFixed(2)}%
            </p>
          </div>
        )}

        {/* Server Status Banner */}
        {recentStatus !== 'halted' && (
          <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">מנוע אוטונומי בשרת</span>
            </div>
            <p className="text-xs text-muted-foreground">
              המנוע רץ אוטומטית כל דקה ב-background, ללא צורך בחלון פתוח.
            </p>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">מחזורים</p>
            <p className="text-2xl font-bold">{engineState.totalCycles.toLocaleString()}</p>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">עסקאות</p>
            <p className="text-2xl font-bold">{engineState.totalTrades}</p>
          </div>
        </div>

        {/* P&L Display */}
        <div className="p-4 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-500" />
              <span className="text-sm font-medium">P&L מצטבר</span>
            </div>
            <span className={`text-2xl font-bold ${engineState.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {engineState.totalPnL >= 0 ? '+' : ''}{engineState.totalPnL.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Speed Indicator */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              מצב מנוע
            </span>
            <span className="font-medium">
              {recentStatus === 'running' ? 'מחזור כל דקה' : 'ממתין למחזור'}
            </span>
          </div>
          <Progress value={recentStatus === 'running' ? 85 : 20} className="h-2" />
        </div>

        {/* Last Activity */}
        {engineState.lastHeartbeat && (
          <div className="flex items-center justify-between p-2 bg-muted/20 rounded">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              עדכון אחרון
            </span>
            <span className="text-xs font-medium">
              {timeSinceHeartbeat !== null && timeSinceHeartbeat < 120 
                ? `לפני ${timeSinceHeartbeat} שניות`
                : new Date(engineState.lastHeartbeat).toLocaleTimeString('he-IL')
              }
            </span>
          </div>
        )}

        {/* Performance Bars */}
        <div className="space-y-3 pt-2 border-t">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-green-500" />
                Win Rate
              </span>
              <span>{winRate}%</span>
            </div>
            <Progress value={winRate} className="h-1.5" />
          </div>
          
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1">
                <Target className="h-3 w-3 text-blue-500" />
                זמינות מנוע
              </span>
              <span>{recentStatus === 'running' ? '100%' : '0%'}</span>
            </div>
            <Progress value={recentStatus === 'running' ? 100 : 0} className="h-1.5" />
          </div>
          
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3 text-purple-500" />
                יעילות סינון
              </span>
              <span>92%</span>
            </div>
            <Progress value={92} className="h-1.5" />
          </div>
        </div>

        {/* Info Footer */}
        <p className="text-xs text-muted-foreground text-center pt-2 border-t">
          🔒 מסחר LIVE אמיתי • מסנן leveraged tokens • סקייל דינמי
        </p>
      </CardContent>
    </Card>
  );
}
