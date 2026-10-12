import * as THREE from 'three';
import { clamp, lerp, damp } from '../util/math.js';
import { noise3, mulberry32 } from '../util/noise.js';

/**
 * Visual effects used by the event system.
 *
 * Each factory returns { object, update(dt, ctx), dispose(), done }. They are
 * plain Object3Ds rather than particle libraries on purpose: a handful of
 * custom shaders costs nothing to ship and keeps the whole sim dependency-free
 * beyond three.js.
 *
 * The floating origin is respected everywhere: an effect's own transform is
 * relative to whatever anchor it is parented to, and anchors are updated by
 * the systems that own them.
 */

// ------------------------------------------------------------------- flash ---

/** A bright, brief burst of light: impacts, flares, distant supernovae. */
export function createFlash({ color = 0xffffff, size = 6, duration = 1.2 } = {}) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: new THREE.Color(color),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  );
  sprite.scale.setScalar(size);
  let t = 0;
  return {
    object: sprite,
    update(dt) {
      t += dt;
      const k = clamp(1 - t / duration, 0, 1);
      // Sharp attack, long tail — how a real flash photographs.
      sprite.material.opacity = Math.pow(k, 2.2);
      sprite.scale.setScalar(size * (0.6 + (1 - k) * 1.8));
    },
    get done() {
      return t >= duration;
    },
    dispose() {
      sprite.material.dispose();
    },
  };
}

// --------------------------------------------------------------- shockwave ---

