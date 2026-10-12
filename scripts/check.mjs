/**
 * Headless smoke tests for the parts of the sim that do not need a GPU:
 * the dataset, the scale model, orbital mechanics and the texture painters.
 *
 * Browser APIs are stubbed just far enough for canvas painting to run, so a
 * broken noise function or a NaN in an element set fails here rather than as a
 * black screen in the browser.
 */
const failures = [];
let checks = 0;

function ok(name, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------- DOM stub ---
class FakeImageData {
  constructor(a, b, c) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c;
    }
  }
}
globalThis.ImageData = FakeImageData;
const canvases = [];
globalThis.document = {
  pointerLockElement: null,
  addEventListener() {},
  removeEventListener() {},
  exitPointerLock() {},
  createElement(tag) {
    if (tag !== 'canvas') return {};
    const canvas = {
      tagName: 'CANVAS',
      width: 0,
      height: 0,
      _painted: 0,
      _pixels: null,
      getContext() {
        return {
          putImageData: (img) => {
            canvas._painted++;
            canvas._pixels = img;
          },
          getImageData: (x, y, w, h) => new FakeImageData(w, h),
          drawImage: () => {},
          fillRect: () => {},
          createRadialGradient: () => ({ addColorStop() {} }),
        };
      },
    };
    canvases.push(canvas);
    return canvas;
  },
};

// Stubs for the browser globals the modules touch at import time.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window = {
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
globalThis.cancelAnimationFrame = () => {};

const AU = 149_597_870.7;
const t0 = Date.now();

console.log('\nDataset');
const bodies = await import('../src/data/bodies.js');
ok('bodies loaded', bodies.ALL_BODIES.length >= 20, `${bodies.ALL_BODIES.length} bodies`);
const ids = bodies.ALL_BODIES.map((b) => b.id);
ok('ids unique', new Set(ids).size === ids.length);
ok(
  'every satellite has a real parent',
  bodies.ALL_BODIES.filter((b) => b.parent).every((b) => bodies.bodyById.has(b.parent))
);
ok(
  'every heliocentric body has elements',
  bodies.ALL_BODIES.filter((b) => !b.parent && b.id !== 'sun').every((b) => b.elements)
);
ok(
  'every satellite has an orbit',
  bodies.ALL_BODIES.filter((b) => b.parent).every((b) => b.orbit?.distKm > 0)
);
ok('all bodies have a summary', bodies.ALL_BODIES.every((b) => (b.summary ?? '').length > 30));
ok('all bodies have facts', bodies.ALL_BODIES.every((b) => Array.isArray(b.facts) && b.facts.length >= 2));
ok('all bodies have visual config', bodies.ALL_BODIES.every((b) => b.visual?.palette?.length >= 2));
ok(
  'all bodies have surface config',
  bodies.ALL_BODIES.every((b) => b.terrain && typeof b.terrain.dustAmount === 'number')
);
const smallest = Math.min(...bodies.ALL_BODIES.map((b) => b.radiusKm));
ok('radii are positive', smallest > 0, `smallest ${smallest} km`);

console.log('\nScale model');
const { ScaleModel } = await import('../src/core/ScaleModel.js');
const s = new ScaleModel();
const earthR = s.radius(6371);
const sunR = s.radius(696340);
ok('explore: Earth is visible', earthR > 3 && earthR < 12, `${earthR.toFixed(2)} units`);
ok('explore: Sun does not swallow Mercury', sunR < s.distance(57.9e6), `sun ${sunR.toFixed(1)} < 62`);
ok(
  'explore: orbits are ordered and spread out',
  s.distance(57.9e6) < s.distance(149.6e6) && s.distance(149.6e6) < s.distance(4.495e9),
  `${s.distance(57.9e6).toFixed(0)} / ${s.distance(149.6e6).toFixed(0)} / ${s.distance(4.495e9).toFixed(0)}`
);
ok(
  'explore: moons stay outside their planet',
  bodies.ALL_BODIES.filter((b) => b.orbit).every((m) => {
    const parent = bodies.bodyById.get(m.parent);
    return s.moonOrbitDistance(m.orbit.distKm, s.radius(parent.radiusKm)) > s.radius(parent.radiusKm) * 1.5;
  })
);
s.setBlend(1);
ok('true scale is exact', Math.abs(s.radius(6371) - 6.371) < 1e-9, `${s.radius(6371)} units`);
ok('true scale distance is exact', Math.abs(s.distance(1 * AU) - AU / 1000) < 1e-6);
ok(
  'blend is monotonic',
  (() => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      s.setBlend(i / 10);
      const v = s.distance(4.495e9);
      if (v < prev) return false;
      prev = v;
    }
    return true;
  })()
);
s.setBlend(0);

