/**
 * Interface smoke tests, run against a real DOM (jsdom).
 *
 * There is no GPU in this environment, so the WebGL path cannot be exercised
 * here. Everything else can: the head-up display, the world browser, the fact
 * sheets, the tour, the settings panel and the announcements all run for real,
 * which is where typos and broken selectors actually live.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const failures = [];
let checks = 0;
function ok(name, condition, detail = '') {
  checks++;
  if (condition) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ------------------------------------------------------------ environment ---
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.localStorage = window.localStorage;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.matchMedia = globalThis.matchMedia;
window.devicePixelRatio = 2;
Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 900, writable: true });
// jsdom has no layout, so scrollIntoView is a no-op stub.
window.Element.prototype.scrollIntoView = function () {};

console.log('\nMarkup and wiring');
const idsInMain = ['viewport', 'ui-root', 'boot', 'boot-progress', 'boot-hint'];
for (const id of idsInMain) {
  ok(`index.html has #${id}`, !!document.getElementById(id));
}
ok('canvas is hidden from assistive technology', document.getElementById('viewport').getAttribute('aria-hidden') === 'true');
ok('a skip link exists for keyboard users', !!document.querySelector('.skip-link'));
ok('the page declares a language', document.documentElement.getAttribute('lang') === 'en');
ok('noscript fallback is present', html.includes('<noscript>'));

// --------------------------------------------------------------- fixtures ---
const { settings } = await import('../src/core/Settings.js');
const { bus } = await import('../src/core/EventBus.js');
const { ScaleModel } = await import('../src/core/ScaleModel.js');
const { OrbitalSystem } = await import('../src/systems/OrbitalMechanics.js');
const { ALL_BODIES, bodyById } = await import('../src/data/bodies.js');
const { createAnnouncer, applyDisplayPreferences } = await import('../src/ui/a11y.js');

const scale = new ScaleModel();
const orbital = new OrbitalSystem();

/** A stand-in for the renderable world: definitions plus fake render radii. */
const solar = {
  orbital,
  bodies: new Map(ALL_BODIES.map((def) => [def.id, { def, radiusUnits: scale.radius(def.radiusKm) }])),
  positionOf(id) {
    const p = orbital.get(id);
    return p ? { ...p } : null;
  },
  list: ALL_BODIES,
};

const player = {
  mode: 'flight',
  focusId: 'earth',
  position: { x: 120, y: 20, z: 0, length: () => Math.hypot(120, 20, 0) },
  velocity: { length: () => 12 },
  dashing: 0,
  dashCooldown: 0,
  collisionWarning: null,
  landingCandidate: null,
  keys: new Set(),
  mouse: { dx: 0, dy: 0 },
  currentSpeed: () => 34,
  realDistance: (id) => orbital.distanceBetween?.call(orbital, id, id) ?? 1e6,
};

const uiRoot = document.getElementById('ui-root');
const announcer = createAnnouncer(uiRoot);
applyDisplayPreferences();

console.log('\nAnnouncer');
ok('two live regions exist', uiRoot.querySelectorAll('[aria-live]').length === 2);
ok('a polite region is present', !!uiRoot.querySelector('[aria-live="polite"]'));
ok('an assertive region is present', !!uiRoot.querySelector('[aria-live="assertive"]'));

const { Hud } = await import('../src/ui/Hud.js');
const { BodyBrowser, InfoPanel, Tour, SettingsPanel, HelpPanel } = await import('../src/ui/Panels.js');

console.log('\nHead-up display');
const hud = new Hud(uiRoot, { solar, orbital, scale, player, announcer });
ok('HUD renders', !!document.querySelector('.hud'));
for (const id of ['hud-target', 'hud-distance', 'hud-date', 'hud-time', 'hud-scale', 'hud-speed', 'hud-crosshair', 'hud-labels', 'hud-notices']) {
  ok(`HUD has #${id}`, !!document.getElementById(id));
}
ok('crosshair is hidden from screen readers', document.getElementById('hud-crosshair').getAttribute('aria-hidden') === 'true');

