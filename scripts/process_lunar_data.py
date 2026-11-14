#!/usr/bin/env python3
"""
SELENE-Nav — geospatial preprocessing of NASA LOLA South Pole products.

Reads the original GeoTIFFs in ``data/raw/`` (never modified) and writes
web-optimised derived assets to ``public/data/lunar/``.

Source products (PGDA product 90, Barker et al. 2023, PSJ 4:183):
    LDEM_80S_80MPP_ADJ.TIF       surface height, metres, relative to a 1737.4 km sphere
    LDEM_80S_80MPP_ADJ_HILL.TIF  hillshade (45° sun altitude, 45° azimuth), 0–255
    LDSM_80S_80MPP_ADJ.TIF       slope, degrees
    LPSR_80S_20MPP_ADJ.TIF       permanently-shadowed-region map, 0/1, 20 m/px
Global context (globe only; NASA SVS CGI Moon Kit, https://svs.gsfc.nasa.gov/4720):
    lroc_color_poles_4k.tif      LROC WAC colour mosaic, equirectangular
    ldem_16.tif                  LOLA global DEM, km relative to 1737.4 km, 16 px/deg

Coordinate system
-----------------
The PGDA products are south-polar stereographic grids
(+proj=stere +lat_0=-90 +lon_0=0 +R=1737400, MOON_ME / DE421). For a map
coordinate (x, y) in metres:

    rho = hypot(x, y)
    lat = -(90° - 2·atan(rho / 2R))         (planetocentric, degrees)
    lon = atan2(x, y)                       (east-positive, degrees)

This is verified at runtime against PROJ (pyproj) when it is installed.
Point scale factor of the projection: k = 2 / (1 + sin|lat|), so true ground
distance = map distance / k (≤ 0.77 % correction inside 80°S).

All derived products keep the source map frame: row 0 = +y (northing max),
column 0 = −x. Nothing is re-projected, so every texel and grid node keeps
its exact stereographic location; the browser performs the inverse projection
on the GPU/CPU with the same formulas.

Derived outputs (all resampling is documented in the metadata JSON)
-------------------------------------------------------------------
For each level of detail L in {low, high}:
    south-pole-height-<L>.i16    int16 little-endian metres, grid nodes at
                                 block centres (block-mean of 80 m DEM)
    south-pole-visual-<L>.webp   lossless RGB: R = NASA hillshade (block mean),
                                 G,B = surface normal x,y (map frame, true scale)
    south-pole-science-<L>.webp  lossless RGB: R = elevation (linear, see
                                 metadata), G = slope (deg·255/90), B = PSR
                                 fraction of 20 m pixels in the texel (0–255)
    south-pole-query-<L>.u8      uint8 interleaved [slope, psr] at the height
                                 grid resolution, for cursor read-outs
Global:
    moon-color-4k.webp           LROC colour (lossy, visual only)
    moon-normal-2k.webp          normals from LOLA global DEM (east, north, up)
    moon-height-1440.f16         float16 km, 1440×720 block mean of ldem_16
    south-pole-metadata.json     everything needed to interpret the above

Usage
-----
    python scripts/process_lunar_data.py [--raw data/raw] [--out public/data/lunar]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

R_MOON_M = 1737400.0

SOURCES = {
    "dem": "LDEM_80S_80MPP_ADJ.TIF",
    "hill": "LDEM_80S_80MPP_ADJ_HILL.TIF",
    "slope": "LDSM_80S_80MPP_ADJ.TIF",
    "psr": "LPSR_80S_20MPP_ADJ.TIF",
}
GLOBAL_SOURCES = {"color": "lroc_color_poles_4k.tif", "dem": "ldem_16.tif"}

# LOD definitions: block factors relative to the 80 m grid (7600 px).
#   mesh grid  — geometry nodes        texture — shading / layers
LODS = {
    "low": {"grid_factor": 20, "tex_factor": 8},   # 380² nodes @1.6 km, 950² tex @640 m
    "high": {"grid_factor": 8, "tex_factor": 2},   # 950² nodes @640 m, 3800² tex @160 m
}
SLOPE_SCALE = 255.0 / 90.0


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def block_mean(a: np.ndarray, f: int) -> np.ndarray:
    if f == 1:
        return a.astype(np.float32)
    h, w = a.shape
    assert h % f == 0 and w % f == 0, (a.shape, f)
    v = a.reshape(h // f, f, w // f, f)
    if np.isnan(a).any():
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            return np.nanmean(v, axis=(1, 3)).astype(np.float32)
    return v.mean(axis=(1, 3), dtype=np.float64).astype(np.float32)


def fill_nan(a: np.ndarray) -> tuple[np.ndarray, int]:
    """Fill NaNs by iterative neighbour averaging (only used if source has gaps)."""
    n = int(np.isnan(a).sum())
    a = a.copy()
    while np.isnan(a).any():
        m = np.isnan(a)
        p = np.pad(a, 1, mode="edge")
        nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            fill = np.nanmean(nb, axis=0)
        a[m] = fill[m]
    return a, n


def stereo_to_latlon(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    rho = np.hypot(x, y)
    lat = -(90.0 - np.degrees(2.0 * np.arctan(rho / (2.0 * R_MOON_M))))
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon


def sha256_head(path: Path, nbytes: int = 1 << 24) -> str:
    """Fast fingerprint: SHA-256 of size + first 16 MiB (full hashes live in MANIFEST.json)."""
    h = hashlib.sha256(str(path.stat().st_size).encode())
    with path.open("rb") as fh:
        h.update(fh.read(nbytes))
    return h.hexdigest()


def inspect(path: Path) -> dict:
    with rasterio.open(path) as ds:
        info = {
            "file": path.name,
            "width": ds.width, "height": ds.height, "dtype": ds.dtypes[0],
            "nodata": None if ds.nodata is None or np.isnan(ds.nodata) else float(ds.nodata),
            "nodata_is_nan": ds.nodata is not None and bool(np.isnan(ds.nodata)),
            "pixel_size_m": [ds.res[0], ds.res[1]],
            "bounds_m": list(ds.bounds),
            "transform": list(ds.transform)[:6],
            "crs_proj4": ds.crs.to_proj4() if ds.crs else None,
            "crs_wkt": ds.crs.to_wkt() if ds.crs else None,
            "overviews": ds.overviews(1),
            "band_tags": ds.tags(1),
        }
    log(f"  {path.name}: {info['width']}×{info['height']} {info['dtype']} "
        f"res={info['pixel_size_m'][0]} m nodata={'NaN' if info['nodata_is_nan'] else info['nodata']}")
    return info


def verify_projection(crs_wkt: str) -> dict:
    """Check our closed-form inverse projection against PROJ."""
    try:
        from pyproj import CRS, Transformer
    except ImportError:
        log("  pyproj not installed — skipping PROJ cross-check (formulas are standard)")
        return {"checked": False}
    t = Transformer.from_crs(CRS.from_wkt(crs_wkt),
                             CRS.from_proj4(f"+proj=longlat +R={R_MOON_M} +no_defs"), always_xy=True)
    rng = np.random.default_rng(0)
    x = rng.uniform(-304000, 304000, 2000)
    y = rng.uniform(-304000, 304000, 2000)
    lon_p, lat_p = t.transform(x, y)
    lat_m, lon_m = stereo_to_latlon(x, y)
    dlat = float(np.max(np.abs(lat_p - lat_m)))
    dlon = float(np.max(np.abs(((lon_p - lon_m) + 180) % 360 - 180)))
    log(f"  PROJ cross-check: max |Δlat|={dlat:.2e}°, max |Δlon|={dlon:.2e}° over 2000 points")
    if dlat > 1e-6 or dlon > 1e-6:
        raise SystemExit("Projection formulas disagree with PROJ — aborting")
    return {"checked": True, "max_dlat_deg": dlat, "max_dlon_deg": dlon, "n_points": 2000}


def normals_map_frame(h: np.ndarray, cell_m: float, x0: float, y0: float) -> np.ndarray:
    """Unit normals (nx, ny, nz) in the stereographic map frame (x east-ing, y north-ing, z up).

    Gradients use central differences; the map spacing is converted to true
    ground spacing using the stereographic point scale factor k.
    """
    n = h.shape[0]
    c = (np.arange(n) + 0.5) * cell_m
    xs = x0 + c
    ys = y0 - c  # row 0 = top (+y)
    X, Y = np.meshgrid(xs, ys)
    lat, _ = stereo_to_latlon(X, Y)
    k = 2.0 / (1.0 + np.sin(np.radians(-lat)))  # point scale factor
    ground = cell_m / k
    p = np.pad(h, 1, mode="edge")
    dzdx = (p[1:-1, 2:] - p[1:-1, :-2]) / (2.0 * ground)
    dzdy = (p[:-2, 1:-1] - p[2:, 1:-1]) / (2.0 * ground)  # +y is up the rows
    nz = 1.0 / np.sqrt(1.0 + dzdx**2 + dzdy**2)
    return np.stack([-dzdx * nz, -dzdy * nz, nz], axis=-1).astype(np.float32)


def enc_unit(v: np.ndarray) -> np.ndarray:
    return np.clip(np.round((v + 1.0) * 127.5), 0, 255).astype(np.uint8)


def save_webp(arr: np.ndarray, path: Path, lossless: bool = True, quality: int = 90) -> int:
    img = Image.fromarray(arr)
    if lossless:
        img.save(path, "WEBP", lossless=True, quality=80, method=4, exact=True)
    else:
        img.save(path, "WEBP", quality=quality, method=6)
    return path.stat().st_size


def read_psr_fractions(path: Path, factors: list[int]) -> dict[int, np.ndarray]:
    """Block-average the 20 m PSR map in strips (the full grid is 3.7 GB as float32)."""
    out: dict[int, np.ndarray] = {}
    with rasterio.open(path) as ds:
        H, W = ds.height, ds.width
        strip = 512 if H % 512 == 0 else 32 * max(factors)
        while H % strip:
            strip //= 2
        accs = {f: np.zeros((H // f, W // f), np.float32) for f in factors}
        nan_count = 0
        for r0 in range(0, H, strip):
            a = ds.read(1, window=((r0, r0 + strip), (0, W)))
            nanm = np.isnan(a)
            nan_count += int(nanm.sum())
            a = np.where(nanm, 0.0, a).astype(np.float32)
            for f in factors:
                if strip % f:
                    raise ValueError("strip must be divisible by PSR factor")
                accs[f][r0 // f:(r0 + strip) // f] = a.reshape(strip // f, f, W // f, f).mean(axis=(1, 3))
            if (r0 // strip) % 10 == 0:
                log(f"    PSR rows {r0:>6}/{H}")
        for f in factors:
            out[f] = accs[f]
    out["nan_count"] = nan_count  # type: ignore[index]
    return out


def psr_area_km2(path: Path) -> dict:
    """True PSR area within the 80°S cap, correcting the projection scale (k²)."""
    with rasterio.open(path) as ds:
        H, W = ds.height, ds.width
        res = ds.res[0]
        x0, y0 = ds.bounds.left, ds.bounds.top
        xs = x0 + (np.arange(W) + 0.5) * res
        total_psr = 0.0
        total_cap = 0.0
        n_psr_px = 0
        strip = 320  # 30400 = 95 × 320
        for r0 in range(0, H, strip):
            a = ds.read(1, window=((r0, r0 + strip), (0, W)))
            ys = y0 - (np.arange(r0, r0 + strip) + 0.5) * res
            X, Y = np.meshgrid(xs, ys)
            lat, _ = stereo_to_latlon(X, Y)
            k = 2.0 / (1.0 + np.sin(np.radians(-lat)))
            area = (res / k) ** 2 / 1e6
            cap = lat <= -80.0
            psr = (a > 0.5) & cap
            total_psr += float(area[psr].sum())
            total_cap += float(area[cap].sum())
            n_psr_px += int(psr.sum())
    return {"psr_area_km2": total_psr, "cap_area_km2": total_cap,
            "psr_fraction_of_cap": total_psr / total_cap, "psr_pixels_20m": n_psr_px}


def process_global(raw: Path, out: Path, meta: dict) -> None:
    log("Global context imagery (NASA SVS CGI Moon Kit)")
    cpath, dpath = raw / GLOBAL_SOURCES["color"], raw / GLOBAL_SOURCES["dem"]
    if not cpath.exists() or not dpath.exists():
        log("  ! global files missing — run the downloader without --no-global. Skipping.")
        meta["global"] = None
        return
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        rgb = rasterio.open(cpath).read().transpose(1, 2, 0)
        gdem = rasterio.open(dpath).read(1).astype(np.float64)  # km
    sz = save_webp(rgb, out / "moon-color-4k.webp", lossless=False, quality=90)
    log(f"  moon-color-4k.webp  {rgb.shape[1]}×{rgb.shape[0]}  {sz/1e6:.2f} MB")

    # Normals from the global DEM at 2880×1440 (block mean ×2 of 16 ppd → 8 ppd, 3.8 km/px)
    g2 = block_mean(gdem.astype(np.float32), 2).astype(np.float64) * 1000.0  # m
    H, W = g2.shape
    dlat = np.radians(180.0 / H)
    dlon = np.radians(360.0 / W)
    lat = np.radians(90.0 - (np.arange(H) + 0.5) * 180.0 / H)
    coslat = np.maximum(np.cos(lat), 0.02)[:, None]
    east = (np.roll(g2, -1, axis=1) - np.roll(g2, 1, axis=1)) / (2 * dlon * R_MOON_M * coslat)
    p = np.pad(g2, ((1, 1), (0, 0)), mode="edge")
    north = (p[:-2] - p[2:]) / (2 * dlat * R_MOON_M)
    nz = 1.0 / np.sqrt(1 + east**2 + north**2)
    nrm = np.stack([-east * nz, -north * nz, nz], -1)
    sz = save_webp(enc_unit(nrm), out / "moon-normal-2k.webp", lossless=False, quality=92)
    log(f"  moon-normal-2k.webp {W}×{H}  {sz/1e6:.2f} MB")

    g4 = block_mean(gdem.astype(np.float32), 4)  # 1440×720, km
    g4.astype("<f2").tofile(out / "moon-height-1440.f16")
    log(f"  moon-height-1440.f16 {g4.shape[1]}×{g4.shape[0]}  range {g4.min():.2f}…{g4.max():.2f} km")

    meta["global"] = {
        "source": "NASA Scientific Visualization Studio — CGI Moon Kit (public domain)",
        "source_url": "https://svs.gsfc.nasa.gov/4720",
        "projection": "equirectangular (simple cylindrical); column 0 west edge = 180°W, row 0 top edge = 90°N",
        "registration_check": "longitude registration verified against LDEM_80S_80MPP_ADJ at 81°S (see README)",
        "color": {"file": "moon-color-4k.webp", "width": int(rgb.shape[1]), "height": int(rgb.shape[0]),
                  "source": GLOBAL_SOURCES["color"], "encoding": "sRGB, lossy WebP q90 (visual only)"},
        "normal": {"file": "moon-normal-2k.webp", "width": W, "height": H,
                   "encoding": "RGB = (east, north, up) unit normal, v = byte/127.5 − 1",
                   "derived_from": GLOBAL_SOURCES["dem"] + " block-mean ×2 (8 px/deg)"},
        "height": {"file": "moon-height-1440.f16", "width": int(g4.shape[1]), "height": int(g4.shape[0]),
                   "dtype": "float16 little-endian", "units": "km relative to 1737.4 km sphere",
                   "derived_from": GLOBAL_SOURCES["dem"] + " block-mean ×4 (4 px/deg)",
                   "min_km": float(g4.min()), "max_km": float(g4.max())},
    }


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description="Process NASA LOLA South Pole data for SELENE-Nav")
    ap.add_argument("--raw", type=Path, default=root / "data" / "raw")
    ap.add_argument("--out", type=Path, default=root / "public" / "data" / "lunar")
    ap.add_argument("--skip-psr-area", action="store_true", help="skip the (slow) exact PSR area statistic")
    args = ap.parse_args(argv)
    raw, out = args.raw, args.out
    out.mkdir(parents=True, exist_ok=True)

    missing = [f for f in SOURCES.values() if not (raw / f).exists()]
    if missing:
        log(f"Missing source files in {raw}: {missing}\nRun: python scripts/download_lunar_data.py")
        return 1

    t0 = time.time()
    log("Inspecting sources")
    infos = {k: inspect(raw / f) for k, f in SOURCES.items()}
    ref = infos["dem"]
    for k, inf in infos.items():
        if inf["crs_proj4"] != ref["crs_proj4"] or inf["bounds_m"] != ref["bounds_m"]:
            raise SystemExit(f"{inf['file']} CRS/bounds differ from DEM — refusing to combine")
    proj_check = verify_projection(ref["crs_wkt"])

    x0, y1, x1, y0 = ref["bounds_m"][0], ref["bounds_m"][1], ref["bounds_m"][2], ref["bounds_m"][3]
    extent = x1 - x0
    base_px = ref["width"]
    base_res = ref["pixel_size_m"][0]
    psr_res = infos["psr"]["pixel_size_m"][0]
    psr_ratio = int(round(base_res / psr_res))  # 4

    log("Reading DEM, hillshade, slope (80 m)")
    with rasterio.open(raw / SOURCES["dem"]) as ds:
        dem = ds.read(1)
    dem, dem_filled = fill_nan(dem)
    with rasterio.open(raw / SOURCES["hill"]) as ds:
        hill = ds.read(1)
    with rasterio.open(raw / SOURCES["slope"]) as ds:
        slope = ds.read(1)
    slope, slope_filled = fill_nan(slope)
    hmin, hmax = float(dem.min()), float(dem.max())
    log(f"  DEM range {hmin:.1f} … {hmax:.1f} m (filled {dem_filled} NaN px); "
        f"slope {np.nanmin(slope):.2f} … {np.nanmax(slope):.2f}°")

    tex_factors = sorted({v["tex_factor"] for v in LODS.values()})
    grid_factors = sorted({v["grid_factor"] for v in LODS.values()})
    log(f"Block-averaging 20 m PSR map → factors {[f * psr_ratio for f in tex_factors + grid_factors]}")
    psr = read_psr_fractions(raw / SOURCES["psr"], sorted({f * psr_ratio for f in tex_factors + grid_factors}))

    lods_meta = {}
    for name, cfg in LODS.items():
        gf, tf = cfg["grid_factor"], cfg["tex_factor"]
        log(f"LOD '{name}': grid ×{gf}, textures ×{tf}")
        # ---- geometry grid (block-mean heights at block centres)
        g = block_mean(dem, gf)
        gn = g.shape[0]
        g_i16 = np.clip(np.round(g), -32767, 32767).astype("<i2")
        g_i16.tofile(out / f"south-pole-height-{name}.i16")
        # ---- query grid: slope + psr at grid resolution
        q_slope = np.clip(np.round(np.clip(block_mean(slope, gf), 0, 90) * SLOPE_SCALE), 0, 255).astype(np.uint8)
        q_psr = np.clip(np.round(psr[gf * psr_ratio] * 255), 0, 255).astype(np.uint8)
        np.stack([q_slope, q_psr], -1).tofile(out / f"south-pole-query-{name}.u8")
        # ---- textures
        t_h = block_mean(dem, tf).astype(np.float64)
        tn = t_h.shape[0]
        cell = extent / tn
        nrm = normals_map_frame(t_h, cell, x0, y0)
        t_hill = np.clip(np.round(block_mean(hill, tf)), 0, 255).astype(np.uint8)
        visual = np.dstack([t_hill, enc_unit(nrm[..., 0]), enc_unit(nrm[..., 1])])
        vs = save_webp(visual, out / f"south-pole-visual-{name}.webp")
        t_elev = np.clip(np.round((t_h - hmin) / (hmax - hmin) * 255), 0, 255).astype(np.uint8)
        t_slope = np.clip(np.round(np.clip(block_mean(slope, tf), 0, 90) * SLOPE_SCALE), 0, 255).astype(np.uint8)
        t_psr = np.clip(np.round(psr[tf * psr_ratio] * 255), 0, 255).astype(np.uint8)
        science = np.dstack([t_elev, t_slope, t_psr])
        ss = save_webp(science, out / f"south-pole-science-{name}.webp")
        log(f"  grid {gn}² ({extent/gn:.0f} m), textures {tn}² ({cell:.0f} m): "
            f"visual {vs/1e6:.1f} MB, science {ss/1e6:.1f} MB")
        lods_meta[name] = {
            "grid": {"file": f"south-pole-height-{name}.i16", "size": gn, "cell_m": extent / gn,
                     "dtype": "int16 little-endian", "units": "m relative to 1737.4 km sphere",
                     "node_location": "block centres", "row0": "+y (top)",
                     "resampling": f"block mean of {gf}×{gf} source pixels (80 m)",
                     "min_m": float(g.min()), "max_m": float(g.max())},
            "query": {"file": f"south-pole-query-{name}.u8", "size": gn, "layout": "interleaved [slope, psr]",
                      "slope_decode": f"deg = byte / {SLOPE_SCALE:.6f}", "psr_decode": "fraction = byte / 255"},
            "visual": {"file": f"south-pole-visual-{name}.webp", "size": tn, "cell_m": cell,
                       "channels": {"r": "NASA hillshade (LDEM_80S_80MPP_ADJ_HILL), block mean",
                                    "g": "normal x (map easting), v = byte/127.5 − 1",
                                    "b": "normal y (map northing), v = byte/127.5 − 1"},
                       "normal_source": f"central differences of block-mean DEM ({cell:.0f} m), "
                                        "corrected for stereographic scale factor"},
            "science": {"file": f"south-pole-science-{name}.webp", "size": tn, "cell_m": cell,
                        "channels": {"r": f"elevation: m = {hmin:.3f} + byte/255 × {hmax - hmin:.3f}",
                                     "g": f"slope (LDSM block mean): deg = byte / {SLOPE_SCALE:.6f}",
                                     "b": f"PSR fraction of 20 m pixels in texel ({tf * psr_ratio}×{tf * psr_ratio} block): byte/255"}},
        }

    psr_stats = None
    if not args.skip_psr_area:
        log("Computing exact PSR area inside 80°S (20 m, scale-corrected)")
        psr_stats = psr_area_km2(raw / SOURCES["psr"])
        log(f"  PSR area {psr_stats['psr_area_km2']:.0f} km² of cap {psr_stats['cap_area_km2']:.0f} km² "
            f"({100 * psr_stats['psr_fraction_of_cap']:.2f} %)")

    manifest_path = raw / "MANIFEST.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    meta = {
        "generator": "scripts/process_lunar_data.py",
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "body": {"name": "Moon", "reference_radius_m": R_MOON_M, "frame": "MOON_ME (JPL DE421)"},
        "projection": {
            "type": "polar stereographic (south)", "proj4": ref["crs_proj4"], "wkt": ref["crs_wkt"],
            "inverse": {"lat_deg": "-(90 - 2*atan(hypot(x,y) / (2R)))", "lon_deg": "atan2(x, y)"},
            "scale_factor": "k = 2 / (1 + sin|lat|)",
            "proj_cross_check": proj_check,
        },
        "extent_m": {"xmin": x0, "xmax": x1, "ymin": y1, "ymax": y0},
        "cap_radius_m_80S": 2 * R_MOON_M * np.tan(np.radians(5.0)),
        "elevation": {"min_m": hmin, "max_m": hmax, "units": "m relative to 1737.4 km sphere",
                      "nan_filled_px": dem_filled},
        "slope": {"units": "degrees", "nan_filled_px": slope_filled},
        "psr": {"definition": "LPSR_80S_20MPP_ADJ: 1 = permanently shadowed (Barker et al. 2023), 0 = not",
                "nan_px_treated_as_0": psr["nan_count"], "stats": psr_stats},  # type: ignore[index]
        "lods": lods_meta,
        "sources": {k: {**infos[k], "crs_wkt": None, "sha256": manifest.get(infos[k]["file"], {}).get("sha256"),
                        "url": manifest.get(infos[k]["file"], {}).get("url")} for k in infos},
        "references": {
            "paper": "Barker, M. K., et al. (2023). Planetary Science Journal, 4, 183.",
            "paper_doi": "https://doi.org/10.3847/PSJ/acf3e1",
            "data_doi": "https://doi.org/10.60903/gsfcpgda-lola-spole",
            "source": "https://pgda.gsfc.nasa.gov/products/90",
        },
    }
    process_global(raw, out, meta)
    (out / "south-pole-metadata.json").write_text(json.dumps(meta, indent=2, default=float) + "\n")
    log(f"Done in {time.time() - t0:.0f} s → {out}")
    for p in sorted(out.iterdir()):
        log(f"  {p.name:<34} {p.stat().st_size/1e6:7.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
