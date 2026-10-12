import * as THREE from 'three';
import { ALL_BODIES, BELTS, bodyById } from '../data/bodies.js';
import { CelestialBody } from '../scene/Body.js';
import { createStarfield } from '../scene/Starfield.js';
import { createBelt } from '../scene/Belts.js';
import { OrbitLines } from '../scene/OrbitLines.js';
import { TextureManager } from '../scene/textures.js';
import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';

/**
 * SolarSystem is the world: it turns the dataset into renderable bodies,
 * keeps their transforms in sync with the orbital mechanics, drives the
 * floating origin, and manages progressive texture detail.
 *
 * Everything is a direct child of the engine's `world` group. That is
 * deliberate: the floating origin rebases each object's position against the
 * camera, and a flat hierarchy keeps that rebase exact.
 */
export class SolarSystem {
  constructor(scale, orbital) {
    this.name = 'solar-system';
    this.priority = 0;
    this.scale = scale;
    this.orbital = orbital;
    this.textures = new TextureManager();

    /** Runtime list of body definitions currently in the world. */
    this.list = [...ALL_BODIES];
    /** @type {Map<string, CelestialBody>} */
    this.bodies = new Map();
    /** Absolute render-space positions, in units. */
    this.renderPos = new Map();
    /** Scratch for the per-frame scale remap. */
    this._km = { x: 0, y: 0, z: 0 };

    this.debug = false;
  }

  /** Build every mesh. Called once, after the engine exists. */
  attach(engine) {
    this.engine = engine;
    const world = engine.world;

    // -- the bodies ---------------------------------------------------------
    for (const def of this.list) this.addBody(def);

    // -- light ---------------------------------------------------------------
    // Decay is disabled on purpose. With physically correct inverse-square
    // falloff Neptune would receive 0.1% of the sunlight Earth does and be
    // invisible; games and planetarium software both cheat here. The HUD says
    // so, so the cheat stays educational rather than misleading.
    this.sunLight = new THREE.PointLight(0xfff4e0, 2.4, 0, 0);
    this.sunLight.position.set(0, 0, 0);
    world.add(this.sunLight);

    this.ambient = new THREE.AmbientLight(0x2a3550, 0.34);
    engine.scene.add(this.ambient);

    // -- sky, belts, orbit paths --------------------------------------------
    this.starfield = createStarfield(settings.get('quality') === 'low' ? 6000 : 14_000);
    engine.camera.add(this.starfield);

    this.beltObjects = new Map();
    const beltGroup = new THREE.Group();
    beltGroup.name = 'belts';
    world.add(beltGroup);
    for (const belt of BELTS) {
      const pts = createBelt(belt, this.scale);
      beltGroup.add(pts);
      this.beltObjects.set(belt.id, pts);
    }
    this.beltGroup = beltGroup;

    this.orbitLines = new OrbitLines(this.scale, () => this.list);
    world.add(this.orbitLines.group);
    this.orbitLines.build();
    this.orbitLines.rebuild(true);

    this.applySettings();
    this.unsub = bus.on('settings:change', (e) => this.applySettings(e));
    return this;
  }

  /**
   * Add a body to the world at runtime. Used by the event system for visitors
   * such as a newly discovered comet, and available to anyone extending the sim.
   * @param {object} def a record shaped like the ones in data/bodies.js
   */
  addBody(def) {
    if (this.bodies.has(def.id)) return this.bodies.get(def.id);
    this.orbital.addBody(def);
    if (!this.list.includes(def)) this.list.push(def);
    const body = new CelestialBody(def, this.textures);
    this.engine.world.add(body.group);
    this.bodies.set(def.id, body);
    this.renderPos.set(def.id, new THREE.Vector3());
    // Register with the floating origin: absolute render position in, small
    // rebased local position out.
    this._originDisposers ??= new Map();
    this._originDisposers.set(
      def.id,
      this.engine.origin.add(body.group, (out) => {
        const p = this.renderPos.get(def.id) ?? _zero;
        return out.copy(p);
      })
    );
    // During attach() the orbit lines do not exist yet; they are built once at
    // the end of attach and rebuilt here only for runtime additions.
    this.orbitLines?.build();
    this.orbitLines?.rebuild(true);
    bus.emit('system:body-added', def);
    return body;
  }