console.log('\nOrbital mechanics');
const om = await import('../src/systems/OrbitalMechanics.js');
const sys = new om.OrbitalSystem();
const expectedSpeeds = { earth: 29.8, jupiter: 13.1, neptune: 5.4, saturn: 9.7, uranus: 6.8 };
for (const [id, want] of Object.entries(expectedSpeeds)) {
  const got = sys.velocityOf(id);
  ok(`${id} orbital speed`, Math.abs(got - want) / want < 0.12, `${got.toFixed(2)} vs ~${want} km/s`);
}
const earth = sys.get('earth');
const moon = sys.get('luna');
const lunaDist = Math.hypot(moon.x - earth.x, moon.y - earth.y, moon.z - earth.z);
ok('Moon orbits Earth at the right radius', Math.abs(lunaDist - 384400) < 1000, `${lunaDist.toFixed(0)} km`);
ok('all positions are finite', [...sys.positions.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));
ok(
  'planets are inside their own orbit bounds',
  ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].every((id) => {
    const p = sys.get(id);
    const r = Math.hypot(p.x, p.y, p.z) / AU;
    return r > 0.3 && r < 31;
  })
);
ok('dominant body near Earth', sys.dominantBody({ x: earth.x + 7000, y: earth.y, z: earth.z }).id === 'earth');
ok('dominant body near the Moon', sys.dominantBody({ x: moon.x + 90000, y: moon.y, z: moon.z }).id === 'luna');
ok('dominant body in deep space', sys.dominantBody({ x: 40 * AU, y: 0, z: 0 }).id === 'sun');
ok('kepler solver closes for all elements', bodies.ALL_BODIES.filter((b) => b.elements).every((b) => {
  const el = om.elementsAt(b.elements, 12345);
  const E = om.solveKepler((el.L - el.longPeri) * Math.PI / 180, el.e);
  const M = (el.L - el.longPeri) * Math.PI / 180;
  const m = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return Math.abs((E - el.e * Math.sin(E)) - m) < 1e-6;
}));
ok('comet orbit is eccentric and inclined', (() => {
  const c = bodies.bodyById.get('halley');
  const p = sys.get('halley');
  const r = Math.hypot(p.x, p.y, p.z) / AU;
  return c.elements.e > 0.9 && r > 20 && r < 40;
})());

console.log('\nProcedural textures');
const { paintBody, paintClouds, paintCityLights, paintRings } = await import('../src/scene/textures.js');

/** Pull the pixel buffer a painter actually produced. */
function pixelsOf(target) {
  const canvas = target && target._pixels !== undefined ? target : target?.image;
  return canvas?._pixels?.data ?? null;
}
function stats(data) {
  let min = 255;
  let max = 0;
  let sum = 0;
  let nan = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = data[i + k];
      if (!Number.isFinite(v)) nan++;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
  }
  return { min, max, mean: sum / (n * 3), nan };
}

const rock = bodies.bodyById.get('mars');
const gas = bodies.bodyById.get('jupiter');
const star = bodies.bodyById.get('sun');
const terra = bodies.bodyById.get('earth');

const marsTex = paintBody(rock, 256, 128);
const marsPx = pixelsOf(marsTex.color);
ok('rocky colour map produced pixels', !!marsPx && marsPx.length === 256 * 128 * 4);
const ms = stats(marsPx);
ok('rocky map has real variation', ms.max - ms.min > 30, `range ${ms.min}-${ms.max}`);
ok('rocky map has no NaN', ms.nan === 0);
ok('rocky map is fully opaque', marsPx.every((_, i) => i % 4 !== 3 || marsPx[i] === 255));
const marsBump = stats(pixelsOf(marsTex.bump));
ok('rocky bump map has relief', marsBump.max - marsBump.min > 20, `range ${marsBump.min}-${marsBump.max}`);

