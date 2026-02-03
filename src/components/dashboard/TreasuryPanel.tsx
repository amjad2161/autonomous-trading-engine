import { Wallet, Lock, TrendingUp, PiggyBank, AlertCircle } from "lucide-react";
import { useSpotBalances, useTickers, useTotalPortfolioValue, useUSDTBalance } from "@/hooks/useGateApi";
import { formatUSDT, formatCrypto, formatPercentage } from "@/lib/gate-api";

export function TreasuryPanel() {
  const { data: balances, isLoading: balancesLoading } = useSpotBalances();
  const { data: tickers } = useTickers();
  
  const usdtBalance = useUSDTBalance(balances);
  const totalValue = useTotalPortfolioValue(balances, tickers);
  
  // Filter balances with value > 0
  const activeBalances = balances?.filter(b => {
    const total = parseFloat(b.available) + parseFloat(b.locked);
    return total > 0;
  }) || [];

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
        <span className="text-xs text-muted-foreground">Auto-rebalance: ON</span>
      </div>
      
      <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 flex-1 overflow-auto">
        {/* Total Portfolio Value */}
        <div className="p-3 sm:p-4 rounded-lg bg-muted/50 border border-border">
          <p className="text-xs text-muted-foreground mb-1">Total Portfolio Value</p>
          <p className="font-mono text-xl sm:text-2xl font-bold text-foreground">
            {balancesLoading ? '---' : formatUSDT(totalValue)}
          </p>
          <p className="text-xs text-profit mt-1">
            +$0.00 (0.00%) today
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