// A real camera, because the label projection calls Vector3.project().
const THREE = await import('three');
const testCamera = new THREE.PerspectiveCamera(65, 1440 / 900, 0.001, 2e7);
testCamera.updateMatrixWorld(true);
testCamera.updateProjectionMatrix();
const ctx = {
  camera: testCamera,
  origin: { origin: { x: 0, y: 0, z: 0 } },
  engine: { simTime: 9783 },
};
hud.update(0.2, ctx);
ok('target name is populated', document.getElementById('hud-target').textContent.length > 0, document.getElementById('hud-target').textContent);
ok('simulated date is populated', /^\d{4}-\d{2}-\d{2}$/.test(document.getElementById('hud-date').textContent), document.getElementById('hud-date').textContent);
ok('time scale is described in words', /second/.test(document.getElementById('hud-time').textContent), document.getElementById('hud-time').textContent);
ok('scale mode is labelled', document.getElementById('hud-scale').textContent === 'Explore', document.getElementById('hud-scale').textContent);

settings.set('scaleBlend', 1);
scale.blend = 1;
hud.update(0.2, ctx);
ok('scale mode switches to true scale', document.getElementById('hud-scale').textContent === 'True scale');
settings.set('scaleBlend', 0);
scale.blend = 0;

hud.notice({ title: 'Test notice', text: 'Body text', kind: 'warm' });
ok('notices appear', document.querySelectorAll('.notice').length === 1);

hud.toggle(false);
ok('HUD can be hidden', document.querySelector('.hud').classList.contains('is-hidden'));
hud.toggle(true);
ok('HUD can be shown again', !document.querySelector('.hud').classList.contains('is-hidden'));

console.log('\nWorld browser');
const browser = new BodyBrowser(uiRoot, { solar, player, announcer });
browser.show();
const items = document.querySelectorAll('.body-item');
ok('every world is listed', items.length === ALL_BODIES.length, `${items.length} items for ${ALL_BODIES.length} bodies`);
ok('items are real buttons', [...items].every((b) => b.tagName === 'BUTTON'));
ok('items have accessible names', [...items].every((b) => (b.getAttribute('aria-label') ?? '').length > 20));
ok('moons are grouped under their planet', document.body.textContent.includes('Moons of Jupiter'));
ok('moons of dwarf planets are listed too', document.body.textContent.includes('Charon') && document.body.textContent.includes('Pluto'));
ok('grouping covers the Sun', document.body.textContent.includes('Star'));
ok('dwarf planets get their own group', document.body.textContent.includes('Dwarf planets and small bodies'));

let warped = null;
const offWarp = bus.on('ui:warp', (e) => (warped = e.id));
items[0].click();
ok('clicking selects a world', browser.selected === items[0].dataset.id, browser.selected);
ok('selection announces itself', document.querySelector('.body-item[aria-current="true"]') !== null);
document.querySelector('[data-action="warp"]').click();
ok('the fly-there button emits a warp', warped === browser.selected, String(warped));
offWarp();

let landed = null;
const offLand = bus.on('ui:land', (e) => (landed = e.id));
browser.select('mars');
document.querySelector('[data-action="land"]').click();
ok('the land button emits a landing request', landed === 'mars');
offLand();
ok('distance column is filled in', document.querySelector('.body-meta').textContent.length > 0);
browser.hide();
ok('browser hides', document.querySelector('.panel-left').hidden);

