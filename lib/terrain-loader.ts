"use client";
/**
 * Asset loading for SELENE-Nav. Everything here reads the *derived* web assets
 * produced by scripts/process_lunar_data.py — the browser never touches the
 * original NASA GeoTIFFs.
 */
import * as THREE from "three";
import { CAP_RADIUS_KM, DATA_BASE, METADATA_URL, MOON_RADIUS_KM } from "./lunar-config";
import type { GridSpec } from "./terrain-sampling";

/* ------------------------------------------------------------------ metadata */

export interface LodMeta {
  grid: { file: string; size: number; cell_m: number; min_m: number; max_m: number; resampling: string };
  query: { file: string; size: number };
  visual: { file: string; size: number; cell_m: number };
  science: { file: string; size: number; cell_m: number };
}

export interface LunarMetadata {
  generated_utc: string;
  body: { reference_radius_m: number; frame: string };
  projection: { proj4: string; type: string; proj_cross_check?: { checked: boolean; max_dlat_deg?: number } };
  extent_m: { xmin: number; xmax: number; ymin: number; ymax: number };
  elevation: { min_m: number; max_m: number; units: string };
  psr: { stats: { psr_area_km2: number; cap_area_km2: number; psr_fraction_of_cap: number } | null };
  lods: Record<"low" | "high", LodMeta>;
  global: {
    color: { file: string };
    normal: { file: string };
    height: { file: string; width: number; height: number };
  } | null;
  sources: Record<string, { file: string; width: number; height: number; pixel_size_m: number[]; sha256?: string }>;
}

let metaPromise: Promise<LunarMetadata> | null = null;
export function loadMetadata(): Promise<LunarMetadata> {
  metaPromise ??= fetch(METADATA_URL).then((r) => {
    if (!r.ok) throw new Error(`Metadata not found (${r.status}). Run scripts/process_lunar_data.py.`);
    return r.json();
  });
  return metaPromise;
}

/* ------------------------------------------------------------------ helpers */

const texLoader = new THREE.TextureLoader();

