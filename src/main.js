import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { ScaleModel } from './core/ScaleModel.js';
import { settings } from './core/Settings.js';
import { bus } from './core/EventBus.js';
import { OrbitalSystem } from './systems/OrbitalMechanics.js';
import { SolarSystem } from './systems/SolarSystem.js';
import { EventsSystem } from './systems/EventsSystem.js';
import { PlayerController } from './controls/PlayerController.js';
import { SurfaceScene } from './surface/SurfaceScene.js';
import { PostFX } from './scene/PostFX.js';
import { Hud } from './ui/Hud.js';
import { BodyBrowser, InfoPanel, Tour, SettingsPanel, HelpPanel } from './ui/Panels.js';
import { createAnnouncer, applyDisplayPreferences } from './ui/a11y.js';
import { bodyById, ALL_BODIES } from './data/bodies.js';
import { clamp, damp, DEG } from './util/math.js';

/**
 * Orrery — an explorable, educational solar system.
 *
 * Boot order matters:
 *   1. engine + scale + mechanics (no rendering yet)
 *   2. world meshes, painted procedurally with a progress bar
 *   3. the player, the event system and the interface
 *   4. start the loop
 *
 * Everything after step 1 is a plugin: SolarSystem, PlayerController,
 * SurfaceScene, EventsSystem and each of the nine events can be removed or
 * replaced without touching the rest.
 */

const canvas = document.getElementById('viewport');
const uiRoot = document.getElementById('ui-root');
const boot = document.getElementById('boot');
const bootProgress = document.getElementById('boot-progress');
const bootHint = document.getElementById('boot-hint');

applyDisplayPreferences();

const engine = new Engine(canvas);
const scale = new ScaleModel();
const orbital = new OrbitalSystem();
const solar = new SolarSystem(scale, orbital);

const announcer = createAnnouncer(uiRoot);

// Expose a small surface for the browser console and for anyone extending this.
window.orrery = { engine, scale, orbital, solar, settings, bus, announcer };

/* --------------------------------------------------------------- boot up --- */