console.log('\nFact sheets');
const info = new InfoPanel(uiRoot, { solar, player, announcer });
info.show('saturn');
ok('info panel names the world', document.getElementById('info-name').textContent === 'Saturn');
ok('summary is shown', document.querySelector('.info-summary').textContent.length > 80);
ok('fact sheet is rendered', document.querySelectorAll('.facts dt').length >= 6, `${document.querySelectorAll('.facts dt').length} facts`);
ok('live state section is present', document.body.textContent.includes('Right now'));
for (const id of ['earth', 'jupiter', 'luna', 'halley']) {
  info.show(id);
  const name = document.getElementById('info-name').textContent;
  ok(`fact sheet renders for ${id}`, name === bodyById.get(id).name, name);
}
let spoken = 0;
const offSpeak = bus.on('ui:info-open', () => spoken++);
info.show('venus');
ok('opening a fact sheet emits an event', spoken > 0);
offSpeak();
info.hide();

console.log('\nGuided tour');
const tour = new Tour(uiRoot, { announcer });
let orbited = [];
const offOrbit = bus.on('ui:orbit', (e) => orbited.push(e.id));
tour.show();
ok('tour opens on the first stop', tour.index === 0, `index ${tour.index}`);
ok('tour stops are rendered', document.querySelectorAll('.tour-step').length >= 8);
ok('the active stop is marked', document.querySelectorAll('.tour-step.is-active').length === 1);
const { TOUR: TOUR_STOPS } = await import('../src/ui/Panels.js');
const before = orbited.length;
for (let i = 0; i < TOUR_STOPS.length + 1; i++) {
  document.querySelector('[data-action="next"]').click();
}
ok('tour cycles through every stop', orbited.length - before === TOUR_STOPS.length + 1);
ok('tour visits real bodies', orbited.every((id) => !!bodyById.get(id)), orbited.join(' '));
document.querySelector('[data-action="prev"]').click();
ok('previous works', tour.index === (TOUR_STOPS.length + 1 - 1) % TOUR_STOPS.length);
tour.hide();
offOrbit();

console.log('\nSettings panel');
const settingsPanel = new SettingsPanel(uiRoot, { announcer });
settingsPanel.show();
const controls = document.querySelectorAll('#settings-body [data-setting]');
ok('settings are rendered', controls.length >= 15, `${controls.length} controls`);
ok('every control is a labelled form element', [...controls].every((c) => ['INPUT', 'SELECT'].includes(c.tagName)));
ok('every control has a matching label', [...controls].every((c) => !!document.querySelector(`label[for="${c.id}"]`)));
ok('accessibility settings are exposed', !!document.querySelector('[data-setting="reducedMotion"]') && !!document.querySelector('[data-setting="highContrast"]') && !!document.querySelector('[data-setting="narration"]'));
ok('the scale slider is exposed', !!document.querySelector('[data-setting="scaleBlend"]'));
const blend = document.querySelector('[data-setting="scaleBlend"]');
blend.value = '0.5';
blend.dispatchEvent(new window.Event('input', { bubbles: true }));
ok('moving the slider changes the setting', Math.abs(settings.get('scaleBlend') - 0.5) < 1e-6, String(settings.get('scaleBlend')));
settings.set('scaleBlend', 0);

const contrast = document.querySelector('[data-setting="highContrast"]');
contrast.checked = true;
contrast.dispatchEvent(new window.Event('change', { bubbles: true }));
ok('high contrast applies to the document', document.documentElement.dataset.contrast === 'high');
contrast.checked = false;
contrast.dispatchEvent(new window.Event('change', { bubbles: true }));
ok('high contrast can be turned off', document.documentElement.dataset.contrast === 'normal');

const motion = document.querySelector('[data-setting="reducedMotion"]');
motion.checked = true;
motion.dispatchEvent(new window.Event('change', { bubbles: true }));
ok('reduced motion applies to the document', document.documentElement.dataset.motion === 'reduced');
motion.checked = false;
motion.dispatchEvent(new window.Event('change', { bubbles: true }));

const quality = document.querySelector('[data-setting="quality"]');
quality.value = 'low';
quality.dispatchEvent(new window.Event('change', { bubbles: true }));
ok('quality is settable', settings.get('quality') === 'low');
quality.value = 'high';
quality.dispatchEvent(new window.Event('change', { bubbles: true }));

