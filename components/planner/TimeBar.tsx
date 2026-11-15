"use client";
/**
 * Mission timeline: play/pause + slider. For every step it shows whether power (Sun) and a
 * direct Earth link are available, both at the ellipse centre and as a share of the whole
 * ellipse (80 m cells). Two strips above the slider show the availability over the full mission.
 * The timeline never changes the verdict or key numbers.
 */
import { useEffect, useMemo } from "react";
import { store, useAppStore } from "@/lib/store";
import { EARTH_COLOR, SUN_COLOR } from "@/lib/shaders";
import { fmtUtc } from "./PlannerPanel";
import InfoTip from "@/components/ui/InfoTip";

const SPEEDS = [1, 3, 6, 12];
const playSpeed = { value: 3 };

/** Runs [start, end) of hours where flag(t) is true. */
function runs(n: number, flag: (t: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let t = 0; t <= n; t++) {
    const on = t < n && flag(t);
    if (on && s < 0) s = t;
    if (!on && s >= 0) {
      out.push([s, t]);
      s = -1;
    }
  }
  return out;
}

function Strip({ label, color, spans, hours, cursor }: { label: string; color: string; spans: [number, number][]; hours: number; cursor: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[14px] shrink-0 text-center text-[11px]" aria-hidden>{label}</span>
      <svg className="h-[7px] min-w-0 flex-1" viewBox={`0 0 ${hours} 1`} preserveAspectRatio="none" aria-hidden>
        <rect x={0} y={0} width={hours} height={1} fill="rgba(148,170,196,0.14)" />
        {spans.map(([a, b]) => (
          <rect key={a} x={a} y={0} width={b - a} height={1} fill={color} />
        ))}
        <rect x={Math.max(0, Math.min(hours - 0.5, cursor - 0.25))} y={0} width={Math.max(0.5, hours / 300)} height={1} fill="#e8edf3" />
      </svg>
    </div>
  );
}

export default function TimeBar() {
  const landingMs = useAppStore((s) => s.landingMs);
  const days = useAppStore((s) => s.missionDays);
  const timeMs = useAppStore((s) => s.timeMs);
  const playing = useAppStore((s) => s.playing);
  const analysis = useAppStore((s) => s.analysis);
  const step = useAppStore((s) => s.planStep);
  const stats = useAppStore((s) => s.timeStats);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = store.get();
      if (s.landingMs === null || s.timeMs === null) return;
      const end = s.landingMs + s.missionDays * 86400e3;
      const next = s.timeMs + playSpeed.value * 3600e3;
      if (next >= end) store.set({ timeMs: end, playing: false });
      else store.set({ timeMs: next });
    }, 220);
    return () => clearInterval(id);
  }, [playing]);

  // availability at the ellipse centre over the whole mission (from the analysis, hourly)
  const spans = useMemo(() => {
    if (!analysis) return null;
    const S = analysis.series, n = analysis.hours;
    return {
      sun: runs(n, (t) => S[t * 6] + 0.27 > S[t * 6 + 1]),
      earth: runs(n, (t) => S[t * 6 + 3] > S[t * 6 + 4]),
    };
  }, [analysis]);

  if (landingMs === null || step === "date" || timeMs === null) return null;
  const end = landingMs + days * 86400e3;
  const h = Math.round((timeMs - landingMs) / 3600e3);
  const row = analysis && h >= 0 && h < analysis.hours ? h : analysis ? analysis.hours - 1 : -1;
  const S = analysis?.series;
  const sunEl = row >= 0 && S ? S[row * 6] : null, sunHz = row >= 0 && S ? S[row * 6 + 1] : null;
  const earthEl = row >= 0 && S ? S[row * 6 + 3] : null, earthHz = row >= 0 && S ? S[row * 6 + 4] : null;
  const sunUp = sunEl !== null && sunHz !== null ? sunEl + 0.27 > sunHz : null;
  const earthUp = earthEl !== null && earthHz !== null ? earthEl > earthHz : null;
  const fresh = stats && stats.ms === timeMs ? stats : null;
  const lit = fresh ? fresh.litPct : null, seen = fresh ? fresh.earthPct : null;
  const powerOn = lit !== null ? lit >= 0.5 : sunUp;
  const linkOn = seen !== null ? seen >= 0.5 : earthUp;

  return (
    <div className="panel absolute bottom-[112px] left-1/2 z-20 w-[min(660px,calc(100vw-24px))] -translate-x-1/2 px-3 py-2">
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
            <span className="num whitespace-nowrap text-[11px] text-ink-mute">T+{Math.floor(h / 24)} d {h % 24} h</span>
          </div>
          {spans && analysis && (
            <div className="mt-1 space-y-[3px] px-[6px]" title="Strips: when power (☀) and the Earth link (📡) are available at the ellipse centre over the mission">
              <Strip label="☀" color={SUN_COLOR} spans={spans.sun} hours={analysis.hours} cursor={h} />
              <Strip label="📡" color={EARTH_COLOR} spans={spans.earth} hours={analysis.hours} cursor={h} />
            </div>
          )}
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

      {analysis ? (
        <div className="mt-1 grid grid-cols-2 gap-2 border-t border-line pt-1.5 text-[11px] leading-tight max-sm:grid-cols-1 max-sm:gap-1" aria-live="polite">
          <div className="flex items-start gap-1.5">
            <span aria-hidden>☀️</span>
            <span className="min-w-0">
              <span className="font-medium" style={{ color: powerOn ? SUN_COLOR : "#f0a089" }}>
                Power: {powerOn ? "available" : "none"}
              </span>
              <span className="block text-ink-mute">
                {lit !== null ? `${lit.toFixed(0)}% of ellipse in sunlight` : "updating…"}
                {sunEl !== null && sunHz !== null && ` · centre: Sun ${sunEl.toFixed(1)}°, terrain ${sunHz.toFixed(1)}°`}
              </span>
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <span aria-hidden>📡</span>
            <span className="min-w-0">
              <span className="font-medium" style={{ color: linkOn ? EARTH_COLOR : "#f0a089" }}>
                Earth link: {linkOn ? "available" : "none"}
              </span>
              <span className="block text-ink-mute">
                {seen !== null ? `Earth in view from ${seen.toFixed(0)}% of ellipse` : "updating…"}
                {earthEl !== null && earthHz !== null && ` · centre: Earth ${earthEl.toFixed(1)}°, terrain ${earthHz.toFixed(1)}°`}
              </span>
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-1 border-t border-line pt-1.5 text-[11px] text-ink-mute">Analyse an ellipse to see power and Earth-link availability at each step.</p>
      )}
    </div>
  );
}
