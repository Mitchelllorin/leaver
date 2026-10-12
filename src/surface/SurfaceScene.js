import * as THREE from 'three';
import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';
import { clamp, damp, DEG } from '../util/math.js';
import { noise3, mulberry32, hashString } from '../util/noise.js';

/**
 * Surface mode — the layer that makes "land anywhere" real.
 *
 * Orbital space and a planetary surface need completely different scales: one
 * spans 10^10 metres, the other wants centimetres of ground detail. So landing
 * swaps to an entirely separate local scene. The body you landed on becomes a
 * single sun-lit terrain patch, and the sky is coloured from that world's own
 * atmosphere record, so standing on Titan really is orange.
 *
 * Two kinds of descent:
 *   solid — you walk, jump and jetpack on procedural terrain
 *   gas   — you fall through an atmosphere with a depth gauge, until the
 *           pressure crushes the hull (gas giants have no surface to land on)
 */
export class SurfaceScene {
  constructor(engine, scale, orbital, solar) {
    this.name = 'surface';
    this.engine = engine;
    this.scale = scale;
    this.orbital = orbital;
    this.solar = solar;

    this.active = false;
    this.def = null;
    this.kind = 'solid';
    this.body = { position: new THREE.Vector3() };
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.gravity = 9.807;
    this.depth = 0; // gas giants: km below the cloud tops
    this.crushed = false;

    this.scene = new THREE.Scene();
    this.camera = engine.camera; // reused so shaders and projection stay valid
    this._savedScene = null;
    this._savedFog = null;
  }

  // ------------------------------------------------------------------ enter --

  enter(def, player) {
    this.def = def;
    const terrain = def.terrain ?? {};
    this.kind = terrain.gasGiant ? 'gas' : terrain.star ? 'gas' : 'solid';

    // Where on the globe are we landing? Offset from the sub-solar point so
    // the light comes in at an angle and the terrain reads as 3D.
    const t = player.position;
    const c = this.solar.positionOf(def.id);
    _dir.set(t.x - c.x, t.y - c.y, t.z - c.z).normalize();
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 1, 0);
    this.lat = Math.asin(clamp(_dir.y, -1, 1));
    this.lon = Math.atan2(_dir.z, _dir.x);

    this.scene = new THREE.Scene();
    this.build();

    // Gravity: real value in m/s^2, rescaled so low-gravity moons are floaty
    // but not unusable. 1 g feels like 1 g; Phobos still feels like Phobos.
    const g = def.gravity ?? 9.807;
    this.gravity = clamp(g, 0.05, 26);
    this.def_gravity = g;

    this.body.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.depth = 0;
    this.crushed = false;
    this.onGround = this.kind === 'solid';

    // Reset the shared player state for a local frame.
    player.mode = 'surface';
    player.velocity.set(0, 0, 0);
    this.localYaw = player.yaw;
    this.localPitch = player.pitch;

    this.active = true;
    this._savedScene = this.engine.scene;
    this.engine.scene = this.scene;
    // The camera sits at the origin in space mode; on the surface it moves.
    this.engine.camera.position.set(0, 0, 0);

