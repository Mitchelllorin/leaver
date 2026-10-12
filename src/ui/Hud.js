import * as THREE from 'three';
import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';
import { bodyById, TYPE_COLORS } from '../data/bodies.js';
import {
  formatDistance,
  formatSpeed,
  j2000ToDate,
  clamp,
} from '../util/math.js';

/**
 * The head-up display.
 *
 * Text is refreshed a few times a second rather than every frame: DOM writes
 * are far more expensive than the maths, and a distance readout updating 60
 * times a second is unreadable anyway.
 *
 * Every value shown here also exists as text content in the DOM, so a screen
 * reader user gets the same situational awareness as a sighted one.
 */
const TEXT_INTERVAL = 0.12; // seconds
const LABEL_INTERVAL = 1 / 30;

export class Hud {
  constructor(root, { solar, orbital, scale, player, announcer }) {
    this.solar = solar;
    this.orbital = orbital;
    this.scale = scale;
    this.player = player;
    this.announcer = announcer;
    this.root = root;
    this._t = 0;
    this._labelT = 0;
    this._lastNotice = '';
    this._labels = new Map();
    this.visible = true;
    this._build();
    this._wire();
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="ticker" id="hud-ticker" aria-hidden="true"></div>

      <div class="hud-block hud-top-left">
        <div class="hud-row">
          <span class="hud-label">Target</span>
          <div class="hud-value big" id="hud-target">Free flight</div>
          <div class="hud-sub" id="hud-target-sub">Nothing selected</div>
        </div>
        <div class="hud-row">
          <span class="hud-label">Distance</span>
          <div class="hud-value" id="hud-distance">—</div>
          <div class="hud-sub" id="hud-altitude"></div>
        </div>
      </div>

      <div class="hud-block hud-top-right">
        <div class="hud-row">
          <span class="hud-label">Simulated date</span>
          <div class="hud-value" id="hud-date">—</div>
        </div>
        <div class="hud-row">
          <span class="hud-label">Time scale</span>
          <div class="hud-value" id="hud-time">1 s / s</div>
        </div>
        <div class="hud-row">
          <span class="hud-label">Scale mode</span>
          <div class="hud-value" id="hud-scale">Explore</div>
          <div class="hud-sub" id="hud-scale-sub"></div>
        </div>
      </div>

      <div class="hud-block hud-bottom-left">
        <div class="hud-row">
          <span class="hud-label">Speed</span>
          <div class="hud-value" id="hud-speed">0 km/s</div>
          <div class="throttle"><span id="hud-throttle"></span></div>
        </div>
        <div class="hud-row">
          <span class="hud-label">Crew status</span>
          <div class="hud-sub" id="hud-status">Nominal</div>
        </div>
      </div>

      <div class="hud-block hud-bottom-right" id="hud-events-block">
        <span class="hud-label">Happening now</span>
        <div id="hud-events" class="hud-sub">All quiet in the solar system.</div>
      </div>

      <div class="crosshair" id="hud-crosshair" aria-hidden="true"><span class="dot"></span></div>
      <div class="labels" id="hud-labels" aria-hidden="true"></div>
      <div class="notices" id="hud-notices"></div>
    `;
    this.root.appendChild(el);
    this.el = el;

    // A permanent, always-reachable pair of controls. Without these, hiding the
    // HUD on a touchscreen would leave nothing to tap at all.
    this.rail = document.createElement('div');
    this.rail.className = 'rail';
    this.rail.innerHTML = `
      <button class="rail-btn" data-rail="menu" aria-haspopup="dialog" aria-expanded="false"
              title="Worlds list (M)" aria-label="Open the worlds list">&#9776;</button>
      <button class="rail-btn" data-rail="hud" aria-pressed="true"
              title="Show or hide the interface (H)" aria-label="Show or hide the interface">&#9707;</button>
      <button class="rail-btn" data-rail="help" aria-haspopup="dialog" aria-expanded="false"
              title="Controls and credits (/)" aria-label="Open the controls help">?</button>
    `;
    this.root.appendChild(this.rail);
    this.rail.querySelector('[data-rail="hud"]').addEventListener('click', () => this.toggle());
    this.rail.querySelector('[data-rail="menu"]').addEventListener('click', () => {
      bus.emit('ui:toggle-map');
    });
    this.rail.querySelector('[data-rail="help"]').addEventListener('click', () => {
      bus.emit('ui:toggle-help');
    });

    const q = (id) => el.querySelector(`#${id}`);
    this.nodes = {
      target: q('hud-target'),
      targetSub: q('hud-target-sub'),
      distance: q('hud-distance'),
      altitude: q('hud-altitude'),
      date: q('hud-date'),
      time: q('hud-time'),
      scale: q('hud-scale'),
      scaleSub: q('hud-scale-sub'),
      speed: q('hud-speed'),
      throttle: q('hud-throttle'),
      status: q('hud-status'),
      events: q('hud-events'),
      eventsBlock: q('hud-events-block'),
      crosshair: q('hud-crosshair'),
      labels: q('hud-labels'),
      notices: q('hud-notices'),
      ticker: q('hud-ticker'),
    };
  }

