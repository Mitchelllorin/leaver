import * as THREE from 'three';
import { noise3, mulberry32, hashString } from '../util/noise.js';
import { clamp, lerp, smoothstep } from '../util/math.js';

/**
 * Procedural surface generation.
 *
 * No image files ship with the sim: every world, ring, cloud deck and star
 * surface is painted at runtime into a canvas. That keeps the whole thing
 * offline-capable and means a new planet in data/bodies.js needs nothing but a
 * colour palette to look like somewhere real.
 *
 * Detail level scales with how close you are: a low-resolution version is
 * built at boot so the system is instantly explorable, then each body is
 * repainted at higher resolution in idle time.
 */

// ---------------------------------------------------------------- helpers ---

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3 ? h.split('').map((c) => c + c).join('') : h,
    16
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Build a multi-stop colour ramp from a palette array.
 *
 * The returned function writes into a SHARED scratch array and returns it, so
 * callers must consume the result immediately (they all do). Painting a
 * 2048-wide map means a million calls per body; allocating per call is the
 * difference between a 200 ms paint and a 2 s one.
 */
const _rampScratch = [0, 0, 0];
function makeRamp(palette) {
  const stops = palette.map(hexToRgb);
  const n = Math.max(1, stops.length - 1);
  const out = _rampScratch;
  return (t) => {
    const x = clamp(t, 0, 1) * n;
    const i = Math.min(Math.floor(x), n - 1);
    const f = x - i;
    const a = stops[i];
    const b = stops[Math.min(i + 1, stops.length - 1)];
    out[0] = a[0] + (b[0] - a[0]) * f;
    out[1] = a[1] + (b[1] - a[1]) * f;
    out[2] = a[2] + (b[2] - a[2]) * f;
    return out;
  };
}

/**
 * Stamp impact craters onto height + colour buffers.
 * Only touches each crater's bounding box, and wraps horizontally so craters
 * never get sliced in half at the texture seam.
 */
function stampCraters(W, H, count, rng, height, colorFn) {
  for (let c = 0; c < count; c++) {
    const cx = rng() * W;
    const cy = H * (0.08 + rng() * 0.84);
    const r = 2 + Math.pow(rng(), 2.6) * Math.min(W / 16, 26);
    const depth = 0.25 + rng() * 0.75;
    const rim = 1 + rng() * 0.6;
    const x0 = Math.floor(cx - r * 1.6);
    const x1 = Math.ceil(cx + r * 1.6);
    const y0 = Math.max(0, Math.floor(cy - r * 1.6));
    const y1 = Math.min(H - 1, Math.ceil(cy + r * 1.6));

    for (let y = y0; y <= y1; y++) {
      for (let xw = x0; xw <= x1; xw++) {
        const x = ((xw % W) + W) % W;
        const dx = xw - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d > 1.6) continue;
        const idx = y * W + x;

        // Bowl + raised rim, the classic simple crater profile.
        let dh = 0;
        if (d < 1) dh = -depth * (1 - d * d) * 0.9;
        dh += rim * 0.28 * Math.exp(-Math.pow((d - 1.02) * 3.4, 2));

        height[idx] += dh * 0.5;
        if (colorFn) colorFn(x, y, idx, d, dh);
      }
    }
  }
}

/** Longitude/latitude -> unit sphere position, for seamless cylinder noise. */
function sphereVec(x, W, y, H) {
  const u = x / W;
  const v = y / H - 0.5;
  const lat = v * Math.PI;
  const cosLat = Math.cos(lat);
  return {
    u,
    v,
    // 3D point on the unit sphere — noise in 3D is inherently seam-free, which
    // is the simplest way to avoid an ugly line down the back of every planet.
    sx: Math.cos(u * Math.PI * 2) * cosLat,
    sy: Math.sin(lat),
    sz: Math.sin(u * Math.PI * 2) * cosLat,
  };
}


