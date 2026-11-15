# SELENE-Nav v3 — implementation plan and handoff notes

**Purpose of this file:** if work stops midway, another developer/model can finish from here.
Update the checklist in section 5 as tasks complete.

Baseline: commit "Add always-visible status bar with point pinning" (v2.2).
Read `docs/SELENE-Nav-overview.md` first for how v1/v2 work.

## 1. Hard rules
- **Do NOT change** calculations, data files in `public/data/lunar/`, or the horizon/ray logic
  (`scripts/*.py`, `horizonProfile`, `skyPosition`, `sunFraction`, `earthTopocentric`).
  Only *additional outputs* computed with the same functions are allowed (listed in 3.1).
- No backend. Persist only small JSON in `localStorage` (try/catch, fall back to defaults).
- Verdict must be readable without scrolling at 1366×768 and on mobile width.
- Time slider must never change the verdict or key numbers.
- Git push from the cloud session fails (403). Deliver a zip (`git archive`) to the user.

## 2. Agreed requirements (user decisions)
1. **Date picker:** custom calendar + 24-hour list (whole hours, UTC) + **Save** button.
2. **(i) help** next to every field: opens on hover and on click. Short, plain definitions.
3. **Pin marker** on the Moon for the pinned point.
4. **Longitude at 90°S:** show "— (pole)".
5. **Slope verdict line:** ✅ < 10° safe, ⚠️ 10–15° caution, ❌ > 15° unsafe (uses thresholds).
6. **Verdict card** at top of results: ✅ Good / ⚠️ Risky / ❌ Not recommended = worst of
   ☀️ Power (sunlit % over mission), 📡 Contact (Earth visible %), ⛰️ Terrain (mean slope),
   optional 🌙 Longest darkness (off by default). One row each showing the active threshold,
   e.g. "Power ❌ 30% (needs >70% for ✅)". One plain-English "why" sentence. Terrain: verdict by
   mean slope + warning in the "why" sentence when > 10 % of the ellipse is steeper than the unsafe limit.
7. **4 key numbers:** Sunlit %, Longest darkness, Earth visible %, Usable time % (Sun AND Earth).
8. Everything else (landing-moment values, slope/PSR stats, charts, panorama) in collapsed
   **"Show details"** sections. Plain labels:
   "Power + link" → "Usable time"; "Earthrise > 90 days" → "No Earth contact for 90+ days";
   "horizon 14.99° az 2°" → "Sun 6.8° high, terrain 15° high → blocked".
9. **Sunlight & shadows layer OFF by default.** Timeline changes are shown **only inside the
   ellipse** (80 m result). When shadows are on, the map outside the ellipse is dimmed.
10. **After analysis, base layers (hillshade/elevation/slope) apply only inside the ellipse**;
    outside = dimmed grey hillshade. Elevation colours re-scale to the ellipse's own min–max;
    slope keeps the fixed 0–45° scale.
11. **Whole-region maps** (mission and 2027 statistics) stay as optional layers, OFF by default,
    never auto-enabled, unaffected by the time slider.
12. **Labels:** collision detection; after an ellipse exists show only labels within ~30 km of it.
13. **Find a better spot nearby** (shown when verdict is ⚠️/❌): search within 20 km (1.28 km grid)
    for the cell with highest usable time, excluding unsafe slopes (current thresholds). Show as a
    ghost ellipse stating its **area (km²)**, with "Move ellipse here" (auto re-runs 80 m analysis)
    and "Dismiss".
14. **Suggest best date, time and spot** (global button, any time): dialog with date range
    (≤ 90 days), mission length, ellipse length/width. Searches whole 80–90°S, landing times every
    6 h, progress bar. Single best result as ghost ellipse with date/time, usable %, area (km²),
    "Use this plan" (sets date + ellipse, auto-runs analysis) / "Dismiss".
15. **Verdict settings (⚙️):** dual-handle sliders + number inputs per criterion.
    Defaults: Power ✅ >70 ⚠️ 40–70 ❌ <40 · Contact ✅ >60 ⚠️ 30–60 ❌ <30 ·
    Slope ✅ <10° ⚠️ 10–15° ❌ >15° · Darkness (optional) ✅ <24 h ⚠️ 24–72 h ❌ >72 h.
    Presets Default / Strict / Relaxed / Custom. Handles cannot cross; clamp 0–100 %, 0–45°.
    Instant re-verdict, numbers unchanged. "Reset to default". Saved in localStorage.
16. **Saved plans + comparison:** separate **slide-out drawer**; up to **10** plans; survive
    reload (store only the summary numbers — small and fast). Table ranked verdict → usable time
    by default, plus click-to-sort columns. Best / worst badges. Load / delete.
17. **Share link:** "Copy link" asks *current plan* or *all saved plans*; always includes thresholds.
    Opening a link restores state and re-runs the analysis.

## 3. Technical design

