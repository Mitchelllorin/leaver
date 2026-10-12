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
import { BodyBrowser, InfoPanel, Tour, SettingsPanel, HelpPanel, PanelManager } from './ui/Panels.js';
import { TouchControls } from './controls/TouchControls.js';
import { openingView } from './controls/framing.js';
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

/**
 * One panel at a time, and always a way out. Escape and a press on the scene
 * both dismiss whatever is open, which previously did not exist for the worlds
 * list or the fact sheet at all.
 */
const panels = new PanelManager();
panels.register(browser, 'worlds');
panels.register(info, 'info');
panels.register(tour, 'tour');
panels.register(settingsPanel, 'settings');
panels.register(help, 'help');
panels.attachDismissTarget(canvas);

const touch = new TouchControls(engine, player, { root: uiRoot });

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
    touch.update();
    if (surface.active) surface.update(dt, ctx);
  },
};

/* ------------------------------------------------------- keyboard actions --- */

const unsubs = [
  bus.on('ui:toggle-map', () => {
    player.releasePointer();
    panels.toggle(browser);
  }),
  bus.on('ui:toggle-settings', () => {
    player.releasePointer();
    panels.toggle(settingsPanel);
  }),
  bus.on('ui:toggle-tour', () => {
    player.releasePointer();
    panels.toggle(tour);
  }),
  bus.on('ui:toggle-help', () => {
    player.releasePointer();
    panels.toggle(help);
  }),
  // The fact sheet key that the help panel has always documented but which was
  // never actually bound to anything.
  bus.on('ui:info-toggle', () => {
    if (info.isOpen) {
      panels.closeAll();
      return;
    }
    const id = info.id ?? player.focusId ?? player.landingCandidate?.def.id ?? 'earth';
    panels.only(info);
    info.show(id);
    panels._announce();
  }),
  bus.on('ui:toggle-pause', () => {
    settings.set('paused', !settings.get('paused'));
    announcer.politely(settings.get('paused') ? 'Simulation paused.' : 'Simulation running.');
  }),

  // -- go somewhere -------------------------------------------------------
  // Travelling clears the interface: you asked to go there, so you want to see
  // it. The head-up display names the target and its distance on arrival.
  bus.on('ui:warp', ({ id }) => {
    panels.closeAll();
    player.releaseFocus();
    player.warpTo(id);
  }),
  bus.on('ui:orbit', ({ id }) => {
    player.focusOn(id);
    panels.only(info);
    info.show(id);
    panels._announce();
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
  bus.on('ui:info-open', ({ id }) => {
    panels.only(info);
    info.show(id);
    panels._announce();
  }),
  // The tour drives the camera itself; it must not open the fact sheet on top
  // of its own caption, which is what it used to do.
  bus.on('tour:goto', ({ id }) => {
    player.focusOn(id);
  }),

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
    panels.only(info);
    info.show(id);
    panels._announce();
  }),
  bus.on('surface:launch-request', () => {
    if (surface.active) surface.launch();
  }),
  bus.on('surface:entered', () => {
    // Landing means you want the whole screen for the surface.
    panels.closeAll();
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

  // Open on Earth, on the lit side, with the Sun kept out of frame. The previous
  // version used a fixed offset direction that ignored where the Sun was, so
  // depending on the date you could start staring straight into its bloom.
  const view = openingView('earth', solar);
  if (view) {
    player.position.set(view.position.x, view.position.y, view.position.z);
    player.yaw = view.yaw;
    player.pitch = view.pitch;
  }
  player.focusId = 'earth';

  engine.addSystem(orbital);
  engine.addSystem(player);
  engine.addSystem(solar);
  engine.addSystem(events);
  engine.addSystem(uiSystem);
  engine.start();

  boot.classList.add('is-hidden');
  setTimeout(() => boot.remove(), 800);

  // A single short line. The previous version stacked three long notices in the
  // middle of the screen, and the guide button in the corner covers the rest.
  hud.notice({
    title: 'W to thrust, mouse to look',
    text: 'Space boosts, X dashes, L lands. The buttons top-right open the worlds list and the full controls.',
    kind: 'info',
    duration: 9,
    announce: true,
  });

  // First phenomenon shortly after arrival, so the system feels alive. It gets
  // its own notice from the events system, which is enough on its own screen.
  setTimeout(() => {
    if (events.log.length === 0) events.trigger('meteor-shower');
  }, 12000);

  window.addEventListener('beforeunload', () => {
    for (const un of unsubs) un();
    hud.dispose();
    browser.dispose();
    info.dispose();
    tour.dispose();
    settingsPanel.dispose();
    help.dispose();
    panels.dispose();
    touch.dispose();
    events.dispose();
    postfx.dispose();
    player.dispose();
    solar.dispose();
    engine.dispose();
  });
})();
