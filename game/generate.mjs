// Terminal Runner - renders a GitHub contribution calendar as a side-scrolling
// platformer GIF. Each week is a column of terrain whose height is the number of
// active days that week, brightest day on top. A runner sprite crosses the year
// left to right, hopping between columns and collecting each week's commits.

import { writeFileSync } from 'node:fs';
import gifenc from 'gifenc';
import { FONT, FONT_W, FONT_H, MISSING } from './font.mjs';
import {
  RUNNER_RUN_A, RUNNER_RUN_B, RUNNER_JUMP, RUNNER_W, RUNNER_H, COIN, BURST,
} from './sprites.mjs';
import { fetchCalendar } from './contributions.mjs';

const { GIFEncoder } = gifenc;

/* ---------------------------------------------------------------- palette */

const PAL = [
  [0x0d, 0x11, 0x17], //  0 background
  [0x16, 0x1b, 0x22], //  1 empty cell
  [0x14, 0x53, 0x2d], //  2 level 1
  [0x15, 0x80, 0x3d], //  3 level 2
  [0x22, 0xc5, 0x5e], //  4 level 3
  [0x4a, 0xde, 0x80], //  5 level 4
  [0x21, 0x26, 0x2d], //  6 ground line
  [0xe6, 0xed, 0xf3], //  7 runner body
  [0x4a, 0xde, 0x80], //  8 runner accent
  [0xfb, 0xbf, 0x24], //  9 coin
  [0xfd, 0xe6, 0x8a], // 10 spark
  [0x6e, 0x76, 0x81], // 11 dim text
  [0x22, 0xc5, 0x5e], // 12 green text
  [0xe6, 0xed, 0xf3], // 13 bright text
  [0x00, 0x00, 0x00], // 14 transparency marker (never drawn)
];

const BG = 0;
const EMPTY = 1;
const LEVEL = [1, 2, 3, 4, 5];
const GROUND = 6;
const BODY = 7;
const ACCENT = 8;
const COIN_C = 9;
const SPARK = 10;
const DIM = 11;
const GREEN = 12;
const BRIGHT = 13;
const TRANSPARENT = 14;

/* ----------------------------------------------------------------- layout */

const CELL = 13;
const GAP = 3;
const PITCH = CELL + GAP;
const ROWS = 7;
const PAD_X = 14;
const HUD_H = 30;
const HEADROOM = 48;
const TERRAIN_H = ROWS * PITCH - GAP;
const FOOT_H = 20;

const FRAMES_PER_COL = 3;
const INTRO_FRAMES = 10;
const OUTRO_FRAMES = 26;
const TRAIL_COLS = 3; // steps the runner takes past the final week, off-screen
const DELAY_MS = 60;

/* -------------------------------------------------------------- primitives */

function rect(buf, W, H, x, y, w, h, idx) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x) + w);
  const y1 = Math.min(H, Math.round(y) + h);
  for (let py = y0; py < y1; py++) {
    buf.fill(idx, py * W + x0, py * W + x1);
  }
}

function sprite(buf, W, H, rows, x, y, map) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  for (let ry = 0; ry < rows.length; ry++) {
    const py = y0 + ry;
    if (py < 0 || py >= H) continue;
    const row = rows[ry];
    for (let rx = 0; rx < row.length; rx++) {
      const idx = map[row[rx]];
      if (idx === undefined) continue;
      const px = x0 + rx;
      if (px < 0 || px >= W) continue;
      buf[py * W + px] = idx;
    }
  }
}

function textWidth(str, scale) {
  const n = String(str).length;
  return n ? n * (FONT_W + 1) * scale - scale : 0;
}

