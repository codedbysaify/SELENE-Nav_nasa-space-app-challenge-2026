"use client";
/**
 * Decorative star backdrop (not a star catalogue). The shell follows the
 * camera so it is always "at infinity" and never parallaxes.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const COUNT = 2600;
const RADIUS = 2400;

export default function Starfield() {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    let seed = 1234567;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([RADIUS * s * Math.cos(th), RADIUS * u, RADIUS * s * Math.sin(th)], i * 3);
      const b = Math.pow(rand(), 3.2) * 0.75 + 0.06;
      const warm = rand();
      col.set([b * (0.92 + 0.1 * warm), b * 0.96, b * (1.05 - 0.12 * warm)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);

  useFrame(({ camera }) => ref.current?.position.copy(camera.position));

  return (
    <points ref={ref} geometry={geometry} frustumCulled={false} renderOrder={-1}>
      {/* Opaque pass, drawn first, no depth test: the Moon always paints over the backdrop. */}
      <pointsMaterial size={1.6} sizeAttenuation={false} vertexColors depthWrite={false} depthTest={false} />
    </points>
  );
}
