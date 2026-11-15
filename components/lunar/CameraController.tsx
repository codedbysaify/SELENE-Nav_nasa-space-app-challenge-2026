"use client";
/**
 * Constrained South-Pole camera rig.
 *
 * The camera is parameterised *relative to the lunar South Pole*:
 *   D    — distance from the pole surface point (log-interpolated)
 *   tilt — angle from the polar axis (0 = looking straight up at the pole)
 *   az   — rotation about the polar axis (free, the pole stays the target)
 *   pan  — small rotation of the whole rig about the Moon centre, limited to
 *          stay inside the 80°S study region and zero at global range.
 * The look-at target slides from the Moon centre (global view, Moon centred)
 * to the pole (close range). Because the target is always on the polar axis
 * (± the bounded pan), it is impossible to navigate to an unrelated region.
 * Tilt ≤ 90° keeps the camera above the pole's tangent plane, so it can never
 * enter the Moon; an additional terrain-clearance check uses real LOLA heights.
 */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";
import { CAMERA, DEG, MOON_RADIUS_KM as R } from "@/lib/lunar-config";
import { dirToLatLon } from "@/lib/lunar-coordinates";
import { store, type ViewMode } from "@/lib/store";
import { sharedUniforms } from "@/lib/shaders";
import { frameState } from "@/lib/frame-state";
import { readout, requestHighResTerrain, sampleHeightM } from "@/hooks/useLunarData";
import { RAD as SKY_RAD, latLonToMap } from "@/lib/sky";
import { DEFAULT_ELLIPSE, setEllipse } from "@/lib/planner-actions";

interface RigState {
  lnD: number;
  tilt: number; // degrees
  az: number; // degrees
  panX: number; // km, scene x
  panZ: number; // km, scene z
}

const LN_MIN = Math.log(CAMERA.minDistanceKm);
const LN_MAX = Math.log(CAMERA.maxDistanceKm);
const LN_FOCUS_START = Math.log(CAMERA.poleFocusStartKm);
const LN_FOCUS_END = Math.log(CAMERA.poleFocusEndKm);

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** 0 at global range → 1 when the camera is focused on the pole. */
export const poleFocusOf = (lnD: number) => smooth((LN_FOCUS_END - lnD) / (LN_FOCUS_END - LN_FOCUS_START));
const tiltMaxOf = (w: number) => CAMERA.tiltGlobalMaxDeg + (CAMERA.tiltCloseMaxDeg - CAMERA.tiltGlobalMaxDeg) * w;

const initialRig = (): RigState => ({
  lnD: Math.log(CAMERA.globalDistanceKm),
  tilt: CAMERA.initialTiltDeg,
  az: CAMERA.initialAzimuthDeg,
  panX: 0,
  panZ: 0,
});

// scratch objects (no per-frame allocation)
const vPole = new THREE.Vector3();
const vDir = new THREE.Vector3();
const vUp = new THREE.Vector3();
const vCam = new THREE.Vector3();
const vTarget = new THREE.Vector3();
const qPan = new THREE.Quaternion();
const vAxis = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const sphere = new THREE.Sphere(new THREE.Vector3(), R);
const hit = new THREE.Vector3();
const vRight = new THREE.Vector3();
const vFwd = new THREE.Vector3();

