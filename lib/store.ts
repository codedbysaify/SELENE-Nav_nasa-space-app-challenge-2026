"use client";
/**
 * Minimal external store (no extra dependency) shared by the 3D scene and the
 * DOM interface. The render loop writes telemetry here at a throttled rate so
 * React only re-renders the small components that subscribe to a slice.
 */
import { useSyncExternalStore } from "react";
import { EXAGGERATION_DEFAULT, type BaseLayer } from "./lunar-config";
import type { EllipseResult, EllipseSpec } from "./planning";
import { defaultThresholds, type Thresholds } from "./verdict";
import type { SavedPlan } from "./plans";

/** A proposed ellipse (ghost) from "Find a better spot nearby" or "Suggest best plan". */
export interface Suggestion {
  kind: "nearby" | "global";
  ellipse: EllipseSpec;
  /** Landing time proposed by the global search (null = keep the current date). */
  landingMs: number | null;
  missionDays: number | null;
  usablePct: number;
  areaKm2: number;
  note: string;
}

export type PlanStep = "date" | "draw" | "results";
export type AnalysisLayer =
  | "none"
  | "now-sun"
  | "now-earth"
  | "mission-sun"
  | "mission-earth"
  | "mission-night"
  | "annual-sun"
  | "annual-earth"
  | "annual-night";

export type ViewMode = "global" | "approach" | "terrain";

export interface PointReadout {
  lat: number;
  lon: number;
  /** Elevation in metres relative to the 1737.4 km sphere (null if no data). */
  elevationM: number | null;
  slopeDeg: number | null;
  psrFraction: number | null;
  source: string;
}

export interface LoadState {
  globe: "idle" | "loading" | "ready" | "error";
  terrainLow: "idle" | "loading" | "ready" | "error";
  terrainHigh: "idle" | "loading" | "ready" | "error";
  message: string | null;
}

export interface CameraApi {
  flyToSouthPole: () => void;
  returnToGlobalView: () => void;
  zoomBy: (factor: number) => void;
  resetCamera: () => void;
  /** Fly to a surface point (lat/lon °) and frame a feature of the given radius (km). */
  focusOn: (lat: number, lon: number, radiusKm: number) => void;
}

export interface AppState {
  baseLayer: BaseLayer;
  psrOverlay: boolean;
  exaggeration: number;
  /* ---- mission planning */
  planStep: PlanStep;
  landingMs: number | null;
  missionDays: number;
  /** Time shown by the slider / used for lighting (null = real current time). */
  timeMs: number | null;
  playing: boolean;
  ellipse: EllipseSpec | null;
  drawing: boolean;
  analysisLayer: AnalysisLayer;
  analysis: EllipseResult | null;
  analysisProgress: { value: number; label: string } | null;
  missionLayersReady: boolean;
  analysisError: string | null;
  /* ---- verdict, saved plans, suggestions */
  thresholds: Thresholds;
  plans: SavedPlan[];
  plansOpen: boolean;
  suggestOpen: boolean;
  suggestion: Suggestion | null;
  searchProgress: { value: number; label: string } | null;
  /** Ellipse-wide Sun / Earth availability at the time-slider position (80 m). */
  timeStats: { ms: number; litPct: number; earthPct: number; bothPct: number } | null;
  viewMode: ViewMode;
  /** 0 = global, 1 = fully pole-focused (from camera distance). */
  poleFocus: number;
  altitudeKm: number;
  distanceToPoleKm: number;
  focus: PointReadout | null;
  cursor: PointReadout | null;
  /** Point locked by double-click, the Pin button or the P key (unpin: ✕ / Esc). */
  pinned: PointReadout | null;
  /** Pin button armed: the next clean click on the Moon pins that point. */
  pinMode: boolean;
  load: LoadState;
  cameraApi: CameraApi | null;
  aboutOpen: boolean;
  animating: boolean;
}

const initial: AppState = {
  baseLayer: "hillshade",
  psrOverlay: false,
  exaggeration: EXAGGERATION_DEFAULT,
  planStep: "date",
  landingMs: null,
  missionDays: 14,
  timeMs: null,
  playing: false,
  ellipse: null,
  drawing: false,
  analysisLayer: "none",
  analysis: null,
  analysisProgress: null,
  missionLayersReady: false,
  analysisError: null,
  thresholds: defaultThresholds(),
  plans: [],
  plansOpen: false,
  suggestOpen: false,
  suggestion: null,
  searchProgress: null,
  timeStats: null,
  viewMode: "global",
  poleFocus: 0,
  altitudeKm: 0,
  distanceToPoleKm: 0,
  focus: null,
  cursor: null,
  pinned: null,
  pinMode: false,
  load: { globe: "idle", terrainLow: "idle", terrainHigh: "idle", message: null },
  cameraApi: null,
  aboutOpen: false,
  animating: false,
};

let state: AppState = initial;
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof patch === "function" ? patch(state) : patch;
    let changed = false;
    for (const k in p) {
      if (!Object.is((state as unknown as Record<string, unknown>)[k], (p as Record<string, unknown>)[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = { ...state, ...p };
    listeners.forEach((l) => l());
  },
  setLoad(patch: Partial<LoadState>) {
    store.set((s) => ({ load: { ...s.load, ...patch } }));
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useAppStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(state),
    () => selector(initial),
  );
}