document.querySelector('[data-action="reset"]').click();
ok('reset restores defaults', settings.get('scaleBlend') === 0 && settings.get('quality') === 'high');
settingsPanel.hide();

console.log('\nHelp panel');
const help = new HelpPanel(uiRoot, { announcer });
help.show();
ok('help lists the controls', document.querySelectorAll('.keys dt').length >= 18, `${document.querySelectorAll('.keys dt').length} shortcuts`);
ok('help explains the scale model', document.querySelector('.blurb').textContent.includes('inverse-square'));
ok('help can be dismissed', (() => {
  document.querySelector('#help-title').parentElement.parentElement.querySelector('.btn.primary').click();
  return document.querySelector('.panel-center[aria-labelledby="help-title"]').hidden;
})());
help.dispose();

console.log('\nBus-driven behaviour');
const startedEvents = [];
const offEvents = bus.on('event:started', (e) => startedEvents.push(e));
bus.emit('event:started', {
  id: 'solar-flare',
  name: 'Solar flare and coronal mass ejection',
  category: 'solar',
  blurb: 'A'.repeat(120),
  detail: 'Aimed at Earth.',
  severity: 'major',
});
ok('an event produces a notice', document.querySelectorAll('.notice').length >= 2);
ok('the event blurb reaches the notice text', document.body.textContent.includes('A'.repeat(120)));
// Announcements are deliberately deferred a tick so that repeating an identical
// string is still spoken; wait for that before asserting, and check before the
// next announcement overwrites the region.
await new Promise((r) => setTimeout(r, 140));
ok(
  'event notices are announced to the live region',
  uiRoot.querySelector('[aria-live="polite"]').textContent.includes('Solar flare'),
  uiRoot.querySelector('[aria-live="polite"]').textContent.slice(0, 60)
);
bus.emit('event:sub', { name: 'Aurora over Earth', blurb: 'Charged particles reach the poles.' });
ok('sub-events also announce', document.body.textContent.includes('Aurora over Earth'));
bus.emit('player:collision', { body: { name: 'Phobos' }, speed: 4.2 });
ok('collisions produce a warning', document.body.textContent.includes('Hull contact with Phobos'));
bus.emit('surface:crushed', { name: 'Jupiter', depth: 500, pressure: '1000 bar' });
ok('being crushed is reported', document.body.textContent.includes('Hull crushed in Jupiter'));
offEvents();
bus.emit('ui:notice', { title: 'Plain notice', text: 'Nothing to do with events.' });
ok('generic notices work', document.body.textContent.includes('Plain notice'));

hud.updateEvents({
  activeNames: () => ['Solar flare', 'Aurora'],
  log: [{ name: 'Impact', detail: 'Mars takes a hit.', simTime: 1 }],
});
ok('the ticker shows running events', document.querySelectorAll('.chip.is-live').length === 2);
ok('the feed shows the latest event', document.body.textContent.includes('Mars takes a hit.'));

console.log('\nLabels');
const labelCtx = {
  camera: testCamera,
  origin: { origin: { x: 0, y: 0, z: 0 } },
};
for (let i = 0; i < 40; i++) hud.updateLabels(labelCtx);
ok('labels are created for visible bodies', document.querySelectorAll('.label').length > 0, `${document.querySelectorAll('.label').length} labels`);
ok('labels carry names', [...document.querySelectorAll('.label .name')].every((n) => n.textContent.length > 0));

console.log('\nCleanup');
hud.dispose();
browser.dispose();
info.dispose();
settingsPanel.dispose();
tour.dispose();
ok('HUD removes itself', document.querySelectorAll('.hud').length === 0);
ok('panels remove themselves', document.querySelectorAll('.panel').length === 0);

console.log(`\nResult: ${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
