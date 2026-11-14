"use client";
/**
 * Mission planner: Step 1 date → Step 2 landing ellipse → Step 3 results.
 * Every number shown comes from the NASA/JPL ephemeris and the LOLA terrain horizon.
 */
import { useEffect, useState } from "react";
import { store, useAppStore } from "@/lib/store";
import { earliestLandingMs, loadEphemeris, type Ephemeris } from "@/lib/ephemeris";
import { confirmDate, editDate, runAnalysis, setEllipse, startDrawing, DEFAULT_ELLIPSE } from "@/lib/planner-actions";
import { formatLat, formatLon } from "@/lib/lunar-coordinates";
import { SITE_LABELS } from "@/lib/sites";
import { EARTH_COLOR, SUN_COLOR } from "@/lib/shaders";
import { ElevationChart, HorizonPanorama } from "./Charts";
import { IconChevron } from "@/components/ui/icons";

const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const fromInput = (v: string) => Date.parse(`${v}:00Z`);
export const fmtUtc = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function fmtDuration(h: number | null): string {
  if (h === null) return "> 90 days";
  if (h < 1) return `${Math.round(h * 60)} min`;
  const d = Math.floor(h / 24), r = Math.round(h - d * 24);
  return d > 0 ? `${d} d ${r} h` : `${r} h`;
}

