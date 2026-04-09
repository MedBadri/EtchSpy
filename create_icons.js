#!/usr/bin/env node
// create_icons.js — Generates icon PNG files for the EtchSpy Chrome extension
// Run once before loading the extension: node create_icons.js
// No npm dependencies — uses only Node.js built-ins (zlib, fs, path)
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── CRC32 (required by PNG format) ────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk helper ──────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const tb  = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}

// ── Icon renderer ─────────────────────────────────────────────────────────────
// Draws a solid rounded square with a stylised "E" lettermark.
// Colors: #F56400 (orange) background, #FFFFFF (white) foreground.

const BG_R = 245, BG_G = 100, BG_B = 0;   // #F56400
const FG_R = 255, FG_G = 255, FG_B = 255; // #FFFFFF

/**
 * Returns true if pixel (x, y) should be painted in the foreground color.
 * Coordinate system: origin = top-left, size×size grid.
 * We draw a simple capital "E" using proportional geometry.
 */
function isLetterPixel(x, y, size) {
  const s  = size;
  const lx = Math.round(s * 0.22);  // left edge of E
  const rx = Math.round(s * 0.72);  // right edge of E
  const sw = Math.round(s * 0.14);  // stroke width
  const ty = Math.round(s * 0.18);  // top bar y start
  const by = Math.round(s * 0.68);  // bottom bar y end
  const my = Math.round(s * 0.44);  // mid bar y centre
  const mh = Math.round(s * 0.07);  // half mid bar height
  const mrx= Math.round(s * 0.62);  // mid bar right edge (shorter than top/bottom)

  // Vertical stem
  if (x >= lx && x < lx + sw && y >= ty && y <= by) return true;
  // Top bar
  if (x >= lx && x < rx      && y >= ty && y < ty + sw) return true;
  // Middle bar
  if (x >= lx && x < mrx     && y >= my - mh && y <= my + mh) return true;
  // Bottom bar
  if (x >= lx && x < rx      && y > by - sw && y <= by) return true;

  return false;
}

function createIconPNG(size) {
  // Build raw scanline data: one filter byte (0 = None) then size×3 RGB bytes per row
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.allocUnsafe(1 + size * 3);
    row[0] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const letter = isLetterPixel(x, y, size);
      row[1 + x * 3    ] = letter ? FG_R : BG_R;
      row[2 + x * 3] = letter ? FG_G : BG_G;
      row[3 + x * 3] = letter ? FG_B : BG_B;
    }
    rawRows.push(row);
  }

  const raw        = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  // IHDR: 4B width | 4B height | 1B bitDepth=8 | 1B colorType=2(RGB) | 3B zeros
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8]  = 8; // bit depth
  ihdrData[9]  = 2; // color type: RGB
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png      = createIconPNG(size);
  const filepath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filepath, png);
  console.log(`✓ icons/icon${size}.png  (${png.length} bytes)`);
}

console.log('\nDone. Icons created in /icons — replace with professional artwork before publishing.\n');
