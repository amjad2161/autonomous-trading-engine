import { useState } from "react";
import { 
  Play, 
  Square, 
  Pause, 
  Settings, 
  Zap, 
  TrendingUp, 
  TrendingDown,
  RefreshCw,
  DollarSign,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useContinuousTrading } from "@/hooks/useContinuousTrading";
import { formatUSDT } from "@/lib/gate-api";

export function ContinuousTradingPanel() {
  const { 
    settings, 
    setSettings, 
    state, 
    start, 
    stop, 
    togglePause, 
    resetStats,
    liquidateNow 
  } = useContinuousTrading();
  
  const [showSettings, setShowSettings] = useState(false);
  const [isLiquidating, setIsLiquidating] = useState(false);

  const winRate = state.totalTrades > 0 
    ? (state.successfulTrades / state.totalTrades * 100).toFixed(1) 
    : '0.0';

  const handleLiquidate = async () => {
    setIsLiquidating(true);
    try {
      await liquidateNow();
    } finally {
      setIsLiquidating(false);
    }
  };

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Zap className={`w-4 h-4 ${state.isRunning ? 'text-profit animate-pulse' : 'text-muted-foreground'}`} />
          <h2 className="font-semibold text-sm">מסחר רציף</h2>
          {state.isRunning && (
            <Badge variant="outline" className="text-xs border-profit/50 text-profit animate-pulse">
              פעיל
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Main Controls */}
        <div className="flex items-center gap-2">
          {!state.isRunning ? (
            <Button onClick={start} className="flex-1 bg-profit hover:bg-profit/80">
              <Play className="w-4 h-4 mr-2" />
              הפעל מסחר
            </Button>
          ) : (
            <>
              <Button 
                onClick={togglePause} 
                variant="outline" 
                className="flex-1"
              >
                {state.isPaused ? (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    המשך
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4 mr-2" />
                    השהה
                  </>
                )}
              </Button>
              <Button onClick={stop} variant="destructive" className="flex-1">
                <Square className="w-4 h-4 mr-2" />
                עצור
              </Button>
            </>
          )}
        </div>

        {/* Quick Liquidate Button */}
        <Button 
          onClick={handleLiquidate} 
          variant="outline" 
          className="w-full"
          disabled={isLiquidating}
        >
          {isLiquidating ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <DollarSign className="w-4 h-4 mr-2" />
          )}
          {isLiquidating ? 'ממיר...' : 'המר הכל ל-USDT'}
        </Button>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">יתרה נוכחית</p>
            <p className="text-lg font-bold font-mono">{formatUSDT(state.currentBalance)}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">P&L סה"כ</p>
            <p className={`text-lg font-bold font-mono ${state.totalPnL >= 0 ? 'text-profit' : 'text-destructive'}`}>
              {state.totalPnL >= 0 ? '+' : ''}{formatUSDT(state.totalPnL)}
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">מחזורים</p>
            <p className="text-lg font-bold font-mono">{state.cycleCount}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="text-lg font-bold font-mono">{winRate}%</p>
          </div>
        </div>

        {/* Last Cycle Info */}
        {state.lastCycle && (
          <div className="bg-muted/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">מחזור אחרון</span>
              <span className="text-xs text-muted-foreground">
                {new Date(state.lastCycle.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>הזדמנויות: {state.lastCycle.opportunities}</span>
              <span>עסקאות: {state.lastCycle.tradesSuccessful}/{state.lastCycle.tradesExecuted}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">P&L:</span>
              <span className={`font-mono font-bold ${state.lastCycle.pnl >= 0 ? 'text-profit' : 'text-destructive'}`}>
                {state.lastCycle.pnl >= 0 ? '+' : ''}{formatUSDT(state.lastCycle.pnl)}
              </span>
            </div>
          </div>
        )}

        {/* Settings Panel */}
        {showSettings && (
          <div className="border border-border rounded-lg p-3 space-y-4 bg-background/50">
            <h3 className="text-sm font-medium">הגדרות</h3>
            
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Min Edge</span>
                  <span className="font-mono">{settings.minEdge}%</span>
                </div>
                <Slider
                  value={[settings.minEdge]}
                  onValueChange={([v]) => setSettings(s => ({ ...s, minEdge: v }))}
                  min={0.5}
                  max={10}
                  step={0.5}
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>גודל עסקה מקס'</span>
                  <span className="font-mono">{settings.maxTradeSize}%</span>
                </div>
                <Slider
                  value={[settings.maxTradeSize]}
                  onValueChange={([v]) => setSettings(s => ({ ...s, maxTradeSize: v }))}
                  min={1}
                  max={25}
                  step={1}
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>מרווח בין מחזורים</span>
                  <span className="font-mono">{settings.cycleIntervalSeconds}s</span>
                </div>
                <Slider
                  value={[settings.cycleIntervalSeconds]}
                  onValueChange={([v]) => setSettings(s => ({ ...s, cycleIntervalSeconds: v }))}
                  min={10}
                  max={120}
                  step={5}
                />
              </div>
              
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>הפסד יומי מקס'</span>
                  <span className="font-mono">${settings.maxDailyLoss}</span>
                </div>
                <Slider
                  value={[settings.maxDailyLoss]}
                  onValueChange={([v]) => setSettings(s => ({ ...s, maxDailyLoss: v }))}
                  min={1}
                  max={50}
                  step={1}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-xs">המר אוטומטית ל-USDT</span>
                <Switch
                  checked={settings.autoLiquidate}
                  onCheckedChange={(v) => setSettings(s => ({ ...s, autoLiquidate: v }))}
                />
              </div>
            </div>
            
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full"
              onClick={resetStats}
            >
              <RefreshCw className="w-3 h-3 mr-2" />
              אפס סטטיסטיקות
            </Button>
          </div>
        )}

        {/* Recent Cycles */}
        {state.recentCycles.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-muted-foreground">מחזורים אחרונים</h3>
            <ScrollArea className="h-24">
              <div className="space-y-1">
                {state.recentCycles.slice(0, 5).map((cycle, i) => (
                  <div 
                    key={cycle.timestamp} 
                    className="flex items-center justify-between text-xs py-1 border-b border-border/50"
                  >
                    <span className="text-muted-foreground">
                      {new Date(cycle.timestamp).toLocaleTimeString()}
                    </span>
                    <div className="flex items-center gap-2">
                      <span>{cycle.tradesSuccessful}/{cycle.tradesExecuted}</span>
                      <span className={`font-mono ${cycle.pnl >= 0 ? 'text-profit' : 'text-destructive'}`}>
                        {cycle.pnl >= 0 ? '+' : ''}{cycle.pnl.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Errors */}
        {state.errors.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              שגיאות
            </h3>
            <ScrollArea className="h-16">
              <div className="space-y-1">
                {state.errors.map((error, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{error}</p>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
