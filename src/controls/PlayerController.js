import * as THREE from 'three';
import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';
import { clamp, damp, DEG } from '../util/math.js';
import { bodyById } from '../data/bodies.js';

/**
 * The player.
 *
 * Three modes share one continuous position:
 *   flight — you are a ship in space; full six degrees of freedom
 *   focus  — you orbit a body and inspect it
 *   surface— you are standing on a body (handled by SurfaceScene, which
 *            borrows this class's input state)
 *
 * Position is absolute render space. The camera itself never moves: it sits at
 * the origin and the world is rebased around it every frame, which is what
 * keeps float32 transforms precise out at Neptune.
 *
 * Flight is deliberately arcade-like. An honest 30 km/s is imperceptible
 * across a system this size, so speeds are in render units with a governor that
 * slows you down as you approach something: fast enough to cross 4.5 billion km
 * in half a minute, slow enough to dock with a moon.
 */

const CRUISE = 34; // units/second
const BOOST = 320;
const DASH = 1900;
const BRAKE = 6;
const ACCEL = 5.6; // exponential approach rate

export class PlayerController {
  constructor(engine, scale, orbital, solar) {
    this.name = 'player';
    this.priority = -50; // after mechanics, before the world reads positions
    this.engine = engine;
    this.scale = scale;
    this.orbital = orbital;
    this.solar = solar;

    this.mode = 'flight';
    /** Absolute position in render units. */
    this.position = new THREE.Vector3(140, 40, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.throttle = 0; // -1 .. 1
    this.dashing = 0;
    this.dashCooldown = 0;

    /** Body currently being orbited in focus mode. */
    this.focusId = null;
    this.focusDistance = 30;
    this.focusYaw = 0;
    this.focusPitch = 0.35;

    /** Set when the hull is close enough to a surface to land. */
    this.landingCandidate = null;
    this.collisionWarning = null;
    this.speedReadout = 0;

    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, dragging: false };
    this.locked = false;
    this._warp = null;

    this._bindInput();
  }

  // ------------------------------------------------------------------ input --

