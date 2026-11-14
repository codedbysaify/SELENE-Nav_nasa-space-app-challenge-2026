# SELENE-Nav — How it works (current build + next update)

This document explains what SELENE-Nav is, what has been built so far, how each
part works, and what the next update adds. It is written for the team, so it
explains the *why* as well as the *what*.

---

## 1. The problem we are solving

NASA Space Apps challenge: help mission planners, educators and the public
**compare lunar landing sites and dates quickly**, by showing where the **Sun**
and **Earth** are relative to the local horizon:

- **Sun above the horizon** → solar power and warmth.
- **Earth above the horizon** → direct-to-Earth radio contact (no relay satellite).

At the lunar South Pole this is extreme: the Sun never rises more than about
1.6° above a flat horizon, Earth bobs up and down by about ±7° each month, and
mountains and crater rims block both. Moving a few kilometres or a few days can
change a site from "always lit, always in contact" to "dark and silent".

Existing tools (NASA Quickmap, Moon Trek, JPL Horizons) have this information
but are built for specialists. SELENE-Nav's goal: **pick a date → draw a landing
ellipse → instantly see power and communication conditions.**

---

## 2. What is built today (version 1)

### 2.1 Data pipeline (Python, runs offline)

**Downloader — `scripts/download_lunar_data.py`**

Downloads the four NASA LOLA South Pole products from NASA's Planetary Geodesy
Data Archive (PGDA, product 90; Barker et al. 2023):

| File | What it is | Resolution |
|---|---|---|
| `LDEM_80S_80MPP_ADJ.TIF` | Elevation (height in metres) | 80 m per pixel |
| `LDEM_80S_80MPP_ADJ_HILL.TIF` | Hillshade (shaded relief image) | 80 m |
| `LDSM_80S_80MPP_ADJ.TIF` | Slope in degrees | 80 m |
| `LPSR_80S_20MPP_ADJ.TIF` | Permanently shadowed regions (yes/no) | 20 m |

Plus two files for the full-Moon globe from NASA's Scientific Visualization
Studio (CGI Moon Kit): a colour photo mosaic and a global elevation map.

How it works: it streams each file to disk in 1 MB pieces (so memory stays
small), shows progress, retries on network errors, resumes broken downloads,
checks the file size and that it really is a GeoTIFF, and records a SHA-256
fingerprint of every file in `data/raw/MANIFEST.json`. It never overwrites a
good original.

**Processor — `scripts/process_lunar_data.py`**

The raw files are 650 MB and use a special map projection, so the browser
cannot use them directly. The processor:

1. **Reads the projection.** The data is a *south-polar stereographic* map:
   the pole is the centre, and (x, y) are kilometres on a flat plane. The
   formulas to turn (x, y) into latitude/longitude are:
   `lat = −(90° − 2·atan(ρ / 2R))`, `lon = atan2(x, y)`, with ρ = distance
   from the pole and R = 1737.4 km. These were checked against the PROJ
   library (error 0.0000000000003°).
2. **Shrinks the data** by averaging blocks of pixels (no invented values):
   - a *low* level (1.6 km geometry, 640 m images) that loads fast,
   - a *high* level (640 m geometry, 160 m images) for close-up viewing.
3. **Computes surface normals** (which way each bit of ground faces) for
   realistic lighting.
4. **Packs layers into images:** one image holds hillshade + normals, another
   holds elevation + slope + PSR coverage.
5. **Computes a real statistic:** PSRs cover 20,710 km², 7.19 % of 80–90°S.
6. Writes everything (≈ 37 MB) to `public/data/lunar/`, plus a JSON file
   describing units, encodings and sources.

### 2.2 The web app (Next.js + React + Three.js)

**Scene and coordinates.** Units are kilometres. The Moon's north pole points
up (+y); 0° longitude faces the starting camera.

**Global Moon — `MoonSphere.tsx`.** A sphere textured with NASA's colour mosaic.
A custom shader raises or lowers each point using NASA's global elevation map,
and shades it with the same lighting model used for the polar terrain.

**South Pole terrain — `SouthPoleTerrain.tsx` + `terrain.worker.ts`.**
- A *Web Worker* (background thread, so the page never freezes) converts the
  elevation grid into a 3D mesh. Each grid point keeps its exact stereographic
  position and is placed on the sphere with the inverse projection, so the
  terrain sits exactly on 80–90°S.
- The globe stops at 80°S and the terrain mesh takes over. The handover is a
  "dithered cross-fade": each pixel is drawn by exactly one surface, so there
  is no popping or flickering.
- When the detailed level arrives, it fades in the same way and the coarse
  level is deleted from memory.

**Layers — `TerrainLayers.tsx` + `shaders.ts`.**
Hillshade, Elevation and Slope base layers, plus the PSR overlay. Colours are
computed on the graphics card from the packed images. Switching layers is a
smooth fade.

**Camera — `CameraController.tsx`.**
The camera is described relative to the South Pole: distance, tilt, rotation
around the pole, and a small limited pan. The look-at point slides from the
Moon's centre (global view) to the pole (close view), so the user can never
fly to an unrelated region. A safety check uses real LOLA heights so the camera
never goes underground. "Explore South Pole" and "Return to Global View" are
smooth animations (GSAP).

**Interface.**
- Top bar: SELENE-Nav name, view mode and data status.
- Layers panel (left), telemetry panel (right): latitude, longitude, elevation,
  slope and PSR at the view centre and under the mouse cursor, with the data
  source named.
- Bottom dock: Explore, Return, Zoom +/−, Reset.
- Pole labels: SOUTH POLE (primary target), NORTH POLE (reference, shown at the
  edge of the disc when it is behind the Moon).
- "Data & methods" panel with references.

