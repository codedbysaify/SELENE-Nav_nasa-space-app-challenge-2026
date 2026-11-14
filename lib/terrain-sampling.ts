/**
 * Bilinear sampling of block-centred stereographic grids (row 0 = +y edge).
 * Shared by the geometry worker and the main-thread read-outs.
 */

export interface GridSpec {
  size: number; // nodes per side
  halfExtentKm: number;
}

/** Fractional (col, row) of a map point (km) on a block-centred grid. */
export function gridCoord(spec: GridSpec, x: number, y: number): [number, number] {
  const cell = (2 * spec.halfExtentKm) / spec.size;
  return [(x + spec.halfExtentKm) / cell - 0.5, (spec.halfExtentKm - y) / cell - 0.5];
}

export function sampleBilinear(
  data: ArrayLike<number>,
  spec: GridSpec,
  x: number,
  y: number,
  stride = 1,
  channel = 0,
): number {
  const n = spec.size;
  let [c, r] = gridCoord(spec, x, y);
  c = Math.min(Math.max(c, 0), n - 1);
  r = Math.min(Math.max(r, 0), n - 1);
  const c0 = Math.min(Math.floor(c), n - 2), r0 = Math.min(Math.floor(r), n - 2);
  const fc = c - c0, fr = r - r0;
  const i00 = (r0 * n + c0) * stride + channel;
  const i01 = i00 + stride;
  const i10 = i00 + n * stride;
  const i11 = i10 + stride;
  const top = data[i00] * (1 - fc) + data[i01] * fc;
  const bot = data[i10] * (1 - fc) + data[i11] * fc;
  return top * (1 - fr) + bot * fr;
}

/** Nearest-node sample (used for categorical / fraction data). */
export function sampleNearest(
  data: ArrayLike<number>,
  spec: GridSpec,
  x: number,
  y: number,
  stride = 1,
  channel = 0,
): number {
  const n = spec.size;
  const [c, r] = gridCoord(spec, x, y);
  const ci = Math.min(Math.max(Math.round(c), 0), n - 1);
  const ri = Math.min(Math.max(Math.round(r), 0), n - 1);
  return data[(ri * n + ci) * stride + channel];
}
