import * as THREE from 'three';
import { settings } from '../core/Settings.js';

/**
 * A renderable world.
 *
 * Geometry is a unit sphere with radius 1; the actual size lives on
 * `mesh.scale`. That makes the explore <-> true scale transition free: the
 * blend animates a single number per body instead of rebuilding geometry.
 *
 * Extra shells (clouds, atmosphere, night lights, rings, corona, comet tail)
 * all live in the body's group so they inherit position and rotation together.
 */
export class CelestialBody {
  /**
   * @param {object} def record from data/bodies.js
   * @param {import('./textures.js').TextureManager} textures
   */
  constructor(def, textures) {
    this.def = def;
    this.id = def.id;
    this.textures = textures;
    this.group = new THREE.Group();
    this.group.name = `body:${def.id}`;
    this.radiusUnits = 1;
    this._spin = 0;

    const visual = def.visual ?? {};
    const isStar = visual.surface === 'star';
    const tex = textures.build(def, 0);

    const segs = def.radiusKm > 4000 ? [96, 48] : [48, 24];
    const geo = new THREE.SphereGeometry(1, segs[0], segs[1]);

    // -- surface ------------------------------------------------------------
    if (isStar) {
      // Stars ignore lighting: they ARE the light.
      this.material = new THREE.MeshBasicMaterial({
        map: tex.colorMap,
        toneMapped: false,
      });
    } else {
      this.material = new THREE.MeshStandardMaterial({
        map: tex.colorMap,
        bumpMap: tex.bumpMap,
        bumpScale: visual.surface === 'gas' ? 0.004 : 0.02,
        roughness: visual.roughness ?? 0.9,
        metalness: visual.metalness ?? 0.02,
      });
      if (tex.emissiveMap && visual.emissive) {
        this.material.emissiveMap = tex.emissiveMap;
        this.material.emissive = new THREE.Color(0xffffff);
        this.material.emissiveIntensity = visual.emissive;
      }
    }

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.userData.bodyId = def.id;
    this.mesh.userData.pickable = true;
    this.group.add(this.mesh);

    // -- night-side city lights --------------------------------------------
    if (tex.cityLights) {
      this.nightLights = new THREE.Mesh(
        new THREE.SphereGeometry(1, segs[0], segs[1]),
        makeNightLightMaterial(tex.cityLights)
      );
      this.nightLights.scale.setScalar(1.001);
      this.group.add(this.nightLights);
    }

    // -- cloud deck ---------------------------------------------------------
    if (tex.clouds) {
      this.cloudMaterial = new THREE.MeshStandardMaterial({
        map: tex.clouds,
        transparent: true,
        opacity: visual.clouds?.opacity ?? 0.4,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      });
      this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1, segs[0], segs[1]), this.cloudMaterial);
      this.clouds.scale.setScalar(1.008);
      this.group.add(this.clouds);
    }

    // -- atmosphere ---------------------------------------------------------
    if (def.atmosphere) {
      this.atmosphereMaterial = makeAtmosphereMaterial(def.atmosphere);
      this.atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(1, 64, 32),
        this.atmosphereMaterial
      );
      this.atmosphere.scale.setScalar(1.045);
      this.atmosphere.renderOrder = 2;
      this.group.add(this.atmosphere);
    }

    // -- rings --------------------------------------------------------------
    if (def.rings && tex.rings) {
      this.rings = new THREE.Mesh(
        makeRingGeometry(def.rings.inner, def.rings.outer),
        new THREE.MeshBasicMaterial({
          map: tex.rings,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          opacity: 1,
        })
      );
      // RingGeometry lies in the XY plane; tip it into the equatorial plane.
      this.rings.rotation.x = Math.PI / 2;
      this.rings.renderOrder = 1;
      // The pivot carries the axial tilt, so Uranus's rings stand on edge and
      // Saturn's sit at 26 degrees, with the ring plane matching the equator.
      this.ringsPivot = new THREE.Group();
      this.ringsPivot.rotation.z = ((def.axialTilt ?? 0) * Math.PI) / 180;
      this.ringsPivot.add(this.rings);
      this.group.add(this.ringsPivot);
    }

    // -- corona (stars) -----------------------------------------------------
    if (visual.corona) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeGlowTexture(visual.corona.color),
          color: new THREE.Color(visual.corona.color),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: visual.corona.opacity,
          toneMapped: false,
        })
      );
      sprite.scale.setScalar(visual.corona.scale);
      this.corona = sprite;
      this.group.add(sprite);
    }

    // -- comet tail ---------------------------------------------------------
    if (def.comet) {
      const { geometry, material } = makeCometTail(def.comet);
      this.tail = new THREE.Mesh(geometry, material);
      this.tail.visible = false;
      this.group.add(this.tail);
    }

    // Axial tilt and spin.
    //
    // Euler order 'ZYX' means the composed rotation is Rz(tilt) . Ry(spin):
    // the axis is tilted first and the spin then happens about that tilted
    // axis. With the default 'XYZ' order the tilt would instead be swept
    // around by the spin, and every planet's axis would visibly precess once
    // per rotation.
    const tilt = ((def.axialTilt ?? 0) * Math.PI) / 180;
    for (const obj of [this.mesh, this.clouds, this.nightLights]) {
      if (!obj) continue;
      obj.rotation.order = 'ZYX';
      obj.rotation.z = tilt;
    }
  }

  /** True radius in render units at the current scale blend. */
  setRadius(units) {
    this.radiusUnits = units;
    this.mesh.scale.setScalar(units);
    if (this.clouds) this.clouds.scale.setScalar(units * 1.008);
    if (this.atmosphere) this.atmosphere.scale.setScalar(units * 1.045);
    if (this.nightLights) this.nightLights.scale.setScalar(units * 1.001);
    if (this.rings) this.rings.scale.setScalar(units);
    if (this.corona) this.corona.scale.setScalar(units * (this.def.visual.corona.scale ?? 2.6));
    if (this.tail) {
      // Tail length is a fraction of the local scale so it reads at any zoom.
      this.tail.scale.set(units * 0.5, units * 0.5, 1);
    }
  }

  /** Spin the body about its axis. `days` = simulated days. */
  updateRotation(days) {
    if (!this.def.rotationHours) return;
    const turns = (days * 24) / this.def.rotationHours;
    this.mesh.rotation.y = (turns % 1) * Math.PI * 2;
    if (this.clouds) this.clouds.rotation.y = this.mesh.rotation.y * 1.06;
    if (this.nightLights) this.nightLights.rotation.y = this.mesh.rotation.y;
  }

  /** Blend between explore and true scale without rebuilding anything. */
  setScaleBlend(scale, def, parentRadiusUnits) {
    const r = scale.radius(def.radiusKm);
    this.setRadius(r);
  }

  /** Point the comet tail away from the Sun. */
  updateTail(sunDir, sunDistanceKm) {
    if (!this.tail) return;
    const influence = Math.max(0, 1 - sunDistanceKm / (3.0 * 149_597_870.7));
    this.tail.visible = influence > 0.01;
    if (!this.tail.visible) return;
    this.tail.lookAt(sunDir.x, sunDir.y, sunDir.z);
    this.tail.rotateY(Math.PI / 2);
    const stretch = 0.4 + influence * 6;
    this.tail.scale.set(this.radiusUnits * 0.6, this.radiusUnits * 0.6, this.radiusUnits * stretch);
    this.tail.material.uniforms.uIntensity.value = influence;
    this.tail.material.uniforms.uTime.value += 0.016;
  }

  /** Upgrade to a higher-resolution texture when the camera gets close. */
  applyTextureLevel(level) {
    const tex = this.textures.build(this.def, level);
    if (this.def.visual?.surface === 'star') {
      this.material.map = tex.colorMap;
    } else {
      this.material.map = tex.colorMap;
      this.material.bumpMap = tex.bumpMap;
    }
    if (this.material.emissiveMap && tex.emissiveMap) this.material.emissiveMap = tex.emissiveMap;
    this.material.needsUpdate = true;
    if (this.cloudMaterial && tex.clouds) {
      this.cloudMaterial.map = tex.clouds;
      this.cloudMaterial.needsUpdate = true;
    }
    if (this.nightLights && tex.cityLights) {
      this.nightLights.material.uniforms.uMap.value = tex.cityLights;
      this.nightLights.material.needsUpdate = true;
    }
    if (this.rings && tex.rings) {
      this.rings.material.map = tex.rings;
      this.rings.material.needsUpdate = true;
    }
    this.textureLevel = level;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
}

