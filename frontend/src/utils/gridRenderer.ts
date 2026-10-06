/**
 * Rasterise a lat/lon float grid into an off-screen canvas using a d3 colormap.
 *
 * The result is a PNG dataURL (via canvas.toDataURL) that MapLibre can attach
 * as an ImageSource — but unlike a server-generated PNG, the colouring, opacity
 * and vmin/vmax are computed client-side, so we can recolour instantly without
 * a server round-trip.
 */
import {
  interpolateTurbo,
  interpolateRdBu,
  interpolateViridis,
  interpolateReds,
} from 'd3-scale-chromatic';

export type Colormap = 'turbo' | 'diverging' | 'viridis' | 'heatwave';

const CMAPS: Record<Colormap, (t: number) => string> = {
  turbo:     interpolateTurbo,
  diverging: (t) => interpolateRdBu(1 - t),   // flip so red = high
  viridis:   interpolateViridis,
  heatwave:  interpolateReds,
};

export interface Grid {
  lat: number[];
  lon: number[];
  values: (number | null)[][];
  vmin: number;
  vmax: number;
}

/**
 * Render a grid to an off-screen canvas.  Land / NaN pixels become fully
 * transparent so the base map / ocean-blue background shows through.
 */
export function renderGridToCanvas(grid: Grid, cmap: Colormap = 'turbo', opacity = 0.9): HTMLCanvasElement {
  const ny = grid.lat.length;
  const nx = grid.lon.length;
  const c = document.createElement('canvas');
  c.width = nx;
  c.height = ny;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(nx, ny);
  const cmapFn = CMAPS[cmap] ?? interpolateTurbo;
  const range = grid.vmax - grid.vmin || 1;

  // Lat axis in the source is south → north; canvas y=0 is top, so flip.
  for (let y = 0; y < ny; y++) {
    const row = grid.values[ny - 1 - y];
    for (let x = 0; x < nx; x++) {
      const v = row[x];
      const idx = (y * nx + x) * 4;
      if (v == null || !Number.isFinite(v)) {
        img.data[idx + 3] = 0;                    // transparent land
        continue;
      }
      const t = Math.max(0, Math.min(1, (v - grid.vmin) / range));
      const col = cmapFn(t);                       // "rgb(r, g, b)"
      const m = col.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!m) continue;
      img.data[idx]     = Number(m[1]);
      img.data[idx + 1] = Number(m[2]);
      img.data[idx + 2] = Number(m[3]);
      img.data[idx + 3] = Math.round(255 * opacity);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Value at (lat, lon) using nearest-cell lookup — for hover readouts. */
export function sampleGrid(grid: Grid, lat: number, lon: number): number | null {
  const iy = _nearestIdx(grid.lat, lat);
  const ix = _nearestIdx(grid.lon, lon);
  return grid.values[iy]?.[ix] ?? null;
}

function _nearestIdx(arr: number[], v: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - v);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
