import * as THREE from 'three';
import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';
import { mulberry32 } from '../util/noise.js';
import { clamp } from '../util/math.js';
import { EVENT_CATALOGUE } from './events/catalogue.js';

/**
 * Random massive events.
 *
 * Every event is a small plugin: it declares a weight, how often it may fire,
 * what it needs, and a `run` that returns an object with update/dispose. The
 * scheduler picks one at weighted random, respects cooldowns in SIMULATED time
 * (so cranking the time scale forward actually lets the solar system get on
 * with causing trouble), and announces it with a caption the UI reads out.
 *
 * Adding an event means adding an object to events/catalogue.js. Nothing here
 * needs to change.
 */
export class EventsSystem {
  constructor(engine, solar, scale, orbital, player) {
    this.name = 'events';
    this.priority = 40;
    this.engine = engine;
    this.solar = solar;
    this.scale = scale;
    this.orbital = orbital;
    this.player = player;

    this.rng = mulberry32(Date.now() & 0xffff);
    /** Currently running event instances. */
    this.active = [];
    /** id -> simulated day when it last fired. */
    this.lastFired = new Map();
    /** Simulated days until the next roll. */
    this.nextRoll = 0.35;
    this.enabled = true;
    this.log = [];
    this.fxCount = 0;

    /** Anchored effects, rebased by the floating origin each frame. */
    this._anchors = [];
  }

  /**
   * Attach an effect so it follows a body (or a fixed absolute point).
   *
   * `offset` is expressed in the anchor's frame and is added AFTER the floating
   * origin rebase, which is the whole point: writing a position onto the object
   * directly does nothing, because the origin rewrites it every frame. An
   * impact flash at a planet's surface, or an auroral oval over its pole, is an
   * offset, not a position.
   *
   * @param {{ object: THREE.Object3D }} fx
   * @param {{ bodyId?: string, getPosition?: (out: THREE.Vector3) => THREE.Vector3,
   *           spin?: number, offset?: THREE.Vector3 }} [opts]
   */
  anchor(fx, { bodyId = null, getPosition = null, spin = 0, offset = null } = {}) {
    const object = fx.object;
    this.engine.world.add(object);
    const entry = {
      fx,
      bodyId,
      getPosition,
      spin,
      offset: offset ? offset.clone() : new THREE.Vector3(),
      t: 0,
    };
    if (!bodyId && !getPosition) {
      entry.getPosition = () => new THREE.Vector3();
    }
    this._anchors.push(entry);
    // Register with the floating origin so the effect survives the rebase.
    const dispose = this.engine.origin.add(object, (out) => {
      const p = this._anchorPosition(entry, out);
      return p;
    });
    entry.originDispose = dispose;
    this.fxCount++;
    return entry;
  }

  _anchorPosition(entry, out) {
    if (entry.bodyId) {
      const p = this.solar.positionOf(entry.bodyId);
      if (p) {
        out.set(p.x, p.y, p.z);
        if (entry.offset.lengthSq() > 0) {
          // Rotate the offset slowly so orbiting debris looks alive.
          const a = entry.t * (entry.spin || 0);
          const c = Math.cos(a);
          const s = Math.sin(a);
          const ox = entry.offset.x;
          const oz = entry.offset.z;
          out.x += ox * c - oz * s;
          out.z += ox * s + oz * c;
          out.y += entry.offset.y;
        }
        return out;
      }
    }
    if (entry.getPosition) return entry.getPosition(out);
    return out;
  }

  /** Trigger a specific event by id (used by the UI and the tour). */
  trigger(id, opts = {}) {
    const def = EVENT_CATALOGUE.find((e) => e.id === id);
    if (!def) return null;
    return this._start(def, opts);
  }

