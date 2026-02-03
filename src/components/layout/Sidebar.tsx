import { 
  LayoutDashboard, 
  Wallet, 
  Activity, 
  Settings, 
  Shield, 
  BarChart3,
  History,
  Zap,
  AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  badge?: string;
}

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Wallet, label: "Treasury" },
  { icon: Activity, label: "Positions" },
  { icon: BarChart3, label: "Market Data" },
  { icon: Zap, label: "Opportunities" },
  { icon: Shield, label: "Risk Controls" },
  { icon: History, label: "Activity Log" },
  { icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Logo */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
            <Zap className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-semibold text-lg text-sidebar-foreground">TradingCore</h1>
            <p className="text-xs text-muted-foreground">Autonomous System</p>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="terminal-card p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">System Status</span>
            <div className="flex items-center gap-2">
              <div className="status-indicator status-active" />
              <span className="text-xs text-profit font-medium">ACTIVE</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Mode:</span>
              <span className="ml-1 text-foreground">SHADOW</span>
            </div>
            <div>
              <span className="text-muted-foreground">Risk:</span>
              <span className="ml-1 text-warning">MEDIUM</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.label}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
              item.active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
            {item.badge && (
              <span className="ml-auto px-2 py-0.5 text-xs rounded-full bg-primary text-primary-foreground">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Kill Switch */}
      <div className="p-4 border-t border-sidebar-border">
        <button className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-colors">
          <AlertTriangle className="w-5 h-5" />
          <span className="font-medium">KILL SWITCH</span>
        </button>
      </div>
    </aside>
  );
}
