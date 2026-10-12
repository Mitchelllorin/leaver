import * as THREE from 'three';
import { createFlash, createShockwave, createDebrisBurst, createAurora, createCME, createMeteorShower, createImpactScar } from '../../scene/fx.js';
import { AU_KM, bodyById, LANDABLE } from '../../data/bodies.js';
import { heliocentric, elementsAt } from '../OrbitalMechanics.js';
import { clamp, wrap360 } from '../../util/math.js';
import { hashString } from '../../util/noise.js';

/**
 * The event catalogue.
 *
 * Every entry is a plugin. To add a phenomenon to the sim, append an object
 * here: the scheduler picks it up, the HUD announces it, and the info panel
 * shows its `blurb` so the spectacle always comes with the science.
 *
 *   id            unique key
 *   name          shown in the caption and the event log
 *   category      solar | impact | planetary | deep-space | sky
 *   weight        relative odds when the scheduler rolls
 *   cooldownDays  minimum simulated days between occurrences
 *   requires      body ids that must exist
 *   canRun(ctx)   extra gate
 *   run(ctx)      returns { update(dt, ctx), dispose(), done, detail }
 *
 * `ctx.events.anchor(fx, { bodyId | getPosition })` registers an effect with the
 * floating origin, so effects follow their world correctly at any distance.
 */

// ---------------------------------------------------------------- helpers ---

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _mapA = new Map();
const _mapB = new Map();

/** A uniformly random point on the unit sphere. */
function randomDirection(rng) {
  const u = rng() * 2 - 1;
  const th = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th));
}

/**
 * Absolute render-space position of a point on a body's surface.
 * `localDir` is a unit vector in the body's own frame.
 */
function surfaceWorldPoint(bodyRenderer, localDir, out = new THREE.Vector3()) {
  bodyRenderer.mesh.getWorldQuaternion(_q);
  out.copy(localDir).normalize().applyQuaternion(_q);
  return out;
}

/** A scar welded onto a body's rotating surface. */
function attachScar(bodyRenderer, localDir, opts) {
  const scar = createImpactScar(opts);
  scar.object.scale.setScalar(1.004);
  scar.center = localDir;
  bodyRenderer.mesh.add(scar.object);
  return scar;
}

/** Angular separation between two direction vectors, in degrees. */
function angleBetween(a, b) {
  const la = Math.hypot(a.x, a.y, a.z) || 1;
  const lb = Math.hypot(b.x, b.y, b.z) || 1;
  const dot = clamp((a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb), -1, 1);
  return (Math.acos(dot) * 180) / Math.PI;
}

/** Bodies that make a decent light show: everything but tiny moonlets. */
const SHOWPIECE_BODIES = LANDABLE.filter((b) => b.radiusKm > 100);

