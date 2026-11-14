"use client";
/** Mission-planning workflow: date → landing ellipse → analysis. */
import { store } from "./store";
import { analyseEllipse, overviewWindow, type EllipseSpec } from "./planning";
import { requestHighResTerrain } from "@/hooks/useLunarData";

/** Mission-window overview statistics (RGBA, 475², see planning.worker overviewWindow). */
export const planData: { mission: Uint8Array | null; missionVersion: number; stepHours: number } = {
  mission: null,
  missionVersion: 0,
  stepHours: 1,
};

export const DEFAULT_ELLIPSE = { aKm: 5, bKm: 2.5, headingDeg: 0 };

export function confirmDate(landingMs: number, missionDays: number) {
  store.set({
    landingMs, missionDays, timeMs: landingMs, planStep: "draw", drawing: !store.get().ellipse,
    analysis: null, missionLayersReady: false, analysisError: null, playing: false,
  });
  requestHighResTerrain();
  store.get().cameraApi?.flyToSouthPole();
}

export function startDrawing() {
  store.set({ drawing: true, planStep: "draw", playing: false });
}

export function setEllipse(e: EllipseSpec | null) {
  store.set({ ellipse: e, analysis: null, missionLayersReady: false });
}

export function editDate() {
  store.set({ planStep: "date", playing: false, drawing: false });
}

export async function runAnalysis() {
  const s = store.get();
  if (!s.ellipse || s.landingMs === null) return;
  const hours = Math.round(s.missionDays * 24);
  store.set({ analysisProgress: { value: 0, label: "Preparing…" }, analysisError: null, drawing: false, playing: false });
  try {
    const result = await analyseEllipse(s.ellipse, s.landingMs, hours, (v, label) =>
      store.set({ analysisProgress: { value: v * 0.75, label: label ?? "Analysing ellipse…" } }),
    );
    store.set({ analysis: result, planStep: "results", timeMs: s.landingMs, analysisLayer: "now-sun" });
    const w = await overviewWindow(s.landingMs, hours, (v) =>
      store.set({ analysisProgress: { value: 0.75 + v * 0.25, label: "Mission maps for the whole South Pole…" } }),
    );
    planData.mission = w.data;
    planData.stepHours = w.step;
    planData.missionVersion++;
    store.set({ missionLayersReady: true, analysisProgress: null });
  } catch (e) {
    console.error(e);
    store.set({ analysisProgress: null, analysisError: (e as Error).message });
  }
}