    bus.emit('surface:entered', {
      id: def.id,
      name: def.name,
      kind: this.kind,
      gravity: g,
    });
  }

  build() {
    const def = this.def;
    const terrain = def.terrain ?? {};
    const seed = hashString(def.id);

    this.scene.background = new THREE.Color(terrain.sky?.[1] ?? '#000010');
    if (terrain.sky) {
      this.scene.fog = new THREE.Fog(
        new THREE.Color(terrain.sky[0]),
        SURFACE_SIZE * 0.18,
        SURFACE_SIZE * 0.62
      );
    }

    // -- sky dome: a real vertical gradient, brighter toward the horizon -----
    this.sky = makeSkyDome(terrain.sky ?? ['#000000', '#000000']);
    // Drawn before everything else and without writing depth, so terrain and
    // rocks always resolve in front of it regardless of depth precision.
    this.sky.renderOrder = -900;
    this.scene.add(this.sky);

    // -- lighting -----------------------------------------------------------
    const sunAngle = 0.5;
    this.sun = new THREE.DirectionalLight(0xfff6ea, 3.1);
    this.sun.position.set(Math.cos(sunAngle) * 100, 60, Math.sin(sunAngle) * 100);
    this.sun.castShadow = false;
    this.scene.add(this.sun);

    const skyLight = new THREE.Color(terrain.sky?.[0] ?? '#ffffff');
    this.ambient = new THREE.AmbientLight(0x223044, 0.5);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(skyLight, new THREE.Color(terrain.rock ?? '#444'), 0.35);
    this.scene.add(this.hemi);

    // The parent planet hanging in the sky is the single best "you are
    // somewhere else" cue: Phobos hangs over Mars, Charon over Pluto.
    if (terrain.parentSky) {
      const parent = this.solar.bodies.get(terrain.parentSky);
      if (parent) {
        this.parentDisc = makeSkyDisc(parent.def.radiusKm, parent.def.visual?.palette?.[0] ?? '#aaaaaa');
        this.parentDisc.position.set(-0.35, 0.42, -0.83).normalize().multiplyScalar(900);
        this.parentDisc.scale.setScalar(90);
        this.parentDisc.renderOrder = -890;
        this.scene.add(this.parentDisc);
      }
    }

    // The local star, at a size that matches its real angular diameter: from
    // Mars the Sun genuinely looks about two thirds the size it does from Earth.
    const sunDef = this.solar.bodies.get('sun')?.def;
    this.sunDisc = makeSkyDisc(
      (sunDef?.radiusKm ?? 696340) / 60,
      sunDef?.visual?.palette?.[0] ?? '#fff6d5'
    );
    const trueAngular = (sunDef?.radiusKm ?? 696340) / AU_KM_LOCAL;
    this.sunDisc.position.set(this.sun.position.x, this.sun.position.y, this.sun.position.z).normalize().multiplyScalar(1200);
    this.sunDisc.scale.setScalar(Math.max(6, trueAngular * 15));
    this.sunDisc.renderOrder = -889;
    this.scene.add(this.sunDisc);

    if (this.kind === 'solid') this.buildTerrain(terrain, seed);
    else this.buildCloudDeck(terrain, seed);
  }

  buildTerrain(terrain, seed) {
    const rng = mulberry32(seed);
    const size = SURFACE_SIZE;
    const seg = settings.get('quality') === 'low' ? 96 : 160;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rock = new THREE.Color(terrain.rock ?? '#666');
    const dust = new THREE.Color(terrain.dust ?? '#999');
    const vegetation = terrain.vegetation ? new THREE.Color('#3d6b2a') : null;
    const roughness = terrain.metal !== undefined ? 0.95 : 0.95;

    this.heights = new Float32Array(pos.count);
    const seedOff = (seed % 1000) * 0.137;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Terrain elevation: large ridges plus fine detail, all in metres.
      const nx = x / size * 6 + seedOff;
      const nz = z / size * 6 + seedOff;
      let h = 0;
      let amp = 1;
      let freq = 1;
      for (let o = 0; o < 5; o++) {
        h += amp * noise3(nx * freq, nz * freq, seedOff * 4);
        amp *= 0.5;
        freq *= 2.07;
      }
      h *= terrain.relief ?? 60;
      // Flatten a landing pad so you do not spawn inside a mountain.
      const r = Math.hypot(x, z);
      const pad = clamp(r / 34, 0, 1);
      h *= pad * pad;
      h += noise3(nx * 22, nz * 22, 1.7) * 1.2 * pad;

      this.heights[i] = h;
      pos.setY(i, h);

      // Vertex colour: blend rock/dust by slope, add vegetation at low altitude.
      const slope = Math.abs(noise3(nx * 3.1, nz * 3.1, 9.2));
      let c = rock.clone().lerp(dust, clamp(0.5 + h / 90 + (rng() - 0.5) * 0.12, 0, 1));
      if (vegetation) {
        const low = clamp(1 - h / 45, 0, 1);
        c.lerp(vegetation, low * 0.75);
      } else {
        c.multiplyScalar(clamp(0.82 + slope * 0.4, 0.7, 1.25));
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness,
      metalness: terrain.metal ?? 0.05,
      flatShading: false,
    });
    this.ground = new THREE.Mesh(geo, this.material);
    this.ground.receiveShadow = false;
    this.scene.add(this.ground);

    // -- scattered rocks, sized to the local gravity -------------------------
    const rockCount = settings.get('quality') === 'low' ? 120 : 320;
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(terrain.rock ?? '#666'),
      roughness: 0.95,
      metalness: 0.05,
    });
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < rockCount; i++) {
      const a = rng() * Math.PI * 2;
      const d = 18 + Math.pow(rng(), 0.6) * size * 0.45;
      p.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      p.y = this.sampleHeight(p.x, p.z) - 0.2;
      const sc = 0.4 + Math.pow(rng(), 3) * 4.5;
      s.set(sc, sc * (0.6 + rng() * 0.7), sc);
      q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      m.compose(p, q, s);
      this.rocks.setMatrixAt(i, m);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
    this.scene.add(this.rocks);

    // -- a lander, so the scene has a human scale reference ------------------
    this.lander = makeLander(terrain);
    this.lander.position.set(6, this.sampleHeight(6, 4) + 0.4, 4);
    this.scene.add(this.lander);

    if (terrain.geysers) this.addGeysers(rng);
    if (terrain.lava) this.addLava(rng);
    if (terrain.meteorRate) this.meteorRate = terrain.meteorRate;
  }

  buildCloudDeck(terrain, seed) {
    const rng = mulberry32(seed);
    const size = SURFACE_SIZE;
    const geo = new THREE.PlaneGeometry(size, size, 120, 120);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color(terrain.dust ?? '#dddddd');
    const c2 = new THREE.Color(terrain.rock ?? '#aaaaaa');
    this.heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / size * 5;
      const z = pos.getZ(i) / size * 5;
      let h = 0;
      let amp = 1;
      let freq = 1;
      for (let o = 0; o < 5; o++) {
        h += amp * noise3(x * freq, z * freq, 3.3);
        amp *= 0.55;
        freq *= 2.1;
      }
      h *= 26;
      this.heights[i] = h;
      pos.setY(i, h);
      const t = clamp(0.5 + h / 52, 0, 1);
      const c = c1.clone().lerp(c2, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    this.ground = new THREE.Mesh(geo, this.material);
    this.scene.add(this.ground);

    // Heavy haze: you cannot see a horizon on a gas giant.
    if (!this.scene.fog) {
      this.scene.fog = new THREE.Fog(new THREE.Color(terrain.sky?.[0] ?? '#cccccc'), 40, 400);
    }
    this.crushDepth = terrain.crushDepth ?? 300;
    this.lander = null;
  }

  addGeysers(rng) {
    const geo = new THREE.ConeGeometry(3.5, 90, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xdff2ff,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.geysers = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Mesh(geo, mat);
      const a = rng() * Math.PI * 2;
      const d = 60 + rng() * 200;
      g.position.set(Math.cos(a) * d, 30, Math.sin(a) * d);
      this.geysers.add(g);
    }
    this.scene.add(this.geysers);
  }

  addLava(rng) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a12, toneMapped: false });
    this.lava = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.CircleGeometry(2 + rng() * 9, 16);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      const a = rng() * Math.PI * 2;
      const d = 30 + rng() * 300;
      m.position.set(Math.cos(a) * d, this.sampleHeight(Math.cos(a) * d, Math.sin(a) * d) + 0.4, Math.sin(a) * d);
      this.lava.add(m);
    }
    this.scene.add(this.lava);
  }

  // ------------------------------------------------------------------ frame --

  /** Bilinear height sample, so rocks and the lander sit on the terrain. */
  sampleHeight(x, z) {
    const size = SURFACE_SIZE;
    const seg = Math.sqrt(this.heights.length) - 1;
    const step = size / seg;
    const gx = clamp((x + size / 2) / step, 0, seg);
    const gz = clamp((z + size / 2) / step, 0, seg);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(x0 + 1, seg);
    const z1 = Math.min(z0 + 1, seg);
    const fx = gx - x0;
    const fz = gz - z0;
    const h00 = this.heights[z0 * (seg + 1) + x0] ?? 0;
    const h10 = this.heights[z0 * (seg + 1) + x1] ?? 0;
    const h01 = this.heights[z1 * (seg + 1) + x0] ?? 0;
    const h11 = this.heights[z1 * (seg + 1) + x1] ?? 0;
    const a = h00 + (h10 - h00) * fx;
    const b = h01 + (h11 - h01) * fx;
    return a + (b - a) * fz;
  }

  update(dt, ctx) {
    if (!this.active) return;
    const player = this._player;
    const p = this.camera.position;

    // Look: reuse the player's accumulated mouse deltas.
    this.yaw -= player.mouse.dx;
    this.pitch = clamp(this.pitch - player.mouse.dy * (settings.get('invertY') ? -1 : 1), -1.5533, 1.5533);
    player.mouse.dx = 0;
    player.mouse.dy = 0;
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);

    const k = player.keys;
    const eyeHeight = 1.75;

    if (this.kind === 'gas') {
      // Descending: the hull falls, the pressure climbs, the view goes opaque.
      const sink = (k.has('KeyW') ? 1 : 0) * 6 + 0.9;
      const rise = k.has('KeyS') ? 5 : 0;
      this.depth = Math.max(0, this.depth + (sink - rise) * dt * 8);
      const haze = clamp(this.depth / this.crushDepth, 0, 1.3);
      this.scene.fog.near = lerpNum(30, 0.5, haze);
      this.scene.fog.far = lerpNum(900, 8, haze);
      this.ambient.intensity = 0.5 + haze * 1.2;
      p.y = -this.depth * 3;
      if (haze >= 1 && !this.crushed) {
        this.crushed = true;
        bus.emit('surface:crushed', {
          name: this.def.name,
          depth: Math.round(this.depth),
          pressure: this.def.atmosphere?.pressure ?? 'unmeasured',
        });
      }
      bus.emit('surface:depth', { depth: this.depth, crushDepth: this.crushDepth });
      return;
    }

    // -- solid ground: walk, jump, jetpack ------------------------------------
    const speed = 9.5 * (k.has('ShiftLeft') ? 2.2 : 1);
    _move.set(0, 0, 0);
    if (k.has('KeyW')) _move.z -= 1;
    if (k.has('KeyS')) _move.z += 1;
    if (k.has('KeyA')) _move.x -= 1;
    if (k.has('KeyD')) _move.x += 1;
    _move.applyAxisAngle(UP, this.yaw);

    const speedScale = clamp(this.gravity / 9.807, 0.35, 1.6);
    this.velocity.x = _move.x * speed * speedScale;
    this.velocity.z = _move.z * speed * speedScale;
    this.velocity.y -= this.gravity * dt;

    if (k.has('Space') && this.onGround) {
      // Jump height scales with local gravity, so a Moon hop is enormous.
      this.velocity.y = Math.sqrt(2 * this.gravity * (this.gravity < 3 ? 4.5 : 1.4));
      this.onGround = false;
    }
    // Jetpack: hold R to hover out of trouble.
    if (k.has('KeyR')) {
      this.velocity.y = Math.max(this.velocity.y, 6);
      this.onGround = false;
    }

    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    p.y += this.velocity.y * dt;

    const groundY = this.sampleHeight(p.x, p.z);
    const wanted = groundY + eyeHeight;
    if (p.y <= wanted) {
      p.y = wanted;
      if (this.velocity.y < -12) bus.emit('surface:impact', { speed: -this.velocity.y });
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Keep the walker inside the terrain patch; the edge is a soft wall.
    const limit = SURFACE_SIZE * 0.47;
    p.x = clamp(p.x, -limit, limit);
    p.z = clamp(p.z, -limit, limit);

    // Sky follows the walker so the horizon never moves.
    this.sky.position.set(p.x, groundY, p.z);
  }

  attachPlayer(player) {
    this._player = player;
  }

  // ------------------------------------------------------------------ exit --

  launch() {
    if (!this.active) return;
    this.active = false;
    if (this._savedScene) this.engine.scene = this._savedScene;

    // Put the player back into orbit, just above the surface.
    const id = this.def.id;
    const c = this.solar.positionOf(id);
    const body = this.solar.bodies.get(id);
    const r = (body?.radiusUnits ?? 1) * 2.4;
    _dir.set(
      Math.cos(this.lat) * Math.cos(this.lon),
      Math.sin(this.lat),
      Math.cos(this.lat) * Math.sin(this.lon)
    );
    const player = this._player;
    player.mode = 'flight';
    player.position.set(c.x + _dir.x * r, c.y + _dir.y * r, c.z + _dir.z * r);
    player.velocity.set(0, 0, 0);
    player.yaw = Math.atan2(-_dir.x, -_dir.z);
    player.pitch = 0;
    player.focusId = id;

    // Tear down the local scene.
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.scene.clear();
    this.engine.camera.fov = settings.get('fov');
    this.engine.camera.updateProjectionMatrix();

    bus.emit('surface:left', { id, name: this.def.name });
  }

  dispose() {
    if (this.active) this.launch();
  }
}

