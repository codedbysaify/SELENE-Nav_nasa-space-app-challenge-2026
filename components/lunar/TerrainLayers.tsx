"use client";
/**
 * Drives the shared shader uniforms from UI state: base-layer cross-fades,
 * PSR overlay opacity, vertical exaggeration and sun direction. Everything
 * is interpolated per frame, so layer changes never interrupt camera motion
 * and never trigger React re-renders of the scene.
 */
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { store } from "@/lib/store";
import { sharedUniforms, sunDirection } from "@/lib/shaders";
import { frameState } from "@/lib/frame-state";

const target = new THREE.Vector3();
const sunTarget = new THREE.Vector3();

export default function TerrainLayers() {
  useFrame((state, dt) => {
    const s = store.get();
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 6);
    target.set(s.baseLayer === "hillshade" ? 1 : 0, s.baseLayer === "elevation" ? 1 : 0, s.baseLayer === "slope" ? 1 : 0);
    sharedUniforms.uLayerW.value.lerp(target, k);
    sharedUniforms.uPsr.value += ((s.psrOverlay ? 1 : 0) - sharedUniforms.uPsr.value) * k;
    sharedUniforms.uExag.value += (s.exaggeration - sharedUniforms.uExag.value) * k;
    sunDirection(s.sunAzimuthDeg, s.sunElevationDeg, sunTarget);
    sharedUniforms.uSunDir.value.lerp(sunTarget, k).normalize();
    sharedUniforms.uTime.value = state.clock.elapsedTime;
    // Near the pole, data layers stay visible right to the 80°S edge; from afar the patch blends into the globe.
    const hillW = sharedUniforms.uLayerW.value.x;
    sharedUniforms.uEdgeBlend.value = Math.max(hillW, 1 - frameState.poleFocus);
    // In the natural (hillshade) look, the cap matches the LROC globe until the approach begins.
    const approach = Math.min(1, Math.max(0, (frameState.poleFocus - 0.08) / 0.55));
    sharedUniforms.uGlobeMix.value = hillW * (1 - approach * approach * (3 - 2 * approach));
  });
  return null;
}
