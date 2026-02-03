import { Shield, AlertTriangle, Settings, TrendingDown, Zap, Power, DollarSign, Percent, Activity } from "lucide-react";
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

export function RiskControlPanel() {
  const { settings, updateSettings, dailyStats, shouldHaltTrading, resetDailyStats } = useAutoExecuteSettings();
  const haltStatus = shouldHaltTrading();

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Risk Control</h2>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <button className="p-1 rounded hover:bg-muted transition-colors">
              <Settings className="w-4 h-4 text-muted-foreground" />
            </button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Auto-Execute Settings</SheetTitle>
              <SheetDescription>
                Configure automatic trade execution parameters
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-6">
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
                  min={5}
                  max={100}
                  step={5}
                />
                <p className="text-xs text-muted-foreground">Maximum USDT per trade</p>
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
                <p className="text-xs text-muted-foreground">Only execute if edge exceeds this</p>
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
                  min={10}
                  max={200}
                  step={10}
                />
                <p className="text-xs text-muted-foreground">Kill switch activates if exceeded</p>
              </div>

              {/* Allowed Types */}
              <div className="space-y-3">
                <label className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  Allowed Strategies
                </label>
                <div className="space-y-2">
                  <label className="flex items-center justify-between p-2 rounded bg-muted/30">
                    <span className="text-sm">Spread Trading</span>
                    <Switch
                      checked={settings.allowedTypes.includes('spread')}
                      onCheckedChange={(checked) => {
                        const types = checked
                          ? [...settings.allowedTypes, 'spread']
                          : settings.allowedTypes.filter(t => t !== 'spread');
                        updateSettings({ allowedTypes: types as ('spread' | 'arbitrage')[] });
                      }}
                    />
                  </label>
                  <label className="flex items-center justify-between p-2 rounded bg-muted/30">
                    <span className="text-sm">Triangular Arbitrage</span>
                    <Switch
                      checked={settings.allowedTypes.includes('arbitrage')}
                      onCheckedChange={(checked) => {
                        const types = checked
                          ? [...settings.allowedTypes, 'arbitrage']
                          : settings.allowedTypes.filter(t => t !== 'arbitrage');
                        updateSettings({ allowedTypes: types as ('spread' | 'arbitrage')[] });
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
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
                  {settings.enabled ? 'Active' : 'Disabled'}
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
            <div className="mt-3 p-2 rounded bg-destructive/20 border border-destructive/30">
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {haltStatus.reason}
              </p>
            </div>
          )}
        </div>

        {/* Daily Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Power className="w-3 h-3" />
              <span>Daily P&L</span>
            </div>
            <p className={`font-mono text-sm font-semibold ${
              dailyStats.totalPnL >= 0 ? 'text-profit' : 'text-destructive'
            }`}>
              {dailyStats.totalPnL >= 0 ? '+' : ''}${dailyStats.totalPnL.toFixed(2)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Activity className="w-3 h-3" />
              <span>Trades Today</span>
            </div>
            <p className="font-mono text-sm font-semibold">
              {dailyStats.tradesExecuted}
            </p>
          </div>
        </div>

        {/* Risk Parameters Display */}
        <div className="space-y-2">
          <h3 className="text-xs text-muted-foreground">Active Guardrails</h3>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
              <span className="text-muted-foreground">Max Trade</span>
              <span className="font-mono">${settings.maxTradeSize}</span>
            </div>
            <div className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
              <span className="text-muted-foreground">Min Edge</span>
              <span className="font-mono">{settings.minEdge}%</span>
            </div>
            <div className="flex items-center justify-between text-xs p-2 rounded bg-muted/20">
              <span className="text-muted-foreground">Loss Limit</span>
              <span className="font-mono text-destructive">${settings.dailyLossLimit}</span>
            </div>
          </div>
        </div>

        {/* Quick Controls */}
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={resetDailyStats}
            className="px-3 py-2 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors flex items-center justify-center gap-2"
          >
            <TrendingDown className="w-4 h-4" />
            Reset Stats
          </button>
          <button className="px-3 py-2 rounded-md bg-destructive/20 hover:bg-destructive/30 text-destructive text-xs font-medium transition-colors flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Kill Switch
          </button>
        </div>
      </div>
    </div>
  );
}
