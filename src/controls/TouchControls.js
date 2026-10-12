import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';
import { clamp } from '../util/math.js';

/**
 * Two-finger flight.
 *
 * One thumb drives, one thumb looks — with no on-screen furniture required to
 * tell them apart, because which is which is decided by where the finger lands:
 *
 *   a touch starting on the left  ->  the drive stick (anchored where you put it)
 *   a touch starting anywhere else ->  look
 *   a second touch while either is taken ->  whichever role is still free
 *
 * The stick is dynamic rather than a fixed pad. You do not have to find a
 * specific spot on the glass, which matters because you cannot see your thumbs.
 *
 * Look input is written into `player.mouse`, the same place the mouse writes,
 * and movement goes into `player.touchMove`. That means flight *and* the
 * surface walker both support touch with no special cases: they already read
 * those two inputs.
 *
 * Multi-touch is why the action buttons take a third finger rather than being
 * part of the stick — pressing boost must not interrupt steering.
 */

const LOOK_SENSITIVITY = 0.0042;
const STICK_MAX = 58; // px of travel for full deflection
const DRIVE_ZONE = 0.42; // left-hand fraction of the screen owned by the stick

export class TouchControls {
  /**
   * @param {THREE.WebGLRenderer} renderer used for the input surface
   * @param {import('./PlayerController.js').PlayerController} player
   * @param {{ root: HTMLElement }} opts
   */
  constructor(engine, player, { root }) {
    this.player = player;
    this.root = root;
    this.enabled = false;
    this.active = false; // has this device ever sent a touch event?
    this._look = null;
    this._move = null;
    this._hintTimer = null;

    this._build();
    this._bind();
    this.applySettings();
    this._unsub = bus.on('settings:change', (e) => {
      if (e.key === 'touchControls' || e.key === '*') this.applySettings();
    });
  }