  _wire() {
    this._unsubs = [
      bus.on('ui:notice', (n) => this.notice(n)),
      bus.on('event:started', (e) => {
        this.notice({
          title: e.name,
          text: e.detail ? `${e.detail} ${e.blurb}` : e.blurb,
          kind: e.severity === 'catastrophic' ? 'danger' : 'warm',
          announce: true,
          duration: 12,
        });
      }),
      bus.on('player:collision', ({ body, speed }) => {
        this.notice({
          title: `Hull contact with ${body.name}`,
          text: `Impact at ${speed.toFixed(1)} km-equivalent units per second. Attitude thrusters recovered.`,
          kind: 'danger',
          duration: 5,
        });
      }),
      bus.on('event:sub', (e) => {
        this.notice({
          title: e.name,
          text: e.blurb,
          kind: 'warm',
          duration: 12,
          announce: true,
        });
      }),
      bus.on('surface:crushed', (e) => {
        this.notice({
          title: `Hull crushed in ${e.name}\u2019s atmosphere`,
          text: `Pressure exceeded tolerance at ${e.depth} km. Atmospheric pressure at this depth is roughly ${e.pressure}. Returning you to orbit.`,
          kind: 'danger',
          duration: 12,
          announce: true,
        });
        setTimeout(() => bus.emit('surface:launch-request'), 2600);
      }),
      bus.on('surface:entered', (e) => {
        if (e.kind !== 'gas') return;
        this.notice({
          title: `Descending into ${e.name}`,
          text: 'There is no surface here. Hold W to sink, S to climb, and watch the depth gauge. You will be crushed eventually.',
          kind: 'warm',
          duration: 10,
          announce: true,
        });
      }),
      bus.on('ui:toggle-hud', () => this.toggle()),
      bus.on('settings:change', () => this.applySettings()),
      bus.on('ui:panels-changed', ({ name }) => {
        for (const [key, id] of [['menu', 'worlds'], ['help', 'help']]) {
          this.rail
            .querySelector(`[data-rail="${key}"]`)
            .setAttribute('aria-expanded', name === id ? 'true' : 'false');
        }
      }),
    ];
    this.applySettings();
  }

  applySettings() {
    this.el.style.setProperty('--hud-scale', String(settings.get('hudScale') ?? 1));
    this.nodes.labels.style.display = settings.get('labels') ? '' : 'none';
    this.el.classList.toggle('is-compact', this.compact);
    this._syncEventsBlock();
  }

  /** 'auto' keeps the interface small on small or coarse-pointer screens. */
  get compact() {
    const mode = settings.get('hudDetail') ?? 'auto';
    if (mode === 'compact') return true;
    if (mode === 'full') return false;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return coarse || window.innerWidth < 900 || window.innerHeight < 620;
  }

  _syncEventsBlock() {
    if (settings.get('eventFeed') === false) {
      this.nodes.eventsBlock.style.display = 'none';
      return;
    }
    // An empty "all quiet" box is just another panel in the way.
    this.nodes.eventsBlock.style.display = this._hasEvents ? '' : 'none';
  }

  toggle(force) {
    this.visible = force ?? !this.visible;
    this.el.classList.toggle('is-hidden', !this.visible);
    document.body.classList.toggle('hud-hidden', !this.visible);
    this.announcer.politely(this.visible ? 'Head-up display shown.' : 'Head-up display hidden.');
  }

