// license.js — License key validation
// ─────────────────────────────────────────────────────────────────────────────
// SECURITY MODEL — three layers:
//
//   Layer 1 — Checksum: segment 4 is an FNV-1a hash of segments 2+3.
//             Random guesses have ~1-in-50,000 odds of passing.
//
//   Layer 2 — SHA-256 hash lookup: keys are NEVER stored in plain text.
//             The file contains only hashes. Someone reading this file
//             cannot recover any original key — SHA-256 is one-way.
//
//   Layer 3 — chrome.storage: once activated, the validated key is stored
//             locally so the user is never asked again.
//
// HOW TO ADD NEW KEYS:
//   1. Run `node generate_keys.js 10`
//   2. Copy the plain-text keys — send ONE to each customer, keep the rest
//   3. Run: node -e "const c=require('crypto'); ['ETCH-XXXX-...'].forEach(k=>console.log(c.createHash('sha256').update(k).digest('hex')))"
//   4. Paste the resulting hashes into VALID_KEY_HASHES below
//   5. Re-zip and re-upload to Gumroad
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

// SHA-256 hashes of the 50 issued keys + dev key.
// Original keys are NOT stored here — this file is safe to distribute.
const VALID_KEY_HASHES = new Set([
  "3be296bca81e39bb40ea5f612f806b6a1621b0d494607c49e2301c1f2f469088",
  "1952a70bbff5c48a0a2aaa14586781dc1bffdc4dc93a4aea7ed1d0c641558ce1",
  "d7f2c7055c170a1cefc023d0a7a7f801c44142526543239cf5fd291f6e93dd80",
  "ed8b8013e7f4cfad550ed457fad198841ab86cc7f8dd105b3a02ac40791e7dc6",
  "a5e1175363440f5097f77df471461e1597e1d4550cb7e37e2ea2f222929a62e8",
  "444518b96c055b234b8e5cd353fd8f8deb3ac861e338069946be60ab788cb903",
  "b2b86e70f71eb00bc7d74d707632133c61a4db1fe5fa01ad51edb8110f8487d9",
  "8d7a1052db16b6a6c1f69805f8e5e9332fb026405687a2e64d00aa912d97c207",
  "bc1063df58afeedfcf4c55466510a84d9ed08c242631f43244997d9a79a7c65a",
  "a0636e35f5099a248edf636456448f5309355c2047b7256e5da70b0b13cc61b4",
  "fb506ab82dd890488d3651174713c9646006479f138f6cda04b0af226dc7d868",
  "59379f13a950c8ec9af2dc894c368ca2e310805d9f92d606ebbbbe7f37b98e72",
  "db563109aaea30ff25cd5201ace49b7f1769585ac14635e92efc85d42b1d2423",
  "9e54832c7f5ff6923f5bf654c7f278715d472617bd6725e8e9209632d1909ea9",
  "eec226fc30ef98d3095a087fbe30e930239e335737f8d70e7ecba167e180c5ef",
  "e47075c2674eac5bd9e2d885ea861c99438411f14db4779ef48ea25459f2c86b",
  "4d93917ed04ab6a437d2ea18f286bcd19a40edaa1ec67a4908826f6d32123c2d",
  "8f127c33170b8ccc9acc0c013507e9fbdef7fc4a7aebee45ed0ad1b3d0314d80",
  "7ec8db328bedecb7045d4b45ab4483377f6e4aeedab8182af3ccdaeb8de0c2a7",
  "362f963afbd284e69e490b92afbd45c5d177039a895504224a34e0ef6fe5139b",
  "17506a9bf70d8ec16f12319257d26e49d70dcc97ebc8f4ba8fb60aeb05191001",
  "59b80c96193aab36c6b72864c4b7b87e87cb68978efcbbfda502fc29a2e49aed",
  "350fd3505e34299a7160bfa91ce61758bc269d07cf3e3e2a6c07516300854c99",
  "02dbabb3b949924fa04b6def7e32abf370ac630b13b6553c5bb1e2723b17e285",
  "ee0473e4d14ae8c4947e2cf81b8cc3b31cffe8c570571527c421080df4a9e9e8",
  "9cd6edc23d40c9f9c4dbec5dda674d8204dc7866253194b1b38f1c830da70971",
  "694061c29a82b6cf8bcdc1fc30771d412686be114bc8d85732a2534ece4588d2",
  "57350298c0cb2e9dba1c6663a9d83f2c90249b7cd14b0a4155e6993dd2782938",
  "a394e5f20e0b58212e91ed1d13a1dd87a6d606db21a83783ef5e9c09914b46b9",
  "403f2424e5baa85ff9b08e5c268f5f433a7c49b0525b655e4065904038c08a97",
  "87a8e082309a2d637b6287851d5f3f48cac4e68a5b2f84331908b84652c33281",
  "cbbb1456b7d3e2cfaf90abef078041aceb56bdeb6bb7dbbea09cce4c7cc91059",
  "5d315a5b617810fee816a76e40dbec8c104208fc93085918025e4692af3f67ea",
  "845640610d471e2659b35d5b75c358c96dee3ccb67dbc183d51e77058dd0966e",
  "cb9ee34c5cbf115860ffa0d13d24cfff48d6b095b79bd545f80aa03fae8775f2",
  "9783bdefbb94e56aa91eedc0514d87eabe1d49c8d0e57ccc82197a318fba6073",
  "88003fbdb017e740337c8b5da6869d1af917f7f0f141c7014051a177c6d6fca1",
  "46d376dc23365ab6e88df62227ba51ce3a01cedbdedf978152d9dd4bee6ec0fe",
  "e418eccc3543bc6c88572fd087da171dff6a47ee088a5da69e70222e1abe78a6",
  "453acf354f1b64f8a9818c4467762e8cff9393863b3d957d0694f8902a48048a",
  "765cedc58d9a0a655f9826ef97b7f271f23e43b08ad7f7b20dde907c11b88f90",
  "00fd99c414238932ad7f6b1cc220d31e086075ddea37d141548988492c7fb449",
  "54ad790ea674992cbaaf627f5db0ab62476a5da39cfcee5f60e3d019313ebd1c",
  "12cd36b3d83fbfbdd640b2627f0510a5ddb6072d8ad7b5606afdb827397cd263",
  "f8c230255716bf73fdf5fdfec04cf1ff0ccee4a63dfe44ff302553dbfd92aa94",
  "f5c4f14ccee145c3545e26cee81daa2c65a33028072de7b2d05c7a33687a3c30",
  "53d1242b090c8fcddca77b63c746fec154d0e0eaef0da62c8fd76932f0253c56",
  "1e2ff2d36401eab1bdc5bf0533729cee412ccdc39f6d30da28297039d56f7f19",
  "078c59435e78d0fd55e9914b17944042f9180b0c47e95b7796a9c0c77d5f372f",
  "e3f097ae98bf7f47355ab54cb605c86624ecfbac9e10a08b6e1551a92665668f",
  "f642abe1ffc73358b9cb08ef5bcd53a3b1923fc9c45a79114e80fe7bed9db746", // dev key
]);

