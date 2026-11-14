"use client";
/**
 * Minimal external store (no extra dependency) shared by the 3D scene and the
 * DOM interface. The render loop writes telemetry here at a throttled rate so
 * React only re-renders the small components that subscribe to a slice.
 */
import { useSyncExternalStore } from "react";
import { EXAGGERATION_DEFAULT, SUN_DEFAULT, type BaseLayer } from "./lunar-config";

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
}

export interface AppState {
  baseLayer: BaseLayer;
  psrOverlay: boolean;
  exaggeration: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  viewMode: ViewMode;
  /** 0 = global, 1 = fully pole-focused (from camera distance). */
  poleFocus: number;
  altitudeKm: number;
  distanceToPoleKm: number;
  focus: PointReadout | null;
  cursor: PointReadout | null;
  load: LoadState;
  cameraApi: CameraApi | null;
  aboutOpen: boolean;
  animating: boolean;
}

const initial: AppState = {
  baseLayer: "hillshade",
  psrOverlay: false,
  exaggeration: EXAGGERATION_DEFAULT,
  sunAzimuthDeg: SUN_DEFAULT.azimuthDeg,
  sunElevationDeg: SUN_DEFAULT.elevationDeg,
  viewMode: "global",
  poleFocus: 0,
  altitudeKm: 0,
  distanceToPoleKm: 0,
  focus: null,
  cursor: null,
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
