import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  Target,
  Award,
  Percent,
  DollarSign,
  Activity
} from "lucide-react";

interface TradeStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxWin: number;
  maxLoss: number;
  totalPnL: number;
  expectancy: number;
}

export function TradingStatsPanel() {
  const [stats, setStats] = useState<TradeStats>({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    sharpeRatio: 0,
    maxWin: 0,
    maxLoss: 0,
    totalPnL: 0,
    expectancy: 0,
  });
  
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStats() {
    try {
      const { data: trades } = await supabase
        .from('trade_history')
        .select('actual_pnl, created_at')
        .not('actual_pnl', 'is', null);
      
      if (!trades || trades.length === 0) {
        setIsLoading(false);
        return;
      }

      const pnls = trades.map(t => t.actual_pnl || 0);
      const winningTrades = pnls.filter(p => p > 0);
      const losingTrades = pnls.filter(p => p < 0);
      
      const totalTrades = pnls.length;
      const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
      
      const avgWin = winningTrades.length > 0 
        ? winningTrades.reduce((a, b) => a + b, 0) / winningTrades.length 
        : 0;
      
      const avgLoss = losingTrades.length > 0 
        ? Math.abs(losingTrades.reduce((a, b) => a + b, 0) / losingTrades.length)
        : 0;
      
      const totalWins = winningTrades.reduce((a, b) => a + b, 0);
      const totalLosses = Math.abs(losingTrades.reduce((a, b) => a + b, 0));
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
      
      const maxWin = winningTrades.length > 0 ? Math.max(...winningTrades) : 0;
      const maxLoss = losingTrades.length > 0 ? Math.min(...losingTrades) : 0;
      
      const totalPnL = pnls.reduce((a, b) => a + b, 0);
      
      // Expectancy = (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
      const lossRate = 100 - winRate;
      const expectancy = ((winRate / 100) * avgWin) - ((lossRate / 100) * avgLoss);
      
      // Sharpe Ratio calculation (annualized, assuming daily returns)
      const sharpeRatio = calculateSharpeRatio(pnls);
      
      setStats({
        totalTrades,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        avgWin,
        avgLoss,
        profitFactor: isFinite(profitFactor) ? profitFactor : 0,
        sharpeRatio,
        maxWin,
        maxLoss,
        totalPnL,
        expectancy,
      });
    } catch (e) {
      console.error('Error fetching trade stats:', e);
    } finally {
      setIsLoading(false);
    }
  }

  function calculateSharpeRatio(returns: number[]): number {
    if (returns.length < 2) return 0;
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) return 0;
    
    // Risk-free rate assumed 0 for crypto
    // Annualization factor: sqrt(252) for daily trades, sqrt(365*24) for hourly
    const annualizationFactor = Math.sqrt(252);
    return (mean / stdDev) * annualizationFactor;
  }

  const getWinRateColor = (rate: number) => {
    if (rate >= 60) return 'text-green-500';
    if (rate >= 50) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getSharpeColor = (ratio: number) => {
    if (ratio >= 2) return 'text-green-500';
    if (ratio >= 1) return 'text-yellow-500';
    if (ratio >= 0) return 'text-orange-500';
    return 'text-red-500';
  };

  const getProfitFactorColor = (pf: number) => {
    if (pf >= 2) return 'text-green-500';
    if (pf >= 1.5) return 'text-yellow-500';
    if (pf >= 1) return 'text-orange-500';
    return 'text-red-500';
  };

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            סטטיסטיקות מסחר
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-48">
          <div className="animate-pulse text-muted-foreground">טוען נתונים...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            סטטיסטיקות מסחר
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {stats.totalTrades} עסקאות
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Win Rate Section */}
        <div className="p-4 bg-muted/30 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Win Rate</span>
            </div>
            <span className={`text-2xl font-bold ${getWinRateColor(stats.winRate)}`}>
              {stats.winRate.toFixed(1)}%
            </span>
          </div>
          <Progress value={stats.winRate} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-green-500" />
              {stats.winningTrades} מנצחות
            </span>
            <span className="flex items-center gap-1">
              <TrendingDown className="h-3 w-3 text-red-500" />
              {stats.losingTrades} מפסידות
            </span>
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Sharpe Ratio */}
          <div className="p-3 bg-muted/20 rounded-lg">
            <div className="flex items-center gap-1 mb-1">
              <Activity className="h-3 w-3 text-blue-500" />
              <span className="text-xs text-muted-foreground">Sharpe Ratio</span>
            </div>
            <span className={`text-xl font-bold ${getSharpeColor(stats.sharpeRatio)}`}>
              {stats.sharpeRatio.toFixed(2)}
            </span>
          </div>
          
          {/* Profit Factor */}
          <div className="p-3 bg-muted/20 rounded-lg">
            <div className="flex items-center gap-1 mb-1">
              <Award className="h-3 w-3 text-purple-500" />
              <span className="text-xs text-muted-foreground">Profit Factor</span>
            </div>
            <span className={`text-xl font-bold ${getProfitFactorColor(stats.profitFactor)}`}>
              {stats.profitFactor.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Average Win/Loss */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <div className="flex items-center gap-1 mb-1">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span className="text-xs text-muted-foreground">ממוצע רווח</span>
            </div>
            <span className="text-lg font-bold text-green-500">
              +{stats.avgWin.toFixed(2)}%
            </span>
            <div className="text-xs text-muted-foreground mt-1">
              מקסימום: +{stats.maxWin.toFixed(2)}%
            </div>
          </div>
          
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <div className="flex items-center gap-1 mb-1">
              <TrendingDown className="h-3 w-3 text-red-500" />
              <span className="text-xs text-muted-foreground">ממוצע הפסד</span>
            </div>
            <span className="text-lg font-bold text-red-500">
              -{stats.avgLoss.toFixed(2)}%
            </span>
            <div className="text-xs text-muted-foreground mt-1">
              מקסימום: {stats.maxLoss.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Expectancy */}
        <div className="p-3 bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Expectancy</span>
            </div>
            <span className={`text-xl font-bold ${stats.expectancy >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {stats.expectancy >= 0 ? '+' : ''}{stats.expectancy.toFixed(3)}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            תוחלת רווח לכל עסקה
          </p>
        </div>

        {/* Total P&L Summary */}
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-sm text-muted-foreground">P&L מצטבר</span>
          <span className={`text-lg font-bold ${stats.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toFixed(2)}%
          </span>
        </div>

        {/* Legend */}
        <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span>Sharpe ≥2 / Win Rate ≥60% / PF ≥2 = מצוין</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span>ביניים - דורש שיפור</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span>מתחת לציפיות - נדרשת התאמה</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
