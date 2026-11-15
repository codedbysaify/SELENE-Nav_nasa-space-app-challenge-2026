"use client";
/**
 * Slide-out drawer: saved landing plans (max 10) and their comparison.
 * Default ranking: verdict (✅ > ⚠️ > ❌), then usable time. Click a column header to sort by it.
 * Verdicts are recomputed with the CURRENT thresholds; the stored numbers never change.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { store, useAppStore } from "@/lib/store";
import { computeVerdict, fmtHours, gradeRank, GRADE_COLOR, GRADE_ICON, GRADE_LABEL } from "@/lib/verdict";
import { deletePlan, loadPlan, renamePlan } from "@/lib/planner-actions";
import { MAX_PLANS, type SavedPlan } from "@/lib/plans";
import { formatLat, formatLon } from "@/lib/lunar-coordinates";
import { fmtUtcShort } from "@/components/ui/DateTimePicker";
import InfoTip from "@/components/ui/InfoTip";
import { IconClose } from "@/components/ui/icons";
import type { GlossaryKey } from "@/lib/glossary";

type Col = "rank" | "sunlit" | "earth" | "usable" | "dark" | "slope" | "date";
const COLS: { id: Col; label: string; tip?: GlossaryKey; higherBetter: boolean }[] = [
  { id: "usable", label: "Usable", tip: "usable", higherBetter: true },
  { id: "sunlit", label: "Sunlit", tip: "sunlit", higherBetter: true },
  { id: "earth", label: "Earth", tip: "earthVisible", higherBetter: true },
  { id: "dark", label: "Darkness", tip: "darkness", higherBetter: false },
  { id: "slope", label: "Slope", tip: "slope", higherBetter: false },
];

export default function PlansDrawer() {
  const open = useAppStore((s) => s.plansOpen);
  const plans = useAppStore((s) => s.plans);
  const thresholds = useAppStore((s) => s.thresholds);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "rank", dir: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && store.set({ plansOpen: false });
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const rows = useMemo(() => {
    const withV = plans.map((p) => ({ p, v: computeVerdict(p.summary, thresholds) }));
    const rankCmp = (a: (typeof withV)[0], b: (typeof withV)[0]) =>
      gradeRank(a.v.grade) - gradeRank(b.v.grade) || b.p.summary.usablePct - a.p.summary.usablePct;
    const ranked = [...withV].sort(rankCmp).map((r, i) => ({ ...r, rank: i + 1 }));
    const val = (r: (typeof ranked)[0], c: Col) =>
      c === "sunlit" ? r.p.summary.sunlitPct : c === "earth" ? r.p.summary.earthPct : c === "usable" ? r.p.summary.usablePct
        : c === "dark" ? r.p.summary.longestDarkH : c === "slope" ? r.p.summary.slopeMeanDeg : c === "date" ? r.p.landingMs : r.rank;
    if (sort.col === "rank") return sort.dir === 1 ? ranked : [...ranked].reverse();
    const col = COLS.find((c) => c.id === sort.col);
    const better = col ? (col.higherBetter ? -1 : 1) : 1; // first click = best first
    return [...ranked].sort((a, b) => (val(a, sort.col) - val(b, sort.col)) * better * sort.dir);
  }, [plans, thresholds, sort]);

  const bestId = rows.length > 1 ? rows.find((r) => r.rank === 1)?.p.id : null;
  const worstId = rows.length > 1 ? rows.find((r) => r.rank === rows.length)?.p.id : null;
  const header = (id: Col, label: string, tip?: GlossaryKey) => (
    <th key={id} scope="col" className="px-1.5 py-1.5 text-right font-medium" aria-sort={sort.col === id ? (sort.dir === 1 ? "descending" : "ascending") : "none"}>
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={() => setSort((s) => ({ col: id, dir: s.col === id ? (s.dir === 1 ? -1 : 1) : 1 }))} className={`hover:text-ink ${sort.col === id ? "text-accent" : ""}`}>
          {label}{sort.col === id ? (sort.dir === 1 ? " ▾" : " ▴") : ""}
        </button>
        {tip && <InfoTip k={tip} />}
      </span>
    </th>
  );

  return (
    <div className={`pointer-events-none absolute inset-0 z-40 ${open ? "" : "invisible"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? "pointer-events-auto opacity-100" : "opacity-0"}`} onClick={() => store.set({ plansOpen: false })} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="plans-title"
        className={`pointer-events-auto absolute bottom-0 right-0 top-0 flex w-[720px] max-w-full flex-col border-l border-line bg-panel-solid shadow-[-12px_0_32px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <h2 id="plans-title" className="text-[14px] font-medium text-ink">
            Landing plans <span className="num text-ink-mute">{plans.length}/{MAX_PLANS}</span>
          </h2>
          <button ref={closeRef} type="button" aria-label="Close plans" onClick={() => store.set({ plansOpen: false })} className="grid h-8 w-8 place-items-center rounded-md text-ink-soft hover:bg-white/5 hover:text-ink">
            <IconClose />
          </button>
        </div>

        <div className="side-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {plans.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line-strong p-6 text-center">
              <p className="text-[13px] text-ink">No saved plans yet</p>
              <p className="mt-1 text-[11.5px] text-ink-mute">Analyse a landing ellipse, then press <strong className="text-ink-soft">Save plan</strong> under the verdict. Save several dates or ellipses to compare them here.</p>
              <button type="button" onClick={() => store.set({ plansOpen: false })} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-[#04161a]">Back to the planner</button>
            </div>
          ) : (
            <>
              <p className="mb-2 text-[11px] text-ink-mute">
                Ranked by verdict, then usable time (Sun and Earth both visible). Click a column to sort by it. Verdicts use your current settings.
              </p>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full min-w-[600px] border-collapse text-[11.5px]">
                  <thead className="bg-black/30 text-[10.5px] text-ink-mute">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium">
                        <button type="button" onClick={() => setSort((s) => ({ col: "rank", dir: s.col === "rank" ? (s.dir === 1 ? -1 : 1) : 1 }))} className={`hover:text-ink ${sort.col === "rank" ? "text-accent" : ""}`}>
                          # Plan{sort.col === "rank" ? (sort.dir === 1 ? " ▾" : " ▴") : ""}
                        </button>
                      </th>
                      <th scope="col" className="px-1.5 py-1.5 text-left font-medium">Verdict</th>
                      {COLS.map((c) => header(c.id, c.label, c.tip))}
                      <th scope="col" className="px-2 py-1.5 text-right font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ p, v, rank }) => (
                      <PlanRow key={p.id} p={p} rank={rank} grade={v.grade} best={p.id === bestId} worst={p.id === worstId}
                        editing={editing === p.id} setEditing={(e) => setEditing(e ? p.id : null)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function PlanRow({ p, rank, grade, best, worst, editing, setEditing }: {
  p: SavedPlan; rank: number; grade: "good" | "risky" | "bad"; best: boolean; worst: boolean; editing: boolean; setEditing: (e: boolean) => void;
}) {
  const s = p.summary;
  return (
    <tr className={`border-t border-line align-top ${best ? "bg-[#63d297]/8" : worst ? "bg-[#f0806a]/6" : ""}`}>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="num text-ink-mute">{rank}</span>
          {editing ? (
            <input
              autoFocus
              defaultValue={p.name}
              aria-label="Plan name"
              maxLength={40}
              onBlur={(e) => { renamePlan(p.id, e.target.value); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
              className="w-[110px] rounded border border-accent/60 bg-black/40 px-1 text-[11.5px] text-ink outline-none"
            />
          ) : (
            <button type="button" title="Rename" onClick={() => setEditing(true)} className="max-w-[120px] truncate text-left font-medium text-ink hover:underline">{p.name}</button>
          )}
          {best && <span className="rounded bg-[#63d297] px-1 text-[9px] font-semibold text-[#062214]">BEST</span>}
          {worst && <span className="rounded bg-[#f0806a] px-1 text-[9px] font-semibold text-[#2a0a04]">WORST</span>}
        </div>
        <div className="num mt-0.5 whitespace-nowrap text-[10px] leading-snug text-ink-mute">
          <div>{fmtUtcShort(p.landingMs)} · {p.missionDays} d</div>
          <div>{formatLat(p.ellipse.lat, 2)} {formatLon(p.ellipse.lon, 1)} · {s.areaKm2.toFixed(1)} km²</div>
        </div>
      </td>
      <td className="px-1.5 py-1.5 whitespace-nowrap" style={{ color: GRADE_COLOR[grade] }}>{GRADE_ICON[grade]} {GRADE_LABEL[grade]}</td>
      <td className="num px-1.5 py-1.5 text-right text-[#a9f5cd]">{s.usablePct.toFixed(0)}%</td>
      <td className="num px-1.5 py-1.5 text-right">{s.sunlitPct.toFixed(0)}%</td>
      <td className="num px-1.5 py-1.5 text-right">{s.earthPct.toFixed(0)}%</td>
      <td className="num px-1.5 py-1.5 text-right whitespace-nowrap">{fmtHours(s.longestDarkH)}</td>
      <td className="num px-1.5 py-1.5 text-right">{s.slopeMeanDeg.toFixed(1)}°</td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <button type="button" onClick={() => loadPlan(p.id)} className="rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-white/5">Load</button>
        <button
          type="button"
          aria-label={`Delete ${p.name}`}
          onClick={() => window.confirm(`Delete "${p.name}"?`) && deletePlan(p.id)}
          className="rounded px-1.5 py-0.5 text-[11px] text-ink-mute hover:bg-white/5 hover:text-[#f0a089]"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
