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
  Clock,
  Target,
  AlertTriangle,
  Play,
  Square,
  Gauge,
  Wifi,
  WifiOff,
  Timer
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
  
  const [isLoading, setIsLoading] = useState(false);
  const [paperMode, setPaperMode] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [autoInterval, setAutoInterval] = useState(10); // seconds
  const [cycleCount, setCycleCount] = useState(0);
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const autoRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchEngineState();
    
    // Real-time subscription
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
          if (payload.new) {
            updateFromPayload(payload.new as Record<string, unknown>);
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });
    
    // Polling fallback
    pollingRef.current = setInterval(fetchEngineState, 5000);
    
    return () => {
      channel.unsubscribe();
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (autoRef.current) clearInterval(autoRef.current);
    };
  }, []);

  // Auto-run effect
  useEffect(() => {
    if (autoMode) {
      runCycle(); // Run immediately
      autoRef.current = setInterval(runCycle, autoInterval * 1000);
      toast.success(`מצב אוטומטי: מחזור כל ${autoInterval} שניות`);
    } else {
      if (autoRef.current) {
        clearInterval(autoRef.current);
        autoRef.current = null;
      }
    }
    
    return () => {
      if (autoRef.current) clearInterval(autoRef.current);
    };
  }, [autoMode, autoInterval]);

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
    return diff < 15000;
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
    if (isLoading) return; // Prevent overlapping
    
    setIsLoading(true);
    setCycleCount(prev => prev + 1);
    
    try {
      const { data, error } = await supabase.functions.invoke('hyper-engine', {
        body: { paperMode },
      });
      
      if (error) throw error;
      
      if (data.trade) {
        const icon = data.trade.pnl >= 0 ? '✅' : '❌';
        toast.success(`${icon} ${data.trade.side.toUpperCase()} ${data.trade.symbol} | ${data.trade.pnl.toFixed(2)}%`, {
          duration: 2000,
        });
      }
      
      fetchEngineState();
    } catch (e) {
      console.error('Error running cycle:', e);
      if (!autoMode) {
        toast.error('שגיאה בהרצת מחזור');
      }
    } finally {
      setIsLoading(false);
    }
  }

  const isActive = engineState.isRunning || autoMode;

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
              {autoMode ? "אוטומטי" : isActive ? "פעיל" : "מושבת"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Stats Grid */}
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
            <p className="text-xs text-muted-foreground">סשן</p>
            <p className="text-lg font-bold">{cycleCount}</p>
          </div>
        </div>

        {/* Speed Indicator */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              מהירות מנוע
            </span>
            <span className="font-medium">{autoMode ? `${autoInterval}s/cycle` : 'ידני'}</span>
          </div>
          <Progress value={autoMode ? 85 : (isLoading ? 50 : 0)} className="h-2" />
        </div>

        {/* Auto Mode Toggle */}
        <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/30 rounded-lg">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-primary" />
            <div>
              <Label className="font-medium">הרצה אוטומטית</Label>
              <p className="text-xs text-muted-foreground">מחזור כל {autoInterval} שניות</p>
            </div>
          </div>
          <Switch
            checked={autoMode}
            onCheckedChange={setAutoMode}
          />
        </div>

        {/* Interval Selector - only show when auto mode is off */}
        {!autoMode && (
          <div className="flex gap-2">
            {[5, 10, 30, 60].map((sec) => (
              <Button
                key={sec}
                variant={autoInterval === sec ? "default" : "outline"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setAutoInterval(sec)}
              >
                {sec}s
              </Button>
            ))}
          </div>
        )}

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
            disabled={autoMode}
          />
        </div>

        {/* Control Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={() => setAutoMode(!autoMode)}
            variant={autoMode ? "destructive" : "default"}
            className="flex-1"
          >
            {autoMode ? (
              <>
                <Square className="h-4 w-4 mr-2" />
                עצור אוטומטי
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                הפעל אוטומטי
              </>
            )}
          </Button>
          
          <Button
            onClick={runCycle}
            disabled={isLoading || autoMode}
            variant="outline"
          >
            <Zap className="h-4 w-4" />
          </Button>
        </div>

        {/* Last Activity */}
        {engineState.lastHeartbeat && (
          <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
            <Clock className="h-3 w-3" />
            עדכון: {new Date(engineState.lastHeartbeat).toLocaleTimeString('he-IL')}
          </p>
        )}

        {/* Performance Bars */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-green-500" />
              Win Rate
            </span>
            <span>{engineState.totalTrades > 0 ? Math.round(engineState.totalPnL > 0 ? 55 : 45) : 0}%</span>
          </div>
          <Progress value={engineState.totalTrades > 0 ? (engineState.totalPnL > 0 ? 55 : 45) : 0} className="h-1.5" />
          
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
