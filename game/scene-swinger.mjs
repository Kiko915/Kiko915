// Web-Swinger - the contribution calendar as a night skyline with Spider-Man
// swinging across it. Each week is a tower whose height is the number of active
// days; the swing arc rides the local rooftop line, so dense stretches of the
// year push the arc high and quiet stretches let it dip low.

import { rect, pixel, sprite, line, text, textWidth, rng } from './draw.mjs';
import {
  SWING_REACH, SWING_TUCK, SPIDEY_W, SPIDEY_H, WEB_ANCHOR,
} from './sprites-spidey.mjs';

export const PALETTE = [
  [0x0d, 0x11, 0x17], //  0 night sky
  [0x14, 0x53, 0x2d], //  1 level 1
  [0x15, 0x80, 0x3d], //  2 level 2
  [0x22, 0xc5, 0x5e], //  3 level 3
  [0x4a, 0xde, 0x80], //  4 level 4
  [0x21, 0x26, 0x2d], //  5 ground line
  [0x30, 0x36, 0x3d], //  6 rooftop antenna
  [0x2a, 0x31, 0x39], //  7 dim star
  [0x57, 0x62, 0x6d], //  8 bright star
  [0xff, 0x31, 0x3a], //  9 suit red
  [0x3b, 0x76, 0xf0], // 10 suit blue
  [0xf0, 0xf6, 0xfc], // 11 eye white / web line
  [0x6e, 0x76, 0x81], // 12 dim text
  [0x22, 0xc5, 0x5e], // 13 green text
  [0xe6, 0xed, 0xf3], // 14 bright text
  [0xfb, 0xbf, 0x24], // 15 highlight / final score
  [0x00, 0x00, 0x00], // 16 transparency marker (never drawn)
];

const SKY = 0;
const LEVEL = [0, 1, 2, 3, 4];
const GROUND = 5;
const ANTENNA = 6;
const STAR_DIM = 7;
const STAR_LIT = 8;
const RED = 9;
const BLUE = 10;
const WHITE = 11;
const DIM = 12;
const GREEN = 13;
const BRIGHT = 14;
const GOLD = 15;
export const TRANSPARENT = 16;

const CELL = 13;
const GAP = 3;
const PITCH = CELL + GAP;
const ROWS = 7;
const PAD_X = 14;
const HUD_H = 30;
const SKY_H = 100;
const TERRAIN_H = ROWS * PITCH - GAP;
const FOOT_H = 20;

const SPIDEY_SCALE = 2; // he is the only moving sprite, so draw him chunky
const DRAW_W = SPIDEY_W * SPIDEY_SCALE;
const DRAW_H = SPIDEY_H * SPIDEY_SCALE;

const SWING_PERIOD = 96; // horizontal distance covered by one web swing, px
const CLEAR = 12; // how far his feet clear the local rooftops at the low point
const RISE = 30; // how much higher he is at the handoff than mid-swing
const FRAMES = 200;
const OUTRO_FRAMES = 26;
export const DELAY_MS = 60;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/* ------------------------------------------------------------------ scene */

function drawSkyline(buf, W, H, world, baseY) {
  const weeks = world.weeks;

  // Deterministic star field, seeded so the backdrop never changes between runs.
  const rand = rng(0x51d3c0de);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand() * W);
    const y = HUD_H + 4 + Math.floor(rand() * (SKY_H - 10));
    pixel(buf, W, H, x, y, rand() < 0.22 ? STAR_LIT : STAR_DIM);
  }

  for (let w = 0; w < weeks.length; w++) {
    const x = PAD_X + w * PITCH;
    const week = weeks[w];

    week.stack.forEach((level, k) => {
      rect(buf, W, H, x, baseY - CELL - k * PITCH, CELL, CELL, LEVEL[level]);
    });

    // Antennas on the tallest towers, for the skyline silhouette.
    if (week.height >= 5) {
      const roof = roofY(baseY, week.height);
      rect(buf, W, H, x + (CELL >> 1), roof - 6, 1, 6, ANTENNA);
    }
  }

  rect(buf, W, H, 0, baseY + 2, W, 2, GROUND);

  let lastMonth = -1;
  for (let w = 0; w < weeks.length; w++) {
    if (!weeks[w].firstDate) continue;
    const month = new Date(weeks[w].firstDate + 'T00:00:00Z').getUTCMonth();
    if (month === lastMonth) continue;
    lastMonth = month;
    const x = PAD_X + w * PITCH;
    if (x + textWidth(MONTHS[month], 1) > W - PAD_X) continue;
    text(buf, W, H, MONTHS[month], x, baseY + 8, 1, DIM);
  }
}