// ------------------------------------------------------------------ shaders ---

/**
 * Atmosphere: a slightly larger shell rendered from the inside, brightest at
 * the limb. Forward scattering warms the sunward edge, which is what makes a
 * terminator look like a terminator.
 */
function makeAtmosphereMaterial(cfg) {
  const color = new THREE.Color(cfg.color);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uIntensity: { value: settings.get('quality') === 'low' ? 0.55 : (cfg.rim ?? 0.6) },
      uPower: { value: 2.6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uSunDir;
      uniform float uIntensity;
      uniform float uPower;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        // Rim falloff: brightest where the surface turns away from the eye.
        float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewW))), uPower);
        // Day/night terminator, softened so the edge glows rather than snaps.
        float sun = clamp(dot(normalize(vNormalW), normalize(uSunDir)) * 1.6 + 0.35, 0.0, 1.0);
        float a = rim * uIntensity * sun;
        if (a <= 0.001) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/**
 * City lights, visible only on the night side.
 *
 * A separate additive shell rather than an emissiveMap, because an emissive map
 * in MeshStandardMaterial would glow on the day side too. The sun direction is
 * handed in each frame by SolarSystem.
 */
function makeNightLightMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uOpacity: { value: 0.9 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        vUv = uv;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalW;
      void main() {
        float night = smoothstep(0.05, -0.25, dot(normalize(vNormalW), normalize(uSunDir)));
        vec4 c = texture2D(uMap, vUv);
        gl_FragColor = vec4(c.rgb, c.a * night * uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Ring geometry with radial UVs, so the strip texture maps outwards. */
function makeRingGeometry(inner, outer) {
  const geo = new THREE.RingGeometry(inner, outer, 180, 6);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const span = outer - inner;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.x, v.y);
    uv.setXY(i, (r - inner) / span, 0.5);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Soft radial glow sprite, generated once and shared. */
const glowCache = new Map();
function makeGlowTexture(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.65)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowCache.set(color, tex);
  return tex;
}

/** A tapered, additive cone that fades out along its length. */
function makeCometTail(cfg) {
  const geo = new THREE.CylinderGeometry(0.02, 1.0, 1, 24, 1, true);
  geo.translate(0, 0.5, 0); // base at the nucleus, growing along +Y
  geo.rotateX(Math.PI / 2); // point down +Z, which lookAt orients

  const color = new THREE.Color(cfg.tailColor ?? '#9fd8ff');
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vAlong;
      void main() {
        vAlong = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      varying float vAlong;
      void main() {
        float fade = pow(1.0 - vAlong, 1.6);
        float shimmer = 0.85 + 0.15 * sin(vAlong * 22.0 - uTime * 2.0);
        float a = fade * shimmer * uIntensity * 0.5;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uColor * (1.2 + uIntensity), a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return { geometry: geo, material };
}
