"use client";
/** Site verdict + 4 key numbers. Depends only on the analysis summary and thresholds — never on the time slider. */
import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { computeVerdict, fmtHours, GRADE_COLOR, GRADE_ICON, GRADE_LABEL, type PlanSummary } from "@/lib/verdict";
import { findBetterNearby, savePlan } from "@/lib/planner-actions";
import { MAX_PLANS } from "@/lib/plans";
import InfoTip from "@/components/ui/InfoTip";
import type { GlossaryKey } from "@/lib/glossary";
import VerdictSettings from "./VerdictSettings";

const ROW_TIP: Record<string, GlossaryKey> = { power: "power", contact: "contact", terrain: "terrain", darkness: "darkness" };

function KeyNumber({ label, value, tip, color }: { label: string; value: string; tip: GlossaryKey; color?: string }) {
  return (
    <div className="rounded-md border border-line bg-black/20 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10.5px] text-ink-mute">{label} <InfoTip k={tip} /></div>
      <div className="num text-[16px] font-medium leading-tight" style={{ color: color ?? "#e8edf3" }}>{value}</div>
    </div>
  );
}

export default function VerdictCard({ summary }: { summary: PlanSummary }) {
  const thresholds = useAppStore((s) => s.thresholds);
  const plansCount = useAppStore((s) => s.plans.length);
  const searching = useAppStore((s) => s.searchProgress);
  const suggestion = useAppStore((s) => s.suggestion);
  const [settings, setSettings] = useState(false);
  const [saved, setSaved] = useState(false);
  const v = useMemo(() => computeVerdict(summary, thresholds), [summary, thresholds]);

  return (
    <div className="space-y-2">
      <div className="rounded-lg border p-2.5" style={{ borderColor: `${GRADE_COLOR[v.grade]}66`, background: `${GRADE_COLOR[v.grade]}12` }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[17px] leading-none">{GRADE_ICON[v.grade]}</span>
            <span className="text-[14px] font-semibold" style={{ color: GRADE_COLOR[v.grade] }}>{GRADE_LABEL[v.grade]}</span>
            <InfoTip k="verdict" />
          </div>
          <button
            type="button"
            aria-label="Verdict settings"
            aria-expanded={settings}
            title="Verdict settings"
            onClick={() => setSettings((o) => !o)}
            className={`grid h-6 w-6 place-items-center rounded text-[13px] transition-colors ${settings ? "bg-white/15" : "hover:bg-white/10"}`}
          >
            ⚙️
          </button>
        </div>
        <ul className="mt-1.5 space-y-1">
          {v.rows.map((r) => (
            <li key={r.key} className="flex items-start gap-1.5 text-[11.5px] leading-tight">
              <span className="w-4 shrink-0 text-center">{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-ink">
                  {r.label} {GRADE_ICON[r.grade]} <span className="num text-ink-soft">{r.value}</span> <InfoTip k={ROW_TIP[r.key]} />
                </span>
                <span className="block text-[10px] text-ink-mute">{r.need}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11.5px] leading-snug text-ink-soft">{v.why}</p>
      </div>

      {settings && <VerdictSettings onClose={() => setSettings(false)} />}

      <div className="flex gap-1.5">
        {v.grade !== "good" && !suggestion && (
          <button
            type="button"
            disabled={!!searching}
            onClick={findBetterNearby}
            title="Searches within 20 km for the place with the most usable time on safe slopes, same dates"
            className="h-8 min-w-0 flex-1 truncate whitespace-nowrap rounded-md border border-[#7df0b0]/50 px-2 text-[11.5px] text-[#a9f5cd] hover:bg-[#7df0b0]/10 disabled:opacity-50"
          >
            {searching ? "Searching…" : "🔍 Better spot nearby"}
          </button>
        )}
        <button
          type="button"
          disabled={saved || plansCount >= MAX_PLANS}
          onClick={() => savePlan() && setSaved(true)}
          title={plansCount >= MAX_PLANS ? `Maximum ${MAX_PLANS} plans` : "Save this plan to compare later"}
          className="h-8 shrink-0 whitespace-nowrap rounded-md border border-line px-2.5 text-[11.5px] text-ink-soft hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          {saved ? "✓ Saved" : `Save plan ${plansCount}/${MAX_PLANS}`}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <KeyNumber label="Sunlight" value={`${summary.sunlitPct.toFixed(0)}%`} tip="sunlit" color="#ffd27a" />
        <KeyNumber label="Longest darkness" value={fmtHours(summary.longestDarkH)} tip="darkness" />
        <KeyNumber label="Earth visible" value={`${summary.earthPct.toFixed(0)}%`} tip="earthVisible" color="#4fa8ff" />
        <KeyNumber label="Usable time" value={`${summary.usablePct.toFixed(0)}%`} tip="usable" color="#a9f5cd" />
      </div>
    </div>
  );
}
