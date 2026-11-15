"use client";
import { store, useAppStore } from "@/lib/store";
import { IconInfo, SeleneMark } from "@/components/ui/icons";
import ShareButton from "@/components/planner/ShareButton";

const MODE_LABEL = { global: "Global view", approach: "Approach", terrain: "South Pole terrain" } as const;

export default function TopBar() {
  const mode = useAppStore((s) => s.viewMode);
  const plansCount = useAppStore((s) => s.plans.length);
  const high = useAppStore((s) => s.load.terrainHigh);
  const low = useAppStore((s) => s.load.terrainLow);
  const dataLabel = high === "ready" ? "LOLA 80°S · 160 m" : low === "ready" ? "LOLA 80°S · 640 m" : "LOLA 80°S";

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-gradient-to-b from-[#030509f2] to-[#030509b8] px-4 md:px-5">
      <div className="pointer-events-auto flex items-center gap-3">
        <SeleneMark />
        <div className="flex flex-col leading-none">
          <span className="text-[17px] font-semibold tracking-[0.02em] text-ink">
            SELENE<span className="text-accent">-</span>Nav
          </span>
          <span className="mt-1 text-[9.5px] font-medium tracking-[0.24em] text-ink-mute">LUNAR SOUTH POLE · LANDING PLANNER</span>
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <div className="hidden items-center gap-4 pr-2 text-[11px] text-ink-soft 2xl:flex">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Target <span className="num text-ink">90°S</span>
          </span>
          <span className="h-3 w-px bg-line-strong" />
          <span>{MODE_LABEL[mode]}</span>
          <span className="h-3 w-px bg-line-strong" />
          <span className="num">{dataLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => store.set({ suggestOpen: true })}
          title="Search the whole South Pole and a date range for the best landing plan"
          className="flex h-8 items-center gap-1.5 rounded-md border border-[#7df0b0]/50 px-2.5 text-[12px] text-[#a9f5cd] transition-colors hover:bg-[#7df0b0]/10"
        >
          <span aria-hidden>✨</span>
          <span className="hidden sm:inline">Suggest best plan</span>
        </button>
        <button
          type="button"
          onClick={() => store.set({ plansOpen: true })}
          title="Saved landing plans and comparison"
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <span aria-hidden>📋</span>
          <span className="hidden sm:inline">Plans</span>
          <span className="num rounded bg-white/10 px-1 text-[10.5px]">{plansCount}</span>
        </button>
        <ShareButton />
        <button
          type="button"
          onClick={() => store.set({ aboutOpen: true })}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <IconInfo />
          <span className="hidden xl:inline">Data &amp; methods</span>
        </button>
      </div>
    </header>
  );
}