function StepHeader({ n, title, active, done, onEdit }: { n: number; title: string; active: boolean; done: boolean; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className={`num grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold ${
            active ? "bg-accent text-[#04161a]" : done ? "bg-accent/20 text-accent" : "bg-white/8 text-ink-mute"
          }`}
        >
          {n}
        </span>
        <span className={`text-[12.5px] font-medium ${active || done ? "text-ink" : "text-ink-mute"}`}>{title}</span>
      </div>
      {done && !active && onEdit && (
        <button type="button" onClick={onEdit} className="text-[11px] text-accent hover:underline">
          Edit
        </button>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "sun" | "earth" | "warn" }) {
  const color = tone === "sun" ? SUN_COLOR : tone === "earth" ? EARTH_COLOR : tone === "warn" ? "#f0a089" : undefined;
  return (
    <div className="rounded-md border border-line bg-black/20 px-2.5 py-2">
      <div className="text-[10.5px] text-ink-mute">{label}</div>
      <div className="num text-[15px] font-medium leading-tight" style={{ color: color ?? "#e8edf3" }}>{value}</div>
      {sub && <div className="text-[10px] leading-snug text-ink-mute">{sub}</div>}
    </div>
  );
}

function NumField({ label, value, step, min, max, unit, onChange }: { label: string; value: number; step: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  const id = `nf-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <label htmlFor={id} className="block">
      <span className="text-[10.5px] text-ink-mute">{label}</span>
      <span className="mt-0.5 flex items-center rounded border border-line bg-black/30 focus-within:border-accent/60">
        <input
          id={id}
          type="number"
          step={step}
          min={min}
          max={max}
          value={Number.isFinite(value) ? Number(value.toFixed(4)) : ""}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className="num w-full min-w-0 bg-transparent px-2 py-1 text-[12px] text-ink outline-none"
        />
        <span className="pr-2 text-[10px] text-ink-mute">{unit}</span>
      </span>
    </label>
  );
}

export default function PlannerPanel() {
  const step = useAppStore((s) => s.planStep);
  const landingMs = useAppStore((s) => s.landingMs);
  const missionDays = useAppStore((s) => s.missionDays);
  const ellipse = useAppStore((s) => s.ellipse);
  const drawing = useAppStore((s) => s.drawing);
  const analysis = useAppStore((s) => s.analysis);
  const progress = useAppStore((s) => s.analysisProgress);
  const error = useAppStore((s) => s.analysisError);
  const timeMs = useAppStore((s) => s.timeMs);
  const [eph, setEph] = useState<Ephemeris | null>(null);
  const [draftMs, setDraftMs] = useState<number | null>(null);
  const [draftDays, setDraftDays] = useState(14);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    loadEphemeris().then((e) => {
      setEph(e);
      setDraftMs((d) => d ?? earliestLandingMs(e) + 7 * 86400e3);
    });
    if (window.innerWidth < 768) setOpen(false);
  }, []);

  const minMs = eph ? earliestLandingMs(eph) : 0;
  const maxMs = eph ? eph.endMs - 90 * 86400e3 : 0;
  const dateValid = draftMs !== null && eph !== null && draftMs >= minMs && draftMs <= maxMs;
  const analysed = step === "results" && analysis;

  return (
    <section aria-label="Mission planner" className="panel flex max-h-full w-[320px] max-w-[calc(100vw-24px)] flex-col max-md:w-full">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex shrink-0 items-center justify-between px-3.5 py-2.5 text-left">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <span className="text-[12.5px] font-medium text-ink">Landing site planner</span>
        </span>
        <IconChevron className={`text-ink-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-line px-3.5 pb-4 pt-3">
          {/* ---------------- Step 1: date */}
          <div className="space-y-2.5">
            <StepHeader n={1} title="Landing date & mission" active={step === "date"} done={landingMs !== null} onEdit={editDate} />
            {step === "date" ? (
              <div className="space-y-2.5">
                <label className="block" htmlFor="landing-time">
                  <span className="text-[10.5px] text-ink-mute">Landing date & time (UTC)</span>
                  <input
                    id="landing-time"
                    type="datetime-local"
                    step={3600}
                    value={draftMs !== null ? toInput(draftMs) : ""}
                    min={eph ? toInput(minMs) : undefined}
                    max={eph ? toInput(maxMs) : undefined}
                    onChange={(e) => setDraftMs(fromInput(e.target.value))}
                    className="num mt-0.5 w-full rounded border border-line bg-black/30 px-2 py-1.5 text-[12.5px] text-ink outline-none [color-scheme:dark] focus:border-accent/60"
                  />
                </label>
                <NumField label="Mission length" value={draftDays} step={1} min={1} max={60} unit="days" onChange={(v) => setDraftDays(Math.round(v))} />
                {draftMs !== null && eph && !dateValid && (
                  <p className="text-[11px] text-[#f0a089]">Choose a time between {fmtUtc(minMs)} and {fmtUtc(maxMs)}.</p>
                )}
                <button
                  type="button"
                  disabled={!dateValid}
                  onClick={() => draftMs !== null && confirmDate(draftMs, draftDays)}
                  className="h-9 w-full rounded-md bg-accent text-[13px] font-medium text-[#04161a] transition-colors hover:bg-[#7dd6e3] disabled:opacity-40"
                >
                  Next: draw landing ellipse
                </button>
                <p className="text-[10.5px] leading-snug text-ink-mute">
                  Any time from now to 2035. Sun & Earth positions are precomputed hourly from NASA JPL ephemerides.
                </p>
              </div>
            ) : (
              landingMs !== null && (
                <p className="num text-[11.5px] text-ink-soft">
                  {fmtUtc(landingMs)} · {missionDays} d
                </p>
              )
            )}
          </div>

          {/* ---------------- Step 2: ellipse */}
          <div className="space-y-2.5">
            <StepHeader n={2} title="Landing ellipse" active={step === "draw"} done={!!analysis} onEdit={step === "results" ? startDrawing : undefined} />
            {step === "draw" && (
              <div className="space-y-2.5">
                {drawing ? (
                  <p className="rounded-md border border-gold/40 bg-gold/10 px-2.5 py-2 text-[11.5px] leading-snug text-[#f3dca9]">
                    <strong className="font-medium">Draw on the South Pole:</strong> press on the centre, drag to set the length
                    and direction, release. Or pick a key location below.
                  </p>
                ) : (
                  <button type="button" onClick={startDrawing} className="h-8 w-full rounded-md border border-gold/50 text-[12px] text-[#f3dca9] hover:bg-gold/10">
                    {ellipse ? "Redraw ellipse" : "Draw ellipse on the map"}
                  </button>
                )}
                <label className="block">
                  <span className="text-[10.5px] text-ink-mute">Key location</span>
                  <select
                    className="mt-0.5 w-full rounded border border-line bg-[#0b1018] px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent/60"
                    value=""
                    onChange={(e) => {
                      const s = SITE_LABELS.find((l) => l.key === e.target.value);
                      if (s) {
                        const cur = store.get().ellipse;
                        setEllipse({ lat: s.lat, lon: s.lon, aKm: cur?.aKm ?? DEFAULT_ELLIPSE.aKm, bKm: cur?.bKm ?? DEFAULT_ELLIPSE.bKm, headingDeg: cur?.headingDeg ?? 0 });
                        store.set({ drawing: false });
                      }
                    }}
                  >
                    <option value="">Choose a location…</option>
                    {SITE_LABELS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}{s.artemis.length ? " · Artemis III region (approx.)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {ellipse && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <NumField label="Centre latitude" value={ellipse.lat} step={0.01} min={-90} max={-80.5} unit="°" onChange={(v) => setEllipse({ ...ellipse, lat: v })} />
                      <NumField label="Centre longitude" value={ellipse.lon} step={0.1} min={-180} max={180} unit="°E" onChange={(v) => setEllipse({ ...ellipse, lon: v })} />
                      <NumField label="Semi-major axis" value={ellipse.aKm} step={0.1} min={0.2} max={40} unit="km" onChange={(v) => setEllipse({ ...ellipse, aKm: v, bKm: Math.min(ellipse.bKm, v) })} />
                      <NumField label="Semi-minor axis" value={ellipse.bKm} step={0.1} min={0.1} max={40} unit="km" onChange={(v) => setEllipse({ ...ellipse, bKm: Math.min(v, ellipse.aKm) })} />
                      <NumField label="Heading" value={ellipse.headingDeg} step={1} min={0} max={180} unit="°" onChange={(v) => setEllipse({ ...ellipse, headingDeg: v })} />
                    </div>
                    <button
                      type="button"
                      disabled={!!progress}
                      onClick={runAnalysis}
                      className="h-9 w-full rounded-md bg-accent text-[13px] font-medium text-[#04161a] hover:bg-[#7dd6e3] disabled:opacity-50"
                    >
                      Analyse power & communication
                    </button>
                  </>
                )}
              </div>
            )}
            {step === "results" && ellipse && (
              <p className="num text-[11.5px] text-ink-soft">
                {formatLat(ellipse.lat, 2)} {formatLon(ellipse.lon, 2)} · {(2 * ellipse.aKm).toFixed(1)} × {(2 * ellipse.bKm).toFixed(1)} km
              </p>
            )}
            {progress && (
              <div role="status" aria-live="polite" className="space-y-1">
                <div className="h-1 overflow-hidden rounded bg-white/10">
                  <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(progress.value * 100)}%` }} />
                </div>
                <p className="text-[10.5px] text-ink-mute">{progress.label}</p>
              </div>
            )}
            {error && <p className="text-[11px] text-[#f0a089]">Analysis failed: {error}. Try a smaller ellipse or another location.</p>}
          </div>

          {/* ---------------- Step 3: results */}
          <div className="space-y-2.5">
            <StepHeader n={3} title="Power & communication" active={step === "results"} done={false} />
            {analysed && landingMs !== null && (
              <div className="space-y-3">
                <div>
                  <div className="eyebrow mb-1.5">At landing · ellipse centre</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Metric
                      label={analysis.sun.visibleAtLanding ? "Time until sunset" : "Time until sunrise"}
                      value={fmtDuration(analysis.sun.hoursUntilChange)}
                      sub={analysis.sun.visibleAtLanding ? "Sun up at landing" : "Sun hidden at landing"}
                      tone={analysis.sun.visibleAtLanding ? "sun" : "warn"}
                    />
                    <Metric
                      label={analysis.earth.visibleAtLanding ? "Time until Earthset" : "Time until Earthrise"}
                      value={fmtDuration(analysis.earth.hoursUntilChange)}
                      sub={analysis.earth.visibleAtLanding ? "Earth in view" : "No direct link"}
                      tone={analysis.earth.visibleAtLanding ? "earth" : "warn"}
                    />
                    <Metric label="Sun elevation" value={`${analysis.series[0].toFixed(2)}°`} sub={`terrain horizon ${analysis.series[1].toFixed(2)}° · az ${analysis.series[2].toFixed(0)}°`} />
                    <Metric label="Earth elevation" value={`${analysis.series[3].toFixed(2)}°`} sub={`terrain horizon ${analysis.series[4].toFixed(2)}° · az ${analysis.series[5].toFixed(0)}°`} />
                  </div>
                  <p className="mt-1.5 text-[10.5px] text-ink-mute">
                    Inside the ellipse at landing: <span className="num text-ink-soft">{analysis.landing.litAreaPct.toFixed(0)}%</span> sunlit ·{" "}
                    <span className="num text-ink-soft">{analysis.landing.earthAreaPct.toFixed(0)}%</span> Earth in view
                  </p>
                </div>

                <div>
                  <div className="eyebrow mb-1.5">Over the {missionDays}-day mission · whole ellipse</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Metric label="Sunlit" value={`${analysis.mission.sunlitPct.toFixed(0)}%`} sub={`range ${analysis.mission.sunlitMinPct.toFixed(0)}–${analysis.mission.sunlitMaxPct.toFixed(0)}% across cells`} tone="sun" />
                    <Metric label="Earth visible" value={`${analysis.mission.earthPct.toFixed(0)}%`} tone="earth" />
                    <Metric label="Longest night" value={fmtDuration(analysis.mission.longestNightH)} sub={`centre: ${fmtDuration(analysis.mission.centreLongestNightH)}`} tone={analysis.mission.longestNightH > 72 ? "warn" : undefined} />
                    <Metric label="Power + link" value={`${analysis.mission.bothPctCentre.toFixed(0)}%`} sub="hours with Sun and Earth both visible (centre)" />
                  </div>
                </div>

                <div>
                  <div className="eyebrow mb-1.5">Terrain inside the ellipse</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Metric label="Mean slope" value={`${analysis.terrain.slopeMeanDeg.toFixed(1)}°`} />
                    <Metric label="Max slope" value={`${analysis.terrain.slopeMaxDeg.toFixed(1)}°`} tone={analysis.terrain.slopeMaxDeg > 15 ? "warn" : undefined} />
                    <Metric label="PSR" value={`${analysis.terrain.psrPct.toFixed(1)}%`} />
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-ink-mute">
                    {analysis.count.toLocaleString("en-US")} cells at {Math.round(analysis.cellKm * 1000)} m · slope from the 80 m LOLA DEM ·
                    PSR fraction from LPSR (640 m grid). Indicative only: landing suitability needs more than slope.
                  </p>
                </div>

                <div>
                  <div className="eyebrow mb-1">Elevation vs. terrain horizon · centre</div>
                  <div className="mb-1 flex gap-3 text-[10px] text-ink-mute">
                    <span style={{ color: SUN_COLOR }}>— Sun</span>
                    <span style={{ color: EARTH_COLOR }}>— Earth</span>
                    <span>- - horizon in that direction · bars: visible</span>
                  </div>
                  <ElevationChart series={analysis.series} hours={analysis.hours} landingMs={landingMs} timeMs={timeMs} />
                </div>
                <div>
                  <div className="eyebrow mb-1">Horizon panorama · centre (360 directions, 80 m)</div>
                  <HorizonPanorama horizon={analysis.centreHorizon} series={analysis.series} hours={analysis.hours} timeMs={timeMs} landingMs={landingMs} />
                </div>
              </div>
            )}
            {step !== "results" && <p className="text-[11px] text-ink-mute">Results appear after you analyse an ellipse.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