**Loading order:** metadata → globe (≈ 5 MB, Moon usable) → coarse terrain
(≈ 3 MB) → detailed terrain (≈ 31 MB, loaded only when needed).

### 2.3 What version 1 does NOT do yet
- No real Sun or Earth positions. The sun direction is a manual "illustrative"
  slider.
- No dates, no landing sites, no landing ellipse.
- No power or communication metrics.

Version 2 (below) adds all of this.

---

## 3. Version 2 (implemented)

### 3.1 Sun and Earth positions for any date (Python, offline)

**Key idea:** for every hour we only need two points on the Moon:
- the **sub-solar point**: where the Sun is straight overhead,
- the **sub-Earth point**: where Earth is straight overhead,

plus the Earth–Moon distance.

**Source:** NASA JPL's DE421 ephemeris (positions of Sun, Earth and Moon) and
the Moon's orientation file, read with the Skyfield Python library. DE421 is
the same reference the LOLA terrain uses (MOON_ME frame).
**Range:** today → end of 2035, hourly (about 80,000 rows, about 1.5 MB).

**Checks:**
- compare every 2026 hour with NASA SVS `mooninfo_2026.json`,
- spot-check a few dates against JPL Horizons (offline only),
- Earth must be at 90° at the sub-Earth point; the Sun at 90° at the sub-solar
  point,
- at the exact pole, Earth elevation must equal −(sub-Earth latitude).

The website **never calls Horizons**. It just loads this small file.

### 3.2 Sun and Earth in the sky of any spot

For a spot at latitude φ, longitude λ, and a body whose sub-point is (φb, λb):

- **Elevation** (angle above a flat horizon):
  `sin(el) = sin φ · sin φb + cos φ · cos φb · cos(λ − λb)`
- **Earth parallax correction** (we stand on the surface, not at the Moon's
  centre): `el_topo = atan2(sin(el) − R/d, cos(el))`, d = Earth distance.
  This shifts Earth by up to 0.26°.
- **Azimuth** (compass direction, 0° = north, 90° = east):
  `az = atan2(sin(Δλ)·cos φb, cos φ·sin φb − sin φ·cos φb·cos Δλ)`
- **Disc sizes:** the Sun is 0.27° in radius. Fully lit if
  `el − 0.27° > horizon`; partly lit if `el + 0.27° > horizon`.
  Earth counts as visible when its centre is above the horizon.

### 3.3 The terrain horizon

The Moon has no atmosphere, so the horizon is simply terrain: for each compass
direction, how high (in degrees) does the land rise when you look that way?

**How it is computed:** from each spot, walk outward along a direction, up to
about 150 km. At each step, compute the angle to that terrain point (taking the
Moon's curvature into account, which makes far terrain drop away). The highest
angle found is the horizon in that direction. Steps grow by ×1.05 each time, so
nearby terrain is checked in fine detail and far terrain in coarse detail.

- **Whole region:** 512 × 512 grid (about 1.2 km cells), 72 directions (every
  5°). Saved as "horizon profiles": 1 byte per direction per cell.
- **Inside your landing ellipse:** full LOLA 80 m detail, computed in the
  browser in a background worker, using small 80 m terrain tiles loaded only
  around the ellipse. The ellipse centre gets 360 directions.

**Why store horizon profiles:** with a cell's horizon profile and the Sun's
position, the browser can decide "lit or dark" for *any* hour instantly. That is
what makes the live time slider possible with small files.

### 3.4 The numbers (per cell and per ellipse)
- **Sunlit %** = hours with the Sun visible ÷ total hours.
- **Longest night** = longest run of hours without the Sun.
- **Earth visible %** = hours with Earth visible ÷ total hours.
- **Time until sunset / Earthset** from the chosen landing time.
- Inside the ellipse: % of the area sunlit and in Earth contact, mean and
  maximum slope, PSR fraction.

### 3.5 The new user flow
1. **Pick the date:** landing date and time (today → 2035, UTC) and mission
   length (default 14 days).
2. **Draw the landing ellipse:** the camera flies to the South Pole, and the
   app asks you to draw. Click the centre and drag for length and direction; a
   handle sets the width. You can also type exact values.
3. **Read the results:** conditions at landing, over the mission, charts of
   Sun and Earth elevation versus the horizon, and a 360° horizon panorama.
4. **Scrub time:** a slider with play/pause shows a live shadow map and
   Earth-visibility map on the 3D terrain.

### 3.6 Other changes
- Key locations marked on the map: major craters, Malapert Massif, Mons Mouton,
  Connecting Ridge, NASA's Artemis III candidate regions, IM-2, the Chang'e-7
  target. Coordinates come only from official sources. Clicking a marker
  selects it as the ellipse centre.
- New map layers: Sunlit %, Earth visible %, Longest night.
- The "illustrative sun" sliders are removed: lighting follows the real date.
- A permanent footer credits every data source.

---

## 4. Data sources (credited in the app footer)
- NASA LOLA South Pole products, PGDA product 90 — Barker et al. (2023),
  PSJ 4:183, doi:10.3847/PSJ/acf3e1; data doi:10.60903/gsfcpgda-lola-spole
- NASA SVS Moon Phase and Libration (`mooninfo`) — svs.gsfc.nasa.gov
- NASA SVS CGI Moon Kit (globe imagery) — svs.gsfc.nasa.gov/4720
- NASA JPL DE421 ephemeris and lunar orientation (NAIF); JPL Horizons for
  verification
- IAU Gazetteer of Planetary Nomenclature (feature names and coordinates)

## 5. Known limitations
- Whole-region maps use 1.2 km cells; the exact 80 m analysis is inside the
  drawn ellipse.
- The ellipse uses 80 m terrain nearby and coarser terrain far away for the
  horizon.
- No thermal model, no rover or lander height above the ground (horizon is
  computed at ground level).
