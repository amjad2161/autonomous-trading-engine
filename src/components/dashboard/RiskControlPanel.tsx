import { Shield, AlertTriangle, Settings, TrendingDown, BarChart2, Pause, Play, Square } from "lucide-react";
import { useState } from "react";

interface RiskMetric {
  label: string;
  value: string | number;
  limit: string | number;
  percent: number;
  status: 'safe' | 'warning' | 'danger';
}

const riskMetrics: RiskMetric[] = [
  { label: 'Daily Loss', value: '$0.00', limit: '$30.00', percent: 0, status: 'safe' },
  { label: 'Max Exposure', value: '0%', limit: '50%', percent: 0, status: 'safe' },
  { label: 'Open Positions', value: 0, limit: 6, percent: 0, status: 'safe' },
  { label: 'Correlation Risk', value: '0%', limit: '60%', percent: 0, status: 'safe' },
];

type SystemMode = 'active' | 'shadow' | 'paused' | 'halted';

export function RiskControlPanel() {
  const [systemMode, setSystemMode] = useState<SystemMode>('shadow');
  const [killSwitchLevel, setKillSwitchLevel] = useState(0);

  const getModeColor = (mode: SystemMode) => {
    switch (mode) {
      case 'active': return 'text-profit bg-profit/20 border-profit/30';
      case 'shadow': return 'text-info bg-info/20 border-info/30';
      case 'paused': return 'text-warning bg-warning/20 border-warning/30';
      case 'halted': return 'text-destructive bg-destructive/20 border-destructive/30';
    }
  };

  const getStatusColor = (status: RiskMetric['status']) => {
    switch (status) {
      case 'safe': return 'bg-profit';
      case 'warning': return 'bg-warning';
      case 'danger': return 'bg-destructive';
    }
  };

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Risk Controls</h2>
        </div>
        <button className="p-1 hover:bg-muted rounded transition-colors">
          <Settings className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
      
      <div className="p-4 space-y-4 flex-1 overflow-auto">
        {/* System Mode */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">System Mode</p>
          <div className="grid grid-cols-2 gap-2">
            {(['active', 'shadow', 'paused', 'halted'] as SystemMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSystemMode(mode)}
                className={`px-3 py-2 rounded-md border text-xs font-medium transition-colors ${
                  systemMode === mode 
                    ? getModeColor(mode)
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  {mode === 'active' && <Play className="w-3 h-3" />}
                  {mode === 'shadow' && <BarChart2 className="w-3 h-3" />}
                  {mode === 'paused' && <Pause className="w-3 h-3" />}
                  {mode === 'halted' && <Square className="w-3 h-3" />}
                  {mode.toUpperCase()}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Risk Metrics */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Risk Metrics</p>
          <div className="space-y-3">
            {riskMetrics.map((metric) => (
              <div key={metric.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{metric.label}</span>
                  <span className="font-mono">
                    <span className="text-foreground">{metric.value}</span>
                    <span className="text-muted-foreground"> / {metric.limit}</span>
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${getStatusColor(metric.status)}`}
                    style={{ width: `${Math.max(metric.percent, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Kill Switch Levels */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Kill Switch Level</p>
          <div className="grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((level) => (
              <button
                key={level}
                onClick={() => setKillSwitchLevel(level)}
                className={`py-2 rounded text-xs font-medium transition-colors ${
                  killSwitchLevel === level
                    ? level === 0
                      ? 'bg-profit text-primary-foreground'
                      : level === 1
                        ? 'bg-warning text-primary-foreground'
                        : level === 2
                          ? 'bg-destructive/80 text-destructive-foreground'
                          : 'bg-destructive text-destructive-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                L{level}
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {killSwitchLevel === 0 && 'Normal operation - all systems active'}
            {killSwitchLevel === 1 && 'Reduced exposure - no new entries'}
            {killSwitchLevel === 2 && 'Exit only - closing positions'}
            {killSwitchLevel === 3 && 'Full halt - emergency shutdown'}
          </div>
        </div>

        {/* Quick Controls */}
        <div className="grid grid-cols-2 gap-2">
          <button className="px-3 py-2 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors flex items-center justify-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Close All
          </button>
          <button className="px-3 py-2 rounded-md bg-muted hover:bg-muted/80 text-xs font-medium transition-colors flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Cancel Orders
          </button>
        </div>
      </div>
    </div>
  );
}
