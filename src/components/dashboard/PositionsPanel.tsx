import { Activity, Circle, ArrowUpRight, ArrowDownRight, Clock, Target } from "lucide-react";
import { useOpenOrders } from "@/hooks/useGateApi";
import { formatUSDT, formatCrypto } from "@/lib/gate-api";

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number;
  timeOpen: string;
}

// Mock positions for demo (will be replaced with real data)
const mockPositions: Position[] = [];

export function PositionsPanel() {
  const { data: openOrders, isLoading } = useOpenOrders();

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Open Positions</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          {mockPositions.length} active
        </span>
      </div>
      
      <div className="flex-1 overflow-auto">
        {mockPositions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Activity className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No open positions</p>
            <p className="text-xs text-muted-foreground mt-1">
              System is scanning for opportunities...
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {mockPositions.map((position) => (
              <div key={position.id} className="p-4 hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                      position.side === 'long' 
                        ? 'bg-profit/20 text-profit' 
                        : 'bg-destructive/20 text-destructive'
                    }`}>
                      {position.side.toUpperCase()}
                    </span>
                    <span className="font-medium">{position.symbol}</span>
                  </div>
                  <div className={`flex items-center gap-1 font-mono text-sm ${
                    position.pnl >= 0 ? 'text-profit' : 'text-destructive'
                  }`}>
                    {position.pnl >= 0 ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4" />
                    )}
                    {formatUSDT(Math.abs(position.pnl))}
                    <span className="text-xs">
                      ({position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%)
                    </span>
                  </div>
                </div>
                
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Size</span>
                    <p className="font-mono">{formatCrypto(position.size, 4)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Entry</span>
                    <p className="font-mono">{formatUSDT(position.entryPrice)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Current</span>
                    <p className="font-mono">{formatUSDT(position.currentPrice)}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground">Time</span>
                    <p className="font-mono">{position.timeOpen}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4 mt-2 text-xs">
                  <div className="flex items-center gap-1 text-destructive">
                    <Circle className="w-2 h-2 fill-current" />
                    <span>SL: {formatUSDT(position.stopLoss)}</span>
                  </div>
                  <div className="flex items-center gap-1 text-profit">
                    <Target className="w-3 h-3" />
                    <span>TP: {formatUSDT(position.takeProfit)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Open Orders */}
        {openOrders && openOrders.length > 0 && (
          <div className="border-t border-border">
            <div className="px-4 py-2 bg-muted/30">
              <h3 className="text-xs font-medium text-muted-foreground">
                Pending Orders ({openOrders.length})
              </h3>
            </div>
            <div className="divide-y divide-border">
              {openOrders.slice(0, 5).map((order) => (
                <div key={order.id} className="p-3 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                        order.side === 'buy' 
                          ? 'bg-profit/20 text-profit' 
                          : 'bg-destructive/20 text-destructive'
                      }`}>
                        {order.side.toUpperCase()}
                      </span>
                      <span className="text-sm">{order.currency_pair.replace('_', '/')}</span>
                    </div>
                    <div className="text-right text-xs font-mono">
                      <p>{formatCrypto(order.amount, 4)}</p>
                      <p className="text-muted-foreground">@ {formatUSDT(parseFloat(order.price))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
