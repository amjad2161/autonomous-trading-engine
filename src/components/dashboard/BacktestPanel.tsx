import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  FlaskConical, 
  Play, 
  TrendingUp, 
  TrendingDown, 
  Target,
  Activity,
  BarChart3,
  Clock
} from "lucide-react";
import { useBacktest, BacktestConfig, BacktestResult } from "@/hooks/useBacktest";
import { formatBacktestDate, getStrategyName } from "@/lib/backtest";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useToast } from "@/hooks/use-toast";

const POPULAR_PAIRS = [
  "BTC_USDT", "ETH_USDT", "SOL_USDT", "XRP_USDT", "DOGE_USDT",
  "ADA_USDT", "AVAX_USDT", "DOT_USDT", "MATIC_USDT", "LINK_USDT"
];

const STRATEGIES = [
  { value: 'spread', label: 'ניצול מרווחים', description: 'קנייה כשמחיר נמוך מהממוצע' },
  { value: 'momentum', label: 'מומנטום', description: 'מעקב אחר מגמות חזקות' },
  { value: 'breakout', label: 'פריצות (Bollinger)', description: 'קנייה בפריצת רצועות' },
  { value: 'mean_reversion', label: 'חזרה לממוצע (RSI)', description: 'קנייה באזורי קיצון' },
];

