"use client";
/**
 * Progressive data loading + a module-level registry that the camera,
 * telemetry and markers query synchronously every frame.
 *
 *   1. metadata  → 2. globe imagery (Moon visible + interactive)
 *   → 3. low-res South Pole terrain (fades in)
 *   → 4. high-res terrain (on approach / Explore / idle), cross-faded, low LOD disposed.
 */
import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { CAP_LAT_DEG } from "@/lib/lunar-config";
import { latLonToStereo } from "@/lib/lunar-coordinates";
import {
  loadGlobeAssets,
  loadMetadata,
  loadTerrainLod,
  sampleGlobalHeightKm,
  type GlobeAssets,
  type LunarMetadata,
  type TerrainLod,
} from "@/lib/terrain-loader";
import { sampleBilinear, sampleNearest } from "@/lib/terrain-sampling";
import { store, type PointReadout } from "@/lib/store";

const SLOPE_SCALE = 255 / 90;

interface Registry {
  meta: LunarMetadata | null;
  globe: GlobeAssets | null;
  low: TerrainLod | null;
  high: TerrainLod | null;
  highRequested: boolean;
}

export const lunarData: Registry = { meta: null, globe: null, low: null, high: null, highRequested: false };

type Listener = () => void;
const listeners = new Set<Listener>();
function emit() {
  listeners.forEach((l) => l());
}

function bestTerrain(): TerrainLod | null {
  return lunarData.high ?? lunarData.low;
}

/** True LOLA height (metres) at lat/lon, or null. Uses the best loaded source. */
export function sampleHeightM(lat: number, lon: number): number | null {
  const t = bestTerrain();
  if (t && lat <= CAP_LAT_DEG) {
    const { x, y } = latLonToStereo(lat, lon);
    return sampleBilinear(t.gridM, t.spec, x, y);
  }
  if (lunarData.globe) return sampleGlobalHeightKm(lunarData.globe, lat, lon) * 1000;
  return null;
}

/** Full read-out for the information panel (only measured/derived values, never invented). */
export function readout(lat: number, lon: number): PointReadout {
  const t = bestTerrain();
  if (t && lat <= CAP_LAT_DEG) {
    const { x, y } = latLonToStereo(lat, lon);
    return {
      lat,
      lon,
      elevationM: sampleBilinear(t.gridM, t.spec, x, y),
      slopeDeg: sampleNearest(t.query, t.spec, x, y, 2, 0) / SLOPE_SCALE,
      psrFraction: sampleNearest(t.query, t.spec, x, y, 2, 1) / 255,
      source: `LOLA LDEM/LDSM/LPSR 80°S · ${Math.round(t.cellM)} m grid`,
    };
  }
  if (lunarData.globe) {
    return {
      lat,
      lon,
      elevationM: sampleGlobalHeightKm(lunarData.globe, lat, lon) * 1000,
      slopeDeg: null,
      psrFraction: null,
      source: "LOLA global DEM (SVS CGI Moon Kit) · 4 px/deg",
    };
  }
  return { lat, lon, elevationM: null, slopeDeg: null, psrFraction: null, source: "loading…" };
}

/** `?quality=low` keeps the 1.6 km / 640 m LOD only (low-power GPUs, software rendering). */
function highResAllowed() {
  return typeof window === "undefined" || new URLSearchParams(window.location.search).get("quality") !== "low";
}

export function requestHighResTerrain() {
  if (lunarData.highRequested || !highResAllowed()) return;
  lunarData.highRequested = true;
  emit();
}

function prewarm(gl: THREE.WebGLRenderer, ...tex: THREE.Texture[]) {
  // Upload to the GPU now so the first frame that uses them does not stall.
  for (const t of tex) gl.initTexture(t);
}

/** Drives the loading pipeline; mount once inside the <Canvas>. */
export function useLunarDataLoader() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    let cancelled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const loadHigh = async () => {
      if (!lunarData.meta || lunarData.high || store.get().load.terrainHigh === "loading") return;
      store.setLoad({ terrainHigh: "loading", message: "Streaming high-resolution LOLA terrain (160 m textures)…" });
      try {
        const high = await loadTerrainLod(lunarData.meta, "high");
        if (cancelled) return;
        prewarm(gl, high.visual, high.science);
        lunarData.high = high;
        store.setLoad({ terrainHigh: "ready", message: null });
        emit();
      } catch (e) {
        console.error(e);
        store.setLoad({ terrainHigh: "error", message: `High-res terrain failed: ${(e as Error).message}` });
      }
    };

    const onRegistry = () => {
      if (lunarData.highRequested && lunarData.low) void loadHigh();
    };
    listeners.add(onRegistry);

    (async () => {
      try {
        store.setLoad({ globe: "loading", message: "Loading lunar globe…" });
        const meta = await loadMetadata();
        lunarData.meta = meta;
        const globe = await loadGlobeAssets(meta);
        if (cancelled) return;
        prewarm(gl, globe.color, globe.normal, globe.height);
        lunarData.globe = globe;
        store.setLoad({ globe: "ready", terrainLow: "loading", message: "Loading LOLA South Pole terrain…" });
        emit();

        const low = await loadTerrainLod(meta, "low");
        if (cancelled) return;
        prewarm(gl, low.visual, low.science);
        lunarData.low = low;
        store.setLoad({ terrainLow: "ready", message: null });
        emit();
        // Lazy: high-res loads on approach, on "Explore", or after a short idle period.
        idleTimer = setTimeout(requestHighResTerrain, 9000);
        onRegistry();
      } catch (e) {
        console.error(e);
        store.setLoad({
          globe: lunarData.globe ? "ready" : "error",
          terrainLow: "error",
          message: (e as Error).message,
        });
      }
    })();

    return () => {
      cancelled = true;
      listeners.delete(onRegistry);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [gl]);
}

/** Re-render subscriber for components that render loaded assets. */
export function useLunarRegistry(): Registry {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return lunarData;
}

export function releaseLowLod(dispose: (t: TerrainLod) => void) {
  if (lunarData.low && lunarData.high) {
    const low = lunarData.low;
    lunarData.low = null;
    dispose(low);
    emit();
  }
}