  /** Transient toast. Also announced if it carries new information. */
  notice({ title, text, kind = 'info', duration = 7, announce = false }) {
    const node = document.createElement('div');
    node.className = `notice is-${kind}`;
    node.innerHTML = `<strong></strong><p></p>`;
    node.querySelector('strong').textContent = title;
    node.querySelector('p').textContent = text;
    this.nodes.notices.appendChild(node);

    // Keep the stack short. Four toasts at boot covered the middle of the
    // screen, which is precisely the area the user wants to look at.
    while (this.nodes.notices.children.length > 2) {
      this.nodes.notices.firstChild.remove();
    }
    if (announce) this.announcer.politely(`${title}. ${text}`);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity 400ms';
      setTimeout(() => node.remove(), 400);
    }, duration * 1000);
  }

  /** Real distance in km between the player and a body, plus altitude. */
  realDistance(id) {
    const km = this.orbital.get(id);
    if (!km) return null;
    const p = this.player.position;
    const r = p.length();
    if (r < 1e-9) return Math.hypot(km.x, km.y, km.z);
    // Undo the radial compression to recover the player's real heliocentric
    // distance, then measure in real kilometres.
    const kmR = this.scale.distanceInverse(r);
    const k = kmR / r;
    return Math.hypot(km.x - p.x * k, km.y - p.y * k, km.z - p.z * k);
  }

  update(dt, ctx) {
    if (!this.visible) return;
    this._t += dt;
    this._labelT += dt;

    if (this._labelT >= LABEL_INTERVAL) {
      this._labelT = 0;
      this.updateLabels(ctx);
    }
    if (this._t < TEXT_INTERVAL) return;
    this._t = 0;
    this._updateText(ctx);
  }

  _updateText(ctx) {
    const n = this.nodes;
    const p = this.player;

    // -- target -------------------------------------------------------------
    const focusId = p.mode === 'focus' ? p.focusId : p.landingCandidate?.def.id ?? p.focusId;
    const def = focusId ? bodyById.get(focusId) : null;
    // With nothing selected there is nothing to report: hide the block rather
    // than dedicating a corner of the screen to the words "free flight".
    const targetBlock = n.target.closest('.hud-block');
    if (targetBlock) targetBlock.style.display = def ? '' : 'none';
    if (def) {
      n.target.textContent = def.name;
      n.targetSub.textContent = def.radiusKm
        ? `${def.type} · radius ${def.radiusKm.toLocaleString()} km`
        : def.type;
    }

    // -- distance and altitude ---------------------------------------------
    if (def) {
      const km = this.realDistance(def.id);
      if (km !== null) {
        n.distance.textContent = formatDistance(km, settings.get('units'));
        const alt = km - def.radiusKm;
        n.altitude.textContent =
          alt > 0
            ? `${formatDistance(alt, settings.get('units'))} above the surface`
            : 'Below the surface radius';
      }
    } else {
      const kmR = this.scale.distanceInverse(p.position.length());
      n.distance.textContent = `${formatDistance(kmR, settings.get('units'))} from the Sun`;
      n.altitude.textContent = '';
    }

    // -- clock --------------------------------------------------------------
    const date = j2000ToDate(ctx?.engine?.simTime ?? 0);
    n.date.textContent = date.toISOString().slice(0, 10);
    const ts = settings.get('timeScale');
    n.time.textContent = describeTimeScale(ts, settings.get('paused'));

    // -- scale mode ---------------------------------------------------------
    const blend = this.scale.blend;
    n.scale.textContent = blend < 0.02 ? 'Explore' : blend > 0.98 ? 'True scale' : 'Blending';
    n.scaleSub.textContent =
      blend < 0.02
        ? 'Distances compressed so the system fits your screen'
        : blend > 0.98
          ? '1 unit = 1,000 km. This is the real, mostly-empty thing.'
          : `${Math.round(blend * 100)}% of the way to true scale`;

    // -- speed --------------------------------------------------------------
    const speedKmS = this.speedKmS();
    n.speed.textContent = formatSpeed(speedKmS, settings.get('units'));
    const throttle = clamp(p.velocity.length() / Math.max(p.currentSpeed(), 1e-6), 0, 1);
    n.throttle.style.width = `${(throttle * 100).toFixed(1)}%`;

    // -- status -------------------------------------------------------------
    const c = p.landingCandidate;
    if (p.mode === 'surface') {
      n.status.textContent = 'On the surface';
    } else if (c) {
      n.status.innerHTML = `<span class="hud-good">Landing corridor open — press L to land on ${escapeHtml(c.def.name)}</span>`;
    } else if (p.dashing > 0) {
      n.status.innerHTML = '<span class="hud-warm">Dashing</span>';
    } else if (p.dashCooldown > 0) {
      n.status.textContent = `Dash recharging (${p.dashCooldown.toFixed(1)}s)`;
    } else {
      n.status.textContent = 'Nominal';
    }
    n.crosshair.classList.toggle('is-target', !!c);
    n.crosshair.classList.toggle('is-danger', !!p.collisionWarning);
  }

  /** The player's speed in real km/s, inverting the distance compression. */
  speedKmS() {
    const p = this.player.position;
    const v = this.player.velocity;
    const r = p.length();
    if (r < 1e-9) return 0;
    // Local scale: how many real km one render unit is here.
    const kmPerUnit = this.scale.distanceInverse(r + v.length()) - this.scale.distanceInverse(r);
    const local = Math.max(kmPerUnit, 0);
    return v.length() * (local > 0 ? local : this.scale.localScaleAt(this.scale.distanceInverse(r)) ** -1);
  }

  /** Project every body into screen space and place its label. */
  updateLabels(ctx) {
    if (!settings.get('labels')) return;
    const camera = ctx.camera;
    const origin = ctx.origin.origin;
    const seen = new Set();

    for (const [id, body] of this.solar.bodies) {
      const p = this.solar.positionOf(id);
      if (!p) continue;
      _v.set(p.x - origin.x, p.y - origin.y, p.z - origin.z);
      const dist = _v.length();
      const radius = body.radiusUnits;

      // Only label things that are close enough to matter or big on screen.
      const apparent = (radius / Math.max(dist, 1e-6)) * (window.innerHeight / Math.tan((camera.fov * Math.PI) / 360));
      if (apparent < 1.6) {
        this._hideLabel(id);
        continue;
      }
      _v.project(camera);
      if (_v.z > 1) {
        this._hideLabel(id);
        continue;
      }

      const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;

      let node = this._labels.get(id);
      if (!node) {
        node = document.createElement('div');
        node.className = `label${body.def.type === 'moon' ? ' is-moon' : ''}`;
        node.style.color = TYPE_COLORS[body.def.type] ?? TYPE_COLORS.planet;
        node.innerHTML = `<span class="name"></span><span class="distance"></span>`;
        node.querySelector('.name').textContent = body.def.name;
        this.nodes.labels.appendChild(node);
        this._labels.set(id, node);
      }
      node.style.left = `${x.toFixed(0)}px`;
      node.style.top = `${y.toFixed(0)}px`;
      node.querySelector('.distance').textContent =
        dist < 1e4 ? formatDistance(this.realDistance(id) ?? 0, settings.get('units')) : '';
      node.classList.add('is-visible');
      seen.add(id);
    }

    for (const id of this._labels.keys()) {
      if (!seen.has(id)) this._hideLabel(id);
    }
  }

  _hideLabel(id) {
    const node = this._labels.get(id);
    if (node) node.classList.remove('is-visible');
  }

  /** Show the running events in the ticker and the feed. */
  updateEvents(events) {
    const names = events.activeNames();
    const ticker = this.nodes.ticker;
    if (names.length === 0) {
      ticker.innerHTML = '';
    } else {
      ticker.innerHTML = names
        .map((n) => `<span class="chip is-live">${escapeHtml(n)}</span>`)
        .join('');
      // Announce each new phenomenon once.
      const key = names.join('|');
      if (key !== this._lastNotice) {
        this._lastNotice = key;
      }
    }
    // One line, not three: the feed is a nudge, not a log to read mid-flight.
    const recent = events.log.slice(0, 1);
    this._hasEvents = recent.length > 0;
    this.nodes.events.innerHTML = recent
      .map(
        (e) =>
          `<div><strong style="color:var(--text)">${escapeHtml(e.name)}</strong>${e.detail ? ` — ${escapeHtml(e.detail)}` : ''}</div>`
      )
      .join('');
    this._syncEventsBlock();
  }

  dispose() {
    for (const un of this._unsubs) un();
    this.el.remove();
    this.rail.remove();
  }
}

export function describeTimeScale(ts, paused) {
  if (paused) return 'Paused';
  if (ts < 1) return `${(ts * 24).toFixed(1)} hours pass per second`;
  if (ts < 30) return `${ts.toFixed(1)} days per second`;
  if (ts < 400) return `${(ts / 30.44).toFixed(1)} months per second`;
  return `${(ts / 365.25).toFixed(2)} years per second`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

const _v = new THREE.Vector3();
