import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';
import { bodyById, TYPE_COLORS } from '../data/bodies.js';
import { trapFocus, describeBody } from './a11y.js';
import { formatDistance, formatDays } from '../util/math.js';

/**
 * The reading half of the sim: browsing worlds, reading about them, following
 * a guided tour, and changing how the whole thing behaves.
 *
 * These are real dialogs with real focus management, because the educational
 * payload has to be as reachable as the flying is.
 */

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** Groups worlds the way a museum would: star, then planets with their moons. */
export function groupBodies(solar) {
  const groups = [];
  const sun = solar.bodies.get('sun');
  if (sun) groups.push({ title: 'Star', items: [sun] });

  // Moons hang off whatever their parent is — including dwarf planets, which
  // is why Charon is listed under Pluto rather than disappearing entirely.
  const orbital = solar.orbital;
  const primaries = [];
  const moonsByParent = new Map();
  const smallBodies = [];

  for (const [, body] of solar.bodies) {
    const t = body.def.type;
    if (t === 'moon') {
      if (!moonsByParent.has(body.def.parent)) moonsByParent.set(body.def.parent, []);
      moonsByParent.get(body.def.parent).push(body);
    } else if (t === 'planet') {
      primaries.push(body);
    } else if (t !== 'star') {
      smallBodies.push(body);
    }
  }

  // Order the planets by distance from the Sun, not by size.
  primaries.sort((a, b) => {
    const pa = orbital.get(a.def.id);
    const pb = orbital.get(b.def.id);
    if (!pa || !pb) return 0;
    return Math.hypot(pa.x, pa.y, pa.z) - Math.hypot(pb.x, pb.y, pb.z);
  });

  for (const p of primaries) {
    groups.push({ title: p.def.name, items: [p], moons: moonsByParent.get(p.def.id) ?? [] });
  }

  // Small bodies keep their moons with them rather than in a separate bucket.
  const others = [];
  for (const body of smallBodies) {
    others.push(body);
    for (const moon of moonsByParent.get(body.def.id) ?? []) others.push(moon);
  }
  if (others.length) groups.push({ title: 'Dwarf planets and small bodies', items: others });

  return groups;
}

function shortDistance(km) {
  if (km === null || km === undefined) return '';
  if (km > 1e9) return `${(km / 1.496e8).toFixed(1)} AU`;
  if (km > 1e6) return `${(km / 1e6).toFixed(1)}M km`;
  if (km > 1e3) return `${(km / 1e3).toFixed(0)}k km`;
  return `${Math.round(km)} km`;
}

/**
 * PanelManager — the fix for "I have menus and menus and menus".
 *
 * Every panel routes its visibility through here, which guarantees two things
 * that the first version got wrong:
 *
 *   1. At most ONE panel is open at a time. Previously the tour opened the fact
 *      sheet on top of itself, and warp/orbit called show() directly, so panels
 *      simply piled up.
 *   2. There is always a way out: Escape, or a tap on the 3D view, closes
 *      whatever is open. Both side panels used to have no dismissal at all.
 */