async function bootUp() {
  const hints = [
    'Generating planetary surfaces procedurally.',
    'There are no image files in this project.',
    'Placing the planets where they actually are today.',
    'Painting Saturn\u2019s rings.',
  ];
  let hint = 0;

  solar.attach(engine);

  // Paint level-0 surfaces one body at a time, yielding so the progress bar
  // actually moves. This is the only slow step in startup.
  const total = solar.list.length;
  for (let i = 0; i < total; i++) {
    const body = solar.bodies.get(solar.list[i].id);
    body?.applyTextureLevel(0);
    const pct = ((i + 1) / total) * 100;
    bootProgress.style.width = `${pct.toFixed(0)}%`;
    if (i % 4 === 0) {
      bootHint.textContent = hints[hint++ % hints.length];
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  bootHint.textContent = 'Almost there.';
  await new Promise((r) => setTimeout(r, 0));
}

/* ------------------------------------------------------------ the player --- */

const player = new PlayerController(engine, scale, orbital, solar);
const surface = new SurfaceScene(engine, scale, orbital, solar);
surface.attachPlayer(player);
const events = new EventsSystem(engine, solar, scale, orbital, player);
const postfx = new PostFX(engine);

/* ------------------------------------------------------------------ the UI --- */

const hud = new Hud(uiRoot, { solar, orbital, scale, player, announcer });
const browser = new BodyBrowser(uiRoot, { solar, player, announcer });
const info = new InfoPanel(uiRoot, { solar, player, announcer });
const tour = new Tour(uiRoot, { announcer });
const settingsPanel = new SettingsPanel(uiRoot, { announcer });
const help = new HelpPanel(uiRoot, { announcer });

// The player measures real distances for the HUD, the list and the info cards.
player.realDistance = (id) => hud.realDistance(id);

/**
 * The interface as an engine system: it runs last, so it always reads positions
 * and state that every other system has already updated this frame.
 */
const uiSystem = {
  name: 'ui',
  priority: 100,
  update(dt, ctx) {
    // Animate the explore <-> true scale transition instead of snapping.
    const targetBlend = settings.get('scaleBlend');
    scale.blend = damp(scale.blend, targetBlend, 2.6, dt);
    if (Math.abs(scale.blend - targetBlend) < 0.0015) scale.blend = targetBlend;

    if (scale.sizeBoost !== settings.get('sizeBoost')) {
      scale.sizeBoost = settings.get('sizeBoost');
    }
    if (Math.abs(engine.camera.fov - settings.get('fov')) > 0.01) {
      engine.camera.fov = settings.get('fov');
      engine.camera.updateProjectionMatrix();
    }

    hud.update(dt, ctx);
    hud.updateEvents(events);
    if (surface.active) surface.update(dt, ctx);
  },
};

/* ------------------------------------------------------- keyboard actions --- */

function openPanel(panel) {
  const others = [browser, info, tour, settingsPanel, help].filter((p) => p !== panel);
  for (const p of others) p.hide();
  panel.show();
}

const unsubs = [
  bus.on('ui:toggle-map', () => {
    player.releasePointer();
    if (browser.panel.hidden) openPanel(browser);
    else browser.hide();
  }),
  bus.on('ui:toggle-settings', () => {
    player.releasePointer();
    if (settingsPanel.panel.hidden) openPanel(settingsPanel);
    else settingsPanel.hide();
  }),
  bus.on('ui:toggle-tour', () => {
    player.releasePointer();
    if (tour.panel.hidden) openPanel(tour);
    else tour.hide();
  }),
  bus.on('ui:toggle-help', () => {
    player.releasePointer();
    if (help.panel.hidden) openPanel(help);
    else help.hide();
  }),
  bus.on('ui:info-toggle', () => {
    if (info.panel.hidden) info.show(info.id ?? player.focusId ?? 'earth');
    else info.hide();
  }),
  bus.on('ui:toggle-pause', () => {
    settings.set('paused', !settings.get('paused'));
    announcer.politely(settings.get('paused') ? 'Simulation paused.' : 'Simulation running.');
  }),

  // -- go somewhere -------------------------------------------------------
  bus.on('ui:warp', ({ id }) => {
    player.releaseFocus();
    player.warpTo(id);
    info.show(id);
  }),
  bus.on('ui:orbit', ({ id }) => {
    player.focusOn(id);
    info.show(id);
  }),
  bus.on('ui:land', ({ id }) => {
    const def = bodyById.get(id);
    if (!def) return;
    bus.emit('surface:landing-request', { id, body: def });
  }),
  bus.on('ui:selected', ({ id }) => {
    const def = bodyById.get(id);
    if (def) announcer.politely(`${def.name}. ${def.summary}`);
  }),
  bus.on('ui:info-open', ({ id }) => info.show(id)),

  // -- landing ------------------------------------------------------------
  bus.on('surface:landing-request', ({ id, body }) => {
    const renderer = solar.bodies.get(id);
    if (!renderer) return;
    if (body?.terrain?.gasGiant) {
      // Gas giants have no surface, so this is a descent, not a landing.
      surface.enter(renderer.def, player);
      return;
    }
    surface.enter(renderer.def, player);
    openPanel(info);
    info.show(id);
  }),
  bus.on('surface:launch-request', () => {
    if (surface.active) surface.launch();
  }),
  bus.on('surface:entered', () => {
    browser.hide();
    tour.hide();
    settingsPanel.hide();
    help.hide();
    player.releasePointer();
    showSurfaceBar();
  }),
  bus.on('surface:left', () => hideSurfaceBar()),
  bus.on('surface:impact', ({ speed }) => {
    hud.notice({
      title: 'Hard landing',
      text: `Touchdown at ${speed.toFixed(1)} m/s. Anything above about 6 m/s would have damaged the legs.`,
      kind: 'danger',
      duration: 6,
    });
  }),

  // -- scale explanation --------------------------------------------------
  bus.on('settings:change', ({ key, value }) => {
    applyDisplayPreferences();
    if (key === 'quality') {
      engine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, value === 'high' ? 2 : 1.5));
      postfx.resize();
    }
    if (key === 'scaleBlend' && value > 0.98) {
      hud.notice({
        title: 'True scale',
        text: 'Neptune is now 4.5 billion km away and takes real patience to reach. This is what the solar system actually is: almost entirely emptiness. Slide back towards the toy model when you want to find something quickly.',
        kind: 'warm',
        duration: 12,
        announce: true,
      });
    }
  }),
];

