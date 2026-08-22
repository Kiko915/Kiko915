// Pixel drawing primitives. Every buffer is a Uint8Array of palette indices,
// W*H, row-major.

import { FONT, FONT_W, FONT_H, MISSING } from './font.mjs';

export function rect(buf, W, H, x, y, w, h, idx) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x) + w);
  const y1 = Math.min(H, Math.round(y) + h);
  for (let py = y0; py < y1; py++) {
    if (x1 > x0) buf.fill(idx, py * W + x0, py * W + x1);
  }
}

export function pixel(buf, W, H, x, y, idx) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || px >= W || py < 0 || py >= H) return;
  buf[py * W + px] = idx;
}

export function sprite(buf, W, H, rows, x, y, map, scale = 1) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  for (let ry = 0; ry < rows.length; ry++) {
    const row = rows[ry];
    for (let rx = 0; rx < row.length; rx++) {
      const idx = map[row[rx]];
      if (idx === undefined) continue;
      if (scale === 1) {
        const px = x0 + rx;
        const py = y0 + ry;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        buf[py * W + px] = idx;
      } else {
        rect(buf, W, H, x0 + rx * scale, y0 + ry * scale, scale, scale, idx);
      }
    }
  }
}

// Bresenham, used for web lines.
export function line(buf, W, H, x0, y0, x1, y1, idx) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pixel(buf, W, H, x, y, idx);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export function textWidth(str, scale) {
  const n = String(str).length;
  return n ? n * (FONT_W + 1) * scale - scale : 0;
}

export function text(buf, W, H, str, x, y, scale, idx) {
  let cx = Math.round(x);
  for (const raw of String(str).toUpperCase()) {
    const glyph = FONT[raw] || MISSING;
    for (let gy = 0; gy < FONT_H; gy++) {
      for (let gx = 0; gx < FONT_W; gx++) {
        if (glyph[gy][gx] !== '#') continue;
        rect(buf, W, H, cx + gx * scale, y + gy * scale, scale, scale, idx);
      }
    }
    cx += (FONT_W + 1) * scale;
  }
  return cx - scale;
}

// Deterministic PRNG so decorative details (stars) stay identical between runs
// and the daily workflow does not commit a new GIF for no reason.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
