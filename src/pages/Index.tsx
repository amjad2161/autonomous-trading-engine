import { DashboardLayout } from "@/components/layout";
import { 
  TreasuryPanel, 
  PositionsPanel, 
  RiskControlPanel, 
  ActivityLog,
  MarketOverview,
  OpportunitiesPanel,
  BacktestPanel,
  ContinuousTradingPanel,
  AutonomousControlPanel,
  TradingChatPanel,
  PerformanceDashboard,
  CronJobSetup,
  TickScalpingPanel,
  MasterControlPanel,
  AdvancedAnalytics,
  TradeHistoryTable,
  HyperEnginePanel,
  SettingsPanel,
  TradingStatsPanel,
  RapidTraderPanel,
  GoalsPanel,
  TradingModePanel
} from "@/components/dashboard";
import { useCredentials } from "@/hooks/useCredentials";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Server, Zap, Brain, BarChart3, Settings, FlaskConical, Rocket, Gauge } from "lucide-react";

const Index = () => {
  const { isLoading, isServerMode } = useCredentials();

  // Show loading state while initializing
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">מתחבר למערכת...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <Tabs defaultValue="hyper" className="w-full">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <TabsList className="flex-wrap">
            <TabsTrigger value="hyper" className="flex items-center gap-1">
              <Rocket className="h-3 w-3" />
              Hyper
            </TabsTrigger>
            <TabsTrigger value="autopilot" className="flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              Autopilot
            </TabsTrigger>
            <TabsTrigger value="control" className="flex items-center gap-1">
              <Settings className="h-3 w-3" />
              בקרה
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              אנליטיקס
            </TabsTrigger>
            <TabsTrigger value="scalping" className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              Scalping
            </TabsTrigger>
            <TabsTrigger value="history">היסטוריה</TabsTrigger>
            <TabsTrigger value="backtest" className="flex items-center gap-1">
              <FlaskConical className="h-3 w-3" />
              Backtest
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-1">
              ⚙️ הגדרות
            </TabsTrigger>
          </TabsList>
          
          {isServerMode && (
            <Badge variant="outline" className="text-xs border-primary/50 text-primary">
              <Server className="h-3 w-3 mr-1" />
              Server Mode
            </Badge>
          )}
        </div>
        
        {/* Hyper Engine Tab - NEW DEFAULT */}
        <TabsContent value="hyper" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Hyper Engine Panel */}
            <div className="lg:col-span-4">
              <HyperEnginePanel />
            </div>
            
            {/* Goals Panel - NEW! */}
            <div className="lg:col-span-4">
              <GoalsPanel />
            </div>
            
            {/* Trading Stats Panel */}
            <div className="lg:col-span-4">
              <TradingStatsPanel />
            </div>
            
            {/* Treasury */}
            <div className="lg:col-span-4">
              <TreasuryPanel />
            </div>
            
            {/* Positions */}
            <div className="lg:col-span-4 h-[350px]">
              <PositionsPanel />
            </div>
            
            {/* Activity Log */}
            <div className="lg:col-span-4 h-[350px]">
              <ActivityLog />
            </div>
          </div>
        </TabsContent>
        
        {/* Autopilot / Trading Mode Tab */}
        <TabsContent value="autopilot" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-4">
              <TradingModePanel />
            </div>
            <div className="lg:col-span-4">
              <RiskControlPanel />
            </div>
            <div className="lg:col-span-4">
              <TradingStatsPanel />
            </div>
            <div className="lg:col-span-6 h-[350px]">
              <PositionsPanel />
            </div>
            <div className="lg:col-span-6 h-[350px]">
              <ActivityLog />
            </div>
          </div>
        </TabsContent>

        {/* Control Panel Tab */}
        <TabsContent value="control" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Master Control Panel */}
            <div className="lg:col-span-4">
              <MasterControlPanel />
            </div>
            
            {/* Treasury */}
            <div className="lg:col-span-4">
              <TreasuryPanel />
            </div>
            
            {/* Positions */}
            <div className="lg:col-span-4">
              <PositionsPanel />
            </div>
            
            {/* AI Chat */}
            <div className="lg:col-span-6 h-[400px]">
              <TradingChatPanel />
            </div>
            
            {/* Activity Log */}
            <div className="lg:col-span-6 h-[400px]">
              <ActivityLog />
            </div>
          </div>
        </TabsContent>
        
        {/* Analytics Tab */}
        <TabsContent value="analytics" className="mt-0">
          <AdvancedAnalytics />
        </TabsContent>
        
        {/* Scalping Tab */}
        <TabsContent value="scalping" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RapidTraderPanel />
            <TickScalpingPanel />
            <div className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-4 h-[350px]">
              <PositionsPanel />
              <ActivityLog />
            </div>
          </div>
        </TabsContent>
        
        {/* History Tab */}
        <TabsContent value="history" className="mt-0">
          <TradeHistoryTable />
        </TabsContent>
        
        {/* Backtest Tab */}
        <TabsContent value="backtest" className="mt-0">
          <div className="h-[calc(100vh-12rem)]">
            <BacktestPanel />
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-4xl">
            <SettingsPanel />
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
};

export default Index;
