/**
 * Catmull-Rom Bicubic Upscaler + Quantized Isotherm Stepping
 *
 * Ported directly from the blueprint. Used for client-side rendering of
 * raw grid data when needed (primary path is server-side PNG).
 */
import { interpolateTurbo } from 'd3-scale-chromatic';

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

export function generateProcessedHeatmap(
  raw: Float32Array,
  w: number,
  h: number,
  minVal: number,
  maxVal: number
): HTMLCanvasElement {
  const scale = 4;
  const dw = (w - 1) * scale + 1;
  const dh = (h - 1) * scale + 1;
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(dw, dh);

  const getSample = (x: number, y: number) =>
    raw[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];

  for (let dy = 0; dy < dh; dy++) {
    const sy = dy / scale;
    const iy = Math.floor(sy);
    const fy = sy - iy;

    for (let dx = 0; dx < dw; dx++) {
      const sx = dx / scale;
      const ix = Math.floor(sx);
      const fx = sx - ix;
      const col = new Float32Array(4);

      for (let m = -1; m <= 2; m++) {
        const p1 = getSample(ix, iy + m);
        col[m + 1] = isNaN(p1) || p1 <= -999
          ? NaN
          : catmullRom(
              getSample(ix - 1, iy + m),
              p1,
              getSample(ix + 1, iy + m),
              getSample(ix + 2, iy + m),
              fx
            );
      }

      const val = isNaN(col[1]) ? NaN : catmullRom(col[0], col[1], col[2], col[3], fy);
      const px = (dy * dw + dx) * 4;

      if (isNaN(val) || val <= -999) {
        img.data[px + 3] = 0;
        continue;
      }

      // 0.5°C discrete bands
      const stepped = Math.floor(val / 0.5) * 0.5;
      const norm = Math.max(0, Math.min(1, (stepped - minVal) / (maxVal - minVal)));
      const match = interpolateTurbo(norm).match(/\d+/g);
      if (!match) continue;
      const [r, g, b] = match.map(Number);

      img.data[px] = r;
      img.data[px + 1] = g;
      img.data[px + 2] = b;
      img.data[px + 3] = 220;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}