// ------------------------------------------------------------------ helpers --

const SURFACE_SIZE = 900; // metres across the local patch
const AU_KM_LOCAL = 149_597_870.7;
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _move = new THREE.Vector3();
const _euler = new THREE.Euler();
const lerpNum = (a, b, t) => a + (b - a) * t;

/** Vertical gradient sky. A flat colour never looks like a sky. */
function makeSkyDome(sky) {
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const top = new THREE.Color(sky[1] ?? '#000000');
  const bottom = new THREE.Color(sky[0] ?? '#000000');
  const colors = new Float32Array(geo.attributes.position.count * 3);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(pos.getY(i) / 1500 * 0.5 + 0.5, 0, 1);
    const c = bottom.clone().lerp(top, Math.pow(t, 0.55));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })
  );
}

/** A flat disc for the Sun or a parent planet in the local sky. */
function makeSkyDisc(radiusKm, color) {
  const geo = new THREE.CircleGeometry(1, 48);
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), fog: false, toneMapped: false })
  );
}

/** A small lander: gives the scene a scale reference and a way home. */
function makeLander(terrain) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0xdcdcdc,
    metalness: 0.85,
    roughness: 0.3,
  });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.9, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 1.8, 8), metal);
  body.position.y = 2.2;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  cap.position.y = 3.1;
  g.add(cap);
  const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(legGeo, metal);
    leg.position.set(Math.cos(a) * 1.5, 1.1, Math.sin(a) * 1.5);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = -Math.sin(a) * 0.35;
    g.add(leg);
  }
  const foil = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 2.6), gold);
  foil.position.y = 1.5;
  g.add(foil);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x53ff9d, toneMapped: false })
  );
  beacon.position.set(0, 4.4, 0);
  g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}
