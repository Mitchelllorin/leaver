/**
 * Deterministic, dependency-free noise.
 *
 * Sampling is done in 3D on a cylinder: points on the sphere of longitude map
 * to (cos u, sin u, v), so equirectangular textures tile seamlessly in x —
 * no seam on the far side of a planet.
 */

const TABLE_SIZE = 256;
const MASK = TABLE_SIZE - 1;

/** Mulberry32 — small, fast, seedable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string -> 32-bit seed. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PERM = new Uint8Array(TABLE_SIZE * 2);
(function buildPerm() {
  const rnd = mulberry32(0x9e3779b9);
  const p = new Uint8Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i++) p[i] = i;
  for (let i = TABLE_SIZE - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < TABLE_SIZE * 2; i++) PERM[i] = p[i & MASK];
})();

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(hash, x, y, z) {
  switch (hash & 15) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x + z;
    case 5: return -x + z;
    case 6: return x - z;
    case 7: return -x - z;
    case 8: return y + z;
    case 9: return -y + z;
    case 10: return y - z;
    case 11: return -y - z;
    case 12: return x + y;
    case 13: return -y + z;
    case 14: return -x + y;
    default: return -y - z;
  }
}

/** Perlin-style gradient noise in 3D. Range roughly [-1, 1]. */
export function noise3(x, y, z) {
  const X = Math.floor(x) & MASK;
  const Y = Math.floor(y) & MASK;
  const Z = Math.floor(z) & MASK;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const zf = z - Math.floor(z);
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  const a = PERM[X] + Y;
  const aa = PERM[a & MASK] + Z;
  const ab = PERM[(a + 1) & MASK] + Z;
  const b = PERM[(X + 1) & MASK] + Y;
  const ba = PERM[b & MASK] + Z;
  const bb = PERM[(b + 1) & MASK] + Z;

  const lerp = (t, p, q) => p + t * (q - p);

  const x1 = lerp(u, grad(PERM[aa & MASK], xf, yf, zf), grad(PERM[ba & MASK], xf - 1, yf, zf));
  const x2 = lerp(u, grad(PERM[ab & MASK], xf, yf - 1, zf), grad(PERM[bb & MASK], xf - 1, yf - 1, zf));
  const y1 = lerp(v, x1, x2);

  const x3 = lerp(u, grad(PERM[(aa + 1) & MASK], xf, yf, zf - 1), grad(PERM[(ba + 1) & MASK], xf - 1, yf, zf - 1));
  const x4 = lerp(u, grad(PERM[(ab + 1) & MASK], xf, yf - 1, zf - 1), grad(PERM[(bb + 1) & MASK], xf - 1, yf - 1, zf - 1));
  const y2 = lerp(v, x3, x4);

  return lerp(w, y1, y2) * 1.4;
}

/**
 * Fractal brownian motion on a cylinder.
 * @param {number} u longitude 0..1 (wraps seamlessly)
 * @param {number} v latitude -0.5..0.5
 * @param {number} scale frequency
 * @param {number} octaves
 * @param {number} lacunarity
 * @param {number} gain
 */
export function fbmCylinder(u, v, scale = 4, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let amp = 1;
  let freq = scale;
  let sum = 0;
  let norm = 0;
  const radius = 1;
  const ang = u * Math.PI * 2;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(ca * freq * radius, sa * freq * radius, v * freq * radius);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged variant — good for canyons, crack systems, tiger stripes. */
export function ridgedCylinder(u, v, scale = 5, octaves = 4) {
  let amp = 1;
  let freq = scale;
  let sum = 0;
  let norm = 0;
  const ang = u * Math.PI * 2;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise3(ca * freq, sa * freq, v * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}
