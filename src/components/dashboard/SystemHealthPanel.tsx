import { Activity, AlertTriangle, BarChart3, DollarSign, Percent, TrendingDown, Target, Gauge } from "lucide-react";
import { useAutonomousSystem } from "@/hooks/useAutonomousSystem";

export function SystemHealthPanel() {
  const { kpis, alerts } = useAutonomousSystem();

  const get = (k: string, d = 0) => (kpis && typeof kpis[k] === "number" ? kpis[k] : d);
  const has = kpis !== null;

  const pf = get("profitFactor");
  const pnl = get("totalPnlUsdt");
  const win = get("winRatePct");
  const dd = get("maxDrawdownPct");

  return (
    <div className="terminal-card h-full flex flex-col">
      <div className="terminal-header">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">System Health</h2>
        </div>
        {has && (
          <span className="text-[10px] text-muted-foreground font-mono">{get("count")} trades</span>
        )}
      </div>

      <div className="p-3 sm:p-4 space-y-4 flex-1 overflow-auto">
        {!has && (
          <p className="text-xs text-muted-foreground">ממתין לנתונים מהמערכת… (הפעל את הלולאה כדי לראות KPIs)</p>
        )}

        {has && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat icon={DollarSign} label="P&L כולל" value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
              tone={pnl >= 0 ? "profit" : "destructive"} />
            <Stat icon={BarChart3} label="Profit Factor" value={pf === Infinity ? "∞" : pf.toFixed(2)}
              tone={pf >= 1.5 ? "profit" : pf >= 1 ? "warning" : "destructive"} />
            <Stat icon={Percent} label="Win Rate" value={`${win.toFixed(0)}%`}
              tone={win >= 50 ? "profit" : "warning"} />
            <Stat icon={TrendingDown} label="Max Drawdown" value={`${dd.toFixed(1)}%`}
              tone={dd > 8 ? "destructive" : dd > 4 ? "warning" : "profit"} />
            <Stat icon={Target} label="Fill Rate" value={`${get("fillRatePct").toFixed(0)}%`} />
            <Stat icon={Activity} label="Avg Slippage" value={`${get("avgSlippagePct").toFixed(3)}%`}
              tone={get("avgSlippagePct") > 0.5 ? "warning" : undefined} />
          </div>
        )}

        {/* Alerts */}
        <div className="space-y-2">
          <h3 className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> התראות
          </h3>
          {alerts.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">אין התראות פעילות.</p>
          ) : (
            <div className="space-y-1">
              {alerts.map((a, i) => (
                <div
                  key={i}
                  className={`text-[11px] p-2 rounded border ${
                    a.level === "critical"
                      ? "bg-destructive/10 border-destructive/30 text-destructive"
                      : "bg-warning/10 border-warning/30 text-warning"
                  }`}
                >
                  {a.level === "critical" ? "🔴" : "🟡"} {a.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Target;
  label: string;
  value: string;
  tone?: "profit" | "destructive" | "warning";
}) {
  const toneClass =
    tone === "profit" ? "text-profit" : tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning" : "";
  return (
    <div className="p-2 rounded bg-muted/30 border border-border flex items-center justify-between">
      <span className="flex items-center gap-1 text-muted-foreground"><Icon className="w-3 h-3" />{label}</span>
      <span className={`font-mono ${toneClass}`}>{value}</span>
    </div>
  );
}
