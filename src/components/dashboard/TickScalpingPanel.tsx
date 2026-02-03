import { useState, useEffect } from "react";
import { 
  Zap, 
  Play, 
  Square, 
  TrendingUp,
  Activity,
  Wifi,
  WifiOff,
  ArrowUpRight,
  ArrowDownRight,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTickScalping } from "@/hooks/useTickScalping";
import { formatUSDT } from "@/lib/gate-api";
import { useToast } from "@/hooks/use-toast";

// Top trading pairs for scalping
const SCALP_PAIRS = [
  'BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT',
  'ADA_USDT', 'AVAX_USDT', 'SHIB_USDT', 'LINK_USDT', 'DOT_USDT',
];

interface TickLog {
  time: string;
  pair: string;
  price: number;
  action: string;
  executed: boolean;
}

export function TickScalpingPanel() {
  const { toast } = useToast();
  const [balance] = useState(50);
  const [tickLogs, setTickLogs] = useState<TickLog[]>([]);
  
  const { state, start, stop, isConnected } = useTickScalping({
    pairs: SCALP_PAIRS,
    maxPositions: 3,
    balance,
  });

  // Add tick to logs
  useEffect(() => {
    if (state.lastTick) {
      setTickLogs(prev => [{
        time: new Date().toLocaleTimeString('he-IL'),
        pair: state.lastTick!.pair,
        price: state.lastTick!.price,
        action: state.lastTick!.action,
        executed: state.lastTick!.action.includes('buy') || state.lastTick!.action.includes('sell'),
      }, ...prev].slice(0, 50));
    }
  }, [state.lastTick]);

  const handleStart = async () => {
    try {
      await start();
      toast({ title: '⚡ Tick Scalping Started', description: 'Real-time trading active' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to start', variant: 'destructive' });
    }
  };

  const handleStop = () => {
    stop();
    toast({ title: '⏹️ Tick Scalping Stopped' });
  };

  const winRate = state.tradesExecuted > 0 
    ? ((state.pnlTotal > 0 ? 1 : 0) / state.tradesExecuted * 100).toFixed(0) 
    : '0';

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Zap className={`w-4 h-4 ${state.isActive ? 'text-warning animate-pulse' : 'text-muted-foreground'}`} />
          <h2 className="font-semibold text-sm">Tick-by-Tick Scalping</h2>
          {state.isActive ? (
            <Badge variant="outline" className="text-xs border-warning/50 text-warning animate-pulse">
              <Wifi className="w-3 h-3 mr-1" />
              LIVE
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs border-muted-foreground/50 text-muted-foreground">
              <WifiOff className="w-3 h-3 mr-1" />
              OFF
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <div className="w-2 h-2 bg-profit rounded-full animate-pulse" />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Controls */}
        <div className="flex items-center gap-2">
          {!state.isActive ? (
            <Button 
              onClick={handleStart} 
              className="flex-1 bg-warning hover:bg-warning/80 text-black"
            >
              <Play className="w-4 h-4 mr-2" />
              Start Tick Scalping
            </Button>
          ) : (
            <Button 
              onClick={handleStop} 
              variant="destructive" 
              className="flex-1"
            >
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          )}
        </div>

        {/* Live Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Ticks/sec</p>
            <p className="text-xl font-bold font-mono text-warning">
              {state.isActive ? Math.round(state.ticksProcessed / Math.max(1, Date.now() / 1000 - Date.now() / 1000) || 2) : 0}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Trades</p>
            <p className="text-xl font-bold font-mono">{state.tradesExecuted}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">P&L</p>
            <p className={`text-xl font-bold font-mono ${state.pnlTotal >= 0 ? 'text-profit' : 'text-destructive'}`}>
              {state.pnlTotal >= 0 ? '+' : ''}{formatUSDT(state.pnlTotal)}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="text-xl font-bold font-mono">{state.activePositions.length}</p>
          </div>
        </div>

        {/* Active Positions */}
        {state.activePositions.length > 0 && (
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-2">
            <p className="text-xs text-warning mb-1 flex items-center gap-1">
              <Activity className="w-3 h-3" />
              Active Scalps
            </p>
            <div className="flex flex-wrap gap-1">
              {state.activePositions.map(pair => (
                <Badge key={pair} variant="outline" className="text-xs border-warning/50 text-warning">
                  {pair.replace('_', '/')}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Tick Feed */}
        <div className="space-y-2">
          <h3 className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Live Tick Feed
          </h3>
          <ScrollArea className="h-40">
            <div className="space-y-1">
              {tickLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {state.isActive ? 'Waiting for ticks...' : 'Start scalping to see ticks'}
                </p>
              ) : (
                tickLogs.map((log, i) => (
                  <div 
                    key={i} 
                    className={`flex items-center justify-between text-xs py-1 px-2 rounded ${
                      log.executed ? 'bg-warning/10 border border-warning/30' : 'border-b border-border/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground font-mono">{log.time}</span>
                      <span className="font-mono font-medium">{log.pair.replace('_', '/')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">${log.price.toFixed(4)}</span>
                      {log.executed ? (
                        log.action.includes('buy') ? (
                          <ArrowUpRight className="w-3 h-3 text-profit" />
                        ) : (
                          <ArrowDownRight className="w-3 h-3 text-destructive" />
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Errors */}
        {state.errors.length > 0 && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-2 text-xs">
            <p className="font-medium mb-1">Recent Errors:</p>
            {state.errors.slice(-3).map((err, i) => (
              <p key={i} className="truncate">{err}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