function text(buf, W, H, str, x, y, scale, idx) {
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

/* ------------------------------------------------------------------- world */

function buildWorld(cal) {
  const weeks = cal.weeks.map((w) => {
    const active = w.days.filter((d) => d.count > 0);
    return {
      height: active.length,
      total: w.days.reduce((s, d) => s + d.count, 0),
      // dimmest at the bottom, so the week's best day forms the visible surface
      stack: active.map((d) => Math.max(1, d.level)).sort((a, b) => a - b),
      firstDate: w.days.length ? w.days[0].date : null,
    };
  });
  return { weeks, total: cal.total };
}

function surfaceY(baseY, height) {
  return height === 0 ? baseY : baseY - ((height - 1) * PITCH + CELL);
}

/* ------------------------------------------------------------------ render */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function drawStaticScene(buf, W, H, world, baseY) {
  const weeks = world.weeks;

  for (let w = 0; w < weeks.length; w++) {
    const x = PAD_X + w * PITCH;
    for (let r = 0; r < ROWS; r++) {
      rect(buf, W, H, x, HUD_H + HEADROOM + r * PITCH, CELL, CELL, EMPTY);
    }
    weeks[w].stack.forEach((level, k) => {
      rect(buf, W, H, x, baseY - CELL - k * PITCH, CELL, CELL, LEVEL[level]);
    });
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
  rect(buf, W, H, 0, 0, W, HUD_H, BG);

  const y = 7;
  let x = PAD_X;
  x = text(buf, W, H, 'francisc@dev', x, y, 2, GREEN) + 12;
  x = text(buf, W, H, '~ $', x, y, 2, DIM) + 12;
  text(buf, W, H, done ? './run.sh --done' : './run.sh', x, y, 2, BRIGHT);

  const label = 'commits ';
  const value = String(score);
  const start = W - PAD_X - textWidth(label + value, 2);
  const after = text(buf, W, H, label, start, y, 2, DIM) + 4;
  text(buf, W, H, value, after, y, 2, score >= total && total > 0 ? SPARK : ACCENT);
}

/* ------------------------------------------------------------------ encode */

function encode(frames, W, H) {
  const gif = GIFEncoder();
  let prev = null;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (i === 0) {
      gif.writeFrame(frame, W, H, { palette: PAL, delay: DELAY_MS, dispose: 1 });
    } else {
      // Only the pixels that actually moved are encoded; everything else is
      // left transparent so the previous frame shows through. Keeps the file
      // small even though the calendar backdrop is redrawn every frame.
      const diff = new Uint8Array(W * H);
      for (let p = 0; p < diff.length; p++) {
        diff[p] = frame[p] === prev[p] ? TRANSPARENT : frame[p];
      }
      gif.writeFrame(diff, W, H, {
        delay: DELAY_MS,
        transparent: true,
        transparentIndex: TRANSPARENT,
        dispose: 1,
      });
    }
    prev = frame;
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

/* ------------------------------------------------------------------ frames */

function buildFrames(world) {
  const cols = world.weeks.length;
  const W = PAD_X * 2 + cols * PITCH - GAP;
  const H = HUD_H + HEADROOM + TERRAIN_H + FOOT_H;
  const baseY = HUD_H + HEADROOM + TERRAIN_H;

  const backdrop = new Uint8Array(W * H);
  backdrop.fill(BG);
  drawStaticScene(backdrop, W, H, world, baseY);

  const heightAt = (i) => (i >= 0 && i < cols ? world.weeks[i].height : 0);
  const runnerX = (pos) => PAD_X + pos * PITCH + (CELL - RUNNER_W) / 2;

  const frames = [];
  const emit = (mutate) => {
    const frame = Uint8Array.from(backdrop);
    mutate(frame);
    frames.push(frame);
  };

  const coins = world.weeks.map((w) => w.total > 0);
  const drawCoins = (frame, from) => {
    for (let w = from; w < cols; w++) {
      if (!coins[w]) continue;
      const y = surfaceY(baseY, world.weeks[w].height) - 22;
      sprite(frame, W, H, COIN, PAD_X + w * PITCH + 3, y, { o: COIN_C });
    }
  };

  let score = 0;

  for (let f = 0; f < INTRO_FRAMES; f++) {
    emit((frame) => {
      drawCoins(frame, 0);
      const pose = f % 4 < 2 ? RUNNER_RUN_A : RUNNER_RUN_B;
      sprite(frame, W, H, pose, runnerX(0), surfaceY(baseY, heightAt(0)) - RUNNER_H,
        { '#': BODY, '+': ACCENT });
      drawHud(frame, W, H, 0, world.total, false);
    });
  }

  for (let s = 0; s < cols + TRAIL_COLS; s++) {
    const h0 = heightAt(s);
    const h1 = heightAt(s + 1);
    const y0 = surfaceY(baseY, h0);
    const y1 = surfaceY(baseY, h1);
    const delta = Math.abs(h1 - h0);
    const arc = delta === 0 ? 0 : PITCH * 0.6 + delta * PITCH * 0.35;

    let burst = false;
    if (s < cols && coins[s]) {
      coins[s] = false;
      score += world.weeks[s].total;
      burst = true;
    }

    for (let f = 0; f < FRAMES_PER_COL; f++) {
      const t = f / FRAMES_PER_COL;
      const feet = y0 + (y1 - y0) * t - arc * 4 * t * (1 - t);
      const pose = arc === 0
        ? ((s * FRAMES_PER_COL + f) % 4 < 2 ? RUNNER_RUN_A : RUNNER_RUN_B)
        : RUNNER_JUMP;

      emit((frame) => {
        drawCoins(frame, s + 1);
        if (burst && f === 0) {
          sprite(frame, W, H, BURST, PAD_X + s * PITCH + 3, y0 - 22, { '*': SPARK });
        }
        sprite(frame, W, H, pose, runnerX(s + t), feet - RUNNER_H,
          { '#': BODY, '+': ACCENT });
        drawHud(frame, W, H, score, world.total, false);
      });
    }
  }

  for (let f = 0; f < OUTRO_FRAMES; f++) {
    emit((frame) => {
      drawHud(frame, W, H, score, world.total, true);
      if (f % 8 < 4) rect(frame, W, H, PAD_X, HUD_H - 6, 10, 2, BRIGHT);
    });
  }

  return { frames, W, H };
}

/* -------------------------------------------------------------------- main */

async function main() {
  const login = process.env.GH_LOGIN || process.argv[2] || 'Kiko915';
  const out = process.env.OUT_PATH || process.argv[3] || 'game.gif';
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

  const cal = await fetchCalendar(login, token);
  const world = buildWorld(cal);
  console.log(login + ': ' + world.weeks.length + ' weeks, ' + world.total + ' contributions');

  const { frames, W, H } = buildFrames(world);
  const only = process.env.DEBUG_FRAME;
  const bytes = encode(only ? [frames[Number(only)]] : frames, W, H);
  writeFileSync(out, bytes);
  console.log('wrote ' + out + ' - ' + W + 'x' + H + ', ' + frames.length +
    ' frames, ' + (bytes.length / 1024).toFixed(1) + ' KB');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
