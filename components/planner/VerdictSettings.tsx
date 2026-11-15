"use client";
/** ⚙️ Verdict settings: presets, dual sliders + number inputs, reset. Changes only the rating, never the numbers. */
import { applyPreset, setThresholds } from "@/lib/planner-actions";
import { useAppStore } from "@/lib/store";
import { PRESETS, type PresetName } from "@/lib/verdict";
import DualRange from "@/components/ui/DualRange";
import InfoTip from "@/components/ui/InfoTip";

const PRESET_LABEL: Record<PresetName, string> = { default: "Default", strict: "Strict", relaxed: "Relaxed", custom: "Custom" };

export default function VerdictSettings({ onClose }: { onClose: () => void }) {
  const t = useAppStore((s) => s.thresholds);
  const custom = (patch: Partial<typeof t>) => setThresholds({ ...t, ...patch, preset: "custom" });

  return (
    <div className="enter space-y-3 rounded-md border border-line bg-black/30 p-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[12px] font-medium text-ink">
          Verdict settings <InfoTip k="thresholds" />
        </span>
        <button type="button" onClick={onClose} className="rounded px-1.5 text-[11px] text-accent hover:underline">
          Done
        </button>
      </div>
      <div role="radiogroup" aria-label="Threshold preset" className="grid grid-cols-4 gap-1 rounded-md bg-black/30 p-0.5">
        {(["default", "strict", "relaxed", "custom"] as PresetName[]).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={t.preset === p}
            disabled={p === "custom" && t.preset !== "custom"}
            onClick={() => p !== "custom" && applyPreset(p)}
            className={`h-6 rounded text-[11px] transition-colors disabled:cursor-default ${
              t.preset === p ? "bg-white/12 text-ink shadow-[inset_0_0_0_1px_rgba(94,200,216,0.45)]" : "text-ink-soft hover:text-ink disabled:opacity-40"
            }`}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      <DualRange label="☀️ Power (sunlight)" unit="%" min={0} max={100} lo={t.power.risky} hi={t.power.good} higherIsBetter
        onChange={(lo, hi) => custom({ power: { risky: lo, good: hi } })} />
      <DualRange label="📡 Contact (Earth visible)" unit="%" min={0} max={100} lo={t.contact.risky} hi={t.contact.good} higherIsBetter
        onChange={(lo, hi) => custom({ contact: { risky: lo, good: hi } })} />
      <DualRange label="⛰️ Terrain (mean slope)" unit="°" min={0} max={45} lo={t.slope.good} hi={t.slope.risky} higherIsBetter={false}
        onChange={(lo, hi) => custom({ slope: { good: lo, risky: hi } })} />
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-[11.5px] text-ink-soft">
          <input
            type="checkbox"
            checked={t.darkness.enabled}
            onChange={(e) => custom({ darkness: { ...t.darkness, enabled: e.target.checked } })}
            className="accent-[#5ec8d8]"
          />
          Include 🌙 longest darkness in the verdict <InfoTip k="darkness" />
        </label>
        {t.darkness.enabled && (
          <DualRange label="🌙 Longest darkness" unit=" h" min={0} max={720} step={6} lo={t.darkness.good} hi={t.darkness.risky} higherIsBetter={false}
            onChange={(lo, hi) => custom({ darkness: { ...t.darkness, good: lo, risky: hi } })} />
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line pt-2">
        <span className="text-[10.5px] text-ink-mute">Saved in this browser.</span>
        <button
          type="button"
          onClick={() => applyPreset("default")}
          disabled={t.preset === "default" && JSON.stringify(t) === JSON.stringify({ preset: "default", ...PRESETS.default })}
          className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-soft hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}
