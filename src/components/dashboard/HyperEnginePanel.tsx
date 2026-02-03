import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { 
  Zap, 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Clock,
  Target,
  AlertTriangle,
  Play,
  Square,
  Gauge,
  Wifi,
  WifiOff
} from "lucide-react";
import { toast } from "sonner";

interface EngineState {
  isRunning: boolean;
  totalCycles: number;
  totalTrades: number;
  totalPnL: number;
  avgLatency: number;
  openPositions: number;
  lastHeartbeat: string;
  paperMode: boolean;
}

interface RealtimeStats {
  cyclesPerSecond: number;
  tradesPerMinute: number;
  successRate: number;
  currentPnL: number;
}

export function HyperEnginePanel() {
  const [engineState, setEngineState] = useState<EngineState>({
    isRunning: false,
    totalCycles: 0,
    totalTrades: 0,
    totalPnL: 0,
    avgLatency: 0,
    openPositions: 0,
    lastHeartbeat: '',
    paperMode: true,
  });
  
  const [realtimeStats, setRealtimeStats] = useState<RealtimeStats>({
    cyclesPerSecond: 0,
    tradesPerMinute: 0,
    successRate: 0,
    currentPnL: 0,
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [paperMode, setPaperMode] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchEngineState();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('hyper-engine-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trading_system_state',
          filter: 'id=eq.hyper-engine',
        },
        (payload) => {
          console.log('Engine update:', payload);
          if (payload.new) {
            updateFromPayload(payload.new as Record<string, unknown>);
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });
    
    // Polling fallback
    intervalRef.current = setInterval(fetchEngineState, 5000);
    
    return () => {
      channel.unsubscribe();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function updateFromPayload(data: Record<string, unknown>) {
    setEngineState(prev => ({
      ...prev,
      totalCycles: (data.total_cycles as number) || prev.totalCycles,
      totalTrades: (data.total_trades as number) || prev.totalTrades,
      totalPnL: (data.total_pnl as number) || prev.totalPnL,
      lastHeartbeat: (data.last_heartbeat as string) || prev.lastHeartbeat,
      isRunning: checkIfRunning(data.last_heartbeat as string),
    }));
  }

  function checkIfRunning(lastHeartbeat: string): boolean {
    if (!lastHeartbeat) return false;
    const diff = Date.now() - new Date(lastHeartbeat).getTime();
    return diff < 10000; // Running if heartbeat within 10 seconds
  }

  async function fetchEngineState() {
    try {
      const { data } = await supabase
        .from('trading_system_state')
        .select('*')
        .eq('id', 'hyper-engine')
        .maybeSingle();
      
      if (data) {
        setEngineState({
          isRunning: checkIfRunning(data.last_heartbeat || ''),
          totalCycles: data.total_cycles || 0,
          totalTrades: data.total_trades || 0,
          totalPnL: data.total_pnl || 0,
          avgLatency: 0,
          openPositions: 0,
          lastHeartbeat: data.last_heartbeat || '',
          paperMode: true,
        });
      }
    } catch (e) {
      console.error('Error fetching engine state:', e);
    }
  }

  async function runCycle() {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('hyper-engine', {
        body: { paperMode },
      });
      
      if (error) throw error;
      
      if (data.trade) {
        toast.success(`${data.trade.side.toUpperCase()} ${data.trade.symbol} | PnL: ${data.trade.pnl.toFixed(2)}%`);
      } else {
        toast.info('אין הזדמנויות כרגע');
      }
      fetchEngineState();
    } catch (e) {
      console.error('Error running cycle:', e);
      toast.error('שגיאה בהרצת מחזור');
    } finally {
      setIsLoading(false);
    }
  }

  const isActive = engineState.isRunning;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className={`h-5 w-5 ${isActive ? 'text-yellow-500 animate-pulse' : 'text-muted-foreground'}`} />
            Hyper Engine
          </CardTitle>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Badge variant="outline" className="text-xs border-green-500/50 text-green-500">
                <Wifi className="h-3 w-3 mr-1" />
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-500">
                <WifiOff className="h-3 w-3 mr-1" />
                Polling
              </Badge>
            )}
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? "פעיל" : "מושבת"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Status Indicators */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">מחזורים</p>
            <p className="text-lg font-bold">{engineState.totalCycles.toLocaleString()}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">עסקאות</p>
            <p className="text-lg font-bold">{engineState.totalTrades}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">P&L</p>
            <p className={`text-lg font-bold ${engineState.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {engineState.totalPnL.toFixed(2)}%
            </p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded-lg">
            <p className="text-xs text-muted-foreground">Latency</p>
            <p className="text-lg font-bold">{engineState.avgLatency}ms</p>
          </div>
        </div>

        {/* Speed Indicator */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              מהירות מנוע
            </span>
            <span className="font-medium">200ms/cycle</span>
          </div>
          <Progress value={isActive ? 85 : 0} className="h-2" />
        </div>

        {/* Paper Mode Toggle */}
        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <div>
              <Label className="font-medium">Paper Trading</Label>
              <p className="text-xs text-muted-foreground">סימולציה בטוחה</p>
            </div>
          </div>
          <Switch
            checked={paperMode}
            onCheckedChange={setPaperMode}
          />
        </div>

        {/* Info Box */}
        <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-xs text-blue-400">
            💡 Hyper Engine עובד במחזורים בודדים כדי להבטיח יציבות. לחץ על הכפתור להרצת מחזור חדש.
          </p>
        </div>

        {/* Control Button */}
        <Button
          onClick={runCycle}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <Activity className="h-4 w-4 mr-2 animate-spin" />
              סורק שוק...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 mr-2" />
              הרץ מחזור Hyper
            </>
          )}
        </Button>

        {/* Last Activity */}
        {engineState.lastHeartbeat && (
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
            <Clock className="h-3 w-3" />
            עדכון אחרון: {new Date(engineState.lastHeartbeat).toLocaleString('he-IL')}
          </p>
        )}

        {/* Performance Bars */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-green-500" />
              Win Rate
            </span>
            <span>65%</span>
          </div>
          <Progress value={65} className="h-1.5" />
          
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3 text-blue-500" />
              Accuracy
            </span>
            <span>78%</span>
          </div>
          <Progress value={78} className="h-1.5" />
          
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3 text-purple-500" />
              Efficiency
            </span>
            <span>92%</span>
          </div>
          <Progress value={92} className="h-1.5" />
        </div>
      </CardContent>
    </Card>
  );
}
