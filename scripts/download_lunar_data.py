#!/usr/bin/env python3
"""
SELENE-Nav — NASA LOLA South Pole dataset downloader.

Downloads the four LOLA 80°S products used by SELENE-Nav from NASA's
Planetary Geodesy Data Archive (PGDA), product 90:

    https://pgda.gsfc.nasa.gov/products/90
    Barker et al. (2023), PSJ 4, 183 — doi:10.3847/PSJ/acf3e1
    Data DOI: doi:10.60903/gsfcpgda-lola-spole

Features
--------
* Streaming downloads (constant memory) into ``<name>.part`` temp files.
* Resume via HTTP ``Range`` when the server advertises ``Accept-Ranges: bytes``.
* Retries with exponential backoff, connect/read timeouts.
* HTTP response validation (status, content-type, content-length, Content-Range).
* Integrity checks: exact size vs. server Content-Length, TIFF magic bytes,
  and — if Rasterio is installed — a full GeoTIFF header/CRS open.
* Skips files that already exist and validate; never overwrites a valid
  original. A file that fails validation is moved aside (``.invalid``) rather
  than deleted, so original scientific data is never silently replaced.
* Writes ``data/raw/MANIFEST.json`` with size, Last-Modified, and SHA-256.

Usage
-----
    python scripts/download_lunar_data.py              # download all
    python scripts/download_lunar_data.py --only LDEM_80S_80MPP_ADJ.TIF
    python scripts/download_lunar_data.py --verify     # validate only, no network writes
    python scripts/download_lunar_data.py --out data/raw

Only the Python standard library is required (Rasterio is optional and used
for deeper validation when available).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import socket
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
PRODUCT_PAGE = "https://pgda.gsfc.nasa.gov/products/90"


@dataclass(frozen=True)
class Dataset:
    filename: str
    description: str
    approx_mb: int
    base_url: str = BASE_URL
    group: str = "south-pole"

    @property
    def url(self) -> str:
        return self.base_url + self.filename


DATASETS: tuple[Dataset, ...] = (
    Dataset("LDEM_80S_80MPP_ADJ.TIF", "LOLA Digital Elevation Model — surface height (m), 80 m/px", 181),
    Dataset("LDEM_80S_80MPP_ADJ_HILL.TIF", "LDEM hillshade (45° altitude, 45° azimuth), 80 m/px", 85),
    Dataset("LPSR_80S_20MPP_ADJ.TIF", "Permanently Shadowed Region map, 20 m/px", 148),
    Dataset("LDSM_80S_80MPP_ADJ.TIF", "LOLA Digital Slope Map — slope (degrees), 80 m/px", 231),
)

# Global context imagery for the full-Moon globe (NOT used for South Pole science).
# NASA Scientific Visualization Studio, "CGI Moon Kit" (public domain):
#   https://svs.gsfc.nasa.gov/4720  — LROC WAC colour mosaic + LOLA global DEM.
SVS_BASE = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/"
GLOBAL_DATASETS: tuple[Dataset, ...] = (
    Dataset("lroc_color_poles_4k.tif", "SVS CGI Moon Kit — LROC WAC colour, equirectangular 4k", 13, SVS_BASE, "global"),
    Dataset("ldem_16.tif", "SVS CGI Moon Kit — LOLA global DEM (km), 16 px/deg", 64, SVS_BASE, "global"),
)

CHUNK = 1 << 20  # 1 MiB
CONNECT_TIMEOUT = 30
MAX_RETRIES = 6
USER_AGENT = "SELENE-Nav-downloader/1.0 (+python-urllib)"
TIFF_MAGIC = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")  # classic + BigTIFF


# --------------------------------------------------------------------------- utils

def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024 or unit == "GB":
            return f"{n:6.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} GB"


def log(msg: str) -> None:
    print(msg, flush=True)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK * 4):
            h.update(chunk)
    return h.hexdigest()


class Progress:
    def __init__(self, total: int | None, start: int, label: str):
        self.total, self.done, self.label = total, start, label
        self.t0, self.last, self.start = time.monotonic(), 0.0, start
        self.tty = sys.stdout.isatty()

    def update(self, n: int) -> None:
        self.done += n
        now = time.monotonic()
        if now - self.last < (0.25 if self.tty else 5.0):
            return
        self.last = now
        self._print()

    def _print(self, end: str = "") -> None:
        elapsed = max(time.monotonic() - self.t0, 1e-6)
        rate = (self.done - self.start) / elapsed
        if self.total:
            pct = 100.0 * self.done / self.total
            bar = "#" * int(pct / 4)
            eta = (self.total - self.done) / rate if rate > 0 else 0
            line = (f"  [{bar:<25}] {pct:5.1f}%  {human(self.done)} / {human(self.total)}"
                    f"  {human(rate)}/s  ETA {int(eta)//60:02d}:{int(eta)%60:02d}")
        else:
            line = f"  {human(self.done)}  {human(rate)}/s"
        if self.tty:
            sys.stdout.write("\r" + line + end)
        else:
            sys.stdout.write(line + "\n")
        sys.stdout.flush()

    def finish(self) -> None:
        self._print(end="\n" if self.tty else "")


# --------------------------------------------------------------------------- http

def head(url: str) -> dict:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=CONNECT_TIMEOUT) as r:
        if r.status != 200:
            raise RuntimeError(f"HEAD {url} -> HTTP {r.status}")
        return {
            "length": int(r.headers["Content-Length"]) if r.headers.get("Content-Length") else None,
            "ranges": r.headers.get("Accept-Ranges", "").lower() == "bytes",
            "type": r.headers.get("Content-Type", ""),
            "last_modified": r.headers.get("Last-Modified"),
        }


# --------------------------------------------------------------------------- validation

def validate(path: Path, expected_size: int | None, require_crs: bool = True) -> tuple[bool, str]:
    if not path.exists():
        return False, "missing"
    size = path.stat().st_size
    if expected_size is not None and size != expected_size:
        return False, f"size {size} != expected {expected_size}"
    with path.open("rb") as fh:
        magic = fh.read(4)
    if magic not in TIFF_MAGIC:
        return False, f"not a TIFF (magic={magic!r})"
    try:
        import rasterio  # type: ignore
    except ImportError:
        return True, "size + TIFF magic OK (rasterio not installed; header not parsed)"
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # SVS images are plain TIFFs (no georeferencing)
            ds = rasterio.open(path)
        with ds:
            if require_crs and ds.crs is None:
                return False, "GeoTIFF has no CRS"
            # Read one small window from the last overview/row to catch truncation.
            ds.read(1, window=((ds.height - 1, ds.height), (0, min(ds.width, 256))))
            kind = "GeoTIFF" if ds.crs is not None else "TIFF"
            return True, f"{kind} OK {ds.width}x{ds.height} {ds.dtypes[0]}"
    except Exception as exc:  # noqa: BLE001
        return False, f"rasterio failed: {exc}"


# --------------------------------------------------------------------------- download

def download(ds: Dataset, out_dir: Path, meta: dict) -> Path:
    dest = out_dir / ds.filename
    part = dest.with_suffix(dest.suffix + ".part")
    expected = meta["length"]

    for attempt in range(1, MAX_RETRIES + 1):
        offset = part.stat().st_size if part.exists() else 0
        if expected is not None and offset > expected:
            log(f"  .part larger than remote file ({offset} > {expected}); restarting")
            part.unlink()
            offset = 0
        if expected is not None and offset == expected:
            break  # already complete — fall through to validation

        headers = {"User-Agent": USER_AGENT}
        if offset and meta["ranges"]:
            headers["Range"] = f"bytes={offset}-"
            log(f"  resuming at {human(offset)} (attempt {attempt}/{MAX_RETRIES})")
        elif offset:
            log("  server does not support ranges; restarting from 0")
            offset = 0
        else:
            log(f"  downloading (attempt {attempt}/{MAX_RETRIES})")

        try:
            req = urllib.request.Request(ds.url, headers=headers)
            with urllib.request.urlopen(req, timeout=CONNECT_TIMEOUT) as r:
                if offset and r.status == 206:
                    cr = r.headers.get("Content-Range", "")
                    if not cr.startswith(f"bytes {offset}-"):
                        raise RuntimeError(f"unexpected Content-Range: {cr!r}")
                    mode = "ab"
                elif r.status == 200:
                    offset, mode = 0, "wb"
                else:
                    raise RuntimeError(f"HTTP {r.status}")
                ctype = r.headers.get("Content-Type", "")
                if "html" in ctype.lower():
                    raise RuntimeError(f"server returned HTML instead of TIFF ({ctype})")
                prog = Progress(expected, offset, ds.filename)
                with part.open(mode) as fh:
                    while chunk := r.read(CHUNK):
                        fh.write(chunk)
                        prog.update(len(chunk))
                prog.finish()
            if expected is None or part.stat().st_size == expected:
                break
            raise RuntimeError(f"short read: {part.stat().st_size} of {expected} bytes")
        except (urllib.error.URLError, socket.timeout, ConnectionError, RuntimeError, OSError) as exc:
            wait = min(60, 2 ** attempt)
            log(f"\n  ! {type(exc).__name__}: {exc}")
            if attempt == MAX_RETRIES:
                raise RuntimeError(f"giving up on {ds.filename} after {MAX_RETRIES} attempts") from exc
            log(f"  retrying in {wait}s …")
            time.sleep(wait)

    ok, why = validate(part, expected, ds.group == "south-pole")
    if not ok:
        bad = part.with_suffix(".invalid")
        part.replace(bad)
        raise RuntimeError(f"downloaded file failed validation ({why}); kept as {bad.name}")
    part.replace(dest)
    return dest


# --------------------------------------------------------------------------- main

def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=root / "data" / "raw", help="output directory (default: data/raw)")
    ap.add_argument("--only", action="append", help="download only this filename (repeatable)")
    ap.add_argument("--verify", action="store_true", help="validate existing files only; do not download")
    ap.add_argument("--no-hash", action="store_true", help="skip SHA-256 computation")
    ap.add_argument("--no-global", action="store_true",
                    help="skip the global-context globe imagery from NASA SVS (south-pole files only)")
    args = ap.parse_args(argv)

    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    pool = DATASETS + (() if args.no_global else GLOBAL_DATASETS)
    selected = [d for d in pool if not args.only or d.filename in args.only]
    if args.only and len(selected) != len(args.only):
        known = ", ".join(d.filename for d in DATASETS + GLOBAL_DATASETS)
        log(f"Unknown filename in --only. Known: {known}")
        return 2

    total_expected = sum(d.approx_mb for d in selected)
    log(f"SELENE-Nav LOLA downloader — source: {PRODUCT_PAGE}")
    log(f"Output: {out_dir}   ({len(selected)} files, ~{total_expected} MB)\n")

    if shutil.disk_usage(out_dir).free < total_expected * 1024 * 1024 * 1.1 and not args.verify:
        log("WARNING: free disk space may be insufficient for all files.")

    manifest_path = out_dir / "MANIFEST.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    results: list[tuple[str, str, str]] = []

    for ds in selected:
        log(f"● {ds.filename}\n  {ds.description}\n  {ds.url}")
        dest = out_dir / ds.filename
        try:
            meta = head(ds.url)
            if "tif" not in meta["type"].lower():
                raise RuntimeError(f"unexpected Content-Type {meta['type']!r}")
            log(f"  remote size {human(meta['length'] or 0)}  last-modified {meta['last_modified']}"
                f"  ranges={'yes' if meta['ranges'] else 'no'}")
        except Exception as exc:  # noqa: BLE001
            if args.verify and dest.exists():
                meta = {"length": manifest.get(ds.filename, {}).get("size"), "ranges": False,
                        "type": "", "last_modified": None}
                log(f"  (offline: {exc}; validating against manifest)")
            else:
                log(f"  ✗ cannot reach server: {exc}")
                results.append((ds.filename, "FAILED", str(exc)))
                continue

        ok, why = validate(dest, meta["length"], ds.group == "south-pole")
        if ok:
            log(f"  ✓ already present and valid — {why}")
            status = "SKIPPED (valid)"
        elif args.verify:
            log(f"  ✗ {why}")
            results.append((ds.filename, "INVALID" if dest.exists() else "MISSING", why))
            continue
        else:
            if dest.exists():
                aside = dest.with_suffix(dest.suffix + f".invalid-{int(time.time())}")
                dest.replace(aside)
                log(f"  existing file invalid ({why}); moved aside to {aside.name}")
            try:
                download(ds, out_dir, meta)
                ok, why = validate(dest, meta["length"], ds.group == "south-pole")
                log(f"  ✓ downloaded — {why}")
                status = "DOWNLOADED"
            except Exception as exc:  # noqa: BLE001
                log(f"  ✗ {exc}")
                log("    Re-run the script to resume; partial data is kept in the .part file.")
                results.append((ds.filename, "FAILED", str(exc)))
                continue

        entry = manifest.get(ds.filename, {})
        size = dest.stat().st_size
        if not args.no_hash and (entry.get("size") != size or "sha256" not in entry):
            log("  computing SHA-256 …")
            entry["sha256"] = sha256_of(dest)
        elif entry.get("sha256") and not args.no_hash and args.verify:
            digest = sha256_of(dest)
            if digest != entry["sha256"]:
                results.append((ds.filename, "INVALID", "SHA-256 differs from manifest"))
                log("  ✗ SHA-256 differs from manifest")
                continue
        entry.update({
            "url": ds.url, "size": size, "description": ds.description, "group": ds.group,
            "last_modified": meta.get("last_modified") or entry.get("last_modified"),
            "verified_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
        manifest[ds.filename] = entry
        results.append((ds.filename, status, human(size).strip()))
        log("")

    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    log("\n================ SUMMARY ================")
    for name, status, info in results:
        log(f"  {status:<17} {name:<30} {info}")
    failed = [r for r in results if r[1] in ("FAILED", "INVALID", "MISSING")]
    log(f"\n{len(results) - len(failed)}/{len(results)} OK.  Manifest: {manifest_path}")
    if failed:
        log("Some files failed. Re-run this script to retry/resume; it is safe to run repeatedly.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
