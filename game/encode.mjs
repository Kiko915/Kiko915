// GIF encoding. Frame 0 is written whole; every later frame is encoded as a
// transparent delta against its predecessor, so only moving pixels cost bytes.

import gifenc from 'gifenc';

const { GIFEncoder } = gifenc;

export function encode(frames, W, H, palette, transparentIndex, delayMs) {
  const gif = GIFEncoder();
  let prev = null;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (i === 0) {
      gif.writeFrame(frame, W, H, { palette, delay: delayMs, dispose: 1 });
    } else {
      const diff = new Uint8Array(W * H);
      for (let p = 0; p < diff.length; p++) {
        diff[p] = frame[p] === prev[p] ? transparentIndex : frame[p];
      }
      gif.writeFrame(diff, W, H, {
        delay: delayMs,
        transparent: true,
        transparentIndex,
        dispose: 1,
      });
    }
    prev = frame;
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}
