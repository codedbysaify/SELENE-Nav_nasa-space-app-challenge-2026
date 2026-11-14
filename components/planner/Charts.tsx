"use client";
/** Small SVG charts for the ellipse-centre analysis (no chart library needed). */
import { EARTH_COLOR, SUN_COLOR } from "@/lib/shaders";

const W = 288;

/** Sun & Earth elevation vs. the terrain horizon in their direction, over the mission. */
export function ElevationChart({ series, hours, landingMs, timeMs }: { series: Float32Array; hours: number; landingMs: number; timeMs: number | null }) {
  const H = 132, padL = 30, padR = 6, padT = 8, padB = 18;
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < hours; t++) {
    for (const k of [0, 1, 3, 4]) {
      lo = Math.min(lo, series[t * 6 + k]);
      hi = Math.max(hi, series[t * 6 + k]);
    }
  }
  lo = Math.floor(lo) - 0.5;
  hi = Math.ceil(hi) + 0.5;
  const x = (t: number) => padL + (t / Math.max(1, hours - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (k: number) => {
    let d = "";
    for (let t = 0; t < hours; t++) d += `${t ? "L" : "M"}${x(t).toFixed(1)},${y(series[t * 6 + k]).toFixed(1)}`;
    return d;
  };
  // shaded spans where the Sun / Earth is above its terrain horizon
  const spans = (kEl: number, kHz: number, pad = 0) => {
    const out: [number, number][] = [];
    let s = -1;
    for (let t = 0; t <= hours; t++) {
      const up = t < hours && series[t * 6 + kEl] + pad > series[t * 6 + kHz];
      if (up && s < 0) s = t;
      if (!up && s >= 0) {
        out.push([s, t - 1]);
        s = -1;
      }
    }
    return out;
  };
  const days = Math.round(hours / 24);
  const tickEvery = days > 20 ? 7 : days > 8 ? 2 : 1;
  const cursor = timeMs !== null ? (timeMs - landingMs) / 3600e3 : null;
  const yTicks = [Math.ceil(lo), 0, Math.floor(hi)].filter((v, i, a) => a.indexOf(v) === i && v >= lo && v <= hi);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sun and Earth elevation versus terrain horizon over the mission">
      {spans(0, 1, 0.27).map(([a, b], i) => (
        <rect key={`s${i}`} x={x(a)} width={Math.max(1, x(b) - x(a))} y={padT} height={4} fill={SUN_COLOR} opacity={0.85} />
      ))}
      {spans(3, 4).map(([a, b], i) => (
        <rect key={`e${i}`} x={x(a)} width={Math.max(1, x(b) - x(a))} y={padT + 6} height={4} fill={EARTH_COLOR} opacity={0.85} />
      ))}
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="rgba(148,170,196,0.14)" />
          <text x={padL - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill="#6c7889" className="num">{v}°</text>
        </g>
      ))}
      {Array.from({ length: Math.floor(days / tickEvery) + 1 }, (_, i) => i * tickEvery).map((d) => (
        <text key={d} x={x(d * 24)} y={H - 5} fontSize="9" textAnchor="middle" fill="#6c7889" className="num">d{d}</text>
      ))}
      <path d={path(1)} fill="none" stroke={SUN_COLOR} strokeOpacity={0.45} strokeDasharray="3 3" strokeWidth={1} />
      <path d={path(4)} fill="none" stroke={EARTH_COLOR} strokeOpacity={0.45} strokeDasharray="3 3" strokeWidth={1} />
      <path d={path(0)} fill="none" stroke={SUN_COLOR} strokeWidth={1.6} />
      <path d={path(3)} fill="none" stroke={EARTH_COLOR} strokeWidth={1.6} />
      {cursor !== null && cursor >= 0 && cursor <= hours && (
        <line x1={x(cursor)} x2={x(cursor)} y1={padT} y2={H - padB} stroke="#e8edf3" strokeOpacity={0.7} />
      )}
    </svg>
  );
}

/** 360° horizon panorama from the ellipse centre with the Sun and Earth tracks over the mission. */
export function HorizonPanorama({ horizon, series, hours, timeMs, landingMs }: { horizon: Float32Array; series: Float32Array; hours: number; timeMs: number | null; landingMs: number }) {
  const H = 116, padL = 26, padB = 16, padT = 6;
  let hi = 4, lo = -2;
  for (let i = 0; i < horizon.length; i++) hi = Math.max(hi, horizon[i]);
  for (let t = 0; t < hours; t++) {
    hi = Math.max(hi, series[t * 6], series[t * 6 + 3]);
    lo = Math.min(lo, series[t * 6], series[t * 6 + 3]);
  }
  hi = Math.min(Math.ceil(hi + 1), 40);
  lo = Math.max(Math.floor(lo - 1), -10);
  const x = (az: number) => padL + (az / 360) * (W - padL - 4);
  const y = (v: number) => padT + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - padT - padB);
  let ground = `M${x(0)},${y(lo)}`;
  for (let i = 0; i <= 360; i++) ground += `L${x(i).toFixed(1)},${y(horizon[i % 360]).toFixed(1)}`;
  ground += `L${x(360)},${y(lo)}Z`;
  const track = (kEl: number, kAz: number) => {
    let d = "";
    let prevAz = -1;
    for (let t = 0; t < hours; t += 1) {
      const az = series[t * 6 + kAz], el = series[t * 6 + kEl];
      d += `${prevAz < 0 || Math.abs(az - prevAz) > 180 ? "M" : "L"}${x(az).toFixed(1)},${y(el).toFixed(1)}`;
      prevAz = az;
    }
    return d;
  };
  const ti = timeMs !== null ? Math.round((timeMs - landingMs) / 3600e3) : -1;
  const now = ti >= 0 && ti < hours ? ti : -1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Horizon panorama from the landing-ellipse centre">
      {[0, 90, 180, 270, 360].map((a) => (
        <g key={a}>
          <line x1={x(a)} x2={x(a)} y1={padT} y2={H - padB} stroke="rgba(148,170,196,0.12)" />
          <text x={x(a)} y={H - 4} fontSize="9" textAnchor="middle" fill="#6c7889">{["N", "E", "S", "W", "N"][a / 90]}</text>
        </g>
      ))}
      <line x1={padL} x2={W - 4} y1={y(0)} y2={y(0)} stroke="rgba(148,170,196,0.35)" strokeDasharray="2 3" />
      <text x={padL - 4} y={y(0) + 3} fontSize="9" textAnchor="end" fill="#6c7889">0°</text>
      <text x={padL - 4} y={y(hi) + 8} fontSize="9" textAnchor="end" fill="#6c7889">{hi}°</text>
      <path d={track(0, 2)} fill="none" stroke={SUN_COLOR} strokeWidth={1.2} strokeOpacity={0.7} />
      <path d={track(3, 5)} fill="none" stroke={EARTH_COLOR} strokeWidth={1.2} strokeOpacity={0.7} />
      <path d={ground} fill="#2b2f36" stroke="#8a94a6" strokeWidth={0.8} />
      {now >= 0 && (
        <>
          <circle cx={x(series[now * 6 + 2])} cy={y(series[now * 6])} r={4} fill={SUN_COLOR} stroke="#000" strokeWidth={0.5} />
          <circle cx={x(series[now * 6 + 5])} cy={y(series[now * 6 + 3])} r={4} fill={EARTH_COLOR} stroke="#000" strokeWidth={0.5} />
        </>
      )}
    </svg>
  );
}
