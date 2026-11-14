"use client";
/** Main-thread client for lib/planning.worker.ts (promise API + progress). */
import { DATA_BASE } from "./lunar-config";
import { loadEphemeris } from "./ephemeris";
import type { EllipseSpec } from "./planning.worker";

export type { EllipseSpec };

export interface HorizonMeta {
  overview: { file: string; size: number; cell_m: number; directions: number };
  annual: { file: string; year: number; hours: number };
  dem80: { dir: string; tile_px: number; tiles: [number, number][] };
}

export interface EllipseResult {
  count: number;
  cellKm: number;
  centre: { lat: number; lon: number; groundM: number };
  centreHorizon: Float32Array;
  series: Float32Array;
  hours: number;
  landing: { litAreaPct: number; earthAreaPct: number };
  sun: { visibleAtLanding: boolean; hoursUntilChange: number | null };
  earth: { visibleAtLanding: boolean; hoursUntilChange: number | null };
  mission: {
    sunlitPct: number; sunlitMinPct: number; sunlitMaxPct: number; earthPct: number;
    longestNightH: number; centreLongestNightH: number; bothPctCentre: number;
  };
  terrain: { slopeMeanDeg: number; slopeMaxDeg: number; psrPct: number };
}

export interface FineMask {
  data: Uint8Array;
  x0: number;
  y1: number;
  cellKm: number;
  w: number;
  h: number;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (v: number, label?: string) => void };

let worker: Worker | null = null;
let readyP: Promise<HorizonMeta> | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

export function planningReady(): Promise<HorizonMeta> {
  readyP ??= (async () => {
    const [hm, eph] = await Promise.all([
      fetch(`${DATA_BASE}/horizon-meta.json`).then((r) => r.json() as Promise<HorizonMeta>),
      loadEphemeris(),
    ]);
    worker = new Worker(new URL("./planning.worker.ts", import.meta.url), { type: "module" });
    const ready = new Promise<void>((res, rej) => {
      worker!.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "ready") return res();
        const p = pending.get(m.id);
        if (!p) return;
        if (m.type === "progress") return p.progress?.(m.value, m.label);
        pending.delete(m.id);
        if (m.type === "error") p.reject(new Error(m.message));
        else p.resolve(m);
      };
      worker!.onerror = (e) => rej(new Error(e.message));
    });
    worker.postMessage({
      type: "init",
      base: new URL(DATA_BASE, window.location.href).toString(),
      horizonFile: hm.overview.file,
      n: hm.overview.size,
      ephFile: eph.meta.file,
      ephStartMs: eph.startMs,
      ephCount: eph.meta.count,
      coarseFile: "south-pole-height-high.i16",
      coarseN: 950,
      queryFile: "south-pole-query-high.u8",
      dem80Dir: hm.dem80.dir,
      tilePx: hm.dem80.tile_px,
      tiles: hm.dem80.tiles,
    });
    await ready;
    return hm;
  })();
  return readyP;
}

function call<T>(msg: Record<string, unknown>, progress?: Pending["progress"]): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    worker!.postMessage({ ...msg, id });
  });
}

export async function overviewAt(ms: number): Promise<Uint8Array> {
  await planningReady();
  return (await call<{ data: Uint8Array }>({ type: "overview-hour", ms })).data;
}

export async function overviewWindow(startMs: number, hours: number, progress?: Pending["progress"]) {
  await planningReady();
  const step = Math.max(1, Math.ceil(hours / 360)); // ≤ 360 samples keeps this to a few seconds
  const r = await call<{ data: Uint8Array }>({ type: "overview-window", startMs, hours, step }, progress);
  return { data: r.data, step };
}

export async function analyseEllipse(ellipse: EllipseSpec, landingMs: number, hours: number, progress?: Pending["progress"]) {
  await planningReady();
  return (await call<{ result: EllipseResult }>({ type: "ellipse", ellipse, landingMs, hours }, progress)).result;
}

export async function ellipseAt(ms: number): Promise<FineMask | null> {
  if (!worker) return null;
  const r = await call<FineMask & { type: string }>({ type: "ellipse-hour", ms });
  return r.type === "ellipse-hour" ? r : null;
}