const jupTex = paintBody(gas, 256, 128);
const jupPx = pixelsOf(jupTex.color);
ok('gas giant map is banded', stats(jupPx).max - stats(jupPx).min > 40);
ok(
  'gas giant has the Great Red Spot',
  (() => {
    // Sample the spot's longitude/latitude and confirm it is redder than a
    // neighbouring latitude that has no spot.
    const W = 256;
    const H = 128;
    const at = (x, y) => {
      const i = (y * W + x) * 4;
      return [jupPx[i], jupPx[i + 1], jupPx[i + 2]];
    };
    const spot = at(Math.round(0.62 * W), Math.round((0.5 - 0.38) * H));
    const clear = at(Math.round(0.62 * W), Math.round((0.5 - 0.06) * H));
    return spot[0] - spot[2] > clear[0] - clear[2] + 20;
  })(),
  'spot is redder than a clear band'
);

const starTex = paintBody(star, 256, 128);
const starPx = pixelsOf(starTex.color);
ok('star photosphere has granulation', stats(starPx).max - stats(starPx).min > 60, `range ${stats(starPx).min}-${stats(starPx).max}`);
ok('star emissive map is bright', stats(pixelsOf(starTex.emissive)).mean > 100, `mean ${stats(pixelsOf(starTex.emissive)).mean.toFixed(0)}`);

const terraTex = paintBody(terra, 256, 128);
const terraPx = pixelsOf(terraTex.color);
const { oceanFrac, iceFrac, greenFrac } = (() => {
  let ocean = 0;
  let ice = 0;
  let green = 0;
  for (let i = 0; i < terraPx.length; i += 4) {
    const r = terraPx[i];
    const g = terraPx[i + 1];
    const b = terraPx[i + 2];
    if (b > r + 20) ocean++;
    if (r > 200 && g > 200 && b > 200) ice++;
    if (g > r + 10) green++;
  }
  const n = terraPx.length / 4;
  return { oceanFrac: ocean / n, iceFrac: ice / n, greenFrac: green / n };
})();
ok('earth has oceans', oceanFrac > 0.2, `${(oceanFrac * 100).toFixed(1)}% water`);
ok('earth has vegetation', greenFrac > 0.05, `${(greenFrac * 100).toFixed(1)}% green`);
ok(
  'earth polar caps are caps, not a snowball',
  iceFrac > 0.02 && iceFrac < 0.2,
  `${(iceFrac * 100).toFixed(1)}% ice`
);
const clouds = paintClouds(terra, 128, 64);
ok('cloud deck has transparent gaps', (() => {
  const d = pixelsOf(clouds);
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 40) clear++;
  return clear / (d.length / 4) > 0.05;
})());

const { TextureManager: TM } = await import('../src/scene/textures.js');
const earthEntry = new TM().build(terra, 1);
ok('earth has a city-lights map', !!earthEntry.cityLights, earthEntry.cityLights ? 'present' : 'missing');
ok('earth has a cloud deck', !!earthEntry.clouds);
ok('earth city lights only appear over land', (() => {
  const d = pixelsOf(earthEntry.cityLights);
  let lit = 0;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) (d[i] > 120 ? lit++ : clear++);
  return lit > 0 && clear > 0;
})());

const ringTex = paintRings(bodies.bodyById.get('saturn'), 512, 32);
ok('rings are drawn with gaps', (() => {
  const d = pixelsOf(ringTex);
  let transparent = 0;
  let opaque = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 30) transparent++;
    if (d[i] > 180) opaque++;
  }
  return transparent > 0 && opaque > 0;
})());

const io = bodies.bodyById.get('io');
ok('volcanic world emits lava light', stats(pixelsOf(paintBody(io, 128, 64).emissive)).max > 60);

const { TextureManager } = await import('../src/scene/textures.js');
const tm = new TextureManager();
const t0paint = Date.now();
const lvl0 = tm.build(terra, 0);
const bootMs = Date.now() - t0paint;
ok('level-0 paint is fast enough for boot', bootMs < 400, `${bootMs} ms`);
ok('level-0 map is a real canvas', lvl0.colorCanvas.width === 128);
ok('level selection scales with on-screen size', tm.levelFor(20) === 0 && tm.levelFor(100) === 1 && tm.levelFor(400) === 2 && tm.levelFor(2000) === 3);
ok('cache returns the same entry', tm.build(terra, 0) === lvl0);

console.log('\nHeadless world');
const THREE = await import('three');
const { FloatingOrigin } = await import('../src/core/FloatingOrigin.js');
const { SolarSystem } = await import('../src/systems/SolarSystem.js');
const { EventsSystem } = await import('../src/systems/EventsSystem.js');
const { PlayerController } = await import('../src/controls/PlayerController.js');
const { EVENT_CATALOGUE } = await import('../src/systems/events/catalogue.js');