/** Seam-free 3D fbm built from the sphere parameterisation above. */
function fbmSphere(p, scale, octaves = 5, gain = 0.5, lacunarity = 2.03) {
  let amp = 1;
  let freq = scale;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(p.sx * freq + 11.3, p.sy * freq + 5.7, p.sz * freq + 3.1);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function ridgedSphere(p, scale, octaves = 4) {
  let amp = 1;
  let freq = scale;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise3(p.sx * freq + 21.1, p.sy * freq + 9.3, p.sz * freq + 7.7));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

// -------------------------------------------------------- surface painters ---

const SURFACE_PAINTERS = {
  /** Airless, battered rock: Mercury, the Moon, Mars-like crusts. */
  rocky(ctx) {
    const { W, H, visual, rng, height, rgba, hgt } = ctx;
    const ramp = makeRamp(visual.palette);
    const o = visual.noise ?? {};
    const scale = o.scale ?? 5;
    const contrast = o.contrast ?? 0.6;
    const maria = o.maria ?? 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = sphereVec(x, W, y, H);
        let h = fbmSphere(p, scale, 6) * 0.5 + 0.5;
        h = clamp(0.5 + (h - 0.5) * (0.8 + contrast), 0, 1);
        if (maria > 0) {
          const dark = smoothstep(0.45, 0.72, fbmSphere(p, 1.7, 3) * 0.5 + 0.5);
          h = lerp(h, h * 0.62, dark * maria);
        }
        hgt[y * W + x] = h;
        const c = ramp(h);
        const i = (y * W + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;
      }
    }

    if (o.craters) {
      stampCraters(W, H, o.craters, rng, height, (x, y, idx, d, dh) => {
        const i = idx * 4;
        // Ejecta rays brighten the rim, shadow the bowl.
        const shade = 1 + dh * 1.25;
        rgba[i] = clamp(rgba[i] * shade, 0, 255);
        rgba[i + 1] = clamp(rgba[i + 1] * shade, 0, 255);
        rgba[i + 2] = clamp(rgba[i + 2] * shade, 0, 255);
      });
    }
  },

  /** Earth-like: oceans, continents, ice caps, a hint of green. */
  terra(ctx) {
    const { W, H, visual, height, rgba, hgt } = ctx;
    const o = visual.noise ?? {};
    const seaLevel = o.seaLevel ?? 0.5;
    const ice = o.ice ?? 0.7;
    const ocean = hexToRgb(visual.palette[0]);
    const land = makeRamp(visual.palette.slice(1));
    const deep = [ocean[0] * 0.55, ocean[1] * 0.6, ocean[2] * 0.75];

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = sphereVec(x, W, y, H);
        // Continent shapes: large low-frequency blobs plus coastline detail.
        let h = fbmSphere(p, 2.1, 7, 0.52) * 0.5 + 0.5;
        h = h * 0.75 + (fbmSphere(p, 6.5, 4) * 0.5 + 0.5) * 0.25;
        hgt[y * W + x] = h;
        const i = (y * W + x) * 4;

        // Polar ice caps. `ice` is a fraction of a quarter-turn of latitude
        // (0 = equator, 1 = pole), NOT |sin(lat)| — using the sine would freeze
        // everything above 34 degrees and drown the planet in white.
        const latEdge = Math.abs(p.sy) === 1 ? 1 : Math.abs(Math.asin(clamp(p.sy, -1, 1))) / (Math.PI / 2);
        const capNoise = fbmSphere(p, 5, 3) * 0.05;
        const iceness = smoothstep(ice - 0.05 + capNoise, ice + 0.12 + capNoise, latEdge);

        let c;
        if (h < seaLevel) {
          const d = clamp((seaLevel - h) / seaLevel, 0, 1);
          c = [
            lerp(ocean[0], deep[0], d),
            lerp(ocean[1], deep[1], d),
            lerp(ocean[2], deep[2], d),
          ];
        } else {
          const t = clamp((h - seaLevel) / (1 - seaLevel), 0, 1);
          // Deserts near 25-35 degrees, jungle at the equator.
          const dry = Math.exp(-Math.pow((latEdge * 90 - 28) / 11, 2));
          const green = lerp(0.35, 1, smoothstep(0, 0.35, t)) * (1 - dry * 0.8);
          const lc = land(clamp(t * 0.9 + dry * 0.25, 0, 1));
          c = [lc[0] * green + lc[0] * (1 - green) * 1.15, lc[1] * (0.7 + green * 0.3), lc[2] * (0.55 + green * 0.2)];
        }
        if (iceness > 0) {
          const iceC = [240, 246, 252];
          c = [
            lerp(c[0], iceC[0], iceness),
            lerp(c[1], iceC[1], iceness),
            lerp(c[2], iceC[2], iceness),
          ];
        }
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;
      }
    }
  },

  /** Frozen worlds: Europa, Enceladus, Pluto, Triton, Ganymede, Callisto. */
  icy(ctx) {
    const { W, H, visual, height, rgba, hgt } = ctx;
    const ramp = makeRamp(visual.palette);
    const o = visual.noise ?? {};
    const cracks = o.cracks ?? 0;
    const stripes = o.tigerStripes ?? 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = sphereVec(x, W, y, H);
        let h = fbmSphere(p, o.scale ?? 5, 5) * 0.5 + 0.5;
        h = clamp(0.5 + (h - 0.5) * (0.8 + (o.contrast ?? 0.5)), 0, 1);
        hgt[y * W + x] = h;
        let c = ramp(h);

        if (cracks > 0) {
          // Ridged noise makes convincing brittle-ice fracture systems.
          const r = ridgedSphere(p, 4.5, 4);
          const line = smoothstep(0.82, 0.93, r) * cracks;
          const dark = lerp(1, 0.62, line);
          c = [c[0] * dark, c[1] * dark * 0.98, c[2] * dark * 0.95];
        }
        if (stripes > 0) {
          // Tiger stripes: a banded ridged field confined to high latitudes.
          const band = ridgedSphere(p, 9, 3) * smoothstep(0.25, 0.55, Math.abs(p.sy));
          const line = smoothstep(0.78, 0.95, band) * stripes;
          const dark = lerp(1, 0.78, line);
          c = [c[0] * dark, c[1] * dark, c[2] * dark * 1.02];
        }
        const i = (y * W + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;
      }
    }
    if (o.craters) {
      stampCraters(W, H, o.craters, ctx.rng, ctx.height, (x, y, idx, d, dh) => {
        const i = idx * 4;
        const shade = 1 + dh * 1.1;
        rgba[i] = clamp(rgba[i] * shade, 0, 255);
        rgba[i + 1] = clamp(rgba[i + 1] * shade, 0, 255);
        rgba[i + 2] = clamp(rgba[i + 2] * shade, 0, 255);
      });
    }
  },

  /** Io: sulfur yellows, orange flows, and glowing lava in `emissive`. */
  volcanic(ctx) {
    const { W, H, visual, rgba, emissive, hgt, height, rng } = ctx;
    const ramp = makeRamp(visual.palette);
    const o = visual.noise ?? {};

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = sphereVec(x, W, y, H);
        const base = fbmSphere(p, o.scale ?? 4, 6) * 0.5 + 0.5;
        const fine = fbmSphere(p, 16, 3) * 0.5 + 0.5;
        const h = clamp(base * 0.8 + fine * 0.2, 0, 1);
        hgt[y * W + x] = h;
        const c = ramp(h);
        const i = (y * W + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;

        // Lava: hot ridged veins, plus discrete volcanic vents.
        const vein = ridgedSphere(p, 6, 4);
        const lava = smoothstep(0.86, 0.97, vein);
        if (lava > 0.001) {
          emissive[i] = 255 * lava;
          emissive[i + 1] = 140 * lava * lava;
          emissive[i + 2] = 20 * lava * lava * lava;
          emissive[i + 3] = 255;
        }
      }
    }
    // Vents / calderas
    for (let v = 0; v < 40; v++) {
      const cx = rng() * W;
      const cy = H * (0.1 + rng() * 0.8);
      const r = 1.5 + rng() * 5;
      for (let y = Math.max(0, cy - r | 0); y <= Math.min(H - 1, cy + r | 0); y++) {
        for (let xw = cx - r | 0; xw <= cx + r | 0; xw++) {
          const x = ((xw % W) + W) % W;
          const d = Math.hypot(xw - cx, y - cy) / r;
          if (d > 1) continue;
          const glow = Math.pow(1 - d, 1.6);
          const i = (y * W + x) * 4;
          rgba[i] = clamp(rgba[i] + glow * 90, 0, 255);
          rgba[i + 1] = clamp(rgba[i + 1] + glow * 30, 0, 255);
          emissive[i] = Math.max(emissive[i], 255 * glow);
          emissive[i + 1] = Math.max(emissive[i + 1], 120 * glow * glow);
          emissive[i + 2] = Math.max(emissive[i + 2], 10 * glow);
        }
      }
    }
  },

  /** Titan: an almost featureless orange haze; the detail comes from clouds. */
  hazy(ctx) {
    const { W, H, visual, rgba, hgt } = ctx;
    const ramp = makeRamp(visual.palette);
    const o = visual.noise ?? {};
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = sphereVec(x, W, y, H);
        const h = clamp(
          0.5 + fbmSphere(p, o.scale ?? 2.2, 5) * (o.contrast ?? 0.3),
          0, 1
        );
        hgt[y * W + x] = h;
        const c = ramp(h);
        const i = (y * W + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;
      }
    }
  },
};

