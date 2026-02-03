import { useState } from "react";
import { DashboardLayout } from "@/components/layout";
import { 
  TreasuryPanel, 
  PositionsPanel, 
  RiskControlPanel, 
  ActivityLog,
  MarketOverview,
  OpportunitiesPanel 
} from "@/components/dashboard";
import { CredentialsScreen } from "@/components/CredentialsScreen";
import { useCredentials } from "@/hooks/useCredentials";

const Index = () => {
  const { hasCredentials, isLoading } = useCredentials();
  const [isConnected, setIsConnected] = useState(false);

  // Show loading state while checking credentials
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Show credentials screen if not connected
  if (!hasCredentials && !isConnected) {
    return <CredentialsScreen onSuccess={() => setIsConnected(true)} />;
  }

  return (
    <DashboardLayout>
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
    </DashboardLayout>
  );
};

export default Index;
