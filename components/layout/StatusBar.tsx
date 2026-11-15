"use client";
/**
 * Always-visible read-out bar (like GIS tools): live values under the cursor, plus one pinned point.
 * Pin: double-click the Moon, press P while hovering, or use the Pin button then click.
 * Unpin: ✕ or Esc. Dragging never pins, and pinning is off while drawing the landing ellipse.
 */
import { formatLat, formatLonAt } from "@/lib/lunar-coordinates";
import { GRADE_ICON, slopeVerdictText } from "@/lib/verdict";
import { store, useAppStore, type PointReadout } from "@/lib/store";
import InfoTip from "@/components/ui/InfoTip";

function fmtElev(m: number | null) {
  if (m === null) return "—";
  return `${m >= 0 ? "+" : "−"}${Math.abs(m).toLocaleString("en-US", { maximumFractionDigits: 0 })} m`;
}

function Values({ p }: { p: PointReadout }) {
  const thresholds = useAppStore((s) => s.thresholds);
  const sv = p.slopeDeg !== null ? slopeVerdictText(p.slopeDeg, thresholds) : null;
  return (
    <span className="num" title={`Source: ${p.source}`}>
      {formatLat(p.lat)} {formatLonAt(p.lat, p.lon)}
      <span className="px-1.5 text-ink-mute">·</span>
      {fmtElev(p.elevationM)}
      {p.slopeDeg !== null && (
        <>
          <span className="px-1.5 text-ink-mute">·</span>slope {p.slopeDeg.toFixed(1)}° {sv && <span title={`Slope verdict (your settings): ${sv.text}`}>{GRADE_ICON[sv.grade]} {sv.text}</span>}
        </>
      )}
      {p.psrFraction !== null && (
        <>
          <span className="px-1.5 text-ink-mute">·</span>
          {p.psrFraction >= 0.5 ? <span className="text-psr">PSR</span> : p.psrFraction > 0 ? <span className="text-psr">PSR {Math.round(p.psrFraction * 100)}%</span> : "no PSR"}
        </>
      )}
    </span>
  );
}

export default function StatusBar() {
  const cursor = useAppStore((s) => s.cursor);
  const pinned = useAppStore((s) => s.pinned);
  const pinMode = useAppStore((s) => s.pinMode);
  const drawing = useAppStore((s) => s.drawing);

  return (
    <div
      role="status"
      aria-label="Surface read-out"
      className="absolute inset-x-0 bottom-6 z-30 flex h-[26px] items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-line bg-[#060a10] px-3 text-[11px] text-ink-soft"
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-mute">Cursor</span>
      <span className="min-w-0 shrink-0">
        {cursor ? <Values p={cursor} /> : <span className="text-ink-mute">Point at the Moon to read LOLA data</span>}
      </span>

      <span className="ml-auto h-3.5 w-px shrink-0 bg-line-strong" />

      {pinned ? (
        <span className="flex shrink-0 items-center gap-2 text-ink">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gold">📍 Pinned</span>
          <Values p={pinned} />
          <button
            type="button"
            aria-label="Unpin point (Esc)"
            title="Unpin (Esc)"
            onClick={() => store.set({ pinned: null, pinMode: false })}
            className="grid h-5 w-5 place-items-center rounded text-ink-mute hover:bg-white/10 hover:text-ink"
          >
            ✕
          </button>
        </span>
      ) : pinMode ? (
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-gold">Click a point on the Moon to pin it</span>
          <button type="button" onClick={() => store.set({ pinMode: false })} className="rounded px-1.5 text-ink-mute hover:bg-white/10 hover:text-ink">
            Cancel (Esc)
          </button>
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden text-ink-mute lg:inline">Double-click or press P to pin</span>
          <InfoTip k="pin" />
          <button
            type="button"
            disabled={drawing}
            title={drawing ? "Finish drawing the landing ellipse first" : "Pin a point: then click the Moon"}
            onClick={() => store.set({ pinMode: true })}
            className="rounded border border-line px-2 py-0.5 text-ink-soft hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            📍 Pin
          </button>
        </span>
      )}
    </div>
  );
}
