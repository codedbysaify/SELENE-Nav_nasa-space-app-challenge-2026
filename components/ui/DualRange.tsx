"use client";
/**
 * Dual-handle threshold slider + number inputs. The track shows the ✅ / ⚠️ / ❌ zones.
 * `higherIsBetter` = true: [0 … lo) ❌, [lo … hi) ⚠️, [hi … max] ✅; false: mirrored.
 * Handles cannot cross (min gap = step) and values are clamped to [min, max].
 */
const G = "#63d297", Y = "#e9b949", R = "#f0806a";

export default function DualRange({
  label, unit, min, max, step = 1, lo, hi, higherIsBetter, onChange,
}: {
  label: string; unit: string; min: number; max: number; step?: number; lo: number; hi: number; higherIsBetter: boolean;
  onChange: (lo: number, hi: number) => void;
}) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
  const setLo = (v: number) => onChange(clamp(Math.round(v / step) * step, min, hi - step), hi);
  const setHi = (v: number) => onChange(lo, clamp(Math.round(v / step) * step, lo + step, max));
  const [c0, c1, c2] = higherIsBetter ? [R, Y, G] : [G, Y, R];
  const track = `linear-gradient(90deg, ${c0} 0 ${pct(lo)}%, ${c1} ${pct(lo)}% ${pct(hi)}%, ${c2} ${pct(hi)}% 100%)`;
  const num = (v: number, set: (v: number) => void, aria: string) => (
    <input
      type="number"
      aria-label={aria}
      min={min}
      max={max}
      step={step}
      value={v}
      onChange={(e) => set(parseFloat(e.target.value))}
      className="num w-[52px] rounded border border-line bg-black/30 px-1.5 py-0.5 text-right text-[11.5px] text-ink outline-none focus:border-accent/60"
    />
  );
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-ink-soft">{label}</span>
        <span className="flex items-center gap-1 text-[10.5px] text-ink-mute">
          {num(lo, setLo, `${label} lower boundary`)}–{num(hi, setHi, `${label} upper boundary`)} {unit}
        </span>
      </div>
      <div className="dual-range relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-80" style={{ background: track }} />
        <input type="range" aria-label={`${label} lower boundary slider`} min={min} max={max} step={step} value={lo} onChange={(e) => setLo(Number(e.target.value))} />
        <input type="range" aria-label={`${label} upper boundary slider`} min={min} max={max} step={step} value={hi} onChange={(e) => setHi(Number(e.target.value))} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-ink-mute">
        <span>{higherIsBetter ? `❌ below ${lo}${unit}` : `✅ up to ${lo}${unit}`}</span>
        <span>⚠️ between</span>
        <span>{higherIsBetter ? `✅ from ${hi}${unit}` : `❌ above ${hi}${unit}`}</span>
      </div>
    </div>
  );
}
