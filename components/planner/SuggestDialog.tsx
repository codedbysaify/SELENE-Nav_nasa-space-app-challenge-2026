"use client";
/** Global "Suggest best date, time & spot": searches the whole 80–90°S region over a date range. */
import { useEffect, useRef, useState } from "react";
import { store, useAppStore } from "@/lib/store";
import { earliestLandingMs, loadEphemeris, type Ephemeris } from "@/lib/ephemeris";
import { suggestGlobal } from "@/lib/planner-actions";
import DateTimePicker from "@/components/ui/DateTimePicker";
import InfoTip from "@/components/ui/InfoTip";
import { IconClose } from "@/components/ui/icons";

const MAX_RANGE_DAYS = 90;

function Field({ label, children, tip }: { label: string; children: React.ReactNode; tip?: React.ReactNode }) {
  return (
    <div>
      <span className="flex items-center gap-1 text-[10.5px] text-ink-mute">{label} {tip}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Num({ id, value, min, max, step, unit, onChange }: { id: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <span className="flex items-center rounded border border-line bg-black/30 focus-within:border-accent/60">
      <input id={id} type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))); }}
        className="num w-full min-w-0 bg-transparent px-2 py-1 text-[12px] text-ink outline-none" />
      <span className="pr-2 text-[10px] text-ink-mute">{unit}</span>
    </span>
  );
}

export default function SuggestDialog() {
  const open = useAppStore((s) => s.suggestOpen);
  const progress = useAppStore((s) => s.searchProgress);
  const slopeLimit = useAppStore((s) => s.thresholds.slope.risky);
  const [eph, setEph] = useState<Ephemeris | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [days, setDays] = useState(14);
  const [lenKm, setLenKm] = useState(10);
  const [widKm, setWidKm] = useState(5);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    loadEphemeris().then((e) => {
      setEph(e);
      const s = store.get();
      const t0 = s.landingMs ?? earliestLandingMs(e);
      setStart((v) => v ?? t0);
      setEnd((v) => v ?? Math.min(t0 + 30 * 86400e3, e.endMs - 90 * 86400e3));
      setDays(s.missionDays);
      if (s.ellipse) {
        setLenKm(+(2 * s.ellipse.aKm).toFixed(1));
        setWidKm(+(2 * s.ellipse.bKm).toFixed(1));
      }
    });
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !store.get().searchProgress && store.set({ suggestOpen: false });
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (!open) return null;
  const minMs = eph ? earliestLandingMs(eph) : 0;
  const maxMs = eph ? eph.endMs - 90 * 86400e3 : 0;
  const rangeDays = start !== null && end !== null ? (end - start) / 86400e3 : 0;
  const valid = eph && start !== null && end !== null && end > start && rangeDays <= MAX_RANGE_DAYS && widKm <= lenKm;
  const area = Math.PI * (lenKm / 2) * (widKm / 2);

  return (
    <div className="absolute inset-0 z-40 grid place-items-center p-3" role="dialog" aria-modal="true" aria-labelledby="suggest-title">
      <div className="absolute inset-0 bg-black/50" onClick={() => !progress && store.set({ suggestOpen: false })} />
      <div className="enter relative w-[380px] max-w-full rounded-lg border border-line-strong bg-panel-solid p-4 shadow-[0_16px_40px_rgba(0,0,0,0.6)]">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 id="suggest-title" className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
              Suggest best date, time & spot <InfoTip k="suggest" />
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-mute">Searches the whole South Pole (80–90°S) for the most usable time on safe slopes.</p>
          </div>
          <button ref={closeRef} type="button" aria-label="Close" disabled={!!progress} onClick={() => store.set({ suggestOpen: false })} className="grid h-7 w-7 place-items-center rounded text-ink-soft hover:bg-white/10 disabled:opacity-40">
            <IconClose />
          </button>
        </div>

        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Earliest landing (UTC)">
              {eph && <DateTimePicker compact value={start} min={minMs} max={maxMs} onSave={(v) => { setStart(v); if (end !== null && (end <= v || end - v > MAX_RANGE_DAYS * 86400e3)) setEnd(Math.min(v + 30 * 86400e3, maxMs)); }} />}
            </Field>
            <Field label="Latest landing (UTC)">
              {eph && <DateTimePicker compact value={end} min={start ?? minMs} max={Math.min(maxMs, (start ?? minMs) + MAX_RANGE_DAYS * 86400e3)} onSave={setEnd} />}
            </Field>
          </div>
          <p className={`text-[10.5px] ${rangeDays > MAX_RANGE_DAYS || rangeDays <= 0 ? "text-[#f0a089]" : "text-ink-mute"}`}>
            Range: {rangeDays.toFixed(0)} days (maximum {MAX_RANGE_DAYS}). Landing times tested every 6 h.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Mission" tip={<InfoTip k="missionLength" />}>
              <Num id="sg-days" value={days} min={1} max={60} step={1} unit="d" onChange={(v) => setDays(Math.round(v))} />
            </Field>
            <Field label="Ellipse length">
              <Num id="sg-len" value={lenKm} min={0.4} max={80} step={0.5} unit="km" onChange={(v) => { setLenKm(v); if (widKm > v) setWidKm(v); }} />
            </Field>
            <Field label="Ellipse width">
              <Num id="sg-wid" value={widKm} min={0.2} max={80} step={0.5} unit="km" onChange={(v) => setWidKm(Math.min(v, lenKm))} />
            </Field>
          </div>
          <p className="text-[10.5px] text-ink-mute">
            Ellipse covers <span className="num text-ink-soft">{area.toFixed(1)} km²</span>. Cells steeper than your unsafe slope limit ({slopeLimit}°) are skipped.
          </p>

          {progress ? (
            <div role="status" aria-live="polite" className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded bg-white/10">
                <div className="h-full bg-[#7df0b0] transition-[width] duration-200" style={{ width: `${Math.round(progress.value * 100)}%` }} />
              </div>
              <p className="text-[11px] text-ink-mute">{progress.label} {Math.round(progress.value * 100)}%</p>
            </div>
          ) : (
            <button
              type="button"
              disabled={!valid}
              onClick={() => start !== null && end !== null && suggestGlobal(start, end, days, lenKm / 2, widKm / 2)}
              className="h-9 w-full rounded-md bg-[#7df0b0] text-[13px] font-medium text-[#062214] hover:bg-[#9bf5c4] disabled:opacity-40"
            >
              Find the best plan
            </button>
          )}
          <p className="text-[10px] leading-snug text-ink-mute">
            Uses the 1.28 km horizon grid, so the result is an estimate; accepting it runs the exact 80 m analysis.
          </p>
        </div>
      </div>
    </div>
  );
}
