"use client";
/** Mission-planning workflow: date → landing ellipse → analysis → verdict, plans, suggestions. */
import { store } from "./store";
import { analyseEllipse, overviewWindow, searchGlobal, searchNearby, type EllipseSpec } from "./planning";
import { requestHighResTerrain } from "@/hooks/useLunarData";
import { latLonToMap } from "./sky";
import { loadEphemeris } from "./ephemeris";
import { PRESETS, loadThresholds, sanitize, saveThresholds, type PresetName, type Thresholds } from "./verdict";
import { MAX_PLANS, ellipseAreaKm2, loadPlans, parseShareUrl, storePlans, summarize, type SavedPlan } from "./plans";

/** Mission-window overview statistics (RGBA, 475², see planning.worker overviewWindow). */
export const planData: { mission: Uint8Array | null; missionVersion: number; stepHours: number } = {
  mission: null,
  missionVersion: 0,
  stepHours: 1,
};

export const DEFAULT_ELLIPSE = { aKm: 5, bKm: 2.5, headingDeg: 0 };

/* ---------------------------------------------------------------- date + ellipse */
export function confirmDate(landingMs: number, missionDays: number) {
  store.set({
    landingMs, missionDays, timeMs: landingMs, planStep: "draw", drawing: !store.get().ellipse,
    analysis: null, missionLayersReady: false, analysisError: null, playing: false, suggestion: null,
  });
  dropEllipseLayers();
  requestHighResTerrain();
  store.get().cameraApi?.flyToSouthPole();
}

export function startDrawing() {
  store.set({ drawing: true, planStep: "draw", playing: false, suggestion: null });
}

/** Layers that need an analysed ellipse are switched off when the analysis is discarded. */
function dropEllipseLayers() {
  const l = store.get().analysisLayer;
  if (l.startsWith("now") || l.startsWith("mission")) store.set({ analysisLayer: "none" });
}

export function setEllipse(e: EllipseSpec | null) {
  const s = store.get();
  store.set({ ellipse: e, analysis: null, missionLayersReady: false, playing: false, planStep: s.planStep === "results" ? "draw" : s.planStep });
  dropEllipseLayers();
}

export function editDate() {
  store.set({ planStep: "date", playing: false, drawing: false });
}

/* ---------------------------------------------------------------- analysis */
let runId = 0;
export async function runAnalysis() {
  const s = store.get();
  if (!s.ellipse || s.landingMs === null) return;
  const my = ++runId;
  const hours = Math.round(s.missionDays * 24);
  store.set({ analysisProgress: { value: 0, label: "Preparing…" }, analysisError: null, drawing: false, playing: false, suggestion: null });
  try {
    const result = await analyseEllipse(s.ellipse, s.landingMs, hours, (v, label) =>
      my === runId && store.set({ analysisProgress: { value: v, label: label ?? "Analysing ellipse…" } }),
    );
    if (my !== runId) return;
    // The map stays static: no layer is switched on automatically.
    store.set({ analysis: result, planStep: "results", timeMs: s.landingMs, analysisProgress: null });
    // Whole-region mission statistics (optional layers) are prepared quietly in the background.
    const w = await overviewWindow(s.landingMs, hours);
    if (my !== runId) return;
    planData.mission = w.data;
    planData.stepHours = w.step;
    planData.missionVersion++;
    store.set({ missionLayersReady: true });
  } catch (e) {
    console.error(e);
    if (my === runId) store.set({ analysisProgress: null, analysisError: (e as Error).message });
  }
}

/* ---------------------------------------------------------------- thresholds */
export function setThresholds(t: Thresholds) {
  const clean = sanitize(t);
  store.set({ thresholds: clean });
  saveThresholds(clean);
}

export function applyPreset(name: Exclude<PresetName, "custom">) {
  setThresholds({ preset: name, ...structuredClone(PRESETS[name]) });
}

/* ---------------------------------------------------------------- suggestions */
export async function findBetterNearby() {
  const s = store.get();
  if (!s.ellipse || s.landingMs === null || !s.analysis) return;
  const c = latLonToMap(s.ellipse.lat, s.ellipse.lon);
  store.set({ searchProgress: { value: 0, label: "Searching within 20 km…" }, suggestion: null });
  try {
    const footKm = Math.sqrt(s.ellipse.aKm * s.ellipse.bKm); // circle with the ellipse's area
    const r = await searchNearby(c.x, c.y, 20, footKm, s.landingMs, Math.round(s.missionDays * 24), s.thresholds.slope.risky, (v) =>
      store.set({ searchProgress: { value: v, label: "Searching within 20 km…" } }),
    );
    const current = s.analysis.mission.usablePct;
    if (!r || r.usablePct <= current + 1) {
      store.set({ searchProgress: null, suggestion: null, analysisError: null });
      window.alert(
        r ? `No better spot within 20 km: the best nearby cell has ${r.usablePct.toFixed(0)}% usable time (yours: ${current.toFixed(0)}%). Try another date or "Suggest best plan".`
          : "No cell with safe slopes was found within 20 km.",
      );
      return;
    }
    const ellipse = { ...s.ellipse, lat: r.lat, lon: r.lon };
    store.set({
      searchProgress: null,
      suggestion: {
        kind: "nearby", ellipse, landingMs: null, missionDays: null, usablePct: r.usablePct, areaKm2: ellipseAreaKm2(ellipse),
        note: `Sunlit ${r.sunlitPct.toFixed(0)}% · Earth ${r.earthPct.toFixed(0)}% · slope ${r.slopeDeg.toFixed(1)}°, averaged over the ellipse (1.28 km grid estimate)`,
      },
    });
  } catch (e) {
    console.error(e);
    store.set({ searchProgress: null, analysisError: (e as Error).message });
  }
}

