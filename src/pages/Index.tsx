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
      <div className="grid grid-cols-12 gap-4 h-[calc(100vh-7rem)]">
        {/* Left Column - Treasury & Risk */}
        <div className="col-span-3 flex flex-col gap-4">
          <div className="flex-1 min-h-0">
            <TreasuryPanel />
          </div>
          <div className="h-80">
            <RiskControlPanel />
          </div>
        </div>
        
        {/* Center Column - Positions & Opportunities */}
        <div className="col-span-6 flex flex-col gap-4">
          <div className="flex-1 min-h-0">
            <PositionsPanel />
          </div>
          <div className="h-80">
            <OpportunitiesPanel />
          </div>
        </div>
        
        {/* Right Column - Market & Activity */}
        <div className="col-span-3 flex flex-col gap-4">
          <div className="flex-1 min-h-0">
            <MarketOverview />
          </div>
          <div className="h-80">
            <ActivityLog />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