/** An expanding, fading ring — impact ejecta or an atmospheric blast wave. */
export function createShockwave({ color = 0xffffff, maxRadius = 10, duration = 2.4, tilt = 0 } = {}) {
  const geo = new THREE.RingGeometry(0.86, 1.0, 128);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2 + tilt;
  let t = 0;
  return {
    object: mesh,
    update(dt) {
      t += dt;
      const k = t / duration;
      const r = maxRadius * Math.pow(k, 0.55);
      mesh.scale.setScalar(Math.max(r, 1e-4));
      mat.opacity = Math.pow(clamp(1 - k, 0, 1), 1.7) * 0.9;
    },
    get done() {
      return t >= duration;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ debris ---

/**
 * A ballistic debris/ejecta burst. Particles are simulated on the GPU: each
 * one gets a velocity at spawn and a constant acceleration, and the vertex
 * shader integrates it. Thousands of chunks for one draw call, with no CPU
 * work per frame.
 */
export function createDebrisBurst({
  count = 900,
  speed = 1,
  spread = 1,
  color = 0xffb070,
  gravity = 0.0,
  duration = 6,
  seed = 1234,
} = {}) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const rng = mulberry32(seed);
  const base = new THREE.Color(color);

  for (let i = 0; i < count; i++) {
    // Uniform direction on a sphere, biased outward along a cone by `spread`.
    const u = rng() * 2 - 1;
    const th = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dx = s * Math.cos(th);
    const dy = u;
    const dz = s * Math.sin(th);
    const v = (0.35 + Math.pow(rng(), 2) * 1.4) * speed;
    velocities[i * 3] = dx * v;
    velocities[i * 3 + 1] = dy * v * spread;
    velocities[i * 3 + 2] = dz * v;
    sizes[i] = 0.5 + Math.pow(rng(), 3) * 3.2;
    const shade = 0.65 + rng() * 0.7;
    colors[i * 3] = base.r * shade;
    colors[i * 3 + 1] = base.g * shade * (0.85 + rng() * 0.3);
    colors[i * 3 + 2] = base.b * shade;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aVel', new THREE.BufferAttribute(velocities, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGravity: { value: gravity },
      uDuration: { value: duration },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aVel;
      attribute float aSize;
      uniform float uTime;
      uniform float uGravity;
      uniform float uDuration;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vLife;
      void main() {
        // Simple ballistic integration in the shader.
        vec3 p = position + aVel * uTime + vec3(0.0, -0.5 * uGravity * uTime * uTime, 0.0);
        vLife = clamp(1.0 - uTime / uDuration, 0.0, 1.0);
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uPixelRatio * (60.0 / max(-mv.z, 0.001)), 1.0, 12.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vLife;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d) * 4.0;
        if (r > 1.0) discard;
        float a = (1.0 - r) * pow(vLife, 1.4);
        gl_FragColor = vec4(vColor * (0.7 + vLife), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let t = 0;
  return {
    object: points,
    update(dt) {
      t += dt;
      mat.uniforms.uTime.value = t;
    },
    get done() {
      return t >= duration;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------------ aurora ---

/**
 * An aurora: a cylindrical curtain of light around a planet's magnetic pole.
 *
 * Real aurorae are charged particles following field lines, so they form rings
 * at fixed magnetic latitude from which the light hangs vertically. A shader
 * driven by 3-D noise in (angle, height) gives the moving curtains and the
 * characteristic green-to-red gradient.
 */
export function createAurora({ radius = 1.6, height = 1.1, color = 0x5cffb0, intensity = 1 } = {}) {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.14, height, 128, 12, true);
  geo.translate(0, height * 0.5, 0);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vH;
      void main() {
        vUv = uv;
        vH = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vH;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        float ang = vUv.x * 42.0;
        // Curtains drift along the ring over time.
        float n = vnoise(vec2(ang, vUv.y * 3.0 - uTime * 0.4));
        n += vnoise(vec2(ang * 2.7, vUv.y * 6.0 - uTime * 0.7)) * 0.5;
        n /= 1.5;
        // Vertical striations and an upward fade.
        float stripe = 0.65 + 0.35 * sin(ang * 1.9 + n * 6.0);
        float fade = pow(1.0 - vH, 1.5) * smoothstep(0.0, 0.12, vH);
        float a = n * stripe * fade * uIntensity;
        if (a < 0.004) discard;
        // Green low, red high: the real emission ratios of atomic oxygen.
        vec3 col = mix(uColor, vec3(1.0, 0.28, 0.45), pow(vH, 2.2));
        gl_FragColor = vec4(col, a * 0.85);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  let t = 0;
  return {
    object: mesh,
    update(dt, ctx) {
      t += dt;
      mat.uniforms.uTime.value = t;
      if (ctx?.intensity !== undefined) {
        mat.uniforms.uIntensity.value = damp(mat.uniforms.uIntensity.value, ctx.intensity, 1.6, dt);
      }
    },
    set radius(r) {
      mesh.scale.set(r, r, r);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// --------------------------------------------------------------------- CME ---

/**
 * Coronal mass ejection: a billion tonnes of plasma thrown off the Sun.
 *
 * Modelled as a shell of particles expanding along a cone, plus a shock front
 * that keeps accelerating outward. Purely visual — no simulation cost.
 */
export function createCME({ direction, count = 2600, speed = 22, duration = 14, seed = 99 } = {}) {
  const geo = new THREE.BufferGeometry();
  const dirs = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const rng = mulberry32(seed);

  const axis = direction ? direction.clone().normalize() : new THREE.Vector3(1, 0, 0);
  const orthoA = new THREE.Vector3(0, 1, 0).cross(axis);
  if (orthoA.lengthSq() < 1e-4) orthoA.set(1, 0, 0);
  orthoA.normalize();
  const orthoB = new THREE.Vector3().crossVectors(axis, orthoA).normalize();

  for (let i = 0; i < count; i++) {
    // Cone half-angle ~28 degrees, densest along the axis.
    const spread = Math.pow(rng(), 0.7) * 0.5;
    const th = rng() * Math.PI * 2;
    const off = new THREE.Vector3()
      .addScaledVector(orthoA, Math.cos(th) * spread)
      .addScaledVector(orthoB, Math.sin(th) * spread);
    const d = axis.clone().add(off).normalize();
    dirs[i * 3] = d.x;
    dirs[i * 3 + 1] = d.y;
    dirs[i * 3 + 2] = d.z;
    speeds[i] = speed * (0.55 + rng() * 0.85);
    sizes[i] = 1.5 + rng() * 5;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aDir;
      attribute float aSpeed;
      attribute float aSize;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vLife;
      void main() {
        // Ease-out expansion: fast at first, coasting afterwards.
        float d = aSpeed * uTime * (1.0 - 0.35 * clamp(uTime / 14.0, 0.0, 1.0));
        vec3 p = aDir * d;
        vLife = clamp(1.0 - uTime / 14.0, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uPixelRatio * (18.0 / max(-mv.z, 1.0)), 1.0, 9.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying float vLife;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d) * 4.0;
        if (r > 1.0) discard;
        float a = (1.0 - r) * vLife * uFade * 0.55;
        gl_FragColor = vec4(vec3(1.0, 0.68, 0.34) * (0.8 + vLife), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let t = 0;
  return {
    object: points,
    update(dt) {
      t += dt;
      mat.uniforms.uTime.value = t;
    },
    get done() {
      return t >= duration;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------ meteor streaks --

/**
 * Meteors, drawn as short streaks that always face the camera.
 *
 * These live in world space near the viewer rather than as a full-screen
 * overlay, so they parallax and read as objects in the sky.
 */
export function createMeteorShower({ count = 220, duration = 9, color = 0xffd9a0, seed = 4242 } = {}) {
  const geo = new THREE.BufferGeometry();
  const rng = mulberry32(seed);
  const origin = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3);
  const delay = new Float32Array(count);
  const len = new Float32Array(count);

  const radiant = new THREE.Vector3(rng() - 0.5, rng() * 0.5 + 0.2, rng() - 0.5).normalize();
  for (let i = 0; i < count; i++) {
    const th = rng() * Math.PI * 2;
    const ph = Math.acos(rng() * 2 - 1);
    const r = 60 + rng() * 160;
    origin[i * 3] = r * Math.sin(ph) * Math.cos(th);
    origin[i * 3 + 1] = r * Math.cos(ph);
    origin[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    const jitter = 0.35;
    dir[i * 3] = radiant.x + (rng() - 0.5) * jitter;
    dir[i * 3 + 1] = radiant.y + (rng() - 0.5) * jitter;
    dir[i * 3 + 2] = radiant.z + (rng() - 0.5) * jitter;
    delay[i] = rng() * duration * 0.85;
    len[i] = 8 + rng() * 34;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(origin, 3));
  geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  geo.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
  geo.setAttribute('aLen', new THREE.BufferAttribute(len, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aDir;
      attribute float aDelay;
      attribute float aLen;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vLife;
      void main() {
        float age = uTime - aDelay;
        float travel = max(age, 0.0) * 28.0;
        float life = clamp(1.0 - max(age, 0.0) / 1.6, 0.0, 1.0) * step(0.0, age);
        vec3 p = position + normalize(aDir) * travel;
        vLife = life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aLen * (1.0 - life) * uPixelRatio * (22.0 / max(-mv.z, 1.0)), 0.0, 26.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vLife;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d) * 4.0;
        if (r > 1.0) discard;
        float a = (1.0 - r) * vLife;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let t = 0;
  return {
    object: points,
    update(dt) {
      t += dt;
      mat.uniforms.uTime.value = t;
    },
    get done() {
      return t >= duration;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

// ------------------------------------------------------------ impact scar ----

/** A persistent darkening of a planet's surface where something hit it. */
export function createImpactScar({ color = 0x000000, opacity = 0.5, size = 0.35 } = {}) {
  const geo = new THREE.SphereGeometry(1.002, 48, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Vector3(0, 0, 1) },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uSize: { value: size },
      uTarget: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vNw;
      void main() {
        vN = normalize(normal);
        vNw = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCenter;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uSize;
      varying vec3 vN;
      varying vec3 vNw;
      void main() {
        float d = length(normalize(vN) - normalize(uCenter));
        // Ejecta blanket: bright ring inside a darkened crater.
        float core = smoothstep(uSize, uSize * 0.35, d);
        float ring = smoothstep(uSize * 1.5, uSize * 0.95, d) - core;
        float a = (core * 0.85 + ring * 0.35) * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  let t = 0;
  let target = opacity;
  return {
    object: mesh,
    set center(v) {
      mat.uniforms.uCenter.value.copy(v);
    },
    set strength(v) {
      target = v;
    },
    fadeIn() {
      t = 0;
    },
    update(dt) {
      t += dt;
      mat.uniforms.uOpacity.value = damp(mat.uniforms.uOpacity.value, target, 1.4, dt);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