export class PanelManager {
  constructor() {
    /** @type {Array<{show:()=>void, hide:()=>void, isOpen:boolean, panel:HTMLElement}>} */
    this.panels = [];
    /** panel -> short name, so the interface can react to what is open. */
    this.names = new Map();
    this._dismissTargets = [];
    this._onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (this.closeAll()) e.preventDefault();
    };
    this._onPointerDown = (e) => {
      // A press on the scene itself means "get this off my screen".
      if (this.anyOpen) this.closeAll();
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  register(panel, name = panel?.constructor?.name ?? 'panel') {
    if (!this.panels.includes(panel)) this.panels.push(panel);
    this.names.set(panel, name);
    return panel;
  }

  _announce() {
    bus.emit('ui:panels-changed', { name: this.current ? this.names.get(this.current) : null });
  }

  /** Panels that should dismiss on a tap, i.e. the render surface. */
  attachDismissTarget(element) {
    element.addEventListener('pointerdown', this._onPointerDown);
    this._dismissTargets.push(element);
    return () => element.removeEventListener('pointerdown', this._onPointerDown);
  }

  /**
   * Close every panel except `panel`, without calling its show(). Use when a
   * panel needs arguments: `panels.only(info); info.show('mars')`.
   */
  only(panel) {
    for (const p of this.panels) {
      if (p !== panel && p.isOpen) p.hide();
    }
    return panel;
  }

  /** Open one panel, closing any other. */
  open(panel) {
    if (!panel) return null;
    this.only(panel);
    panel.show();
    this._announce();
    return panel;
  }

  toggle(panel) {
    if (!panel) return null;
    if (panel.isOpen) {
      panel.hide();
      this._announce();
      return null;
    }
    return this.open(panel);
  }

  closeAll() {
    let closed = false;
    for (const p of this.panels) {
      if (p.isOpen) {
        p.hide();
        closed = true;
      }
    }
    if (closed) this._announce();
    return closed;
  }

  get anyOpen() {
    return this.panels.some((p) => p.isOpen);
  }

  get current() {
    return this.panels.find((p) => p.isOpen) ?? null;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    for (const t of this._dismissTargets) {
      t.removeEventListener('pointerdown', this._onPointerDown);
    }
    this._dismissTargets.length = 0;
  }
}

/* --------------------------------------------------------------- browser --- */

export class BodyBrowser {
  constructor(root, { solar, player, announcer }) {
    this.solar = solar;
    this.player = player;
    this.announcer = announcer;

    this.panel = el('section', 'panel panel-left');
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-label', 'Worlds');
    this.panel.innerHTML = `
      <div class="panel-head">
        <h2>Worlds</h2>
        <button class="icon-x" data-close aria-label="Close worlds list">&times;</button>
      </div>
      <div class="panel-body" id="browser-body"></div>
      <div class="panel-foot">
        <button class="btn primary" data-action="warp">Fly there <kbd>Enter</kbd></button>
        <button class="btn" data-action="orbit">Orbit <kbd>O</kbd></button>
        <button class="btn" data-action="land">Land <kbd>L</kbd></button>
      </div>
    `;
    root.appendChild(this.panel);
    this.body = this.panel.querySelector('#browser-body');
    this._selected = null;
    this._build();

    this.panel.querySelector('[data-close]').addEventListener('click', () => this.hide());
    this.panel.querySelector('[data-action="warp"]').addEventListener('click', () => this._warp());
    this.panel.querySelector('[data-action="orbit"]').addEventListener('click', () => this._orbit());
    this.panel.querySelector('[data-action="land"]').addEventListener('click', () => this._land());

    this.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.target.matches('[data-action]')) {
        e.preventDefault();
        this._warp();
      }
    });

    this._offAdd = bus.on('system:body-added', () => this._build());
    this._offRemove = bus.on('system:body-removed', () => this._build());
  }

  _build() {
    this.body.innerHTML = '';
    this._items = new Map();

    for (const group of groupBodies(this.solar)) {
      this.body.appendChild(el('div', 'group-title', escapeHtml(group.title)));
      const list = el('div', 'body-groups');
      const rows = [...group.items, ...(group.moons ?? [])];
      rows.forEach((body, index) => {
        const isMoonRow = index >= group.items.length;
        const btn = el('button', `body-item${isMoonRow ? ' is-moon' : ''}`);
        if (isMoonRow && index === group.items.length) {
          const divider = el('div', 'group-title', `Moons of ${escapeHtml(group.title)}`);
          list.appendChild(divider);
        }
        btn.type = 'button';
        btn.dataset.id = body.def.id;
        btn.setAttribute('aria-label', describeBody(body.def));
        const colour = TYPE_COLORS[body.def.type] ?? TYPE_COLORS.planet;
        btn.innerHTML = `
          <span class="body-swatch" style="background:${colour};color:${colour}"></span>
          <span class="body-name">${escapeHtml(body.def.name)}</span>
          <span class="body-meta"></span>
        `;
        btn.addEventListener('click', () => this.select(body.def.id));
        btn.addEventListener('dblclick', () => {
          this.select(body.def.id, { focus: false });
          this._warp();
        });
        list.appendChild(btn);
        this._items.set(body.def.id, btn);
      });
      this.body.appendChild(list);
    }
    this._updateMeta();
  }

  /** Live distances in the list, refreshed while the panel is open. */
  _updateMeta() {
    if (this.panel.hidden || !this._items) return;
    for (const [id, btn] of this._items) {
      const meta = btn.querySelector('.body-meta');
      if (meta) meta.textContent = shortDistance(this.player.realDistance?.(id));
    }
  }

  select(id, { focus = true } = {}) {
    this._selected = id;
    for (const [key, btn] of this._items) {
      btn.setAttribute('aria-current', key === id ? 'true' : 'false');
    }
    bus.emit('ui:selected', { id });
    if (focus) {
      const body = bodyById.get(id);
      if (body) this.announcer.politely(`Selected ${body.name}. ${body.summary}`);
    }
    return id;
  }

  get selected() {
    return this._selected;
  }

  _warp() {
    if (!this._selected) {
      this.announcer.politely('Select a world first.');
      return;
    }
    bus.emit('ui:warp', { id: this._selected });
  }

  _orbit() {
    if (this._selected) bus.emit('ui:orbit', { id: this._selected });
  }

  _land() {
    if (this._selected) bus.emit('ui:land', { id: this._selected });
  }

  show() {
    this.panel.hidden = false;
    this._updateMeta();
    clearInterval(this._metaTimer);
    this._metaTimer = setInterval(() => this._updateMeta(), 700);
  }

  hide() {
    this.panel.hidden = true;
    clearInterval(this._metaTimer);
  }

  toggle() {
    if (this.panel.hidden) this.show();
    else this.hide();
  }

  dispose() {
    clearInterval(this._metaTimer);
    this._offAdd?.();
    this._offRemove?.();
    this.panel.remove();
  }
}