async function loadDataTexture(file: string, srgb = false): Promise<THREE.Texture> {
  const tex = await texLoader.loadAsync(`${DATA_BASE}/${file}`);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

async function fetchBuffer(file: string): Promise<ArrayBuffer> {
  const r = await fetch(`${DATA_BASE}/${file}`);
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

/** IEEE 754 half → float. */
function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/* ------------------------------------------------------------------ globe */

export interface GlobeAssets {
  color: THREE.Texture;
  normal: THREE.Texture;
  height: THREE.DataTexture;
  /** Global LOLA heights in km (equirectangular, row 0 = 90°N, col 0 = 180°W). */
  heightKm: Float32Array;
  heightSize: [number, number];
}

export async function loadGlobeAssets(meta: LunarMetadata): Promise<GlobeAssets> {
  if (!meta.global) throw new Error("Global imagery missing — run the downloader without --no-global.");
  const g = meta.global;
  const [color, normal, hbuf] = await Promise.all([
    loadDataTexture(g.color.file, true),
    loadDataTexture(g.normal.file),
    fetchBuffer(g.height.file),
  ]);
  color.wrapS = normal.wrapS = THREE.RepeatWrapping;
  const half = new Uint16Array(hbuf);
  const heightKm = new Float32Array(half.length);
  for (let i = 0; i < half.length; i++) heightKm[i] = halfToFloat(half[i]);
  const height = new THREE.DataTexture(half, g.height.width, g.height.height, THREE.RedFormat, THREE.HalfFloatType);
  height.flipY = false; // row 0 is 90°N → we sample with v measured from the top
  height.wrapS = THREE.RepeatWrapping;
  height.wrapT = THREE.ClampToEdgeWrapping;
  height.minFilter = THREE.LinearFilter;
  height.magFilter = THREE.LinearFilter;
  height.generateMipmaps = false;
  height.needsUpdate = true;
  return { color, normal, height, heightKm, heightSize: [g.height.width, g.height.height] };
}

/** Bilinear global height (km) at lat/lon degrees. */
export function sampleGlobalHeightKm(a: GlobeAssets, lat: number, lon: number): number {
  const [w, h] = a.heightSize;
  const u = ((((lon + 180) / 360) % 1) + 1) % 1 * w - 0.5;
  const v = Math.min(Math.max(((90 - lat) / 180) * h - 0.5, 0), h - 1);
  const c0 = Math.floor(u), r0 = Math.min(Math.floor(v), h - 2);
  const fc = u - c0, fr = v - r0;
  const ca = ((c0 % w) + w) % w, cb = (ca + 1) % w;
  const d = a.heightKm;
  const top = d[r0 * w + ca] * (1 - fc) + d[r0 * w + cb] * fc;
  const bot = d[(r0 + 1) * w + ca] * (1 - fc) + d[(r0 + 1) * w + cb] * fc;
  return top * (1 - fr) + bot * fr;
}

/* ------------------------------------------------------------------ terrain */

export interface TerrainLod {
  level: "low" | "high";
  geometry: THREE.BufferGeometry;
  visual: THREE.Texture;
  science: THREE.Texture;
  /** Height grid in metres (block-centred nodes). */
  gridM: Float32Array;
  /** Interleaved [slope byte, psr byte] at grid resolution. */
  query: Uint8Array;
  spec: GridSpec;
  cellM: number;
  texCellM: number;
  stats: { vertices: number; triangles: number; ms: number };
}

let worker: Worker | null = null;
let reqId = 0;
const pending = new Map<number, (d: WorkerResult) => void>();

interface WorkerResult {
  id: number;
  position: Float32Array;
  aHeight: Float32Array;
  aMap: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  gridM: Float32Array;
  stats: { vertices: number; triangles: number; ms: number };
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<WorkerResult>) => {
      pending.get(ev.data.id)?.(ev.data);
      pending.delete(ev.data.id);
    };
  }
  return worker;
}

function buildInWorker(heights: ArrayBuffer, size: number, halfExtentKm: number): Promise<WorkerResult> {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    const w = getWorker();
    pending.set(id, resolve);
    w.onerror = (e) => reject(new Error(`terrain worker: ${e.message}`));
    w.postMessage(
      { id, heights, size, halfExtentKm, capRadiusKm: CAP_RADIUS_KM, radiusKm: MOON_RADIUS_KM },
      [heights],
    );
  });
}

export async function loadTerrainLod(meta: LunarMetadata, level: "low" | "high"): Promise<TerrainLod> {
  const lod = meta.lods[level];
  const halfExtentKm = (meta.extent_m.xmax - meta.extent_m.xmin) / 2000;
  const [hbuf, qbuf, visual, science] = await Promise.all([
    fetchBuffer(lod.grid.file),
    fetchBuffer(lod.query.file),
    loadDataTexture(lod.visual.file),
    loadDataTexture(lod.science.file),
  ]);
  const built = await buildInWorker(hbuf, lod.grid.size, halfExtentKm);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(built.position, 3));
  geometry.setAttribute("aHeight", new THREE.BufferAttribute(built.aHeight, 1));
  geometry.setAttribute("aMap", new THREE.BufferAttribute(built.aMap, 2));
  geometry.setAttribute("uv", new THREE.BufferAttribute(built.uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(built.index, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -MOON_RADIUS_KM, 0), 400);
  return {
    level,
    geometry,
    visual,
    science,
    gridM: built.gridM,
    query: new Uint8Array(qbuf),
    spec: { size: lod.grid.size, halfExtentKm },
    cellM: lod.grid.cell_m,
    texCellM: lod.visual.cell_m,
    stats: built.stats,
  };
}

export function disposeTerrainLod(t: TerrainLod) {
  t.geometry.dispose();
  t.visual.dispose();
  t.science.dispose();
}
