/**
 * Site verdict: turns the analysis numbers into ✅ Good / ⚠️ Risky / ❌ Not recommended
 * using user-adjustable thresholds. Pure functions — the underlying numbers never change.
 */
export type Grade = "good" | "risky" | "bad";
export type PresetName = "default" | "strict" | "relaxed" | "custom";

export interface Thresholds {
  preset: PresetName;
  /** Sunlit % over the mission: ≥ good → ✅, ≥ risky → ⚠️, else ❌ (higher is better). */
  power: { risky: number; good: number };
  /** Earth-visible % over the mission (higher is better). */
  contact: { risky: number; good: number };
  /** Mean slope in degrees: ≤ good → ✅, ≤ risky → ⚠️, else ❌ (lower is better). */
  slope: { good: number; risky: number };
  /** Longest continuous darkness in hours (lower is better); optional criterion. */
  darkness: { enabled: boolean; good: number; risky: number };
}

export const PRESETS: Record<Exclude<PresetName, "custom">, Omit<Thresholds, "preset">> = {
  default: { power: { risky: 40, good: 70 }, contact: { risky: 30, good: 60 }, slope: { good: 10, risky: 15 }, darkness: { enabled: false, good: 24, risky: 72 } },
  strict: { power: { risky: 60, good: 85 }, contact: { risky: 50, good: 80 }, slope: { good: 5, risky: 10 }, darkness: { enabled: true, good: 12, risky: 48 } },
  relaxed: { power: { risky: 25, good: 50 }, contact: { risky: 15, good: 40 }, slope: { good: 15, risky: 20 }, darkness: { enabled: false, good: 72, risky: 168 } },
};

export const defaultThresholds = (): Thresholds => ({ preset: "default", ...structuredClone(PRESETS.default) });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** Clamp to valid ranges and keep the two boundaries of each criterion from crossing. */
export function sanitize(t: Thresholds): Thresholds {
  const hi = (o: { risky: number; good: number }) => {
    const risky = clamp(o.risky, 0, 99), good = clamp(o.good, risky + 1, 100);
    return { risky, good };
  };
  const slopeGood = clamp(t.slope.good, 0, 44), darkGood = clamp(t.darkness.good, 0, 1439);
  return {
    preset: t.preset,
    power: hi(t.power),
    contact: hi(t.contact),
    slope: { good: slopeGood, risky: clamp(t.slope.risky, slopeGood + 1, 45) },
    darkness: { enabled: !!t.darkness.enabled, good: darkGood, risky: clamp(t.darkness.risky, darkGood + 1, 1440) },
  };
}

export const gradeHigh = (v: number, t: { risky: number; good: number }): Grade => (v >= t.good ? "good" : v >= t.risky ? "risky" : "bad");
export const gradeLow = (v: number, t: { good: number; risky: number }): Grade => (v <= t.good ? "good" : v <= t.risky ? "risky" : "bad");
const RANK: Record<Grade, number> = { good: 0, risky: 1, bad: 2 };
export const worst = (...g: Grade[]): Grade => g.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "good" as Grade);
export const gradeRank = (g: Grade) => RANK[g];

export const GRADE_ICON: Record<Grade, string> = { good: "✅", risky: "⚠️", bad: "❌" };
export const GRADE_LABEL: Record<Grade, string> = { good: "Good", risky: "Risky", bad: "Not recommended" };
export const GRADE_COLOR: Record<Grade, string> = { good: "#63d297", risky: "#e9b949", bad: "#f0806a" };

/** Numbers a verdict needs (also what a saved plan stores). */
export interface PlanSummary {
  sunlitPct: number;
  earthPct: number;
  usablePct: number;
  longestDarkH: number;
  slopeMeanDeg: number;
  slopeMaxDeg: number;
  /** 1° slope histogram counts (46 bins) so "steeper than X°" works for any threshold. */
  slopeHist: number[];
  psrPct: number;
  areaKm2: number;
  /** Mean terrain-horizon height around the centre, degrees (for the "why" sentence). */
  meanHorizonDeg: number;
}

export interface Row {
  key: "power" | "contact" | "terrain" | "darkness";
  icon: string;
  label: string;
  value: string;
  grade: Grade;
  /** e.g. "needs >70% for ✅" */
  need: string;
}

export interface Verdict {
  grade: Grade;
  rows: Row[];
  why: string;
  steepPct: number;
}

export function steepPercent(s: PlanSummary, limitDeg: number): number {
  const total = s.slopeHist.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let steep = 0;
  for (let d = Math.ceil(limitDeg); d < s.slopeHist.length; d++) steep += s.slopeHist[d];
  return (steep / total) * 100;
}

export function fmtHours(h: number): string {
  if (h < 1) return "under 1 h";
  const d = Math.floor(h / 24), r = Math.round(h - d * 24);
  return d > 0 ? `${d} d ${r} h` : `${r} h`;
}

export function slopeVerdictText(deg: number, t: Thresholds): { grade: Grade; text: string } {
  const g = gradeLow(deg, t.slope);
  return { grade: g, text: g === "good" ? "safe to land" : g === "risky" ? "caution" : "too steep to land" };
}

