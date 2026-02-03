import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Award,
  Activity,
  Percent,
  DollarSign,
  BarChart3
} from "lucide-react";

interface TradeRecord {
  id: string;
  symbol: string;
  type: string;
  side: string;
  actual_pnl: number;
  created_at: string;
}

interface AnalyticsData {
  totalTrades: number;
  winRate: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  winStreak: number;
  lossStreak: number;
  bestTrade: number;
  worstTrade: number;
  pnlByDay: { date: string; pnl: number; cumulative: number }[];
  pnlByStrategy: { name: string; pnl: number; trades: number; winRate: number }[];
  tradesByHour: { hour: number; trades: number; pnl: number }[];
}

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

export function AdvancedAnalytics() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchAnalytics() {
    try {
      const { data: trades, error } = await supabase
        .from('trade_history')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      if (!trades || trades.length === 0) {
        setIsLoading(false);
        return;
      }

      // Calculate analytics
      const completedTrades = trades.filter(t => t.actual_pnl !== null) as TradeRecord[];
      const wins = completedTrades.filter(t => t.actual_pnl > 0);
      const losses = completedTrades.filter(t => t.actual_pnl <= 0);
      
      const totalPnL = completedTrades.reduce((sum, t) => sum + (t.actual_pnl || 0), 0);
      const winRate = completedTrades.length > 0 ? wins.length / completedTrades.length : 0;
      
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.actual_pnl, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.actual_pnl, 0) / losses.length) : 0;
      
      // Calculate Sharpe Ratio (simplified)
      const returns = completedTrades.map(t => t.actual_pnl);
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);
      const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
      
      // Calculate Max Drawdown
      let peak = 0;
      let maxDrawdown = 0;
      let cumulative = 0;
      for (const trade of completedTrades) {
        cumulative += trade.actual_pnl || 0;
        if (cumulative > peak) peak = cumulative;
        const drawdown = peak - cumulative;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }
      
      // Profit Factor
      const grossProfit = wins.reduce((s, t) => s + t.actual_pnl, 0);
      const grossLoss = Math.abs(losses.reduce((s, t) => s + t.actual_pnl, 0));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
      
      // Win/Loss Streaks
      let currentStreak = 0;
      let maxWinStreak = 0;
      let maxLossStreak = 0;
      let isWinStreak = true;
      
      for (const trade of completedTrades) {
        const isWin = trade.actual_pnl > 0;
        if (isWin === isWinStreak) {
          currentStreak++;
        } else {
          if (isWinStreak) maxWinStreak = Math.max(maxWinStreak, currentStreak);
          else maxLossStreak = Math.max(maxLossStreak, currentStreak);
          currentStreak = 1;
          isWinStreak = isWin;
        }
      }
      
      // PnL by day
      const pnlByDayMap = new Map<string, number>();
      for (const trade of completedTrades) {
        const date = new Date(trade.created_at).toLocaleDateString('he-IL');
        pnlByDayMap.set(date, (pnlByDayMap.get(date) || 0) + (trade.actual_pnl || 0));
      }
      
      let cumulativePnL = 0;
      const pnlByDay = Array.from(pnlByDayMap.entries()).map(([date, pnl]) => {
        cumulativePnL += pnl;
        return { date, pnl, cumulative: cumulativePnL };
      });
      
      // PnL by strategy
      const strategyMap = new Map<string, { pnl: number; wins: number; total: number }>();
      for (const trade of completedTrades) {
        const strategy = trade.type || 'unknown';
        const current = strategyMap.get(strategy) || { pnl: 0, wins: 0, total: 0 };
        current.pnl += trade.actual_pnl || 0;
        current.total++;
        if (trade.actual_pnl > 0) current.wins++;
        strategyMap.set(strategy, current);
      }
      
      const pnlByStrategy = Array.from(strategyMap.entries()).map(([name, data]) => ({
        name,
        pnl: data.pnl,
        trades: data.total,
        winRate: data.total > 0 ? (data.wins / data.total) * 100 : 0,
      }));
      
      // Trades by hour
      const hourMap = new Map<number, { trades: number; pnl: number }>();
      for (const trade of completedTrades) {
        const hour = new Date(trade.created_at).getHours();
        const current = hourMap.get(hour) || { trades: 0, pnl: 0 };
        current.trades++;
        current.pnl += trade.actual_pnl || 0;
        hourMap.set(hour, current);
      }
      
      const tradesByHour = Array.from(hourMap.entries())
        .map(([hour, data]) => ({ hour, ...data }))
        .sort((a, b) => a.hour - b.hour);

      setAnalytics({
        totalTrades: completedTrades.length,
        winRate,
        totalPnL,
        avgWin,
        avgLoss,
        sharpeRatio,
        maxDrawdown,
        profitFactor,
        winStreak: maxWinStreak,
        lossStreak: maxLossStreak,
        bestTrade: Math.max(...completedTrades.map(t => t.actual_pnl || 0), 0),
        worstTrade: Math.min(...completedTrades.map(t => t.actual_pnl || 0), 0),
        pnlByDay,
        pnlByStrategy,
        tradesByHour,
      });
      
    } catch (e) {
      console.error('Error fetching analytics:', e);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </CardContent>
      </Card>
    );
  }

  if (!analytics) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full text-muted-foreground">
          אין מספיק נתונים לניתוח
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Win Rate</p>
                <p className="text-2xl font-bold">{(analytics.winRate * 100).toFixed(1)}%</p>
              </div>
              <Target className="h-8 w-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total P&L</p>
                <p className={`text-2xl font-bold ${analytics.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  ${analytics.totalPnL.toFixed(2)}
                </p>
              </div>
              <DollarSign className={`h-8 w-8 opacity-50 ${analytics.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`} />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
                <p className="text-2xl font-bold">{analytics.sharpeRatio.toFixed(2)}</p>
              </div>
              <BarChart3 className="h-8 w-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Profit Factor</p>
                <p className="text-2xl font-bold">{analytics.profitFactor === Infinity ? '∞' : analytics.profitFactor.toFixed(2)}</p>
              </div>
              <Award className="h-8 w-8 text-purple-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="col-span-1">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">עסקאות</p>
            <p className="text-lg font-bold">{analytics.totalTrades}</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">ממוצע רווח</p>
            <p className="text-lg font-bold text-green-500">${analytics.avgWin.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">ממוצע הפסד</p>
            <p className="text-lg font-bold text-red-500">${analytics.avgLoss.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Max Drawdown</p>
            <p className="text-lg font-bold text-orange-500">${analytics.maxDrawdown.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">רצף רווחים</p>
            <p className="text-lg font-bold text-green-500">{analytics.winStreak}</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">רצף הפסדים</p>
            <p className="text-lg font-bold text-red-500">{analytics.lossStreak}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cumulative P&L Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              P&L מצטבר
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.pnlByDay}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Area 
                    type="monotone" 
                    dataKey="cumulative" 
                    stroke="#22c55e" 
                    fill="#22c55e" 
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Strategy Performance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              ביצועים לפי אסטרטגיה
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.pnlByStrategy}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Bar dataKey="pnl" fill="#3b82f6">
                    {analytics.pnlByStrategy.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Trades by Hour */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Percent className="h-4 w-4" />
              עסקאות לפי שעה
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.tradesByHour}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="hour" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Bar dataKey="trades" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Strategy Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">חלוקת אסטרטגיות</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.pnlByStrategy}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    dataKey="trades"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {analytics.pnlByStrategy.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
