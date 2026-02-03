import { 
  Shield, AlertTriangle, Settings, TrendingDown, Zap, Power, DollarSign, 
  Percent, Activity, Clock, Target, BarChart3, RefreshCw, Ban,
  TrendingUp, ArrowUpRight, ArrowDownRight, Timer
} from "lucide-react";
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { useAutoExecuteSettings } from '@/hooks/useAutoExecute';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RiskControlPanel() {
  const { 
    settings, 
    updateSettings, 
    dailyStats, 
    shouldHaltTrading, 
    resetDailyStats,
    circuitBreaker,
    resetCircuitBreaker,
    triggerEmergencyStop,
    calculateStats,
    tradeHistory,
  } = useAutoExecuteSettings();
  
  const haltStatus = shouldHaltTrading();
  const stats = calculateStats();

  // Get circuit breaker status color
  const getStatusColor = (level: string) => {
    switch (level) {
      case 'none': return 'text-profit';
      case 'caution': return 'text-warning';
      case 'warning': return 'text-warning';
      case 'critical': return 'text-destructive';
      case 'halted': return 'text-destructive';
      default: return 'text-muted-foreground';
    }
  };

  const getStatusBg = (level: string) => {
    switch (level) {
      case 'none': return 'bg-profit/10 border-profit/30';
      case 'caution': return 'bg-warning/10 border-warning/30';
      case 'warning': return 'bg-warning/10 border-warning/30';
      case 'critical': return 'bg-destructive/10 border-destructive/30';
      case 'halted': return 'bg-destructive/20 border-destructive/50';
      default: return 'bg-muted/30 border-border';
    }
  };

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Risk Control</h2>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusBg(circuitBreaker.level)}`}>
            {circuitBreaker.level.toUpperCase()}
          </span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <button className="p-1 rounded hover:bg-muted transition-colors">
              <Settings className="w-4 h-4 text-muted-foreground" />
            </button>
          </SheetTrigger>
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Auto-Execute Settings</SheetTitle>
              <SheetDescription>
                Configure automatic trade execution parameters
              </SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="limits" className="mt-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="limits">Limits</TabsTrigger>
                <TabsTrigger value="strategies">Strategies</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>
              
              <TabsContent value="limits" className="mt-4 space-y-5">
                {/* Max Trade Size */}
                <div className="space-y-2">
                  <label className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4" />
                      Max Trade Size
                    </span>
                    <span className="font-mono text-primary">${settings.maxTradeSize}</span>
                  </label>
                  <Slider
                    value={[settings.maxTradeSize]}
                    onValueChange={([v]) => updateSettings({ maxTradeSize: v })}
                    min={10}
                    max={500}
                    step={10}
                  />
                </div>

                {/* Max Position Size */}
                <div className="space-y-2">
                  <label className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Max Position (% of Portfolio)
                    </span>
                    <span className="font-mono text-primary">{settings.maxPositionSize}%</span>
                  </label>
                  <Slider
                    value={[settings.maxPositionSize]}
                    onValueChange={([v]) => updateSettings({ maxPositionSize: v })}
                    min={1}
                    max={20}
                    step={1}
                  />
                </div>

                {/* Min Edge */}
                <div className="space-y-2">
                  <label className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Percent className="w-4 h-4" />
                      Minimum Edge
                    </span>
                    <span className="font-mono text-primary">{settings.minEdge}%</span>
                  </label>
                  <Slider
                    value={[settings.minEdge * 100]}
                    onValueChange={([v]) => updateSettings({ minEdge: v / 100 })}
                    min={10}
                    max={100}
                    step={5}
                  />
                </div>

                {/* Daily Loss Limit */}
                <div className="space-y-2">
                  <label className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Daily Loss Limit
                    </span>
                    <span className="font-mono text-destructive">${settings.dailyLossLimit}</span>
                  </label>
                  <Slider
                    value={[settings.dailyLossLimit]}
                    onValueChange={([v]) => updateSettings({ dailyLossLimit: v })}
                    min={20}
                    max={500}
                    step={10}
                  />
                </div>

                {/* Slippage Tolerance */}
                <div className="space-y-2">
                  <label className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <TrendingDown className="w-4 h-4" />
                      Slippage Tolerance
                    </span>
                    <span className="font-mono text-warning">{settings.slippageTolerance}%</span>
                  </label>
                  <Slider
                    value={[settings.slippageTolerance * 100]}
                    onValueChange={([v]) => updateSettings({ slippageTolerance: v / 100 })}
                    min={10}
                    max={200}
                    step={10}
                  />
                </div>
              </TabsContent>
              
              <TabsContent value="strategies" className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground mb-3">
                  Enable strategies for auto-execution
                </p>
                {[
                  { key: 'spread', label: 'Spread Trading', desc: 'Market making on wide spreads' },
                  { key: 'arbitrage', label: 'Triangular Arbitrage', desc: 'Cross-pair price inefficiencies' },
                  { key: 'momentum', label: 'Momentum', desc: 'Trend following strategies' },
                  { key: 'breakout', label: 'Breakout', desc: 'Price breakout detection' },
                  { key: 'reversion', label: 'Mean Reversion', desc: 'Oversold bounce plays' },
                  { key: 'volume_spike', label: 'Volume Spike', desc: 'Volume anomaly detection' },
                ].map(strategy => (
                  <label 
                    key={strategy.key}
                    className="flex items-center justify-between p-3 rounded bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <div>
                      <span className="text-sm font-medium">{strategy.label}</span>
                      <p className="text-xs text-muted-foreground">{strategy.desc}</p>
                    </div>
                    <Switch
                      checked={settings.allowedTypes.includes(strategy.key as any)}
                      onCheckedChange={(checked) => {
                        const types = checked
                          ? [...settings.allowedTypes, strategy.key]
                          : settings.allowedTypes.filter(t => t !== strategy.key);
                        updateSettings({ allowedTypes: types as any });
                      }}
                    />
                  </label>
                ))}
              </TabsContent>
              
              <TabsContent value="advanced" className="mt-4 space-y-5">
                {/* Max Trades Per Hour */}
                <div className="space-y-2">
                  <label className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Max Trades/Hour
                    </span>
                    <span className="font-mono">{settings.maxTradesPerHour}</span>
                  </label>
                  <Slider
                    value={[settings.maxTradesPerHour]}
                    onValueChange={([v]) => updateSettings({ maxTradesPerHour: v })}
                    min={1}
                    max={30}
                    step={1}
                  />
                </div>

                {/* Max Open Trades */}
                <div className="space-y-2">
                  <label className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" />
                      Max Open Trades
                    </span>
                    <span className="font-mono">{settings.maxOpenTrades}</span>
                  </label>
                  <Slider
                    value={[settings.maxOpenTrades]}
                    onValueChange={([v]) => updateSettings({ maxOpenTrades: v })}
                    min={1}
                    max={10}
                    step={1}
                  />
                </div>

                {/* Cooldown After Loss */}
                <div className="space-y-2">
                  <label className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Timer className="w-4 h-4" />
                      Cooldown After Loss
                    </span>
                    <span className="font-mono">{settings.cooldownAfterLoss} min</span>
                  </label>
                  <Slider
                    value={[settings.cooldownAfterLoss]}
                    onValueChange={([v]) => updateSettings({ cooldownAfterLoss: v })}
                    min={1}
                    max={30}
                    step={1}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </SheetContent>
        </Sheet>
      </div>
      
      <div className="p-3 sm:p-4 space-y-4 flex-1 overflow-auto">
        {/* Auto-Execute Master Toggle */}
        <div className={`p-4 rounded-lg border ${
          settings.enabled 
            ? 'bg-profit/10 border-profit/30' 
            : 'bg-muted/30 border-border'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                settings.enabled ? 'bg-profit/20' : 'bg-muted'
              }`}>
                <Zap className={`w-5 h-5 ${settings.enabled ? 'text-profit' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <p className="font-semibold text-sm">Auto-Execute</p>
                <p className="text-xs text-muted-foreground">
                  {settings.enabled ? 'Active - Scanning...' : 'Disabled'}
                </p>
              </div>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) => updateSettings({ enabled: checked })}
              disabled={haltStatus.halt}
            />
          </div>
          
          {haltStatus.halt && (
            <div className={`mt-3 p-2 rounded border ${getStatusBg(haltStatus.level)}`}>
              <p className={`text-xs flex items-center gap-1 ${getStatusColor(haltStatus.level)}`}>
                <AlertTriangle className="w-3 h-3" />
                {haltStatus.reason}
              </p>
            </div>
          )}
        </div>

        {/* Performance Stats Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
              <Power className="w-3 h-3" />
              <span>Daily P&L</span>
            </div>
            <p className={`font-mono text-sm font-bold ${
              dailyStats.totalPnL >= 0 ? 'text-profit' : 'text-destructive'
            }`}>
              {dailyStats.totalPnL >= 0 ? '+' : ''}${dailyStats.totalPnL.toFixed(2)}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
              <Activity className="w-3 h-3" />
              <span>Trades</span>
            </div>
            <p className="font-mono text-sm font-bold">
              {dailyStats.tradesExecuted}
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
              <ArrowUpRight className="w-3 h-3 text-profit" />
              <span>Win Rate</span>
            </div>
            <p className={`font-mono text-sm font-bold ${stats.winRate >= 50 ? 'text-profit' : 'text-warning'}`}>
              {stats.winRate.toFixed(1)}%
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
              <BarChart3 className="w-3 h-3" />
              <span>Profit Factor</span>
            </div>
            <p className={`font-mono text-sm font-bold ${stats.profitFactor >= 1.5 ? 'text-profit' : stats.profitFactor >= 1 ? 'text-warning' : 'text-destructive'}`}>
              {stats.profitFactor.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Circuit Breaker Status */}
        {circuitBreaker.consecutiveLosses > 0 && (
          <div className={`p-3 rounded-lg border ${getStatusBg(circuitBreaker.level)}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-medium ${getStatusColor(circuitBreaker.level)}`}>
                Circuit Breaker
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusBg(circuitBreaker.level)}`}>
                {circuitBreaker.level.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {circuitBreaker.consecutiveLosses} consecutive loss{circuitBreaker.consecutiveLosses > 1 ? 'es' : ''}
            </p>
            {circuitBreaker.cooldownUntil && (
              <p className="text-xs text-warning mt-1">
                Cooldown: {Math.ceil((circuitBreaker.cooldownUntil - Date.now()) / 60000)} min remaining
              </p>
            )}
          </div>
        )}

        {/* Active Guardrails */}
        <div className="space-y-2">
          <h3 className="text-xs text-muted-foreground flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Active Guardrails
          </h3>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
              <span className="text-muted-foreground">Max Trade</span>
              <span className="font-mono">${settings.maxTradeSize}</span>
            </div>
            <div className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
              <span className="text-muted-foreground">Min Edge</span>
              <span className="font-mono">{settings.minEdge}%</span>
            </div>
            <div className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
              <span className="text-muted-foreground">Daily Limit</span>
              <span className="font-mono text-destructive">${settings.dailyLossLimit}</span>
            </div>
            <div className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
              <span className="text-muted-foreground">Strategies</span>
              <span className="font-mono">{settings.allowedTypes.length} active</span>
            </div>
          </div>
        </div>

        {/* Quick Controls */}
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={() => {
              resetDailyStats();
              resetCircuitBreaker();
            }}
            className="px-3 py-2 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset Stats
          </button>
          <button 
            onClick={() => triggerEmergencyStop('Manual kill switch activated')}
            className="px-3 py-2 rounded-md bg-destructive/20 hover:bg-destructive/30 text-destructive text-xs font-medium transition-colors flex items-center justify-center gap-2"
          >
            <Ban className="w-3.5 h-3.5" />
            KILL SWITCH
          </button>
        </div>
      </div>
    </div>
  );
}