export function computeVerdict(s: PlanSummary, t: Thresholds): Verdict {
  const power = gradeHigh(s.sunlitPct, t.power);
  const contact = gradeHigh(s.earthPct, t.contact);
  const terrain = gradeLow(s.slopeMeanDeg, t.slope);
  const dark = gradeLow(s.longestDarkH, t.darkness);
  const rows: Row[] = [
    { key: "power", icon: "☀️", label: "Power", value: `${s.sunlitPct.toFixed(0)}% sunlit`, grade: power,
      need: power === "good" ? `✅ at ${t.power.good}% or more` : `needs ≥${t.power.good}% for ✅ · below ${t.power.risky}% is ❌` },
    { key: "contact", icon: "📡", label: "Contact", value: `${s.earthPct.toFixed(0)}% Earth in view`, grade: contact,
      need: contact === "good" ? `✅ at ${t.contact.good}% or more` : `needs ≥${t.contact.good}% for ✅ · below ${t.contact.risky}% is ❌` },
    { key: "terrain", icon: "⛰️", label: "Terrain", value: `${s.slopeMeanDeg.toFixed(1)}° mean slope`, grade: terrain,
      need: terrain === "good" ? `✅ at ${t.slope.good}° or less` : `needs ≤${t.slope.good}° for ✅ · above ${t.slope.risky}° is ❌` },
  ];
  if (t.darkness.enabled)
    rows.push({ key: "darkness", icon: "🌙", label: "Darkness", value: `${fmtHours(s.longestDarkH)} longest`, grade: dark,
      need: dark === "good" ? `✅ at ${t.darkness.good} h or less` : `needs ≤${t.darkness.good} h for ✅ · above ${t.darkness.risky} h is ❌` });
  const grade = worst(...rows.map((r) => r.grade));
  const steepPct = steepPercent(s, t.slope.risky);
  return { grade, rows, why: whySentence(s, { power, contact, terrain, dark, darkOn: t.darkness.enabled }, steepPct, t), steepPct };
}

function whySentence(
  s: PlanSummary,
  g: { power: Grade; contact: Grade; terrain: Grade; dark: Grade; darkOn: boolean },
  steepPct: number,
  t: Thresholds,
): string {
  const parts: string[] = [];
  const walled = s.meanHorizonDeg > 4;
  if (g.power === "bad" && g.contact === "bad") {
    parts.push(
      s.psrPct > 50
        ? "The ellipse is inside a permanently shadowed crater; its walls block both the Sun and Earth."
        : walled
          ? `Surrounding terrain rises about ${s.meanHorizonDeg.toFixed(0)}° above the horizon and blocks the Sun and Earth for most of the mission.`
          : "Both the Sun and Earth stay below the local horizon for most of this mission window.",
    );
  } else {
    if (g.power === "bad") parts.push(`The Sun is hidden for most of the mission (only ${s.sunlitPct.toFixed(0)}% sunlit), so solar power is scarce.`);
    else if (g.power === "risky") parts.push(`Sunlight is available ${s.sunlitPct.toFixed(0)}% of the time, with dark gaps up to ${fmtHours(s.longestDarkH)}.`);
    if (g.contact === "bad") parts.push(`Earth is below the local horizon most of the time (${s.earthPct.toFixed(0)}% in view), so direct radio contact is rare.`);
    else if (g.contact === "risky") parts.push(`Earth is in view ${s.earthPct.toFixed(0)}% of the time, so contact drops out for part of the mission.`);
  }
  if (g.terrain === "bad") parts.push(`The ground is too steep on average (${s.slopeMeanDeg.toFixed(1)}°).`);
  else if (g.terrain === "risky") parts.push(`Slopes average ${s.slopeMeanDeg.toFixed(1)}°, which needs caution.`);
  if (g.darkOn && g.dark === "bad" && g.power !== "bad") parts.push(`The longest darkness lasts ${fmtHours(s.longestDarkH)}.`);
  if (steepPct > 10) parts.push(`${steepPct.toFixed(0)}% of the ellipse is steeper than ${t.slope.risky}°.`);
  if (!parts.length)
    return `Sunlight ${s.sunlitPct.toFixed(0)}% and Earth contact ${s.earthPct.toFixed(0)}% of the mission, on gentle ${s.slopeMeanDeg.toFixed(1)}° slopes.`;
  return parts.join(" ");
}

/* ---------------------------------------------------------------- persistence + URL */
const KEY = "selene.thresholds.v1";

export function loadThresholds(): Thresholds {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultThresholds();
    const t = JSON.parse(raw) as Thresholds;
    return sanitize({ ...defaultThresholds(), ...t, darkness: { ...defaultThresholds().darkness, ...t.darkness } });
  } catch {
    return defaultThresholds();
  }
}

export function saveThresholds(t: Thresholds) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* storage unavailable (private mode / quota): thresholds simply are not remembered */
  }
}

/** Compact form for share links: preset letter + 9 numbers. */
export function encodeThresholds(t: Thresholds): string {
  return [t.preset[0], t.power.risky, t.power.good, t.contact.risky, t.contact.good, t.slope.good, t.slope.risky,
    t.darkness.enabled ? 1 : 0, t.darkness.good, t.darkness.risky].join("_");
}

export function decodeThresholds(v: string | null): Thresholds | null {
  if (!v) return null;
  const p = v.split("_");
  if (p.length !== 10) return null;
  const n = p.slice(1).map(Number);
  if (n.some((x) => !Number.isFinite(x))) return null;
  const preset = ({ d: "default", s: "strict", r: "relaxed", c: "custom" } as Record<string, PresetName>)[p[0]] ?? "custom";
  return sanitize({
    preset, power: { risky: n[0], good: n[1] }, contact: { risky: n[2], good: n[3] }, slope: { good: n[4], risky: n[5] },
    darkness: { enabled: n[6] === 1, good: n[7], risky: n[8] },
  });
}
