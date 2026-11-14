"use client";
/**
 * North and South Pole locators.
 *
 *  • South Pole (primary target): cyan beacon along the spin axis with a
 *    label at its tip from global range; it shrinks to a surface pin at 90°S
 *    (at the true, exaggerated LOLA height) when exploring the terrain.
 *  • North Pole (reference): from the southern viewpoints the camera is limited
 *    to, 90°N is usually beyond the limb — its label is then placed on the limb
 *    point nearest the pole with a "beyond limb" cue, so orientation is always clear.
 * Labels are DOM overlays (components/lunar/PoleLabels.tsx) positioned from
 * this render loop: constant pixel size, never scaled or clipped by the camera.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MOON_RADIUS_KM as R } from "@/lib/lunar-config";
import { sharedUniforms } from "@/lib/shaders";
import { frameState, poleLabelEls } from "@/lib/frame-state";
import { sampleHeightM } from "@/hooks/useLunarData";

const tmp = new THREE.Vector3();
const north = new THREE.Vector3(0, 1, 0);
const camHat = new THREE.Vector3();
const ray = new THREE.Ray();
const occluder = new THREE.Sphere(new THREE.Vector3(), R);
const hitP = new THREE.Vector3();

/** Is world point p visible from camera c (not behind the lunar sphere)? */
function visible(c: THREE.Vector3, p: THREE.Vector3) {
  ray.origin.copy(c);
  ray.direction.copy(p).sub(c);
  const len = ray.direction.length();
  ray.direction.divideScalar(len);
  occluder.radius = R * 0.995;
  if (!ray.intersectSphere(occluder, hitP)) return true;
  return hitP.distanceTo(c) > len - 1;
}

/** Point on the visible limb closest to direction `axis` (for a pole hidden behind the Moon). */
function limbPoint(c: THREE.Vector3, axis: THREE.Vector3, out: THREE.Vector3) {
  const d = c.length();
  camHat.copy(c).divideScalar(d);
  const centre = camHat.clone().multiplyScalar((R * R) / d);
  const radius = R * Math.sqrt(Math.max(0, 1 - (R * R) / (d * d)));
  tmp.copy(axis).addScaledVector(camHat, -axis.dot(camHat)).normalize();
  return out.copy(centre).addScaledVector(tmp, radius * 1.035);
}

function makeLine(color: string) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
  const l = new THREE.Line(g, m);
  l.frustumCulled = false;
  l.renderOrder = 5;
  return l;
}

const proj = new THREE.Vector3();

/** Write a world point to a DOM label as a screen-space transform. */
function place(el: HTMLElement | null, p: THREE.Vector3, camera: THREE.Camera, w: number, h: number, opacity: number) {
  if (!el) return;
  proj.copy(p).project(camera);
  const onScreen = proj.z < 1 && Math.abs(proj.x) < 1.2 && Math.abs(proj.y) < 1.2 && opacity > 0.02;
  el.style.visibility = onScreen ? "visible" : "hidden";
  if (!onScreen) return;
  el.style.transform = `translate3d(${(((proj.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - proj.y) / 2) * h).toFixed(1)}px, 0)`;
  el.style.opacity = opacity.toFixed(3);
}

export default function PoleMarkers() {
  const southLine = useMemo(() => makeLine("#5ec8d8"), []);
  const northLine = useMemo(() => makeLine("#8a94a6"), []);
  const southDot = useRef<THREE.Mesh>(null);
  const anchor = useMemo(() => new THREE.Vector3(), []);

  useEffect(
    () => () => {
      for (const l of [southLine, northLine]) {
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      }
    },
    [southLine, northLine],
  );

  useFrame(({ camera, size }) => {
    const exag = sharedUniforms.uExag.value;
    const w = frameState.poleFocus;
    const cam = camera.position;
    const camDist = cam.length();

    // ---------------- South Pole (primary target)
    const hS = ((sampleHeightM(-90, 0) ?? 0) / 1000) * exag;
    const baseS = R + hS;
    const distToPole = cam.distanceTo(tmp.set(0, -baseS, 0));
    const beacon = THREE.MathUtils.lerp(0.075 * R, Math.max(2.5, distToPole * 0.07), Math.min(1, w * 1.15));
    southLine.position.set(0, -baseS, 0);
    southLine.scale.set(1, -beacon, 1);
    if (southDot.current) {
      southDot.current.position.set(0, -baseS, 0);
      southDot.current.scale.setScalar(Math.max(0.35, distToPole * 0.0035));
    }
    anchor.set(0, -(baseS + beacon), 0);
    place(poleLabelEls.south, anchor, camera, size.width, size.height, visible(cam, anchor) ? 1 : 0.3);
    poleLabelEls.south?.classList.toggle("is-compact", w > 0.92);

    // ---------------- North Pole (reference only)
    const hN = ((sampleHeightM(90, 0) ?? 0) / 1000) * exag;
    const baseN = R + hN;
    const nLen = 0.075 * R;
    northLine.position.set(0, baseN, 0);
    northLine.scale.set(1, nLen, 1);
    tmp.set(0, baseN + nLen, 0);
    const northVisible = visible(cam, tmp);
    if (northVisible) anchor.copy(tmp);
    else limbPoint(cam, north, anchor);
    if (poleLabelEls.northCue) poleLabelEls.northCue.style.display = northVisible ? "none" : "inline";
    const fadeN = (1 - Math.min(1, w * 1.6)) * (camDist > R * 1.2 ? 1 : 0);
    place(poleLabelEls.north, anchor, camera, size.width, size.height, fadeN);
    (northLine.material as THREE.LineBasicMaterial).opacity = 0.6 * fadeN;
  });

  return (
    <group>
      <primitive object={southLine} />
      <primitive object={northLine} />
      <mesh ref={southDot} renderOrder={6}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial color="#9ae8f2" transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}
