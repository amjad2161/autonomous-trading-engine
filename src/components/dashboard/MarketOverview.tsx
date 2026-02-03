import { BarChart3, TrendingUp, TrendingDown, Wifi, WifiOff } from "lucide-react";
import { useRealtimeTickers, useWebSocketStatus } from "@/hooks/useGateWebSocket";
import { formatUSDT, formatPercentage } from "@/lib/gate-api";

// Top pairs to monitor
const TOP_PAIRS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT', 'ADA_USDT'];

export function MarketOverview() {
  const { data: tickers, isLoading } = useRealtimeTickers(TOP_PAIRS);
  const wsStatus = useWebSocketStatus();

  const sortedTickers = tickers
    ?.filter(t => TOP_PAIRS.includes(t.currency_pair))
    .sort((a, b) => parseFloat(b.quote_volume) - parseFloat(a.quote_volume))
    || [];

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Market Overview</h2>
          {wsStatus === 'connected' ? (
            <Wifi className="w-3 h-3 text-profit animate-pulse" />
          ) : wsStatus === 'connecting' ? (
            <Wifi className="w-3 h-3 text-warning animate-pulse" />
          ) : (
            <WifiOff className="w-3 h-3 text-muted-foreground" />
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connecting...' : 'Top pairs'}
        </span>
      </div>
      
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sortedTickers.map((ticker) => {
              const change = parseFloat(ticker.change_percentage);
              const isPositive = change >= 0;
              const pair = ticker.currency_pair.replace('_', '/');
              
              return (
                <div key={ticker.currency_pair} className="p-2 sm:p-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center">
                        <span className="text-xs font-bold">
                          {ticker.currency_pair.split('_')[0].slice(0, 2)}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{pair}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          Vol: {formatUSDT(parseFloat(ticker.quote_volume))}
                        </p>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <p className="font-mono text-sm">{formatUSDT(parseFloat(ticker.last))}</p>
                      <div className={`flex items-center justify-end gap-1 text-xs font-mono ${
                        isPositive ? 'text-profit' : 'text-destructive'
                      }`}>
                        {isPositive ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {formatPercentage(change)}
                      </div>
                    </div>
                  </div>
                  
                  {/* Mini spread indicator */}
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Spread:</span>
                    <span className="font-mono text-foreground">
                      {((parseFloat(ticker.lowest_ask) - parseFloat(ticker.highest_bid)) / parseFloat(ticker.last) * 100).toFixed(3)}%
                    </span>
                    <span className="text-muted-foreground">|</span>
                    <span className="text-profit font-mono">{formatUSDT(parseFloat(ticker.highest_bid))}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="text-destructive font-mono">{formatUSDT(parseFloat(ticker.lowest_ask))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
