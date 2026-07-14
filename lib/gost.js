// ============================================================
// GOST 28147-89 Block Cipher (Pure JavaScript)
// S-box: CryptoPro (id-Gost28147-89-CryptoPro-A-ParamSet)
// ============================================================

const SBOX = [
  [4, 10, 9, 2, 13, 8, 0, 14, 6, 11, 1, 12, 7, 15, 5, 3],
  [14, 11, 4, 12, 6, 13, 15, 10, 2, 3, 8, 1, 0, 7, 5, 9],
  [5, 8, 1, 13, 10, 3, 4, 2, 14, 15, 12, 7, 6, 0, 9, 11],
  [7, 13, 10, 1, 0, 8, 9, 15, 14, 4, 6, 12, 11, 2, 5, 3],
  [6, 12, 7, 1, 5, 15, 13, 8, 4, 10, 9, 14, 0, 3, 11, 2],
  [4, 11, 10, 0, 7, 2, 1, 13, 3, 6, 8, 5, 9, 12, 15, 14],
  [13, 11, 4, 1, 3, 15, 5, 9, 0, 10, 14, 7, 6, 8, 2, 12],
  [1, 15, 13, 0, 5, 7, 10, 4, 9, 2, 3, 14, 6, 11, 8, 12],
];

const KEY_LEN = 32;
const BLOCK_LEN = 8;

function substitute(value) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    const nibble = (value >>> (4 * i)) & 0xF;
    result |= SBOX[i][nibble] << (4 * i);
  }
  return result >>> 0;
}

function rotl11(value) {
  return ((value << 11) | (value >>> 21)) >>> 0;
}

function add32(a, b) {
  return ((a + b) & 0xFFFFFFFF) >>> 0;
}

function blockToWords(block) {
  const n0 = (block[0] | (block[1] << 8) | (block[2] << 16) | (block[3] << 24)) >>> 0;
  const n1 = (block[4] | (block[5] << 8) | (block[6] << 16) | (block[7] << 24)) >>> 0;
  return [n0, n1];
}

function wordsToBlock(n0, n1) {
  return new Uint8Array([
    n0 & 0xFF, (n0 >>> 8) & 0xFF, (n0 >>> 16) & 0xFF, (n0 >>> 24) & 0xFF,
    n1 & 0xFF, (n1 >>> 8) & 0xFF, (n1 >>> 16) & 0xFF, (n1 >>> 24) & 0xFF,
  ]);
}

function keyToWords(key) {
  const words = [];
  for (let i = 0; i < 8; i++) {
    const off = i * 4;
    words.push(
      ((key[off] | (key[off + 1] << 8) | (key[off + 2] << 16) | (key[off + 3] << 24)) >>> 0)
    );
  }
  return words;
}

function gostEncryptBlock(key, block) {
  const K = keyToWords(key);
  let [n0, n1] = blockToWords(block);

  for (let round = 0; round < 32; round++) {
    let kIdx;
    if (round < 24) {
      kIdx = round % 8;
    } else {
      kIdx = 7 - (round % 8);
    }
    const temp = substitute(add32(n1, K[kIdx]));
    const shifted = rotl11(temp);
    const n2 = (n0 ^ shifted) >>> 0;
    n0 = n1;
    n1 = n2;
  }

  return wordsToBlock(n1, n0);
}

function gostDecryptBlock(key, block) {
  const K = keyToWords(key);
  let [n0, n1] = blockToWords(block);

  for (let round = 0; round < 32; round++) {
    let kIdx;
    if (round < 8) {
      kIdx = round % 8;
    } else {
      kIdx = 7 - (round % 8);
    }
    const temp = substitute(add32(n1, K[kIdx]));
    const shifted = rotl11(temp);
    const n2 = (n0 ^ shifted) >>> 0;
    n0 = n1;
    n1 = n2;
  }

  return wordsToBlock(n1, n0);
}

// === CTR mode ===
function xorBytes(a, b) {
  const len = Math.min(a.length, b.length);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = a[i] ^ b[i];
  }
  return out;
}

function incCtr(ctr) {
  for (let i = ctr.length - 1; i >= 0; i--) {
    ctr[i]++;
    if (ctr[i] !== 0) break;
  }
}

function gostCtrEncrypt(key, iv, plaintext) {
  const ctr = new Uint8Array(iv);
  const result = new Uint8Array(plaintext.length);
  let offset = 0;

  while (offset < plaintext.length) {
    const keystream = gostEncryptBlock(key, ctr);
    const chunk = plaintext.slice(offset, offset + BLOCK_LEN);
    const encrypted = xorBytes(chunk, keystream);
    result.set(encrypted, offset);
    offset += BLOCK_LEN;
    incCtr(ctr);
  }

  return result;
}

function gostCtrDecrypt(key, iv, ciphertext) {
  return gostCtrEncrypt(key, iv, ciphertext);
}

// === Helpers ===
function generateKey() {
  const key = new Uint8Array(KEY_LEN);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(key);
  } else {
    for (let i = 0; i < KEY_LEN; i++) {
      key[i] = Math.floor(Math.random() * 256);
    }
  }
  return key;
}

function generateIV() {
  const iv = new Uint8Array(BLOCK_LEN);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(iv);
  } else {
    for (let i = 0; i < BLOCK_LEN; i++) {
      iv[i] = Math.floor(Math.random() * 256);
    }
  }
  return iv;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

function bytesToString(bytes) {
  return new TextDecoder().decode(bytes);
}

// === High-level API ===
function createGostCipher(key) {
  const iv = generateIV();
  return {
    key,
    iv,
    encrypt(plaintext) {
      const data = typeof plaintext === 'string' ? stringToBytes(plaintext) : plaintext;
      const encrypted = gostCtrEncrypt(key, iv, data);
      return {
        iv: bytesToBase64(iv),
        data: bytesToBase64(encrypted),
      };
    },
    decrypt(cipherData) {
      const iv = base64ToBytes(cipherData.iv);
      const encrypted = base64ToBytes(cipherData.data);
      const decrypted = gostCtrDecrypt(key, iv, encrypted);
      return bytesToString(decrypted);
    },
    staticDecrypt(ivB64, dataB64) {
      const ivBytes = base64ToBytes(ivB64);
      const encBytes = base64ToBytes(dataB64);
      return bytesToString(gostCtrDecrypt(key, ivBytes, encBytes));
    },
  };
}

module.exports = {
  gostEncryptBlock,
  gostDecryptBlock,
  gostCtrEncrypt,
  gostCtrDecrypt,
  generateKey,
  generateIV,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  stringToBytes,
  bytesToString,
  createGostCipher,
  BLOCK_LEN,
  KEY_LEN,
};