function drawHud(buf, W, H, score, total, done) {
  rect(buf, W, H, 0, 0, W, HUD_H, SKY);

  const y = 7;
  let x = PAD_X;
  x = text(buf, W, H, 'francisc@dev', x, y, 2, GREEN) + 12;
  x = text(buf, W, H, '~ $', x, y, 2, DIM) + 12;
  text(buf, W, H, done ? './swing.sh --done' : './swing.sh', x, y, 2, BRIGHT);

  const label = 'commits ';
  const value = String(score);
  const start = W - PAD_X - textWidth(label + value, 2);
  const after = text(buf, W, H, label, start, y, 2, DIM) + 12;
  text(buf, W, H, value, after, y, 2, done ? GOLD : RED);
}

function roofY(baseY, height) {
  return height === 0 ? baseY : baseY - ((height - 1) * PITCH + CELL);
}

/* ------------------------------------------------------------- swing path */

// For every x, the highest rooftop within half a swing either side. The arc is
// hung off this, so the path reacts to the shape of the year.
function rooflineEnvelope(world, W, baseY) {
  const cols = world.weeks.length;
  const raw = new Float32Array(W);
  const reach = Math.round(SWING_PERIOD / 2);

  for (let x = 0; x < W; x++) {
    let top = baseY;
    const from = Math.floor((x - reach - PAD_X) / PITCH);
    const to = Math.floor((x + reach - PAD_X) / PITCH);
    for (let c = Math.max(0, from); c <= Math.min(cols - 1, to); c++) {
      top = Math.min(top, roofY(baseY, world.weeks[c].height));
    }
    raw[x] = top;
  }

  // Box blur, so the arc glides instead of stepping between towers.
  const smooth = new Float32Array(W);
  const r = 24;
  for (let x = 0; x < W; x++) {
    let sum = 0;
    let n = 0;
    for (let k = -r; k <= r; k++) {
      const s = x + k;
      if (s < 0 || s >= W) continue;
      sum += raw[s];
      n++;
    }
    smooth[x] = sum / n;
  }
  return smooth;
}

/* ------------------------------------------------------------------ build */

export function build(world) {
  const cols = world.weeks.length;
  const W = PAD_X * 2 + cols * PITCH - GAP;
  const H = HUD_H + SKY_H + TERRAIN_H + FOOT_H;
  const baseY = HUD_H + SKY_H + TERRAIN_H;
  const anchorY = HUD_H;

  const backdrop = new Uint8Array(W * H);
  backdrop.fill(SKY);
  drawSkyline(backdrop, W, H, world, baseY);

  const envelope = rooflineEnvelope(world, W, baseY);
  const envAt = (x) => envelope[Math.max(0, Math.min(W - 1, Math.round(x)))];

  const frames = [];
  const startX = -DRAW_W - 10;
  const endX = W + 20;
  let score = 0;
  let nextWeek = 0;

  for (let f = 0; f < FRAMES; f++) {
    const x = startX + ((endX - startX) * f) / FRAMES;

    // Phase within the current swing: 1 at the handoff, 0 at the low point.
    const t = (x - PAD_X) / SWING_PERIOD;
    const arc = (1 + Math.cos(2 * Math.PI * t)) / 2;
    const feetY = envAt(x + DRAW_W / 2) - CLEAR - RISE * arc;
    const spriteY = feetY - DRAW_H;

    const anchorX = PAD_X + (Math.floor(t) + 0.5) * SWING_PERIOD;
    const pose = arc > 0.5 ? SWING_REACH : SWING_TUCK;

    // Bank the commits of every week he has passed.
    const centre = x + DRAW_W / 2;
    while (nextWeek < cols && PAD_X + nextWeek * PITCH + CELL / 2 <= centre) {
      score += world.weeks[nextWeek].total;
      nextWeek++;
    }
    const current = nextWeek - 1;

    const frame = Uint8Array.from(backdrop);

    // Spider-sense ping on the tower he is passing over.
    if (current >= 0 && current < cols && world.weeks[current].height > 0) {
      const cx = PAD_X + current * PITCH;
      rect(frame, W, H, cx, roofY(baseY, world.weeks[current].height), CELL, CELL, LEVEL[4]);
    }

    line(frame, W, H,
      x + WEB_ANCHOR.x * SPIDEY_SCALE, spriteY + WEB_ANCHOR.y * SPIDEY_SCALE,
      anchorX, anchorY, WHITE);
    sprite(frame, W, H, pose, x, spriteY, { R: RED, B: BLUE, W: WHITE }, SPIDEY_SCALE);
    drawHud(frame, W, H, score, world.total, false);

    frames.push(frame);
  }

  for (let f = 0; f < OUTRO_FRAMES; f++) {
    const frame = Uint8Array.from(backdrop);
    drawHud(frame, W, H, world.total, world.total, true);
    if (f % 8 < 4) rect(frame, W, H, PAD_X, HUD_H - 6, 10, 2, BRIGHT);
    frames.push(frame);
  }

  return { frames, W, H };
}
