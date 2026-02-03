import { Bell, RefreshCw, Wifi, WifiOff, Clock, Settings, LogOut, Menu } from "lucide-react";
import { useSpotBalances, useTotalPortfolioValue, useDailyPnL } from "@/hooks/useGateApi";
import { useRealtimeTickers, useWebSocketStatus } from "@/hooks/useGateWebSocket";
import { formatUSDT, formatPercentage } from "@/lib/gate-api";
import { useCredentials } from "@/hooks/useCredentials";
import { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// All pairs we need for portfolio valuation
const ALL_PAIRS = [
  'BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'DOGE_USDT', 'ADA_USDT',
  'AVAX_USDT', 'DOT_USDT', 'LINK_USDT', 'MATIC_USDT', 'UNI_USDT', 'ATOM_USDT',
  'LTC_USDT', 'BCH_USDT', 'NEAR_USDT', 'APT_USDT', 'OP_USDT', 'ARB_USDT'
];

interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { data: balances, isLoading, isError, dataUpdatedAt } = useSpotBalances();
  const { data: tickers } = useRealtimeTickers(ALL_PAIRS);
  const wsStatus = useWebSocketStatus();
  const { clearCredentials, credentials } = useCredentials();
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Update current time every second for live display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  // Calculate total portfolio value (all assets converted to USDT)
  const totalPortfolioValue = useTotalPortfolioValue(balances, tickers);
  
  // Calculate daily P&L based on 24h price changes
  const dailyPnL = useDailyPnL(balances, tickers);

  const lastUpdate = currentTime.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  });

  const handleDisconnect = () => {
    clearCredentials();
    window.location.reload();
  };

  // Mask API key for display
  const maskedKey = credentials?.apiKey 
    ? `${credentials.apiKey.slice(0, 4)}...${credentials.apiKey.slice(-4)}`
    : 'Not connected';

  return (
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-2 sm:px-4">
      {/* Left: Menu + Connection Status */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Mobile menu button */}
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground"
        >
          <Menu className="w-5 h-5" />
        </button>
        
        <div className="flex items-center gap-2">
          {isError || wsStatus === 'error' ? (
            <>
              <WifiOff className="w-4 h-4 text-destructive" />
              <span className="text-sm text-destructive hidden sm:inline">Disconnected</span>
            </>
          ) : wsStatus === 'connected' ? (
            <>
              <Wifi className="w-4 h-4 text-profit animate-pulse" />
              <span className="text-sm text-profit hidden sm:inline">Live</span>
            </>
          ) : wsStatus === 'connecting' ? (
            <>
              <Wifi className="w-4 h-4 text-warning animate-pulse" />
              <span className="text-sm text-warning hidden sm:inline">Connecting...</span>
            </>
          ) : (
            <>
              <Wifi className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground hidden sm:inline">Gate.io</span>
            </>
          )}
        </div>
        
        <div className="hidden sm:block h-4 w-px bg-border" />
        
        <div className="hidden sm:flex items-center gap-2 text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span className="text-sm font-mono">{lastUpdate}</span>
        </div>
      </div>

      {/* Center: Quick Stats - responsive */}
      <div className="flex items-center gap-2 sm:gap-6">
        <div className="text-center">
          <p className="text-[10px] sm:text-xs text-muted-foreground">Portfolio</p>
          <p className="font-mono text-sm sm:text-lg font-semibold text-foreground">
            {isLoading ? '---' : formatUSDT(totalPortfolioValue)}
          </p>
        </div>
        
        <div className="hidden sm:block h-8 w-px bg-border" />
        
        <div className="hidden sm:block text-center">
          <p className="text-xs text-muted-foreground">Daily P&L</p>
          <p className={`font-mono text-lg font-semibold ${dailyPnL.amount >= 0 ? 'text-profit' : 'text-destructive'}`}>
            {dailyPnL.amount >= 0 ? '+' : ''}{formatUSDT(dailyPnL.amount)}
            <span className="text-xs ml-1">
              ({formatPercentage(dailyPnL.percent)})
            </span>
          </p>
        </div>
        
        <div className="hidden md:block h-8 w-px bg-border" />
        
        <div className="hidden md:block text-center">
          <p className="text-xs text-muted-foreground">Open Positions</p>
          <p className="font-mono text-lg font-semibold text-foreground">
            0
          </p>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1 sm:gap-2">
        <button className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <RefreshCw className={`w-4 sm:w-5 h-4 sm:h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
        <button className="hidden sm:block p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-profit rounded-full" />
        </button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <Settings className="w-4 sm:w-5 h-4 sm:h-5" />
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