  /** Remove a runtime body. The base dataset is never removed. */
  removeBody(id) {
    const body = this.bodies.get(id);
    if (!body || ALL_BODIES.some((b) => b.id === id)) return;
    this._originDisposers?.get(id)?.();
    this._originDisposers?.delete(id);
    this.engine.origin.remove(body.group);
    this.engine.world.remove(body.group);
    body.dispose();
    this.bodies.delete(id);
    this.renderPos.delete(id);
    this.list = this.list.filter((b) => b.id !== id);
    this.orbital.removeBody(id);
    this.orbitLines?.build();
    this.orbitLines?.rebuild(true);
    bus.emit('system:body-removed', id);
  }

  applySettings(change) {
    const key = change?.key ?? '*';
    if (key === '*' || key === 'orbitLines') {
      this.orbitLines.group.visible = settings.get('orbitLines');
    }
    if (key === '*' || key === 'belts') this.beltGroup.visible = settings.get('belts');
    if (key === '*' || key === 'starfield') this.starfield.visible = settings.get('starfield');
    if (key === '*' || key === 'quality') {
      this.ambient.intensity = settings.get('quality') === 'low' ? 0.28 : 0.34;
    }
  }

  /** Absolute render position of a body, in world units. */
  positionOf(id) {
    return this.renderPos.get(id);
  }

  update(dt, ctx) {
    const { simTime, origin } = ctx;
    const dayCount = simTime;
    const originPos = origin.origin;

    // ---------------------------------------------------------------- bodies
    for (const def of this.list) {
      const body = this.bodies.get(def.id);
      const km = this.orbital.get(def.id);
      if (!body || !km) continue;

      // Real km -> render units through the scale model (radially compressed).
      this.scale.position(km, this._km);

      // Satellites are positioned in their parent's local frame instead, so a
      // globally compressed field cannot crush a moon into its planet.
      if (def.parent) {
        const parentKm = this.orbital.get(def.parent);
        const parentBody = this.bodies.get(def.parent);
        const parentRender = this.renderPos.get(def.parent);
        if (parentKm && parentBody && parentRender) {
          const dx = km.x - parentKm.x;
          const dy = km.y - parentKm.y;
          const dz = km.z - parentKm.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          const targetR = this.scale.moonOrbitDistance(
            def.orbit.distKm,
            parentBody.radiusUnits
          );
          const k = targetR / d;
          const p = this.renderPos.get(def.id);
          p.set(
            parentRender.x + dx * k,
            parentRender.y + dy * k,
            parentRender.z + dz * k
          );
        }
      } else {
        const p = this.renderPos.get(def.id);
        p.set(this._km.x, this._km.y, this._km.z);
      }

      // Radius and spin.
      body.setRadius(this.scale.radius(def.radiusKm));
      body.updateRotation(dayCount);

      // ------------------------------------------------------- lighting cues
      const p = this.renderPos.get(def.id);
      if (body.atmosphere || body.nightLights) {
        const sun = this.renderPos.get('sun');
        _sunDir.set(sun.x - p.x, sun.y - p.y, sun.z - p.z).normalize();
        if (body.atmosphere) {
          body.atmosphereMaterial.uniforms.uSunDir.value.copy(_sunDir);
        }
        if (body.nightLights) {
          body.nightLights.material.uniforms.uSunDir.value.copy(_sunDir);
        }
      }

      if (body.tail) {
        const sun = this.renderPos.get('sun');
        _sunDir.set(sun.x - p.x, sun.y - p.y, sun.z - p.z);
        const sunKm = this.orbital.get('sun');
        const distKm = Math.hypot(
          km.x - sunKm.x,
          km.y - sunKm.y,
          km.z - sunKm.z
        );
        body.updateTail(_sunDir, distKm);
      }
    }

    // ------------------------------------------------------------- the sun
    const sun = this.renderPos.get('sun') ?? _zero;
    this.sunLight.position.set(sun.x, sun.y, sun.z);

    // ---------------------------------------------------------------- belts
    for (const [id, pts] of this.beltObjects) {
      const u = pts.material.uniforms;
      u.uDays.value = dayCount;
      u.uBlend.value = this.scale.blend;
      // The shader lights each particle from the Sun's real direction.
      u.uSunDir.value.set(-sun.x, -sun.y, -sun.z).normalize();
      pts.position.set(-originPos.x, -originPos.y, -originPos.z);
    }

    // -------------------------------------------------------- orbit paths
    this.orbitLines.rebuild();
    this.orbitLines.update(dt, ctx, (id) => {
      const p = this.renderPos.get(id);
      return p
        ? { x: p.x, y: p.y, z: p.z }
        : null;
    });

    // ----------------------------------------------------- detail on demand
    this._updateDetail(ctx);
  }

