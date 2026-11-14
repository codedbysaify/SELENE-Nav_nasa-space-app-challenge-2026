/**
 * Key South Pole locations.
 * Coordinates: IAU Gazetteer of Planetary Nomenclature (USGS), centre lat/lon (planetocentric,
 * east-positive) and diameter, retrieved 2026-11.
 * Artemis III regions: names from NASA release 24-136 (28 Oct 2024). NASA publishes these
 * regions only as a map, so each is anchored at the IAU feature it is named after and marked
 * "approximate".
 */
export interface Site {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: "crater" | "mons" | "artemis";
  diameterKm?: number;
  note?: string;
  approximate?: boolean;
}

export const SITES: Site[] = [
  { id: "shackleton", name: "Shackleton", lat: -89.67, lon: 129.78, kind: "crater", diameterKm: 20.92,
    note: "Rim touches 90°S. CNSA's Chang'e-7 reportedly targets the Shackleton rim region." },
  { id: "spudis", name: "Spudis", lat: -89.51, lon: -84.61, kind: "crater", diameterKm: 13 },
  { id: "de-gerlache", name: "de Gerlache", lat: -88.48, lon: -88.34, kind: "crater", diameterKm: 32.71 },
  { id: "sverdrup", name: "Sverdrup", lat: -88.32, lon: -153.39, kind: "crater", diameterKm: 32.83 },
  { id: "shoemaker", name: "Shoemaker", lat: -88.14, lon: 45.91, kind: "crater", diameterKm: 51.82 },
  { id: "slater", name: "Slater", lat: -88.08, lon: 111.29, kind: "crater", diameterKm: 25.12 },
  { id: "haworth", name: "Haworth", lat: -87.45, lon: -5.17, kind: "crater", diameterKm: 51.42 },
  { id: "faustini", name: "Faustini", lat: -87.18, lon: 84.31, kind: "crater", diameterKm: 42.48 },
  { id: "mons-malapert", name: "Mons Malapert", lat: -85.98, lon: -1.67, kind: "mons", diameterKm: 67 },
  { id: "cabeus", name: "Cabeus", lat: -85.33, lon: -42.13, kind: "crater", diameterKm: 100.58,
    note: "LCROSS impact site (2009)." },
  { id: "nobile", name: "Nobile", lat: -85.28, lon: 53.27, kind: "crater", diameterKm: 79.27 },
  { id: "mons-mouton", name: "Mons Mouton", lat: -84.6, lon: 31.0, kind: "mons", diameterKm: 130,
    note: "Intuitive Machines IM-2 (Athena) landed in this region in March 2025." },
  { id: "amundsen", name: "Amundsen", lat: -84.44, lon: 83.07, kind: "crater", diameterKm: 103.39 },
  { id: "cabeus-b", name: "Cabeus B", lat: -82.26, lon: -54.58, kind: "crater", diameterKm: 59.62 },

  // NASA Artemis III candidate landing regions (Oct 2024), anchored at their namesake features
  { id: "a3-cabeus-b", name: "Peak near Cabeus B", lat: -82.26, lon: -54.58, kind: "artemis", approximate: true },
  { id: "a3-haworth", name: "Haworth", lat: -87.45, lon: -5.17, kind: "artemis", approximate: true },
  { id: "a3-malapert", name: "Malapert Massif", lat: -85.98, lon: -1.67, kind: "artemis", approximate: true },
  { id: "a3-mouton", name: "Mons Mouton + Plateau", lat: -84.6, lon: 31.0, kind: "artemis", approximate: true },
  { id: "a3-nobile", name: "Nobile Rim 1 & 2", lat: -85.28, lon: 53.27, kind: "artemis", approximate: true },
  { id: "a3-gerlache", name: "de Gerlache Rim 2", lat: -88.48, lon: -88.34, kind: "artemis", approximate: true },
  { id: "a3-slater", name: "Slater Plain", lat: -88.08, lon: 111.29, kind: "artemis", approximate: true },
];

/** One label per location: Artemis regions are merged into their anchor feature's label. */
export interface SiteLabel {
  key: string;
  name: string;
  lat: number;
  lon: number;
  kind: Site["kind"];
  artemis: string[];
  note?: string;
  diameterKm?: number;
}

export const SITE_LABELS: SiteLabel[] = (() => {
  const map = new Map<string, SiteLabel>();
  for (const s of SITES) {
    const key = `${s.lat},${s.lon}`;
    const cur = map.get(key);
    if (s.kind === "artemis") {
      if (cur) cur.artemis.push(s.name);
      else map.set(key, { key, name: s.name, lat: s.lat, lon: s.lon, kind: "artemis", artemis: [s.name] });
    } else if (cur) {
      Object.assign(cur, { name: s.name, kind: s.kind, note: s.note, diameterKm: s.diameterKm });
    } else {
      map.set(key, { key, name: s.name, lat: s.lat, lon: s.lon, kind: s.kind, artemis: [], note: s.note, diameterKm: s.diameterKm });
    }
  }
  return [...map.values()];
})();
