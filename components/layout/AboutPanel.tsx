"use client";
import { useEffect, useRef } from "react";
import { REFERENCES } from "@/lib/lunar-config";
import { store, useAppStore } from "@/lib/store";
import { useLunarRegistry } from "@/hooks/useLunarData";
import { IconClose, IconExternal } from "@/components/ui/icons";

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {children}
      <IconExternal />
    </a>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="eyebrow mb-2 mt-5 first:mt-0">{children}</h3>;
}

export default function AboutPanel() {
  const open = useAppStore((s) => s.aboutOpen);
  const meta = useLunarRegistry().meta;
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && store.set({ aboutOpen: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnFocus.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  const src = meta?.sources;

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div className="absolute inset-0 bg-black/45" onClick={() => store.set({ aboutOpen: false })} />
      <div className="enter absolute bottom-0 right-0 top-0 flex w-[440px] max-w-full flex-col border-l border-line bg-panel-solid">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
          <h2 id="about-title" className="text-[14px] font-medium text-ink">
            Data &amp; methods
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close data and methods"
            onClick={() => store.set({ aboutOpen: false })}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-soft hover:bg-white/5 hover:text-ink"
          >
            <IconClose />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 text-[12.5px] leading-relaxed text-ink-soft">
          <H>Primary data — NASA LOLA South Pole</H>
          <p>
            High-resolution topography of the lunar South Pole (80–90°S) from the Lunar Orbiter Laser Altimeter, distributed by NASA
            GSFC&apos;s Planetary Geodesy Data Archive.
          </p>
          <ul className="num mt-2 space-y-1 text-[11.5px]">
            <li>LDEM_80S_80MPP_ADJ — elevation, m · 80 m/px</li>
            <li>LDEM_80S_80MPP_ADJ_HILL — hillshade · 80 m/px</li>
            <li>LDSM_80S_80MPP_ADJ — slope, degrees · 80 m/px</li>
            <li>LPSR_80S_20MPP_ADJ — permanently shadowed regions · 20 m/px</li>
          </ul>

          <H>Reference</H>
          <p className="text-ink">{REFERENCES.paper}</p>
          <p className="mt-1 space-x-3">
            <Ext href={REFERENCES.paperDoi}>Paper DOI</Ext>
            <Ext href={REFERENCES.dataDoi}>Data DOI</Ext>
            <Ext href={REFERENCES.source}>PGDA product 90</Ext>
          </p>

          <H>Coordinate system</H>
          <p>
            Source grids are south-polar stereographic (MOON_ME frame, JPL DE421; sphere R = 1737.4 km). They are <em>not</em>{" "}
            re-projected: each grid node keeps its stereographic position and is placed on the sphere with the exact inverse
            projection (lat = −(90° − 2·atan(ρ/2R)), lon = atan2(x, y)), cross-checked against PROJ
            {meta?.projection.proj_cross_check?.checked ? " (max error < 1e-9°)" : ""}. The terrain therefore sits exactly on 80–90°S
            of the globe.
          </p>

          <H>Processing &amp; resampling</H>
          <ul className="list-disc space-y-1 pl-4">
            <li>Geometry: block-mean of the 80 m DEM to 1.6 km (initial) and 640 m (detail) node spacing.</li>
            <li>Shading/layers: block-mean to 640 m and 160 m textures; normals from the DEM with the projection scale factor applied.</li>
            <li>PSR: fraction of 20 m PSR pixels per texel (exact block average, no thresholding of brightness).</li>
            <li>Slope and PSR read-outs use the nearest grid node; elevation is bilinear.</li>
            <li>Vertical exaggeration (default 2×) is applied only to rendering, never to displayed values or the horizon analysis.</li>
          </ul>

          {meta && (
            <>
              <H>This build</H>
              <ul className="num space-y-1 text-[11.5px]">
                <li>Elevation range: {(meta.elevation.min_m / 1000).toFixed(3)} … {(meta.elevation.max_m / 1000).toFixed(3)} km</li>
                {meta.psr.stats && (
                  <li>
                    PSR area 80–90°S: {Math.round(meta.psr.stats.psr_area_km2).toLocaleString("en-US")} km² (
                    {(meta.psr.stats.psr_fraction_of_cap * 100).toFixed(2)}%)
                  </li>
                )}
                {src &&
                  Object.values(src).map((s) => (
                    <li key={s.file} className="break-all">
                      {s.file} {s.width}×{s.height}
                      {s.sha256 ? ` · sha256 ${s.sha256.slice(0, 12)}…` : ""}
                    </li>
                  ))}
                <li>Processed {meta.generated_utc}</li>
              </ul>
            </>
          )}

          <H>Sun &amp; Earth positions</H>
          <p>
            Hourly sub-solar and sub-Earth points (where the Sun / Earth is at the zenith) from now to 2035, precomputed offline
            from NASA JPL&apos;s DE440 ephemeris with the DE421 lunar orientation (MOON_ME frame, the LOLA frame). Checked against
            every hour of NASA SVS <span className="num">mooninfo_2026.json</span> and against JPL Horizons (max difference ≈ 0.006°).
            The browser never calls Horizons.
          </p>
          <p className="num mt-1.5 text-[11.5px] text-ink">sin(el) = sin φ·sin φb + cos φ·cos φb·cos(λ − λb)</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>Earth parallax: el′ = atan2(sin el − R/d, cos el), using the Earth–Moon distance d (up to 0.26°).</li>
            <li>Sun disc radius 0.27°: partly lit while el + 0.27° &gt; horizon; disc-weighted sunlight %.</li>
            <li>Earth counts as visible when its centre is above the terrain horizon.</li>
          </ul>

          <H>Terrain horizon</H>
          <ul className="list-disc space-y-1 pl-4">
            <li>From each point, the highest terrain angle along great circles in 72 compass directions (5°), out to 250 km,
              with exact lunar curvature. North = away from the pole.</li>
            <li>Whole region: 475 × 475 cells (1.28 km), precomputed from the LOLA DEM (640 m sampling).</li>
            <li>Inside your landing ellipse: every 80 m LOLA cell (thinned to ≤ 9,000 cells for very large ellipses), 80 m terrain
              to 25 km and 640 m terrain to 250 km; 360 directions at the centre.</li>
            <li>Horizons are computed at ground level (no lander mast height).</li>
          </ul>

          <H>Global Moon (context only)</H>
          <p>
            The full-Moon globe uses the NASA SVS CGI Moon Kit — LROC WAC colour mosaic and LOLA global DEM (public domain). It is
            visual context; all South Pole measurements come from the PGDA products above. <Ext href={REFERENCES.globe}>SVS 4720</Ext>
          </p>

          <H>Interpretation notes</H>
          <ul className="list-disc space-y-1 pl-4">
            <li>PSRs are the mapped LPSR product, not dark pixels in the hillshade or the 3D shading.</li>
            <li>Slope is one factor among many (illumination, communications, roughness, hazards) — no landing suitability is implied.</li>
            <li>3D lighting uses the real Sun direction for the selected time (no cast shadows); use the
              &quot;Sunlight &amp; shadows&quot; layer for terrain-horizon shadowing. The baked hillshade uses the source
              product&apos;s 45°/45° sun.</li>
            <li>Stars in the background are decorative.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