  /**
   * Progressive detail: ask for a higher-resolution texture when a body is
   * large on screen, and remember the level so we don't re-request it.
   */
  _updateDetail(ctx) {
    const camera = ctx.camera;
    const origin = ctx.origin.origin;
    const maxLevel = settings.get('quality') === 'low' ? 1 : settings.get('quality') === 'medium' ? 2 : 3;

    for (const def of this.list) {
      const body = this.bodies.get(def.id);
      const p = this.renderPos.get(def.id);
      if (!body || !p) continue;

      _tmpProj.set(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      const distance = _tmpProj.length();
      if (distance <= 0) continue;
      // Apparent size in pixels: 2 * atan(r/d) / fov * viewportHeight.
      const apparent =
        (body.radiusUnits / distance) *
        (window.innerHeight / Math.tan((camera.fov * Math.PI) / 360));
      const want = Math.min(this.textures.levelFor(apparent), maxLevel);
      if ((body.textureLevel ?? 0) < want) {
        // Close enough that the difference shows? Paint now. Otherwise queue.
        if (want - (body.textureLevel ?? 0) >= 2) {
          body.applyTextureLevel(want);
        } else {
          this.textures.request(def, want);
        }
      }
    }

    // Retire queued upgrades that have been painted.
    if (this.textures.pending.length === 0) {
      for (const def of this.list) {
        const body = this.bodies.get(def.id);
        if (!body) continue;
        for (let lv = (body.textureLevel ?? 0) + 1; lv <= maxLevel; lv++) {
          if (this.textures.has(def, lv)) {
            body.applyTextureLevel(lv);
            break;
          }
        }
      }
    }
  }

  /** Screen-space position of a body, or null if behind the camera. */
  project(id, camera) {
    const p = this.renderPos.get(id);
    if (!p) return null;
    const origin = this.engine.origin.origin;
    _tmpProj.set(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    const dist = _tmpProj.length();
    _tmpProj.project(camera);
    return {
      x: (_tmpProj.x * 0.5 + 0.5) * window.innerWidth,
      y: (-_tmpProj.y * 0.5 + 0.5) * window.innerHeight,
      behind: _tmpProj.z > 1,
      distance: dist,
    };
  }

  /** Distance from the player to a body, in render units. */
  distanceTo(id, fromAbsolute) {
    const p = this.renderPos.get(id);
    if (!p) return Infinity;
    return Math.hypot(p.x - fromAbsolute.x, p.y - fromAbsolute.y, p.z - fromAbsolute.z);
  }

  /**
   * The nearest body whose surface you would hit flying from `from` along
   * `dir` — used for the "you are about to crash into Mars" indicator.
   */
  nearestBodyTo(point, maxDistance = Infinity) {
    let best = null;
    let bestD = maxDistance;
    for (const [id, b] of this.bodies) {
      const p = this.renderPos.get(id);
      if (!p) continue;
      const d = Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z) - b.radiusUnits;
      if (d < bestD) {
        bestD = d;
        best = bodyById.get(id);
      }
    }
    return best ? { body: best, distance: bestD } : null;
  }

  /** Bodies, as an iterable of {def, body}, for the UI. */
  entries() {
    return [...this.bodies.entries()].map(([id, body]) => ({ def: body.def, body }));
  }

  dispose() {
    this.unsub?.();
    for (const b of this.bodies.values()) b.dispose();
    this.orbitLines.dispose();
  }
}

const _sunDir = new THREE.Vector3();
const _tmpProj = new THREE.Vector3();
const _zero = new THREE.Vector3();
