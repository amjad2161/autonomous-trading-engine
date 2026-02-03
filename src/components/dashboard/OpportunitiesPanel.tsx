import { Zap, TrendingUp, ArrowRight, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { useOpportunityScanner, Opportunity } from "@/hooks/useOpportunityScanner";
import { useCredentials } from "@/hooks/useCredentials";

const getTypeLabel = (type: Opportunity['type']) => {
  switch (type) {
    case 'arbitrage': return 'Tri-Arb';
    case 'spread': return 'Spread';
    case 'breakout': return 'Breakout';
    case 'reversion': return 'Mean Rev';
  }
};

const getTypeColor = (type: Opportunity['type']) => {
  switch (type) {
    case 'arbitrage': return 'bg-info/20 text-info border-info/30';
    case 'spread': return 'bg-primary/20 text-primary border-primary/30';
    case 'breakout': return 'bg-warning/20 text-warning border-warning/30';
    case 'reversion': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
  }
};

export function OpportunitiesPanel() {
  const { hasCredentials } = useCredentials();
  const { data, isLoading, isError, refetch, isFetching } = useOpportunityScanner(hasCredentials);
  
  const opportunities = data?.opportunities || [];
  const scannedPairs = data?.scannedPairs || 0;
  const isScanning = isLoading || isFetching;

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Zap className={`w-4 h-4 text-primary ${isScanning ? 'animate-pulse' : ''}`} />
          <h2 className="font-semibold text-sm">Opportunities</h2>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-muted transition-colors"
            disabled={isScanning}
          >
            <RefreshCw className={`w-3 h-3 text-muted-foreground ${isScanning ? 'animate-spin' : ''}`} />
          </button>
          <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-profit animate-pulse' : 'bg-muted'}`} />
          <span className="text-xs text-muted-foreground">
            {isScanning ? 'Scanning...' : `${scannedPairs} pairs`}
          </span>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto">
        {isError ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <AlertCircle className="w-8 h-8 text-destructive mb-2" />
            <p className="text-sm text-muted-foreground">Scanner error</p>
            <button 
              onClick={() => refetch()}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        ) : opportunities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <Zap className="w-8 h-8 text-muted-foreground" />
              </div>
              {isScanning && (
                <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-20" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {isScanning ? 'Scanning for opportunities' : 'No opportunities found'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Multi-scanner: Tri-Arb, Spread Analysis
            </p>
            
            {/* Scanner status */}
            <div className="mt-4 grid grid-cols-2 gap-2 w-full max-w-xs">
              {['Tri-Arb', 'Spread', 'Volume', 'Toxicity'].map((scanner) => (
                <div key={scanner} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                  <div className={`w-1.5 h-1.5 rounded-full ${isScanning ? 'bg-profit animate-pulse' : 'bg-muted-foreground'}`} />
                  <span className="text-xs text-muted-foreground">{scanner}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {opportunities.map((opp) => (
              <div key={opp.id} className="p-3 sm:p-4 hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getTypeColor(opp.type)}`}>
                      {getTypeLabel(opp.type)}
                    </span>
                    <span className="font-medium text-sm">{opp.symbol}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{opp.expiresIn}s</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                  <div>
                    <span className="text-muted-foreground">Net Edge</span>
                    <p className="font-mono text-profit">+{opp.expectedEdge.toFixed(3)}%</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Confidence</span>
                    <p className="font-mono">{opp.confidence}%</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Risk</span>
                    <p className={`font-medium ${
                      opp.riskLevel === 'low' ? 'text-profit' :
                      opp.riskLevel === 'medium' ? 'text-warning' : 'text-destructive'
                    }`}>
                      {opp.riskLevel.toUpperCase()}
                    </p>
                  </div>
                </div>
                
                <p className="text-xs text-muted-foreground truncate">{opp.details}</p>
                
                {opp.type === 'arbitrage' && opp.route && (
                  <div className="mt-2 flex items-center gap-1 text-xs">
                    {opp.route.map((step, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="text-primary font-mono">{step}</span>
                        {i < opp.route!.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