  _build() {
    const layer = document.createElement('div');
    layer.className = 'touch-layer';
    layer.hidden = true;
    layer.innerHTML = `
      <div class="stick" id="touch-stick" aria-hidden="true"><span class="knob"></span></div>
      <div class="touch-hint" id="touch-hint">Left thumb to drive &middot; right thumb to look</div>
      <div class="touch-actions">
        <button class="touch-btn" data-touch="dash" aria-label="Dash">Dash</button>
        <button class="touch-btn" data-touch="land" aria-label="Land on the nearest world" hidden>Land</button>
        <button class="touch-btn big" data-touch="boost" aria-label="Hold to boost">Boost</button>
      </div>
    `;
    this.root.appendChild(layer);
    this.layer = layer;
    this.stick = layer.querySelector('#touch-stick');
    this.knob = layer.querySelector('#touch-stick .knob');
    this.hint = layer.querySelector('#touch-hint');
    this.landBtn = layer.querySelector('[data-touch="land"]');

    // Boost is a hold, dash is a tap, land is a tap.
    const boost = layer.querySelector('[data-touch="boost"]');
    const press = (on) => {
      player_setBoost(this.player, on);
      boost.classList.toggle('is-held', on);
    };
    boost.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press(true);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      boost.addEventListener(type, () => press(false));
    }
    layer.querySelector('[data-touch="dash"]').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.player.dash();
    });
    this.landBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.player.tryLandOrLaunch();
    });
  }

  _bind() {
    const canvas = this.engineSurface();
    this._canvas = canvas;
    this._onStart = (e) => {
      this._noteTouch();
      for (const touch of e.changedTouches) this._begin(touch);
      if (e.cancelable) e.preventDefault();
    };
    this._onMove = (e) => {
      for (const touch of e.changedTouches) this._move2(touch);
      if (e.cancelable) e.preventDefault();
    };
    this._onEnd = (e) => {
      for (const touch of e.changedTouches) this._end(touch);
    };
    canvas.addEventListener('touchstart', this._onStart, { passive: false });
    canvas.addEventListener('touchmove', this._onMove, { passive: false });
    canvas.addEventListener('touchend', this._onEnd);
    canvas.addEventListener('touchcancel', this._onEnd);
  }

  engineSurface() {
    // The canvas is found lazily: this class is constructed before the renderer
    // exists in some orderings, and by id is simplest and honest.
    return document.getElementById('viewport') ?? document.body;
  }

  /** First real touch event switches the whole input model over. */
  _noteTouch() {
    if (!this.active) {
      this.active = true;
      this.player.usingTouch = true;
      this.layer.hidden = !settings.get('touchControls');
      this._showHint();
    }
  }

  _showHint() {
    clearTimeout(this._hintTimer);
    this.hint.classList.remove('is-gone');
    this._hintTimer = setTimeout(() => this.hint.classList.add('is-gone'), 5200);
  }

  _begin(touch) {
    const x = touch.clientX;
    const y = touch.clientY;
    const onLeft = x < window.innerWidth * DRIVE_ZONE;
    // Left thumb drives; anything else looks; if a role is taken, take the other.
    if (onLeft && !this._move) this._startMove(touch);
    else if (!this._look) this._startLook(touch);
    else if (!this._move) this._startMove(touch);
  }

  _startLook(touch) {
    this._look = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
  }

  _startMove(touch) {
    this._move = {
      id: touch.identifier,
      originX: touch.clientX,
      originY: touch.clientY,
      x: touch.clientX,
      y: touch.clientY,
    };
    this.stick.style.left = `${touch.clientX}px`;
    this.stick.style.top = `${touch.clientY}px`;
    this.stick.classList.add('is-live');
  }

  /** Named without an underscore clash with the class field of the same idea. */
  _move2(touch) {
    if (this._look && touch.identifier === this._look.id) {
      this.player.mouse.dx += (touch.clientX - this._look.x) * LOOK_SENSITIVITY;
      this.player.mouse.dy += (touch.clientY - this._look.y) * LOOK_SENSITIVITY;
      this._look.x = touch.clientX;
      this._look.y = touch.clientY;
      return;
    }
    if (this._move && touch.identifier === this._move.id) {
      this._move.x = touch.clientX;
      this._move.y = touch.clientY;
      let dx = touch.clientX - this._move.originX;
      let dy = touch.clientY - this._move.originY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_MAX) {
        // Clamp the knob to the ring, but keep full deflection.
        dx = (dx / len) * STICK_MAX;
        dy = (dy / len) * STICK_MAX;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // Screen-down is thrust backwards, matching a keyboard's S key.
      this.player.touchMove.x = clamp(dx / STICK_MAX, -1, 1);
      this.player.touchMove.y = clamp(-dy / STICK_MAX, -1, 1);
    }
  }

  _end(touch) {
    if (this._look && touch.identifier === this._look.id) {
      this._look = null;
      return;
    }
    if (this._move && touch.identifier === this._move.id) {
      this._move = null;
      this.player.touchMove.x = 0;
      this.player.touchMove.y = 0;
      this.stick.classList.remove('is-live');
      this.knob.style.transform = '';
    }
  }

  applySettings() {
    const wanted = settings.get('touchControls') !== false;
    // Never show the layer until we know the device has a touchscreen, unless
    // the user has explicitly turned the controls off.
    const visible = wanted && (this.active || isTouchDevice());
    this.layer.hidden = !visible;
    if (visible) this._showHint();
  }

  update() {
    if (!this.active) {
      // Some browsers only report coarse pointers through matchMedia.
      if (isTouchDevice() && !this._probed) {
        this._probed = true;
        this.applySettings();
      }
      return;
    }
    // The land button appears exactly when landing is possible.
    const canLand = this.player.mode === 'surface' || !!this.player.landingCandidate;
    this.landBtn.hidden = !canLand;
    this.landBtn.textContent = this.player.mode === 'surface' ? 'Launch' : 'Land';
  }

  dispose() {
    clearTimeout(this._hintTimer);
    this._unsub();
    const canvas = this._canvas ?? this.engineSurface();
    canvas.removeEventListener('touchstart', this._onStart);
    canvas.removeEventListener('touchmove', this._onMove);
    canvas.removeEventListener('touchend', this._onEnd);
    canvas.removeEventListener('touchcancel', this._onEnd);
    this.layer.remove();
  }
}

export function isTouchDevice() {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

function player_setBoost(player, on) {
  player.touchBoost = on;
}
