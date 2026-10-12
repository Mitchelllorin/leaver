import * as THREE from 'three';

/**
 * FloatingOrigin — keeps rendered coordinates small.
 *
 * Distances here reach 10^10 km. If we placed objects at their absolute
 * coordinates, GPU float32 matrices would visibly jitter and z-fight. Instead
 * every frame we subtract a moving `origin` (normally the camera) from each
 * object's *float64* world position and write the small remainder into the
 * object's transform.
 *
 * Nothing else in the codebase needs to know this exists: objects register a
 * `getWorldPositionKm`-ish provider and the origin does the rest.
 */
export class FloatingOrigin {
  constructor() {
    this.origin = new THREE.Vector3(); // render units
    /** @type {Array<{object: THREE.Object3D, getPosition: (out:THREE.Vector3)=>THREE.Vector3}>} */
    this.members = [];
    this.lastShift = new THREE.Vector3();
  }

  /**
   * @param {THREE.Object3D} object
   * @param {(out: THREE.Vector3) => THREE.Vector3} getPosition absolute render-space position
   */
  add(object, getPosition) {
    this.members.push({ object, getPosition });
    return () => this.remove(object);
  }

  remove(object) {
    this.members = this.members.filter((m) => m.object !== object);
  }

  /** Move the origin (render units). */
  set(x, y, z) {
    this.lastShift.set(x - this.origin.x, y - this.origin.y, z - this.origin.z);
    this.origin.set(x, y, z);
  }

  /**
   * Rebase every member. Call once per frame BEFORE rendering, after all
   * systems have updated absolute positions.
   */
  update() {
    const o = this.origin;
    for (const m of this.members) {
      const p = m.getPosition(_tmp);
      m.object.position.set(p.x - o.x, p.y - o.y, p.z - o.z);
    }
  }
}

const _tmp = new THREE.Vector3();
