"use client";
/**
 * UTC date + hour picker: calendar, 24-hour list (00–23, whole hours) and a Save button.
 * The value only changes when the user presses Save.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const pad = (n: number) => String(n).padStart(2, "0");
export const fmtUtcShort = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00 UTC`;
};
const dayStart = (y: number, m: number, d: number) => Date.UTC(y, m, d);

export default function DateTimePicker({
  value, min, max, onSave, id, compact = false,
}: { value: number | null; min: number; max: number; onSave: (ms: number) => void; id?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const init = value ?? min;
  const [draft, setDraft] = useState(init);
  const [view, setView] = useState(() => ({ y: new Date(init).getUTCFullYear(), m: new Date(init).getUTCMonth() }));
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const hourList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const d = new Date(value ?? min);
    setDraft(value ?? min);
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (root.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open, value, min]);

  // The popup lives in a fixed layer (portal) so scrolling panels and dialogs never clip it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = root.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(300, window.innerWidth - 32), h = 268;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      const top = r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) hourList.current?.querySelector<HTMLElement>("[data-sel='1']")?.scrollIntoView({ block: "center" });
  }, [open]);

  const dd = new Date(draft);
  const selDay = dayStart(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate());
  const hour = dd.getUTCHours();
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const daysIn = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const minDay = dayStart(new Date(min).getUTCFullYear(), new Date(min).getUTCMonth(), new Date(min).getUTCDate());
  const valid = draft >= min && draft <= max;
  const shift = (n: number) => setView((v) => {
    const m = v.m + n;
    return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });
  const canPrev = Date.UTC(view.y, view.m, 1) > min;
  const canNext = Date.UTC(view.y, view.m + 1, 1) <= max;

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="num flex w-full items-center justify-between rounded border border-line bg-black/30 px-2 py-1.5 text-left text-[12.5px] text-ink outline-none hover:border-line-strong focus-visible:border-accent/60"
      >
        <span className="truncate whitespace-nowrap">{value !== null ? (compact ? fmtUtcShort(value).replace(" UTC", "") : fmtUtcShort(value)) : "Choose date & time"}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-ink-mute" aria-hidden>
          <rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={pop} role="dialog" aria-label="Choose landing date and time (UTC)" style={{ left: pos.left, top: pos.top }} className="enter fixed z-[90] w-[300px] max-w-[calc(100vw-32px)] rounded-lg border border-line-strong bg-[#0d131c] p-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
          <div className="flex gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between">
                <button type="button" aria-label="Previous month" disabled={!canPrev} onClick={() => shift(-1)} className="grid h-6 w-6 place-items-center rounded text-ink-soft hover:bg-white/10 disabled:opacity-25">‹</button>
                <span className="text-[12px] font-medium text-ink">{MONTHS[view.m]} {view.y}</span>
                <button type="button" aria-label="Next month" disabled={!canNext} onClick={() => shift(1)} className="grid h-6 w-6 place-items-center rounded text-ink-soft hover:bg-white/10 disabled:opacity-25">›</button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {DAYS.map((d) => <span key={d} className="py-0.5 text-[9.5px] text-ink-mute">{d}</span>)}
                {cells.map((d, i) => {
                  if (d === null) return <span key={`e${i}`} />;
                  const ms = dayStart(view.y, view.m, d);
                  const disabled = ms < minDay || ms > max;
                  const sel = ms === selDay;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={disabled}
                      aria-pressed={sel}
                      onClick={() => {
                        let t = ms + hour * 3600e3;
                        if (t < min) t = Math.ceil(min / 3600e3) * 3600e3;
                        setDraft(Math.min(t, max));
                      }}
                      className={`num h-6 rounded text-[11px] transition-colors disabled:opacity-20 ${sel ? "bg-accent font-semibold text-[#04161a]" : "text-ink-soft hover:bg-white/10"}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="w-[58px] shrink-0">
              <div className="mb-1.5 text-center text-[10px] text-ink-mute">Hour UTC</div>
              <div ref={hourList} className="side-scroll h-[168px] overflow-y-auto rounded border border-line">
                {Array.from({ length: 24 }, (_, h) => {
                  const t = selDay + h * 3600e3;
                  const disabled = t < min || t > max;
                  const sel = h === hour;
                  return (
                    <button
                      key={h}
                      type="button"
                      data-sel={sel ? "1" : "0"}
                      disabled={disabled}
                      onClick={() => setDraft(t)}
                      className={`num block w-full py-1 text-[11.5px] disabled:opacity-20 ${sel ? "bg-accent font-semibold text-[#04161a]" : "text-ink-soft hover:bg-white/10"}`}
                    >
                      {pad(h)}:00
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <span className="num text-[11px] text-ink-soft">{fmtUtcShort(draft)}</span>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-[11.5px] text-ink-soft hover:bg-white/10">Cancel</button>
              <button
                type="button"
                disabled={!valid}
                onClick={() => {
                  onSave(draft);
                  setOpen(false);
                }}
                className="rounded bg-accent px-3 py-1 text-[11.5px] font-medium text-[#04161a] hover:bg-[#7dd6e3] disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
