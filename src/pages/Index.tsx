import { DashboardLayout } from "@/components/layout";
import { 
  TreasuryPanel, 
  PositionsPanel, 
  RiskControlPanel, 
  ActivityLog,
  MarketOverview,
  OpportunitiesPanel,
  BacktestPanel
} from "@/components/dashboard";
import { useCredentials } from "@/hooks/useCredentials";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Server } from "lucide-react";

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

  // Server mode - go directly to dashboard (no credentials screen needed)
  return (
    <DashboardLayout>
      <Tabs defaultValue="dashboard" className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="dashboard">דשבורד</TabsTrigger>
            <TabsTrigger value="backtest">Backtesting</TabsTrigger>
          </TabsList>
          
          {isServerMode && (
            <Badge variant="outline" className="text-xs border-primary/50 text-primary">
              <Server className="h-3 w-3 mr-1" />
              Server Mode
            </Badge>
          )}
        </div>
        
        <TabsContent value="dashboard" className="mt-0">
          {/* Mobile: Single column, Tablet: 2 columns, Desktop: 3 columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3 sm:gap-4 pb-4">
            
            {/* Treasury Panel */}
            <div className="xl:col-span-3 h-64 sm:h-80 xl:h-auto xl:row-span-1">
              <TreasuryPanel />
            </div>
            
            {/* Market Overview - Shows prominently on mobile */}
            <div className="xl:col-span-3 xl:row-start-1 xl:col-start-10 h-64 sm:h-80 xl:h-auto">
              <MarketOverview />
            </div>
            
            {/* Positions Panel - Full width on tablet */}
            <div className="md:col-span-2 xl:col-span-6 xl:row-start-1 xl:col-start-4 h-72 sm:h-96 xl:h-auto">
              <PositionsPanel />
            </div>
            
            {/* Risk Control */}
            <div className="xl:col-span-3 h-64 sm:h-80">
              <RiskControlPanel />
            </div>
            
            {/* Opportunities */}
            <div className="md:col-span-2 xl:col-span-6 h-64 sm:h-80">
              <OpportunitiesPanel />
            </div>
            
            {/* Activity Log */}
            <div className="xl:col-span-3 h-64 sm:h-80">
              <ActivityLog />
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="backtest" className="mt-0">
          <div className="h-[calc(100vh-12rem)]">
            <BacktestPanel />
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
};

export default Index;
