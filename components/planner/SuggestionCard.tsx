"use client";
/** The suggested ("ghost", dashed green) ellipse from "Find a better spot nearby" or "Suggest best plan". */
import { useAppStore } from "@/lib/store";
import { applySuggestion, dismissSuggestion } from "@/lib/planner-actions";
import { formatLat, formatLon } from "@/lib/lunar-coordinates";
import { fmtUtcShort } from "@/components/ui/DateTimePicker";
import InfoTip from "@/components/ui/InfoTip";

export default function SuggestionCard() {
  const g = useAppStore((s) => s.suggestion);
  const current = useAppStore((s) => s.analysis?.mission.usablePct ?? null);
  if (!g) return null;
  return (
    <div className="enter space-y-1.5 rounded-lg border border-dashed border-[#7df0b0]/70 bg-[#7df0b0]/8 p-2.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[12px] font-medium text-[#a9f5cd]">
          {g.kind === "nearby" ? "Better spot nearby" : "Suggested best plan"}
          <InfoTip k={g.kind === "nearby" ? "betterSpot" : "suggest"} />
        </span>
        <span className="text-[10px] text-ink-mute">dashed green on the map</span>
      </div>
      <dl className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
        {g.landingMs !== null && (
          <>
            <dt className="text-ink-mute">Landing</dt>
            <dd className="text-ink">{fmtUtcShort(g.landingMs)} · {g.missionDays} d</dd>
          </>
        )}
        <dt className="text-ink-mute">Centre</dt>
        <dd className="text-ink">{formatLat(g.ellipse.lat, 2)} {formatLon(g.ellipse.lon, 2)}</dd>
        <dt className="text-ink-mute">Ellipse</dt>
        <dd className="text-ink">
          {(2 * g.ellipse.aKm).toFixed(1)} × {(2 * g.ellipse.bKm).toFixed(1)} km · covers <strong>{g.areaKm2.toFixed(1)} km²</strong>
        </dd>
        <dt className="text-ink-mute">Usable time</dt>
        <dd className="text-[#a9f5cd]">
          ≈ {g.usablePct.toFixed(0)}%{current !== null && g.kind === "nearby" ? ` (yours: ${current.toFixed(0)}%)` : ""}
        </dd>
      </dl>
      <p className="text-[10.5px] leading-snug text-ink-mute">{g.note}. The exact 80 m analysis runs when you accept.</p>
      <div className="flex gap-1.5">
        <button type="button" onClick={applySuggestion} className="h-8 flex-1 rounded-md bg-[#7df0b0] text-[12px] font-medium text-[#062214] hover:bg-[#9bf5c4]">
          {g.kind === "nearby" ? "Move ellipse here" : "Use this plan"}
        </button>
        <button type="button" onClick={dismissSuggestion} className="h-8 rounded-md border border-line px-3 text-[12px] text-ink-soft hover:text-ink">
          Dismiss
        </button>
      </div>
    </div>
  );
}
