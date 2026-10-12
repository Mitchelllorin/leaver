import * as THREE from 'three';
import { ALL_BODIES } from '../data/bodies.js';
import { heliocentric, satelliteOffset, elementsAt } from '../systems/OrbitalMechanics.js';

/**
 * Orbit paths.
 *
 * Sampled from the same element sets the mechanics use, so an orbit line is
 * always exactly where the body actually travels. Lines are rebuilt only when
 * the scale blend changes, not every frame.
 */
export class OrbitLines {
  /**
   * @param {import('../core/ScaleModel.js').ScaleModel} scale
   * @param {() => Array<object>} [listProvider] runtime body list, so orbits
   *   added at runtime (a visiting comet) get a path too.
   */
  constructor(scale, listProvider = () => ALL_BODIES) {
    this.scale = scale;
    this.listProvider = listProvider;
    this.group = new THREE.Group();
    this.group.name = 'orbit-lines';
    this.group.frustumCulled = false;
    this.lines = new Map();
    this._lastBlend = -1;
    this._built = false;
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.group.visible = false;
  }

  _samplesFor(body) {
    const SAMPLES = 256;
    if (body.orbit) return { kind: 'satellite', samples: SAMPLES };
    return { kind: 'heliocentric', samples: SAMPLES };
  }

  build() {
    for (const [id, line] of this.lines) {
      line.geometry.dispose();
      this.group.remove(line);
    }
    this.lines.clear();

    for (const body of this.listProvider()) {
      if (body.id === 'sun') continue;
      if (!body.elements && !body.orbit) continue;

      const { samples } = this._samplesFor(body);
      const period = body.orbit
        ? Math.abs(body.orbit.periodDays)
        : (elementsAt(body.elements, 0).a ** 1.5) * 365.256;
      const center = new THREE.Vector3();
      if (body.parent) {
        // Orbit lines of satellites are drawn around their parent's position,
        // which is updated every frame in update().
        center.set(0, 0, 0);
      }

      const pts = new Float32Array(samples * 3);
      const cols = new Float32Array(samples * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

      const line = new THREE.Line(geo, this.material.clone());
      line.frustumCulled = false;
      line.userData = { bodyId: body.id, samples, period, center };
      this.group.add(line);
      this.lines.set(body.id, line);
    }
    this._built = true;
  }

  /** Recompute all orbit paths for the current scale blend. */
  rebuild(force = false) {
    if (!this._built) this.build();
    if (!force && Math.abs(this.scale.blend - this._lastBlend) < 0.002) return;
    this._lastBlend = this.scale.blend;

    const out = { x: 0, y: 0, z: 0 };
    for (const body of this.listProvider()) {
      const line = this.lines.get(body.id);
      if (!line) continue;
      const { samples, period } = line.userData;
      const pos = line.geometry.attributes.position;
      const col = line.geometry.attributes.color;

      const tint = new THREE.Color(tintFor(body));
      for (let i = 0; i < samples; i++) {
        const days = (i / samples) * period;
        if (body.orbit) satelliteOffset(body.orbit, days, out);
        else heliocentric(body.elements, days, out);
        this.scale.position(out, out);
        pos.setXYZ(i, out.x, out.y, out.z);
        // Fade the trail so the path reads as motion rather than a wire.
        const f = 0.35 + 0.65 * (i / samples);
        col.setXYZ(i, tint.r * f, tint.g * f, tint.b * f);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }

  /** Keep satellite orbit rings centred on their moving parent. */
  update(dt, ctx, getPosition) {
    for (const body of this.listProvider()) {
      if (!body.parent) continue;
      const line = this.lines.get(body.id);
      if (!line) continue;
      const p = getPosition(body.parent);
      if (p) line.position.set(p.x - ctx.origin.origin.x, p.y - ctx.origin.origin.y, p.z - ctx.origin.origin.z);
    }
  }

  dispose() {
    for (const line of this.lines.values()) {
      line.geometry.dispose();
      line.material.dispose();
    }
    this.lines.clear();
  }
}

function tintFor(body) {
  return body.type === 'moon' || body.type === 'comet'
    ? '#7fa8d0'
    : body.type === 'dwarf'
      ? '#a98fd8'
      : '#5f8fd0';
}
