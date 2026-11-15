"use client";
import { useLunarCamera } from "@/hooks/useLunarCamera";
import { useAppStore } from "@/lib/store";
import { focusEllipse } from "@/lib/planner-actions";
import { IconGlobe, IconMinus, IconPlus, IconReset, IconTarget } from "@/components/ui/icons";

function IconButton({ label, kbd, onClick, children }: { label: string; kbd?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={kbd ? `${label} (${kbd})` : label}
      className="grid h-9 w-9 place-items-center rounded-md text-ink-soft transition-colors hover:bg-white/5 hover:text-ink"
    >
      {children}
    </button>
  );
}

export default function ExplorationControls() {
  const cam = useLunarCamera();
  const hasEllipse = useAppStore((s) => !!s.ellipse);
  const atPole = cam.viewMode === "terrain";
  const atGlobal = cam.viewMode === "global";

  return (
    <nav
      aria-label="Camera controls"
      className="panel absolute bottom-[60px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap p-1 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
    >
      <button
        type="button"
        onClick={cam.flyToSouthPole}
        disabled={!cam.ready}
        className={`flex h-9 items-center gap-2 rounded-md px-3.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
          atPole ? "bg-accent/10 text-accent" : "bg-accent text-[#04161a] hover:bg-[#7dd6e3]"
        }`}
      >
        <IconTarget />
        <span className="max-sm:hidden">{atPole ? "Re-centre on pole" : "Explore South Pole"}</span>
        <span className="sm:hidden">{atPole ? "Re-centre" : "Explore"}</span>
      </button>
      <button
        type="button"
        onClick={cam.returnToGlobalView}
        aria-label="Return to Global View"
        disabled={!cam.ready || atGlobal}
        className="flex h-9 items-center gap-2 rounded-md px-3 text-[13px] text-ink-soft transition-colors hover:bg-white/5 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
      >
        <IconGlobe />
        <span className="hidden lg:inline">Return to Global View</span>
        <span className="lg:hidden">Global view</span>
      </button>
      {hasEllipse && (
        <button
          type="button"
          onClick={() => focusEllipse()}
          title="Fly to the landing ellipse"
          className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] text-[#f3dca9] transition-colors hover:bg-gold/10"
        >
          <span aria-hidden>🎯</span>
          <span>Ellipse</span>
        </button>
      )}
      <span className="mx-1 h-5 w-px bg-line-strong" />
      <IconButton label="Zoom in" kbd="+" onClick={cam.zoomIn}>
        <IconPlus />
      </IconButton>
      <IconButton label="Zoom out" kbd="−" onClick={cam.zoomOut}>
        <IconMinus />
      </IconButton>
      <IconButton label="Reset camera" onClick={cam.resetCamera}>
        <IconReset />
      </IconButton>
    </nav>
  );
}
