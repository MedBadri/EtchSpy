#!/usr/bin/env node
// generate_keys.js — EtchSpy license key generator
// NOT part of the extension. Run locally when you have a new customer.
//
// Usage:
//   node generate_keys.js           → generates 10 keys
//   node generate_keys.js 25        → generates 25 keys
//
// Every key produced here embeds an FNV-1a checksum in segment 4, matching the
// validation logic in license.js. Random guesses fail the checksum check before
// the array lookup is ever reached, making brute-force essentially useless.
//
// After generating:
//   1. Copy the keys printed under "Paste into license.js"
//   2. Open license.js, paste into VALID_KEYS
//   3. Re-zip the EtchSpy folder and re-upload to Gumroad
//   4. Send one key per customer
'use strict';

const crypto = require('crypto');

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars — no I, L, O
const CLEN    = CHARSET.length;

function randomSegment(len) {
  let result = '';
  while (result.length < len) {
    const bytes = crypto.randomBytes(64);
    for (let i = 0; i < bytes.length && result.length < len; i++) {
      // Rejection sampling — avoids modulo bias
      if (bytes[i] < 256 - (256 % CLEN)) result += CHARSET[bytes[i] % CLEN];
    }
  }
  return result;
}

function computeChecksum(s1, s2) {
  const input = s1 + s2;
  let hash = 0x811C9DC5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let result = '';
  let h = hash;
  for (let i = 0; i < 4; i++) {
    result += CHARSET[h % CLEN];
    h = Math.floor(h / CLEN);
  }
  return result;
}

function generateKey() {
  const s1 = randomSegment(4);
  const s2 = randomSegment(4);
  return `ETCH-${s1}-${s2}-${computeChecksum(s1, s2)}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const count  = parseInt(process.argv[2], 10) || 10;
const keys   = [];
for (let i = 0; i < count; i++) keys.push(generateKey());

console.log('\n=== Keys to send to customers (keep this list private) ===\n');
keys.forEach((k) => console.log(k));

console.log('\n=== Paste these HASHES into license.js VALID_KEY_HASHES ===\n');
keys.forEach((k) => {
  const hash = crypto.createHash('sha256').update(k).digest('hex');
  console.log(`  "${hash}", // ${k}`);
});

console.log(`\n✓ ${count} key${count !== 1 ? 's' : ''} generated.\n`);
console.log('Send one key per customer. Only paste the hashes into license.js.\n');
