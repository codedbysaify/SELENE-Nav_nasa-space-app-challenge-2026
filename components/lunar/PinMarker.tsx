"use client";
/** Gold marker at the pinned point, standing on the real (exaggerated) LOLA surface. */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MOON_RADIUS_KM as R } from "@/lib/lunar-config";
import { latLonToDir } from "@/lib/lunar-coordinates";
import { sharedUniforms } from "@/lib/shaders";
import { store } from "@/lib/store";
import { sampleHeightM } from "@/hooks/useLunarData";

const dir: [number, number, number] = [0, 0, 0];
const up = new THREE.Vector3();
const base = new THREE.Vector3();

export default function PinMarker() {
  const group = useRef<THREE.Group>(null);
  const stem = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#ffcf5c", depthWrite: false, transparent: true, opacity: 0.95 }));
    l.frustumCulled = false;
    return l;
  }, []);

  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const p = store.get().pinned;
    g.visible = !!p;
    if (!p) return;
    latLonToDir(p.lat, p.lon, dir);
    up.set(dir[0], dir[1], dir[2]);
    const h = ((sampleHeightM(p.lat, p.lon) ?? 0) / 1000) * sharedUniforms.uExag.value;
    base.copy(up).multiplyScalar(R + h);
    // constant on-screen size: scale with camera distance
    const s = Math.max(0.15, camera.position.distanceTo(base) * 0.012);
    g.position.copy(base);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    g.scale.setScalar(s);
  });

  return (
    <group ref={group} visible={false} renderOrder={7}>
      <primitive object={stem} scale={[1, 2.2, 1]} />
      <mesh position={[0, 2.2, 0]} renderOrder={7}>
        <sphereGeometry args={[0.38, 16, 12]} />
        <meshBasicMaterial color="#ffcf5c" depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={7}>
        <ringGeometry args={[0.32, 0.55, 24]} />
        <meshBasicMaterial color="#ffcf5c" side={THREE.DoubleSide} transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}
