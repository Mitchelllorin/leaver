import { clamp } from '../util/math.js';

/**
 * Where to put the camera when you arrive at a world.
 *
 * This is not a cosmetic detail. The naive answer — "somewhere nearby, facing
 * the body" — is wrong whenever the Sun happens to sit behind the target,
 * because then the opening shot is dominated by the star's bloom and you cannot
 * see the thing you came for.
 *
 * So the arrival point is chosen on the *daylight side*, at a fixed phase angle
 * from the target-to-Sun line. At 62 degrees the target is well lit with a
 * visible terminator, and the Sun sits about 118 degrees away from the centre of
 * view: comfortably outside a 65-degree field of view, so it never glares.
 *
 * Pure geometry, no engine needed, which is what makes it testable.
 *
 * @param {string} targetId
 * @param {{ positionOf: (id: string) => ({x:number,y:number,z:number}|null),
 *           bodies: { get: (id: string) => any } }} solar
 * @param {{ standoffRadii?: number, phaseAngleDeg?: number }} [opts]
 * @returns {{ position: {x:number,y:number,z:number}, yaw: number, pitch: number,
 *            standoff: number, sunAngleDeg: number } | null}
 */
export function openingView(targetId, solar, opts = {}) {
  const target = solar.positionOf(targetId);
  const renderer = solar.bodies.get(targetId);
  if (!target || !renderer) return null;
  const sun = solar.positionOf('sun') ?? { x: 0, y: 0, z: 0 };
  const radius = renderer.radiusUnits ?? 1;
  const standoff = Math.max(radius * (opts.standoffRadii ?? 6.5), radius + 0.6);
  const phase = ((opts.phaseAngleDeg ?? 62) * Math.PI) / 180;

  // Unit vector from the target towards the Sun.
  let sx = sun.x - target.x;
  let sy = sun.y - target.y;
  let sz = sun.z - target.z;
  const sl = Math.hypot(sx, sy, sz);
  if (sl < 1e-9) {
    // Target is the Sun itself: fall back to a plain offset.
    sx = 0;
    sy = 1;
    sz = 0;
  } else {
    sx /= sl;
    sy /= sl;
    sz /= sl;
  }

  // Any direction perpendicular to the Sun direction gives a phase angle.
  let px = 0;
  let py = 1;
  let pz = 0;
  if (Math.abs(sy) > 0.94) {
    px = 1;
    py = 0;
  }
  // perpendicular = normalise(sunDir x up)
  let ax = sy * pz - sz * py;
  let ay = sz * px - sx * pz;
  let az = sx * py - sy * px;
  let al = Math.hypot(ax, ay, az);
  if (al < 1e-6) {
    ax = 1;
    ay = 0;
    az = 0;
    al = 1;
  }
  ax /= al;
  ay /= al;
  az /= al;

  // Rotate the Sun direction towards the perpendicular by the phase angle, so
  // the camera sits on the lit side without looking into the Sun.
  const ca = Math.cos(phase);
  const sa = Math.sin(phase);
  const dx = sx * ca + ax * sa;
  const dy = sy * ca + ay * sa;
  const dz = sz * ca + az * sa;

  const position = {
    x: target.x + dx * standoff,
    y: target.y + dy * standoff * 0.55, // ease off the pole a little
    z: target.z + dz * standoff,
  };

  // Aim at the target's centre.
  const lookX = target.x - position.x;
  const lookY = target.y - position.y;
  const lookZ = target.z - position.z;
  const lookLen = Math.hypot(lookX, lookY, lookZ) || 1;
  const yaw = Math.atan2(-lookX, -lookZ);
  const pitch = Math.asin(clamp(lookY / lookLen, -1, 1));

  // How far off-axis the Sun ends up, for the test and for honesty.
  const viewX = -lookX / lookLen;
  const viewY = -lookY / lookLen;
  const viewZ = -lookZ / lookLen;
  const toSun = { x: sun.x - position.x, y: sun.y - position.y, z: sun.z - position.z };
  const tl = Math.hypot(toSun.x, toSun.y, toSun.z) || 1;
  const dot = clamp(
    (viewX * toSun.x + viewY * toSun.y + viewZ * toSun.z) / tl,
    -1,
    1
  );

  return {
    position,
    yaw,
    pitch,
    standoff,
    sunAngleDeg: (Math.acos(dot) * 180) / Math.PI,
  };
}
