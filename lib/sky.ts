/**
 * Sun / Earth geometry on the Moon — shared by the main thread and the planning worker.
 * Same formulas as scripts/compute_horizons.py (the Python reference).
 *
 *   sin(el) = sin φ sin φb + cos φ cos φb cos(λ − λb)
 *   az      = atan2(sin Δλ cos φb, cos φ sin φb − sin φ cos φb cos Δλ)   (0 = north, 90° = east)
 *   Earth parallax (observer on the surface): el' = atan2(sin el − R/d, cos el)
 */
export const MOON_R_KM = 1737.4;
export const SUN_RADIUS_DEG = 0.27;
export const HORIZON_DIRS = 72;
export const HORIZON_SCALE = 0.15;
export const HORIZON_OFFSET = -8;
export const RAD = Math.PI / 180;

export interface Subpoints {
  sunLat: number; // degrees
  sunLon: number;
  earthLat: number;
  earthLon: number;
  earthDistKm: number;
}

export interface SkyPos {
  el: number; // degrees
  az: number; // degrees 0–360
}

export function skyPosition(latDeg: number, lonDeg: number, bLatDeg: number, bLonDeg: number): SkyPos {
  const p = latDeg * RAD, b = bLatDeg * RAD, dl = (bLonDeg - lonDeg) * RAD;
  const s = Math.sin(p) * Math.sin(b) + Math.cos(p) * Math.cos(b) * Math.cos(dl);
  const el = Math.asin(Math.max(-1, Math.min(1, s)));
  const az = Math.atan2(Math.sin(dl) * Math.cos(b), Math.cos(p) * Math.sin(b) - Math.sin(p) * Math.cos(b) * Math.cos(dl));
  return { el: el / RAD, az: ((az / RAD) % 360 + 360) % 360 };
}

export function earthTopocentric(elDeg: number, distKm: number): number {
  const e = elDeg * RAD;
  return Math.atan2(Math.sin(e) - MOON_R_KM / distKm, Math.cos(e)) / RAD;
}

/** Visible fraction of the solar disc (linear approximation over ±0.27°). */
export function sunFraction(elDeg: number, horizonDeg: number): number {
  return Math.max(0, Math.min(1, (elDeg - horizonDeg + SUN_RADIUS_DEG) / (2 * SUN_RADIUS_DEG)));
}

/** Interpolated horizon angle (deg) from a profile with `dirs` equally spaced compass directions. */
export function horizonAt(profile: ArrayLike<number>, offset: number, dirs: number, azDeg: number, decode = true): number {
  const f = (((azDeg % 360) + 360) % 360) / (360 / dirs);
  const i0 = Math.floor(f) % dirs, i1 = (i0 + 1) % dirs, w = f - Math.floor(f);
  const v = profile[offset + i0] * (1 - w) + profile[offset + i1] * w;
  return decode ? v * HORIZON_SCALE + HORIZON_OFFSET : v;
}

/** Stereographic map (km) ↔ lat/lon (deg), +proj=stere +lat_0=-90 +lon_0=0 +R=1737.4 km. */
export function mapToLatLon(x: number, y: number): { lat: number; lon: number } {
  const rho = Math.hypot(x, y);
  return { lat: -(90 - (2 * Math.atan(rho / (2 * MOON_R_KM))) / RAD), lon: Math.atan2(x, y) / RAD };
}
export function latLonToMap(lat: number, lon: number): { x: number; y: number } {
  const rho = 2 * MOON_R_KM * Math.tan(((90 + lat) * RAD) / 2);
  return { x: rho * Math.sin(lon * RAD), y: rho * Math.cos(lon * RAD) };
}

/** Map-plane unit vectors of local north and east at (x, y). At the pole: north = +y (0° meridian), east = +x. */
export function localAxes(x: number, y: number) {
  const rho = Math.hypot(x, y);
  const lon = rho < 1e-9 ? 0 : Math.atan2(x, y);
  return { north: [Math.sin(lon), Math.cos(lon)] as const, east: [Math.cos(lon), -Math.sin(lon)] as const };
}
