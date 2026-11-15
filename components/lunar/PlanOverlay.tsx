"use client";
/**
 * Feeds the planning state into the terrain shader:
 *  • landing-ellipse outline and the suggested ("ghost") ellipse
 *  • focus mode after an analysis (layers only inside the ellipse, outside dimmed;
 *    elevation colours stretched to the ellipse's own range)
 *  • time-dependent Sun / Earth result INSIDE the ellipse only (80 m, follows the slider)
 *  • optional whole-region statistics maps (mission window, year 2027) — never time-dependent
 * Requests are "latest wins": while the worker is busy only the newest time is queued.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DATA_BASE } from "@/lib/lunar-config";
import { sharedUniforms } from "@/lib/shaders";
import { store, type AnalysisLayer } from "@/lib/store";
import { ellipseAt } from "@/lib/planning";
import type { EllipseSpec } from "@/lib/planning";
import { planData } from "@/lib/planner-actions";
import { RAD, latLonToMap } from "@/lib/sky";
import { lunarData } from "@/hooks/useLunarData";

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

/** Ellipse → shader encoding: centre (map km) + unit vector of the major axis in the map plane. */
function setEllipseUniform(e: EllipseSpec, u: THREE.Vector4, ab: THREE.Vector2) {
  const c = latLonToMap(e.lat, e.lon);
  const lon = Math.hypot(c.x, c.y) < 1e-9 ? 0 : Math.atan2(c.x, c.y);
  const h = e.headingDeg * RAD;
  u.set(c.x, c.y, Math.sin(lon) * Math.cos(h) + Math.cos(lon) * Math.sin(h), Math.cos(lon) * Math.cos(h) - Math.sin(lon) * Math.sin(h));
  ab.set(Math.max(0.05, e.aKm), Math.max(0.05, e.bKm));
}

export default function PlanOverlay() {
  const blankTex = useMemo(() => dataTex(1, 1), []);
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
    sharedUniforms.uPlanTex.value = blankTex;
    sharedUniforms.uFineTex.value = blankTex;
    let busy = false;
    let queued: number | null = null;
    let lastKey = "";
    let fineTex: THREE.DataTexture | null = null;
    let missionVersion = -1;

    const refreshFine = async (ms: number) => {
      if (busy) {
        queued = ms;
        return;
      }
      busy = true;
      try {
        const fine = store.get().analysis ? await ellipseAt(ms) : null;
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
          void refreshFine(q);
        }
      }
    };

    const sync = () => {
      const s = store.get();
      const layer = s.analysisLayer;
      if (s.ellipse) {
        setEllipseUniform(s.ellipse, sharedUniforms.uEllipse.value, sharedUniforms.uEllipseAB.value);
        sharedUniforms.uEllipseOn.value = 1;
      } else sharedUniforms.uEllipseOn.value = 0;

      if (s.suggestion) {
        setEllipseUniform(s.suggestion.ellipse, sharedUniforms.uGhost.value, sharedUniforms.uGhostAB.value);
        sharedUniforms.uGhostOn.value = 1;
      } else sharedUniforms.uGhostOn.value = 0;

      // elevation range of the analysed ellipse, in the science texture's 0–1 encoding
      const el = lunarData.meta?.elevation;
      if (s.analysis && el) {
        const span = el.max_m - el.min_m;
        sharedUniforms.uElevLocal.value.set((s.analysis.terrain.elevMinM - el.min_m) / span, (s.analysis.terrain.elevMaxM - el.min_m) / span);
      }

      sharedUniforms.uPlanMode.value = MODE[layer];
      if (layer.startsWith("annual")) sharedUniforms.uPlanTex.value = annualTex;
      else if (layer.startsWith("mission")) {
        if (planData.mission && missionVersion !== planData.missionVersion) {
          (missionTex.image.data as Uint8Array).set(planData.mission);
          missionTex.needsUpdate = true;
          missionVersion = planData.missionVersion;
        }
        sharedUniforms.uPlanTex.value = missionTex;
      }

      if (layer.startsWith("now") && s.analysis && s.timeMs !== null) {
        const key = `${s.timeMs}|${s.analysis.count}|${s.analysis.centre.lat}|${s.analysis.centre.lon}`;
        if (key !== lastKey) {
          lastKey = key;
          void refreshFine(s.timeMs);
        }
      } else if (!s.analysis) {
        sharedUniforms.uFineOn.value = 0;
        lastKey = "";
      }
    };
    sync();
    const unsub = store.subscribe(sync);
    return () => {
      unsub();
      fineTex?.dispose();
    };
  }, [blankTex, missionTex, annualTex]);

  useFrame((_, dt) => {
    const s = store.get();
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 8);
    const u = sharedUniforms.uPlanOpacity;
    u.value += ((s.analysisLayer === "none" ? 0 : 1) - u.value) * k;
    // focus mode: once an ellipse is analysed, layers apply only inside it
    const f = sharedUniforms.uFocus;
    f.value += ((s.analysis && s.planStep === "results" ? 1 : 0) - f.value) * k;
  });

  return null;
}
