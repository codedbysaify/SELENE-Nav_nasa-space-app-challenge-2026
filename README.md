# SELENE-Nav — Lunar South Pole Landing-Site Planner

SELENE-Nav is a 3D visualization of the lunar South Pole built on NASA's Lunar
Orbiter Laser Altimeter (LOLA) data. It opens on the full Moon, marks both
poles, and flies the camera down to the South Pole. There you can explore the
real LOLA terrain and switch between elevation, hillshade, slope and
permanently-shadowed-region (PSR) layers.

> **Data reference** — Barker, M. K., et al. (2023). *Planetary Science Journal*, 4, 183.
> Paper DOI: <https://doi.org/10.3847/PSJ/acf3e1> ·
> NASA data DOI: <https://doi.org/10.60903/gsfcpgda-lola-spole> ·
> Source: <https://pgda.gsfc.nasa.gov/products/90>

**Mission planning workflow (v2).** Pick a landing date (any time from now to
2035), draw a landing ellipse on the South Pole (or pick a key location), and
SELENE-Nav reports:
* **Power:** Sun elevation versus the real terrain horizon, time until sunset or
  sunrise, sunlit %, and the longest night.
* **Communication:** Earth elevation versus the horizon, time until Earthset or
  Earthrise, and Earth-visible %.
* **Terrain:** slope and PSR fraction inside the ellipse.

A time slider animates live shadow and Earth-visibility maps on the 3D terrain.
All Sun/Earth data is precomputed offline from NASA/JPL ephemerides; the browser
never calls JPL Horizons.

---

## Quick start

The processed web assets are already in `public/data/lunar/`, so the app runs
without the original GeoTIFFs:

```bash
npm install
```

```bash
npm run dev            # http://localhost:3000
```

Production build:

```bash
npm run build && npm start
```

Add `?quality=low` to the URL to keep the lighter 1.6 km / 640 m level of detail.
This helps on low-power GPUs and software rendering.

## Rebuilding the data from NASA's originals

Requires Python ≥ 3.10.

```bash
pip install -r scripts/requirements.txt     # rasterio (bundles GDAL), numpy, pillow, pyproj
```

```bash
python scripts/download_lunar_data.py       # ≈ 650 MB → data/raw/
```

```bash
python scripts/process_lunar_data.py        # ≈ 2 min → public/data/lunar/
```

Then the Sun/Earth pipeline (needs `pip install skyfield scipy`):

```bash
python scripts/compute_ephemeris.py         # hourly Sun/Earth sub-points to 2035 (≈ 1.6 MB), validated
```

```bash
python scripts/compute_horizons.py          # terrain horizons, 80 m DEM tiles, 2027 reference maps (≈ 25 min)
```

### `scripts/compute_ephemeris.py`

For every hour from Nov 2026 to Dec 2035 it writes the **sub-solar** and
**sub-Earth** points (latitude, longitude) and the Earth–Moon distance to
`ephemeris-hourly.f32` (float32, 80,352 rows, 1.6 MB).

* **Positions:** NASA JPL DE440 (`de440s.bsp`).
* **Lunar orientation:** DE421 principal axes plus `moon_080317.tf`, in the
  MOON_ME frame that the LOLA products use.
* **Library:** Skyfield.
* **Kernels:** downloaded once from NAIF into `data/kernels/` (git-ignored).

Validation results are stored in `ephemeris-meta.json`:

| Check | Result |
| --- | --- |
| NASA SVS `mooninfo_2026.json`, all 8,760 hours | max 0.0063° (sub-solar lon), 0.0005° (sub-Earth) |
| JPL Horizons, 7 dates 2027–2033 | max 0.006° |
| Elevation formula at the sub-points | exactly 90° |
| Pole identity: Earth elevation at 90°S = −(sub-Earth latitude) | error < 1e-6° |

The Sun at 90°S stays within −1.58°…+1.59° of the smooth horizon, and Earth
within ±6.86°.

### `scripts/compute_horizons.py`

* **Terrain horizon:** from each cell of a 475 × 475 grid (1.28 km), it walks
  outward along great circles in 72 compass directions, at steps growing ×1.05
  from 0.9 km to 250 km. It samples the LOLA DEM (640 m), falling back to the SVS
  global DEM beyond the 80°S grid. It keeps the maximum elevation angle
  `atan2(r₁cos δ − r₀, r₁ sin δ)`, which includes exact curvature.
  * North means away from the pole (at the pole itself, the 0° meridian).
  * A flat-sphere self-test gives −0.015°, as expected.
  * Output: `horizon-475.u8z`, zlib, 1 byte per direction (0.15° steps, −8…+30°).
* **80 m DEM tiles** (`dem80/t_r_c.i16z`, 380 px ≈ 30 km each, zlib). The
  browser computes 80 m horizons inside the landing ellipse from these.