/* ----------------------------------------------------------- surface bar --- */

let surfaceBar = null;
function showSurfaceBar() {
  hideSurfaceBar();
  const gravity = surface.gravity;
  const gRatio = (gravity / 9.807).toFixed(2);
  surfaceBar = document.createElement('div');
  surfaceBar.className = 'surface-bar';
  surfaceBar.setAttribute('role', 'group');
  surfaceBar.setAttribute('aria-label', 'Surface status');
  surfaceBar.innerHTML = `
    <div class="stat"><b id="sb-body">${surface.def.name}</b><span>Location</span></div>
    <div class="stat"><b id="sb-gravity">${gravity.toFixed(2)}</b><span>m/s² (${gRatio} g)</span></div>
    <div class="stat" id="sb-depth-stat" ${surface.kind === 'gas' ? '' : 'hidden'}>
      <b id="sb-depth">0</b><span>km descended</span>
    </div>
    <div class="stat"><b id="sb-jump">${surface.kind === 'gas' ? '—' : jumpHeight(gravity)}</b><span>Jump height</span></div>
    <button class="btn primary" id="sb-launch">Launch to orbit <kbd>L</kbd></button>
  `;
  uiRoot.appendChild(surfaceBar);
  surfaceBar.querySelector('#sb-launch').addEventListener('click', () => surface.launch());
}

function hideSurfaceBar() {
  surfaceBar?.remove();
  surfaceBar = null;
}

// How high you can jump here, worked out from the real local gravity.
function jumpHeight(g) {
  if (g <= 0) return 'unbounded';
  const h = (4.5 * 4.5) / (2 * g); // a 4.5 m/s launch, roughly a human effort
  if (h > 1000) return `${(h / 1000).toFixed(1)} km`;
  if (h > 10) return `${h.toFixed(0)} m`;
  return `${h.toFixed(1)} m`;
}

bus.on('surface:depth', ({ depth, crushDepth }) => {
  const node = document.getElementById('sb-depth');
  if (node) node.textContent = depth.toFixed(1);
  const stat = document.getElementById('sb-depth-stat');
  if (stat && depth > crushDepth * 0.7) stat.style.color = 'var(--danger)';
});

/* ------------------------------------------------------------ start here --- */

(async function start() {
  await bootUp();

  // Open on Earth: the one world the viewer already has a relationship with.
  const earth = solar.positionOf('earth');
  const earthBody = solar.bodies.get('earth');
  const standoff = earthBody.radiusUnits * 7;
  player.position.set(
    earth.x + standoff * 0.62,
    earth.y + standoff * 0.34,
    earth.z + standoff * 0.7
  );
  player.yaw = Math.atan2(-(earth.x - player.position.x), -(earth.z - player.position.z));
  player.pitch = -0.22;

  engine.addSystem(orbital);
  engine.addSystem(player);
  engine.addSystem(solar);
  engine.addSystem(events);
  engine.addSystem(uiSystem);
  engine.start();

  boot.classList.add('is-hidden');
  setTimeout(() => boot.remove(), 800);

  hud.notice({
    title: 'You are flying',
    text: 'W to thrust, mouse to look, Space to boost, X to dash. Press M for the worlds list, T for a guided tour, / for every control, and L to land on anything you can reach.',
    kind: 'info',
    duration: 16,
    announce: true,
  });
  setTimeout(() => {
    hud.notice({
      title: 'Tip: slide the scale',
      text: 'Press G and move the top slider from the toy model towards true scale. The planets are in their real positions the whole time — only the distances on screen change.',
      kind: 'warm',
      duration: 14,
    });
  }, 17000);

  info.show('earth');
  info.hide();

  // First phenomenon shortly after arrival, so the system feels alive.
  setTimeout(() => {
    if (events.log.length === 0) events.trigger('meteor-shower');
  }, 9000);

  window.addEventListener('beforeunload', () => {
    for (const un of unsubs) un();
    hud.dispose();
    browser.dispose();
    info.dispose();
    tour.dispose();
    settingsPanel.dispose();
    help.dispose();
    events.dispose();
    postfx.dispose();
    player.dispose();
    solar.dispose();
    engine.dispose();
  });
})();
