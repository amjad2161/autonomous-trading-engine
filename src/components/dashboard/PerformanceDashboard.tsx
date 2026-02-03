import { useState, useEffect } from "react";
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  RefreshCw,
  Calendar,
  Target,
  Activity,
  DollarSign,
  Percent,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";

interface TradeData {
  id: string;
  symbol: string;
  side: string;
  type: string;
  amount: number;
  price: number;
  expected_edge: number;
  actual_pnl: number;
  status: string;
  executed_at: string;
}

interface DailyStats {
  date: string;
  pnl: number;
  trades: number;
  winRate: number;
  cumulativePnl: number;
}

interface SymbolStats {
  symbol: string;
  trades: number;
  pnl: number;
  winRate: number;
  avgPnl: number;
}

export function PerformanceDashboard() {
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [symbolStats, setSymbolStats] = useState<SymbolStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<'7d' | '30d' | 'all'>('7d');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const daysAgo = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 365;
      const startDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

      const { data: tradeData } = await supabase
        .from('trade_history')
        .select('*')
        .gte('executed_at', startDate)
        .order('executed_at', { ascending: true });

      if (tradeData) {
        setTrades(tradeData);
        processStats(tradeData);
      }
    } catch (err) {
      console.error('Failed to load performance data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const processStats = (tradeData: TradeData[]) => {
    // Daily stats
    const dailyMap = new Map<string, { pnl: number; trades: number; wins: number }>();
    let cumulativePnl = 0;

    for (const trade of tradeData) {
      if (trade.side !== 'sell') continue; // Only count exits
      
      const date = new Date(trade.executed_at).toLocaleDateString('he-IL');
      const existing = dailyMap.get(date) || { pnl: 0, trades: 0, wins: 0 };
      
      existing.pnl += trade.actual_pnl || 0;
      existing.trades++;
      if ((trade.actual_pnl || 0) > 0) existing.wins++;
      
      dailyMap.set(date, existing);
    }

    const dailyStatsArray: DailyStats[] = [];
    const sortedDates = Array.from(dailyMap.keys()).sort((a, b) => {
      const dateA = new Date(a.split('/').reverse().join('-'));
      const dateB = new Date(b.split('/').reverse().join('-'));
      return dateA.getTime() - dateB.getTime();
    });

    for (const date of sortedDates) {
      const stats = dailyMap.get(date)!;
      cumulativePnl += stats.pnl;
      dailyStatsArray.push({
        date,
        pnl: parseFloat(stats.pnl.toFixed(2)),
        trades: stats.trades,
        winRate: stats.trades > 0 ? parseFloat(((stats.wins / stats.trades) * 100).toFixed(1)) : 0,
        cumulativePnl: parseFloat(cumulativePnl.toFixed(2)),
      });
    }

    setDailyStats(dailyStatsArray);

    // Symbol stats
    const symbolMap = new Map<string, { pnl: number; trades: number; wins: number }>();

    for (const trade of tradeData) {
      if (trade.side !== 'sell') continue;
      
      const symbol = trade.symbol.split('/')[0];
      const existing = symbolMap.get(symbol) || { pnl: 0, trades: 0, wins: 0 };
      
      existing.pnl += trade.actual_pnl || 0;
      existing.trades++;
      if ((trade.actual_pnl || 0) > 0) existing.wins++;
      
      symbolMap.set(symbol, existing);
    }

    const symbolStatsArray: SymbolStats[] = Array.from(symbolMap.entries())
      .map(([symbol, stats]) => ({
        symbol,
        trades: stats.trades,
        pnl: parseFloat(stats.pnl.toFixed(2)),
        winRate: stats.trades > 0 ? parseFloat(((stats.wins / stats.trades) * 100).toFixed(1)) : 0,
        avgPnl: stats.trades > 0 ? parseFloat((stats.pnl / stats.trades).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.pnl - a.pnl);

    setSymbolStats(symbolStatsArray);
  };

  useEffect(() => {
    loadData();
  }, [timeframe]);

  // Calculate summary stats
  const totalPnL = dailyStats.reduce((sum, d) => sum + d.pnl, 0);
  const totalTrades = dailyStats.reduce((sum, d) => sum + d.trades, 0);
  const avgWinRate = dailyStats.length > 0 
    ? dailyStats.reduce((sum, d) => sum + d.winRate, 0) / dailyStats.length 
    : 0;
  const profitableDays = dailyStats.filter(d => d.pnl > 0).length;
  const lossDays = dailyStats.filter(d => d.pnl < 0).length;

  const COLORS = ['hsl(var(--profit))', 'hsl(var(--destructive))', 'hsl(var(--warning))', 'hsl(var(--primary))'];

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">ביצועים ואנליטיקה</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['7d', '30d', 'all'] as const).map((tf) => (
              <Button
                key={tf}
                variant={timeframe === tf ? 'default' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setTimeframe(tf)}
              >
                {tf === '7d' ? '7 ימים' : tf === '30d' ? '30 ימים' : 'הכל'}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <DollarSign className="w-3 h-3" />
              P&L כולל
            </div>
            <p className={`text-lg font-bold font-mono ${totalPnL >= 0 ? 'text-profit' : 'text-destructive'}`}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}$
            </p>
          </div>
          
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <Activity className="w-3 h-3" />
              עסקאות
            </div>
            <p className="text-lg font-bold font-mono">{totalTrades}</p>
          </div>
          
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <Percent className="w-3 h-3" />
              Win Rate
            </div>
            <p className={`text-lg font-bold font-mono ${avgWinRate >= 50 ? 'text-profit' : 'text-destructive'}`}>
              {avgWinRate.toFixed(1)}%
            </p>
          </div>
          
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <Calendar className="w-3 h-3" />
              ימים רווחיים
            </div>
            <p className="text-lg font-bold font-mono">
              <span className="text-profit">{profitableDays}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-destructive">{lossDays}</span>
            </p>
          </div>
        </div>

        <Tabs defaultValue="pnl" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="pnl">P&L</TabsTrigger>
            <TabsTrigger value="winrate">Win Rate</TabsTrigger>
            <TabsTrigger value="symbols">מטבעות</TabsTrigger>
          </TabsList>

          <TabsContent value="pnl" className="mt-3">
            <div className="h-48">
              {dailyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickFormatter={(value) => value.split('/').slice(0, 2).join('/')}
                    />
                    <YAxis 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickFormatter={(value) => `$${value}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'P&L מצטבר']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="cumulativePnl" 
                      stroke="hsl(var(--primary))" 
                      fill="hsl(var(--primary) / 0.3)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  אין נתונים לתקופה זו
                </div>
              )}
            </div>

            {/* Daily P&L bars */}
            <div className="h-32 mt-4">
              {dailyStats.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickFormatter={(value) => value.split('/').slice(0, 2).join('/')}
                    />
                    <YAxis 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickFormatter={(value) => `$${value}`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'P&L יומי']}
                    />
                    <Bar 
                      dataKey="pnl" 
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    >
                      {dailyStats.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.pnl >= 0 ? 'hsl(var(--profit))' : 'hsl(var(--destructive))'} 
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </TabsContent>

          <TabsContent value="winrate" className="mt-3">
            <div className="h-48">
              {dailyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickFormatter={(value) => value.split('/').slice(0, 2).join('/')}
                    />
                    <YAxis 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      domain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [`${value.toFixed(1)}%`, 'Win Rate']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="winRate" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 3 }}
                    />
                    {/* Reference line at 50% */}
                    <Line 
                      type="monotone" 
                      dataKey={() => 50} 
                      stroke="hsl(var(--muted-foreground))" 
                      strokeDasharray="5 5"
                      strokeWidth={1}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  אין נתונים לתקופה זו
                </div>
              )}
            </div>

            {/* Trade count per day */}
            <div className="h-24 mt-4">
              {dailyStats.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyStats}>
                    <XAxis 
                      dataKey="date" 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickFormatter={(value) => value.split('/').slice(0, 2).join('/')}
                    />
                    <YAxis 
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [value, 'עסקאות']}
                    />
                    <Bar 
                      dataKey="trades" 
                      fill="hsl(var(--muted-foreground))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </TabsContent>

          <TabsContent value="symbols" className="mt-3">
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {symbolStats.map((stat, index) => (
                  <div 
                    key={stat.symbol}
                    className="flex items-center justify-between p-2 bg-muted/30 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-4">{index + 1}</span>
                      <span className="font-mono font-medium">{stat.symbol}</span>
                      <Badge variant="outline" className="text-xs">
                        {stat.trades} עסקאות
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className={`font-mono text-sm ${stat.pnl >= 0 ? 'text-profit' : 'text-destructive'}`}>
                          {stat.pnl >= 0 ? '+' : ''}{stat.pnl.toFixed(2)}$
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ממוצע: {stat.avgPnl >= 0 ? '+' : ''}{stat.avgPnl.toFixed(2)}$
                        </p>
                      </div>
                      <Badge 
                        variant={stat.winRate >= 50 ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {stat.winRate.toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                ))}
                {symbolStats.length === 0 && (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    אין נתונים לתקופה זו
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
