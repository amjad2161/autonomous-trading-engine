import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Zap, 
  Play, 
  Square, 
  RotateCcw, 
  TrendingUp, 
  TrendingDown,
  Clock,
  Target,
  Activity,
  AlertTriangle,
  DollarSign,
  Gauge
} from 'lucide-react';
import { useRapidTrader } from '@/hooks/useRapidTrader';

export function RapidTraderPanel() {
  const { config, setConfig, stats, start, stop, resetStats, executeCycle } = useRapidTrader();
  const [showSettings, setShowSettings] = useState(false);

  const winRate = stats.totalTrades > 0 
    ? ((stats.successfulTrades / stats.totalTrades) * 100).toFixed(1) 
    : '0.0';

  const pnlPercent = stats.startBalance > 0 
    ? ((stats.totalProfit / stats.startBalance) * 100).toFixed(3) 
    : '0.000';

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-background to-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Rapid Trader</CardTitle>
              <p className="text-xs text-muted-foreground">מסחר מהיר אלפי עסקאות</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge 
              variant={stats.isRunning ? 'default' : 'secondary'}
              className={stats.isRunning ? 'bg-green-500 animate-pulse' : ''}
            >
              {stats.isRunning ? 'פעיל' : 'מושבת'}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Gauge className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Main Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold text-primary">
              {stats.cycleCount}
            </div>
            <div className="text-xs text-muted-foreground">מחזורים</div>
          </div>
          
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold">
              {stats.totalTrades}
            </div>
            <div className="text-xs text-muted-foreground">עסקאות</div>
          </div>
          
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className={`text-2xl font-bold ${stats.totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              ${stats.totalProfit.toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground">רווח כולל</div>
          </div>
          
          <div className="p-3 rounded-lg bg-muted/50 text-center">
            <div className="text-2xl font-bold text-blue-500">
              {winRate}%
            </div>
            <div className="text-xs text-muted-foreground">הצלחה</div>
          </div>
        </div>

        {/* Balance & Performance */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">יתרה נוכחית</span>
            </div>
            <div className="text-xl font-bold">${stats.currentBalance.toFixed(2)}</div>
            <div className={`text-xs ${parseFloat(pnlPercent) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {parseFloat(pnlPercent) >= 0 ? '+' : ''}{pnlPercent}% מההתחלה
            </div>
          </div>

          <div className="p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">ביצועים</span>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ממוצע לעסקה:</span>
                <span className={stats.avgProfitPercent >= 0 ? 'text-green-500' : 'text-red-500'}>
                  {stats.avgProfitPercent.toFixed(4)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">זמן ממוצע:</span>
                <span>{stats.avgDurationMs.toFixed(0)}ms</span>
              </div>
            </div>
          </div>
        </div>

        {/* Trade Breakdown */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-green-500">{stats.successfulTrades}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4 text-yellow-500" />
              <span className="text-yellow-500">{stats.partialTrades}</span>
            </div>
            <div className="flex items-center gap-1">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <span className="text-red-500">{stats.failedTrades}</span>
            </div>
          </div>
          {stats.lastCycleTime && (
            <span className="text-xs text-muted-foreground">
              עודכן: {new Date(stats.lastCycleTime).toLocaleTimeString('he-IL')}
            </span>
          )}
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <>
            <Separator />
            <div className="space-y-4">
              <h4 className="text-sm font-medium">הגדרות</h4>
              
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <Label>עסקאות למחזור</Label>
                    <span className="text-muted-foreground">{config.maxTradesPerCycle}</span>
                  </div>
                  <Slider
                    value={[config.maxTradesPerCycle]}
                    onValueChange={([v]) => setConfig(prev => ({ ...prev, maxTradesPerCycle: v }))}
                    min={1}
                    max={20}
                    step={1}
                    disabled={stats.isRunning}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <Label>גודל עסקה (USDT)</Label>
                    <span className="text-muted-foreground">${config.tradeAmountUSDT}</span>
                  </div>
                  <Slider
                    value={[config.tradeAmountUSDT]}
                    onValueChange={([v]) => setConfig(prev => ({ ...prev, tradeAmountUSDT: v }))}
                    min={3}
                    max={50}
                    step={1}
                    disabled={stats.isRunning}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <Label>מרווח מחזורים (שניות)</Label>
                    <span className="text-muted-foreground">{config.cycleIntervalSeconds}s</span>
                  </div>
                  <Slider
                    value={[config.cycleIntervalSeconds]}
                    onValueChange={([v]) => setConfig(prev => ({ ...prev, cycleIntervalSeconds: v }))}
                    min={5}
                    max={60}
                    step={5}
                    disabled={stats.isRunning}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <Label>נפח מינימלי ($)</Label>
                    <span className="text-muted-foreground">{(config.minVolume / 1000).toFixed(0)}K</span>
                  </div>
                  <Slider
                    value={[config.minVolume]}
                    onValueChange={([v]) => setConfig(prev => ({ ...prev, minVolume: v }))}
                    min={10000}
                    max={500000}
                    step={10000}
                    disabled={stats.isRunning}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* Recent Trades */}
        {stats.recentTrades.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-2">עסקאות אחרונות</h4>
              <ScrollArea className="h-32">
                <div className="space-y-1">
                  {stats.recentTrades.slice(0, 10).map((trade, i) => (
                    <div 
                      key={i}
                      className="flex items-center justify-between text-xs p-2 rounded bg-muted/30"
                    >
                      <div className="flex items-center gap-2">
                        {trade.status === 'success' ? (
                          <TrendingUp className="h-3 w-3 text-green-500" />
                        ) : trade.status === 'partial' ? (
                          <Clock className="h-3 w-3 text-yellow-500" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-red-500" />
                        )}
                        <span className="font-mono">{trade.pair.replace('_', '/')}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={trade.profit >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(4)}$
                        </span>
                        <span className="text-muted-foreground">{trade.durationMs}ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}

        {/* Errors */}
        {stats.errors.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <h4 className="text-sm font-medium">שגיאות אחרונות</h4>
              </div>
              <ScrollArea className="h-20">
                <div className="space-y-1">
                  {stats.errors.map((error, i) => (
                    <div key={i} className="text-xs text-muted-foreground p-1 bg-destructive/10 rounded">
                      {error}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}

        {/* Control Buttons */}
        <div className="flex gap-2">
          {stats.isRunning ? (
            <Button 
              onClick={stop} 
              variant="destructive" 
              className="flex-1"
            >
              <Square className="h-4 w-4 mr-2" />
              עצור
            </Button>
          ) : (
            <Button 
              onClick={start} 
              className="flex-1 bg-gradient-to-r from-primary to-primary/80"
            >
              <Play className="h-4 w-4 mr-2" />
              הפעל
            </Button>
          )}
          
          <Button 
            onClick={() => executeCycle()} 
            variant="outline"
            disabled={!stats.isRunning}
          >
            <Zap className="h-4 w-4" />
          </Button>
          
          <Button 
            onClick={resetStats} 
            variant="ghost"
            disabled={stats.isRunning}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
