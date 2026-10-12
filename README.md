# Orrery

An explorable, educational solar system you can fly through, land on, and watch
misbehave.

Open it and you are in a ship in Earth's neighbourhood. Thrust with **W**, look
with the mouse, **Space** to boost, **X** to dash, **L** to land on whatever you
can reach. Press **M** for the list of worlds, **T** for a guided tour, **/** for
every control.

---

## What is actually in it

**Real data.** Planetary positions come from the JPL/Standish Keplerian element
sets (J2000 epoch with per-century rates), solved properly: Kepler's equation is
iterated to convergence, and the resulting heliocentric positions match the real
sky to within arcminutes between roughly 1800 and 2050. The clock starts at
today's date. Pull up Mars and you are looking at where Mars actually is.

Physical values (radii, masses, gravity, rotation, atmospheres, temperatures)
are from the NASA/JPL planetary fact sheets. The orbital speeds the HUD reports
are computed by finite-differencing the orbit model, and they come out right:
Earth 29.8 km/s, Mercury 47-58 km/s, Neptune 5.4 km/s.

**No asset files.** There is not a single image in this repository. Every
planetary surface, cloud deck, ring system, starfield and star photosphere is
painted procedurally into a canvas at runtime, from a small colour palette plus
noise. That means a new world costs one entry in a data file and no art
whatsoever. Detail is progressive: a small map is painted at boot, and a world is
repainted at up to 2048px when you fly close enough for it to matter.

**Both scales at once.** A 1:1 solar system is unusable (Neptune is 7,700
Sun-widths away) and a "smaller" one is a lie. Orrery does both and blends
continuously between them with one slider: an explore mode where distances are
compressed by a power law so Mercury is a short flight and Neptune stays on the
horizon, and a true scale mode where 1 render unit is exactly 1,000 km. Orbit
*shapes* are preserved because the compression is applied radially. Satellite
orbits get their own transform in the parent's frame, so moons never get crushed
into their planets.

**Nine random phenomena**, each a plugin, each with the science attached:

| Event | What it is |
| --- | --- |
| Solar flare and CME | A real ejection aimed at a real planet; aurorae light up when the front arrives |
| Sunspot maximum | The 11-year magnetic cycle |
| Asteroid impact | Flash, ejecta, shock wave, and a crater that stays on the surface |
| Meteor shower | Streaks radiating from a fixed point, because the debris stream is fixed in space |
| Close approach | Computed by scanning 1200 days forward for the real minimum separation |
| Planetary alignment | Searches forward for the tightest actual alignment of six planets |
| Total solar eclipse | Solved as geometry: when the Sun-Moon line passes within one Earth radius of Earth's centre |
| A comet arrives | A brand new body is built and added to the world at runtime, orbit and all |
| Distant supernova | Where the heavy elements in you came from |

Every one of them announces itself with a caption you can read, and a
screen-reader announcement if narration is on.

**Landing, anywhere.** Landing swaps to a genuinely local scene, because a
planetary surface and a 10-billion-km space need different units. You get
procedural terrain built from the world's own palette, a sky coloured from that
world's real atmosphere record, a Sun whose *angular size* matches the real one
from that distance, the parent planet hanging overhead where applicable, and
local gravity you can feel: a Moon hop is enormous, a Phobos hop is unbounded.
Gas giants have no surface, so descending into one is a descent — with a depth
gauge, and an end.

---

## Accessibility

This was a stated requirement, not an afterthought.

- **Nothing needs a mouse.** Every action has a key, every control is reachable
  by Tab, and the whole flight model works from the keyboard (arrow keys look).
- **The canvas is `aria-hidden`.** All information has a DOM counterpart: live
  distances, the simulated date, speed, altitude, scale mode, running events.
- **Two live regions.** Phenomena are announced politely; things that need
  attention interrupt. Narration can be turned off.
- **`prefers-reduced-motion`** is honoured from the OS and can be overridden; it
  also steadies the physics step.
- **`prefers-contrast: more`** plus an explicit high-contrast mode.
- Visible focus rings, focus trapping in dialogs, a skip link, real `<button>`
  elements, labelled form controls, and a "read aloud" button on every fact
  sheet.
- Facts are printable, because a planetarium handout is useful.

---

## Running it

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build into `dist/` |
| `npm run check` | Both test suites (178 checks) |
| `npm run verify` | Tests plus a production build |

The test suites run headlessly and need no GPU:

- `npm run check:sim` — the dataset, the scale model, orbital mechanics against
  real known speeds, the texture painters (validating actual output pixels), the
  whole world stepping 240 frames, every one of the nine events running to
  completion, flight, warp, landing on solid worlds and descending into gas
  giants.
- `npm run check:ui` — the interface against a real DOM via jsdom: markup wiring,
  the HUD readouts, the world browser, fact sheets, the tour, the settings panel,
  the live regions, and cleanup.

---

## Architecture

```
src/
  core/        Engine, ScaleModel, FloatingOrigin, EventBus, Settings, Registry
  data/        bodies.js — the entire solar system, as data
  scene/       Body, textures, Starfield, Belts, OrbitLines, fx, PostFX
  systems/     OrbitalMechanics, SolarSystem, EventsSystem
  systems/events/  catalogue.js — the nine phenomena
  controls/    PlayerController
  surface/     SurfaceScene
  ui/          Hud, Panels, a11y, styles.css
  util/        math, noise
  main.js
```

Three ideas hold it together:

**Everything is data.** `data/bodies.js` is the solar system. A body record
carries its orbital elements, physical values, educational content, a colour
palette and a terrain description. Mesh, orbit line, label, fact sheet, tour
entry, landing surface and screen-reader description are all derived from it.

**The floating origin.** Distances reach 10^10 km and GPU transforms are 32-bit,
so absolute coordinates would visibly jitter. Every frame the world is rebased
against the camera, which itself never moves: it stays at the origin and the
universe slides past it. Objects register a position provider; nothing else has
to know.

**The event bus.** Systems never reference each other. Add a phenomenon by
appending to `systems/events/catalogue.js`; add a world by appending to
`data/bodies.js`; both appear everywhere else automatically.

### Adding a world

Push one object into `BODIES` in `src/data/bodies.js`:

```js
{
  id: 'kepler-452b',
  name: 'Kepler-452b',
  type: 'planet',
  radiusKm: 9500,
  gravity: 11.2,
  elements: { a: 1.046, e: 0.0, i: 0, L: 200, longPeri: 0, longNode: 0, rates: {} },
  summary: 'A super-Earth in the habitable zone of a Sun-like star…',
  facts: [['Year', '384.8 days'], ['Discovered', '2015, Kepler telescope']],
  visual: { surface: 'terra', palette: ['#123a6b', '#2f6b3a', '#8a7a52', '#f0f4f8'], noise: { seaLevel: 0.5, ice: 0.72 } },
  terrain: { rock: '#6a6a60', dust: '#8f8570', dustAmount: 0.5, sky: ['#5a92d0', '#0b1d33'], metal: 0.1 },
}
```

That is the whole change. It gets a mesh, an orbit, a label, a fact sheet, a
landing surface and a screen-reader description.

For a moon, add `parent` and an `orbit: { distKm, periodDays, inclinationDeg, phase }`.

### Adding a phenomenon

Append to `EVENT_CATALOGUE` in `src/systems/events/catalogue.js`:

```js
{
  id: 'aurora-storm',
  name: 'Geomagnetic storm',
  category: 'sky',
  weight: 3,
  cooldownDays: 20,
  requires: ['earth'],
  blurb: 'The science the viewer should come away with.',
  run(ctx) {
    const fx = createAurora({ radius: 3, height: 2 });
    ctx.events.anchor(fx, { bodyId: 'earth' });   // follows the world
    return {
      update(dt) { fx.update(dt); },
      get done() { return false; },
      dispose() { fx.dispose(); },
    };
  },
}
```

`ctx.events.anchor(fx, { bodyId })` registers an effect with the floating origin
so it tracks a moving world at any distance.

### Deliberate departure from reality

Sunlight does **not** dim with distance in the rendered scene. At true
inverse-square falloff Neptune receives about a thousandth of the light Earth
does and would be invisible. That cheat is documented in the help panel, so the
simulation stays educational rather than quietly misleading.
