import { useState } from "react";
import { Wallet, Lock, TrendingUp, TrendingDown, PiggyBank, AlertCircle, Zap, Loader2, Download } from "lucide-react";
import { useSpotBalances, useTickers, useTotalPortfolioValue, useUSDTBalance, useDailyPnL } from "@/hooks/useGateApi";
import { formatUSDT, formatCrypto, formatPercentage } from "@/lib/gate-api";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function TreasuryPanel() {
  const { data: balances, isLoading: balancesLoading, refetch } = useSpotBalances();
  const { data: tickers } = useTickers();
  const [isLiquidating, setIsLiquidating] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  
  const usdtBalance = useUSDTBalance(balances);
  const totalValue = useTotalPortfolioValue(balances, tickers);
  const dailyPnL = useDailyPnL(balances, tickers);
  
  // Filter balances with value > 0
  const activeBalances = balances?.filter(b => {
    const total = parseFloat(b.available) + parseFloat(b.locked);
    return total > 0;
  }) || [];

  // Non-USDT balances that can be liquidated
  const liquidatableBalances = activeBalances.filter(b => {
    if (b.currency === 'USDT') return false;
    const ticker = tickers?.find(t => t.currency_pair === `${b.currency}_USDT`);
    if (!ticker) return false;
    const value = parseFloat(b.available) * parseFloat(ticker.last);
    return value >= 0.5; // Only show if worth at least $0.50
  });

  // ===== COLLECT ALL - From all platforms to Spot, then to USDT =====
  const handleCollectAll = async () => {
    setIsCollecting(true);
    toast.info("🚀 אוסף מכל הפלטפורמות ומנזל ל-USDT...");

    try {
      const { data, error } = await supabase.functions.invoke('collect-all');
      
      if (error) {
        toast.error(`שגיאה: ${error.message}`);
        return;
      }

      if (data?.success) {
        const s = data.summary;
        toast.success(
          `✅ איסוף הושלם!\n` +
          `Earn: ${s.earnRedeemed} | Margin: ${s.marginTransferred} | Futures: ${s.futuresTransferred}\n` +
          `נוזלו ${s.spotLiquidated} מטבעות | +$${s.totalLiquidatedUSDT?.toFixed(2) || '0'}\n` +
          `יתרה סופית: $${s.finalUSDTBalance?.toFixed(2) || '0'}`
        );
        refetch();
      } else {
        toast.error(data?.error || 'שגיאה לא ידועה');
      }
    } catch (e) {
      toast.error(`שגיאה: ${e instanceof Error ? e.message : 'Unknown'}`);
    } finally {
      setIsCollecting(false);
    }
  };

  const handleLiquidateAll = async () => {
    if (liquidatableBalances.length === 0) {
      toast.info("אין מטבעות לניזול");
      return;
    }

    setIsLiquidating(true);
    let successCount = 0;
    let failCount = 0;
    let totalUSDT = 0;

    toast.info(`מנזל ${liquidatableBalances.length} מטבעות...`);

    for (const balance of liquidatableBalances) {
      try {
        const ticker = tickers?.find(t => t.currency_pair === `${balance.currency}_USDT`);
        if (!ticker) continue;

        const amount = parseFloat(balance.available);
        const pair = `${balance.currency}_USDT`;
        const estimatedValue = amount * parseFloat(ticker.last);

        // Skip if too small for Gate.io minimum ($3)
        if (estimatedValue < 3) {
          console.log(`Skip ${balance.currency}: $${estimatedValue.toFixed(2)} < $3 minimum`);
          continue;
        }

        const { data, error } = await supabase.functions.invoke('gate-api', {
          body: {
            endpoint: '/spot/orders',
            method: 'POST',
            body: {
              currency_pair: pair,
              side: 'sell',
              amount: amount.toFixed(8),
              type: 'market',
              time_in_force: 'ioc',
            }
          }
        });

        if (error) {
          console.error(`Failed to sell ${balance.currency}:`, error);
          failCount++;
        } else if (data?.filled_total) {
          const filled = parseFloat(data.filled_total);
          totalUSDT += filled;
          successCount++;
          console.log(`✅ Sold ${balance.currency} for $${filled.toFixed(2)}`);
        } else {
          failCount++;
        }

        // Small delay between orders
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error(`Error selling ${balance.currency}:`, e);
        failCount++;
      }
    }

    setIsLiquidating(false);
    refetch();

    if (successCount > 0) {
      toast.success(`נוזלו ${successCount} מטבעות | +$${totalUSDT.toFixed(2)} USDT`);
    }
    if (failCount > 0) {
      toast.warning(`${failCount} מטבעות נכשלו (כנראה מתחת למינימום)`);
    }
  };

  // Calculate allocation percentages
  const usdtPercent = totalValue > 0 ? (usdtBalance.total / totalValue) * 100 : 0;
  const targetUsdtPercent = 60; // Target USDT dominance

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Treasury</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* COLLECT ALL BUTTON */}
          <Button
            size="sm"
            variant="default"
            onClick={handleCollectAll}
            disabled={isCollecting}
            className="h-7 text-xs gap-1 bg-primary hover:bg-primary/90"
          >
            {isCollecting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            {isCollecting ? 'אוסף...' : 'אסוף הכל'}
          </Button>
          {/* LIQUIDATE BUTTON */}
          <Button
            size="sm"
            variant="destructive"
            onClick={handleLiquidateAll}
            disabled={isLiquidating || liquidatableBalances.length === 0}
            className="h-7 text-xs gap-1"
          >
            {isLiquidating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            {isLiquidating ? 'מנזל...' : `נזל (${liquidatableBalances.length})`}
          </Button>
        </div>
      </div>
      
      <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 flex-1 overflow-auto">
        {/* Total Portfolio Value */}
        <div className="p-3 sm:p-4 rounded-lg bg-muted/50 border border-border">
          <p className="text-xs text-muted-foreground mb-1">Total Portfolio Value</p>
          <p className="font-mono text-xl sm:text-2xl font-bold text-foreground">
            {balancesLoading ? '---' : formatUSDT(totalValue)}
          </p>
          <p className={`text-xs mt-1 flex items-center gap-1 ${dailyPnL.amount >= 0 ? 'text-profit' : 'text-destructive'}`}>
            {dailyPnL.amount >= 0 ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {dailyPnL.amount >= 0 ? '+' : ''}{formatUSDT(dailyPnL.amount)} ({formatPercentage(dailyPnL.percent)}) today
          </p>
        </div>

        {/* USDT Dominance */}
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">USDT Dominance</span>
            <span className={`font-mono ${usdtPercent >= targetUsdtPercent ? 'text-profit' : 'text-warning'}`}>
              {usdtPercent.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all ${usdtPercent >= targetUsdtPercent ? 'bg-profit' : 'bg-warning'}`}
              style={{ width: `${Math.min(usdtPercent, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
            <span>Target: {targetUsdtPercent}%</span>
            {usdtPercent < targetUsdtPercent && (
              <span className="text-warning flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Rebalance needed
              </span>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <TrendingUp className="w-3 h-3" />
              <span>Available</span>
            </div>
            <p className="font-mono text-sm font-semibold">
              {formatUSDT(usdtBalance.available)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Lock className="w-3 h-3" />
              <span>Locked</span>
            </div>
            <p className="font-mono text-sm font-semibold">
              {formatUSDT(usdtBalance.locked)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <PiggyBank className="w-3 h-3" />
              <span>Reserve</span>
            </div>
            <p className="font-mono text-sm font-semibold">
              {formatUSDT(totalValue * 0.1)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2 text-xs text-profit mb-1">
              <Lock className="w-3 h-3" />
              <span>Profit Vault</span>
            </div>
            <p className="font-mono text-sm font-semibold text-profit">
              $0.00
            </p>
          </div>
        </div>

        {/* Holdings */}
        <div>
          <h3 className="text-xs text-muted-foreground mb-2">Holdings</h3>
          <div className="space-y-2 max-h-40 overflow-auto">
            {activeBalances.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                {balancesLoading ? 'Loading...' : 'No active holdings'}
              </p>
            ) : (
              activeBalances.slice(0, 10).map((balance) => {
                const total = parseFloat(balance.available) + parseFloat(balance.locked);
                const ticker = tickers?.find(t => t.currency_pair === `${balance.currency}_USDT`);
                const usdValue = balance.currency === 'USDT' 
                  ? total 
                  : ticker 
                    ? total * parseFloat(ticker.last)
                    : 0;
                const change = ticker ? parseFloat(ticker.change_percentage) : 0;
                
                return (
                  <div 
                    key={balance.currency}
                    className="flex items-center justify-between p-2 rounded-md bg-muted/20 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">
                          {balance.currency.slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{balance.currency}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {formatCrypto(total, 4)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono">{formatUSDT(usdValue)}</p>
                      {balance.currency !== 'USDT' && (
                        <p className={`text-xs font-mono ${change >= 0 ? 'text-profit' : 'text-destructive'}`}>
                          {formatPercentage(change)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