/* ------------------------------------------------------------------ info --- */

export class InfoPanel {
  constructor(root, { solar, player, announcer }) {
    this.solar = solar;
    this.player = player;
    this.announcer = announcer;

    this.panel = el('section', 'panel panel-right');
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-labelledby', 'info-name');
    this.panel.innerHTML = `
      <div class="panel-head">
        <h2>World</h2>
        <button class="icon-x" data-close aria-label="Close world information">&times;</button>
      </div>
      <div class="panel-body" id="info-body"></div>
      <div class="panel-foot">
        <button class="btn primary" data-action="warp">Fly there</button>
        <button class="btn" data-action="orbit">Orbit</button>
        <button class="btn" data-action="land">Land</button>
        <button class="btn ghost" data-action="speak">Read aloud</button>
      </div>
    `;
    root.appendChild(this.panel);
    this.body = this.panel.querySelector('#info-body');
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.hide());
    for (const action of ['warp', 'orbit', 'land']) {
      this.panel.querySelector(`[data-action="${action}"]`).addEventListener('click', () => {
        if (this.id) bus.emit(`ui:${action}`, { id: this.id });
      });
    }
    this.panel.querySelector('[data-action="speak"]').addEventListener('click', () => {
      if (this._text) this.announcer.politely(this._text);
    });
  }

  /**
   * @param {string} [id] the world to describe. Falls back to whatever was last
   * shown, then to Earth, so that toggling the panel from a keyboard shortcut or
   * a button never silently fails to open.
   */
  show(id = this.id ?? 'earth') {
    const def = bodyById.get(id);
    if (!def) return;
    this.id = id;
    this.panel.hidden = false;

    const facts = (def.facts ?? [])
      .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`)
      .join('');
    const live = this._liveFacts(def);

    this.body.innerHTML = `
      <div class="info-title"><h2 id="info-name">${escapeHtml(def.name)}</h2></div>
      <div class="info-type">${escapeHtml(describeType(def))}</div>
      <p class="info-summary">${escapeHtml(def.summary)}</p>
      ${live ? `<div class="section-head">Right now</div><dl class="facts">${live}</dl>` : ''}
      <div class="section-head">Fact sheet</div>
      <dl class="facts">${facts}</dl>
    `;

    this._text = `${def.name}. ${def.summary} ${(def.facts ?? [])
      .map(([k, v]) => `${k}: ${v}.`)
      .join(' ')}`;
    this.body.scrollTop = 0;
    bus.emit('ui:info-open', { id });
  }

  /** Facts that depend on the current state of the simulation. */
  _liveFacts(def) {
    const rows = [];
    const km = this.player.realDistance?.(def.id);
    if (km !== null && km !== undefined) {
      rows.push(['Distance from you', formatDistance(km, settings.get('units'))]);
    }
    const orb = this.solar.orbital;
    const sun = orb.get('sun');
    const p = orb.get(def.id);
    if (p && sun && def.id !== 'sun') {
      rows.push([
        'Distance from the Sun',
        formatDistance(Math.hypot(p.x - sun.x, p.y - sun.y, p.z - sun.z), settings.get('units')),
      ]);
    }
    if (def.id !== 'sun') {
      const v = orb.velocityOf(def.id);
      if (v) rows.push(['Orbital speed now', `${v.toFixed(2)} km/s`]);
    }
    if (def.parent) {
      const dist = orb.distanceBetween(def.id, def.parent);
      if (dist) {
        rows.push([`Distance from ${bodyById.get(def.parent)?.name ?? 'parent'}`, formatDistance(dist, 'metric')]);
      }
      rows.push(['Orbital period', formatDays(Math.abs(def.orbit?.periodDays ?? 0))]);
    }
    return rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
  }

  hide() {
    this.panel.hidden = true;
    this.id = null;
  }

  toggle() {
    if (this.panel.hidden) {
      const id = this.id ?? this.player.focusId;
      if (id) this.show(id);
    } else {
      this.hide();
    }
  }

  dispose() {
    this.panel.remove();
  }
}

/* ------------------------------------------------------------------ tour --- */

const TOUR = [
  {
    id: 'sun',
    title: 'Start at the Sun',
    text: 'Everything in the solar system is the fallout from this one object. It holds 99.86% of the mass, and its light takes 8 minutes 20 seconds to reach Earth. Look closely at the surface: each bright cell is a convection current roughly the size of Texas.',
  },
  {
    id: 'earth',
    title: 'Home',
    text: 'The only world we know of with life. Note the cloud deck, and the city lights on the night side. You are looking at the whole of human history from outside it.',
  },
  {
    id: 'luna',
    title: 'The Moon',
    text: 'Twelve people have stood here. It is tidally locked, so the same face always points at Earth, and it drifts 3.8 centimetres further away every year.',
  },
  {
    id: 'mars',
    title: 'Mars',
    text: 'Rusty, cold, and home to the largest volcano and the largest canyon in the solar system. Press L to land and look at the sky: the Sun is visibly smaller from here.',
  },
  {
    id: 'jupiter',
    title: 'Jupiter',
    text: 'More massive than every other planet combined. Watch how fast it spins: a day lasts under ten hours, which flattens the planet and drives the banding. The Great Red Spot is a storm wider than Earth.',
  },
  {
    id: 'europa',
    title: 'Europa',
    text: 'An ice shell over a saltwater ocean holding twice the water of all Earth\u2019s oceans. This is the most likely place in the solar system to find life.',
  },
  {
    id: 'saturn',
    title: 'Saturn',
    text: 'The rings are 280,000 km across and about ten metres thick: mostly water ice, and the leftovers of something that never became a moon. The planet itself is less dense than water.',
  },
  {
    id: 'titan',
    title: 'Titan',
    text: 'The only moon with a thick atmosphere, and the only place besides Earth with liquid on its surface. Land here and the sky is orange and the rain is methane.',
  },
  {
    id: 'pluto',
    title: 'Pluto',
    text: 'A dwarf planet with a heart-shaped nitrogen glacier and five moons. New Horizons needed nine years to get here. Press Enter and you will arrive in under a second.',
  },
];

/**
 * The guided tour.
 *
 * This used to be a centred modal listing all nine stops, which is exactly
 * backwards: it covered the world it was describing, and it opened the fact
 * sheet on top of itself as well. It is now a caption bar along the bottom that
 * describes only the stop you are actually looking at, and it never opens
 * another panel.
 */
export class Tour {
  constructor(root, { announcer }) {
    this.announcer = announcer;
    this.index = -1;
    this.panel = el('section', 'tour-caption');
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-label', 'Guided tour');
    this.panel.innerHTML = `
      <div class="tour-copy">
        <h3><span class="tour-count"></span><span class="tour-title"></span></h3>
        <p class="tour-text"></p>
        <div class="tour-dots" aria-hidden="true"></div>
      </div>
      <div class="tour-actions">
        <button class="btn" data-action="prev" aria-label="Previous tour stop">Previous</button>
        <button class="btn primary" data-action="next" aria-label="Next tour stop">Next stop</button>
        <button class="btn ghost" data-action="stay">Exit tour</button>
      </div>
    `;
    root.appendChild(this.panel);
    this.panel.querySelector('[data-action="next"]').addEventListener('click', () => this.next());
    this.panel.querySelector('[data-action="prev"]').addEventListener('click', () => this.prev());
    this.panel.querySelector('[data-action="stay"]').addEventListener('click', () => this.hide());
  }

  _render() {
    const stop = TOUR[this.index] ?? TOUR[0];
    this.panel.querySelector('.tour-count').textContent = `${this.index + 1} / ${TOUR.length}`;
    this.panel.querySelector('.tour-title').textContent = stop.title;
    this.panel.querySelector('.tour-text').textContent = stop.text;
    this.panel.querySelector('.tour-dots').innerHTML = TOUR.map(
      (_, i) => `<span class="${i === this.index ? 'is-here' : ''}"></span>`
    ).join('');
  }

  show() {
    this.panel.hidden = false;
    if (this.index < 0) {
      this.go(0);
    } else {
      this._render();
    }
  }

  hide() {
    this.panel.hidden = true;
  }

  next() {
    this.go((this.index + 1) % TOUR.length);
  }

  prev() {
    this.go((this.index - 1 + TOUR.length) % TOUR.length);
  }

  go(i) {
    this.index = i;
    const stop = TOUR[i];
    this._render();
    // Deliberately NOT ui:orbit, which would open the fact sheet too. The tour
    // wants the view to itself; the caption carries the narrative.
    bus.emit('tour:goto', { id: stop.id });
    this.announcer.politely(`${stop.title}. ${stop.text}`);
  }

  dispose() {
    this.panel.remove();
  }
}

/* -------------------------------------------------------------- settings --- */

const QUALITY_OPTIONS = [
  ['low', 'Low — fastest'],
  ['medium', 'Medium'],
  ['high', 'High — surfaces up to 2048 px'],
];

export class SettingsPanel {
  constructor(root, { announcer }) {
    this.announcer = announcer;
    this.panel = el('section', 'panel panel-center');
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'settings-title');
    this.panel.innerHTML = `
      <div class="panel-head">
        <h2 id="settings-title">Settings</h2>
        <button class="icon-x" data-close aria-label="Close settings">&times;</button>
      </div>
      <div class="panel-body" id="settings-body"></div>
      <div class="panel-foot">
        <button class="btn ghost" data-action="reset">Reset to defaults</button>
      </div>
    `;
    root.appendChild(this.panel);
    this.body = this.panel.querySelector('#settings-body');
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.hide());
    this.panel.querySelector('[data-action="reset"]').addEventListener('click', () => {
      settings.reset();
      this._build();
      this.announcer.politely('Settings reset to defaults.');
    });
    this._release = null;
    this._build();
  }

  _build() {
    const s = settings.all();
    this.body.innerHTML = [
      section('View'),
      range('scaleBlend', 'Toy model → true scale', 0, 1, 0.01, s.scaleBlend, (v) =>
        v < 0.02
          ? 'Compressed, so the whole system fits on your screen.'
          : v > 0.98
            ? 'Real distances. Neptune is 4.5 billion km away, and mostly nothing is anywhere.'
            : 'Blending between the two views.'
      ),
      range('sizeBoost', 'World size exaggeration', 0.25, 4, 0.05, s.sizeBoost, () =>
        'Explore scale only. True scale always uses real radii.'
      ),
      section('Time'),
      range('timeScale', 'Time scale', 0.01, 365, 0.01, s.timeScale, (v) => {
        if (v < 0.05) return 'Slower than real time, for watching a single rotation.';
        if (v < 2) return 'Roughly real time.';
        if (v < 40) return 'Days fly past. Watch the planets drift.';
        return 'Years per second. Whole orbits in moments.';
      }),
      section('Visuals'),
      checkbox('orbitLines', 'Orbit paths', s.orbitLines, 'Drawn from the real orbital elements.'),
      checkbox('labels', 'World labels', s.labels, 'Names in the sky with live distances.'),
      checkbox('belts', 'Asteroid and Kuiper belts', s.belts, 'Tens of thousands of particles, animated on the GPU.'),
      checkbox('starfield', 'Starfield and Milky Way', s.starfield, 'The band sits in the real galactic plane.'),
      checkbox('bloom', 'Glow around bright objects', s.bloom, 'Adds a bloom pass. Slight performance cost.'),
      select('quality', 'Detail level', QUALITY_OPTIONS, s.quality, () =>
        'Higher detail repaints surfaces at up to 2048 px as you approach.'
      ),
      section('Accessibility'),
      checkbox('reducedMotion', 'Reduce motion', s.reducedMotion, 'Shorter transitions and a steadier physics step. Follows your system setting by default.'),
      checkbox('highContrast', 'High contrast interface', s.highContrast, 'Maximum contrast panels and text.'),
      checkbox('narration', 'Announce events aloud', s.narration, 'Sends event descriptions to your screen reader as they happen.'),
      checkbox('arrowKeysLook', 'Arrow keys look around', s.arrowKeysLook !== false, 'Turn off if you would rather arrow keys moved you.'),
      range('hudScale', 'Interface size', 0.85, 1.6, 0.05, s.hudScale ?? 1, () => 'Scales the head-up display.'),
      section('Controls'),
      range('mouseSensitivity', 'Mouse sensitivity', 0.2, 3, 0.05, s.mouseSensitivity, () => ''),
      range('fov', 'Field of view', 50, 100, 1, s.fov, () => ''),
      checkbox('invertY', 'Invert vertical look', s.invertY, ''),
      checkbox('pointerLock', 'Capture the mouse when flying', s.pointerLock !== false, 'Off means drag-to-look, which some people prefer.'),
      checkbox('touchControls', 'On-screen touch controls', s.touchControls !== false, 'One thumb to drive, one to look, with boost and dash buttons. Appears automatically on a touchscreen.'),
      select('hudDetail', 'Interface size', [['auto', 'Auto — small screens get the compact layout'], ['full', 'Full'], ['compact', 'Compact — clock and speed only']], s.hudDetail ?? 'auto', () =>
        'Compact hides the target and event blocks and shrinks the readouts.'
      ),
      checkbox('eventFeed', 'Show what is happening now', s.eventFeed !== false, 'A running list of recent phenomena in the corner.'),
      select('units', 'Units', [['metric', 'Metric (km, AU)'], ['imperial', 'Imperial (miles)']], s.units, () => ''),
    ].join('');
    this._wireInputs();
  }

  _wireInputs() {
    for (const input of this.body.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      const valueEl = input.parentElement.querySelector('.setting-value');
      const helpEl = input.parentElement.querySelector('.help');
      const read = () =>
        input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : parseFloat(input.value);
      const update = () => {
        const value = read();
        settings.set(key, value);
        if (valueEl) valueEl.textContent = formatSettingValue(key, value);
        if (helpEl?.dataset.template) {
          helpEl.textContent = helpEl.dataset.template;
        }
      };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
    }
  }

  show() {
    this.panel.hidden = false;
    this._build();
    this._release?.();
    this._release = trapFocus(this.panel, () => this.hide());
    bus.emit('ui:panel-open');
  }

  hide() {
    this.panel.hidden = true;
    this._release?.();
    this._release = null;
  }

  toggle() {
    if (this.panel.hidden) this.show();
    else this.hide();
  }

  dispose() {
    this._release?.();
    this.panel.remove();
  }
}

function section(title) {
  return `<div class="section-head">${title}</div>`;
}

function range(key, label, min, max, step, value, help) {
  return `
    <div class="setting">
      <label for="set-${key}">${escapeHtml(label)}</label>
      <span class="setting-value">${escapeHtml(formatSettingValue(key, value))}</span>
      <input type="range" id="set-${key}" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${value}" style="grid-column:1/-1" />
      <p class="help">${escapeHtml(help(value))}</p>
    </div>`;
}

function checkbox(key, label, checked, help) {
  return `
    <div class="setting">
      <label for="set-${key}">${escapeHtml(label)}</label>
      <input type="checkbox" id="set-${key}" data-setting="${key}" ${checked ? 'checked' : ''} />
      <p class="help">${escapeHtml(help)}</p>
    </div>`;
}

function select(key, label, options, value, help) {
  return `
    <div class="setting">
      <label for="set-${key}">${escapeHtml(label)}</label>
      <select id="set-${key}" data-setting="${key}">
        ${options
          .map(([v, t]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${escapeHtml(t)}</option>`)
          .join('')}
      </select>
      <p class="help">${escapeHtml(help(value))}</p>
    </div>`;
}

function formatSettingValue(key, v) {
  if (key === 'scaleBlend') return `${Math.round(v * 100)}%`;
  if (key === 'sizeBoost') return `${v.toFixed(2)}x`;
  if (key === 'timeScale') {
    if (v < 0.05) return `${(v * 24).toFixed(1)} h/s`;
    if (v < 30) return `${v.toFixed(2)} d/s`;
    return `${(v / 365.25).toFixed(2)} y/s`;
  }
  if (key === 'fov') return `${Math.round(v)}°`;
  if (key === 'mouseSensitivity') return `${v.toFixed(2)}x`;
  if (key === 'hudScale') return `${v.toFixed(2)}x`;
  return String(v);
}

/* ------------------------------------------------------------------ help --- */

export class HelpPanel {
  constructor(root, { announcer }) {
    this.announcer = announcer;
    this.panel = el('section', 'panel panel-center');
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'help-title');
    this.panel.innerHTML = `
      <div class="panel-head">
        <h2 id="help-title">Controls</h2>
        <button class="icon-x" data-close aria-label="Close help">&times;</button>
      </div>
      <div class="panel-body">
        <div class="section-head">Flying</div>
        <dl class="keys">
          <dt>W / S</dt><dd>Thrust forward and back</dd>
          <dt>A / D</dt><dd>Strafe left and right</dd>
          <dt>R / F</dt><dd>Fly up and down</dd>
          <dt>Q / E</dt><dd>Roll the ship</dd>
          <dt>Mouse</dt><dd>Look around. Click to capture the pointer, Escape to release</dd>
          <dt>Space</dt><dd>Hold to boost, roughly ten times faster</dd>
          <dt>X</dt><dd><strong>Dash.</strong> A one-second burst at about sixty times cruise speed</dd>
          <dt>Shift / Z</dt><dd>Brake</dd>
          <dt>Scroll</dt><dd>Adjust cruise speed, or zoom when orbiting a world</dd>
        </dl>
        <div class="section-head">Touchscreen</div>
        <dl class="keys">
          <dt>Left thumb</dt><dd>Drives. The stick appears wherever you put your thumb, so you never have to find a fixed pad</dd>
          <dt>Right thumb</dt><dd>Looks around at the same time</dd>
          <dt>Boost</dt><dd>Hold the large button, bottom right. Dash and Land sit beside it</dd>
          <dt>Top right</dt><dd>&#9776; worlds list, &#9707; hide the interface, ? this help</dd>
          <dt>Tap the scene</dt><dd>Dismisses whatever panel is open</dd>
        </dl>
        <div class="section-head">Going places</div>
        <dl class="keys">
          <dt>M</dt><dd>Worlds list, with live distances</dd>
          <dt>Enter</dt><dd>Fly to the selected world</dd>
          <dt>O</dt><dd>Orbit the selected world</dd>
          <dt>L</dt><dd>Land, or launch if you are already on the ground</dd>
          <dt>T</dt><dd>Guided tour</dd>
          <dt>I</dt><dd>Information about the current world</dd>
        </dl>
        <div class="section-head">Time and display</div>
        <dl class="keys">
          <dt>1 / 2 / 3</dt><dd>Time scale: real time, one month per second, one year per second</dd>
          <dt>+ / −</dt><dd>Double or halve the time scale</dd>
          <dt>P</dt><dd>Pause and resume</dd>
          <dt>G</dt><dd>Settings</dd>
          <dt>H</dt><dd>Hide the head-up display</dd>
          <dt>/</dt><dd>This help</dd>
          <dt>Escape</dt><dd>Close a panel, or release the mouse</dd>
        </dl>
        <p class="blurb" style="margin-top:18px">
          Every number here is real. Positions come from the JPL planetary
          ephemerides, so the planets are where they actually are on the date the
          clock reads. Physical values are from the NASA planetary fact sheets.
          The one deliberate departure is that sunlight does not dim with distance
          in the rendered scene: at true inverse-square falloff Neptune would be
          invisible. Every surface is painted procedurally at runtime, and there
          are no image files anywhere in this project.
        </p>
      </div>
      <div class="panel-foot">
        <button class="btn primary" data-close>Got it</button>
      </div>
    `;
    root.appendChild(this.panel);
    this.panel.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => this.hide())
    );
    this._release = null;
  }

  show() {
    this.panel.hidden = false;
    this._release?.();
    this._release = trapFocus(this.panel, () => this.hide());
    bus.emit('ui:panel-open');
  }

  hide() {
    this.panel.hidden = true;
    this._release?.();
    this._release = null;
  }

  toggle() {
    if (this.panel.hidden) this.show();
    else this.hide();
  }

  dispose() {
    this._release?.();
    this.panel.remove();
  }
}

function describeType(def) {
  if (def.type === 'moon') {
    const parent = bodyById.get(def.parent);
    return `Moon of ${parent ? parent.name : 'a planet'}`;
  }
  const names = {
    star: 'G-type main-sequence star',
    planet: 'Planet',
    dwarf: 'Dwarf planet',
    comet: 'Comet',
  };
  return names[def.type] ?? def.type;
}

export { TOUR };

/**
 * Every panel exposes the same open/closed state, so PanelManager can treat
 * them identically without five near-identical getters.
 */
for (const Panel of [BodyBrowser, InfoPanel, Tour, SettingsPanel, HelpPanel]) {
  if (!Object.getOwnPropertyDescriptor(Panel.prototype, 'isOpen')) {
    Object.defineProperty(Panel.prototype, 'isOpen', {
      get() {
        return !this.panel.hidden;
      },
      configurable: true,
    });
  }
}
