/// <reference lib="webworker" />
/**
 * Terrain geometry builder (runs off the main thread).
 *
 * Input: the int16 LOLA height grid (metres, block-centred nodes in the
 * south-polar stereographic frame). Output: transferable vertex buffers in
 * the scene frame (km):
 *   position  — unit direction × R (reference sphere); the vertex shader adds
 *               height × exaggeration along the radial direction
 *   aHeight   — LOLA height, km (true value, never exaggerated here)
 *   aMap      — stereographic (x, y) km, used for exact per-fragment frames
 *   uv        — texture coordinates (flipY convention: v = 0 at y = ymin)
 * Nodes outside the 80°S circle are projected radially onto it so the mesh
 * boundary is the 80°S parallel; triangles collapsed onto the circle are dropped.
 */
import { sampleBilinear, type GridSpec } from "./terrain-sampling";

interface BuildRequest {
  id: number;
  heights: ArrayBuffer; // Int16 metres
  size: number;
  halfExtentKm: number;
  capRadiusKm: number;
  radiusKm: number;
}

self.onmessage = (ev: MessageEvent<BuildRequest>) => {
  const { id, heights, size: n, halfExtentKm: half, capRadiusKm: rCap, radiusKm: R } = ev.data;
  const t0 = performance.now();
  const src = new Int16Array(heights);
  const gridM = new Float32Array(n * n);
  for (let i = 0; i < gridM.length; i++) gridM[i] = src[i];
  const spec: GridSpec = { size: n, halfExtentKm: half };
  const cell = (2 * half) / n;

  const count = n * n;
  const position = new Float32Array(count * 3);
  const aHeight = new Float32Array(count);
  const aMap = new Float32Array(count * 2);
  const uv = new Float32Array(count * 2);
  const outside = new Uint8Array(count);

  let k = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++, k++) {
      let x = -half + (c + 0.5) * cell;
      let y = half - (r + 0.5) * cell;
      const rho = Math.hypot(x, y);
      let h: number;
      if (rho > rCap) {
        x *= rCap / rho;
        y *= rCap / rho;
        outside[k] = 1;
        h = sampleBilinear(gridM, spec, x, y);
      } else {
        h = gridM[k];
      }
      // inverse stereographic → unit direction (scene frame), rational form
      const rho2 = x * x + y * y;
      const d = 4 * R * R + rho2;
      position[k * 3] = ((4 * R * x) / d) * R;
      position[k * 3 + 1] = (-(4 * R * R - rho2) / d) * R;
      position[k * 3 + 2] = ((4 * R * y) / d) * R;
      aHeight[k] = h / 1000;
      aMap[k * 2] = x;
      aMap[k * 2 + 1] = y;
      uv[k * 2] = (x + half) / (2 * half);
      uv[k * 2 + 1] = (y + half) / (2 * half);
    }
  }

  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let m = 0;
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c, b = a + 1, cc = a + n, dd = cc + 1;
      // winding: counter-clockwise when viewed from outside (below the south pole)
      if (!(outside[a] && outside[cc] && outside[b])) {
        idx[m++] = a; idx[m++] = cc; idx[m++] = b;
      }
      if (!(outside[b] && outside[cc] && outside[dd])) {
        idx[m++] = b; idx[m++] = cc; idx[m++] = dd;
      }
    }
  }
  const index = idx.slice(0, m);

  const msg = {
    id,
    position, aHeight, aMap, uv, index, gridM,
    stats: { vertices: count, triangles: m / 3, ms: performance.now() - t0 },
  };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, [
    position.buffer, aHeight.buffer, aMap.buffer, uv.buffer, index.buffer, gridM.buffer,
  ]);
};

export {};
