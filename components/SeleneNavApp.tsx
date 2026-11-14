"use client";
import dynamic from "next/dynamic";
import TopBar from "@/components/layout/TopBar";
import InformationPanel from "@/components/layout/InformationPanel";
import ExplorationControls from "@/components/lunar/ExplorationControls";
import LayerSelector from "@/components/ui/LayerSelector";
import LoadingIndicator from "@/components/ui/LoadingIndicator";
import AboutPanel from "@/components/layout/AboutPanel";
import PoleLabels from "@/components/lunar/PoleLabels";
import { SiteLabels } from "@/components/lunar/SiteMarkers";
import PlannerPanel from "@/components/planner/PlannerPanel";
import TimeBar from "@/components/planner/TimeBar";
import Footer from "@/components/layout/Footer";

// WebGL scene is client-only; the interface renders immediately.
const MoonScene = dynamic(() => import("@/components/lunar/MoonScene"), {
  ssr: false,
  loading: () => null,
});

export default function SeleneNavApp() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-space">
      <div className="absolute inset-0" aria-label="3D view of the Moon, focused on the lunar South Pole">
        <MoonScene />
      </div>
      <PoleLabels />
      <SiteLabels />
      <TopBar />
      {/* left column: mission planner */}
      <div className="pointer-events-none absolute bottom-[136px] left-3 top-[68px] z-[22] flex flex-col md:left-4 max-md:right-3">
        <div className="pointer-events-auto flex max-h-full min-h-0">
          <PlannerPanel />
        </div>
      </div>
      {/* right column: layers + telemetry */}
      <div className="pointer-events-none absolute bottom-[136px] right-3 top-[68px] z-20 flex w-[272px] max-w-[calc(100vw-24px)] flex-col gap-2 overflow-y-auto md:right-4 max-md:left-3 max-md:top-[116px] max-md:w-auto">
        <div className="pointer-events-auto">
          <LayerSelector />
        </div>
        <div className="pointer-events-auto">
          <InformationPanel />
        </div>
      </div>
      <TimeBar />
      <ExplorationControls />
      <LoadingIndicator />
      <AboutPanel />
      <Footer />
    </main>
  );
}
