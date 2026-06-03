import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { SplineScene, splineSceneUrl } from "@/components/SplineScene";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Spline 3D background — shows the design scene by default; override or disable
  // via VITE_SPLINE_SCENE_URL (set to "" to turn it off).
  const splineUrl = splineSceneUrl();

  return (
    <div className={`min-h-screen flex ${splineUrl ? "bg-transparent" : "bg-background"}`}>
      {splineUrl && (
        <>
          <SplineScene className="fixed inset-0 -z-20 pointer-events-none" />
          {/* readability scrim over the 3D scene (tune opacity to taste) */}
          <div className="fixed inset-0 -z-10 bg-background/70 pointer-events-none" />
        </>
      )}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-2 sm:p-4 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