export const SURFACE_TYPES = Object.keys(SURFACE_PAINTERS);

/**
 * Banded gas-giant and star atmospheres.
 *
 * Latitude bands are the dominant structure, warped by turbulence so they
 * swirl instead of looking like a striped wallpaper. Zonal wind shear adds the
 * streaky detail real cloud tops have.
 */
function paintGasGiant(ctx) {
  const { W, H, visual, rgba, emissive, hgt } = ctx;
  const ramp = makeRamp(visual.palette);
  const o = visual.noise ?? {};
  const bands = visual.bands ?? 12;
  const warp = visual.bandWarp ?? 0.5;
  const speedSeed = visual.spot ? 1 : 0;

  for (let y = 0; y < H; y++) {
    const v = y / H - 0.5;
    const lat = v * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    const poleFade = smoothstep(0.72, 1, Math.abs(v) * 2);

    for (let x = 0; x < W; x++) {
      const u = x / W;
      const ang = u * Math.PI * 2;
      const sx = Math.cos(ang) * cosLat;
      const sy = sinLat;
      const sz = Math.sin(ang) * cosLat;

      // Domain warp: displace latitude by low-frequency turbulence.
      let w = 0;
      let amp = 1;
      let freq = 2.5;
      for (let k = 0; k < 4; k++) {
        w += amp * noise3(sx * freq + 3.1, sy * freq * 0.35 + 1.7, sz * freq + 6.3);
        amp *= 0.55;
        freq *= 2.1;
      }
      const latWarped = v + w * warp * 0.06;

      // Bands: sums of harmonics give the irregular belt/zone cadence.
      let band =
        0.5 +
        0.34 * Math.sin(latWarped * bands * Math.PI * 2) +
        0.16 * Math.sin(latWarped * bands * 0.5 * Math.PI * 2 + 1.1) +
        0.08 * Math.sin(latWarped * bands * 2.7 * Math.PI * 2 + 2.4);

      // Fine zonal shear detail, stretched horizontally.
      const shear = noise3(sx * 1.5 + 5, sy * 26 + 2, sz * 1.5 + 9);
      band += shear * (o.contrast ?? 0.35) * 0.32;
      band = clamp(0.5 + (band - 0.5) * 1.25, 0, 1);
      band = lerp(band, band * 0.86 + 0.07, poleFade);

      let c = ramp(band);

      // Great Red Spot / Great Dark Spot, a rotating anticyclone.
      if (visual.spot || visual.darkSpot) {
        const spotLat = visual.spot ? -0.38 : -0.3;
        const spotLon = visual.spot ? 0.62 : 0.3;
        let dlon = u - spotLon;
        if (dlon > 0.5) dlon -= 1;
        if (dlon < -0.5) dlon += 1;
        const dv = v - spotLat;
        const dr = Math.sqrt(
          Math.pow(dlon / 0.075, 2) + Math.pow(dv / 0.045, 2)
        );
        if (dr < 1.6) {
          const swirl = noise3(sx * 8 + dlon * 30, sy * 8, sz * 8) * 0.5 + 0.5;
          const k = Math.pow(clamp(1 - dr / 1.5, 0, 1), 1.5) * (0.65 + swirl * 0.35);
          const spotColor = visual.spot ? [196, 88, 58] : [28, 40, 92];
          c = [
            lerp(c[0], spotColor[0], k),
            lerp(c[1], spotColor[1], k),
            lerp(c[2], spotColor[2], k),
          ];
        }
      }

      const i = (y * W + x) * 4;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
      // Gas giants have no relief worth bumping.
      hgt[y * W + x] = 0.5 + (band - 0.5) * 0.06;
    }
  }
  if (emissive && speedSeed) {
    // faint lightning flashes deep in the atmosphere
  }
}