* **Annual reference layers** (`annual-2027.webp`): sunlit fraction,
  Earth-visible fraction and longest night for every hour of 2027, computed with
  the same rules as the browser:
  * Sun disc radius 0.27°, disc-weighted.
  * Earth parallax `atan2(sin el − R/d, cos el)`.
  * Earth counts as visible when its centre is above the horizon.

### `scripts/download_lunar_data.py`

Downloads, from `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/`:

| File | Size | Content |
| --- | --- | --- |
| `LDEM_80S_80MPP_ADJ.TIF` | 181 MB | Elevation (m, relative to 1737.4 km), 80 m/px |
| `LDEM_80S_80MPP_ADJ_HILL.TIF` | 85 MB | Hillshade (sun 45° altitude, 45° azimuth), 80 m/px |
| `LPSR_80S_20MPP_ADJ.TIF` | 148 MB | Permanently shadowed regions (0/1), 20 m/px |
| `LDSM_80S_80MPP_ADJ.TIF` | 231 MB | Slope (degrees), 80 m/px |

It also downloads two globe context files from the public-domain
[NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720): `lroc_color_poles_4k.tif`
(the LROC WAC colour mosaic) and `ldem_16.tif` (the LOLA global DEM). These are
used only for the full-Moon globe. Pass `--no-global` to skip them.

Downloader features:

* Streams to `*.part` files, so memory use stays constant.
* Shows a progress bar with rate and ETA.
* Times out stalled connections.
* Retries with exponential backoff.
* Resumes with HTTP `Range` requests. The PGDA server advertises `Accept-Ranges: bytes`.
* Checks the HTTP status, Content-Type, Content-Length and Content-Range.
* Validates each file: exact size, TIFF magic bytes, and a full GeoTIFF/CRS open with Rasterio.
* Records the SHA-256, size and Last-Modified of every file in `data/raw/MANIFEST.json`.

It skips files that are already present and valid. It never deletes or silently
replaces originals: an invalid file is moved aside as `*.invalid-<timestamp>`.

Useful flags: `--verify` (re-validate and re-hash against the manifest, no
download), `--only <FILE>`, `--out <dir>`, `--no-hash`. Exit code 1 means a file
failed. Re-running the script is always safe and resumes partial downloads.

### `scripts/process_lunar_data.py`

1. Inspects every source: CRS, geotransform, size, nodata, dtype and resolution.
   It refuses to combine grids whose CRS or bounds differ.
2. Checks the closed-form inverse projection against PROJ. The maximum error
   over 2,000 random points is 3e-13°.
3. Writes the derived assets to `public/data/lunar/` (≈ 37 MB):

| Output | Description |
| --- | --- |
| `south-pole-height-{low,high}.i16` | int16 metres. Block mean ×20 (1.6 km) / ×8 (640 m); nodes at block centres |
| `south-pole-visual-{low,high}.webp` | Lossless RGB: R = NASA hillshade, G/B = surface normal in the map frame |
| `south-pole-science-{low,high}.webp` | Lossless RGB: R = elevation, G = slope, B = PSR fraction. 640 m / 160 m |
| `south-pole-query-{low,high}.u8` | Slope and PSR at grid resolution, for the cursor read-outs |
| `moon-color-4k.webp`, `moon-normal-2k.webp`, `moon-height-1440.f16` | Globe colour, normals and global DEM (km) |
| `south-pole-metadata.json` | CRS/WKT, extents, encodings, value ranges, resampling, provenance, source hashes, PSR statistics |

The original TIFFs in `data/raw/` are read-only inputs. They are ignored by git
and never modified.

## Scientific notes

**Coordinate system.** The PGDA grids are south-polar stereographic
(`+proj=stere +lat_0=-90 +lon_0=0 +R=1737400`, MOON_ME frame, JPL DE421 ephemeris).
SELENE-Nav does **not** re-project or warp them. Every grid node keeps its
stereographic (x, y), and the inverse projection places it on the sphere:

```
lat = −(90° − 2·atan(ρ / 2R)),   lon = atan2(x, y),   ρ = hypot(x, y)
```

This happens in a Web Worker for the geometry, and per fragment in the shader
for surface orientation. The terrain therefore sits exactly on 80–90°S of the
globe. The scene frame is a fixed rotation of MOON_ME: scene (x, y, z) = MOON_ME (Y, Z, X).

**Units and resampling.** Heights are in metres relative to the 1737.4 km sphere.
All downsampling uses block means, with no interpolation. Surface normals are
computed from the DEM using the stereographic point-scale factor
k = 2 / (1 + sin|lat|), which is at most 0.77 % inside 80°S. On screen:

* Elevation read-outs are bilinear on the 640 m grid (1.6 km before the detail
  level loads).
* Slope and PSR read-outs use the nearest grid node.
* The read-out panel always names its source.

**PSRs.** The PSR layer is the published LPSR map: 20 m pixels averaged into a
coverage fraction per texel. It is never derived from image darkness. The
area statistic shown in the app was computed from the 20 m map with the
projection scale correction: 20,710 km², 7.19 % of 80–90°S.

