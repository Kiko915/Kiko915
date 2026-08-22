// Renders a GitHub contribution calendar as an animated GIF.
//
//   node generate.mjs [login] [outPath]
//
// Env: SCENE (swinger|runner), GH_LOGIN, OUT_PATH, GITHUB_TOKEN,
//      DEBUG_FRAME (render a single frame, for tuning layout).

import { writeFileSync } from 'node:fs';
import { fetchCalendar } from './contributions.mjs';
import { encode } from './encode.mjs';
import * as swinger from './scene-swinger.mjs';
import * as runner from './scene-runner.mjs';

const SCENES = { swinger, runner };

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

async function main() {
  const name = process.env.SCENE || 'swinger';
  const scene = SCENES[name];
  if (!scene) {
    throw new Error(`unknown scene "${name}" - expected one of ${Object.keys(SCENES).join(', ')}`);
  }

  const login = process.env.GH_LOGIN || process.argv[2] || 'Kiko915';
  const out = process.env.OUT_PATH || process.argv[3] || 'game.gif';
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

  const cal = await fetchCalendar(login, token);
  const world = buildWorld(cal);
  console.log(`${login}: ${world.weeks.length} weeks, ${world.total} contributions, scene "${name}"`);

  const { frames, W, H } = scene.build(world);
  const only = process.env.DEBUG_FRAME;
  const chosen = only ? [frames[Number(only)]] : frames;
  const bytes = encode(chosen, W, H, scene.PALETTE, scene.TRANSPARENT, scene.DELAY_MS);

  writeFileSync(out, bytes);
  console.log(`wrote ${out} - ${W}x${H}, ${chosen.length} frames, ${(bytes.length / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