### 3.1 Worker additions (`lib/planning.worker.ts`, API in `lib/planning.ts`)
Add to the ellipse result (same loops, no formula changes):
- `usablePct` — mean over cells and hours of (sunFraction > 0 AND Earth visible)
- `slopeHist` — Uint32Array(46), 1° bins of the 80 m slope (for "steeper than X" at any threshold)
- `elevMinM`, `elevMaxM` — ground height range inside the ellipse
New messages:
- `search-nearby` {cx, cy (map km), radiusKm, startMs, hours, slopeMaxDeg} → best overview cell
  {lat, lon, usablePct, sunlitPct, earthPct} (slope from the 640 m query grid; cap interior only)
- `search-global` {rangeStartMs, rangeEndMs, missionHours, slopeMaxDeg} → best {lat, lon,
  landingMs, usablePct}. Method: samples every 3 h; per-cell ring buffer of the last W samples
  (W = mission/3 h) gives a sliding-window sum; evaluate starts every 6 h; progress messages.
  Skip the Earth test when the Sun is hidden (usable needs both).

### 3.2 New/changed modules
- `lib/verdict.ts` — thresholds type, presets, `grade()`, `computeVerdict(summary, thresholds)`,
  `whySentence()`, `slopeGrade()`, localStorage load/save, URL encode/decode.
- `lib/glossary.ts` — definitions for (i) tips.
- `lib/plans.ts` — SavedPlan type, add/remove/load (≤ 10), localStorage, share-link build/parse.
- `lib/store.ts` — add: thresholds, plans, drawerOpen, suggestion (ghost), suggestOpen.
- `lib/planner-actions.ts` — `runAnalysis` no longer enables any layer; add `findBetterNearby`,
  `suggestGlobal`, `applySuggestion`, `savePlan`, `loadPlan`, URL restore on startup.
- `lib/shaders.ts` (terrain fragment) — uniforms `uFocus` (0/1), `uElevLocal` (vec2),
  ghost ellipse (`uGhost`, `uGhostAB`, `uGhostOn`, dashed outline). When `uFocus` = 1: outside the
  ellipse use dimmed grey hillshade; inside use the chosen base layer (elevation re-scaled).
  "Now" modes (1–2) draw only inside the ellipse from `uFineTex`; whole-region stats modes (3–5)
  still draw everywhere.
- `components/lunar/PlanOverlay.tsx` — stop requesting the whole-region hourly map; only
  `ellipseAt(ms)`; set focus/ghost uniforms.
- `components/lunar/SiteMarkers.tsx` — collision detection + 30 km filter.
- `components/lunar/PinMarker.tsx` — gold marker at the pinned point.
- `components/ui/InfoTip.tsx`, `components/ui/DateTimePicker.tsx`, `components/ui/DualRange.tsx`.
- `components/planner/VerdictCard.tsx`, `VerdictSettings.tsx`, `Details.tsx` (collapsibles),
  refactored `PlannerPanel.tsx`; `SuggestDialog.tsx`; `PlansDrawer.tsx`; `ShareButton.tsx`.
- `components/ui/LayerSelector.tsx` — Sun & Earth dropdown groups: "Inside your ellipse"
  (needs analysis), "Whole South Pole · your mission", "Whole South Pole · 2027"; default Off.
- `components/layout/StatusBar.tsx` / `InformationPanel.tsx` — "— (pole)" longitude, slope verdict.
- `components/layout/TopBar.tsx` — buttons "Suggest best plan" and "Plans (n)".

### 3.3 Storage keys / URL
- localStorage: `selene.thresholds.v1`, `selene.plans.v1`.
- URL: `?t=<landingMs>&d=<days>&e=<lat>,<lon>,<aKm>,<bKm>,<heading>&th=<compact thresholds>`
  and optionally `&plans=<base64url JSON>`.

## 4. Testing (Playwright scripts live in the session scratchpad; re-create if needed)
Dev server: `npm run dev`, open `/?quality=low` (software rendering is slow; GSAP tweens crawl —
set camera through `window.__seleneRig` in dev). Checks:
- date picker Save / 24 h; (i) tips; verdict for Shackleton floor (❌) and Mons Malapert;
- thresholds change verdict but not numbers; persistence after reload;
- slider does not change verdict/key numbers; shadows only inside ellipse;
- nearby search + move; global suggest + use; save 2 plans, compare, sort, delete; share link restore;
- label collisions; pin marker; `npx tsc --noEmit`; `npx next build`; 1366×768 and 390 px wide.

## 5. Progress checklist
- [x] A. Worker additions + planning.ts API (3.1)
- [x] B. verdict.ts, glossary.ts, plans.ts, store additions
- [x] C. Shader focus/ghost, PlanOverlay ellipse-only timeline, PinMarker, label collisions
- [x] D. InfoTip, DateTimePicker, DualRange
- [x] E. PlannerPanel refactor: VerdictCard, key numbers, details, settings
- [x] F. Nearby search UI + ghost ellipse flow
- [x] G. Suggest dialog (global)
- [x] H. Plans drawer + compare + share link + URL restore
- [x] I. LayerSelector / StatusBar / Readout / TopBar updates
- [x] J. Tests, build, README + overview doc update, commit, zip to user
