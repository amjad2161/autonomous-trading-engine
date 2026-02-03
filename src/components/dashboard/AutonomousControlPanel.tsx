import { useState } from "react";
import { 
  Cpu, 
  Play, 
  Square, 
  RefreshCw, 
  Zap,
  TrendingUp,
  Clock,
  Activity,
  AlertCircle,
  CheckCircle2,
  Wifi,
  WifiOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAutonomousSystem } from "@/hooks/useAutonomousSystem";
import { formatUSDT } from "@/lib/gate-api";
import { useToast } from "@/hooks/use-toast";

export function AutonomousControlPanel() {
  const { state, trades, logs, isLoading, error, start, stop, runCycle, refresh } = useAutonomousSystem();
  const { toast } = useToast();
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRunningCycle, setIsRunningCycle] = useState(false);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await start();
      toast({ title: '🚀 המערכת הופעלה', description: 'מסחר אוטונומי 24/7 פועל' });
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      await stop();
      toast({ title: '⏹️ המערכת נעצרה', description: 'המסחר האוטונומי הופסק' });
    } finally {
      setIsStopping(false);
    }
  };

  const handleRunCycle = async () => {
    setIsRunningCycle(true);
    try {
      const result = await runCycle();
      toast({ 
        title: '✅ מחזור הושלם', 
        description: `${result.results?.trading?.successful || 0} עסקאות | יתרה: ${formatUSDT(result.balance || 0)}` 
      });
    } catch (err) {
      toast({ title: 'שגיאה', description: 'המחזור נכשל', variant: 'destructive' });
    } finally {
      setIsRunningCycle(false);
    }
  };

  const isActive = state?.is_active || false;
  const winRate = state?.total_trades ? ((state.successful_trades / state.total_trades) * 100).toFixed(1) : '0.0';
  const lastHeartbeat = state?.last_heartbeat ? new Date(state.last_heartbeat) : null;
  const isOnline = lastHeartbeat && (Date.now() - lastHeartbeat.getTime()) < 60000;

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Cpu className={`w-4 h-4 ${isActive ? 'text-profit animate-pulse' : 'text-muted-foreground'}`} />
          <h2 className="font-semibold text-sm">מערכת אוטונומית 24/7</h2>
          {isActive ? (
            <Badge variant="outline" className="text-xs border-profit/50 text-profit animate-pulse">
              <Wifi className="w-3 h-3 mr-1" />
              פעיל
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs border-muted-foreground/50 text-muted-foreground">
              <WifiOff className="w-3 h-3 mr-1" />
              מושבת
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Main Controls */}
        <div className="flex items-center gap-2">
          {!isActive ? (
            <Button 
              onClick={handleStart} 
              className="flex-1 bg-profit hover:bg-profit/80"
              disabled={isStarting}
            >
              {isStarting ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              הפעל 24/7
            </Button>
          ) : (
            <>
              <Button 
                onClick={handleRunCycle} 
                variant="outline" 
                className="flex-1"
                disabled={isRunningCycle}
              >
                {isRunningCycle ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                הרץ מחזור
              </Button>
              <Button 
                onClick={handleStop} 
                variant="destructive" 
                className="flex-1"
                disabled={isStopping}
              >
                {isStopping ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Square className="w-4 h-4 mr-2" />
                )}
                עצור
              </Button>
            </>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">יתרה נוכחית</p>
            <p className="text-lg font-bold font-mono">
              {formatUSDT(state?.current_balance || 0)}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">מחזורים</p>
            <p className="text-lg font-bold font-mono">{state?.total_cycles || 0}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">עסקאות</p>
            <p className="text-lg font-bold font-mono">
              {state?.successful_trades || 0}/{state?.total_trades || 0}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="text-lg font-bold font-mono">{winRate}%</p>
          </div>
        </div>

        {/* Status Info */}
        {state && (
          <div className="bg-muted/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                הפעלה
              </span>
              <span>{state.started_at ? new Date(state.started_at).toLocaleString('he-IL') : '-'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Activity className="w-3 h-3" />
                פעילות אחרונה
              </span>
              <span className={isOnline ? 'text-profit' : 'text-destructive'}>
                {lastHeartbeat ? lastHeartbeat.toLocaleTimeString('he-IL') : '-'}
              </span>
            </div>
          </div>
        )}

        {/* Recent Trades */}
        {trades.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              עסקאות אחרונות
            </h3>
            <ScrollArea className="h-24">
              <div className="space-y-1">
                {trades.slice(0, 5).map((trade) => (
                  <div 
                    key={trade.id} 
                    className="flex items-center justify-between text-xs py-1 border-b border-border/50"
                  >
                    <div className="flex items-center gap-2">
                      {trade.status === 'filled' ? (
                        <CheckCircle2 className="w-3 h-3 text-profit" />
                      ) : (
                        <AlertCircle className="w-3 h-3 text-destructive" />
                      )}
                      <span className="font-mono">{trade.symbol}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{trade.type}</Badge>
                      <span className="text-profit font-mono">+{trade.expected_edge?.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Recent Logs */}
        {logs.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-muted-foreground">לוג מערכת</h3>
            <ScrollArea className="h-20">
              <div className="space-y-1">
                {logs.slice(0, 8).map((log) => (
                  <div 
                    key={log.id} 
                    className="text-xs text-muted-foreground truncate"
                  >
                    <span className={`
                      ${log.level === 'error' ? 'text-destructive' : ''}
                      ${log.level === 'warn' ? 'text-warning' : ''}
                      ${log.level === 'info' ? 'text-foreground' : ''}
                    `}>
                      [{log.component}]
                    </span>{' '}
                    {log.message}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-2 text-xs">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