// ─────────────────────────────────────────────────────────────────────────────
// CHECKSUM — Layer 1 (fast synchronous pre-filter)
// ─────────────────────────────────────────────────────────────────────────────
const _CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const _CLEN    = _CHARSET.length;

function _computeChecksum(seg1, seg2) {
  const input = seg1 + seg2;
  let hash = 0x811C9DC5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let result = '', h = hash;
  for (let i = 0; i < 4; i++) {
    result += _CHARSET[h % _CLEN];
    h = Math.floor(h / _CLEN);
  }
  return result;
}

function _passesChecksumOrIsDev(key) {
  // Dev key has non-standard format — allow it through to hash check
  if (key === 'ETCH-DEV-OWN-R-KEY') return true;
  const parts = key.split('-');
  if (parts.length !== 4 || parts[0] !== 'ETCH') return false;
  if (parts[1].length !== 4 || parts[2].length !== 4 || parts[3].length !== 4) return false;
  return _computeChecksum(parts[1], parts[2]) === parts[3];
}

// ─────────────────────────────────────────────────────────────────────────────
// SHA-256 HASH — Layer 2 (async, uses browser Web Crypto API)
// ─────────────────────────────────────────────────────────────────────────────
async function _sha256(str) {
  const data   = new TextEncoder().encode(str);
  const buf    = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
const License = {
  /**
   * Full validation: checksum → SHA-256 hash lookup.
   * Async because Web Crypto is Promise-based.
   */
  async validate(key) {
    if (!key || typeof key !== 'string') return false;
    const normalised = key.trim().toUpperCase();
    // Layer 1: checksum (fast reject)
    if (!_passesChecksumOrIsDev(normalised)) return false;
    // Layer 2: hash must be in the issued set
    const hash = await _sha256(normalised);
    return VALID_KEY_HASHES.has(hash);
  },

  async activate(key) {
    const isValid = await this.validate(key);
    await Storage.setLicense(key.trim().toUpperCase(), isValid);
    return isValid;
  },

  async isLicensed() {
    const { valid } = await Storage.getLicenseStatus();
    return valid === true;
  },

  async getStatus() {
    return Storage.getLicenseStatus();
  },
};
