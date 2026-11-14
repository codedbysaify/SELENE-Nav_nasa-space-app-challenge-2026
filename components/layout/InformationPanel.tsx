"use client";
import { useEffect, useState } from "react";
import { BASE_LAYERS } from "@/lib/lunar-config";
import { formatLat, formatLon } from "@/lib/lunar-coordinates";
import { useAppStore, type PointReadout } from "@/lib/store";
import { IconChevron } from "@/components/ui/icons";

const MODE = {
  global: { label: "Global view", hint: "Full Moon" },
  approach: { label: "Approach", hint: "Descending to 90°S" },
  terrain: { label: "South Pole terrain", hint: "LOLA 80°S DEM" },
} as const;

function Row({ k, v, accent }: { k: string; v: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="text-[11.5px] text-ink-mute">{k}</dt>
      <dd className={`num text-right text-[12px] ${accent ? "text-accent" : "text-ink"}`}>{v}</dd>
    </div>
  );
}

function fmtElev(m: number | null) {
  if (m === null) return "—";
  return `${m >= 0 ? "+" : "−"}${Math.abs(m).toLocaleString("en-US", { maximumFractionDigits: 0 })} m`;
}

function PointBlock({ title, p, empty }: { title: string; p: PointReadout | null; empty: string }) {
  return (
    <div>
      <div className="eyebrow mb-1">{title}</div>
      {p ? (
        <dl>
          <Row k="Latitude" v={formatLat(p.lat)} />
          <Row k="Longitude" v={formatLon(p.lon)} />
          <Row k="Elevation" v={fmtElev(p.elevationM)} />
          {p.slopeDeg !== null && <Row k="Slope" v={`${p.slopeDeg.toFixed(1)}°`} />}
          {p.psrFraction !== null && (
            <Row
              k="PSR"
              v={
                p.psrFraction >= 0.5 ? (
                  <span className="text-psr">Permanently shadowed</span>
                ) : p.psrFraction > 0 ? (
                  <span className="text-psr">Partial ({Math.round(p.psrFraction * 100)}%)</span>
                ) : (
                  "No"
                )
              }
            />
          )}
          <p className="mt-1 text-[10px] leading-snug text-ink-mute">{p.source}</p>
        </dl>
      ) : (
        <p className="py-1 text-[11.5px] text-ink-mute">{empty}</p>
      )}
    </div>
  );
}

export default function InformationPanel() {
  const mode = useAppStore((s) => s.viewMode);
  const layer = useAppStore((s) => s.baseLayer);
  const psr = useAppStore((s) => s.psrOverlay);
  const alt = useAppStore((s) => s.altitudeKm);
  const focus = useAppStore((s) => s.focus);
  const cursor = useAppStore((s) => s.cursor);
  const exag = useAppStore((s) => s.exaggeration);
  const [open, setOpen] = useState(true);
  // Keep the Moon unobstructed on narrow screens: start collapsed.
  useEffect(() => {
    if (window.innerWidth < 768) setOpen(false);
  }, []);

  const layerLabel = BASE_LAYERS.find((l) => l.id === layer)?.label ?? layer;

  return (
    <aside
      aria-label="Exploration telemetry"
      className="panel absolute right-3 top-[68px] z-20 w-[272px] max-w-[calc(100vw-24px)] md:right-4 max-md:top-auto max-md:bottom-[72px]"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_3px_rgba(94,200,216,0.18)]" />
          <span className="text-[12px] font-medium text-ink">Lunar South Pole</span>
          <span className="num text-[11px] text-ink-mute">90°S</span>
        </span>
        <IconChevron className={`text-ink-mute transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="enter space-y-3 border-t border-line px-3.5 pb-3.5 pt-3">
          <dl>
            <Row k="View" v={MODE[mode].label} accent />
            <Row k="Altitude above terrain" v={`${alt.toLocaleString("en-US", { maximumFractionDigits: 0 })} km`} />
            <Row k="Layer" v={`${layerLabel}${psr ? " + PSR" : ""}`} />
            <Row k="Vertical exaggeration" v={exag === 1 ? "1× (true)" : `${exag.toFixed(2)}×`} />
          </dl>
          <div className="h-px bg-line" />
          <PointBlock
            title={mode === "global" ? "Exploration target" : "View centre"}
            p={focus}
            empty="Waiting for data…"
          />
          <div className="h-px bg-line" />
          <PointBlock title="Cursor" p={cursor} empty="Hover the surface to sample LOLA data." />
        </div>
      )}
    </aside>
  );
}
