#!/usr/bin/env python3
"""
SELENE-Nav — hourly Sun / Earth geometry for the Moon (offline, precomputed).

For every hour in the range this writes the
    • sub-solar point  (lat, lon)  — where the Sun is at the zenith
    • sub-Earth point  (lat, lon)  — where Earth is at the zenith
    • Earth–Moon centre distance (km)  — for the topocentric parallax correction
in the lunar MOON_ME frame (the frame of the LOLA products, DE421 lunar
orientation). Longitudes are east-positive, −180…+180.

Sources (NASA/JPL NAIF generic kernels, downloaded once to data/kernels/):
    de440s.bsp                    planetary ephemeris (JPL DE440, used by JPL Horizons)
    moon_pa_de421_1900-2050.bpc   lunar orientation (principal axes), DE421
    moon_080317.tf                frame kernel defining MOON_ME_DE421

Validation (written into the metadata):
    • every overlapping hour vs NASA SVS "Moon Phase and Libration" mooninfo_2026.json
    • a few dates vs JPL Horizons (API, offline)
    • self-tests of the elevation formula (90° at the sub-points, pole identity)

The website never calls Horizons; it loads the small binary written here.

Usage:
    python scripts/compute_ephemeris.py [--start 2026-11-01] [--end 2036-01-01] [--no-horizons]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
KDIR = ROOT / "data" / "kernels"
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data" / "lunar"
NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KERNELS = {
    "de440s.bsp": NAIF + "spk/planets/de440s.bsp",
    "moon_pa_de421_1900-2050.bpc": NAIF + "pck/moon_pa_de421_1900-2050.bpc",
    "moon_080317.tf": NAIF + "fk/satellites/moon_080317.tf",
}
MOONINFO_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a005500/a005587/mooninfo_2026.json"
R_MOON = 1737.4


def fetch(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as r, tmp.open("wb") as f:
        if r.status != 200:
            raise RuntimeError(f"HTTP {r.status} for {url}")
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.replace(dest)
    return dest


def setup():
    from skyfield.api import load
    from skyfield.planetarylib import PlanetaryConstants

    for name, url in KERNELS.items():
        fetch(url, KDIR / name)
    ts = load.timescale()
    eph = load(str(KDIR / "de440s.bsp"))
    pc = PlanetaryConstants()
    pc.read_text(load(str(KDIR / "moon_080317.tf")))
    pc.read_binary(load(str(KDIR / "moon_pa_de421_1900-2050.bpc")))
    frame = pc.build_frame_named("MOON_ME_DE421")
    return ts, eph, frame


def subpoints(ts, eph, frame, t):
    out = {}
    for body in ("sun", "earth"):
        x, y, z = (eph[body] - eph["moon"]).at(t).frame_xyz(frame).km
        r = np.sqrt(x * x + y * y + z * z)
        out[body] = (np.degrees(np.arcsin(z / r)), np.degrees(np.arctan2(y, x)), r)
    return out


def elevation(lat, lon, blat, blon):
    """Your formula: elevation above the smooth (spherical) horizon, degrees."""
    p, b = np.radians(lat), np.radians(blat)
    s = np.sin(p) * np.sin(b) + np.cos(p) * np.cos(b) * np.cos(np.radians(lon - blon))
    return np.degrees(np.arcsin(np.clip(s, -1, 1)))


def dlon(a, b):
    return np.abs(((a - b) + 180.0) % 360.0 - 180.0)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2026-11-01")
    ap.add_argument("--end", default="2036-01-01")
    ap.add_argument("--no-horizons", action="store_true", help="skip the JPL Horizons spot check")
    a = ap.parse_args(argv)

    print("Loading NASA/JPL kernels")
    ts, eph, frame = setup()
    t0 = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    t1 = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc)
    n = int((t1 - t0).total_seconds() // 3600)
    hours = np.arange(n)
    t = ts.utc(t0.year, t0.month, t0.day, hours)
    print(f"Computing {n:,} hourly samples {a.start} → {a.end}")
    sp = subpoints(ts, eph, frame, t)
    table = np.stack([sp["sun"][0], sp["sun"][1], sp["earth"][0], sp["earth"][1], sp["earth"][2]], 1).astype("<f4")
    OUT.mkdir(parents=True, exist_ok=True)
    table.tofile(OUT / "ephemeris-hourly.f32")

    # ---------------- validation 1: NASA SVS mooninfo_2026.json
    val = {}
    mi = json.loads(fetch(MOONINFO_URL, RAW / "mooninfo_2026.json").read_text())
    mt = [datetime.strptime(e["time"], "%d %b %Y %H:%M UT") for e in mi]
    tm = ts.utc([x.year for x in mt], [x.month for x in mt], [x.day for x in mt], [x.hour for x in mt])
    sm = subpoints(ts, eph, frame, tm)  # same code path, evaluated at every hour of the NASA file
    g = lambda k, f: np.array([e[k][f] for e in mi])
    val["svs_mooninfo_2026"] = {
        "hours_compared": len(mi),
        "subsolar_max_dlat_deg": float(np.abs(sm["sun"][0] - g("subsolar", "lat")).max()),
        "subsolar_max_dlon_deg": float(dlon(sm["sun"][1], g("subsolar", "lon")).max()),
        "subearth_max_dlat_deg": float(np.abs(sm["earth"][0] - g("subearth", "lat")).max()),
        "subearth_max_dlon_deg": float(dlon(sm["earth"][1], g("subearth", "lon")).max()),
    }
    print("  vs NASA SVS mooninfo_2026:", val["svs_mooninfo_2026"])

    # ---------------- validation 2: JPL Horizons spot check (sub-observer = Earth, sub-solar)
    if not a.no_horizons:
        try:
            q = {
                "format": "text", "COMMAND": "'301'", "CENTER": "'500@399'", "MAKE_EPHEM": "'YES'",
                "EPHEM_TYPE": "'OBSERVER'", "START_TIME": "'2027-03-01'", "STOP_TIME": "'2033-03-01'",
                "STEP_SIZE": "'365d'", "QUANTITIES": "'14,15'", "ANG_FORMAT": "'DEG'",
            }
            txt = urllib.request.urlopen("https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(q),
                                         timeout=60).read().decode()
            rows = txt.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
            worst = 0.0
            for row in rows:
                parts = row.split()
                when = datetime.strptime(parts[0] + " " + parts[1], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc)
                elon, elat, slon, slat = map(float, parts[2:6])
                i = int((when - t0).total_seconds() // 3600)
                worst = max(worst, abs(table[i, 2] - elat), dlon(table[i, 3], elon), abs(table[i, 0] - slat),
                            dlon(table[i, 1], slon))
            val["jpl_horizons"] = {"dates_compared": len(rows), "max_diff_deg": float(worst)}
            print("  vs JPL Horizons:", val["jpl_horizons"])
        except Exception as e:  # noqa: BLE001
            print(f"  (Horizons check skipped: {e})")

    # ---------------- validation 3: self-tests of the elevation formula
    i = n // 2
    s_lat, s_lon, e_lat, e_lon = map(float, table[i, :4])
    tests = {
        "sun_at_subsolar_point_deg": float(elevation(s_lat, s_lon, s_lat, s_lon)),
        "earth_at_subearth_point_deg": float(elevation(e_lat, e_lon, e_lat, e_lon)),
        "pole_identity_max_err_deg": float(np.abs(elevation(-90.0, 0.0, table[:, 2], table[:, 3]) + table[:, 2]).max()),
        "earth_elev_at_pole_range_deg": [float(-table[:, 2].max()), float(-table[:, 2].min())],
        "sun_elev_at_pole_range_deg": [float(-table[:, 0].max()), float(-table[:, 0].min())],
    }
    assert abs(tests["sun_at_subsolar_point_deg"] - 90) < 1e-3 and abs(tests["earth_at_subearth_point_deg"] - 90) < 1e-3
    assert tests["pole_identity_max_err_deg"] < 1e-3
    val["self_tests"] = tests
    print("  self-tests:", tests)

    meta = {
        "file": "ephemeris-hourly.f32",
        "start_utc": t0.isoformat().replace("+00:00", "Z"),
        "step_hours": 1,
        "count": n,
        "fields": ["subsolar_lat_deg", "subsolar_lon_deg", "subearth_lat_deg", "subearth_lon_deg", "earth_distance_km"],
        "dtype": "float32 little-endian, row-major",
        "frame": "MOON_ME (DE421 lunar orientation), longitudes east-positive",
        "sources": {
            "planetary_ephemeris": "NASA JPL DE440 (de440s.bsp, NAIF)",
            "lunar_orientation": "NASA JPL DE421 lunar PA + moon_080317.tf (NAIF)",
            "library": "Skyfield",
        },
        "notes": "Geometric directions from the Moon's centre. The browser applies the Earth parallax correction "
                 "(R/d) and the terrain horizon.",
        "validation": val,
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (OUT / "ephemeris-meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"Wrote {OUT/'ephemeris-hourly.f32'} ({(OUT/'ephemeris-hourly.f32').stat().st_size/1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
