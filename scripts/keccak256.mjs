// Keccak-256 (the pre-NIST padding Ethereum uses), for checking function selectors in tests.
// Node's crypto has only NIST SHA3-256, which pads differently. Dev-only: the site does not load it.
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const MASK = (1n << 64n) - 1n;

function rotl(x, n) {
  const k = BigInt(n);
  return k === 0n ? x : ((x << k) | (x >> (64n - k))) & MASK;
}

function keccakF(s) {
  for (let round = 0; round < 24; round += 1) {
    const c = [];
    for (let x = 0; x < 5; x += 1) {
      c[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) {
        s[x + 5 * y] ^= d;
      }
    }
    const b = new Array(25);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        s[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & MASK & b[((x + 2) % 5) + 5 * y]);
      }
    }
    s[0] ^= RC[round];
  }
}

/**
 * :param input: string (UTF-8) or Uint8Array.
 * :return: lowercase hex digest without 0x.
 */
export function keccak256(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const rate = 136;
  const padLen = rate - (bytes.length % rate);
  const msg = new Uint8Array(bytes.length + padLen);
  msg.set(bytes);
  msg[bytes.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 8; i += 1) {
      let lane = 0n;
      for (let j = 7; j >= 0; j -= 1) {
        lane = (lane << 8n) | BigInt(msg[off + i * 8 + j]);
      }
      s[i] ^= lane;
    }
    keccakF(s);
  }
  let hex = "";
  for (let i = 0; i < 4; i += 1) {
    let lane = s[i];
    for (let j = 0; j < 8; j += 1) {
      hex += Number(lane & 0xffn).toString(16).padStart(2, "0");
      lane >>= 8n;
    }
  }
  return hex;
}

/** First 4 bytes of keccak256(signature), as 0x-hex. */
export function selector(signature) {
  return `0x${keccak256(signature).slice(0, 8)}`;
}
