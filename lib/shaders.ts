/**
 * GLSL for the global Moon and the South Pole terrain.
 *
 * Both surfaces share: the same sun direction, the same lunar photometric
 * model (Lommel–Seeliger / Lambert blend), the same vertical exaggeration, and
 * the same 80°S highlight ring — so the terrain patch merges seamlessly
 * into the globe. Colour ramps are generated from the TypeScript stop lists so
 * the on-screen legends are exactly the colours used on the surface.
 */
import * as THREE from "three";
import { CAP_RADIUS_KM, COLORS, MOON_RADIUS_KM } from "./lunar-config";

export interface RampStop {
  t: number; // 0–1 position along the ramp
  color: string; // sRGB hex
}

/** Elevation ramp (t = 0 → min, 1 → max of the LDEM range). */
export const ELEVATION_RAMP: RampStop[] = [
  { t: 0.0, color: "#1a1d45" },
  { t: 0.22, color: "#28518a" },
  { t: 0.4, color: "#2f8a9b" },
  { t: 0.55, color: "#7fb59a" },
  { t: 0.7, color: "#d8c487" },
  { t: 0.86, color: "#c98d63" },
  { t: 1.0, color: "#f4ece2" },
];

/** Analysis ramp for Sun/Earth statistics (0 = poor → 1 = good). */
export const ANALYSIS_RAMP: RampStop[] = [
  { t: 0.0, color: "#0d0a24" },
  { t: 0.25, color: "#3a2b7c" },
  { t: 0.5, color: "#8d3f8e" },
  { t: 0.75, color: "#e27a4e" },
  { t: 1.0, color: "#f8e38c" },
];
export const EARTH_COLOR = "#4fa8ff";
export const SUN_COLOR = "#ffd27a";
export const ELLIPSE_COLOR = "#ffcf5c";

/** Slope ramp; t = slope / 45° (clamped). */
export const SLOPE_MAX_DEG = 45;
export const SLOPE_RAMP: RampStop[] = [
  { t: 0 / 45, color: "#164a5c" },
  { t: 5 / 45, color: "#2f9e8f" },
  { t: 10 / 45, color: "#c9d46b" },
  { t: 15 / 45, color: "#eaa14d" },
  { t: 20 / 45, color: "#d9573e" },
  { t: 30 / 45, color: "#8f2850" },
  { t: 45 / 45, color: "#3b1236" },
];

