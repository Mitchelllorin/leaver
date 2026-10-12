import * as THREE from 'three';
import { DIST_COEF, DIST_EXP, KM_PER_UNIT_TRUE } from '../core/ScaleModel.js';

/**
 * Asteroid and Kuiper belts as GPU-animated point clouds.
 *
 * Tens of thousands of particles are far too many to update on the CPU each
 * frame, so each one carries its own orbit (radius, starting angle, inclination)
 * and the vertex shader advances the angle using the real Kepler relation
 * T proportional to a^1.5. Inner particles visibly lap the outer ones, exactly
 * as they should, for the cost of one uniform update.
 *
 * The shader also applies the same radial distance compression as ScaleModel,
 * so the belts sit correctly in both explore and true scale.
 */
export function createBelt(belt, scale) {
  const { count, innerKm, outerKm, thicknessKm, inclinationDeg } = belt;
  const positions = new Float32Array(count * 3);
  const colorAttr = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const angles = new Float32Array(count);
  const inclinations = new Float32Array(count);
  const sizes = new Float32Array(count);

  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const base = new THREE.Color(belt.color ?? '#9a8f80');
  const maxInc = inclinationDeg * (Math.PI / 180);

  for (let i = 0; i < count; i++) {
    // Power-law density: belts are denser toward their inner edge.
    const t = Math.pow(rnd(), 0.65);
    const r = innerKm + (outerKm - innerKm) * t;
    radii[i] = r;
    angles[i] = rnd() * Math.PI * 2;
    // Vertical scatter falls off outward, giving the flat-disk shape.
    const inc = (rnd() + rnd() + rnd() - 1.5) * maxInc * 0.6;
    inclinations[i] = inc;
    sizes[i] = 1.0 + Math.pow(rnd(), 3) * 3.0;

    // Normalise to a unit-ish radius; the shader scales it in render units.
    positions[i * 3] = 0;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;

    const shade = 0.6 + rnd() * 0.6;
    colorAttr[i * 3] = base.r * shade;
    colorAttr[i * 3 + 1] = base.g * shade;
    colorAttr[i * 3 + 2] = base.b * shade;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1));
  geo.setAttribute('aIncl', new THREE.BufferAttribute(inclinations, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uDays: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uDistCoef: { value: DIST_COEF },
      uDistExp: { value: DIST_EXP },
      uKmPerUnitTrue: { value: KM_PER_UNIT_TRUE },
      uBlend: { value: scale.blend },
      uThickness: { value: thicknessKm },
      uOpacity: { value: 0.85 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: /* glsl */ `
      attribute float aRadius;
      attribute float aAngle;
      attribute float aIncl;
      attribute float aSize;
      uniform float uDays;
      uniform float uPixelRatio;
      uniform float uDistCoef;
      uniform float uDistExp;
      uniform float uKmPerUnitTrue;
      uniform float uBlend;
      uniform float uThickness;
      varying vec3 vColor;
      varying float vShade;
      uniform vec3 uSunDir;

      void main() {
        // Kepler: period^2 is proportional to radius^3, so angular rate falls
        // off as r^-1.5. Reference radius keeps the constants tame.
        float rate = pow(aRadius / 2.8e8, -1.5) * 6.28318;
        float a = aAngle + uDays * rate;

        // Orbital plane, inclined about the x axis.
        float ci = cos(aIncl);
        float si = sin(aIncl);
        vec3 dir = vec3(cos(a), sin(a) * si, sin(a) * ci);

        // Vertical scatter: hash on the angle keeps each particle in its lane.
        float k = fract(sin(aAngle * 91.7) * 43758.5453);
        float y = (k - 0.5) * uThickness;
        dir /= max(length(dir), 1e-4);
        vec3 pos = dir * aRadius;
        pos.y += y;

        // Same radial compression as the CPU-side scale model.
        float r = length(pos);
        float explore = uDistCoef * pow(max(r, 1.0), uDistExp);
        float truth = r / uKmPerUnitTrue;
        float rr = explore + (truth - explore) * uBlend;
        vec3 scaled = pos * (rr / max(r, 1e-6));

        vec4 mv = modelViewMatrix * vec4(scaled, 1.0);
        gl_Position = projectionMatrix * mv;
        // Perspective sizing, clamped so distant dust stays a faint speck.
        gl_PointSize = clamp(aSize * uPixelRatio * (2.2e5 / max(-mv.z, 1.0)), 1.0, 6.0);

        vColor = color;
        float lit = abs(dot(normalize(dir), normalize(uSunDir)));
        vShade = 0.35 + 0.65 * lit;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vShade;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d) * 4.0;
        if (r > 1.0) discard;
        float a = (1.0 - r) * uOpacity * vShade;
        gl_FragColor = vec4(vColor * (0.6 + vShade * 0.8), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  });

  const points = new THREE.Points(geo, material);
  points.name = `belt:${belt.id}`;
  points.frustumCulled = false;
  return points;
}