export async function suggestGlobal(rangeStartMs: number, rangeEndMs: number, missionDays: number, aKm: number, bKm: number) {
  const s = store.get();
  store.set({ searchProgress: { value: 0, label: "Searching the whole South Pole…" }, suggestion: null });
  try {
    const footKm = Math.sqrt(aKm * Math.min(bKm, aKm));
    const r = await searchGlobal(rangeStartMs, rangeEndMs, Math.round(missionDays * 24), footKm, s.thresholds.slope.risky, (v) =>
      store.set({ searchProgress: { value: v, label: "Searching the whole South Pole…" } }),
    );
    if (!r) {
      store.set({ searchProgress: null });
      window.alert("No cell with safe slopes was found. Relax the slope limit in the verdict settings and try again.");
      return;
    }
    const ellipse: EllipseSpec = { lat: r.lat, lon: r.lon, aKm, bKm: Math.min(bKm, aKm), headingDeg: s.ellipse?.headingDeg ?? 0 };
    store.set({
      searchProgress: null,
      suggestOpen: false,
      suggestion: {
        kind: "global", ellipse, landingMs: r.landingMs, missionDays, usablePct: r.usablePct, areaKm2: ellipseAreaKm2(ellipse),
        note: `${r.cellsSearched.toLocaleString("en-US")} places × ${r.timesTested} landing times tested · slope ${r.slopeDeg.toFixed(1)}°, averaged over the ellipse (1.28 km grid estimate)`,
      },
    });
    requestHighResTerrain();
    store.get().cameraApi?.flyToSouthPole();
  } catch (e) {
    console.error(e);
    store.set({ searchProgress: null });
    window.alert(`Search failed: ${(e as Error).message}`);
  }
}

/** Accept the ghost ellipse: it becomes the plan and the exact 80 m analysis runs. */
export function applySuggestion() {
  const s = store.get();
  const g = s.suggestion;
  if (!g) return;
  const landingMs = g.landingMs ?? s.landingMs;
  const missionDays = g.missionDays ?? s.missionDays;
  store.set({
    ellipse: g.ellipse, landingMs, missionDays, timeMs: landingMs, suggestion: null, analysis: null, missionLayersReady: false,
    planStep: "draw", drawing: false, playing: false,
  });
  dropEllipseLayers();
  void runAnalysis();
}

export function dismissSuggestion() {
  store.set({ suggestion: null });
}

/* ---------------------------------------------------------------- saved plans */
export function savePlan(name?: string): boolean {
  const s = store.get();
  if (!s.analysis || !s.ellipse || s.landingMs === null) return false;
  if (s.plans.length >= MAX_PLANS) {
    window.alert(`You can save up to ${MAX_PLANS} plans. Delete one in the Plans drawer first.`);
    return false;
  }
  const plan: SavedPlan = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name?.trim() || `Plan ${s.plans.length + 1}`,
    savedAt: Date.now(),
    landingMs: s.landingMs,
    missionDays: s.missionDays,
    ellipse: s.ellipse,
    summary: summarize(s.analysis, s.ellipse),
  };
  const plans = [...s.plans, plan];
  store.set({ plans });
  storePlans(plans);
  return true;
}

export function deletePlan(id: string) {
  const plans = store.get().plans.filter((p) => p.id !== id);
  store.set({ plans });
  storePlans(plans);
}

export function renamePlan(id: string, name: string) {
  const plans = store.get().plans.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
  store.set({ plans });
  storePlans(plans);
}

/** Restore a saved plan's date and ellipse and re-run the analysis (details and maps are recomputed). */
export function loadPlan(id: string) {
  const p = store.get().plans.find((x) => x.id === id);
  if (!p) return;
  store.set({
    landingMs: p.landingMs, missionDays: p.missionDays, ellipse: p.ellipse, timeMs: p.landingMs, plansOpen: false,
    analysis: null, missionLayersReady: false, planStep: "draw", drawing: false, playing: false, suggestion: null,
  });
  dropEllipseLayers();
  requestHighResTerrain();
  store.get().cameraApi?.flyToSouthPole();
  void runAnalysis();
}

/* ---------------------------------------------------------------- startup: storage + share link */
let started = false;
export async function initPlanner() {
  if (started) return;
  started = true;
  const shared = parseShareUrl();
  store.set({ thresholds: shared.thresholds ?? loadThresholds() });
  if (shared.thresholds) saveThresholds(shared.thresholds);
  let plans = loadPlans();
  if (shared.plans) {
    const have = new Set(plans.map((p) => p.id));
    plans = [...plans, ...shared.plans.filter((p) => !have.has(p.id))].slice(0, MAX_PLANS);
    storePlans(plans);
  }
  store.set({ plans });
  if (shared.current) {
    try {
      const eph = await loadEphemeris();
      const { landingMs, missionDays, ellipse } = shared.current;
      if (landingMs < eph.startMs || landingMs > eph.endMs - 90 * 86400e3) return;
      store.set({ landingMs, missionDays, ellipse, timeMs: landingMs, planStep: "draw", drawing: false });
      requestHighResTerrain();
      // wait for the camera rig, then fly and analyse
      const fly = () => (store.get().cameraApi ? store.get().cameraApi!.flyToSouthPole() : setTimeout(fly, 300));
      fly();
      void runAnalysis();
    } catch (e) {
      console.error(e);
    }
  }
}
