"use client";
/**
 * Precomputed hourly Sun/Earth sub-points (scripts/compute_ephemeris.py, NASA JPL DE440 +
 * DE421 lunar orientation, validated against NASA SVS mooninfo and JPL Horizons).
 * Nothing is computed from a web service at runtime.
 */
import { DATA_BASE } from "./lunar-config";
import type { Subpoints } from "./sky";

export interface EphemerisMeta {
  file: string;
  start_utc: string;
  step_hours: number;
  count: number;
  validation: {
    svs_mooninfo_2026?: { hours_compared: number; subsolar_max_dlon_deg: number; subearth_max_dlon_deg: number };
    jpl_horizons?: { dates_compared: number; max_diff_deg: number };
  };
}

export interface Ephemeris {
  meta: EphemerisMeta;
  data: Float32Array; // rows of [sunLat, sunLon, earthLat, earthLon, earthDistKm]
  startMs: number;
  endMs: number;
}

let promise: Promise<Ephemeris> | null = null;
export function loadEphemeris(): Promise<Ephemeris> {
  promise ??= (async () => {
    const meta: EphemerisMeta = await (await fetch(`${DATA_BASE}/ephemeris-meta.json`)).json();
    const buf = await (await fetch(`${DATA_BASE}/${meta.file}`)).arrayBuffer();
    const startMs = Date.parse(meta.start_utc);
    return { meta, data: new Float32Array(buf), startMs, endMs: startMs + (meta.count - 1) * 3600e3 };
  })();
  return promise;
}

const lerpLon = (a: number, b: number, w: number) => {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360; // shortest way across ±180° — no "spinning" Sun
  const v = a + d * w;
  return v > 180 ? v - 360 : v < -180 ? v + 360 : v;
};

/** Sub-points at any instant (linear interpolation between hourly rows, longitude-wrap safe). */
export function subpointsAt(e: Ephemeris, ms: number, out?: Subpoints): Subpoints {
  const f = Math.min(Math.max((ms - e.startMs) / 3600e3, 0), e.meta.count - 1.0001);
  const i = Math.floor(f), w = f - i;
  const a = i * 5, b = a + 5, d = e.data;
  const o = out ?? ({} as Subpoints);
  o.sunLat = d[a] + (d[b] - d[a]) * w;
  o.sunLon = lerpLon(d[a + 1], d[b + 1], w);
  o.earthLat = d[a + 2] + (d[b + 2] - d[a + 2]) * w;
  o.earthLon = lerpLon(d[a + 3], d[b + 3], w);
  o.earthDistKm = d[a + 4] + (d[b + 4] - d[a + 4]) * w;
  return o;
}

/** Earliest selectable landing time: the next whole hour from now (clamped to the table). */
export function earliestLandingMs(e: Ephemeris): number {
  const now = Math.ceil(Date.now() / 3600e3) * 3600e3;
  return Math.max(now, e.startMs);
}
