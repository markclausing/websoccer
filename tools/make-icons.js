// Draws the app icons and writes them as PNGs.
//
// Hand rolled rather than pulled from a library: a PNG is a header, one zlib
// stream of filtered scanlines and a trailer, and node has zlib built in. That
// keeps the project at zero dependencies, and the icons stay reproducible -
// run this again and you get the same bytes.
//
//   node tools/make-icons.js

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const body = out.subarray(4, 8 + data.length);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** @param {Uint8Array} rgba length size*size*4 */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // 10, 11, 12 stay zero: deflate, adaptive filtering, no interlacing

  // Each scanline is prefixed with its filter type; 0 means "store as is".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const at = y * (size * 4 + 1);
    raw[at] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, at + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The pitch seen from above: stripes, halfway line, centre circle, ball. */
function draw(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };

  const dark = [27, 95, 39];
  const light = [38, 128, 54];
  const white = [255, 255, 255];
  const stripe = size / 6;

  for (let y = 0; y < size; y++) {
    const band = Math.floor(y / stripe) % 2 ? light : dark;
    for (let x = 0; x < size; x++) set(x, y, band);
  }

  const c = size / 2;
  const line = Math.max(2, Math.round(size / 64));

  // Halfway line
  for (let y = Math.round(c - line / 2); y < c + line / 2; y++) {
    for (let x = 0; x < size; x++) set(x, y, white);
  }

  // Centre circle
  const ring = size * 0.28;
  for (let a = 0; a < 3600; a++) {
    const t = (a / 3600) * Math.PI * 2;
    for (let w = -line / 2; w <= line / 2; w += 0.5) {
      set(Math.round(c + Math.cos(t) * (ring + w)), Math.round(c + Math.sin(t) * (ring + w)), white);
    }
  }

  // The ball, with a dark rim so it reads at small sizes
  const ball = size * 0.13;
  for (let y = Math.floor(c - ball - 2); y <= c + ball + 2; y++) {
    for (let x = Math.floor(c - ball - 2); x <= c + ball + 2; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d <= ball) set(x, y, white);
      else if (d <= ball + Math.max(1, size / 128)) set(x, y, [10, 31, 17]);
    }
  }

  return px;
}

mkdirSync('icons', { recursive: true });
for (const size of [180, 192, 512]) {
  const file = `icons/icon-${size}.png`;
  writeFileSync(file, encodePng(size, draw(size)));
  console.log(`wrote ${file}`);
}