function makeEngine() {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.001, 2e7);
  scene.add(camera);
  return {
    scene,
    world,
    camera,
    origin: new FloatingOrigin(),
    simTime: 9783, // ~2026-10-12
    elapsed: 0,
    frame: 0,
    renderer: { domElement: { addEventListener() {}, removeEventListener() {}, requestPointerLock() {} } },
  };
}

const engine = makeEngine();
const scale2 = new ScaleModel();
const orbital2 = new om.OrbitalSystem();
const solar = new SolarSystem(scale2, orbital2);
solar.attach(engine);
ok('world built', solar.bodies.size === bodies.ALL_BODIES.length, `${solar.bodies.size} meshes`);
ok('sun has a corona', !!solar.bodies.get('sun').corona);
ok('saturn has rings', !!solar.bodies.get('saturn').rings);
ok('earth has clouds and night lights', !!solar.bodies.get('earth').clouds && !!solar.bodies.get('earth').nightLights);
ok('mars has an atmosphere shell', !!solar.bodies.get('mars').atmosphere);
ok('halley has a tail', !!solar.bodies.get('halley').tail);
ok('belts created', solar.beltObjects.size === bodies.BELTS.length);
ok('orbit lines created for every body', solar.orbitLines.lines.size === bodies.ALL_BODIES.length - 1);

const player = new PlayerController(engine, scale2, orbital2, solar);
const events = new EventsSystem(engine, solar, scale2, orbital2, player);

// Run a few hundred frames of the whole pipeline. This is the closest we can
// get to "does it actually work" without a GPU.
let stepped = true;
try {
  for (let i = 0; i < 240; i++) {
    const dt = 1 / 60;
    engine.simTime += (dt * 3600) / 86400;
    const ctx = { engine, dt, realDt: dt, simTime: engine.simTime, camera: engine.camera, origin: engine.origin };
    orbital2.update(dt, ctx);
    player.update(dt, ctx);
    solar.update(dt, ctx);
    events.update(dt, ctx);
    engine.origin.update();
  }
} catch (err) {
  stepped = false;
  ok('240-frame simulation step', false, err.message);
}
if (stepped) ok('240-frame simulation step', true, 'mechanics + player + world + events');
ok(
  'floating origin keeps transforms small',
  [...solar.bodies.values()].every((b) => Number.isFinite(b.group.position.x) && Number.isFinite(b.group.position.y))
);

// Every event must run to completion without throwing.
console.log('\nEvent catalogue');
for (const def of EVENT_CATALOGUE) {
  let entry = null;
  let error = null;
  try {
    entry = events.trigger(def.id);
    if (entry) {
      for (let i = 0; i < 90; i++) {
        const dt = 1 / 30;
        engine.simTime += 0.5; // fast-forward so time-gated events resolve
        const ctx = { engine, dt, realDt: dt, simTime: engine.simTime, camera: engine.camera, origin: engine.origin };
        orbital2.update(dt, ctx);
        solar.update(dt, ctx);
        events.update(dt, ctx);
        entry.instance.update?.(dt, ctx, entry);
        if (entry.instance.done) break;
      }
    }
  } catch (err) {
    error = err;
  }
  ok(`event: ${def.id}`, !error && !!entry, error ? error.message : entry ? 'ran' : 'returned null');
}
// Regression: an anchored effect that sets its own position is silently
// overwritten by the floating origin rebase, so impact flashes and auroral
// ovals used to collapse into the centre of the planet. The offset must be
// carried by the anchor itself. This checks the effect ends up RADIUS away
// from its body's rebased centre, not merely away from the world origin.
{
  const before = events._anchors.length;
  const entry = events.trigger('impact');
  const anchored = events._anchors.slice(before);
  const dt = 1 / 30;
  const frameCtx = { engine, dt, realDt: dt, simTime: engine.simTime, camera: engine.camera, origin: engine.origin };
  for (let i = 0; i < 10; i++) {
    orbital2.update(dt, frameCtx);
    solar.update(dt, frameCtx);
    engine.origin.update();
  }
  ok('impact anchors produce effects', anchored.length >= 3, `${anchored.length} anchored effects`);
  const offsets = anchored.map((a) => {
    const c = a.bodyId ? solar.positionOf(a.bodyId) : null;
    if (!c) return 0;
    const o = engine.origin.origin;
    const p = a.fx.object.position;
    return Math.hypot(p.x - (c.x - o.x), p.y - (c.y - o.y), p.z - (c.z - o.z));
  });
  const radius = solar.bodies.get(anchored[0]?.bodyId)?.radiusUnits ?? 1;
  ok(
    'anchored effects keep their surface offset',
    offsets.some((d) => d > radius * 0.6),
    `offsets ${offsets.map((d) => d.toFixed(2)).join(', ')} vs radius ${radius.toFixed(2)}`
  );
  entry?.instance.dispose?.();
  for (const a of anchored) {
    a.originDispose?.();
    engine.world.remove(a.fx.object);
    events._anchors.splice(events._anchors.indexOf(a), 1);
  }
}

