"use client";
import { formatLat, formatLonAt } from "@/lib/lunar-coordinates";
import { GRADE_ICON, slopeVerdictText } from "@/lib/verdict";
import { useAppStore, type PointReadout } from "@/lib/store";

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

function SlopeRow({ deg }: { deg: number }) {
  const thresholds = useAppStore((s) => s.thresholds);
  const v = slopeVerdictText(deg, thresholds);
  return <Row k="Slope" v={`${deg.toFixed(1)}° ${GRADE_ICON[v.grade]} ${v.text}`} />;
}

function PointBlock({ title, p, empty }: { title: string; p: PointReadout | null; empty: string }) {
  return (
    <div>
      <div className="eyebrow mb-1">{title}</div>
      {p ? (
        <dl>
          <Row k="Latitude" v={formatLat(p.lat)} />
          <Row k="Longitude" v={formatLonAt(p.lat, p.lon)} />
          <Row k="Elevation" v={fmtElev(p.elevationM)} />
          {p.slopeDeg !== null && <SlopeRow deg={p.slopeDeg} />}
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

/** Telemetry read-out (rendered inside the right-hand SidePanel "Readout" tab). */
export default function InformationPanel() {
  const mode = useAppStore((s) => s.viewMode);
  const alt = useAppStore((s) => s.altitudeKm);
  const focus = useAppStore((s) => s.focus);
  const pinned = useAppStore((s) => s.pinned);

  return (
    <div className="space-y-3">
      <dl>
        <Row k="Target" v="Lunar South Pole · 90°S" accent />
        <Row k="View" v={MODE[mode].label} />
        <Row k="Altitude above terrain" v={`${alt.toLocaleString("en-US", { maximumFractionDigits: 0 })} km`} />
      </dl>
      <div className="h-px bg-line" />
      <PointBlock title={mode === "global" ? "Exploration target" : "View centre"} p={focus} empty="Waiting for data…" />
      <div className="h-px bg-line" />
      <PointBlock title="📍 Pinned point" p={pinned} empty="Live cursor values are in the bar at the bottom. Double-click the Moon, press P or use 📍 Pin to lock a point here." />
    </div>
  );
}
