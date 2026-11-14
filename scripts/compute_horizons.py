#!/usr/bin/env python3
"""
SELENE-Nav — terrain horizons and Sun/Earth visibility from NASA LOLA data.

Outputs (public/data/lunar/):
  horizon-<N>.u8z         Horizon profile for every overview cell: N×N cells (row 0 = +y),
                          72 compass directions each (0° = north, 5° steps, clockwise via east),
                          1 byte per direction: angle_deg = byte × 0.15 − 8. Cell-major layout
                          [row][col][dir]. zlib-compressed.
  dem80/t_<r>_<c>.i16z    Full-resolution 80 m LOLA DEM tiles (int16 m, lossless 2-D predictor + zlib), for the 80 m
                          landing-ellipse analysis in the browser.
  annual-<year>.webp      Reference layers for one full year, lossless RGB:
                          R = sunlit fraction (0–255), G = Earth-visible fraction, B = longest
                          night in units of 4 h (0–255 → 0–1020 h).
  horizon-meta.json       Everything needed to decode the above.

Method
------
Horizon: from each cell, walk outward along the great circle in each compass direction
(steps grow ×1.05 from 0.9 km to 250 km), sample terrain height (LOLA 80°S DEM block-mean
640 m; outside the 80°S grid the SVS global LOLA DEM), and keep the maximum elevation
angle, including the Moon's curvature:
    elev = atan2(r1·cos δ − r0, r1·sin δ),  r = R + h,  δ = distance / R.
Directions use the local compass frame (north = away from the south pole); at the exact
pole north is the 0° meridian.

Sun/Earth (per hour, from ephemeris-hourly.f32):
    sin(el) = sin φ sin φb + cos φ cos φb cos(λ − λb)
    az      = atan2(sin Δλ cos φb, cos φ sin φb − sin φ cos φb cos Δλ)
    Earth parallax: el_topo = atan2(sin el − R/d, cos el)
    Sun disc radius 0.27°: visible fraction = clamp((el − horizon + 0.27) / 0.54, 0, 1)
    Earth visible when its centre is above the horizon.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import warnings
import zlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data" / "lunar"
R_KM = 1737.4
HALF_KM = 304.0
N_DIR = 72
ENC_SCALE, ENC_OFFSET = 0.15, -8.0
SUN_RADIUS_DEG = 0.27


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def predict_encode(tile: np.ndarray) -> bytes:
    """Lossless 2-D predictor (residual = h − (left + up − upper-left)), int16 little-endian.
    Decoder: a[r,c] = res + a[r,c-1] + a[r-1,c] − a[r-1,c-1] (first row/column: 1-D deltas)."""
    a = tile.astype(np.int32)
    res = a.copy()
    res[1:, 1:] = a[1:, 1:] - (a[1:, :-1] + a[:-1, 1:] - a[:-1, :-1])
    res[0, 1:] = a[0, 1:] - a[0, :-1]
    res[1:, 0] = a[1:, 0] - a[:-1, 0]
    assert np.abs(res).max() < 32768
    return res.astype("<i2").tobytes()


def block_mean(a, f):
    h, w = a.shape
    return a.reshape(h // f, f, w // f, f).mean(axis=(1, 3), dtype=np.float64).astype(np.float32)


class Terrain:
    """Height sampler (metres) in ME unit-vector space: polar DEM inside the grid, global DEM outside."""

    def __init__(self, polar_m: np.ndarray, global_km: np.ndarray):
        self.p = polar_m
        self.n = polar_m.shape[0]
        self.cell = 2 * HALF_KM / self.n
        self.g = global_km * 1000.0
        self.gh, self.gw = self.g.shape

    def sample(self, X, Y, Z):
        # unit vector (ME) → stereographic map (km)
        den = 1.0 - Z
        x = 2 * R_KM * Y / den
        y = 2 * R_KM * X / den
        col = (x + HALF_KM) / self.cell - 0.5
        row = (HALF_KM - y) / self.cell - 0.5
        inside = (col >= 0) & (col <= self.n - 1) & (row >= 0) & (row <= self.n - 1)
        h = np.empty_like(X)
        if inside.any():
            h[inside] = map_coordinates(self.p, [row[inside], col[inside]], order=1, mode="nearest")
        out = ~inside
        if out.any():
            lat = np.degrees(np.arcsin(np.clip(Z[out], -1, 1)))
            lon = np.degrees(np.arctan2(Y[out], X[out]))
            gr = (90 - lat) / 180 * self.gh - 0.5
            gc = ((lon + 180) / 360 * self.gw - 0.5) % self.gw
            h[out] = map_coordinates(self.g, [gr, gc], order=1, mode="wrap")
        return h


def cell_frames(n):
    cell = 2 * HALF_KM / n
    c = -HALF_KM + (np.arange(n) + 0.5) * cell
    x, y = np.meshgrid(c, HALF_KM - (np.arange(n) + 0.5) * cell)
    rho = np.hypot(x, y)
    lat = -(np.pi / 2 - 2 * np.arctan(rho / (2 * R_KM)))
    lon = np.arctan2(x, y)
    return x, y, lat, lon


def horizons(terrain: Terrain, lat, lon, h0, n_dir=N_DIR, d0=0.9, d1=250.0, grow=1.05, log_every=12):
    """Horizon angle (deg) per cell and direction → array [..., n_dir]."""
    cl, sl, co, so = np.cos(lat), np.sin(lat), np.cos(lon), np.sin(lon)
    U = np.stack([cl * co, cl * so, sl])
    E = np.stack([-so, co, np.zeros_like(so)])
    N = np.stack([-sl * co, -sl * so, cl])
    r0 = R_KM + h0 / 1000.0
    dists = [d0]
    while dists[-1] < d1:
        dists.append(dists[-1] * grow)
    out = np.empty(lat.shape + (n_dir,), np.float32)
    for k in range(n_dir):
        A = np.radians(k * 360.0 / n_dir)
        D = N * np.cos(A) + E * np.sin(A)
        best = np.full(lat.shape, -90.0, np.float64)
        for d in dists:
            dl = d / R_KM
            P = U * np.cos(dl) + D * np.sin(dl)
            r1 = R_KM + terrain.sample(P[0], P[1], P[2]) / 1000.0
            el = np.degrees(np.arctan2(r1 * np.cos(dl) - r0, r1 * np.sin(dl)))
            np.maximum(best, el, out=best)
        out[..., k] = best
        if (k + 1) % log_every == 0:
            log(f"    direction {k + 1}/{n_dir}")
    return out


def sky(lat, lon, blat, blon):
    """Elevation and azimuth (radians) of a body with sub-point (blat, blon) from (lat, lon)."""
    dl = blon - lon
    s = np.sin(lat) * np.sin(blat) + np.cos(lat) * np.cos(blat) * np.cos(dl)
    el = np.arcsin(np.clip(s, -1, 1))
    az = np.arctan2(np.sin(dl) * np.cos(blat), np.cos(lat) * np.sin(blat) - np.sin(lat) * np.cos(blat) * np.cos(dl))
    return el, az


def horizon_at(hz, az):
    """Linear interpolation of a [cells, n_dir] horizon table at azimuths az (radians) per cell."""
    f = (np.degrees(az) % 360.0) / (360.0 / hz.shape[1])
    i0 = np.floor(f).astype(np.int64) % hz.shape[1]
    i1 = (i0 + 1) % hz.shape[1]
    w = f - np.floor(f)
    idx = np.arange(hz.shape[0])
    return hz[idx, i0] * (1 - w) + hz[idx, i1] * w


def annual_stats(hz_flat, lat, lon, eph, start_idx, hours):
    n = hz_flat.shape[0]
    sun_sum = np.zeros(n)
    earth_sum = np.zeros(n)
    run = np.zeros(n, np.int32)
    longest = np.zeros(n, np.int32)
    for i in range(start_idx, start_idx + hours):
        slat, slon, elat, elon, dist = (np.radians(eph[i, 0]), np.radians(eph[i, 1]),
                                        np.radians(eph[i, 2]), np.radians(eph[i, 3]), eph[i, 4])
        el, az = sky(lat, lon, slat, slon)
        frac = np.clip((np.degrees(el) - horizon_at(hz_flat, az) + SUN_RADIUS_DEG) / (2 * SUN_RADIUS_DEG), 0, 1)
        sun_sum += frac
        dark = frac <= 0
        run = np.where(dark, run + 1, 0)
        np.maximum(longest, run, out=longest)
        el, az = sky(lat, lon, elat, elon)
        el = np.arctan2(np.sin(el) - R_KM / dist, np.cos(el))
        earth_sum += np.degrees(el) > horizon_at(hz_flat, az)
    return sun_sum / hours, earth_sum / hours, longest


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grid", type=int, default=475, help="overview cells per side (7600 / factor)")
    ap.add_argument("--year", type=int, default=2027, help="year for the annual reference layers")
    ap.add_argument("--skip-tiles", action="store_true")
    a = ap.parse_args(argv)

    t0 = time.time()
    log("Loading LOLA DEMs")
    with rasterio.open(RAW / "LDEM_80S_80MPP_ADJ.TIF") as ds:
        dem80 = ds.read(1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        gdem = rasterio.open(RAW / "ldem_16.tif").read(1).astype(np.float32)
    dem640 = block_mean(dem80, 8)
    terrain = Terrain(dem640, gdem)

    # ---------------- overview horizons
    n = a.grid
    f = dem80.shape[0] // n
    assert f * n == dem80.shape[0], "grid must divide 7600"
    x, y, lat, lon = cell_frames(n)
    h0 = block_mean(dem80, f).astype(np.float64)
    log(f"Horizons for {n}×{n} cells ({2 * HALF_KM / n * 1000:.0f} m), {N_DIR} directions")
    hz = horizons(terrain, lat, lon, h0)
    enc = np.clip(np.round((hz - ENC_OFFSET) / ENC_SCALE), 0, 255).astype(np.uint8)
    clipped = float(((hz - ENC_OFFSET) / ENC_SCALE > 255).mean())
    blob = zlib.compress(enc.tobytes(), 9)
    (OUT / f"horizon-{n}.u8z").write_bytes(blob)
    log(f"  horizon range {hz.min():.2f}…{hz.max():.2f}°, clipped {clipped * 100:.3f} %, "
        f"{len(blob) / 1e6:.1f} MB compressed")

    # ---------------- self-check: smooth-sphere horizon must be ~0 for a flat DEM
    flat = Terrain(np.zeros_like(dem640), np.zeros_like(gdem))
    hz_flat_test = horizons(flat, lat[::79, ::79], lon[::79, ::79], np.zeros_like(lat[::79, ::79]), n_dir=8, log_every=99)
    log(f"  flat-sphere check: max horizon {hz_flat_test.max():.4f}° (expect ≤ 0)")

    # ---------------- annual reference layers
    eph = np.fromfile(OUT / "ephemeris-hourly.f32", dtype="<f4").reshape(-1, 5)
    emeta = json.loads((OUT / "ephemeris-meta.json").read_text())
    e0 = datetime.fromisoformat(emeta["start_utc"].replace("Z", "+00:00"))
    ys = datetime(a.year, 1, 1, tzinfo=timezone.utc)
    start = int((ys - e0).total_seconds() // 3600)
    hours = int((datetime(a.year + 1, 1, 1, tzinfo=timezone.utc) - ys).total_seconds() // 3600)
    log(f"Annual statistics {a.year} ({hours} h)")
    hzf = (enc.reshape(-1, N_DIR).astype(np.float32) * ENC_SCALE + ENC_OFFSET)  # exactly what the browser sees
    sun, earth, longest = annual_stats(hzf, lat.ravel(), lon.ravel(), eph, start, hours)
    rgb = np.dstack([
        np.round(sun.reshape(n, n) * 255), np.round(earth.reshape(n, n) * 255),
        np.clip(np.round(longest.reshape(n, n) / 4), 0, 255),
    ]).astype(np.uint8)
    Image.fromarray(rgb).save(OUT / f"annual-{a.year}.webp", "WEBP", lossless=True, exact=True)
    cap = np.hypot(x, y) <= 2 * R_KM * np.tan(np.radians(5))
    log(f"  sunlit mean {sun.reshape(n, n)[cap].mean() * 100:.1f} %, max {sun.max() * 100:.1f} %; "
        f"Earth mean {earth.reshape(n, n)[cap].mean() * 100:.1f} %; longest night max {longest.max()} h")
    pole_i = n // 2
    log(f"  at 90°S cell: sunlit {sun.reshape(n, n)[pole_i, pole_i] * 100:.1f} %, "
        f"Earth {earth.reshape(n, n)[pole_i, pole_i] * 100:.1f} %, longest night {longest.reshape(n, n)[pole_i, pole_i]} h")

    # ---------------- 80 m DEM tiles for the ellipse analysis
    tile = 380
    tiles = []
    if not a.skip_tiles:
        tdir = OUT / "dem80"
        tdir.mkdir(exist_ok=True)
        total = 0
        nt = dem80.shape[0] // tile
        rcap = 2 * R_KM * np.tan(np.radians(5)) * 1000
        for r in range(nt):
            for c in range(nt):
                # skip tiles entirely outside the 80°S circle
                xs = np.array([c, c + 1]) * tile * 80 - HALF_KM * 1000
                ys_ = HALF_KM * 1000 - np.array([r, r + 1]) * tile * 80
                nearest = np.hypot(np.clip(0, xs.min(), xs.max()), np.clip(0, ys_.min(), ys_.max()))
                if nearest > rcap:
                    continue
                blk = np.round(dem80[r * tile:(r + 1) * tile, c * tile:(c + 1) * tile]).astype(np.int32)
                b = zlib.compress(predict_encode(blk), 9)
                (tdir / f"t_{r}_{c}.i16z").write_bytes(b)
                total += len(b)
                tiles.append([r, c])
        log(f"  {len(tiles)} DEM tiles ({tile}² px, {tile * 80 / 1000:.1f} km), {total / 1e6:.1f} MB total")

    meta = {
        "overview": {
            "file": f"horizon-{n}.u8z", "size": n, "cell_m": 2 * HALF_KM * 1000 / n,
            "directions": N_DIR, "layout": "zlib; uint8 [row][col][dir]; row 0 = +y; dir k = k·5° compass azimuth",
            "decode": f"deg = byte × {ENC_SCALE} + ({ENC_OFFSET})", "clipped_fraction": clipped,
            "observer": "ground level, block-mean height of the cell",
        },
        "method": {
            "march": "great circle, 0.9 → 250 km, step ×1.05", "terrain": "LOLA 80°S DEM block-mean 640 m; "
            "SVS LOLA global DEM (16 px/deg) outside the 80°S grid", "curvature": "exact (spherical, R = 1737.4 km)",
        },
        "annual": {"file": f"annual-{a.year}.webp", "year": a.year, "hours": hours,
                   "channels": {"r": "sunlit fraction (disc-weighted) × 255", "g": "Earth-visible fraction × 255",
                                "b": "longest continuous night (Sun fully hidden), hours / 4"}},
        "dem80": {"dir": "dem80", "tile_px": tile, "tile_km": tile * 0.08, "tiles": tiles,
                  "layout": "zlib; int16 LE residuals of a 2-D predictor (left + up − upper-left), metres; row 0 = top",
                  "name": "t_<row>_<col>.i16z; tile (0,0) starts at x = −304 km, y = +304 km"},
        "sun_radius_deg": SUN_RADIUS_DEG,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (OUT / "horizon-meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    log(f"Done in {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
