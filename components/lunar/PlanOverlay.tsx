"use client";
/**
 * Feeds the Sun/Earth analysis into the terrain shader:
 *  • overview map (1.28 km cells) for the selected time, from the worker
 *  • 80 m result inside the landing ellipse for the selected time
 *  • mission-window and annual statistics maps
 *  • the landing-ellipse outline
 * Requests are "latest wins": while the worker is busy only the newest time is queued.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DATA_BASE } from "@/lib/lunar-config";
import { sharedUniforms } from "@/lib/shaders";
import { store, type AnalysisLayer } from "@/lib/store";
import { ellipseAt, overviewAt, planningReady } from "@/lib/planning";
import { planData } from "@/lib/planner-actions";
import { RAD, latLonToMap } from "@/lib/sky";

const N = 475;
const MODE: Record<AnalysisLayer, number> = {
  none: 0, "now-sun": 1, "now-earth": 2, "mission-sun": 3, "mission-earth": 4, "mission-night": 5,
  "annual-sun": 3, "annual-earth": 4, "annual-night": 5,
};

function dataTex(w: number, h: number, data?: Uint8Array) {
  const t = new THREE.DataTexture(data ?? new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export default function PlanOverlay() {
  const nowTex = useMemo(() => dataTex(N, N), []);
  const missionTex = useMemo(() => dataTex(N, N), []);
  const annualTex = useMemo(() => {
    const t = new THREE.TextureLoader().load(`${DATA_BASE}/annual-2027.webp`);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    return t;
  }, []);

  useEffect(() => {
    sharedUniforms.uPlanTex.value = nowTex;
    sharedUniforms.uFineTex.value = dataTex(1, 1);
    let busy = false;
    let queued: number | null = null;
    let lastKey = "";
    let fineTex: THREE.DataTexture | null = null;
    let missionVersion = -1;

    const refreshNow = async (ms: number) => {
      if (busy) {
        queued = ms;
        return;
      }
      busy = true;
      try {
        await planningReady();
        const data = await overviewAt(ms);
        (nowTex.image.data as Uint8Array).set(data);
        nowTex.needsUpdate = true;
        const s = store.get();
        const fine = s.analysis ? await ellipseAt(ms) : null;
        if (fine) {
          if (!fineTex || fineTex.image.width !== fine.w || fineTex.image.height !== fine.h) {
            fineTex?.dispose();
            fineTex = dataTex(fine.w, fine.h, fine.data);
            fineTex.magFilter = THREE.NearestFilter;
            sharedUniforms.uFineTex.value = fineTex;
          } else {
            (fineTex.image.data as Uint8Array).set(fine.data);
            fineTex.needsUpdate = true;
          }
          sharedUniforms.uFineBox.value.set(fine.x0, fine.y1, fine.w * fine.cellKm, fine.h * fine.cellKm);
          sharedUniforms.uFineOn.value = 1;
        } else sharedUniforms.uFineOn.value = 0;
      } catch (e) {
        console.error(e);
      } finally {
        busy = false;
        if (queued !== null) {
          const q = queued;
          queued = null;
          void refreshNow(q);
        }
      }
    };

    const sync = () => {
      const s = store.get();
      const layer = s.analysisLayer;
      // ellipse uniforms
      if (s.ellipse) {
        const c = latLonToMap(s.ellipse.lat, s.ellipse.lon);
        const lon = Math.hypot(c.x, c.y) < 1e-9 ? 0 : Math.atan2(c.x, c.y);
        const h = s.ellipse.headingDeg * RAD;
        const ux = Math.sin(lon) * Math.cos(h) + Math.cos(lon) * Math.sin(h);
        const uy = Math.cos(lon) * Math.cos(h) - Math.sin(lon) * Math.sin(h);
        sharedUniforms.uEllipse.value.set(c.x, c.y, ux, uy);
        sharedUniforms.uEllipseAB.value.set(Math.max(0.05, s.ellipse.aKm), Math.max(0.05, s.ellipse.bKm));
        sharedUniforms.uEllipseOn.value = 1;
      } else sharedUniforms.uEllipseOn.value = 0;

      sharedUniforms.uPlanMode.value = MODE[layer];
      if (layer.startsWith("annual")) sharedUniforms.uPlanTex.value = annualTex;
      else if (layer.startsWith("mission")) {
        if (planData.mission && missionVersion !== planData.missionVersion) {
          (missionTex.image.data as Uint8Array).set(planData.mission);
          missionTex.needsUpdate = true;
          missionVersion = planData.missionVersion;
        }
        sharedUniforms.uPlanTex.value = missionTex;
      } else sharedUniforms.uPlanTex.value = nowTex;
      if (!layer.startsWith("now")) sharedUniforms.uFineOn.value = 0;

      if (layer.startsWith("now")) {
        const ms = s.timeMs ?? Math.floor(Date.now() / 3600e3) * 3600e3;
        const key = `${ms}|${s.analysis ? s.analysis.count : 0}`;
        if (key !== lastKey) {
          lastKey = key;
          void refreshNow(ms);
        }
      }
    };
    sync();
    const unsub = store.subscribe(sync);
    return () => {
      unsub();
      fineTex?.dispose();
    };
  }, [nowTex, missionTex, annualTex]);

  useFrame((_, dt) => {
    const target = store.get().analysisLayer === "none" ? 0 : 1;
    const u = sharedUniforms.uPlanOpacity;
    u.value += (target - u.value) * (1 - Math.exp(-Math.min(dt, 0.1) * 8));
  });

  return null;
}
