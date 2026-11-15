"use client";
/**
 * Mission planner: Step 1 date → Step 2 landing ellipse → Step 3 verdict.
 * Every number shown comes from the NASA/JPL ephemeris and the LOLA terrain horizon.
 * The verdict and key numbers depend only on the analysis + thresholds, never on the time slider.
 */
import { useEffect, useMemo, useState } from "react";
import { store, useAppStore } from "@/lib/store";
import { earliestLandingMs, loadEphemeris, type Ephemeris } from "@/lib/ephemeris";
import { confirmDate, editDate, focusEllipse, runAnalysis, setEllipse, startDrawing, DEFAULT_ELLIPSE } from "@/lib/planner-actions";
import { formatLat, formatLon } from "@/lib/lunar-coordinates";
import { SITE_LABELS } from "@/lib/sites";
import { EARTH_COLOR, SUN_COLOR } from "@/lib/shaders";
import { ellipseAreaKm2, summarize } from "@/lib/plans";
import { slopeVerdictText, GRADE_ICON } from "@/lib/verdict";
import type { GlossaryKey } from "@/lib/glossary";
import { ElevationChart, HorizonPanorama } from "./Charts";
import VerdictCard from "./VerdictCard";
import SuggestionCard from "./SuggestionCard";
import DateTimePicker, { fmtUtcShort } from "@/components/ui/DateTimePicker";
import InfoTip from "@/components/ui/InfoTip";
import { IconChevron } from "@/components/ui/icons";

export const fmtUtc = fmtUtcShort;

export function fmtDuration(h: number | null): string {
  if (h === null) return "90+ days";
  if (h < 1) return `${Math.round(h * 60)} min`;
  const d = Math.floor(h / 24), r = Math.round(h - d * 24);
  return d > 0 ? `${d} d ${r} h` : `${r} h`;
}

function StepHeader({ n, title, active, done, onEdit }: { n: number; title: string; active: boolean; done: boolean; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`num grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold ${active ? "bg-accent text-[#04161a]" : done ? "bg-accent/20 text-accent" : "bg-white/8 text-ink-mute"}`}>
          {done && !active ? "✓" : n}
        </span>
        <span className={`text-[12.5px] font-medium ${active || done ? "text-ink" : "text-ink-mute"}`}>{title}</span>
      </div>
      {done && !active && onEdit && (
        <button type="button" onClick={onEdit} className="text-[11px] text-accent hover:underline">Edit</button>
      )}
    </div>
  );
}

function NumField({ label, tip, value, step, min, max, unit, onChange }: { label: string; tip: GlossaryKey; value: number; step: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  const id = `nf-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <span className="flex items-center gap-1 text-[10.5px] text-ink-mute">
        <label htmlFor={id}>{label}</label> <InfoTip k={tip} />
      </span>
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
    </div>
  );
}

/** Collapsible "Show details" section. */
function Details({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11.5px] text-ink-soft hover:text-ink">
        <span>{open ? "Hide" : "Show"} details · {title}</span>
        <IconChevron className={`text-ink-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="enter space-y-2 border-t border-line px-2.5 pb-2.5 pt-2">{children}</div>}
    </div>
  );
}

function Line({ k, v, tip, tone }: { k: string; v: React.ReactNode; tip?: GlossaryKey; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11.5px]">
      <span className="flex items-center gap-1 text-ink-mute">{k} {tip && <InfoTip k={tip} />}</span>
      <span className="num text-right" style={{ color: tone ?? "#e8edf3" }}>{v}</span>
    </div>
  );
}

/** "Sun 6.8° high, terrain 15° high → blocked" */
function skyLine(body: "Sun" | "Earth", el: number, hz: number) {
  const visible = body === "Sun" ? el + 0.27 > hz : el > hz;
  return `${body} ${el.toFixed(1)}° high, terrain ${hz.toFixed(1)}° high → ${visible ? "visible" : "blocked"}`;
}