/** Photosphere: granulation, supergranule network, faculae, a few sunspots. */
function paintStar(ctx) {
  const { W, H, visual, rgba, emissive, hgt, rng } = ctx;
  const ramp = makeRamp(visual.palette);
  const o = visual.noise ?? {};

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = sphereVec(x, W, y, H);
      // Granulation: many small convective cells.
      const granules = fbmSphere(p, 26, 4) * 0.5 + 0.5;
      const network = ridgedSphere(p, 12, 3);
      const large = fbmSphere(p, 3.5, 4) * 0.5 + 0.5;
      let t = granules * 0.55 + network * 0.25 + large * 0.2;
      t = clamp((t - 0.5) * (1 + (o.contrast ?? 0.5)) + 0.5, 0, 1);
      t = Math.pow(t, 0.85);
      const c = ramp(t);
      const i = (y * W + x) * 4;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
      // The photosphere is genuinely emissive — this is the real light source.
      emissive[i] = c[0];
      emissive[i + 1] = c[1];
      emissive[i + 2] = c[2];
      emissive[i + 3] = 255;
      hgt[y * W + x] = t;
    }
  }
  // Sunspots: dark umbra with a lighter penumbra, mostly in active latitudes.
  for (let s = 0; s < 14; s++) {
    const cx = rng() * W;
    const cy = H * (0.2 + rng() * 0.6);
    const r = 3 + rng() * 14;
    for (let y = Math.max(0, cy - r * 1.5 | 0); y <= Math.min(H - 1, cy + r * 1.5 | 0); y++) {
      for (let xw = cx - r * 1.5 | 0; xw <= cx + r * 1.5 | 0; xw++) {
        const x = ((xw % W) + W) % W;
        const d = Math.hypot(xw - cx, y - cy) / r;
        if (d > 1.5) continue;
        const k = d < 1 ? 0.45 + d * 0.12 : lerp(0.57, 1, smoothstep(1, 1.5, d));
        const i = (y * W + x) * 4;
        rgba[i] *= k;
        rgba[i + 1] *= k * 0.96;
        rgba[i + 2] *= k * 0.85;
        emissive[i] *= k;
        emissive[i + 1] *= k * 0.96;
        emissive[i + 2] *= k * 0.85;
      }
    }
  }
}

