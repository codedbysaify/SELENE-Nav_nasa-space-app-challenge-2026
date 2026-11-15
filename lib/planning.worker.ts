/// <reference lib="webworker" />
/**
 * SELENE-Nav planning worker — all Sun/Earth/horizon computation off the main thread.
 *
 * Overview (whole 80–90°S, 1.28 km cells): uses the precomputed horizon profiles
 * (scripts/compute_horizons.py) to produce, for one instant, the sunlit fraction and
 * Earth visibility of every cell, or statistics over a mission window.
 *
 * Landing ellipse (full LOLA 80 m): fetches the 80 m DEM tiles around the ellipse,
 * computes a 72-direction terrain horizon for each 80 m cell inside it (80 m terrain to
 * 25 km, 640 m terrain to 250 km, exact spherical curvature), a 360-direction horizon
 * at the centre, and then hour-by-hour Sun/Earth visibility over the mission.
 */
import {
  HORIZON_DIRS, MOON_R_KM as R, RAD, earthTopocentric, horizonAt, latLonToMap, mapToLatLon, skyPosition, sunFraction,
} from "./sky";

const HALF = 304; // km
const CAP_KM = 2 * R * Math.tan(5 * RAD); // stereographic radius of 80°S
interface Init {
  type: "init";
  base: string;
  horizonFile: string;
  n: number;
  ephFile: string;
  ephStartMs: number;
  ephCount: number;
  coarseFile: string;
  coarseN: number;
  queryFile: string;
  dem80Dir: string;
  tilePx: number;
  tiles: [number, number][];
}
export interface EllipseSpec {
  lat: number;
  lon: number;
  aKm: number; // semi-major
  bKm: number; // semi-minor
  headingDeg: number; // compass azimuth of the major axis at the centre
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let cfg: Init;
let horizon: Uint8Array; // [cell][dir]
let eph: Float32Array;
let coarse: Float32Array; // metres, 950² block-centred 640 m
let query: Uint8Array; // [cell][slope, psr]
let cellSin: Float64Array, cellCos: Float64Array, cellLon: Float64Array;
let cellSlope: Float32Array; // mean LDSM slope (deg) of each overview cell, from the 640 m query grid
let cellInCap: Uint8Array;
let ready: Promise<void> | null = null;

/* ---------------------------------------------------------------- loading */
async function inflate(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`${url}: HTTP ${r.status}`);
  return new Response(r.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
}

async function init(c: Init) {
  cfg = c;
  const [hz, e, cs, q] = await Promise.all([
    inflate(`${c.base}/${c.horizonFile}`),
    fetch(`${c.base}/${c.ephFile}`).then((r) => r.arrayBuffer()),
    fetch(`${c.base}/${c.coarseFile}`).then((r) => r.arrayBuffer()),
    fetch(`${c.base}/${c.queryFile}`).then((r) => r.arrayBuffer()),
  ]);
  horizon = new Uint8Array(hz);
  eph = new Float32Array(e);
  const ci = new Int16Array(cs);
  coarse = new Float32Array(ci.length);
  for (let i = 0; i < ci.length; i++) coarse[i] = ci[i];
  query = new Uint8Array(q);
  const n = c.n, cell = (2 * HALF) / n;
  cellSin = new Float64Array(n * n);
  cellCos = new Float64Array(n * n);
  cellLon = new Float64Array(n * n);
  for (let r = 0; r < n; r++)
    for (let k = 0; k < n; k++) {
      const { lat, lon } = mapToLatLon(-HALF + (k + 0.5) * cell, HALF - (r + 0.5) * cell);
      const i = r * n + k;
      cellSin[i] = Math.sin(lat * RAD);
      cellCos[i] = Math.cos(lat * RAD);
      cellLon[i] = lon * RAD;
    }
  // slope per overview cell = mean of the query-grid nodes it covers (query grid is coarseN², interleaved [slope, psr])
  cellSlope = new Float32Array(n * n);
  cellInCap = new Uint8Array(n * n);
  const f = c.coarseN / n; // 2
  for (let r = 0; r < n; r++)
    for (let k = 0; k < n; k++) {
      let sum = 0, cnt = 0;
      for (let dr = 0; dr < f; dr++)
        for (let dc = 0; dc < f; dc++) {
          const qr = Math.min(c.coarseN - 1, Math.floor(r * f) + dr), qc = Math.min(c.coarseN - 1, Math.floor(k * f) + dc);
          sum += query[(qr * c.coarseN + qc) * 2] / (255 / 90);
          cnt++;
        }
      const i = r * n + k;
      cellSlope[i] = sum / cnt;
      const x = -HALF + (k + 0.5) * cell, y = HALF - (r + 0.5) * cell;
      cellInCap[i] = Math.hypot(x, y) <= CAP_KM - 2 ? 1 : 0;
    }
}

/* ---------------------------------------------------------------- ephemeris */
function sub(ms: number) {
  const f = Math.min(Math.max((ms - cfg.ephStartMs) / 3600e3, 0), cfg.ephCount - 1.0001);
  const i = Math.floor(f), w = f - i, a = i * 5, b = a + 5;
  const ll = (p: number, q: number) => {
    let d = q - p;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return p + d * w;
  };
  return {
    sunLat: eph[a] + (eph[b] - eph[a]) * w, sunLon: ll(eph[a + 1], eph[b + 1]),
    earthLat: eph[a + 2] + (eph[b + 2] - eph[a + 2]) * w, earthLon: ll(eph[a + 3], eph[b + 3]),
    dist: eph[a + 4] + (eph[b + 4] - eph[a + 4]) * w,
  };
}

/** Fast el/az for overview cell i (radians in, degrees out). */
function cellSky(i: number, bs: number, bc: number, blon: number): [number, number] {
  const dl = blon - cellLon[i];
  const cdl = Math.cos(dl);
  const s = cellSin[i] * bs + cellCos[i] * bc * cdl;
  const el = Math.asin(s > 1 ? 1 : s < -1 ? -1 : s);
  let az = Math.atan2(Math.sin(dl) * bc, cellCos[i] * bs - cellSin[i] * bc * cdl) / RAD;
  if (az < 0) az += 360;
  return [el / RAD, az];
}

/* ---------------------------------------------------------------- overview */
function overviewHour(ms: number): Uint8Array {
  const n2 = cfg.n * cfg.n;
  const out = new Uint8Array(n2 * 4);
  const s = sub(ms);
  const ss = Math.sin(s.sunLat * RAD), sc = Math.cos(s.sunLat * RAD), sl = s.sunLon * RAD;
  const es = Math.sin(s.earthLat * RAD), ec = Math.cos(s.earthLat * RAD), el = s.earthLon * RAD;
  for (let i = 0; i < n2; i++) {
    const [sEl, sAz] = cellSky(i, ss, sc, sl);
    const fr = sunFraction(sEl, horizonAt(horizon, i * HORIZON_DIRS, HORIZON_DIRS, sAz));
    const [eEl0, eAz] = cellSky(i, es, ec, el);
    const vis = earthTopocentric(eEl0, s.dist) > horizonAt(horizon, i * HORIZON_DIRS, HORIZON_DIRS, eAz);
    out[i * 4] = Math.round(fr * 255);
    out[i * 4 + 1] = vis ? 255 : 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function overviewWindow(startMs: number, hours: number, step: number, id: number): Uint8Array {
  const n2 = cfg.n * cfg.n;
  const sun = new Float32Array(n2), earth = new Float32Array(n2);
  const run = new Uint16Array(n2), longest = new Uint16Array(n2);
  let samples = 0;
  for (let h = 0; h < hours; h += step, samples++) {
    const s = sub(startMs + h * 3600e3);
    const ss = Math.sin(s.sunLat * RAD), sc = Math.cos(s.sunLat * RAD), sl = s.sunLon * RAD;
    const es = Math.sin(s.earthLat * RAD), ec = Math.cos(s.earthLat * RAD), el = s.earthLon * RAD;
    for (let i = 0; i < n2; i++) {
      const [sEl, sAz] = cellSky(i, ss, sc, sl);
      const fr = sunFraction(sEl, horizonAt(horizon, i * HORIZON_DIRS, HORIZON_DIRS, sAz));
      sun[i] += fr;
      if (fr <= 0) {
        run[i] += step;
        if (run[i] > longest[i]) longest[i] = run[i];
      } else run[i] = 0;
      const [eEl0, eAz] = cellSky(i, es, ec, el);
      if (earthTopocentric(eEl0, s.dist) > horizonAt(horizon, i * HORIZON_DIRS, HORIZON_DIRS, eAz)) earth[i]++;
    }
    if (samples % 24 === 0) ctx.postMessage({ type: "progress", id, value: h / hours });
  }
  const out = new Uint8Array(n2 * 4);
  for (let i = 0; i < n2; i++) {
    out[i * 4] = Math.round((sun[i] / samples) * 255);
    out[i * 4 + 1] = Math.round((earth[i] / samples) * 255);
    out[i * 4 + 2] = Math.round(Math.min(1, longest[i] / hours) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/* ---------------------------------------------------------------- 80 m terrain */
interface Mosaic {
  data: Float32Array; // metres, NaN where no tile
  r0: number; // global 80 m pixel row of mosaic row 0
  c0: number;
  h: number;
  w: number;
}

async function buildMosaic(xMin: number, xMax: number, yMin: number, yMax: number): Promise<Mosaic> {
  const P = cfg.tilePx;
  const toCol = (x: number) => Math.floor((x + HALF) / 0.08);
  const toRow = (y: number) => Math.floor((HALF - y) / 0.08);
  const c0 = Math.max(0, toCol(xMin)), c1 = Math.min(7599, toCol(xMax));
  const r0 = Math.max(0, toRow(yMax)), r1 = Math.min(7599, toRow(yMin));
  const w = c1 - c0 + 1, h = r1 - r0 + 1;
  const data = new Float32Array(w * h).fill(NaN);
  const have = new Set(cfg.tiles.map(([r, c]) => `${r}_${c}`));
  const jobs: Promise<void>[] = [];
  for (let tr = Math.floor(r0 / P); tr <= Math.floor(r1 / P); tr++)
    for (let tc = Math.floor(c0 / P); tc <= Math.floor(c1 / P); tc++) {
      if (!have.has(`${tr}_${tc}`)) continue;
      jobs.push(
        inflate(`${cfg.base}/${cfg.dem80Dir}/t_${tr}_${tc}.i16z`).then((buf) => {
          // lossless 2-D predictor (scripts/compute_horizons.py predict_encode)
          const res = new Int16Array(buf);
          const t = new Int32Array(P * P);
          for (let y = 0; y < P; y++)
            for (let x = 0; x < P; x++) {
              const i = y * P + x;
              if (y === 0) t[i] = res[i] + (x > 0 ? t[i - 1] : 0);
              else if (x === 0) t[i] = res[i] + t[i - P];
              else t[i] = res[i] + t[i - 1] + t[i - P] - t[i - P - 1];
            }
          for (let y = 0; y < P; y++) {
            const gr = tr * P + y - r0;
            if (gr < 0 || gr >= h) continue;
            for (let x = 0; x < P; x++) {
              const gc = tc * P + x - c0;
              if (gc >= 0 && gc < w) data[gr * w + gc] = t[y * P + x];
            }
          }
        }),
      );
    }
  await Promise.all(jobs);
  return { data, r0, c0, h, w };
}

function sampleMosaic(m: Mosaic, x: number, y: number): number {
  const c = (x + HALF) / 0.08 - 0.5 - m.c0, r = (HALF - y) / 0.08 - 0.5 - m.r0;
  if (c < 0 || r < 0 || c >= m.w - 1 || r >= m.h - 1) return NaN;
  const ci = Math.floor(c), ri = Math.floor(r), fc = c - ci, fr = r - ri, i = ri * m.w + ci, d = m.data;
  return (d[i] * (1 - fc) + d[i + 1] * fc) * (1 - fr) + (d[i + m.w] * (1 - fc) + d[i + m.w + 1] * fc) * fr;
}

function sampleCoarse(x: number, y: number): number {
  const n = cfg.coarseN, cell = (2 * HALF) / n;
  const c = (x + HALF) / cell - 0.5, r = (HALF - y) / cell - 0.5;
  if (c < 0 || r < 0 || c >= n - 1 || r >= n - 1) return NaN;
  const ci = Math.floor(c), ri = Math.floor(r), fc = c - ci, fr = r - ri, i = ri * n + ci;
  return (coarse[i] * (1 - fc) + coarse[i + 1] * fc) * (1 - fr) + (coarse[i + n] * (1 - fc) + coarse[i + n + 1] * fc) * fr;
}

const NEAR_KM = 25;
const STEPS: { d: number; c: number; s: number }[] = (() => {
  const out = [];
  for (let d = 0.12; d < 250; d *= 1.05) out.push({ d, c: Math.cos(d / R), s: Math.sin(d / R) });
  return out;
})();

/** Terrain horizon (deg) at map point (x, y) with ground height h0 (m) in `dirs` compass directions. */
function horizonProfile(m: Mosaic, x: number, y: number, h0: number, dirs: number, out: Float32Array, off: number) {
  const { lat, lon } = mapToLatLon(x, y);
  const la = lat * RAD, lo = Math.hypot(x, y) < 1e-9 ? 0 : lon * RAD;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  const U = [cl * co, cl * so, sl], E = [-so, co, 0], N = [-sl * co, -sl * so, cl];
  const r0 = R + h0 / 1000;
  for (let k = 0; k < dirs; k++) {
    const A = (k * 2 * Math.PI) / dirs, ca = Math.cos(A), sa = Math.sin(A);
    const D0 = N[0] * ca + E[0] * sa, D1 = N[1] * ca + E[1] * sa, D2 = N[2] * ca + E[2] * sa;
    let best = -90;
    for (const st of STEPS) {
      const PX = U[0] * st.c + D0 * st.s, PY = U[1] * st.c + D1 * st.s, PZ = U[2] * st.c + D2 * st.s;
      const den = 1 - PZ;
      const mx = (2 * R * PY) / den, my = (2 * R * PX) / den;
      let h = st.d <= NEAR_KM ? sampleMosaic(m, mx, my) : NaN;
      if (Number.isNaN(h)) h = sampleCoarse(mx, my);
      if (Number.isNaN(h)) continue; // beyond the 80°S grid (far field already covered by the overview product)
      const r1 = R + h / 1000;
      const e = Math.atan2(r1 * st.c - r0, r1 * st.s) / RAD;
      if (e > best) best = e;
    }
    out[off + k] = best;
  }
}

/* ---------------------------------------------------------------- landing ellipse */
interface EllipseState {
  cells: Float32Array; // x, y, lat, lon per cell
  count: number;
  hz: Float32Array; // [cell][72]
  grid: { x0: number; y0: number; stride: number; w: number; h: number; idx: Int32Array };
}
let ell: EllipseState | null = null;

function ellipseGeometry(e: EllipseSpec) {
  const c = latLonToMap(e.lat, e.lon);
  const rho = Math.hypot(c.x, c.y);
  const lon = rho < 1e-9 ? 0 : Math.atan2(c.x, c.y);
  const north = [Math.sin(lon), Math.cos(lon)], east = [Math.cos(lon), -Math.sin(lon)];
  const h = e.headingDeg * RAD;
  const ux = north[0] * Math.cos(h) + east[0] * Math.sin(h), uy = north[1] * Math.cos(h) + east[1] * Math.sin(h);
  return { cx: c.x, cy: c.y, ux, uy, vx: -uy, vy: ux };
}

async function analyseEllipse(e: EllipseSpec, landingMs: number, hours: number, id: number) {
  const g = ellipseGeometry(e);
  const ext = Math.max(e.aKm, e.bKm);
  const mosaic = await buildMosaic(g.cx - ext - NEAR_KM - 1, g.cx + ext + NEAR_KM + 1, g.cy - ext - NEAR_KM - 1, g.cy + ext + NEAR_KM + 1);
  ctx.postMessage({ type: "progress", id, value: 0.05, label: "80 m terrain loaded" });

  // 80 m cells inside the ellipse, thinned to ≤ 9000 cells for interactive speed
  const area = Math.PI * e.aKm * e.bKm;
  const stride = Math.max(1, Math.ceil(Math.sqrt(area / 0.0064 / 9000)));
  const step = 0.08 * stride;
  const x0 = Math.floor((g.cx - ext + HALF) / step) * step - HALF, y1 = HALF - Math.floor((HALF - (g.cy + ext)) / step) * step;
  const w = Math.ceil((2 * ext) / step) + 2, h = w;
  const idx = new Int32Array(w * h).fill(-1);
  const list: number[] = [];
  for (let r = 0; r < h; r++)
    for (let k = 0; k < w; k++) {
      const x = x0 + (k + 0.5) * step, y = y1 - (r + 0.5) * step;
      const dx = x - g.cx, dy = y - g.cy;
      const p = (dx * g.ux + dy * g.uy) / e.aKm, q = (dx * g.vx + dy * g.vy) / e.bKm;
      if (p * p + q * q <= 1) {
        idx[r * w + k] = list.length / 4;
        const ll = mapToLatLon(x, y);
        list.push(x, y, ll.lat, ll.lon);
      }
    }
  const count = list.length / 4;
  const cells = new Float32Array(list);
  const hz = new Float32Array(count * HORIZON_DIRS);
  const ground = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = cells[i * 4], y = cells[i * 4 + 1];
    ground[i] = sampleMosaic(mosaic, x, y);
    horizonProfile(mosaic, x, y, ground[i], HORIZON_DIRS, hz, i * HORIZON_DIRS);
    if (i % 200 === 0) ctx.postMessage({ type: "progress", id, value: 0.05 + 0.8 * (i / count), label: `Horizons: ${i}/${count} cells (80 m)` });
  }
  const centreH = sampleMosaic(mosaic, g.cx, g.cy);
  const centreHz = new Float32Array(360);
  horizonProfile(mosaic, g.cx, g.cy, centreH, 360, centreHz, 0);

  // slope from the 80 m DEM (central differences, 160 m baseline) and PSR from the 640 m grid
  let slopeSum = 0, slopeMax = 0, psrSum = 0;
  const slopeHist = new Uint32Array(46); // 1° bins, last bin = 45°+
  let elevMin = Infinity, elevMax = -Infinity;
  const qn = cfg.coarseN, qcell = (2 * HALF) / qn;
  for (let i = 0; i < count; i++) {
    const x = cells[i * 4], y = cells[i * 4 + 1];
    const dzdx = (sampleMosaic(mosaic, x + 0.08, y) - sampleMosaic(mosaic, x - 0.08, y)) / 160;
    const dzdy = (sampleMosaic(mosaic, x, y + 0.08) - sampleMosaic(mosaic, x, y - 0.08)) / 160;
    const s = Math.atan(Math.hypot(dzdx, dzdy)) / RAD;
    if (Number.isFinite(s)) {
      slopeSum += s;
      if (s > slopeMax) slopeMax = s;
      slopeHist[Math.min(45, Math.floor(s))]++;
    }
    if (Number.isFinite(ground[i])) {
      if (ground[i] < elevMin) elevMin = ground[i];
      if (ground[i] > elevMax) elevMax = ground[i];
    }
    const qc = Math.min(qn - 1, Math.max(0, Math.round((x + HALF) / qcell - 0.5)));
    const qr = Math.min(qn - 1, Math.max(0, Math.round((HALF - y) / qcell - 0.5)));
    psrSum += query[(qr * qn + qc) * 2 + 1] / 255;
  }

  // hour-by-hour over the mission window
  const sunSum = new Float32Array(count), earthSum = new Float32Array(count);
  const run = new Uint16Array(count), longest = new Uint16Array(count);
  const series = new Float32Array(hours * 6); // centre: sunEl, sunHz, sunAz, earthEl, earthHz, earthAz
  let bothHours = 0, landingLit = 0, landingEarth = 0, usableCellHours = 0;
  for (let t = 0; t < hours; t++) {
    const s = sub(landingMs + t * 3600e3);
    for (let i = 0; i < count; i++) {
      const lat = cells[i * 4 + 2], lon = cells[i * 4 + 3], off = i * HORIZON_DIRS;
      const sp = skyPosition(lat, lon, s.sunLat, s.sunLon);
      const fr = sunFraction(sp.el, horizonAt(hz, off, HORIZON_DIRS, sp.az, false));
      sunSum[i] += fr;
      if (fr <= 0) {
        run[i]++;
        if (run[i] > longest[i]) longest[i] = run[i];
      } else run[i] = 0;
      const ep = skyPosition(lat, lon, s.earthLat, s.earthLon);
      const ev = earthTopocentric(ep.el, s.dist) > horizonAt(hz, off, HORIZON_DIRS, ep.az, false);
      if (ev) earthSum[i]++;
      if (ev && fr > 0) usableCellHours++; // Sun AND Earth both visible
      if (t === 0) {
        landingLit += fr;
        if (ev) landingEarth++;
      }
    }
    const c = mapToLatLon(g.cx, g.cy);
    const sp = skyPosition(c.lat, c.lon, s.sunLat, s.sunLon);
    const ep = skyPosition(c.lat, c.lon, s.earthLat, s.earthLon);
    const eEl = earthTopocentric(ep.el, s.dist);
    const sHz = horizonAt(centreHz, 0, 360, sp.az, false), eHz = horizonAt(centreHz, 0, 360, ep.az, false);
    series.set([sp.el, sHz, sp.az, eEl, eHz, ep.az], t * 6);
    if (sunFraction(sp.el, sHz) > 0 && eEl > eHz) bothHours++;
    if (t % 24 === 0) ctx.postMessage({ type: "progress", id, value: 0.85 + 0.15 * (t / hours), label: "Sun & Earth over the mission" });
  }

  // time until sunset / Earthset (or sunrise / Earthrise) at the centre, from landing, ±6-minute resolution
  const c = mapToLatLon(g.cx, g.cy);
  const margin = (ms: number, body: "sun" | "earth") => {
    const s = sub(ms);
    if (body === "sun") {
      const p = skyPosition(c.lat, c.lon, s.sunLat, s.sunLon);
      return p.el - horizonAt(centreHz, 0, 360, p.az, false) + 0.27; // > 0 → some of the disc visible
    }
    const p = skyPosition(c.lat, c.lon, s.earthLat, s.earthLon);
    return earthTopocentric(p.el, s.dist) - horizonAt(centreHz, 0, 360, p.az, false);
  };
  const transition = (body: "sun" | "earth") => {
    const up0 = margin(landingMs, body) > 0;
    const limit = Math.min(cfg.ephStartMs + (cfg.ephCount - 2) * 3600e3, landingMs + 90 * 86400e3);
    for (let t = landingMs + 0.1 * 3600e3; t <= limit; t += 0.1 * 3600e3)
      if (margin(t, body) > 0 !== up0) return { visibleAtLanding: up0, hoursUntilChange: (t - landingMs) / 3600e3 };
    return { visibleAtLanding: up0, hoursUntilChange: null as number | null };
  };

  let sMean = 0, eMean = 0, nightMax = 0, sMin = 1, sMax = 0;
  for (let i = 0; i < count; i++) {
    const v = sunSum[i] / hours;
    sMean += v;
    sMin = Math.min(sMin, v);
    sMax = Math.max(sMax, v);
    eMean += earthSum[i] / hours;
    nightMax = Math.max(nightMax, longest[i]);
  }
  ell = { cells, count, hz, grid: { x0, y0: y1, stride: step, w, h, idx } };

  return {
    count,
    cellKm: step,
    centre: { lat: c.lat, lon: c.lon, groundM: centreH },
    centreHorizon: centreHz,
    series,
    hours,
    landing: { litAreaPct: (landingLit / count) * 100, earthAreaPct: (landingEarth / count) * 100 },
    sun: transition("sun"),
    earth: transition("earth"),
    mission: {
      sunlitPct: (sMean / count) * 100, sunlitMinPct: sMin * 100, sunlitMaxPct: sMax * 100,
      earthPct: (eMean / count) * 100, longestNightH: nightMax,
      centreLongestNightH: (() => {
        let r = 0, best = 0;
        for (let t = 0; t < hours; t++) {
          if (sunFraction(series[t * 6], series[t * 6 + 1]) <= 0) best = Math.max(best, ++r);
          else r = 0;
        }
        return best;
      })(),
      bothPctCentre: (bothHours / hours) * 100,
      usablePct: (usableCellHours / (count * hours)) * 100,
    },
    terrain: {
      slopeMeanDeg: slopeSum / count, slopeMaxDeg: slopeMax, psrPct: (psrSum / count) * 100,
      slopeHist, elevMinM: elevMin, elevMaxM: elevMax,
    },
  };
}

function ellipseHour(ms: number) {
  if (!ell) return null;
  const { grid, cells, hz, count } = ell;
  const out = new Uint8Array(grid.w * grid.h * 4);
  const s = sub(ms);
  let litSum = 0, earthN = 0, bothN = 0;
  for (let j = 0; j < grid.w * grid.h; j++) {
    const i = grid.idx[j];
    if (i < 0 || i >= count) continue;
    const lat = cells[i * 4 + 2], lon = cells[i * 4 + 3], off = i * HORIZON_DIRS;
    const sp = skyPosition(lat, lon, s.sunLat, s.sunLon);
    const ep = skyPosition(lat, lon, s.earthLat, s.earthLon);
    const fr = sunFraction(sp.el, horizonAt(hz, off, HORIZON_DIRS, sp.az, false));
    const ev = earthTopocentric(ep.el, s.dist) > horizonAt(hz, off, HORIZON_DIRS, ep.az, false);
    out[j * 4] = Math.round(fr * 255);
    out[j * 4 + 1] = ev ? 255 : 0;
    out[j * 4 + 3] = 255;
    litSum += fr;
    if (ev) earthN++;
    if (ev && fr > 0) bothN++;
  }
  return {
    data: out, x0: grid.x0, y1: grid.y0, cellKm: grid.stride, w: grid.w, h: grid.h,
    // share of the ellipse (80 m cells) with sunlight / Earth in view / both, at this instant
    litPct: (litSum / count) * 100, earthPct: (earthN / count) * 100, bothPct: (bothN / count) * 100,
  };
}

/* ---------------------------------------------------------------- searches (overview grid, same Sun/Earth rules) */
/** Is the Sun (any part of the disc) AND Earth visible from overview cell i for these sub-points? Also returns parts. */
function cellUsable(i: number, ss: number, sc: number, sl: number, es: number, ec: number, el: number, dist: number): number {
  const [sEl, sAz] = cellSky(i, ss, sc, sl);
  const sun = sunFraction(sEl, horizonAt(horizon, i * HORIZON_DIRS, HORIZON_DIRS, sAz)) > 0;
  const [eEl0, eAz] = cellSky(i, es, ec, el);
  const earth = earthTopocentric(eEl0, dist) > horizonAt(horizon, i * HORIZON_DIRS, HORIZON_DIRS, eAz);
  return (sun ? 1 : 0) | (earth ? 2 : 0);
}

function cellLatLon(i: number) {
  const n = cfg.n, cell = (2 * HALF) / n;
  const r = Math.floor(i / n), k = i % n;
  return mapToLatLon(-HALF + (k + 0.5) * cell, HALF - (r + 0.5) * cell);
}

function cellXY(i: number): [number, number] {
  const n = cfg.n, cell = (2 * HALF) / n;
  return [-HALF + ((i % n) + 0.5) * cell, HALF - (Math.floor(i / n) + 0.5) * cell];
}

/** In-cap overview cells whose centres lie within rKm of map point (x, y) (always at least the nearest cell). */
function cellsWithin(x: number, y: number, rKm: number): number[] {
  const n = cfg.n, cell = (2 * HALF) / n;
  const c0 = Math.floor((x + HALF) / cell), r0 = Math.floor((HALF - y) / cell);
  const span = Math.ceil(rKm / cell) + 1;
  const out: number[] = [];
  let nearest = -1, nd = Infinity;
  for (let r = Math.max(0, r0 - span); r <= Math.min(n - 1, r0 + span); r++)
    for (let k = Math.max(0, c0 - span); k <= Math.min(n - 1, c0 + span); k++) {
      const i = r * n + k;
      if (!cellInCap[i]) continue;
      const [cx, cy] = cellXY(i);
      const d = Math.hypot(cx - x, cy - y);
      if (d <= rKm) out.push(i);
      if (d < nd) { nd = d; nearest = i; }
    }
  if (!out.length && nearest >= 0) out.push(nearest);
  return out;
}

/**
 * Best ellipse centre within radiusKm of (cx, cy) for a fixed mission window. Each candidate is scored by the
 * AVERAGE over its footprint (cells within footKm, ≈ the ellipse), so the estimate matches what the 80 m
 * ellipse analysis measures. Candidates whose footprint mean slope exceeds slopeMaxDeg are skipped.
 */
function searchNearby(cx: number, cy: number, radiusKm: number, footKm: number, startMs: number, hours: number, slopeMaxDeg: number, id: number) {
  const area = cellsWithin(cx, cy, radiusKm + footKm);
  const slot = new Int32Array(cfg.n * cfg.n).fill(-1);
  area.forEach((c, j) => (slot[c] = j));
  const step = Math.max(1, Math.ceil(hours / 240));
  const usable = new Uint16Array(area.length), sun = new Uint16Array(area.length), earth = new Uint16Array(area.length);
  let samples = 0;
  for (let h = 0; h < hours; h += step, samples++) {
    const s = sub(startMs + h * 3600e3);
    const ss = Math.sin(s.sunLat * RAD), sc = Math.cos(s.sunLat * RAD), sl = s.sunLon * RAD;
    const es = Math.sin(s.earthLat * RAD), ec = Math.cos(s.earthLat * RAD), el = s.earthLon * RAD;
    for (let j = 0; j < area.length; j++) {
      const v = cellUsable(area[j], ss, sc, sl, es, ec, el, s.dist);
      if (v & 1) sun[j]++;
      if (v & 2) earth[j]++;
      if (v === 3) usable[j]++;
    }
    if (samples % 20 === 0) ctx.postMessage({ type: "progress", id, value: h / hours });
  }
  let best: { i: number; u: number; s: number; e: number; slope: number } | null = null;
  for (const i of area) {
    const [x, y] = cellXY(i);
    if (Math.hypot(x - cx, y - cy) > radiusKm) continue;
    const foot = cellsWithin(x, y, footKm);
    let u = 0, su = 0, ea = 0, sl = 0, k = 0;
    for (const f of foot) {
      const j = slot[f];
      if (j < 0) continue;
      u += usable[j]; su += sun[j]; ea += earth[j]; sl += cellSlope[f]; k++;
    }
    if (!k || sl / k > slopeMaxDeg) continue;
    const cand = { i, u: u / k, s: su / k, e: ea / k, slope: sl / k };
    if (!best || cand.u > best.u || (cand.u === best.u && cand.s + cand.e > best.s + best.e)) best = cand;
  }
  if (!best) return null;
  const ll = cellLatLon(best.i);
  return {
    lat: ll.lat, lon: ll.lon, usablePct: (best.u / samples) * 100, sunlitPct: (best.s / samples) * 100,
    earthPct: (best.e / samples) * 100, slopeDeg: best.slope, cellsSearched: area.length,
  };
}

/**
 * Best ellipse centre and landing time over a date range for the whole region.
 * Stage 1: per-cell sliding mission window (samples every 3 h, landing times every 6 h), keeping each cell's best start.
 * Stage 2: the 60 best cells are re-scored by the footprint average (≈ the ellipse) at their best start.
 */
function searchGlobal(rangeStartMs: number, rangeEndMs: number, missionHours: number, footKm: number, slopeMaxDeg: number, id: number) {
  const SAMPLE_H = 3, START_EVERY = 2;
  const cand: number[] = [];
  for (let i = 0; i < cfg.n * cfg.n; i++) if (cellInCap[i] && cellSlope[i] <= slopeMaxDeg) cand.push(i);
  const W = Math.max(1, Math.round(missionHours / SAMPLE_H));
  const total = Math.floor((rangeEndMs - rangeStartMs) / (SAMPLE_H * 3600e3)) + W;
  const ring = new Uint8Array(cand.length * W);
  const sum = new Uint16Array(cand.length);
  const bestVal = new Int32Array(cand.length).fill(-1);
  const bestStart = new Int32Array(cand.length);
  const tsun = (i: number, s: ReturnType<typeof sub>, ss: number, sc: number, sl: number, es: number, ec: number, el: number) => {
    const [sEl, sAz] = cellSky(i, ss, sc, sl);
    if (sunFraction(sEl, horizonAt(horizon, i * HORIZON_DIRS, HORIZON_DIRS, sAz)) <= 0) return 0;
    const [eEl0, eAz] = cellSky(i, es, ec, el);
    return earthTopocentric(eEl0, s.dist) > horizonAt(horizon, i * HORIZON_DIRS, HORIZON_DIRS, eAz) ? 1 : 0;
  };
  for (let t = 0; t < total; t++) {
    const s = sub(rangeStartMs + t * SAMPLE_H * 3600e3);
    const ss = Math.sin(s.sunLat * RAD), sc = Math.cos(s.sunLat * RAD), sl = s.sunLon * RAD;
    const es = Math.sin(s.earthLat * RAD), ec = Math.cos(s.earthLat * RAD), el = s.earthLon * RAD;
    const slot = t % W;
    const startIdx = t - W + 1;
    const evaluate = startIdx >= 0 && startIdx % START_EVERY === 0;
    for (let j = 0; j < cand.length; j++) {
      const b = tsun(cand[j], s, ss, sc, sl, es, ec, el);
      const o = j * W + slot;
      sum[j] += b - ring[o];
      ring[o] = b;
      if (evaluate && sum[j] > bestVal[j]) { bestVal[j] = sum[j]; bestStart[j] = startIdx; }
    }
    if (t % 8 === 0) ctx.postMessage({ type: "progress", id, value: 0.9 * (t / total) });
  }
  // stage 2: footprint re-scoring of the top cells
  const order = Array.from(cand.keys()).sort((a, b) => bestVal[b] - bestVal[a]).slice(0, 60);
  let best: { i: number; start: number; u: number; slope: number } | null = null;
  order.forEach((j, q) => {
    const [x, y] = cellXY(cand[j]);
    const foot = cellsWithin(x, y, footKm);
    const slope = foot.reduce((a, f) => a + cellSlope[f], 0) / foot.length;
    if (slope > slopeMaxDeg) return;
    let u = 0;
    for (let w = 0; w < W; w++) {
      const s = sub(rangeStartMs + (bestStart[j] + w) * SAMPLE_H * 3600e3);
      const ss = Math.sin(s.sunLat * RAD), sc = Math.cos(s.sunLat * RAD), sl = s.sunLon * RAD;
      const es = Math.sin(s.earthLat * RAD), ec = Math.cos(s.earthLat * RAD), el = s.earthLon * RAD;
      for (const f of foot) u += tsun(f, s, ss, sc, sl, es, ec, el);
    }
    u /= foot.length * W;
    if (!best || u > best.u) best = { i: cand[j], start: bestStart[j], u, slope };
    if (q % 10 === 0) ctx.postMessage({ type: "progress", id, value: 0.9 + 0.1 * (q / order.length) });
  });
  if (!best) return null;
  const b = best as { i: number; start: number; u: number; slope: number };
  const ll = cellLatLon(b.i);
  return {
    lat: ll.lat, lon: ll.lon, landingMs: rangeStartMs + b.start * SAMPLE_H * 3600e3, usablePct: b.u * 100,
    slopeDeg: b.slope, cellsSearched: cand.length, timesTested: Math.ceil((total - W + 1) / START_EVERY),
  };
}

/* ---------------------------------------------------------------- messages */
ctx.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  try {
    if (m.type === "init") {
      ready = init(m as Init);
      await ready;
      ctx.postMessage({ type: "ready" });
      return;
    }
    await ready;
    if (m.type === "overview-hour") {
      const data = overviewHour(m.ms);
      ctx.postMessage({ type: "overview-hour", id: m.id, ms: m.ms, data }, [data.buffer]);
    } else if (m.type === "overview-window") {
      const data = overviewWindow(m.startMs, m.hours, m.step, m.id);
      ctx.postMessage({ type: "overview-window", id: m.id, data }, [data.buffer]);
    } else if (m.type === "ellipse") {
      const result = await analyseEllipse(m.ellipse, m.landingMs, m.hours, m.id);
      ctx.postMessage({ type: "ellipse", id: m.id, result });
    } else if (m.type === "search-nearby") {
      ctx.postMessage({ type: "search-nearby", id: m.id, result: searchNearby(m.cx, m.cy, m.radiusKm, m.footKm, m.startMs, m.hours, m.slopeMaxDeg, m.id) });
    } else if (m.type === "search-global") {
      ctx.postMessage({ type: "search-global", id: m.id, result: searchGlobal(m.rangeStartMs, m.rangeEndMs, m.missionHours, m.footKm, m.slopeMaxDeg, m.id) });
    } else if (m.type === "ellipse-hour") {
      const r = ellipseHour(m.ms);
      if (r) ctx.postMessage({ type: "ellipse-hour", id: m.id, ...r }, [r.data.buffer]);
      else ctx.postMessage({ type: "none", id: m.id });
    }
  } catch (e) {
    ctx.postMessage({ type: "error", id: m.id, message: (e as Error).message });
  }
};

export {};
