/**
 * ScaleModel — the heart of the "vast but playable" problem.
 *
 * Reality: Neptune sits ~7,700 Sun-widths from the Sun, and Mercury is a grain
 * of sand 58 million km out. A 1:1 render is beautiful but unusable; a "smaller
 * solar system" is a lie. So we support BOTH and blend continuously:
 *
 *   TRUE scale    — 1 render unit = 1,000 km. Physically honest. Mostly empty.
 *   EXPLORE scale — heliocentric distance follows a power law (r^0.74) so
 *                   Mercury is a short flight and Neptune stays on the horizon;
 *                   body radii are gamma-boosted so small moons stay visible.
 *
 * All simulation state is stored in REAL units (km, days). This class is the
 * only place that knows render units exist.
 *
 * Two separate transforms, on purpose:
 *   distance(km)  — applied RADIALLY to heliocentric positions. Preserves
 *                   orbit *shape* (circles stay circles, ellipses stay
 *                   ellipses); only eccentricity warps.
 *   moonOrbitDistance() — satellite orbits are remapped in the PARENT's local
 *                   frame, otherwise a globally compressed field would crush
 *                   every moon into its planet.
 */

/** Astronomical unit in km (IAU 2012 definition). */
export const AU_KM = 149_597_870.7;

// --- explore: distance ------------------------------------------------------
// Exported so the belt and orbit-line shaders can apply the same radial
// compression on the GPU instead of rebuilding geometry every frame.
export const DIST_EXP = 0.74;
const DIST_MERCURY_UNITS = 62;
export const DIST_COEF = DIST_MERCURY_UNITS / Math.pow(57_900_000, DIST_EXP);
export const KM_PER_UNIT_TRUE = 1000;

// --- explore: body radius ---------------------------------------------------
const SIZE_EXP = 0.8;
const SIZE_COEF = 6.5 / Math.pow(6371, SIZE_EXP); // Earth -> ~6.5 units
const MIN_VISIBLE_RADIUS = 0.35;
// Soft saturation instead of a hard clamp: gas giants stay distinct from each
// other (tanh is monotonic) while never swallowing the inner system.
const SIZE_SOFT_CAP = 34;

// --- explore: satellite orbits ---------------------------------------------
const MOON_CLEARANCE = 1.7; // parent radii of guaranteed clearance
const MOON_COEF = 0.35;
const MOON_EXP = 0.6;

export class ScaleModel {
  constructor() {
    /** 0 = explore (playable), 1 = true (honest). */
    this.blend = 0;
    /** User-controlled size exaggeration (0.25x - 4x) for readability. */
    this.sizeBoost = 1;
  }

  setBlend(value) {
    this.blend = Math.min(1, Math.max(0, value));
    return this.blend;
  }

  // -- radius ---------------------------------------------------------------
  trueRadius(radiusKm) {
    return radiusKm / KM_PER_UNIT_TRUE;
  }

  exploreRadius(radiusKm) {
    const natural = SIZE_COEF * Math.pow(radiusKm, SIZE_EXP);
    const saturated = SIZE_SOFT_CAP * Math.tanh(natural / SIZE_SOFT_CAP);
    return Math.max(MIN_VISIBLE_RADIUS, saturated);
  }

  radius(radiusKm) {
    const t = this.trueRadius(radiusKm);
    const e = this.exploreRadius(radiusKm) * this.sizeBoost;
    return e + (t - e) * this.blend;
  }

  // -- heliocentric distance ------------------------------------------------
  trueDistance(km) {
    return km / KM_PER_UNIT_TRUE;
  }

  exploreDistance(km) {
    return DIST_COEF * Math.pow(km, DIST_EXP);
  }

  distance(km) {
    const e = this.exploreDistance(km);
    const t = this.trueDistance(km);
    return e + (t - e) * this.blend;
  }

  distanceInverse(units) {
    const e = Math.pow(Math.max(units, 0) / DIST_COEF, 1 / DIST_EXP);
    const t = units * KM_PER_UNIT_TRUE;
    return e + (t - e) * this.blend;
  }

  /**
   * Local isotropic scale near a point (render units per km, tangentially).
   * Used for speed governors and for sizing local effects.
   */
  localScaleAt(kmDistance, deltaKm = 1000) {
    const a = this.distance(kmDistance);
    const b = this.distance(kmDistance + deltaKm);
    return (b - a) / deltaKm;
  }

  // -- satellite orbits (parent-local frame) --------------------------------
  /**
   * @param {number} distKm semi-major axis of the satellite, km
   * @param {number} parentRenderRadius already-scaled parent radius (units)
   */
  moonOrbitDistance(distKm, parentRenderRadius) {
    const t = distKm / KM_PER_UNIT_TRUE;
    const e =
      parentRenderRadius * MOON_CLEARANCE +
      MOON_COEF * Math.pow(distKm / 1000, MOON_EXP);
    return e + (t - e) * this.blend;
  }

  /**
   * Remap a full heliocentric position (km) into render units.
   * @param {{x:number,y:number,z:number}} kmPos
   */
  position(kmPos, out = { x: 0, y: 0, z: 0 }) {
    const r = Math.hypot(kmPos.x, kmPos.y, kmPos.z);
    if (r === 0) {
      out.x = out.y = out.z = 0;
      return out;
    }
    const k = this.distance(r) / r;
    out.x = kmPos.x * k;
    out.y = kmPos.y * k;
    out.z = kmPos.z * k;
    return out;
  }

  /**
   * Render units -> km along a heliocentric ray. Used by the HUD and by
   * "fly to" targeting.
   */
  kmAtRenderDistance(units) {
    return this.distanceInverse(units);
  }
}
