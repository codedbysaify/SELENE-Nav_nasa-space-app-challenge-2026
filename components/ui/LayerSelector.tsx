"use client";
import { BASE_LAYERS, EXAGGERATION_RANGE, type BaseLayer } from "@/lib/lunar-config";
import { ANALYSIS_RAMP, EARTH_COLOR, ELEVATION_RAMP, SLOPE_MAX_DEG, SLOPE_RAMP, SUN_COLOR, type RampStop } from "@/lib/shaders";
import { store, useAppStore, type AnalysisLayer } from "@/lib/store";
import { useLunarRegistry } from "@/hooks/useLunarData";
import InfoTip from "./InfoTip";

const gradient = (stops: RampStop[]) =>
  `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${(s.t * 100).toFixed(1)}%`).join(", ")})`;

function Legend({ layer }: { layer: BaseLayer }) {
  const meta = useLunarRegistry().meta;
  if (layer === "hillshade") {
    return (
      <div className="space-y-1.5">
        <div className="h-2 rounded-sm" style={{ background: "linear-gradient(90deg,#1c1c1c,#8a8a8a,#f2f2f2)" }} />
        <p className="text-[11px] leading-snug text-ink-mute">
          NASA hillshade (lighting baked in by the source).
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
        <p className="text-[11px] leading-snug text-ink-mute">Height vs. the 1737.4 km reference sphere.</p>
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
        NASA LDSM slope. Flat ≠ automatically safe to land.
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

const ANALYSIS_OPTIONS: { id: AnalysisLayer; label: string; group: "off" | "now" | "mission" | "annual" }[] = [
  { id: "none", label: "Off", group: "off" },
  { id: "now-sun", label: "Sunlight & shadows", group: "now" },
  { id: "now-earth", label: "Earth in view", group: "now" },
  { id: "mission-sun", label: "Sunlight %", group: "mission" },
  { id: "mission-earth", label: "Earth visible %", group: "mission" },
  { id: "mission-night", label: "Longest night", group: "mission" },
  { id: "annual-sun", label: "Sunlight %", group: "annual" },
  { id: "annual-earth", label: "Earth visible %", group: "annual" },
  { id: "annual-night", label: "Longest night", group: "annual" },
];

function AnalysisLegend({ layer }: { layer: AnalysisLayer }) {
  const missionDays = useAppStore((s) => s.missionDays);
  if (layer === "none") return null;
  const note = "";
  if (layer === "now-sun")
    return (
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-3 text-[11px] text-ink-soft">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SUN_COLOR }} /> Sun visible</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#05070d] ring-1 ring-white/20" /> In shadow</span>
        </div>
        <p className="text-[11px] leading-snug text-ink-mute">Inside your ellipse, at the time on the slider (80 m).{note}</p>
      </div>
    );
  if (layer === "now-earth")
    return (
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-3 text-[11px] text-ink-soft">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: EARTH_COLOR }} /> Earth visible</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2a2d33]" /> Earth hidden</span>
        </div>
        <p className="text-[11px] leading-snug text-ink-mute">Direct radio line of sight to Earth, inside your ellipse at the slider time.{note}</p>
      </div>
    );
  const night = layer.endsWith("night");
  const annual = layer.startsWith("annual");
  const stops = night ? [...ANALYSIS_RAMP].reverse().map((s, i, a) => ({ ...s, t: a.length - 1 === 0 ? 0 : i / (a.length - 1) })) : ANALYSIS_RAMP;
  const lo = night ? "0 h" : "0 %";
  const hi = night ? (annual ? "1020 h+" : `${missionDays * 24} h`) : "100 %";
  return (
    <div className="mt-2 space-y-1.5">
      <div className="h-2 rounded-sm" style={{ background: gradient(stops) }} />
      <div className="num flex justify-between text-[10px] text-ink-mute">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
      <p className="text-[11px] leading-snug text-ink-mute">
        {annual ? "Whole year 2027." : `Over your ${missionDays}-day mission.`}
      </p>
    </div>
  );
}

const GROUP_LABEL = { now: "Inside your ellipse · follows the time slider", mission: "Whole South Pole · your mission", annual: "Whole South Pole · year 2027" } as const;

/** Layer controls (rendered inside the right-hand SidePanel "Layers" tab). */
export default function LayerSelector() {
  const layer = useAppStore((s) => s.baseLayer);
  const psr = useAppStore((s) => s.psrOverlay);
  const exag = useAppStore((s) => s.exaggeration);
  const analysisLayer = useAppStore((s) => s.analysisLayer);
  const missionReady = useAppStore((s) => s.missionLayersReady);
  const analysed = useAppStore((s) => !!s.analysis && s.planStep === "results");
  const psrStats = useLunarRegistry().meta?.psr.stats;

  return (
    <div className="space-y-4">
      <div>
        <div className="eyebrow mb-2 flex items-center gap-1">Base map <InfoTip k="baseMap" /></div>
        <div role="radiogroup" aria-label="Base map" className="grid grid-cols-3 gap-1 rounded-md bg-black/30 p-0.5">
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
        <div className="mt-2">
          <Legend layer={layer} />
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={psr}
        onClick={() => store.set({ psrOverlay: !psr })}
        title={`NASA LPSR map (Barker et al. 2023), 20 m. Mapped permanent shadow, not dark pixels.${
          psrStats ? ` Covers ${Math.round(psrStats.psr_area_km2).toLocaleString("en-US")} km² (${(psrStats.psr_fraction_of_cap * 100).toFixed(1)}%) of 80–90°S.` : ""
        }`}
        className="flex w-full items-center justify-between rounded-md border border-line px-2.5 py-2 text-left transition-colors hover:border-line-strong"
      >
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-[3px] border border-white/20" style={{ background: "#a879ff" }} />
          <span className="text-[12px] text-ink">Permanent shadow (PSR)</span>
        </span>
        <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${psr ? "bg-psr/80" : "bg-white/12"}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${psr ? "left-3.5" : "left-0.5"}`} />
        </span>
      </button>

      <div>
        <span className="eyebrow mb-2 flex items-center gap-1"><label htmlFor="analysis-layer">Sun &amp; Earth</label> <InfoTip k="sunEarthLayer" /></span>
        <select
          id="analysis-layer"
          value={analysisLayer}
          onChange={(e) => store.set({ analysisLayer: e.target.value as AnalysisLayer })}
          className="w-full rounded border border-line bg-[#0b1018] px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent/60"
        >
          <option value="none">Off</option>
          {(["now", "mission", "annual"] as const).map((g) => (
            <optgroup key={g} label={GROUP_LABEL[g] + ((g === "mission" && !missionReady) || (g === "now" && !analysed) ? " (analyse an ellipse first)" : "")}>
              {ANALYSIS_OPTIONS.filter((o) => o.group === g).map((o) => (
                <option key={o.id} value={o.id} disabled={(g === "mission" && !missionReady) || (g === "now" && !analysed)}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <AnalysisLegend layer={analysisLayer} />
      </div>

      <div>
        <Slider
          label="Vertical exaggeration"
          value={exag}
          min={EXAGGERATION_RANGE[0]}
          max={EXAGGERATION_RANGE[1]}
          step={0.25}
          format={(v) => (v === 1 ? "1× true" : `${v.toFixed(2)}×`)}
          onChange={(v) => store.set({ exaggeration: v })}
        />
        <p className="flex items-center gap-1 text-[11px] text-ink-mute">Visual only. Numbers are always true values. <InfoTip k="exaggeration" /></p>
      </div>
    </div>
  );
}
