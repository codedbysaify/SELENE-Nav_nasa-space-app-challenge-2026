"use client";
import { useEffect, useState } from "react";
import { BASE_LAYERS, EXAGGERATION_RANGE, type BaseLayer } from "@/lib/lunar-config";
import { ELEVATION_RAMP, SLOPE_MAX_DEG, SLOPE_RAMP, type RampStop } from "@/lib/shaders";
import { store, useAppStore } from "@/lib/store";
import { useLunarRegistry } from "@/hooks/useLunarData";
import { IconChevron, IconLayers } from "./icons";

const gradient = (stops: RampStop[]) =>
  `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${(s.t * 100).toFixed(1)}%`).join(", ")})`;

function Legend({ layer }: { layer: BaseLayer }) {
  const meta = useLunarRegistry().meta;
  if (layer === "hillshade") {
    return (
      <div className="space-y-1.5">
        <div className="h-2 rounded-sm" style={{ background: "linear-gradient(90deg,#1c1c1c,#8a8a8a,#f2f2f2)" }} />
        <p className="text-[11px] leading-snug text-ink-mute">
          NASA LDEM hillshade, illumination baked in by the source product (sun 45° altitude, 45° azimuth).
        </p>
      </div>
    );
  }
  if (layer === "elevation") {
    const lo = meta ? meta.elevation.min_m / 1000 : -7.3;
    const hi = meta ? meta.elevation.max_m / 1000 : 7.03;
    return (
      <div className="space-y-1.5">
        <div className="h-2 rounded-sm" style={{ background: gradient(ELEVATION_RAMP) }} />
        <div className="num flex justify-between text-[10px] text-ink-mute">
          <span>{lo.toFixed(2)} km</span>
          <span>0</span>
          <span>+{hi.toFixed(2)} km</span>
        </div>
        <p className="text-[11px] leading-snug text-ink-mute">Height relative to the 1737.4 km reference sphere.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-sm" style={{ background: gradient(SLOPE_RAMP) }} />
      <div className="num relative h-3 text-[10px] text-ink-mute">
        {[0, 5, 10, 15, 20, 30, 45].map((d) => (
          <span key={d} className="absolute -translate-x-1/2" style={{ left: `${(d / SLOPE_MAX_DEG) * 100}%` }}>
            {d === 45 ? "45°+" : `${d}°`}
          </span>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-ink-mute">
        LDSM slope. Low slope alone does not make a site suitable for landing.
      </p>
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const id = `sl-${props.label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12px] text-ink-soft">
          {props.label}
        </label>
        <span className="num text-[11px] text-ink">{props.format(props.value)}</span>
      </div>
      <input
        id={id}
        className="range"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export default function LayerSelector() {
  const layer = useAppStore((s) => s.baseLayer);
  const psr = useAppStore((s) => s.psrOverlay);
  const exag = useAppStore((s) => s.exaggeration);
  const az = useAppStore((s) => s.sunAzimuthDeg);
  const el = useAppStore((s) => s.sunElevationDeg);
  const meta = useLunarRegistry().meta;
  const [open, setOpen] = useState(true);
  // Keep the Moon unobstructed on narrow screens: start collapsed.
  useEffect(() => {
    if (window.innerWidth < 1100) setOpen(false);
  }, []);
  const psrStats = meta?.psr.stats;

  return (
    <section
      aria-label="Visualisation layers"
      className="panel absolute left-3 top-[68px] z-20 w-[264px] max-w-[calc(100vw-24px)] md:left-4"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[12px] font-medium text-ink">
          <IconLayers className="text-accent" /> Layers
        </span>
        <IconChevron className={`text-ink-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="enter space-y-4 border-t border-line px-3.5 pb-3.5 pt-3">
          <div>
            <div className="eyebrow mb-2">Base layer</div>
            <div role="radiogroup" aria-label="Base layer" className="grid grid-cols-3 gap-1 rounded-md bg-black/30 p-0.5">
              {BASE_LAYERS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={layer === l.id}
                  title={l.hint}
                  onClick={() => store.set({ baseLayer: l.id })}
                  className={`h-7 rounded text-[12px] transition-colors ${
                    layer === l.id ? "bg-white/10 text-ink shadow-[inset_0_0_0_1px_rgba(94,200,216,0.45)]" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="mt-2.5">
              <Legend layer={layer} />
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2">Overlay</div>
            <button
              type="button"
              role="switch"
              aria-checked={psr}
              onClick={() => store.set({ psrOverlay: !psr })}
              className="flex w-full items-center justify-between rounded-md border border-line px-2.5 py-2 text-left transition-colors hover:border-line-strong"
            >
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-[3px] border border-white/20" style={{ background: "#a879ff" }} />
                <span className="text-[12px] text-ink">Permanently shadowed regions</span>
              </span>
              <span className={`relative h-4 w-7 rounded-full transition-colors ${psr ? "bg-psr/80" : "bg-white/12"}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${psr ? "left-3.5" : "left-0.5"}`} />
              </span>
            </button>
            <p className="mt-1.5 text-[11px] leading-snug text-ink-mute">
              LPSR map (Barker et al. 2023), 20 m source. Not the same as dark terrain in the shading.
              {psrStats && (
                <>
                  {" "}
                  PSRs cover <span className="num text-ink-soft">{Math.round(psrStats.psr_area_km2).toLocaleString("en-US")} km²</span> (
                  <span className="num text-ink-soft">{(psrStats.psr_fraction_of_cap * 100).toFixed(2)}%</span>) of 80–90°S.
                </>
              )}
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="eyebrow">Rendering</div>
            <Slider
              label="Vertical exaggeration"
              value={exag}
              min={EXAGGERATION_RANGE[0]}
              max={EXAGGERATION_RANGE[1]}
              step={0.25}
              format={(v) => (v === 1 ? "1.00× true scale" : `${v.toFixed(2)}× visual`)}
              onChange={(v) => store.set({ exaggeration: v })}
            />
            <Slider label="Sun azimuth" value={az} min={0} max={360} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={(v) => store.set({ sunAzimuthDeg: v })} />
            <Slider label="Sun elevation at pole" value={el} min={1} max={45} step={0.5} format={(v) => `${v.toFixed(1)}°`} onChange={(v) => store.set({ sunElevationDeg: v })} />
            <p className="text-[11px] leading-snug text-ink-mute">
              Illustrative lighting for the 3D shading. At the real South Pole the Sun never rises more than ~1.5°.
              Exaggeration is visual only; read-outs show true LOLA values.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