  _start(def, opts = {}) {
    const ctx = {
      solar: this.solar,
      scale: this.scale,
      orbital: this.orbital,
      engine: this.engine,
      player: this.player,
      events: this,
      rng: this.rng,
      simTime: this.engine.simTime,
      bus,
    };
    let instance;
    try {
      instance = def.run(ctx, opts);
    } catch (err) {
      console.error(`[events] "${def.id}" failed to start:`, err);
      return null;
    }
    if (!instance) return null;

    const entry = {
      def,
      instance,
      t: 0,
      startedAt: this.engine.simTime,
    };
    this.active.push(entry);
    this.lastFired.set(def.id, this.engine.simTime);

    const message = {
      id: def.id,
      name: def.name,
      category: def.category ?? 'phenomenon',
      blurb: def.blurb,
      detail: instance.detail ?? '',
      severity: def.severity ?? 'notable',
      at: def.at ?? '',
    };
    this.log.unshift({ ...message, simTime: this.engine.simTime });
    if (this.log.length > 40) this.log.pop();
    bus.emit('event:started', message);
    return entry;
  }

  /** Pick and start a random eligible event. */
  fireRandom() {
    const eligible = EVENT_CATALOGUE.filter((def) => this._eligible(def));
    if (!eligible.length) return null;
    const total = eligible.reduce((a, d) => a + (d.weight ?? 1), 0);
    let roll = this.rng() * total;
    for (const def of eligible) {
      roll -= def.weight ?? 1;
      if (roll <= 0) return this._start(def);
    }
    return this._start(eligible[eligible.length - 1]);
  }

  _eligible(def) {
    if (def.enabled === false) return false;
    if (def.requires && !def.requires.every((id) => this.solar.bodies.has(id))) return false;
    const last = this.lastFired.get(def.id);
    if (last !== undefined) {
      const elapsed = this.engine.simTime - last;
      if (elapsed < (def.cooldownDays ?? 30)) return false;
    }
    if (def.canRun) {
      try {
        return def.canRun({
          solar: this.solar,
          orbital: this.orbital,
          player: this.player,
          simTime: this.engine.simTime,
          scale: this.scale,
        });
      } catch {
        return false;
      }
    }
    return true;
  }

  /** Days until each event becomes eligible again, for the UI. */
  cooldownReport() {
    return EVENT_CATALOGUE.map((def) => {
      const last = this.lastFired.get(def.id);
      const remaining =
        last === undefined
          ? 0
          : Math.max(0, (def.cooldownDays ?? 30) - (this.engine.simTime - last));
      return { def, remaining, eligible: this._eligible(def) };
    });
  }

  update(dt, ctx) {
    // Advance anchored effects.
    for (const entry of this._anchors) entry.t += dt;

    // Roll for new events. Rate is in simulated days, so winding the clock
    // forward makes the solar system livelier.
    if (this.enabled && !settings.get('paused')) {
      this.nextRoll -= (dt * settings.get('timeScale')) / 86400;
      if (this.nextRoll <= 0) {
        const gap = 0.5 + this.rng() * 6.5; // simulated days between rolls
        this.nextRoll = gap;
        // Don't stack events on top of each other.
        if (this.active.length < 3) this.fireRandom();
      }
    }

    // Tick running events; retire finished ones.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i];
      entry.t += dt;
      try {
        entry.instance.update?.(dt, ctx, this);
      } catch (err) {
        console.error(`[events] "${entry.def.id}" update failed:`, err);
        this.active.splice(i, 1);
        continue;
      }
      if (entry.instance.done) {
        this.active.splice(i, 1);
        entry.instance.dispose?.();
        bus.emit('event:ended', { id: entry.def.id, name: entry.def.name });
      }
    }
  }

  /** Total elapsed real seconds of any running event (for the HUD ticker). */
  activeNames() {
    return this.active.map((a) => a.def.name);
  }

  dispose() {
    for (const a of this.active) a.instance.dispose?.();
    for (const entry of this._anchors) {
      entry.originDispose?.();
      this.engine.world.remove(entry.fx.object);
      entry.fx.dispose?.();
    }
    this._anchors.length = 0;
    this.active.length = 0;
  }
}
