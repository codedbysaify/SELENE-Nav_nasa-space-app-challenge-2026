"use client";
/**
 * Saved landing plans (max 10) and share links. No backend: only the small summary of
 * each plan is kept in localStorage (a few hundred bytes per plan), so loading is instant.
 */
import type { EllipseResult, EllipseSpec } from "./planning";
import { decodeThresholds, encodeThresholds, type PlanSummary, type Thresholds } from "./verdict";

export const MAX_PLANS = 10;
const KEY = "selene.plans.v1";

export interface SavedPlan {
  id: string;
  name: string;
  savedAt: number;
  landingMs: number;
  missionDays: number;
  ellipse: EllipseSpec;
  summary: PlanSummary;
}

export const ellipseAreaKm2 = (e: EllipseSpec) => Math.PI * e.aKm * e.bKm;

export function summarize(a: EllipseResult, e: EllipseSpec): PlanSummary {
  let hz = 0;
  for (let i = 0; i < a.centreHorizon.length; i++) hz += a.centreHorizon[i];
  return {
    sunlitPct: a.mission.sunlitPct,
    earthPct: a.mission.earthPct,
    usablePct: a.mission.usablePct,
    longestDarkH: a.mission.longestNightH,
    slopeMeanDeg: a.terrain.slopeMeanDeg,
    slopeMaxDeg: a.terrain.slopeMaxDeg,
    slopeHist: Array.from(a.terrain.slopeHist),
    psrPct: a.terrain.psrPct,
    areaKm2: ellipseAreaKm2(e),
    meanHorizonDeg: hz / Math.max(1, a.centreHorizon.length),
  };
}

export function loadPlans(): SavedPlan[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedPlan[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && p.ellipse && p.summary).slice(0, MAX_PLANS) : [];
  } catch {
    return [];
  }
}

export function storePlans(plans: SavedPlan[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(plans.slice(0, MAX_PLANS)));
  } catch {
    /* storage unavailable: plans last until the page is closed */
  }
}

/* ---------------------------------------------------------------- share links */
const r = (v: number, d: number) => Number(v.toFixed(d));
const encEllipse = (e: EllipseSpec) => [r(e.lat, 4), r(e.lon, 4), r(e.aKm, 3), r(e.bKm, 3), r(e.headingDeg, 1)].join(",");
function decEllipse(v: string | null): EllipseSpec | null {
  if (!v) return null;
  const n = v.split(",").map(Number);
  if (n.length !== 5 || n.some((x) => !Number.isFinite(x))) return null;
  if (n[0] > -80 || n[0] < -90 || n[2] <= 0 || n[3] <= 0 || n[2] > 40) return null;
  return { lat: n[0], lon: n[1], aKm: n[2], bKm: Math.min(n[3], n[2]), headingDeg: ((n[4] % 180) + 180) % 180 };
}

const b64 = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};

export interface CurrentPlan {
  landingMs: number;
  missionDays: number;
  ellipse: EllipseSpec;
}

export function buildShareUrl(current: CurrentPlan | null, thresholds: Thresholds, plans: SavedPlan[] | null): string {
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  const q = u.searchParams;
  if (current) {
    q.set("t", String(Math.round(current.landingMs / 3600e3))); // hours since epoch
    q.set("d", String(current.missionDays));
    q.set("e", encEllipse(current.ellipse));
  }
  q.set("th", encodeThresholds(thresholds));
  if (plans && plans.length) q.set("plans", b64.enc(JSON.stringify(plans)));
  return u.toString();
}

export interface SharedState {
  current: CurrentPlan | null;
  thresholds: Thresholds | null;
  plans: SavedPlan[] | null;
}

export function parseShareUrl(): SharedState {
  const out: SharedState = { current: null, thresholds: null, plans: null };
  try {
    const q = new URLSearchParams(window.location.search);
    out.thresholds = decodeThresholds(q.get("th"));
    const t = Number(q.get("t")), d = Number(q.get("d"));
    const e = decEllipse(q.get("e"));
    if (e && Number.isFinite(t) && t > 0 && Number.isFinite(d) && d >= 1 && d <= 60)
      out.current = { landingMs: t * 3600e3, missionDays: Math.round(d), ellipse: e };
    const p = q.get("plans");
    if (p) {
      const list = JSON.parse(b64.dec(p)) as SavedPlan[];
      if (Array.isArray(list)) out.plans = list.filter((x) => x && x.ellipse && x.summary).slice(0, MAX_PLANS);
    }
  } catch {
    /* malformed link: ignore and start normally */
  }
  return out;
}
