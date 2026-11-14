"use client";
import { useAppStore } from "@/lib/store";

/** Unobtrusive status pill; the scene stays interactive while assets stream. */
export default function LoadingIndicator() {
  const load = useAppStore((s) => s.load);
  const busy = load.globe === "loading" || load.terrainLow === "loading" || load.terrainHigh === "loading";
  const error = load.globe === "error" || load.terrainLow === "error" || load.terrainHigh === "error";
  if (!busy && !error) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`panel enter absolute z-20 flex max-w-[min(420px,calc(100vw-24px))] items-center gap-2.5 px-3 py-2 text-[12px] max-md:right-3 max-md:top-[64px] max-md:max-w-[calc(100vw-120px)] md:bottom-4 md:left-4 ${
        error ? "border-[#d9573e]/50" : ""
      }`}
    >
      {busy && !error && <span className="spinner shrink-0" />}
      <span className={error ? "text-[#f0a089]" : "text-ink-soft"}>
        {load.message ?? (error ? "A dataset could not be loaded." : "Loading…")}
        {error && (
          <span className="block text-[11px] text-ink-mute">
            Check that scripts/process_lunar_data.py has generated public/data/lunar/, then reload.
          </span>
        )}
      </span>
    </div>
  );
}
