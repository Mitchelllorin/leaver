import { AU_KM, ALL_BODIES, bodyById, childrenOf } from '../data/bodies.js';
import { DEG, clamp, wrap180, daysSinceJ2000 } from '../util/math.js';

/**
 * Orbital mechanics.
 *
 * Heliocentric bodies use the JPL/Standish Keplerian element sets, so the
 * positions in this sim match the real positions of the planets for any date
 * between roughly 1800 and 2050. Satellites use circular, inclined orbits,
 * which is accurate to a few percent for most moons and visually exact for
 * all of them.
 *
 * Nothing here knows about rendering. Output is plain km in a J2000 ecliptic
 * frame, which is what makes "where is Mars right now?" answerable.
 */

const MAX_NEWTON_ITERATIONS = 8;
const KEPLER_EPSILON = 1e-10;

/** Solve Kepler's equation M = E - e sin E for the eccentric anomaly E. */
export function solveKepler(M, e) {
  // Normalise M into [-pi, pi] for fast, reliable convergence.
  let m = M % (Math.PI * 2);
  if (m > Math.PI) m -= Math.PI * 2;
  if (m < -Math.PI) m += Math.PI * 2;

  if (e < 1e-8) return m;

  // Initial guess: good for both low and high eccentricity.
  let E = m + e * Math.sin(m) * (1 + e * Math.cos(m));
  if (e > 0.8) E = m > 0 ? Math.PI : -Math.PI;

  for (let i = 0; i < MAX_NEWTON_ITERATIONS; i++) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < KEPLER_EPSILON) break;
  }
  return E;
}

/** Evaluate an element set (with century rates) at a given J2000 day count. */
export function elementsAt(el, days) {
  const T = days / 36_525;
  const r = el.rates ?? {};
  return {
    a: el.a + (r.a ?? 0) * T,
    e: clamp(el.e + (r.e ?? 0) * T, 0, 0.999),
    i: (el.i + (r.i ?? 0) * T) * DEG,
    L: el.L + (r.L ?? 0) * T,
    longPeri: el.longPeri + (r.longPeri ?? 0) * T,
    longNode: el.longNode + (r.longNode ?? 0) * T,
  };
}

/**
 * Heliocentric position in km, J2000 ecliptic frame.
 * @param {object} el element set
 * @param {number} days since J2000
 * @param {{x:number,y:number,z:number}} out
 */
export function heliocentric(el, days, out = { x: 0, y: 0, z: 0 }) {
  const E0 = elementsAt(el, days);
  const a = E0.a;
  const e = E0.e;
  const inc = E0.i;
  const omega = (E0.longPeri - E0.longNode) * DEG; // argument of periapsis
  const Omega = E0.longNode * DEG;
  const M = (E0.L - E0.longPeri) * DEG;

  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);

  // Position in the orbital plane.
  const xp = a * (cosE - e);
  const yp = a * Math.sqrt(1 - e * e) * sinE;

  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cO = Math.cos(Omega);
  const sO = Math.sin(Omega);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);

  // Rotate orbital plane -> ecliptic.
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = sw * si * xp + cw * si * yp;

  out.x = x * AU_KM;
  out.y = y * AU_KM;
  out.z = z * AU_KM;
  return out;
}

/** Current orbital radius in km (used for lighting and scale queries). */
export function heliocentricDistance(el, days) {
  const p = heliocentric(el, days, _tmpVec);
  return Math.hypot(p.x, p.y, p.z);
}

/**
 * Position of a satellite relative to its parent, in km.
 * Circular orbit with inclination and a phase at J2000.
 */
export function satelliteOffset(orbit, days, out = { x: 0, y: 0, z: 0 }) {
  const period = orbit.periodDays || 1;
  const theta = (orbit.phase ?? 0) * DEG + (days / period) * Math.PI * 2;
  const d = orbit.distKm;
  const inc = (orbit.inclinationDeg ?? 0) * DEG;
  const xp = d * Math.cos(theta);
  const zp = d * Math.sin(theta);
  // Rotate the orbital plane about the x axis by the inclination.
  out.x = xp;
  out.y = -zp * Math.sin(inc);
  out.z = zp * Math.cos(inc);
  return out;
}

/**
 * The whole system at a moment in time.
 *
 * Flat map of id -> {x,y,z} in km, heliocentric, resolved parent-first so
 * satellites inherit their parent's motion.
 */
export class OrbitalSystem {
  constructor() {
    this.name = 'orbital-mechanics';
    this.priority = -100; // must run before anything that consumes positions
    /**
     * Runtime list of bodies. Starts as the dataset but can be extended, which
     * is how a visiting comet joins the simulation mid-flight.
     * @type {Array<object>}
     */
    this.list = [...ALL_BODIES];
    /** @type {Map<string, {x:number,y:number,z:number}>} */
    this.positions = new Map();
    /** @type {Map<string, {x:number,y:number,z:number}>} km/s, heliocentric */
    this.velocities = new Map();
    this._scratch = { x: 0, y: 0, z: 0 };
    this._a = new Map();
    this._b = new Map();
    this._speedDays = null;

    this.update(0, { simTime: daysSinceJ2000() });
    this.refreshVelocities(this._lastDays);
  }