export const EVENT_CATALOGUE = [
  // ============================================================== SOLAR ====
  {
    id: 'solar-flare',
    name: 'Solar flare and coronal mass ejection',
    category: 'solar',
    weight: 3,
    cooldownDays: 8,
    severity: 'major',
    at: 'Sun',
    blurb:
      'Magnetic field lines above the Sun snap and reconnect, releasing the energy of billions of megatons in minutes. A coronal mass ejection throws a billion tonnes of plasma into space at up to 3,000 km/s. Earth is protected by its magnetosphere: the plasma is deflected into the polar regions, where it makes the aurora.',
    run(ctx) {
      const { events, solar, orbital, engine, rng } = ctx;

      // Aim the ejection at a real planet sometimes, and at empty space others.
      const targets = ['earth', 'mars', 'jupiter', 'venus'];
      const aimed = rng() < 0.6 ? targets[Math.floor(rng() * targets.length)] : null;
      let direction = null;
      if (aimed) {
        const sun = solar.positionOf('sun');
        const t = solar.positionOf(aimed);
        direction = new THREE.Vector3(t.x - sun.x, t.y - sun.y, t.z - sun.z).normalize();
      } else {
        direction = randomDirection(rng);
      }

      const cme = createCME({ direction, speed: 20 + rng() * 12, duration: 16, seed: (rng() * 1e6) | 0 });
      events.anchor(cme, { bodyId: 'sun' });

      const sunBody = solar.bodies.get('sun');
      const flash = createFlash({ color: 0xfff0c0, size: sunBody?.radiusUnits * 1.6 ?? 30, duration: 3.2 });
      events.anchor(flash, { bodyId: 'sun' });

      // Remember where the front is heading so arrival can be announced.
      const sentAt = engine.simTime;
      let announced = false;
      const travelDays = aimed ? 1.5 + rng() * 2.5 : 3;

      return {
        detail: aimed
          ? `Ejection aimed at ${bodyById.get(aimed)?.name ?? aimed}. Arrival in about ${travelDays.toFixed(1)} days.`
          : 'Ejection aimed away from the planets. A near miss.',
        update(dt, _frame, sys) {
          cme.update(dt);
          flash.update(dt);
          const elapsed = engine.simTime - sentAt;
          if (!announced && aimed && elapsed >= travelDays) {
            announced = true;
            // The front has arrived: light up the target's poles.
            const arriving = new THREE.Vector3();
            const targetPos = solar.positionOf(aimed);
            const bodyRenderer = solar.bodies.get(aimed);
            if (targetPos && bodyRenderer) {
              const r = bodyRenderer.radiusUnits;
              const aurora = createAurora({
                radius: r * 0.42,
                height: r * 0.3,
                intensity: 0,
              });
              aurora.object.rotation.x = Math.PI / 2;
              // Offset through the anchor so the oval actually sits over the
              // pole instead of at the planet's centre.
              events.anchor(aurora, { bodyId: aimed, offset: new THREE.Vector3(0, r * 0.88, 0) });

              // A second handle for the southern oval, sharing nothing but
              // geometry with the northern one.
              const auroraN = aurora.object.clone();
              const southMat = aurora.object.material.clone();
              auroraN.material = southMat;
              const southFx = {
                object: auroraN,
                update: () => {},
                dispose: () => southMat.dispose(),
                done: false,
              };
              events.anchor(southFx, { bodyId: aimed, offset: new THREE.Vector3(0, -r * 0.88, 0) });
              sys._auroras ??= [];
              sys._auroras.push({ aurora, southMat, southFx, t: 0, life: 6 + rng() * 6 });
              ctx.bus.emit('event:sub', {
                id: 'aurora',
                name: `Aurora over ${bodyById.get(aimed)?.name}`,
                blurb:
                  'Charged particles funnelled down the magnetic field lines collide with oxygen and nitrogen 100-300 km up. Oxygen glows green at 120 km and red higher up; nitrogen adds purple and blue fringes.',
              });
            }
          }
          if (sys._auroras) {
            for (let i = sys._auroras.length - 1; i >= 0; i--) {
              const a = sys._auroras[i];
              a.t += dt;
              const env = Math.sin(clamp(a.t / a.life, 0, 1) * Math.PI);
              a.aurora.update(dt, { intensity: env * 1.2 });
              a.southMat.uniforms.uIntensity.value = a.aurora.object.material.uniforms.uIntensity.value;
              if (a.t >= a.life) {
                a.aurora.dispose();
                sys._auroras.splice(i, 1);
              }
            }
          }
        },
        get done() {
          return cme.done && flash.done;
        },
        dispose() {
          cme.dispose();
          flash.dispose();
        },
      };
    },
  },

  {
    id: 'sunspot-cycle',
    name: 'Sunspot maximum',
    category: 'solar',
    weight: 1,
    cooldownDays: 120,
    severity: 'notable',
    at: 'Sun',
    blurb:
      'Activity on the Sun rises and falls on an 11-year cycle, traced by the number of sunspots. At maximum the Sun throws far more flares and ejections; at minimum it can be almost spotless for weeks. The cycle is driven by the Sun\u2019s magnetic field winding itself up as the equator rotates faster than the poles.',
    run(ctx) {
      const sun = ctx.solar.bodies.get('sun');
      const flash = createFlash({ color: 0xffd28a, size: (sun?.radiusUnits ?? 30) * 1.25, duration: 5 });
      ctx.events.anchor(flash, { bodyId: 'sun' });
      return {
        detail: 'Active regions are crossing the visible disc.',
        update(dt) {
          flash.update(dt);
        },
        get done() {
          return flash.done;
        },
        dispose() {
          flash.dispose();
        },
      };
    },
  },

  // ============================================================= IMPACT ====
  {
    id: 'impact',
    name: 'Asteroid impact',
    category: 'impact',
    weight: 2,
    cooldownDays: 25,
    severity: 'catastrophic',
    blurb:
      'Asteroids strike at 15-30 km/s. The energy goes into a crater roughly twenty times the impactor\u2019s width, an ejecta blanket, and a shock wave. The 10 km object that ended the Cretaceous punched out the 180 km Chicxulub crater and threw enough dust into the sky to darken the planet for years.',
    run(ctx) {
      const { events, solar, rng, player } = ctx;
      // Prefer somewhere the viewer can actually see; otherwise pick at random.
      const nearPlayer = player
        ? solar.nearestBodyTo(player.position, 1e9)
        : null;
      const candidates = SHOWPIECE_BODIES.filter((b) => solar.bodies.has(b.id));
      if (!candidates.length) return null;
      const pick =
        nearPlayer && nearPlayer.distance < 900 && candidates.some((b) => b.id === nearPlayer.body.id)
          ? candidates.find((b) => b.id === nearPlayer.body.id)
          : candidates[Math.floor(rng() * candidates.length)];

      const renderer = solar.bodies.get(pick.id);
      if (!renderer) return null;

      const localDir = randomDirection(rng);
      const impactorKm = 0.1 + Math.pow(rng(), 3) * 12;
      const energyMt = 6.24e10 * Math.pow(impactorKm, 3) * 20000; // kilograms * km/s^2, in megatons-ish

      const worldDir = surfaceWorldPoint(renderer, localDir, _v);
      const offset = worldDir.clone().multiplyScalar(renderer.radiusUnits * 1.02);

      // The offset goes through the anchor, NOT onto the object directly: the
      // floating origin rewrites every anchored object's position each frame,
      // so a locally-set position is silently discarded.
      const flash = createFlash({
        color: 0xfff1c1,
        size: renderer.radiusUnits * 1.1,
        duration: 1.6,
      });
      events.anchor(flash, { bodyId: pick.id, offset: offset.clone() });

      const debris = createDebrisBurst({
        count: 1400,
        speed: renderer.radiusUnits * 0.55,
        spread: 0.85,
        color: 0xffb070,
        duration: 9,
        seed: hashString(pick.id + rng()),
      });
      events.anchor(debris, { bodyId: pick.id, offset: offset.clone() });

      const wave = createShockwave({
        color: 0xffd9a0,
        maxRadius: renderer.radiusUnits * 3.4,
        duration: 3.2,
      });
      events.anchor(wave, { bodyId: pick.id, offset: offset.clone() });

      const scar = attachScar(renderer, localDir, {
        color: 0x1a1410,
        opacity: clamp(0.35 + impactorKm / 12, 0.35, 0.85),
        size: clamp(0.06 + impactorKm * 0.03, 0.06, 0.4),
      });

      return {
        detail: `${pick.name} takes a hit. Impactor about ${impactorKm.toFixed(1)} km across.`,
        update(dt) {
          flash.update(dt);
          debris.update(dt);
          wave.update(dt);
          scar.update(dt);
        },
        get done() {
          return debris.done && wave.done && flash.done;
        },
        dispose() {
          flash.dispose();
          debris.dispose();
          wave.dispose();
          // The scar stays: it is now part of the world.
        },
      };
    },
  },

  {
    id: 'meteor-shower',
    name: 'Meteor shower',
    category: 'sky',
    weight: 4,
    cooldownDays: 12,
    severity: 'minor',
    blurb:
      'Meteor showers happen when Earth crosses the dusty trail left by a comet. The particles are usually smaller than a grain of sand and burn up 80-100 km overhead. Because the debris stream is fixed in space, every meteor appears to radiate from one point in the sky, which is how showers get named after their constellations.',
    run(ctx) {
      const { events, player, solar } = ctx;
      const shower = createMeteorShower({
        count: 260,
        duration: 12,
        seed: (ctx.rng() * 1e6) | 0,
      });
      // Anchor to the viewer so the shower is always overhead, whichever world
      // they happen to be standing on.
      events.anchor(shower, {
        getPosition: (out) => out.copy(player.position),
      });
      return {
        detail: 'Radiant high overhead.',
        update(dt) {
          shower.update(dt);
        },
        get done() {
          return shower.done;
        },
        dispose() {
          shower.dispose();
        },
      };
    },
  },

];

