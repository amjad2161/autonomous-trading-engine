import { History, ArrowUpRight, ArrowDownRight, Clock, CheckCircle, XCircle, Timer, TrendingUp, TrendingDown } from "lucide-react";
import { useAutoExecuteSettings } from "@/hooks/useAutoExecute";
import { formatUSDT } from "@/lib/gate-api";

export function TradeHistoryPanel() {
  const { tradeHistory, calculateStats } = useAutoExecuteSettings();
  const stats = calculateStats();
  
  // Get last 10 trades
  const recentTrades = [...tradeHistory].reverse().slice(0, 10);

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Trade History</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${stats.netPnL >= 0 ? 'text-profit' : 'text-destructive'}`}>
            {stats.netPnL >= 0 ? '+' : ''}{formatUSDT(stats.netPnL)}
          </span>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto">
        {recentTrades.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <History className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No trades yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Enable auto-execute to start trading
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentTrades.map((trade) => {
              const isProfitable = (trade.pnl || 0) > 0;
              const timeAgo = getTimeAgo(trade.timestamp);
              
              return (
                <div key={trade.id} className="p-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        trade.side === 'buy' 
                          ? 'bg-profit/20 text-profit' 
                          : 'bg-destructive/20 text-destructive'
                      }`}>
                        {trade.side.toUpperCase()}
                      </span>
                      <span className="text-sm font-medium">{trade.symbol}</span>
                      <span className={`px-1.5 py-0.5 text-[10px] rounded bg-muted/50 text-muted-foreground`}>
                        {trade.type}
                      </span>
                    </div>
                    <div className={`flex items-center gap-1 text-xs font-mono ${
                      isProfitable ? 'text-profit' : 'text-destructive'
                    }`}>
                      {trade.pnl !== undefined ? (
                        <>
                          {isProfitable ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3" />
                          )}
                          {isProfitable ? '+' : ''}{formatUSDT(trade.pnl)}
                        </>
                      ) : (
                        <span className="text-warning">Pending</span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="font-mono">{formatUSDT(trade.amount)}</span>
                      <span>@</span>
                      <span className="font-mono">{formatUSDT(trade.entryPrice)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {trade.status === 'closed' ? (
                        <CheckCircle className="w-3 h-3 text-profit" />
                      ) : trade.status === 'cancelled' ? (
                        <XCircle className="w-3 h-3 text-destructive" />
                      ) : (
                        <Timer className="w-3 h-3 text-warning animate-pulse" />
                      )}
                      <span>{timeAgo}</span>
                    </div>
                  </div>
                  
                  {trade.slippage !== undefined && trade.slippage !== 0 && (
                    <div className="mt-1.5 text-[10px] text-muted-foreground">
                      Slippage: <span className={trade.slippage > 0.3 ? 'text-warning' : 'text-muted-foreground'}>
                        {trade.slippage.toFixed(3)}%
                      </span>
                      {trade.executionTime && (
                        <span className="ml-2">
                          Exec: {trade.executionTime}ms
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Summary Footer */}
      {recentTrades.length > 0 && (
        <div className="p-3 border-t border-border bg-muted/20">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-[10px] text-muted-foreground">Trades</p>
              <p className="text-xs font-mono font-semibold">{stats.totalTrades}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Win Rate</p>
              <p className={`text-xs font-mono font-semibold ${stats.winRate >= 50 ? 'text-profit' : 'text-warning'}`}>
                {stats.winRate.toFixed(0)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Avg Win</p>
              <p className="text-xs font-mono font-semibold text-profit">
                +${stats.avgWin.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Avg Loss</p>
              <p className="text-xs font-mono font-semibold text-destructive">
                -${stats.avgLoss.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