export function BacktestPanel() {
  const { toast } = useToast();
  const backtest = useBacktest();
  
  const [config, setConfig] = useState<BacktestConfig>({
    symbol: 'BTC_USDT',
    strategy: 'momentum',
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    initialCapital: 10000,
    positionSize: 10,
    stopLoss: 2,
    takeProfit: 4,
  });
  
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [activeTab, setActiveTab] = useState('config');

  const handleRunBacktest = async () => {
    try {
      const data = await backtest.mutateAsync(config);
      setResult(data);
      setActiveTab('results');
      toast({
        title: "בדיקה הושלמה",
        description: `${data.totalTrades} עסקאות, ${data.winRate.toFixed(1)}% הצלחה`,
      });
    } catch (error) {
      toast({
        title: "שגיאה בבדיקה",
        description: error instanceof Error ? error.message : "שגיאה לא ידועה",
        variant: "destructive"
      });
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  return (
    <Card className="h-full flex flex-col overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="py-3 px-4 border-b border-border/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">Backtesting</CardTitle>
          </div>
          {result && (
            <Badge 
              variant={result.totalReturnPercent >= 0 ? "default" : "destructive"}
              className="text-xs"
            >
              {result.totalReturnPercent >= 0 ? '+' : ''}{result.totalReturnPercent.toFixed(2)}%
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b border-border/30 bg-transparent px-4">
            <TabsTrigger value="config" className="text-xs">הגדרות</TabsTrigger>
            <TabsTrigger value="results" className="text-xs" disabled={!result}>תוצאות</TabsTrigger>
            <TabsTrigger value="trades" className="text-xs" disabled={!result}>עסקאות</TabsTrigger>
          </TabsList>
          
          <TabsContent value="config" className="flex-1 p-4 overflow-auto m-0">
            <div className="space-y-4">
              {/* Symbol & Strategy */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">צמד מסחר</Label>
                  <Select value={config.symbol} onValueChange={(v) => setConfig(c => ({ ...c, symbol: v }))}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POPULAR_PAIRS.map(pair => (
                        <SelectItem key={pair} value={pair} className="text-xs">{pair}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">אסטרטגיה</Label>
                  <Select value={config.strategy} onValueChange={(v: BacktestConfig['strategy']) => setConfig(c => ({ ...c, strategy: v }))}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STRATEGIES.map(s => (
                        <SelectItem key={s.value} value={s.value} className="text-xs">
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">תאריך התחלה</Label>
                  <Input 
                    type="date" 
                    value={config.startDate}
                    onChange={(e) => setConfig(c => ({ ...c, startDate: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">תאריך סיום</Label>
                  <Input 
                    type="date" 
                    value={config.endDate}
                    onChange={(e) => setConfig(c => ({ ...c, endDate: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              
              {/* Capital */}
              <div className="space-y-1.5">
                <Label className="text-xs">הון התחלתי (USDT)</Label>
                <Input 
                  type="number" 
                  value={config.initialCapital}
                  onChange={(e) => setConfig(c => ({ ...c, initialCapital: Number(e.target.value) }))}
                  className="h-8 text-xs"
                />
              </div>
              
              {/* Position Size */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-xs">גודל פוזיציה</Label>
                  <span className="text-xs text-muted-foreground">{config.positionSize}%</span>
                </div>
                <Slider
                  value={[config.positionSize]}
                  onValueChange={([v]) => setConfig(c => ({ ...c, positionSize: v }))}
                  min={1}
                  max={50}
                  step={1}
                  className="w-full"
                />
              </div>
              
              {/* Stop Loss & Take Profit */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-red-400">Stop Loss</Label>
                    <span className="text-xs text-muted-foreground">{config.stopLoss}%</span>
                  </div>
                  <Slider
                    value={[config.stopLoss]}
                    onValueChange={([v]) => setConfig(c => ({ ...c, stopLoss: v }))}
                    min={0.5}
                    max={10}
                    step={0.5}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-green-400">Take Profit</Label>
                    <span className="text-xs text-muted-foreground">{config.takeProfit}%</span>
                  </div>
                  <Slider
                    value={[config.takeProfit]}
                    onValueChange={([v]) => setConfig(c => ({ ...c, takeProfit: v }))}
                    min={1}
                    max={20}
                    step={0.5}
                    className="w-full"
                  />
                </div>
              </div>
              
              {/* Run Button */}
              <Button 
                onClick={handleRunBacktest}
                disabled={backtest.isPending}
                className="w-full"
              >
                {backtest.isPending ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    מריץ בדיקה...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    הרץ Backtest
                  </>
                )}
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="results" className="flex-1 p-4 overflow-auto m-0">
            {result && (
              <div className="space-y-4">
                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-background/50 rounded-lg p-3 space-y-1">
                    <div className="text-xs text-muted-foreground">תשואה כוללת</div>
                    <div className={`text-lg font-bold ${result.totalReturnPercent >= 0 ? 'text-primary' : 'text-destructive'}`}>
                      {result.totalReturnPercent >= 0 ? '+' : ''}{result.totalReturnPercent.toFixed(2)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatCurrency(result.totalReturn)}
                    </div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-3 space-y-1">
                    <div className="text-xs text-muted-foreground">Win Rate</div>
                    <div className="text-lg font-bold text-foreground">
                      {result.winRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {result.winningTrades}/{result.totalTrades} עסקאות
                    </div>
                  </div>
                </div>
                
                {/* Secondary Metrics */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-background/50 rounded-lg p-2 text-center">
                    <div className="text-muted-foreground mb-1">Max Drawdown</div>
                    <div className="text-destructive font-medium">
                      -{result.maxDrawdownPercent.toFixed(2)}%
                    </div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-2 text-center">
                    <div className="text-muted-foreground mb-1">Profit Factor</div>
                    <div className="font-medium">
                      {result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-2 text-center">
                    <div className="text-muted-foreground mb-1">Sharpe Ratio</div>
                    <div className="font-medium">
                      {result.sharpeRatio.toFixed(2)}
                    </div>
                  </div>
                </div>
                
                {/* Win/Loss Stats */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-background/50 rounded-lg p-2">
                    <div className="flex items-center gap-1 text-primary mb-1">
                      <TrendingUp className="h-3 w-3" />
                      <span>ממוצע רווח</span>
                    </div>
                    <div className="font-medium">{formatCurrency(result.averageWin)}</div>
                    <div className="text-muted-foreground">
                      מקס׳: {formatCurrency(result.largestWin)}
                    </div>
                  </div>
                  <div className="bg-background/50 rounded-lg p-2">
                    <div className="flex items-center gap-1 text-destructive mb-1">
                      <TrendingDown className="h-3 w-3" />
                      <span>ממוצע הפסד</span>
                    </div>
                    <div className="font-medium">{formatCurrency(result.averageLoss)}</div>
                    <div className="text-muted-foreground">
                      מקס׳: {formatCurrency(result.largestLoss)}
                    </div>
                  </div>
                </div>
                
                {/* Equity Curve */}
                <div className="bg-background/50 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <BarChart3 className="h-3 w-3" />
                    עקומת הון
                  </div>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={result.equityCurve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis 
                          dataKey="time" 
                          tick={false}
                          axisLine={{ stroke: 'hsl(var(--border))' }}
                        />
                        <YAxis 
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                          axisLine={{ stroke: 'hsl(var(--border))' }}
                          tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}
                          width={40}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            background: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '12px'
                          }}
                          formatter={(value: number) => [formatCurrency(value), 'הון']}
                          labelFormatter={(label) => formatBacktestDate(label)}
                        />
                        <ReferenceLine y={result.initialCapital} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                        <Line 
                          type="monotone" 
                          dataKey="equity" 
                          stroke="hsl(var(--primary))" 
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="trades" className="flex-1 overflow-auto m-0">
            {result && (
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-[80px]">תאריך</TableHead>
                    <TableHead className="w-[50px]">כיוון</TableHead>
                    <TableHead className="text-left">כניסה</TableHead>
                    <TableHead className="text-left">יציאה</TableHead>
                    <TableHead className="text-left">P&L</TableHead>
                    <TableHead className="w-[60px]">סיבה</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.trades.map((trade, i) => (
                    <TableRow key={i} className="text-xs">
                      <TableCell className="font-mono text-muted-foreground">
                        {new Date(trade.entryTime * 1000).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={trade.side === 'buy' ? 'default' : 'secondary'} className="text-[10px] px-1">
                          {trade.side === 'buy' ? 'קנייה' : 'מכירה'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">${trade.entryPrice.toFixed(2)}</TableCell>
                      <TableCell className="font-mono">${trade.exitPrice.toFixed(2)}</TableCell>
                      <TableCell className={`font-mono ${trade.pnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {trade.pnl >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] px-1 ${
                            trade.exitReason === 'take_profit' ? 'border-primary/50 text-primary' :
                            trade.exitReason === 'stop_loss' ? 'border-destructive/50 text-destructive' :
                            'border-border'
                          }`}
                        >
                          {trade.exitReason === 'take_profit' ? 'TP' :
                           trade.exitReason === 'stop_loss' ? 'SL' :
                           trade.exitReason === 'signal' ? 'סיגנל' : 'סוף'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