// --------------------------------------------------------------- assembly ---

function canvasFrom(W, H, data) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(data, W, H), 0, 0);
  return canvas;
}

/**
 * Paint one body at a given resolution.
 * @returns {{ color: HTMLCanvasElement, bump: HTMLCanvasElement|null,
 *             emissive: HTMLCanvasElement|null }}
 */
export function paintBody(body, W, H) {
  const visual = body.visual ?? {};
  const rng = mulberry32(hashString(body.id));
  const px = W * H;
  const rgba = new Uint8ClampedArray(px * 4);
  const hgt = new Float32Array(px);
  const height = new Float32Array(px);
  const heightMap = px;

  const needsEmissive =
    visual.surface === 'star' || visual.surface === 'volcanic' || visual.cityLights;
  const emissive = needsEmissive ? new Uint8ClampedArray(px * 4) : null;

  const ctx = { W, H, visual, rng, rgba, hgt, height: height, emissive, heightMap };

  if (visual.surface === 'star') paintStar(ctx);
  else if (visual.surface === 'gas') paintGasGiant(ctx);
  else if (SURFACE_PAINTERS[visual.surface]) SURFACE_PAINTERS[visual.surface](ctx);
  else SURFACE_PAINTERS.rocky({ ...ctx, visual: { ...visual, surface: 'rocky' } });

  // Combine the base elevation with accumulated crater deltas, then normalise
  // into a grayscale bump map.
  const bump = new Uint8ClampedArray(px * 4);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < px; i++) {
    const v = hgt[i] + height[i] * 0.5;
    hgt[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;
  for (let i = 0; i < px; i++) {
    const g = Math.round(((hgt[i] - lo) / range) * 255);
    const j = i * 4;
    bump[j] = bump[j + 1] = bump[j + 2] = g;
    bump[j + 3] = 255;
  }

  return {
    color: canvasFrom(W, H, rgba),
    bump: canvasFrom(W, H, bump),
    emissive: emissive ? canvasFrom(W, H, emissive) : null,
  };
}

/** Cloud deck: white fbm, banded by latitude like real weather systems. */
export function paintClouds(body, W, H) {
  const rng = mulberry32(hashString(body.id + ':clouds'));
  const px = W * H;
  const rgba = new Uint8ClampedArray(px * 4);
  const cfg = body.visual?.clouds ?? {};
  const scale = cfg.scale ?? 2.4;
  const bandiness = cfg.bandiness ?? 0.5;

  for (let y = 0; y < H; y++) {
    const v = y / H - 0.5;
    for (let x = 0; x < W; x++) {
      const p = sphereVec(x, W, y, H);
      let n = fbmSphere(p, scale, 7, 0.55) * 0.5 + 0.5;
      n = n * 0.8 + (ridgedSphere(p, scale * 3, 4) * 0.5 + 0.5) * 0.2;
      // Cloud bands roughly follow latitude, with cyclonic swirls.
      const band = 0.5 + 0.5 * Math.sin(v * Math.PI * 9);
      n = lerp(n, n * (0.55 + band * 0.75), bandiness);
      const a = clamp(smoothstep(0.48, 0.78, n), 0, 1);
      const i = (y * W + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return canvasFrom(W, H, rgba);
}

/** City lights on the night side — Earth only, but trivially reusable. */
export function paintCityLights(body, W, H) {
  const rng = mulberry32(hashString(body.id + ':cities'));
  const px = W * H;
  const rgba = new Uint8ClampedArray(px * 4);
  const palette = body.visual?.palette ?? ['#2e7d32'];

  // Only light up land: re-derive the same landmask the surface painter made.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = sphereVec(x, W, y, H);
      let h = fbmSphere(p, 2.1, 7, 0.52) * 0.5 + 0.5;
      h = h * 0.75 + (fbmSphere(p, 6.5, 4) * 0.5 + 0.5) * 0.25;
      const isLand = h > 0.5;
      const latOk = Math.abs(p.sy) < 0.72;
      const pop = fbmSphere(p, 7, 5) * 0.5 + 0.5;
      const lit = isLand && latOk ? smoothstep(0.62, 0.85, pop) : 0;
      const i = (y * W + x) * 4;
      rgba[i] = 255;
      rgba[i + 1] = 214;
      rgba[i + 2] = 150;
      rgba[i + 3] = Math.round(clamp(lit, 0, 1) * 235);
    }
  }
  return canvasFrom(W, H, rgba);
}

/**
 * Ring texture: a 1-D radial strip (with vertical repeat for streaks).
 * `detail` entries from the data file define gaps like the Cassini division.
 */
export function paintRings(body, W = 1024, H = 64) {
  const { rings } = body;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const base = hexToRgb(rings.color ?? '#d8c8a0');
  const rng = mulberry32(hashString(body.id + ':rings'));
  const span = rings.outer - rings.inner;

  for (let x = 0; x < W; x++) {
    const t = x / W;
    const planetRadii = rings.inner + t * span;
    let a = rings.opacity ?? 0.6;

    if (rings.detail) {
      for (const band of rings.detail) {
        if (planetRadii >= band.from && planetRadii <= band.to) {
          const local = (planetRadii - band.from) / (band.to - band.from);
          // soft edges so ring boundaries aren't razor-sharp
          const edge = Math.min(
            smoothstep(0, 0.08, local),
            smoothstep(0, 0.08, 1 - local)
          );
          a = lerp(a * 0.35, band.opacity, edge);
        }
      }
    }
    // Fine ringlet structure
    const ringlet = 0.5 + 0.5 * Math.sin(planetRadii * 180) * 0.35;
    a *= 0.55 + ringlet * 0.65;

    for (let y = 0; y < H; y++) {
      const streak = 0.88 + 0.12 * Math.sin(y * 0.9 + rng() * 0.02);
      const i = (y * W + x) * 4;
      rgba[i] = clamp(base[0] * streak, 0, 255);
      rgba[i + 1] = clamp(base[1] * streak, 0, 255);
      rgba[i + 2] = clamp(base[2] * streak, 0, 255);
      rgba[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  return canvasFrom(W, H, rgba);
}

// -------------------------------------------------------- texture manager ---

/**
 * Progressive-detail texture cache.
 *
 * Level 0 is built during boot (fast, small). Higher levels are queued and
 * painted during idle time, or immediately when the camera gets close enough
 * that the difference would show.
 */
export class TextureManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.cache = new Map();
    // Level 0 is deliberately tiny: it is painted for every body at boot so
    // the system is explorable in about a second. Higher levels are queued and
    // painted when a body is big enough on screen for the difference to show.
    this.levels = [
      { size: 128, key: 0 },
      { size: 512, key: 1 },
      { size: 1024, key: 2 },
      { size: 2048, key: 3 },
    ];
    this.pending = [];
    this.painted = 0;
    this.paintMs = 0;
    this._scheduled = false;
  }

  /** Paint synchronously at `level` and cache it. */
  build(body, level) {
    const lv = Math.min(level, this.levels.length - 1);
    const id = `${body.id}:${lv}`;
    const hit = this.cache.get(id);
    if (hit) return hit;

    const W = this.levels[lv].size;
    const H = Math.max(64, W / 2);
    const t0 = performance.now();
    const { color, bump, emissive } = paintBody(body, W, H);

    const entry = {
      level: lv,
      size: W,
      colorCanvas: color,
      bumpCanvas: bump,
      emissiveCanvas: emissive,
      colorMap: canvasTexture(color),
      bumpMap: canvasTexture(bump),
      emissiveMap: emissive ? canvasTexture(emissive) : null,
      clouds: body.visual?.clouds ? canvasTexture(paintClouds(body, W, H)) : null,
      cityLights: body.visual?.cityLights
        ? canvasTexture(paintCityLights(body, W / 2, H / 2))
        : null,
      rings: body.rings ? canvasTexture(paintRings(body)) : null,
    };
    this.paintMs += performance.now() - t0;
    this.painted++;
    this.cache.set(id, entry);
    return entry;
  }

  has(body, level) {
    return this.cache.has(`${body.id}:${Math.min(level, this.levels.length - 1)}`);
  }

  /** Queue an upgrade; processed in idle time so the frame rate stays smooth. */
  request(body, level) {
    if (this.has(body, level)) return;
    if (this.pending.some((p) => p.id === body.id && p.level === level)) return;
    this.pending.push({ id: body.id, body, level });
    this._schedule();
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    const run = (deadline) => {
      this._scheduled = false;
      let budget = 8;
      while (this.pending.length && budget > 0) {
        const t0 = performance.now();
        const job = this.pending.shift();
        this.build(job.body, job.level);
        budget -= performance.now() - t0;
      }
      if (this.pending.length) this._schedule();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 900 });
    } else {
      setTimeout(() => run({ timeRemaining: () => 8 }), 40);
    }
  }

  /** Upgrade a body to the level its on-screen size justifies. */
  levelFor(apparentPixels) {
    if (apparentPixels > 900) return 3;
    if (apparentPixels > 240) return 2;
    if (apparentPixels > 70) return 1;
    return 0;
  }

  stats() {
    return { cached: this.cache.size, painted: this.painted, ms: Math.round(this.paintMs) };
  }
}

function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
