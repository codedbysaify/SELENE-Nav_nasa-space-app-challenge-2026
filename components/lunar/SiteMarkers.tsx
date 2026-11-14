"use client";
/**
 * Key South Pole locations (IAU Gazetteer coordinates; Artemis III regions anchored at their
 * namesake features). SiteLabels renders the DOM; SiteMarkers (inside the Canvas) positions them
 * each frame on the real, exaggerated LOLA surface and hides labels behind the Moon.
 */
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MOON_RADIUS_KM as R } from "@/lib/lunar-config";
import { latLonToDir } from "@/lib/lunar-coordinates";
import { SITE_LABELS } from "@/lib/sites";
import { sharedUniforms } from "@/lib/shaders";
import { frameState } from "@/lib/frame-state";
import { store, useAppStore } from "@/lib/store";
import { DEFAULT_ELLIPSE, setEllipse } from "@/lib/planner-actions";
import { sampleHeightM } from "@/hooks/useLunarData";

const els = new Map<string, HTMLElement>();
const v = new THREE.Vector3();
const dir: [number, number, number] = [0, 0, 0];
const ray = new THREE.Ray();
const sphere = new THREE.Sphere(new THREE.Vector3(), R * 0.998);
const hit = new THREE.Vector3();

export function SiteMarkers() {
  useFrame(({ camera, size }) => {
    const show = Math.min(1, Math.max(0, (frameState.poleFocus - 0.3) / 0.3));
    const exag = sharedUniforms.uExag.value;
    for (const s of SITE_LABELS) {
      const el = els.get(s.key);
      if (!el) continue;
      if (show < 0.02) {
        el.style.visibility = "hidden";
        continue;
      }
      latLonToDir(s.lat, s.lon, dir);
      const h = ((sampleHeightM(s.lat, s.lon) ?? 0) / 1000) * exag;
      v.set(dir[0], dir[1], dir[2]).multiplyScalar(R + h + 0.4);
      // occlusion by the lunar sphere
      ray.origin.copy(camera.position);
      ray.direction.copy(v).sub(camera.position);
      const len = ray.direction.length();
      ray.direction.divideScalar(len);
      const hidden = ray.intersectSphere(sphere, hit) !== null && hit.distanceTo(camera.position) < len - 2;
      v.project(camera);
      const on = !hidden && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      el.style.visibility = on ? "visible" : "hidden";
      if (!on) continue;
      el.style.opacity = show.toFixed(2);
      el.style.transform = `translate3d(${(((v.x + 1) / 2) * size.width).toFixed(1)}px, ${(((1 - v.y) / 2) * size.height).toFixed(1)}px, 0)`;
    }
  });
  return null;
}

export function SiteLabels() {
  const step = useAppStore((s) => s.planStep);
  const selectable = step !== "date";
  const refs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    refs.current.forEach((el, k) => els.set(k, el));
    return () => refs.current.forEach((_, k) => els.delete(k));
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-[11] overflow-hidden">
      {SITE_LABELS.map((s) => (
        <div
          key={s.key}
          ref={(el) => {
            if (el) refs.current.set(s.key, el);
          }}
          className="site-anchor"
          style={{ visibility: "hidden" }}
        >
          <button
            type="button"
            tabIndex={-1}
            title={[
              s.name,
              s.diameterKm ? `${s.diameterKm} km` : "",
              s.artemis.length ? `NASA Artemis III candidate region: ${s.artemis.join(", ")} (position approximate)` : "",
              s.note ?? "",
              selectable ? "Click to centre the landing ellipse here" : "",
            ].filter(Boolean).join("\n")}
            onClick={() => {
              if (!selectable) return;
              const cur = store.get().ellipse;
              setEllipse({ lat: s.lat, lon: s.lon, aKm: cur?.aKm ?? DEFAULT_ELLIPSE.aKm, bKm: cur?.bKm ?? DEFAULT_ELLIPSE.bKm, headingDeg: cur?.headingDeg ?? 0 });
              store.set({ drawing: false, planStep: "draw" });
            }}
            className={`site-label ${s.artemis.length ? "site-label--artemis" : ""} ${selectable ? "pointer-events-auto cursor-pointer" : ""}`}
          >
            <span className="site-label__dot" />
            {s.name}
            {s.artemis.length > 0 && <span className="site-label__tag">A3</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
