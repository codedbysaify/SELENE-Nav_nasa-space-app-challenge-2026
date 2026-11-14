"use client";
import dynamic from "next/dynamic";
import TopBar from "@/components/layout/TopBar";
import InformationPanel from "@/components/layout/InformationPanel";
import ExplorationControls from "@/components/lunar/ExplorationControls";
import LayerSelector from "@/components/ui/LayerSelector";
import LoadingIndicator from "@/components/ui/LoadingIndicator";
import AboutPanel from "@/components/layout/AboutPanel";
import PoleLabels from "@/components/lunar/PoleLabels";

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
      <TopBar />
      <LayerSelector />
      <InformationPanel />
      <ExplorationControls />
      <LoadingIndicator />
      <AboutPanel />
    </main>
  );
}
