"use client";
/**
 * Drives the shared shader uniforms from UI state: base-layer cross-fades,
 * PSR overlay opacity, vertical exaggeration and the REAL Sun direction for the
 * selected time (or the current time), from the precomputed NASA/JPL ephemeris.
 * Everything is interpolated per frame, so changes never interrupt camera motion
 * and never trigger React re-renders of the scene.
 */
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { store } from "@/lib/store";
import { sharedUniforms, sunDirectionFromSubpoint } from "@/lib/shaders";
import { frameState } from "@/lib/frame-state";
import { loadEphemeris, subpointsAt, type Ephemeris } from "@/lib/ephemeris";

const target = new THREE.Vector3();
const sunTarget = new THREE.Vector3();

export default function TerrainLayers() {
  const eph = useRef<Ephemeris | null>(null);
  useEffect(() => {
    loadEphemeris().then((e) => (eph.current = e)).catch((e) => console.error(e));
  }, []);

  useFrame((state, dt) => {
    const s = store.get();
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 6);
    target.set(s.baseLayer === "hillshade" ? 1 : 0, s.baseLayer === "elevation" ? 1 : 0, s.baseLayer === "slope" ? 1 : 0);
    sharedUniforms.uLayerW.value.lerp(target, k);
    sharedUniforms.uPsr.value += ((s.psrOverlay ? 1 : 0) - sharedUniforms.uPsr.value) * k;
    sharedUniforms.uExag.value += (s.exaggeration - sharedUniforms.uExag.value) * k;
    if (eph.current) {
      const sp = subpointsAt(eph.current, s.timeMs ?? Date.now());
      sunDirectionFromSubpoint(sp.sunLat, sp.sunLon, sunTarget);
      // fast follow so scrubbing the time slider updates lighting immediately but without flicker
      sharedUniforms.uSunDir.value.lerp(sunTarget, 1 - Math.exp(-Math.min(dt, 0.1) * 14)).normalize();
    }
    sharedUniforms.uTime.value = state.clock.elapsedTime;
    const hillW = sharedUniforms.uLayerW.value.x;
    sharedUniforms.uEdgeBlend.value = Math.max(hillW, 1 - frameState.poleFocus);
    const approach = Math.min(1, Math.max(0, (frameState.poleFocus - 0.08) / 0.55));
    sharedUniforms.uGlobeMix.value = hillW * (1 - approach * approach * (3 - 2 * approach));
  });
  return null;
}