  /** Add a body to the simulation (a visitor, an impactor, a spacecraft). */
  addBody(def) {
    if (!this.list.some((b) => b.id === def.id)) this.list.push(def);
    return def;
  }

  removeBody(id) {
    this.list = this.list.filter((b) => b.id !== id);
    this.positions.delete(id);
    this.velocities.delete(id);
  }

  /** Fill `into` with every body position at `days`, parents resolved first. */
  computeAll(days, into) {
    for (const body of this.list) {
      const out = into.get(body.id) ?? { x: 0, y: 0, z: 0 };
      if (body.id === 'sun') {
        out.x = out.y = out.z = 0;
      } else if (body.parent) {
        const parent = into.get(body.parent);
        if (!parent) continue;
        const off = satelliteOffset(body.orbit, days, this._scratch);
        out.x = parent.x + off.x;
        out.y = parent.y + off.y;
        out.z = parent.z + off.z;
      } else if (body.elements) {
        heliocentric(body.elements, days, out);
      }
      into.set(body.id, out);
    }
    return into;
  }

  update(_dt, ctx) {
    const days = ctx.simTime;
    if (days === this._lastDays) return;
    this._lastDays = days;
    this.computeAll(days, this.positions);
  }

  /**
   * Velocities from a centred finite difference of the orbital model itself,
   * not from frame-to-frame deltas. That makes the readout correct even while
   * time is paused, and independent of frame rate.
   */
  refreshVelocities(days) {
    if (this._speedDays === days) return;
    this._speedDays = days;
    const h = 0.01; // days
    this._a.clear();
    this._b.clear();
    this.computeAll(days - h, this._a);
    this.computeAll(days + h, this._b);
    for (const [id, before] of this._a) {
      const after = this._b.get(id);
      if (!after) continue;
      const inv = 1 / (2 * h * 86_400);
      this.velocities.set(id, {
        x: (after.x - before.x) * inv,
        y: (after.y - before.y) * inv,
        z: (after.z - before.z) * inv,
      });
    }
  }

  get(id) {
    return this.positions.get(id);
  }

  velocityOf(id) {
    const v = this.velocities.get(id);
    return v ? Math.hypot(v.x, v.y, v.z) : 0;
  }

  /** Legacy alias kept for the HUD. */
  speedOf(id) {
    return this.velocityOf(id);
  }

  distanceBetween(aId, bId) {
    const a = this.positions.get(aId);
    const b = this.positions.get(bId);
    if (!a || !b) return null;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /**
   * Which body's gravity dominates at a point in space?
   *
   * Correct hierarchical logic: gather every body whose sphere of influence
   * contains the point, then take the MOST SPECIFIC one (smallest sphere). The
   * Sun's unbounded influence therefore loses to any planet you are standing
   * on, and a moon beats its own planet when you are close to it.
   */
  dominantBody(point) {
    let best = null;
    let bestSoi = Infinity;
    for (const body of this.list) {
      const p = this.positions.get(body.id);
      if (!p) continue;
      const soi = sphereOfInfluenceKm(body);
      if (soi >= bestSoi) continue;
      const d = Math.hypot(point.x - p.x, point.y - p.y, point.z - p.z);
      if (d <= soi) {
        bestSoi = soi;
        best = body;
      }
    }
    return best ?? bodyById.get('sun');
  }

  altitudeAbove(bodyId, point) {
    const p = this.positions.get(bodyId);
    const body = bodyById.get(bodyId);
    if (!p || !body) return Infinity;
    return Math.hypot(point.x - p.x, point.y - p.y, point.z - p.z) - body.radiusKm;
  }
}

const _tmpVec = { x: 0, y: 0, z: 0 };

/**
 * Sphere of influence (Laplace), in km. For satellites we keep a generous
 * fraction of the parent's Hill sphere so moon systems behave sensibly.
 */
export function massKg(body) {
  if (typeof body.massKg === 'number') return body.massKg;
  const parsed = parseFloat(body.mass);
  return Number.isFinite(parsed) ? parsed : 1e22;
}

export function sphereOfInfluenceKm(body) {
  if (body.id === 'sun') return Infinity;
  const parent = bodyById.get(body.parent ?? 'sun');
  if (!parent) return body.radiusKm * 100;
  const a = body.orbit
    ? body.orbit.distKm
    : body.elements
      ? body.elements.a * AU_KM
      : body.radiusKm * 50;
  if (parent.id === 'sun') {
    const aParent = parent.radiusKm;
    // Hill sphere of the planet around the Sun, using the planet's own mass
    // ratio. Rough but monotonic, which is all the HUD needs.
    const ratio = massKg(body) / 1.989e30;
    return a * Math.cbrt(ratio / 3);
  }
  // Satellite around a planet: a fraction of its own orbital radius.
  return a * 0.42;
}

/** Number of satellites per body, precomputed for the info panels. */
export const MOON_COUNTS = (() => {
  const m = new Map();
  for (const b of ALL_BODIES) {
    if (b.parent) m.set(b.parent, (m.get(b.parent) ?? 0) + 1);
  }
  return m;
})();

export { childrenOf, bodyById, wrap180 };
