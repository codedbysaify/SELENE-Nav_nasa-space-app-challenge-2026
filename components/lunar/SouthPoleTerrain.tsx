"use client";
/**
 * High-resolution South Pole terrain built from the NASA LOLA 80°S DEM.
 *
 * Two levels of detail share one shader. Hand-overs are dithered cross-fades
 * (each pixel is drawn by exactly one surface), so there is never a sudden
 * geometry replacement, transparency sorting problem, or flicker:
 *   globe cap  →  low LOD   (coverage c: 0 → 1)
 *   low LOD    →  high LOD  (split s: 0 → 1), then the low LOD is disposed.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { disposeTerrainLod, type TerrainLod } from "@/lib/terrain-loader";
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX, sharedUniforms } from "@/lib/shaders";
import { releaseLowLod, useLunarRegistry } from "@/hooks/useLunarData";

const FADE_SECONDS = 1.4;

function makeMaterial(lod: TerrainLod, globeColor: THREE.Texture | null) {
  return new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    uniforms: {
      ...sharedUniforms,
      uVisual: { value: lod.visual },
      uScience: { value: lod.science },
      uGlobeColor: { value: globeColor },
      uHasGlobe: { value: globeColor ? 1 : 0 },
      uDitherMin: { value: 0 },
      uDitherMax: { value: 0 },
    },
  });
}

function LodMesh({ lod, materialRef }: { lod: TerrainLod; materialRef: React.MutableRefObject<THREE.ShaderMaterial | null> }) {
  const data = useLunarRegistry();
  const material = useMemo(() => makeMaterial(lod, data.globe?.color ?? null), [lod, data.globe]);
  materialRef.current = material;
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={lod.geometry} material={material} frustumCulled={false} renderOrder={1} />;
}

export default function SouthPoleTerrain() {
  const data = useLunarRegistry();
  const lowMat = useRef<THREE.ShaderMaterial | null>(null);
  const highMat = useRef<THREE.ShaderMaterial | null>(null);
  const fade = useRef({ cover: 0, split: 0 });

  useFrame((_, dt) => {
    const f = fade.current;
    const step = Math.min(dt, 0.05) / FADE_SECONDS;
    if (data.low || data.high) f.cover = Math.min(1, f.cover + step);
    if (data.high) f.split = Math.min(1, f.split + step);
    const ease = (x: number) => x * x * (3 - 2 * x);
    const c = ease(f.cover), s = data.high ? ease(f.split) : 0;
    sharedUniforms.uCapCover.value = c;
    if (lowMat.current) {
      lowMat.current.uniforms.uDitherMin.value = s;
      lowMat.current.uniforms.uDitherMax.value = c;
    }
    if (highMat.current) {
      highMat.current.uniforms.uDitherMin.value = 0;
      highMat.current.uniforms.uDitherMax.value = data.low ? s : c;
    }
    if (f.split >= 1 && data.low && data.high) {
      lowMat.current = null;
      releaseLowLod(disposeTerrainLod);
    }
  });

  return (
    <group>
      {data.low && <LodMesh key="low" lod={data.low} materialRef={lowMat} />}
      {data.high && <LodMesh key="high" lod={data.high} materialRef={highMat} />}
    </group>
  );
}