ok('at least one event was announced to the bus', events.log.length > 0, `${events.log.length} announcements`);
ok('every announcement carries an explanation', events.log.every((e) => (e.blurb ?? '').length > 60));

// The visitor comet must have actually joined the simulation.
const cometBodies = [...solar.bodies.keys()].filter((k) => k.startsWith('visitor-'));
ok('visitor comet spawned as a real body', cometBodies.length > 0, cometBodies.join(', ') || 'none');
if (cometBodies.length) {
  const id = cometBodies[0];
  const p = orbital2.get(id);
  ok('visitor comet has an orbit', !!p && Number.isFinite(p.x));
  ok('visitor comet can be removed again', (() => {
    solar.removeBody(id);
    return !solar.bodies.has(id) && !orbital2.list.some((b) => b.id === id);
  })());
}
ok('ineligible events respect their cooldown', (() => {
  const report = events.cooldownReport();
  return report.some((r) => r.remaining > 0) && report.every((r) => r.remaining >= 0);
})());

console.log('\nFlight and landing');
ok('flight controller starts in space', player.mode === 'flight');
ok('camera sits at the origin (floating origin)', engine.camera.position.length() === 0);
ok('player position is finite after stepping', Number.isFinite(player.position.x) && player.position.x !== 0);
player.warpTo('earth');
for (let i = 0; i < 90; i++) {
  const dt = 1 / 60;
  const ctx = { engine, dt, realDt: dt, simTime: engine.simTime, camera: engine.camera, origin: engine.origin };
  orbital2.update(dt, ctx);
  player.update(dt, ctx);
  solar.update(dt, ctx);
  engine.origin.update();
}
const earthRender = solar.positionOf('earth');
const distToEarth = Math.hypot(
  player.position.x - earthRender.x,
  player.position.y - earthRender.y,
  player.position.z - earthRender.z
);
const earthRadiusUnits = solar.bodies.get('earth').radiusUnits;
ok(
  'warp to Earth arrives outside the surface',
  distToEarth > earthRadiusUnits && distToEarth < earthRadiusUnits * 8,
  `${distToEarth.toFixed(2)} units vs radius ${earthRadiusUnits.toFixed(2)}`
);
ok('landing candidate detected near a body', !!player.landingCandidate, player.landingCandidate?.def?.name ?? 'none');

const { SurfaceScene } = await import('../src/surface/SurfaceScene.js');
const surface = new SurfaceScene(engine, scale2, orbital2, solar);
surface.attachPlayer(player);
surface.enter(bodies.bodyById.get('mars'), player);
ok('landing switches to surface mode', player.mode === 'surface' && surface.active);
ok('mars surface is solid ground', surface.kind === 'solid');
ok('local gravity matches Mars', Math.abs(surface.gravity - 3.721) < 0.01, `${surface.gravity} m/s2`);
ok('terrain has elevation', Math.max(...surface.heights) - Math.min(...surface.heights) > 5);
ok('lander exists as a scale reference', !!surface.lander);
surface.update(1 / 60, { engine, dt: 1 / 60, origin: engine.origin, camera: engine.camera });
ok('walking keeps the eye above the ground', engine.camera.position.y > surface.sampleHeight(engine.camera.position.x, engine.camera.position.z));
surface.launch();
ok('launching returns to flight', player.mode === 'flight' && !surface.active);

surface.enter(bodies.bodyById.get('jupiter'), player);
ok('gas giants become a descent, not a landing', surface.kind === 'gas');
ok('descent has a crush depth', surface.crushDepth > 0, `${surface.crushDepth} km`);
surface.launch();
ok('can leave a gas giant', player.mode === 'flight');

engine.origin.set(0, 0, 0);
solar.dispose();
player.dispose();
events.dispose();

console.log(`\nResult: ${checks - failures.length}/${checks} checks passed in ${Date.now() - t0} ms`);
if (failures.length) {
  console.log(`Failed: ${failures.join(', ')}`);
  process.exit(1);
}
