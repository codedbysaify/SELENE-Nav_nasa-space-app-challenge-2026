"use client";
/** Mission time slider with play/pause; drives lighting and the live Sun/Earth maps. */
import { useEffect } from "react";
import { store, useAppStore } from "@/lib/store";
import { EARTH_COLOR, SUN_COLOR } from "@/lib/shaders";
import { fmtUtc } from "./PlannerPanel";
import InfoTip from "@/components/ui/InfoTip";

const SPEEDS = [1, 3, 6, 12];

export default function TimeBar() {
  const landingMs = useAppStore((s) => s.landingMs);
  const days = useAppStore((s) => s.missionDays);
  const timeMs = useAppStore((s) => s.timeMs);
  const playing = useAppStore((s) => s.playing);
  const analysis = useAppStore((s) => s.analysis);
  const step = useAppStore((s) => s.planStep);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = store.get();
      if (s.landingMs === null || s.timeMs === null) return;
      const end = s.landingMs + s.missionDays * 86400e3;
      const next = s.timeMs + (playSpeed.value * 3600e3);
      if (next >= end) store.set({ timeMs: end, playing: false });
      else store.set({ timeMs: next });
    }, 160);
    return () => clearInterval(id);
  }, [playing]);

  if (landingMs === null || step === "date" || timeMs === null) return null;
  const end = landingMs + days * 86400e3;
  const h = Math.round((timeMs - landingMs) / 3600e3);
  const row = analysis && h >= 0 && h < analysis.hours ? h : -1;
  const sunUp = row >= 0 ? analysis!.series[row * 6] + 0.27 > analysis!.series[row * 6 + 1] : null;
  const earthUp = row >= 0 ? analysis!.series[row * 6 + 3] > analysis!.series[row * 6 + 4] : null;

  return (
    <div className="panel absolute bottom-[112px] left-1/2 z-20 w-[min(640px,calc(100vw-24px))] -translate-x-1/2 px-3 py-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play mission timeline"}
          onClick={() => store.set({ playing: !playing, timeMs: timeMs >= end ? landingMs : timeMs })}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/8 text-ink hover:bg-white/14"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><rect x="2" y="1.5" width="3" height="9" fill="currentColor" /><rect x="7" y="1.5" width="3" height="9" fill="currentColor" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 1.5v9l7-4.5z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="num flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink max-sm:text-[11px]">{fmtUtc(timeMs)} <InfoTip k="timeSlider" /></span>
            <span className="num whitespace-nowrap text-[11px] text-ink-mute">
              T+{Math.floor(h / 24)} d {h % 24} h
            </span>
          </div>
          <input
            aria-label="Mission time"
            className="range"
            type="range"
            min={landingMs}
            max={end}
            step={3600e3}
            value={timeMs}
            onChange={(e) => store.set({ timeMs: Number(e.target.value), playing: false })}
          />
        </div>
        <div className="hidden shrink-0 flex-col gap-0.5 text-[10.5px] sm:flex">
          {sunUp !== null && (
            <>
              <span style={{ color: sunUp ? SUN_COLOR : "#6c7889" }}>{sunUp ? "● Sun up" : "○ Sun down"}</span>
              <span style={{ color: earthUp ? EARTH_COLOR : "#6c7889" }}>{earthUp ? "● Earth up" : "○ Earth down"}</span>
            </>
          )}
        </div>
        <select
          aria-label="Playback speed"
          defaultValue={String(playSpeed.value)}
          onChange={(e) => (playSpeed.value = Number(e.target.value))}
          className="num shrink-0 rounded border border-line bg-[#0b1018] px-1 py-1 text-[11px] text-ink-soft max-sm:hidden"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s} h/step</option>
          ))}
        </select>
      </div>
    </div>
  );
}

const playSpeed = { value: 3 };