/** sRGB components of a hex colour as a GLSL vec3 literal (no colour management). */
function hexToSrgbVec3(hex: string): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  return `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
}

/** Linear-light components (THREE.Color converts sRGB hex → linear working space). */
function hexToLinearVec3(hex: string): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}

function rampGlsl(name: string, stops: RampStop[]): string {
  // Piecewise-linear in sRGB (identical to the CSS linear-gradient legends), then → linear.
  let body = `vec3 ${name}(float t) {\n  t = clamp(t, 0.0, 1.0);\n  vec3 c = ${hexToSrgbVec3(stops[0].color)};\n`;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    body += `  c = mix(c, ${hexToSrgbVec3(b.color)}, clamp((t - ${a.t.toFixed(5)}) / ${(b.t - a.t).toFixed(5)}, 0.0, 1.0));\n`;
  }
  return body + "  return srgbToLinear(c);\n}\n";
}

export const COMMON_GLSL = /* glsl */ `
  #define PI 3.141592653589793
  const float MOON_R = ${MOON_RADIUS_KM.toFixed(4)};
  const float CAP_R = ${CAP_RADIUS_KM.toFixed(4)};
  const float KM_PER_DEG = ${((MOON_RADIUS_KM * Math.PI) / 180).toFixed(5)};

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  // Lunar photometry: blend of Lommel–Seeliger (flat full-disc look) and Lambert (limb darkening).
  float lunarReflectance(vec3 N, vec3 L, vec3 V) {
    float mu0 = max(dot(N, L), 0.0);
    float mu = max(dot(N, V), 0.0);
    float ls = 2.0 * mu0 / (mu0 + mu + 1e-4);
    return mix(mu0, ls, 0.5);
  }
  // Equirectangular uv for a unit direction (scene frame), with seam-safe variant.
  vec2 globeUv(vec3 d) {
    float lon = atan(d.x, d.z);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    return vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
  }
  float capRing(float distKm, float highlight, float time) {
    float w = 3.0 + 9.0 * highlight;
    float ring = exp(-pow(distKm / w, 2.0));
    return ring * highlight * (0.82 + 0.18 * sin(time * 1.6));
  }
  const vec3 ACCENT = ${hexToLinearVec3(COLORS.accent)};
  const vec3 PSR_COLOR = ${hexToLinearVec3(COLORS.psr)};
`;

/** Fragment-only helpers (derivatives). Tarini's seam fix for equirectangular lookups. */
const FRAGMENT_GLSL = /* glsl */ `
  vec2 seamSafe(vec2 uv) {
    vec2 b = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
    return fwidth(uv.x) <= fwidth(b.x) + 1e-7 ? uv : b;
  }
`;

/* ======================================================================= globe */

export const GLOBE_VERTEX = /* glsl */ `
  ${COMMON_GLSL}
  uniform sampler2D uHeight;
  uniform float uExag;
  uniform float uHasHeight;
  varying vec3 vDir;
  varying vec3 vWorldPos;
  void main() {
    vec3 d = normalize(position);
    float lon = atan(d.x, d.z);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    float h = uHasHeight * textureLod(uHeight, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI), 0.0).r;
    vec3 p = d * (MOON_R + h * uExag);
    vDir = d;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const GLOBE_FRAGMENT = /* glsl */ `
  ${COMMON_GLSL}
  ${FRAGMENT_GLSL}
  uniform sampler2D uColor;
  uniform sampler2D uNormal;
  uniform float uHasTex;
  uniform vec3 uSunDir;
  uniform float uExag;
  uniform float uHighlight;
  uniform float uCapCover;
  uniform float uTime;
  varying vec3 vDir;
  varying vec3 vWorldPos;
  void main() {
    vec3 d = normalize(vDir);
    float latDeg = degrees(asin(clamp(d.y, -1.0, 1.0)));
    // The South Pole terrain mesh replaces the globe south of 80°S (dithered cross-fade, ~1 km overlap).
    if (latDeg < -80.04 && hash12(gl_FragCoord.xy) < uCapCover) discard;

    vec2 uv = seamSafe(globeUv(d));
    vec3 albedo = uHasTex > 0.5 ? texture2D(uColor, uv).rgb : vec3(0.18);
    vec3 n = texture2D(uNormal, uv).rgb * 2.0 - 1.0;
    // The global normal map is coarse (3.8 km); keep its relief gentle so grazing polar sunlight
    // does not turn it into streaks. True relief near the pole comes from the LOLA terrain mesh.
    n = uHasTex > 0.5 ? normalize(vec3(n.xy * min(uExag, 1.5) * 0.7, max(n.z, 1e-3))) : vec3(0.0, 0.0, 1.0);
    vec3 E = cross(vec3(0.0, 1.0, 0.0), d);
    E = length(E) < 1e-5 ? vec3(1.0, 0.0, 0.0) : normalize(E);
    vec3 Nn = cross(d, E);
    vec3 N = normalize(E * n.x + Nn * n.y + d * n.z);

    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float lit = lunarReflectance(N, L, V);
    vec3 color = albedo * (lit * 1.55 + 0.03);

    // South Pole highlight: 80°S ring + faint cap tint, fading as the camera approaches.
    float distKm = (latDeg + 80.0) * KM_PER_DEG;
    color += ACCENT * capRing(distKm, uHighlight, uTime) * 0.9;
    color = mix(color, color + ACCENT * 0.10, step(latDeg, -80.0) * uHighlight);

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ===================================================================== terrain */

export const TERRAIN_VERTEX = /* glsl */ `
  ${COMMON_GLSL}
  attribute float aHeight;
  attribute vec2 aMap;
  uniform float uExag;
  varying vec2 vUv;
  varying vec2 vMap;
  varying vec3 vDir;
  varying vec3 vWorldPos;
  void main() {
    vec3 d = normalize(position);
    vec3 p = d * (MOON_R + aHeight * uExag);
    vUv = uv;
    vMap = aMap;
    vDir = d;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const TERRAIN_FRAGMENT = /* glsl */ `
  ${COMMON_GLSL}
  ${FRAGMENT_GLSL}
  ${rampGlsl("elevationRamp", ELEVATION_RAMP)}
  ${rampGlsl("slopeRamp", SLOPE_RAMP)}
  ${rampGlsl("analysisRamp", ANALYSIS_RAMP)}
  uniform sampler2D uPlanTex;   // overview (1.28 km): r = Sun fraction / sunlit %, g = Earth, b = longest night
  uniform float uPlanMode;      // 0 off · 1 sun now · 2 Earth now · 3 sunlit % · 4 Earth % · 5 longest night
  uniform float uPlanOpacity;
  uniform sampler2D uFineTex;   // 80 m ellipse analysis (same channels as uPlanTex for modes 1–2)
  uniform vec4 uFineBox;        // x0, y1 (top), width km, height km
  uniform float uFineOn;
  uniform vec4 uEllipse;        // centre x, y (km) and major-axis unit vector
  uniform vec2 uEllipseAB;      // semi-axes km
  uniform float uEllipseOn;
  uniform sampler2D uVisual;   // r: NASA hillshade, g/b: normal x/y (map frame)
  uniform sampler2D uScience;  // r: elevation, g: slope, b: PSR fraction
  uniform sampler2D uGlobeColor;
  uniform float uHasGlobe;
  uniform vec3 uSunDir;
  uniform float uExag;
  uniform vec3 uLayerW;        // weights: hillshade, elevation, slope
  uniform float uPsr;          // PSR overlay opacity
  uniform float uHighlight;
  uniform float uEdgeBlend;
  uniform float uGlobeMix;     // whole-cap blend to the globe look at global range
  uniform float uDitherMin;
  uniform float uDitherMax;
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vMap;
  varying vec3 vDir;
  varying vec3 vWorldPos;

  vec3 stereoDir(vec2 m) {
    float r2 = dot(m, m);
    float dd = 4.0 * MOON_R * MOON_R + r2;
    return vec3(4.0 * MOON_R * m.x, -(4.0 * MOON_R * MOON_R - r2), 4.0 * MOON_R * m.y) / dd;
  }

  void main() {
    float hs = hash12(gl_FragCoord.xy);
    if (hs < uDitherMin || hs >= uDitherMax) discard;

    vec4 vis = texture2D(uVisual, vUv);
    vec4 sci = texture2D(uScience, vUv);

    // Exact local frame of the stereographic map at this point.
    vec3 U = normalize(vDir);
    const float e = 0.5;
    vec3 tX = normalize(stereoDir(vMap + vec2(e, 0.0)) - stereoDir(vMap - vec2(e, 0.0)));
    vec3 tY = normalize(stereoDir(vMap + vec2(0.0, e)) - stereoDir(vMap - vec2(0.0, e)));
    vec2 nxy = vis.gb * (255.0 / 127.5) - 1.0;
    float nz = sqrt(max(1.0 - dot(nxy, nxy), 0.0));
    vec3 nm = normalize(vec3(nxy * uExag, nz));   // exaggeration scales the gradient exactly
    vec3 N = normalize(tX * nm.x + tY * nm.y + U * nm.z);

    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float lit = lunarReflectance(N, L, V);
    float dayside = smoothstep(-0.06, 0.18, dot(U, L));
    // Near the pole the Sun is always within ~1.6° of the horizon: use a narrow day/night transition there.
    float polarDay = smoothstep(-0.05, 0.05, dot(U, L));

    // --- base layers
    vec3 hill = srgbToLinear(vec3(vis.r)) * mix(0.16, 1.0, polarDay);
    vec3 elev = elevationRamp(sci.r) * (0.30 + 0.95 * lit);
    vec3 slope = slopeRamp(sci.g * 90.0 / ${SLOPE_MAX_DEG.toFixed(1)}) * (0.40 + 0.80 * lit);
    vec3 color = hill * uLayerW.x + elev * uLayerW.y + slope * uLayerW.z;

    // --- PSR overlay (LPSR fraction of 20 m pixels per texel)
    float psr = sci.b;
    color = mix(color, PSR_COLOR * (0.55 + 0.45 * dayside), smoothstep(0.0, 0.5, psr) * uPsr * 0.88);

    // --- seamless blend into the global LROC mosaic towards 80°S
    float rho = length(vMap);
    if (uHasGlobe > 0.5) {
      float edge = max(smoothstep(CAP_R - 30.0, CAP_R - 1.0, rho) * uEdgeBlend, uGlobeMix);
      vec2 guv = seamSafe(globeUv(U));
      vec3 gcol = texture2D(uGlobeColor, guv).rgb * (lit * 1.55 + 0.012);
      color = mix(color, gcol, edge);
    }

    // --- Sun / Earth analysis overlays (terrain horizon, real ephemeris)
    if (uPlanMode > 0.5) {
      vec4 pv = texture2D(uPlanTex, vec2(vUv.x, 1.0 - vUv.y));
      if (uFineOn > 0.5) {
        vec2 fuv = vec2((vMap.x - uFineBox.x) / uFineBox.z, (uFineBox.y - vMap.y) / uFineBox.w);
        if (all(greaterThanEqual(fuv, vec2(0.0))) && all(lessThanEqual(fuv, vec2(1.0)))) {
          vec4 fv = texture2D(uFineTex, fuv);
          if (fv.a > 0.5) pv.rg = fv.rg;   // 80 m result inside the ellipse
        }
      }
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 base = vec3(luma);
      vec3 ov = color;
      if (uPlanMode < 1.5) {                 // Sun now: shadowed terrain goes dark, lit terrain warm
        ov = mix(base * 0.10 + vec3(0.002, 0.004, 0.012), base * 1.05 + ${hexToLinearVec3(SUN_COLOR)} * 0.05, pv.r);
      } else if (uPlanMode < 2.5) {          // Earth now: blue where Earth is above the terrain horizon
        ov = mix(base * 0.35, base * 0.55 + ${hexToLinearVec3(EARTH_COLOR)} * 0.45, pv.g);
      } else if (uPlanMode < 3.5) {
        ov = analysisRamp(pv.r) * (0.55 + 0.6 * luma);
      } else if (uPlanMode < 4.5) {
        ov = analysisRamp(pv.g) * (0.55 + 0.6 * luma);
      } else {
        ov = analysisRamp(1.0 - pv.b) * (0.55 + 0.6 * luma);
      }
      color = mix(color, ov, uPlanOpacity * step(rho, CAP_R + 0.5));
    }

    // --- landing ellipse
    if (uEllipseOn > 0.5) {
      vec2 dv = vMap - uEllipse.xy;
      vec2 pq = vec2(dot(dv, uEllipse.zw), dot(dv, vec2(-uEllipse.w, uEllipse.z))) / uEllipseAB;
      float k = length(pq);
      float fw = max(fwidth(k), 1e-5);
      float ring = 1.0 - smoothstep(1.2 * fw, 2.6 * fw, abs(k - 1.0));
      color = mix(color, ${hexToLinearVec3(ELLIPSE_COLOR)}, ring * 0.95);
      color += ${hexToLinearVec3(ELLIPSE_COLOR)} * 0.035 * step(k, 1.0);
    }

    // --- South Pole highlight (global view)
    color += ACCENT * capRing(CAP_R - rho, uHighlight, uTime) * 0.9;
    color += ACCENT * 0.10 * uHighlight;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ===================================================================== uniforms */

/** Uniforms shared (by reference) between globe and terrain materials. */
export const sharedUniforms = {
  uSunDir: { value: new THREE.Vector3(-0.5, -0.3, 0.8).normalize() },
  uExag: { value: 2 },
  uHighlight: { value: 1 },
  uTime: { value: 0 },
  uLayerW: { value: new THREE.Vector3(1, 0, 0) },
  uPsr: { value: 0 },
  uEdgeBlend: { value: 1 },
  uGlobeMix: { value: 1 },
  uCapCover: { value: 0 },
  uPlanTex: { value: null as THREE.Texture | null },
  uPlanMode: { value: 0 },
  uPlanOpacity: { value: 0 },
  uFineTex: { value: null as THREE.Texture | null },
  uFineBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  uFineOn: { value: 0 },
  uEllipse: { value: new THREE.Vector4(0, 0, 0, 1) },
  uEllipseAB: { value: new THREE.Vector2(1, 1) },
  uEllipseOn: { value: 0 },
};

/** Scene-frame unit vector towards the Sun from its sub-solar point (scene = MOON_ME(Y, Z, X)). */
export function sunDirectionFromSubpoint(latDeg: number, lonDeg: number, out = new THREE.Vector3()) {
  const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
  return out.set(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
}
