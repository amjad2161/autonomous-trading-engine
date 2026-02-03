import { DashboardLayout } from "@/components/layout";
import { 
  TreasuryPanel, 
  PositionsPanel, 
  RiskControlPanel, 
  ActivityLog,
  MarketOverview,
  OpportunitiesPanel 
} from "@/components/dashboard";

const Index = () => {
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
