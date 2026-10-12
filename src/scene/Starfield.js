import * as THREE from 'three';

/**
 * The sky: a sphere of stars with a Milky Way band.
 *
 * The band sits in the real galactic plane (inclined 60.2 degrees to the
 * ecliptic), so the view out of the window subtly matches which direction you
 * happen to be facing in the solar system.
 */
const GALACTIC_TILT = 60.2 * (Math.PI / 180);

export function createStarfield(count = 14_000) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;

  const cosT = Math.cos(GALACTIC_TILT);
  const sinT = Math.sin(GALACTIC_TILT);

  for (let i = 0; i < count; i++) {
    const inBand = i % 5 < 3;
    let x, y, z;

    if (inBand) {
      // Concentrate toward the galactic plane, with a bulge toward the centre.
      const l = rnd() * Math.PI * 2;
      const b = gauss() * 0.22;
      const r = 1;
      const cb = Math.cos(b);
      x = Math.cos(l) * cb * r;
      y = Math.sin(b) * r;
      z = Math.sin(l) * cb * r;
      // Rotate the band into the galactic plane relative to the ecliptic.
      const y2 = y * cosT - z * sinT;
      const z2 = y * sinT + z * cosT;
      y = y2;
      z = z2;
    } else {
      // Uniform on the sphere.
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      x = s * Math.cos(t);
      y = u;
      z = s * Math.sin(t);
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Rough stellar colours: most stars are cool and dim, a few are hot blue.
    const t = Math.pow(rnd(), 2.2);
    const warm = Math.pow(rnd(), 3);
    const c = new THREE.Color().setHSL(
      t < 0.75 ? 0.08 + t * 0.03 : 0.58 - (t - 0.75) * 0.2,
      0.25 + warm * 0.55,
      0.72 + (1 - t) * 0.2
    );
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    sizes[i] = 0.7 + Math.pow(rnd(), 6) * 4.5;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        // Round, softly-falling-off point sprite.
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d) * 4.0;
        if (r > 1.0) discard;
        float a = pow(1.0 - r, 1.6);
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    vertexColors: true,
  });

  const points = new THREE.Points(geo, material);
  points.name = 'starfield';
  points.frustumCulled = false;
  // Parented to the camera, so the sky never parallaxes or clips.
  points.scale.setScalar(1e6);
  points.renderOrder = -1000;
  return points;
}