  _bindInput() {
    const canvas = this.engine.renderer.domElement;

    this._onKeyDown = (e) => {
      // Never swallow browser or assistive-tech shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.code;
      if (MOVEMENT_KEYS.has(k) || k === 'Space') e.preventDefault();
      if (k === 'Escape') this.releasePointer();
      if (e.repeat) return;
      this.keys.add(k);
      this._handleAction(k);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());

    // Pointer lock for FPS-style looking, drag-to-look when unlocked.
    this._onMouseMove = (e) => {
      if (!this.locked && !this.mouse.dragging) return;
      const s = 0.0022 * settings.get('mouseSensitivity');
      this.mouse.dx += e.movementX ? e.movementX * s : 0;
      this.mouse.dy += e.movementY ? e.movementY * s : 0;
    };
    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (settings.get('pointerLock') !== false && !this.locked && this.mode !== 'surface') {
        canvas.requestPointerLock?.();
      } else {
        this.mouse.dragging = true;
      }
    };
    this._onMouseUp = () => {
      this.mouse.dragging = false;
    };
    this._onPointerLockChange = () => {
      this.locked = document.pointerLockElement === canvas;
      bus.emit('player:pointerlock', this.locked);
    };

    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    // Speed control with the wheel.
    this._onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      if (this.mode === 'focus') {
        this.zoomFocus(e.deltaY > 0 ? 1.15 : 0.87);
      } else {
        this.speedMultiplier = clamp((this.speedMultiplier ?? 1) * factor, 0.05, 12);
        bus.emit('player:speed', this.speedMultiplier);
      }
    };
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _handleAction(code) {
    if (code === 'KeyX') this.dash();
    if (code === 'KeyG') bus.emit('ui:toggle-settings');
    if (code === 'KeyH') bus.emit('ui:toggle-hud');
    if (code === 'KeyM') bus.emit('ui:toggle-map');
    if (code === 'KeyT') bus.emit('ui:toggle-tour');
    if (code === 'KeyP') bus.emit('ui:toggle-pause');
    if (code === 'Slash') bus.emit('ui:toggle-help');
    // F is 'fly up', so landing is L on its own.
    if (code === 'KeyL') this.tryLandOrLaunch();
    if (code === 'Digit1') this.setTimeScale(1);
    if (code === 'Digit2') this.setTimeScale(30);
    if (code === 'Digit3') this.setTimeScale(365);
    if (code === 'Equal') this.setTimeScale(null, 2);
    if (code === 'Minus') this.setTimeScale(null, 0.5);
  }

  setTimeScale(absolute, factor) {
    const next = absolute ?? settings.get('timeScale') * factor;
    settings.set('timeScale', clamp(next, 0.001, 5 * 365));
    bus.emit('ui:timescale', settings.get('timeScale'));
  }

  releasePointer() {
    if (this.locked) document.exitPointerLock?.();
  }

  // -------------------------------------------------------------- movement --

  /** The speed governor: how fast can we fly right now, in units/second? */
  currentSpeed() {
    const boost = this.keys.has('Space') ? BOOST : CRUISE;
    const dash = this.dashing > 0 ? DASH * (this.dashing / 0.55) : 0;
    return (boost + dash) * (this.speedMultiplier ?? 1);
  }

  dash() {
    if (this.dashCooldown > 0) return;
    this.dashing = 0.55;
    this.dashCooldown = 1.4;
    bus.emit('player:dash', { position: this.position.clone() });
  }

  update(dt, ctx) {
    // While landed, SurfaceScene owns the camera and reads the mouse deltas
    // itself. Consuming them here would leave the surface view frozen.
    if (this.mode === 'surface') {
      this.dashCooldown = Math.max(0, this.dashCooldown - dt);
      this.dashing = Math.max(0, this.dashing - dt);
      return;
    }

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashing = Math.max(0, this.dashing - dt);

    if (this._warp) this._updateWarp(dt);

    if (this.mode === 'focus') this._updateFocus(dt);
    else if (this.mode !== 'surface') this._updateFlight(dt);

    // Apply look input (shared by every mode; SurfaceScene reads it too).
    this._applyLook(dt);

    // The camera is pinned to the origin; the world rebases around it.
    ctx.origin.set(this.position.x, this.position.y, this.position.z);
    this.engine.camera.quaternion.copy(this._orientation());
  }

  _updateFlight(dt) {
    const k = this.keys;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const lift = (k.has('KeyR') ? 1 : 0) - (k.has('KeyF') ? 1 : 0);

    // Arrow keys look instead of moving; keep them out of translation.
    const useArrows = settings.get('arrowKeysLook') !== false;
    const fwd = useArrows ? (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) : forward;
    const str = useArrows ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : strafe;

    this.throttle = damp(this.throttle, fwd, 8, dt);

    // Q/E roll the ship, which is how you actually line up a landing.
    const rollRate = ((k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)) * 1.5;
    this.roll = clamp(this.roll - rollRate * dt, -Math.PI, Math.PI);
    if (rollRate === 0) this.roll = damp(this.roll, 0, 1.2, dt);

    const q = this._orientation();
    _fwd.set(0, 0, -1).applyQuaternion(q);
    _right.set(1, 0, 0).applyQuaternion(q);
    _up.set(0, 1, 0).applyQuaternion(q);

    // Braking: Shift or Z bleeds speed rather than reversing.
    const braking = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyZ');

    _desired.set(0, 0, 0);
    if (fwd !== 0) _desired.addScaledVector(_fwd, fwd);
    if (str !== 0) _desired.addScaledVector(_right, str);
    if (lift !== 0) _desired.addScaledVector(_up, lift);

    let targetSpeed = this.currentSpeed();
    // Nothing held, or braking: coast to a stop.
    if (_desired.lengthSq() === 0 || braking) targetSpeed = braking ? BRAKE : 0;
    if (_desired.lengthSq() > 0) _desired.normalize();

    _targetVel.copy(_desired).multiplyScalar(targetSpeed);
    // Exponential approach gives snappy starts and a soft stop.
    const rate = _desired.lengthSq() > 0 ? ACCEL : 2.4;
    this.velocity.x = damp(this.velocity.x, _targetVel.x, rate, dt);
    this.velocity.y = damp(this.velocity.y, _targetVel.y, rate, dt);
    this.velocity.z = damp(this.velocity.z, _targetVel.z, rate, dt);
    // Momentum from a dash decays on its own.
    if (this.dashing > 0) this.velocity.addScaledVector(_fwd, DASH * 0.6 * dt);

    this.position.addScaledVector(this.velocity, dt);
    this.speedReadout = this.velocity.length();

    this._collideAndPrompt(dt);
  }

  _updateFocus(dt) {
    const target = this.solar.positionOf(this.focusId);
    if (!target) {
      this.mode = 'flight';
      return;
    }
    // Orbit the target; the wheel controls how far out we sit.
    const r = this.focusDistance;
    const cp = Math.cos(this.focusPitch);
    _orbit.set(
      target.x + Math.sin(this.focusYaw) * cp * r,
      target.y + Math.sin(this.focusPitch) * r + r * 0.1,
      target.z + Math.cos(this.focusYaw) * cp * r
    );
    this.position.copy(_orbit);
    // Aim at the body's centre.
    _look.copy(target).sub(this.position);
    this._lookAtVector(_look);
    this.speedReadout = 0;
  }

  _applyLook(dt) {
    const sens = 1;
    let dx = this.mouse.dx * sens;
    let dy = this.mouse.dy * sens;
    this.mouse.dx = 0;
    this.mouse.dy = 0;

    if (this.mode === 'focus') {
      // In focus mode the cursor orbits the subject.
      this.focusYaw += dx * 1.6;
      this.focusPitch = clamp(this.focusPitch - dy * 1.6, -1.45, 1.45);
      this.focusDistance = clamp(this.focusDistance, 0.5, 5000);
      this.yaw = 0;
      this.pitch = 0;
      return;
    }

    const arrowLook = settings.get('arrowKeysLook') !== false;
    if (arrowLook) {
      const keyRate = 1.9 * dt;
      if (this.keys.has('ArrowLeft')) dx = keyRate;
      if (this.keys.has('ArrowRight')) dx = -keyRate;
      if (this.keys.has('ArrowUp')) dy = keyRate;
      if (this.keys.has('ArrowDown')) dy = -keyRate;
    }
    const invert = settings.get('invertY') ? -1 : 1;
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy * invert, -1.5533, 1.5533);
  }

  /** Zoom in focus mode, from the wheel. */
  zoomFocus(factor) {
    this.focusDistance = clamp(this.focusDistance * factor, 0.4, 20000);
  }

  _lookAtVector(dir) {
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.asin(clamp(dir.clone().normalize().y, -1, 1));
    this.yaw = yaw;
    this.pitch = pitch;
  }

  _orientation() {
    _euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
    return _quat.setFromEuler(_euler);
  }

  // ----------------------------------------------------------- collisions ---

  _collideAndPrompt(dt) {
    this.landingCandidate = null;
    this.collisionWarning = null;
    const nearest = this.solar.nearestBodyTo(this.position, Infinity);
    if (!nearest) return;
    const { body, distance } = nearest;
    const radiusUnits = this.solar.bodies.get(body.id)?.radiusUnits ?? 1;
    const altitude = distance;

    if (altitude < radiusUnits * 3.2) {
      this.landingCandidate = { def: body, altitudeUnits: altitude, radiusUnits };
      bus.emit('player:approach', this.landingCandidate);
    }

    // A hard stop just above the surface: you bounce, you don't clip through.
    if (altitude < radiusUnits * 0.12) {
      const p = this.solar.positionOf(body.id);
      _normal.set(this.position.x - p.x, this.position.y - p.y, this.position.z - p.z).normalize();
      const minDist = radiusUnits * 1.02;
      this.position.set(
        p.x + _normal.x * minDist,
        p.y + _normal.y * minDist,
        p.z + _normal.z * minDist
      );
      // Reflect and damp: a bump, not a wall.
      const vn = this.velocity.dot(_normal);
      if (vn < 0) this.velocity.addScaledVector(_normal, -vn * 1.35);
      this.velocity.multiplyScalar(0.35);
      this.collisionWarning = body;
      bus.emit('player:collision', { body, speed: Math.abs(vn) });
    }
  }

  // ------------------------------------------------------------- transitions -

  /** Warp to a body: used by the UI, the tour, and the double-press of F. */
  warpTo(id, extraDistance = 2.6) {
    const target = this.solar.positionOf(id);
    const body = this.solar.bodies.get(id);
    if (!target || !body) return;
    this.focusId = id;
    const standoff = Math.max(body.radiusUnits * extraDistance, body.radiusUnits + 0.35);
    // Come in from wherever we already are, so the arrival feels continuous.
    _normal.copy(this.position).sub(target);
    if (_normal.lengthSq() < 1e-6) _normal.set(0.4, 0.25, 1);
    _normal.normalize();
    this._warp = {
      from: this.position.clone(),
      to: target.clone().addScaledVector(_normal, standoff),
      t: 0,
      duration: settings.get('reducedMotion') ? 0.15 : 0.85,
      id,
    };
    bus.emit('player:warp-start', { id, body: body.def });
  }

  _updateWarp(dt) {
    const w = this._warp;
    // The target keeps moving while we travel, so track it.
    const live = this.solar.positionOf(w.id);
    if (live) {
      const body = this.solar.bodies.get(w.id);
      const standoff = Math.max((body?.radiusUnits ?? 1) * 2.6, 0.35);
      _normal.copy(w.to).sub(live).normalize();
      w.to.copy(live).addScaledVector(_normal, standoff);
    }
    w.t = Math.min(1, w.t + dt / w.duration);
    const e = w.t * w.t * (3 - 2 * w.t);
    this.position.lerpVectors(w.from, w.to, e);
    this.velocity.multiplyScalar(0.85);
    // Face the destination on arrival.
    if (live) this._lookAtVector(_look.copy(live).sub(this.position));
    if (w.t >= 1) {
      this._warp = null;
      bus.emit('player:warp-end', { id: w.id });
    }
  }

  /** Focus a body without moving (used when clicking a list entry). */
  focusOn(id, distance = null) {
    const body = this.solar.bodies.get(id);
    if (!body) return;
    this.focusId = id;
    this.focusDistance = distance ?? Math.max(body.radiusUnits * 4.5, 0.8);
    this.mode = 'focus';
    this.velocity.set(0, 0, 0);
    // Start looking at the body from a consistent, flattering angle.
    this.focusYaw = 0.6;
    this.focusPitch = 0.32;
    bus.emit('player:focus', { id, def: body.def });
  }

  /** Leave focus mode and drop into free flight, keeping the current view. */
  releaseFocus() {
    if (this.mode !== 'focus') return;
    this.mode = 'flight';
    this.yaw = this.focusYaw + Math.PI;
    this.pitch = this.focusPitch;
    this.velocity.set(0, 0, 0);
  }

  /**
   * Land, or launch if we are already on the ground. The actual scene swap is
   * done by SurfaceScene; this only decides whether it is allowed.
   */
  tryLandOrLaunch() {
    if (this.mode === 'surface') {
      bus.emit('surface:launch-request');
      return;
    }
    if (this.mode === 'focus' && settings.get('focusLanding') !== false) {
      // In focus mode, pressing F means "take me down there".
      bus.emit('surface:landing-request', { id: this.focusId, body: bodyById.get(this.focusId) });
      return;
    }
    const c = this.landingCandidate;
    if (!c) {
      bus.emit('ui:notice', { text: 'Nothing in range to land on. Fly closer to a world, then press F.' });
      return;
    }
    bus.emit('surface:landing-request', { id: c.def.id, body: c.def });
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    this.engine.renderer.domElement.removeEventListener('wheel', this._onWheel);
  }
}

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyZ', 'KeyX',
]);

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _targetVel = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _orbit = new THREE.Vector3();
const _look = new THREE.Vector3();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