function changeText(body: "sun" | "earth", visible: boolean, h: number | null) {
  if (body === "sun") {
    if (h === null) return visible ? "Sun stays up for 90+ days" : "No sunrise for 90+ days";
    return visible ? `Sunset in ${fmtDuration(h)}` : `Sunrise in ${fmtDuration(h)}`;
  }
  if (h === null) return visible ? "Earth in view for 90+ days" : "No Earth contact for 90+ days";
  return visible ? `Earth sets in ${fmtDuration(h)}` : `Earth rises in ${fmtDuration(h)}`;
}

export default function PlannerPanel() {
  const step = useAppStore((s) => s.planStep);
  const landingMs = useAppStore((s) => s.landingMs);
  const missionDays = useAppStore((s) => s.missionDays);
  const ellipse = useAppStore((s) => s.ellipse);
  const drawing = useAppStore((s) => s.drawing);
  const analysis = useAppStore((s) => s.analysis);
  const progress = useAppStore((s) => s.analysisProgress);
  const searchProgress = useAppStore((s) => s.searchProgress);
  const error = useAppStore((s) => s.analysisError);
  const timeMs = useAppStore((s) => s.timeMs);
  const thresholds = useAppStore((s) => s.thresholds);
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
  // keep Step 1 in sync when a plan / suggestion / share link sets the date
  useEffect(() => {
    if (landingMs !== null) {
      setDraftMs(landingMs);
      setDraftDays(missionDays);
    }
  }, [landingMs, missionDays]);

  const minMs = eph ? earliestLandingMs(eph) : 0;
  const maxMs = eph ? eph.endMs - 90 * 86400e3 : 0;
  const dateValid = draftMs !== null && eph !== null && draftMs >= minMs && draftMs <= maxMs;
  const summary = useMemo(() => (analysis && ellipse ? summarize(analysis, ellipse) : null), [analysis, ellipse]);
  const analysed = step === "results" && analysis && summary;
  const slopeV = analysis ? slopeVerdictText(analysis.terrain.slopeMeanDeg, thresholds) : null;

  return (
    <section aria-label="Mission planner" className="panel flex max-h-full w-[330px] max-w-[calc(100vw-24px)] flex-col max-md:w-full">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex shrink-0 items-center justify-between px-3.5 py-2.5 text-left">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <span className="text-[12.5px] font-medium text-ink">Landing site planner</span>
        </span>
        <IconChevron className={`text-ink-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-line px-3.5 pb-4 pt-3">
          <SuggestionCard />
          {searchProgress && (
            <div role="status" aria-live="polite" className="space-y-1">
              <div className="h-1 overflow-hidden rounded bg-white/10">
                <div className="h-full bg-[#7df0b0] transition-[width] duration-200" style={{ width: `${Math.round(searchProgress.value * 100)}%` }} />
              </div>
              <p className="text-[10.5px] text-ink-mute">{searchProgress.label}</p>
            </div>
          )}

          {/* ---------------- Step 1: date */}
          <div className="space-y-2">
            <StepHeader n={1} title="Landing date & mission" active={step === "date"} done={landingMs !== null} onEdit={editDate} />
            {step === "date" ? (
              <div className="space-y-2.5">
                <div>
                  <span className="flex items-center gap-1 text-[10.5px] text-ink-mute">
                    <label htmlFor="landing-time">Landing date & time (UTC, 24 h)</label> <InfoTip k="landingTime" />
                  </span>
                  <div className="mt-0.5">
                    {eph ? <DateTimePicker id="landing-time" value={draftMs} min={minMs} max={maxMs} onSave={setDraftMs} /> : <p className="text-[11px] text-ink-mute">Loading ephemeris…</p>}
                  </div>
                </div>
                <NumField label="Mission length" tip="missionLength" value={draftDays} step={1} min={1} max={60} unit="days" onChange={(v) => setDraftDays(Math.round(v))} />
                <button
                  type="button"
                  disabled={!dateValid}
                  onClick={() => draftMs !== null && confirmDate(draftMs, draftDays)}
                  className="h-9 w-full rounded-md bg-accent text-[13px] font-medium text-[#04161a] transition-colors hover:bg-[#7dd6e3] disabled:opacity-40"
                >
                  Next: draw landing ellipse
                </button>
                <button type="button" onClick={() => store.set({ suggestOpen: true })} className="w-full text-center text-[11.5px] text-[#a9f5cd] hover:underline">
                  Not sure? Let SELENE-Nav suggest the best date, time & spot →
                </button>
              </div>
            ) : (
              landingMs !== null && <p className="num text-[11.5px] text-ink-soft">{fmtUtcShort(landingMs)} · {missionDays} d mission</p>
            )}
          </div>

          {/* ---------------- Step 2: ellipse */}
          <div className="space-y-2">
            <StepHeader n={2} title="Landing ellipse" active={step === "draw"} done={!!analysis} onEdit={step === "results" ? startDrawing : undefined} />
            {step === "draw" && (
              <div className="space-y-2.5">
                {drawing ? (
                  <p className="rounded-md border border-gold/40 bg-gold/10 px-2.5 py-2 text-[11.5px] leading-snug text-[#f3dca9]">
                    <strong className="font-medium">Draw on the South Pole:</strong> press on the centre, drag to set length and direction, release.
                  </p>
                ) : (
                  <button type="button" onClick={startDrawing} className="h-8 w-full rounded-md border border-gold/50 text-[12px] text-[#f3dca9] hover:bg-gold/10">
                    {ellipse ? "Redraw ellipse" : "Draw ellipse on the map"}
                  </button>
                )}
                <div>
                  <span className="flex items-center gap-1 text-[10.5px] text-ink-mute">
                    <label htmlFor="key-location">Or start at a key location</label> <InfoTip k="keyLocation" />
                  </span>
                  <select
                    id="key-location"
                    className="mt-0.5 w-full rounded border border-line bg-[#0b1018] px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent/60"
                    value=""
                    onChange={(e) => {
                      const s = SITE_LABELS.find((l) => l.key === e.target.value);
                      if (s) {
                        const cur = store.get().ellipse;
                        const e = { lat: s.lat, lon: s.lon, aKm: cur?.aKm ?? DEFAULT_ELLIPSE.aKm, bKm: cur?.bKm ?? DEFAULT_ELLIPSE.bKm, headingDeg: cur?.headingDeg ?? 0 };
                        setEllipse(e);
                        store.set({ drawing: false });
                        focusEllipse(e);
                      }
                    }}
                  >
                    <option value="">Choose a location…</option>
                    {SITE_LABELS.map((s) => (
                      <option key={s.key} value={s.key}>{s.name}{s.artemis.length ? " · Artemis III region (approx.)" : ""}</option>
                    ))}
                  </select>
                </div>
                {ellipse && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <NumField label="Centre latitude" tip="centreLat" value={ellipse.lat} step={0.01} min={-90} max={-80.5} unit="°" onChange={(v) => setEllipse({ ...ellipse, lat: v })} />
                      <NumField label="Centre longitude" tip="centreLon" value={ellipse.lon} step={0.1} min={-180} max={180} unit="°E" onChange={(v) => setEllipse({ ...ellipse, lon: v })} />
                      <NumField label="Semi-major axis" tip="semiMajor" value={ellipse.aKm} step={0.1} min={0.2} max={40} unit="km" onChange={(v) => setEllipse({ ...ellipse, aKm: v, bKm: Math.min(ellipse.bKm, v) })} />
                      <NumField label="Semi-minor axis" tip="semiMinor" value={ellipse.bKm} step={0.1} min={0.1} max={40} unit="km" onChange={(v) => setEllipse({ ...ellipse, bKm: Math.min(v, ellipse.aKm) })} />
                      <NumField label="Heading" tip="heading" value={ellipse.headingDeg} step={1} min={0} max={180} unit="°" onChange={(v) => setEllipse({ ...ellipse, headingDeg: v })} />
                      <div className="flex flex-col justify-end pb-1 text-[10.5px] text-ink-mute">
                        Area <span className="num text-[12px] text-ink">{ellipseAreaKm2(ellipse).toFixed(1)} km²</span>
                      </div>
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
                {formatLat(ellipse.lat, 2)} {formatLon(ellipse.lon, 2)} · {(2 * ellipse.aKm).toFixed(1)} × {(2 * ellipse.bKm).toFixed(1)} km · {ellipseAreaKm2(ellipse).toFixed(1)} km²
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

          {/* ---------------- Step 3: verdict */}
          <div className="space-y-2">
            <StepHeader n={3} title="Site verdict" active={step === "results"} done={false} />
            {analysed && landingMs !== null ? (
              <div className="space-y-2">
                <VerdictCard key={`${analysis.centre.lat}|${analysis.centre.lon}|${landingMs}|${analysis.count}`} summary={summary} />

                <Details title="at landing (ellipse centre)">
                  <Line k="☀️ Sun" v={skyLine("Sun", analysis.series[0], analysis.series[1])} tip="horizon" tone={analysis.sun.visibleAtLanding ? SUN_COLOR : "#f0a089"} />
                  <Line k="" v={changeText("sun", analysis.sun.visibleAtLanding, analysis.sun.hoursUntilChange)} />
                  <Line k="📡 Earth" v={skyLine("Earth", analysis.series[3], analysis.series[4])} tone={analysis.earth.visibleAtLanding ? EARTH_COLOR : "#f0a089"} />
                  <Line k="" v={changeText("earth", analysis.earth.visibleAtLanding, analysis.earth.hoursUntilChange)} />
                  <Line k="Ellipse in sunlight at landing" v={`${analysis.landing.litAreaPct.toFixed(0)}% of area`} />
                  <Line k="Ellipse in Earth view at landing" v={`${analysis.landing.earthAreaPct.toFixed(0)}% of area`} />
                </Details>

                <Details title="terrain inside the ellipse">
                  <Line k="Mean slope" tip="slope" v={<>{analysis.terrain.slopeMeanDeg.toFixed(1)}° {slopeV && `${GRADE_ICON[slopeV.grade]} ${slopeV.text}`}</>} />
                  <Line k="Steepest point" v={`${analysis.terrain.slopeMaxDeg.toFixed(1)}°`} />
                  <Line k={`Steeper than ${thresholds.slope.risky}°`} v={`${(summary.slopeHist.slice(Math.ceil(thresholds.slope.risky)).reduce((a, b) => a + b, 0) / Math.max(1, summary.slopeHist.reduce((a, b) => a + b, 0)) * 100).toFixed(0)}% of ellipse`} />
                  <Line k="Permanent shadow" tip="psr" v={`${analysis.terrain.psrPct.toFixed(1)}% of ellipse`} />
                  <Line k="Height range" v={`${analysis.terrain.elevMinM.toFixed(0)} … ${analysis.terrain.elevMaxM.toFixed(0)} m`} />
                  <p className="text-[10px] leading-snug text-ink-mute">
                    {analysis.count.toLocaleString("en-US")} cells at {Math.round(analysis.cellKm * 1000)} m · slope from the 80 m LOLA DEM · PSR from LPSR (640 m grid).
                  </p>
                </Details>

                <Details title="Sun & Earth over the mission">
                  <div className="flex flex-wrap gap-x-3 text-[10px] text-ink-mute">
                    <span style={{ color: SUN_COLOR }}>— Sun</span>
                    <span style={{ color: EARTH_COLOR }}>— Earth</span>
                    <span>- - terrain in that direction</span>
                    <span>bars = visible</span>
                  </div>
                  <ElevationChart series={analysis.series} hours={analysis.hours} landingMs={landingMs} timeMs={timeMs} />
                  <Line k="Longest darkness at the centre" tip="darkness" v={fmtDuration(analysis.mission.centreLongestNightH)} />
                  <Line k="Usable time at the centre" tip="usable" v={`${analysis.mission.bothPctCentre.toFixed(0)}%`} />
                  <Line k="Sunlight, across the ellipse" v={`${analysis.mission.sunlitMinPct.toFixed(0)}–${analysis.mission.sunlitMaxPct.toFixed(0)}%`} />
                </Details>

                <Details title="horizon panorama (centre)">
                  <HorizonPanorama horizon={analysis.centreHorizon} series={analysis.series} hours={analysis.hours} timeMs={timeMs} landingMs={landingMs} />
                  <p className="text-[10px] leading-snug text-ink-mute">Grey = surrounding terrain in every compass direction (80 m data). Coloured tracks = Sun and Earth paths during the mission.</p>
                </Details>
              </div>
            ) : (
              <p className="text-[11px] text-ink-mute">The verdict appears after you analyse an ellipse.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