**Slope** is shown as a physical quantity. The app makes no claim about landing
suitability.

**Vertical exaggeration** defaults to 2× and can be set from 1× (true scale) to
5×. It affects rendering only. The globe and the terrain use the same factor,
so they stay aligned. All displayed values are true LOLA values.

**Lighting.** The 3D sun direction can be adjusted and is illustrative. The real
Sun stays within about ±1.5° of the polar horizon. The Hillshade layer shows
NASA's baked 45°/45° hillshade.

**Global context.** The full-Moon globe uses the SVS CGI Moon Kit. The longitude
registration of `ldem_16.tif` was checked against the PGDA DEM at 81°S
(r = 0.9986, RMS 114 m). The globe is visual context only.

## Architecture

```
app/                      layout.tsx, page.tsx, globals.css (design tokens)
components/
  SeleneNavApp.tsx        page shell (WebGL scene loaded client-only)
  layout/                 TopBar, InformationPanel, AboutPanel (data & methods)
  lunar/                  MoonScene (Canvas), MoonSphere, SouthPoleTerrain,
                          PoleMarkers + PoleLabels, CameraController,
                          TerrainLayers (uniform animation), ExplorationControls, Starfield
  ui/                     LayerSelector (+ legends), LoadingIndicator, icons
hooks/                    useLunarData (progressive loader + data registry), useLunarCamera
lib/                      lunar-config, lunar-coordinates, terrain-loader,
                          terrain.worker (geometry builder), terrain-sampling,
                          shaders (GLSL + shared uniforms), store, frame-state
scripts/                  download_lunar_data.py, process_lunar_data.py
data/raw/                 original NASA GeoTIFFs (git-ignored)
public/data/lunar/        processed web assets
```

### Camera

The camera is parameterised relative to the pole by four values: distance D
(log-interpolated), tilt from the polar axis, azimuth about the axis, and a
bounded pan. The pan is a rotation about the Moon centre, at most 190 km and
zero at global range.

The look-at target slides from the Moon centre (global view) to 90°S (close
range). Because the target always stays on the polar axis, apart from the
bounded pan, you cannot navigate to an unrelated region. Other safeguards:

* Tilt stays at or below 84° at global range and 62° up close, so the pole never
  slips past the limb.
* A clearance check against the real LOLA heights stops the camera from entering
  the terrain.
* Near and far clip planes adapt to the camera's altitude.

Motion uses GSAP tweens (`flyToSouthPole`, `returnToGlobalView`, zoom, reset)
over exponential damping. Any user input cancels a running tween.

### Rendering

Both the globe and the terrain use custom shaders that share the sun, the
exaggeration and the lunar photometry (a Lommel–Seeliger/Lambert blend). The
handovers are dithered cross-fades, so no geometry pops in and there is no
transparency sorting:

* globe cap → low LOD
* low LOD → high LOD. The low LOD is then disposed.

From afar, the polar patch blends into the LROC mosaic. As you approach, the
selected data layer fades in. Layer changes are animated uniforms, so they never
interrupt the camera.

### Loading

1. Metadata.
2. Globe: about 5 MB. The Moon is interactive from here.
3. Low-res terrain: about 3 MB, geometry built in a Web Worker.
4. High-res terrain: about 31 MB. It loads lazily — when you approach, press
   Explore, or after 9 s idle.

The UI store is throttled to about 12 Hz, so React re-renders only the small
telemetry panels.

## Controls

| Action | Input |
| --- | --- |
| Rotate around the pole | drag (one finger on touch) |
| Tilt | drag vertically, or ↑ / ↓ |
| Zoom toward / away from 90°S | wheel, pinch, + / −, or the dock buttons |
| Pan within the 80°S region (close range) | right-drag or Shift + drag |
| Explore South Pole · Return to Global View · Reset | dock buttons |

## Limitations

* Finest geometry is 640 m node spacing and finest shading is 160 m texels; the
  source resolution is 80 m (DEM) and 20 m (PSR). Streaming the full-resolution
  tiles would need a quadtree tile pyramid.
* The illumination model is a simplified, illustrative directional sun.
  Shadows are not ray-traced, so dynamic shading is not a substitute for the
  illumination products.
* The globe outside 80°S uses the coarser SVS global mosaic and DEM (≈ 2.7 km and 7.6 km per pixel).
* Region-wide Sun/Earth maps use 1.28 km horizon cells. The exact 80 m analysis
  runs inside the drawn ellipse, which is thinned to ≤ 9,000 cells when very
  large.
* Horizons are at ground level (no mast height). The Sun is modelled as a
  uniform disc. Earth counts as visible when its centre is above the horizon; no
  antenna or link-budget model.
* The Artemis III regions are anchored at their namesake IAU features, because
  NASA publishes them only as a map. IM-2 and Chang'e-7 are noted as regions,
  not points.
* The high-res LOD (≈ 1.8 M triangles, two 3800² textures) is aimed at desktop
  GPUs. Use `?quality=low` on weak hardware.