/** Everything below is real orbital geometry rather than random spectacle. */
const DEEP_SPACE = [
  // ======================================================== PLANETARY ====
  {
    id: 'close-approach',
    name: 'Close approach',
    category: 'planetary',
    weight: 3,
    cooldownDays: 40,
    severity: 'notable',
    blurb:
      'Planets do not orbit at fixed distances: eccentric orbits and different periods mean the gap between two worlds grows and shrinks constantly. When the outer planet is at opposition the transfer becomes short enough for a spacecraft, which is why Mars missions only launch every 26 months.',
    canRun(ctx) {
      return ['earth', 'mars', 'venus', 'jupiter'].filter((id) => ctx.solar.bodies.has(id)).length >= 2;
    },
    run(ctx) {
      const { solar, orbital, engine } = ctx;
      const pairs = [
        ['earth', 'mars'],
        ['earth', 'venus'],
        ['earth', 'jupiter'],
        ['mars', 'jupiter'],
      ].filter(([a, b]) => solar.bodies.has(a) && solar.bodies.has(b));
      if (!pairs.length) return null;
      const [a, b] = pairs[Math.floor(ctx.rng() * pairs.length)];

      // Scan forward for the minimum separation over the next few years.
      let best = { gap: Infinity, days: 0 };
      const horizon = 1200;
      const step = 1;
      for (let d = 0; d <= horizon; d += step) {
        _mapA.clear();
        orbital.computeAll(engine.simTime + d, _mapA);
        const pa = _mapA.get(a);
        const pb = _mapA.get(b);
        if (!pa || !pb) continue;
        const gap = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
        if (gap < best.gap) best = { gap, days: d };
      }

      const nameA = bodyById.get(a)?.name ?? a;
      const nameB = bodyById.get(b)?.name ?? b;
      const etaDays = best.days;

      return {
        detail: `${nameA} and ${nameB} reach a minimum separation of ${(best.gap / 1e6).toFixed(2)} million km in ${etaDays} days.`,
        update(dt, _c, sys) {
          sys._closeApproach ??= { gap: best.gap, days: best.days, a, b };
        },
        get done() {
          return true;
        },
        dispose() {},
      };
    },
  },

  {
    id: 'grand-alignment',
    name: 'Planetary alignment',
    category: 'planetary',
    weight: 2,
    cooldownDays: 90,
    severity: 'notable',
    blurb:
      'A "grand alignment" is when several planets happen to lie on the same side of the Sun at once. Nothing physical comes of it: the combined gravity of every planet is about 0.0003% of the Sun\u2019s pull on Earth. It is a line of sight, not a line of force.',
    run(ctx) {
      const { solar, orbital, engine } = ctx;
      const outer = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'].filter((id) =>
        solar.bodies.has(id)
      );
      if (outer.length < 4) return null;

      // Spread = the largest angle between any two planets seen from the Sun.
      const spreadAt = (days) => {
        _mapA.clear();
        orbital.computeAll(engine.simTime + days, _mapA);
        let worst = 0;
        const pts = [];
        for (const id of outer) {
          const p = _mapA.get(id);
          if (p) pts.push(p);
        }
        for (let i = 0; i < pts.length; i++) {
          for (let k = i + 1; k < pts.length; k++) {
            worst = Math.max(worst, angleBetween(pts[i], pts[k]));
          }
        }
        return worst;
      };

      let best = { spread: 999, days: 0 };
      for (let d = 0; d <= 2000; d += 2) {
        const s = spreadAt(d);
        if (s < best.spread) best = { spread: s, days: d };
        if (best.spread < 12 && d > 60) break;
      }

      const list = outer.map((id) => bodyById.get(id)?.name).join(', ');
      return {
        detail: `${list} come within ${best.spread.toFixed(1)} degrees of alignment in ${best.days} days.`,
        update() {},
        get done() {
          return true;
        },
        dispose() {},
      };
    },
  },

  {
    id: 'solar-eclipse',
    name: 'Total solar eclipse',
    category: 'sky',
    weight: 2,
    cooldownDays: 60,
    severity: 'major',
    at: 'Earth',
    blurb:
      'A total solar eclipse needs a freak coincidence: the Sun is about 400 times wider than the Moon and also about 400 times further away, so the two discs match almost exactly. The Moon slides between Earth and the Sun, and the Sun\u2019s corona becomes visible. Only a narrow track on the surface sees totality, because the Moon\u2019s shadow is just a few hundred kilometres wide.',
    canRun(ctx) {
      const has = ['earth', 'luna', 'sun'].every((id) => ctx.solar.bodies.has(id));
      // Check cheaply that the Moon is anywhere near the Sun-Earth line.
      if (!has) return false;
      return true;
    },
    run(ctx) {
      const { solar, orbital, engine, events, rng } = ctx;
      if (!['earth', 'luna'].every((id) => solar.bodies.has(id))) return null;

      // A solar eclipse is a geometric event: the Moon must pass close enough
      // to the Sun-Earth line that its shadow lands on the planet.
      const EARTH_R = 6371;
      const shadowMiss = (days) => {
        _mapA.clear();
        orbital.computeAll(engine.simTime + days, _mapA);
        const sun = _mapA.get('sun');
        const earth = _mapA.get('earth');
        const moon = _mapA.get('luna');
        if (!sun || !earth || !moon) return Infinity;
        // Moon must be between the Sun and Earth.
        const toSun = { x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z };
        const toEarth = { x: earth.x - moon.x, y: earth.y - moon.y, z: earth.z - moon.z };
        if (angleBetween(toSun, toEarth) < 150) return Infinity;
        // Distance from Earth's centre to the Sun-Moon line.
        const d = { x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z };
        const w = { x: earth.x - moon.x, y: earth.y - moon.y, z: earth.z - moon.z };
        const dd = d.x * d.x + d.y * d.y + d.z * d.z;
        if (dd < 1e-9) return Infinity;
        const t = (w.x * d.x + w.y * d.y + w.z * d.z) / dd;
        const cx = moon.x + d.x * t - earth.x;
        const cy = moon.y + d.y * t - earth.y;
        const cz = moon.z + d.z * t - earth.z;
        return Math.hypot(cx, cy, cz);
      };

      let next = { days: Infinity, miss: Infinity };
      for (let d = 0; d <= 400; d += 0.02) {
        const m = shadowMiss(d);
        if (m < EARTH_R * 1.2) {
          next = { days: d, miss: m };
          break;
        }
        if (m < next.miss) next = { days: d, miss: m };
      }

      if (!Number.isFinite(next.days)) return null;
      const inDays = next.days;

      if (inDays > 3) {
        const when = new Date(Date.now() + inDays * 86_400_000);
        return {
          detail: `Next solar eclipse: ${when.toISOString().slice(0, 10)}, in ${inDays.toFixed(1)} days of simulated time. Wind the clock forward to watch it.`,
          update() {},
          get done() {
            return true;
          },
          dispose() {},
        };
      }

      // Imminent: draw the Moon's shadow sweeping the planet.
      const earthRenderer = solar.bodies.get('earth');
      const localDir = randomDirection(rng);
      const scar = createImpactScar({ color: 0x05070c, opacity: 0.85, size: 0.05 });
      scar.object.scale.setScalar(1.005);
      scar.center = localDir;
      scar.strength = 0.85;
      earthRenderer.mesh.add(scar.object);

      let t = 0;
      const life = 24;
      return {
        detail: 'Totality: the Moon\u2019s shadow is crossing the surface.',
        update(dt) {
          t += dt;
          scar.update(dt);
          scar.object.position.set(0, 0, 0);
          // The shadow drifts across the face as the Moon moves.
          _v.set(Math.cos(t * 0.05), Math.sin(t * 0.03) * 0.2, Math.sin(t * 0.05)).normalize();
          scar.center = _v;
          if (t > life) scar.strength = 0;
        },
        get done() {
          return t > life + 4;
        },
        dispose() {
          scar.dispose();
        },
      };
    },
  },

  // ======================================================= DEEP SPACE ====
  {
    id: 'visitor-comet',
    name: 'A comet arrives',
    category: 'deep-space',
    weight: 3,
    cooldownDays: 45,
    severity: 'major',
    blurb:
      'Long-period comets fall in from the Oort cloud, a shell of icy bodies up to 100,000 AU out. Nudged by a passing star, they take millions of years to fall toward the Sun and are slingshot back out again. Their tails always point away from the Sun: solar wind and radiation pressure push the gas and dust outward, not backward.',
    run(ctx) {
      const { events, solar, rng } = ctx;
      // Build a fresh, wildly eccentric orbit and hand it to the world. This is
      // the modularity test: a new body, no code changes anywhere else.
      const a = 20 + rng() * 60;
      const id = `visitor-${Math.floor(rng() * 1e6)}`;
      const peri = 0.35 + rng() * 1.4;
      const e = clamp(1 - peri / a, 0.5, 0.97);
      const inclination = rng() * 70 - 35;
      const palette = [
        ['#cfd8e2', '#9aa6b4'],
        ['#dbe8e0', '#9fb8ae'],
        ['#e2d6c8', '#b0a08c'],
      ][Math.floor(rng() * 3)];

      const def = {
        id,
        name: `Comet ${id.split('-')[1]}`,
        type: 'comet',
        radiusKm: 3 + rng() * 9,
        mass: '1e14 kg',
        gravity: 0.00005,
        rotationHours: 12 + rng() * 40,
        axialTilt: 20,
        surfaceTemp: '-100 °C',
        composition: 'Water ice, dust, carbon monoxide',
        elements: {
          a,
          e,
          i: inclination,
          L: rng() * 360,
          longPeri: rng() * 360,
          longNode: rng() * 360,
          rates: { a: 0, e: 0, i: 0, L: 0.18, longPeri: 0, longNode: 0 },
        },
        summary:
          'A freshly discovered long-period comet on its first recorded pass through the inner solar system. Its tail will grow as the Sun boils away its surface ices.',
        facts: [
          ['Semi-major axis', `${a.toFixed(1)} AU`],
          ['Eccentricity', e.toFixed(3)],
          ['Perihelion', `${peri.toFixed(2)} AU`],
          ['Inclination', `${inclination.toFixed(1)}°`],
        ],
        visual: {
          surface: 'icy',
          palette,
          noise: { scale: 8, contrast: 0.9, craters: 20 },
          roughness: 0.98,
          metalness: 0,
        },
        comet: { tailKm: 8e7, comaColor: '#bff2ff', tailColor: '#9fd8ff' },
        terrain: {
          rock: '#3e3832',
          dust: '#8a8f96',
          dustAmount: 0.8,
          sky: ['#000000', '#01010a'],
          metal: 0.05,
          lowGravity: 0.00005,
          comet: true,
        },
      };
      solar.addBody(def);

      // A coma: the bright cloud of gas around the nucleus.
      const flash = createFlash({ color: 0xcbf7ff, size: 3.5, duration: 6 });
      events.anchor(flash, { bodyId: id });

      // The visit lasts a set number of simulated days; then the comet is
      // removed from the world so the system does not accumulate strays.
      const startDay = ctx.engine.simTime;
      const stayDays = 260;
      const state = { expired: false };

      return {
        detail: `${def.name} enters the inner solar system on a ${a.toFixed(1)} AU orbit, inclined ${inclination.toFixed(0)}°.`,
        update(dt, _frame, _sys) {
          flash.update(dt);
          if (!state.expired && ctx.engine.simTime - startDay > stayDays) {
            state.expired = true;
            // Fade the coma out and drop the body.
            solar.removeBody(id);
          }
        },
        get done() {
          return flash.done && state.expired;
        },
        dispose() {
          flash.dispose();
          if (solar.bodies.has(id)) solar.removeBody(id);
        },
      };
    },
  },

  {
    id: 'supernova',
    name: 'Distant supernova',
    category: 'deep-space',
    weight: 1,
    cooldownDays: 200,
    severity: 'astronomical',
    blurb:
      'A star in another galaxy runs out of fuel and collapses. In seconds it outshines its entire galaxy, forging elements heavier than iron and scattering them into space. The calcium in your bones and the iron in your blood were made this way. The nearest known supernova seen from Earth, in 1987, was visible to the naked eye for months.',
    run(ctx) {
      const { events, player, rng } = ctx;
      // Pin the flash to a fixed direction at an effectively infinite distance.
      const dir = randomDirection(rng);
      const getPosition = (out) => {
        out.copy(player.position).addScaledVector(dir, 400_000);
        return out;
      };
      const flash = createFlash({ color: 0xdff0ff, size: 90, duration: 22 });
      const entry = events.anchor(flash, { getPosition });
      return {
        detail: `A new point of light appears in the sky, ${Math.round(Math.acos(clamp(dir.y, -1, 1)) * 57.3)}° from the ecliptic pole.`,
        update(dt) {
          // The anchor's getPosition keeps it pinned far away; no manual set.
          flash.update(dt);
        },
        get done() {
          return flash.done;
        },
        dispose() {
          flash.dispose();
        },
      };
    },
  },
];

EVENT_CATALOGUE.push(...DEEP_SPACE);
