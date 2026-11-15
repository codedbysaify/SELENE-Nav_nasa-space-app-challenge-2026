"use client";
/** Copy a share link: asks whether to include the current plan or all saved plans (thresholds always included). */
import { useEffect, useRef, useState } from "react";
import { store, useAppStore } from "@/lib/store";
import { buildShareUrl } from "@/lib/plans";

export default function ShareButton() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"current" | "all">("current");
  const [copied, setCopied] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const hasCurrent = useAppStore((s) => !!(s.ellipse && s.landingMs !== null));
  const nPlans = useAppStore((s) => s.plans.length);

  useEffect(() => {
    if (!open) return;
    setCopied(null);
    setMode(hasCurrent ? "current" : "all");
    const close = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open, hasCurrent]);

  const copy = async () => {
    const s = store.get();
    const current = s.ellipse && s.landingMs !== null ? { landingMs: s.landingMs, missionDays: s.missionDays, ellipse: s.ellipse } : null;
    const url = buildShareUrl(mode === "current" ? current : null, s.thresholds, mode === "all" ? s.plans : null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      window.prompt("Copy this link:", url);
      setCopied(url);
    }
  };

  return (
    <div ref={root} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink">
        <span aria-hidden>🔗</span><span className="hidden md:inline">Share</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Share link" className="enter absolute right-0 top-full z-50 mt-1 w-[260px] rounded-lg border border-line-strong bg-[#0d131c] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
          <p className="mb-2 text-[12px] font-medium text-ink">What should the link include?</p>
          <div className="space-y-1.5 text-[12px]">
            <label className={`flex items-start gap-2 ${hasCurrent ? "text-ink-soft" : "text-ink-mute opacity-50"}`}>
              <input type="radio" name="share" disabled={!hasCurrent} checked={mode === "current"} onChange={() => setMode("current")} className="mt-0.5 accent-[#5ec8d8]" />
              <span>Current plan<span className="block text-[10.5px] text-ink-mute">Date, mission length and ellipse. Opens straight into the analysis.</span></span>
            </label>
            <label className={`flex items-start gap-2 ${nPlans ? "text-ink-soft" : "text-ink-mute opacity-50"}`}>
              <input type="radio" name="share" disabled={!nPlans} checked={mode === "all"} onChange={() => setMode("all")} className="mt-0.5 accent-[#5ec8d8]" />
              <span>All saved plans ({nPlans})<span className="block text-[10.5px] text-ink-mute">Adds them to the receiver&apos;s Plans list for comparison.</span></span>
            </label>
          </div>
          <p className="mt-2 text-[10.5px] text-ink-mute">Your verdict settings are always included.</p>
          <button type="button" onClick={copy} disabled={(mode === "current" && !hasCurrent) || (mode === "all" && !nPlans)}
            className="mt-2 h-8 w-full rounded-md bg-accent text-[12px] font-medium text-[#04161a] hover:bg-[#7dd6e3] disabled:opacity-40">
            {copied ? "✓ Link copied" : "Copy link"}
          </button>
          {!hasCurrent && !nPlans && <p className="mt-1.5 text-[10.5px] text-ink-mute">Set a date and an ellipse first (or save a plan).</p>}
        </div>
      )}
    </div>
  );
}
