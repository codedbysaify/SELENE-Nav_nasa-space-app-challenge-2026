/**
 * Coordinate transforms between
 *   • planetocentric latitude / longitude (degrees, east-positive)
 *   • south-polar stereographic map coordinates (km) used by the PGDA GeoTIFFs
 *       +proj=stere +lat_0=-90 +lon_0=0 +R=1737400
 *   • the Three.js scene frame (km), scene = MOON_ME(Y, Z, X)
 *
 * The stereographic formulas were cross-checked against PROJ to 1e-12° in
 * scripts/process_lunar_data.py.
 */
import { MOON_RADIUS_KM as R, DEG } from "./lunar-config";

export interface LatLon {
  lat: number;
  lon: number;
}

/** Map (x, y) km → lat/lon degrees. */
export function stereoToLatLon(x: number, y: number): LatLon {
  const rho = Math.hypot(x, y);
  const lat = -(90 - (2 * Math.atan(rho / (2 * R))) / DEG);
  const lon = Math.atan2(x, y) / DEG;
  return { lat, lon };
}

/** lat/lon degrees → map (x, y) km. Valid for the southern hemisphere. */
export function latLonToStereo(lat: number, lon: number): { x: number; y: number } {
  const rho = 2 * R * Math.tan(((90 + lat) * DEG) / 2);
  return { x: rho * Math.sin(lon * DEG), y: rho * Math.cos(lon * DEG) };
}

/** Unit direction in scene frame for lat/lon. */
export function latLonToDir(lat: number, lon: number, out: [number, number, number] = [0, 0, 0]) {
  const cl = Math.cos(lat * DEG);
  out[0] = cl * Math.sin(lon * DEG);
  out[1] = Math.sin(lat * DEG);
  out[2] = cl * Math.cos(lon * DEG);
  return out;
}

/** Scene vector → lat/lon degrees. */
export function dirToLatLon(x: number, y: number, z: number): LatLon {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / r))) / DEG, lon: Math.atan2(x, z) / DEG };
}

/** Map (x, y) km → unit scene direction (rational form, smooth through the pole). */
export function stereoToDir(x: number, y: number, out: [number, number, number] = [0, 0, 0]) {
  const rho2 = x * x + y * y;
  const d = 4 * R * R + rho2;
  out[0] = (4 * R * x) / d;
  out[1] = -(4 * R * R - rho2) / d;
  out[2] = (4 * R * y) / d;
  return out;
}

/** Great-circle surface distance on the reference sphere, km. */
export function surfaceDistanceKm(a: LatLon, b: LatLon): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG;
  const dl = (b.lon - a.lon) * DEG;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatLat(lat: number, digits = 3): string {
  return `${Math.abs(lat).toFixed(digits)}°${lat < 0 ? "S" : "N"}`;
}

/** Longitude for display; at (or within 0.0005° of) a pole every meridian meets, so it has no meaning. */
export function formatLonAt(lat: number, lon: number, digits = 3): string {
  return Math.abs(lat) > 89.9995 ? "— (pole)" : formatLon(lon, digits);
}

export function formatLon(lon: number, digits = 3): string {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(l).toFixed(digits)}°${l < 0 ? "W" : "E"}`;
}
