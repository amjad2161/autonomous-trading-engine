import { Zap, TrendingUp, ArrowRight, Clock, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";

type OpportunityType = 'arbitrage' | 'spread' | 'breakout' | 'reversion';

interface Opportunity {
  id: string;
  type: OpportunityType;
  symbol: string;
  expectedEdge: number;
  confidence: number;
  expiresIn: number; // seconds
  riskLevel: 'low' | 'medium' | 'high';
  details: string;
}

// Mock opportunities for demo
const mockOpportunities: Opportunity[] = [];

const getTypeLabel = (type: OpportunityType) => {
  switch (type) {
    case 'arbitrage': return 'Tri-Arb';
    case 'spread': return 'Spread';
    case 'breakout': return 'Breakout';
    case 'reversion': return 'Mean Rev';
  }
};

const getTypeColor = (type: OpportunityType) => {
  switch (type) {
    case 'arbitrage': return 'bg-info/20 text-info border-info/30';
    case 'spread': return 'bg-primary/20 text-primary border-primary/30';
    case 'breakout': return 'bg-warning/20 text-warning border-warning/30';
    case 'reversion': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
  }
};

export function OpportunitiesPanel() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>(mockOpportunities);
  const [isScanning, setIsScanning] = useState(true);

  // Simulate scanning animation
  useEffect(() => {
    const interval = setInterval(() => {
      setIsScanning(prev => !prev);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Zap className={`w-4 h-4 text-primary ${isScanning ? 'animate-pulse' : ''}`} />
          <h2 className="font-semibold text-sm">Opportunities</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-profit animate-pulse' : 'bg-muted'}`} />
          <span className="text-xs text-muted-foreground">
            {isScanning ? 'Scanning...' : 'Idle'}
          </span>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto">
        {opportunities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <Zap className="w-8 h-8 text-muted-foreground" />
              </div>
              {isScanning && (
                <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping opacity-20" />
              )}
            </div>
            <p className="text-sm text-muted-foreground">Scanning for opportunities</p>
            <p className="text-xs text-muted-foreground mt-1">
              Multi-scanner active: Arb, Spread, Micro, Breakout
            </p>
            
            {/* Scanner status */}
            <div className="mt-4 grid grid-cols-2 gap-2 w-full max-w-xs">
              {['Tri-Arb', 'Spread', 'Micro', 'Breakout'].map((scanner) => (
                <div key={scanner} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                  <div className="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" />
                  <span className="text-xs text-muted-foreground">{scanner}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {opportunities.map((opp) => (
              <div key={opp.id} className="p-4 hover:bg-muted/20 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getTypeColor(opp.type)}`}>
                      {getTypeLabel(opp.type)}
                    </span>
                    <span className="font-medium">{opp.symbol}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{opp.expiresIn}s</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                  <div>
                    <span className="text-muted-foreground">Net Edge</span>
                    <p className="font-mono text-profit">+{opp.expectedEdge.toFixed(2)}%</p>
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
                
                <p className="text-xs text-muted-foreground">{opp.details}</p>
                
                <button className="mt-2 w-full py-2 rounded bg-primary/20 text-primary text-xs font-medium hover:bg-primary/30 transition-colors flex items-center justify-center gap-2">
                  Execute <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
