import { Bell, RefreshCw, Wifi, WifiOff, Clock, Settings, LogOut } from "lucide-react";
import { useSpotBalances } from "@/hooks/useGateApi";
import { formatUSDT } from "@/lib/gate-api";
import { useCredentials } from "@/hooks/useCredentials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function TopBar() {
  const { data: balances, isLoading, isError, dataUpdatedAt } = useSpotBalances();
  const { clearCredentials, credentials } = useCredentials();
  
  const usdtBalance = balances?.find(b => b.currency === 'USDT');
  const totalUSDT = usdtBalance 
    ? parseFloat(usdtBalance.available) + parseFloat(usdtBalance.locked)
    : 0;

  const lastUpdate = dataUpdatedAt 
    ? new Date(dataUpdatedAt).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
      })
    : '--:--:--';

  const handleDisconnect = () => {
    clearCredentials();
    window.location.reload();
  };

  // Mask API key for display
  const maskedKey = credentials?.apiKey 
    ? `${credentials.apiKey.slice(0, 4)}...${credentials.apiKey.slice(-4)}`
    : 'Not connected';

  return (
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-4">
      {/* Left: Connection Status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {isError ? (
            <>
              <WifiOff className="w-4 h-4 text-destructive" />
              <span className="text-sm text-destructive">Disconnected</span>
            </>
          ) : (
            <>
              <Wifi className="w-4 h-4 text-profit animate-pulse" />
              <span className="text-sm text-muted-foreground">Gate.io</span>
            </>
          )}
        </div>
        
        <div className="h-4 w-px bg-border" />
        
        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span className="text-sm font-mono">{lastUpdate}</span>
        </div>
      </div>

      {/* Center: Quick Stats */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">USDT Balance</p>
          <p className="font-mono text-lg font-semibold text-foreground">
            {isLoading ? '---' : formatUSDT(totalUSDT)}
          </p>
        </div>
        
        <div className="h-8 w-px bg-border" />
        
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Daily P&L</p>
          <p className="font-mono text-lg font-semibold text-profit">
            +$0.00
          </p>
        </div>
        
        <div className="h-8 w-px bg-border" />
        
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Open Positions</p>
          <p className="font-mono text-lg font-semibold text-foreground">
            0
          </p>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
        <button className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-profit rounded-full" />
        </button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <Settings className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-xs text-muted-foreground">API Key</p>
              <p className="text-sm font-mono">{maskedKey}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleDisconnect} className="text-destructive focus:text-destructive">
              <LogOut className="w-4 h-4 mr-2" />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}