export default function CameraController() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  const goal = useRef<RigState>(initialRig());
  const cur = useRef<RigState>(initialRig());
  const tweening = useRef(false);
  const lastTelemetry = useRef(0);
  const pointer = useRef<{ x: number; y: number; inside: boolean; dirty: boolean }>({ x: 0, y: 0, inside: false, dirty: false });

  /* ------------------------------------------------------------ public API */
  useEffect(() => {
    const kill = () => {
      gsap.killTweensOf(goal.current);
      tweening.current = false;
      store.set({ animating: false });
    };
    const tweenTo = (to: Partial<RigState>, duration: number, ease = "power2.inOut") => {
      kill();
      tweening.current = true;
      store.set({ animating: true });
      gsap.to(goal.current, {
        ...to,
        duration,
        ease,
        onComplete: () => {
          tweening.current = false;
          store.set({ animating: false });
        },
      });
    };
    const nearestAz = (a: number) => a + 360 * Math.round((cur.current.az - a) / 360);

    store.set({
      cameraApi: {
        flyToSouthPole: () => {
          requestHighResTerrain();
          const from = cur.current.lnD;
          const toD = Math.log(CAMERA.exploreDistanceKm);
          // Already closer than the exploration distance? keep the range, just re-centre on the pole.
          tweenTo({ lnD: Math.min(from, toD), tilt: CAMERA.exploreTiltDeg, panX: 0, panZ: 0 }, from > toD ? 3.6 : 1.6);
        },
        returnToGlobalView: () =>
          tweenTo({ lnD: Math.log(CAMERA.globalDistanceKm), tilt: CAMERA.initialTiltDeg, panX: 0, panZ: 0 }, 3.2),
        resetCamera: () => tweenTo({ ...initialRig(), az: nearestAz(CAMERA.initialAzimuthDeg) }, 2.6),
        zoomBy: (factor: number) => {
          const lnD = Math.min(LN_MAX, Math.max(LN_MIN, goal.current.lnD + Math.log(factor)));
          if (factor < 1 && lnD < LN_FOCUS_END) requestHighResTerrain();
          tweenTo({ lnD }, 0.9, "power2.out");
        },
        focusOn: (lat: number, lon: number, radiusKm: number) => {
          requestHighResTerrain();
          // Pan = rotation that carries the pole point onto (lat, lon): angle = distance from the pole.
          const ang = (90 + lat) * DEG;
          const dx = Math.sin(lon * DEG), dz = Math.cos(lon * DEG); // horizontal direction of lon in the scene
          const dist = Math.min(Math.max(radiusKm * 5.5, CAMERA.minDistanceKm * 1.4), CAMERA.poleFocusStartKm * 0.9);
          const from = cur.current.lnD, to = Math.log(dist);
          tweenTo({ lnD: to, tilt: 32, panX: R * ang * dx, panZ: R * ang * dz }, Math.abs(from - to) > 1.5 ? 3.2 : 1.8);
        },
      },
    });

    // Development-only handle so automated visual tests can set rig states deterministically.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __seleneRig?: unknown }).__seleneRig = { goal: goal.current, cur: cur.current };

    /* ---------------------------------------------------------- input */
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: "rotate" | "pan" | "draw" | null = null;
    let pinchDist = 0;
    let drawCentre: { lat: number; lon: number; x: number; y: number; sx: number; sy: number } | null = null;

    /** Surface point under a client position (lat/lon), or null. */
    const pick = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const r = pickSurface(camera, clientX - rect.left, clientY - rect.top, { width: rect.width, height: rect.height },
        sharedUniforms.uExag.value);
      return r ? { lat: r.lat, lon: r.lon } : null;
    };

    /* ---- pinning: only "clean" clicks (press and release without dragging) count */
    let press: { x: number; y: number; moved: boolean; button: number } | null = null;
    let lastClean: { t: number; x: number; y: number } | null = null;
    const pinAt = (clientX: number, clientY: number) => {
      if (store.get().drawing) return; // never while drawing the landing ellipse
      const rect = el.getBoundingClientRect();
      const r = pickSurface(camera, clientX - rect.left, clientY - rect.top, { width: rect.width, height: rect.height },
        sharedUniforms.uExag.value);
      if (r) store.set({ pinned: r, pinMode: false });
    };

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      press = pointers.size === 1 ? { x: e.clientX, y: e.clientY, moved: false, button: e.button } : null;
      kill();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        mode = null;
      } else if (store.get().drawing && e.button === 0 && !e.shiftKey) {
        // Landing-ellipse drawing: press = centre, drag = semi-major axis length and heading.
        const p = pick(e.clientX, e.clientY);
        if (p && p.lat <= -80) {
          const m = latLonToMap(p.lat, p.lon);
          drawCentre = { ...p, ...m, sx: e.clientX, sy: e.clientY };
          const prevE = store.get().ellipse;
          const ratio = prevE ? prevE.bKm / Math.max(prevE.aKm, 0.01) : DEFAULT_ELLIPSE.bKm / DEFAULT_ELLIPSE.aKm;
          setEllipse({ lat: p.lat, lon: p.lon, aKm: DEFAULT_ELLIPSE.aKm, bKm: DEFAULT_ELLIPSE.aKm * ratio, headingDeg: prevE?.headingDeg ?? 0 });
          mode = "draw";
        } else mode = "rotate";
      } else {
        mode = e.button === 2 || e.shiftKey || e.ctrlKey ? "pan" : "rotate";
      }
      el.style.cursor = mode === "draw" ? "crosshair" : "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, inside: true, dirty: true };
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press.moved = true;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = goal.current;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) g.lnD -= Math.log(d / pinchDist) * 1.2;
        pinchDist = d;
        if (g.lnD < LN_FOCUS_END) requestHighResTerrain();
        return;
      }
      // Angular speed scales gently with zoom so close-range control stays precise.
      const speed = 0.16 + 0.12 * (1 - poleFocusOf(cur.current.lnD));
      if (mode === "draw" && drawCentre) {
        if (Math.hypot(e.clientX - drawCentre.sx, e.clientY - drawCentre.sy) < 6) return; // a click keeps the default size
        const p = pick(e.clientX, e.clientY);
        if (!p) return;
        const m = latLonToMap(p.lat, p.lon);
        const vx = m.x - drawCentre.x, vy = m.y - drawCentre.y;
        const lon = Math.hypot(drawCentre.x, drawCentre.y) < 1e-9 ? 0 : Math.atan2(drawCentre.x, drawCentre.y);
        // compass heading: north = away from the pole, east = direction of increasing longitude
        const n = vx * Math.sin(lon) + vy * Math.cos(lon), ea = vx * Math.cos(lon) - vy * Math.sin(lon);
        const a = Math.min(40, Math.max(0.3, Math.hypot(vx, vy)));
        const prevE = store.get().ellipse;
        const ratio = prevE ? prevE.bKm / Math.max(prevE.aKm, 0.01) : 0.5;
        setEllipse({
          lat: drawCentre.lat, lon: drawCentre.lon, aKm: a, bKm: Math.max(0.15, a * ratio),
          headingDeg: (((Math.atan2(ea, n) / SKY_RAD) % 180) + 180) % 180,
        });
        return;
      }
      if (mode === "rotate") {
        g.az += dx * speed;
        g.tilt += dy * speed * 0.8;
      } else if (mode === "pan") {
        const dist = camera.position.distanceTo(vTarget);
        const kmPerPx = (2 * dist * Math.tan((camera.fov * DEG) / 2)) / rect.height;
        vRight.setFromMatrixColumn(camera.matrixWorld, 0).setY(0);
        vFwd.setFromMatrixColumn(camera.matrixWorld, 1).setY(0);
        if (vRight.lengthSq() > 1e-8) vRight.normalize();
        if (vFwd.lengthSq() > 1e-8) vFwd.normalize();
        g.panX -= (vRight.x * dx - vFwd.x * dy) * kmPerPx;
        g.panZ -= (vRight.z * dx - vFwd.z * dy) * kmPerPx;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      // A clean click: Pin button armed → pin now; two clean clicks close together → double-click pin.
      if (press && !press.moved && press.button === 0 && mode !== "draw" && !store.get().drawing) {
        const now = performance.now();
        if (store.get().pinMode) {
          pinAt(e.clientX, e.clientY);
          lastClean = null;
        } else if (lastClean && now - lastClean.t < 400 && Math.hypot(e.clientX - lastClean.x, e.clientY - lastClean.y) < 8) {
          pinAt(e.clientX, e.clientY);
          lastClean = null;
        } else lastClean = { t: now, x: e.clientX, y: e.clientY };
      } else lastClean = null;
      press = null;
      if (pointers.size === 0) {
        if (mode === "draw") {
          drawCentre = null;
          store.set({ drawing: false });
        }
        mode = null;
        el.style.cursor = store.get().drawing || store.get().pinMode ? "crosshair" : "grab";
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      kill();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const delta = Math.max(-240, Math.min(240, e.deltaY * unit));
      goal.current.lnD += delta * 0.0016;
      if (goal.current.lnD < LN_FOCUS_END) requestHighResTerrain();
    };
    const onLeave = () => {
      pointer.current.inside = false;
      pointer.current.dirty = true;
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const g = goal.current;
      const api = store.get().cameraApi;
      switch (e.key) {
        case "+": case "=": api?.zoomBy(0.6); break;
        case "-": case "_": api?.zoomBy(1 / 0.6); break;
        case "ArrowLeft": kill(); g.az -= 8; break;
        case "ArrowRight": kill(); g.az += 8; break;
        case "ArrowUp": kill(); g.tilt -= 5; break;
        case "ArrowDown": kill(); g.tilt += 5; break;
        case "p": case "P": {
          const s = store.get();
          if (s.drawing || !s.cursor) return;
          store.set({ pinned: s.cursor, pinMode: false });
          break;
        }
        case "Escape": {
          const s = store.get();
          if (!s.pinned && !s.pinMode) return;
          store.set({ pinned: null, pinMode: false });
          break;
        }
        default: return;
      }
      e.preventDefault();
    };
    const noMenu = (e: Event) => e.preventDefault();

    el.style.cursor = "grab";
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      kill();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("keydown", onKey);
      store.set({ cameraApi: null });
    };
  }, [gl, camera]);

  /* ------------------------------------------------------------ per frame */
  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const g = goal.current, c = cur.current;

    // --- constraints on the goal
    g.lnD = Math.min(LN_MAX, Math.max(LN_MIN, g.lnD));
    const wGoal = poleFocusOf(g.lnD);
    g.tilt = Math.min(tiltMaxOf(wGoal), Math.max(CAMERA.tiltGlobalMinDeg, g.tilt));
    const panMax = CAMERA.maxPanKm * wGoal;
    const panLen = Math.hypot(g.panX, g.panZ);
    if (panLen > panMax) {
      const s = panMax / (panLen || 1);
      g.panX *= s;
      g.panZ *= s;
    }

    // --- critically damped follow (GSAP tweens drive the goal; damping is tighter while tweening)
    const k = 1 - Math.exp(-dt * (tweening.current ? 18 : CAMERA.damping));
    c.lnD += (g.lnD - c.lnD) * k;
    c.tilt += (g.tilt - c.tilt) * k;
    c.az += (g.az - c.az) * k;
    c.panX += (g.panX - c.panX) * k;
    c.panZ += (g.panZ - c.panZ) * k;

    const exag = sharedUniforms.uExag.value;
    const D = Math.exp(c.lnD);
    const w = poleFocusOf(c.lnD);
    frameState.poleFocus = w;
    const poleH = ((sampleHeightM(-90, 0) ?? 0) / 1000) * exag;
    const t = c.tilt * DEG, a = c.az * DEG;

    vPole.set(0, -(R + poleH * w), 0);
    vDir.set(Math.sin(t) * Math.cos(a), -Math.cos(t), Math.sin(t) * Math.sin(a));
    vUp.set(Math.cos(t) * Math.cos(a), Math.sin(t), Math.cos(t) * Math.sin(a));
    vCam.copy(vPole).addScaledVector(vDir, D);
    vTarget.copy(vPole).multiplyScalar(w);

    // pan = rotation of the rig about the Moon centre
    const p = Math.hypot(c.panX, c.panZ);
    if (p > 1e-6) {
      vAxis.set(-c.panZ / p, 0, c.panX / p);
      qPan.setFromAxisAngle(vAxis, p / R);
      vCam.applyQuaternion(qPan);
      vTarget.applyQuaternion(qPan);
      vUp.applyQuaternion(qPan);
    }

    // terrain clearance using real LOLA heights under the camera
    const camLL = dirToLatLon(vCam.x, vCam.y, vCam.z);
    const groundH = ((sampleHeightM(camLL.lat, camLL.lon) ?? 0) / 1000) * exag;
    const minR = R + groundH + CAMERA.minClearanceKm;
    const camR = vCam.length();
    if (camR < minR) vCam.multiplyScalar(minR / camR);

    camera.position.copy(vCam);
    camera.up.copy(vUp);
    camera.lookAt(vTarget);

    // projection: keep ≥ 38° horizontal FOV on portrait screens; dynamic clip planes
    const aspect = size.width / Math.max(1, size.height);
    const fov = aspect < 1 ? (2 * Math.atan(Math.tan((CAMERA.fovDeg * DEG) / 2) / aspect)) / DEG : CAMERA.fovDeg;
    const alt = vCam.length() - R;
    const near = Math.max(0.05, (alt - 7.4 * exag) * 0.35);
    const far = vCam.length() + 2.2 * R;
    if (Math.abs(camera.fov - fov) > 1e-3 || Math.abs(camera.near - near) > 1e-3 || Math.abs(camera.far - far) > 1e-1) {
      camera.fov = fov;
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }

    // highlight fades as we approach the pole
    sharedUniforms.uHighlight.value = 1 - smooth(w / 0.75);

    // --- telemetry (≈12 Hz) — only measured values from the loaded datasets
    const now = state.clock.elapsedTime;
    if (now - lastTelemetry.current > 0.08 || pointer.current.dirty) {
      lastTelemetry.current = now;
      const viewMode: ViewMode = w < 0.12 ? "global" : w < 0.9 ? "approach" : "terrain";
      const focusLL = w > 0.02 ? dirToLatLon(vTarget.x, vTarget.y, vTarget.z) : { lat: -90, lon: 0 };
      const patch: Parameters<typeof store.set>[0] = {
        viewMode,
        poleFocus: Math.round(w * 1000) / 1000,
        altitudeKm: Math.round((alt - groundH) * 10) / 10,
        distanceToPoleKm: Math.round(vCam.distanceTo(vPole.set(0, -R, 0))),
        focus: readout(w > 0.02 ? focusLL.lat : -90, w > 0.02 ? focusLL.lon : 0),
      };
      if (pointer.current.dirty) {
        pointer.current.dirty = false;
        patch.cursor = pointer.current.inside ? pickSurface(camera, pointer.current.x, pointer.current.y, size, exag) : null;
      }
      store.set(patch);
    }
  });

  return null;
}

/** Analytic surface pick: ray ∩ sphere, refined with the true LOLA height (3 iterations). */
function pickSurface(
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  size: { width: number; height: number },
  exag: number,
) {
  ndc.set((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let r = R;
  let ll = null as ReturnType<typeof dirToLatLon> | null;
  for (let i = 0; i < 4; i++) {
    sphere.radius = r;
    if (!raycaster.ray.intersectSphere(sphere, hit)) {
      if (i === 0) return null;
      break;
    }
    ll = dirToLatLon(hit.x, hit.y, hit.z);
    const h = sampleHeightM(ll.lat, ll.lon);
    if (h === null) break;
    r = R + (h / 1000) * exag;
  }
  return ll ? readout(ll.lat, ll.lon) : null;
}
