/**
 * SELENE-Nav global configuration.
 *
 * Scene units are KILOMETRES. The scene frame is a fixed rotation of the
 * lunar body-fixed MOON_ME frame:  scene (x, y, z) = MOON_ME (Y, Z, X)
 *   +y → north pole, +z → 0° lon (sub-Earth), +x → 90°E.
 */

export const MOON_RADIUS_KM = 1737.4; // IAU reference sphere used by LOLA products

/** Southern cap covered by the PGDA 80°S products. */
export const CAP_LAT_DEG = -80;
/** Stereographic radius of the 80°S parallel: 2R·tan(5°). */
export const CAP_RADIUS_KM = 2 * MOON_RADIUS_KM * Math.tan((5 * Math.PI) / 180);
/** Half-width of the square stereographic grid (from GeoTIFF bounds). */
export const GRID_HALF_EXTENT_KM = 304;

export const DATA_BASE = "/data/lunar";
export const METADATA_URL = `${DATA_BASE}/south-pole-metadata.json`;

export const DEG = Math.PI / 180;

export const CAMERA = {
  fovDeg: 38,
  /** Distance of camera from the South Pole surface point. */
  minDistanceKm: 38,
  exploreDistanceKm: 520,
  globalDistanceKm: 3.55 * MOON_RADIUS_KM,
  maxDistanceKm: 4.3 * MOON_RADIUS_KM,
  /** Below this distance the look-at target is the pole itself, above `globalBlendEnd` the Moon centre. */
  poleFocusStartKm: 0.32 * MOON_RADIUS_KM,
  poleFocusEndKm: 2.2 * MOON_RADIUS_KM,
  /** Tilt from the polar axis (0 = looking straight up at the south pole from below). */
  tiltGlobalMinDeg: 0,
  tiltGlobalMaxDeg: 84, // beyond ~86° the pole would slip behind the limb
  tiltCloseMaxDeg: 62,
  initialTiltDeg: 56,
  exploreTiltDeg: 40,
  /** Azimuth 90° places the camera over 0° longitude (Earth-facing side). */
  initialAzimuthDeg: 90,
  /** Pan is a rotation of the rig about the Moon centre, limited inside the 80°S cap. */
  maxPanKm: 190,
  minClearanceKm: 6,
  damping: 7.5,
} as const;

export type BaseLayer = "hillshade" | "elevation" | "slope";

export const BASE_LAYERS: { id: BaseLayer; label: string; hint: string }[] = [
  { id: "hillshade", label: "Hillshade", hint: "NASA LDEM hillshade (sun 45° alt, 45° az)" },
  { id: "elevation", label: "Elevation", hint: "LDEM height relative to 1737.4 km" },
  { id: "slope", label: "Slope", hint: "LDSM surface slope, degrees" },
];

export const SUN_DEFAULT = { azimuthDeg: 146, elevationDeg: 16 };
export const EXAGGERATION_DEFAULT = 2;
export const EXAGGERATION_RANGE: [number, number] = [1, 5];

/** Shared colours (kept in sync with app/globals.css). */
export const COLORS = {
  accent: "#5ec8d8",
  accentBlue: "#6b8cff",
  gold: "#d9b26f",
  psr: "#a879ff",
} as const;

export const REFERENCES = {
  paper: "Barker, M. K., et al. (2023). Planetary Science Journal, 4, 183.",
  paperDoi: "https://doi.org/10.3847/PSJ/acf3e1",
  dataDoi: "https://doi.org/10.60903/gsfcpgda-lola-spole",
  source: "https://pgda.gsfc.nasa.gov/products/90",
  globe: "https://svs.gsfc.nasa.gov/4720",
} as const;
