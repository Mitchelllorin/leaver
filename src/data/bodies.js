/**
 * The solar system dataset.
 *
 * === HOW TO ADD ANYTHING =====================================================
 * Push another object into BODIES (or IBODIES for a satellite) and it appears
 * in the sim: mesh, orbit, label, info panel, tour entry, landing support and
 * screen-reader description all derive from this record. Nothing else to edit.
 * ============================================================================
 *
 * Orbital elements are the JPL/Standish "approximate positions" set: J2000
 * epoch with per-Julian-century rates, so positions are good to arcminutes
 * over 1800-2050. Angles in degrees, semi-major axis in AU.
 *
 * Physical values follow the NASA/JPL planetary fact sheets.
 */

export const SUN_RADIUS_KM = 696_340;
export const AU_KM = 149_597_870.7;

export const TYPE_COLORS = {
  star: '#ffd27a',
  planet: '#8fd3ff',
  dwarf: '#c9b6ff',
  moon: '#cfd8e3',
  comet: '#a8f0e0',
};

/** Heliocentric bodies (and the star). */
export const BODIES = [
  /* ---------------------------------------------------------------- SUN --- */
  {
    id: 'sun',
    name: 'Sun',
    type: 'star',
    radiusKm: SUN_RADIUS_KM,
    mass: '1.989e30 kg (333,000 Earths)',
    gravity: 274,
    rotationHours: 609.12,
    axialTilt: 7.25,
    surfaceTemp: '5,505 °C surface / 15,000,000 °C core',
    composition: '73% hydrogen, 25% helium, 2% heavier elements',
    summary:
      "A G-type main-sequence star holding 99.86% of the solar system's mass. Light takes 8 minutes 20 seconds to reach Earth.",
    facts: [
      ['Type', 'G2V yellow dwarf'],
      ['Radius', '696,340 km (109 x Earth)'],
      ['Mass', '99.86% of the solar system'],
      ['Core temperature', '~15,000,000 °C'],
      ['Power', 'Fuses ~600 million tonnes of hydrogen per second'],
      ['Age', '~4.6 billion years'],
      ['Light travel to Earth', '8 min 20 s'],
    ],
    visual: {
      surface: 'star',
      palette: ['#fff6d5', '#ffd166', '#ff9d2e', '#ff6b1a'],
      emissive: 1.0,
      corona: { color: '#ffb45c', scale: 2.6, opacity: 0.24 },
      noise: { scale: 3.2, contrast: 0.55, speed: 0.05 },
    },
    terrain: { rock: '#c9a26b', dust: '#e0b878', dustAmount: 0.4, sky: ['#2b1a0a', '#0a0503'], metal: 0, star: true },
  },

  /* ------------------------------------------------------------ MERCURY --- */
  {
    id: 'mercury',
    name: 'Mercury',
    type: 'planet',
    radiusKm: 2439.7,
    mass: '3.301e23 kg (0.055 Earths)',
    gravity: 3.7,
    rotationHours: 1407.6,
    axialTilt: 0.034,
    surfaceTemp: '-173 °C to 427 °C',
    composition: 'Iron core filling 85% of its radius, thin silicate crust',
    atmosphere: { color: '#b8a998', heightKm: 60, rim: 0.06, pressure: '~0 Pa (trace exosphere)' },
    elements: {
      a: 0.38709927, e: 0.20563593, i: 7.00497902, L: 252.2503235,
      longPeri: 77.45779628, longNode: 48.33076593,
      rates: { a: 0.00000037, e: 0.00001906, i: -0.00594749, L: 149472.67411175, longPeri: 0.16047689, longNode: -0.12534081 },
    },
    summary:
      'The smallest planet and the fastest, lapping the Sun every 88 days. With almost no atmosphere its surface swings between scorching day and freezing night.',
    facts: [
      ['Year', '87.97 Earth days'],
      ['Day (solar)', '176 Earth days'],
      ['Moons', 'None'],
      ['Surface', 'Cratered and iron-rich, like our Moon'],
      ['Name', 'Roman messenger god, for its speed'],
    ],
    visual: {
      surface: 'rocky',
      palette: ['#8c8378', '#6f675e', '#a99e90', '#544d46'],
      noise: { scale: 5.5, contrast: 0.7, craters: 90 },
      roughness: 0.95, metalness: 0.02,
    },
    terrain: { rock: '#6f675e', dust: '#9d9385', dustAmount: 0.5, sky: ['#000000', '#050505'], metal: 0.05, meteorRate: 4 },
  },

  /* -------------------------------------------------------------- VENUS --- */
  {
    id: 'venus',
    name: 'Venus',
    type: 'planet',
    radiusKm: 6051.8,
    mass: '4.867e24 kg (0.815 Earths)',
    gravity: 8.87,
    rotationHours: -5832.5,
    axialTilt: 177.36,
    surfaceTemp: '464 °C — hottest planet',
    composition: '96.5% CO2, 3.5% N2, sulfuric acid clouds',
    atmosphere: { color: '#f6d9a0', heightKm: 250, rim: 0.55, pressure: '92 bar' },
    elements: {
      a: 0.72333566, e: 0.00677672, i: 3.39467605, L: 181.9790995,
      longPeri: 131.60246718, longNode: 76.67984255,
      rates: { a: 0.0000039, e: -0.00004107, i: -0.0007889, L: 58517.81538729, longPeri: 0.00268329, longNode: -0.27769418 },
    },
    summary:
      "Earth's twin gone wrong. A runaway greenhouse effect traps heat under permanent sulfuric-acid clouds, so Venus is hotter than Mercury despite being twice as far from the Sun.",
    facts: [
      ['Year', '224.7 Earth days'],
      ['Day', '243 Earth days, retrograde — the Sun rises in the west'],
      ['Surface pressure', '92 x Earth'],
      ['Surface temperature', '464 °C'],
      ['Moons', 'None'],
      ['Cloud winds', 'Super-rotating at 360 km/h'],
    ],
    visual: {
      surface: 'gas',
      palette: ['#f3dcae', '#e8c88b', '#f7e8c2', '#d9b06d'],
      bands: 7, bandWarp: 0.35,
      noise: { scale: 2.4, contrast: 0.35, speed: 0.06 },
      roughness: 0.8, metalness: 0,
    },
    terrain: { rock: '#b09868', dust: '#e2c98f', dustAmount: 0.9, sky: ['#d8b871', '#4a3416'], metal: 0.03, acidRain: true },
  },

  /* -------------------------------------------------------------- EARTH --- */
  {
    id: 'earth',
    name: 'Earth',
    type: 'planet',
    radiusKm: 6371,
    mass: '5.972e24 kg',
    gravity: 9.807,
    rotationHours: 23.934,
    axialTilt: 23.44,
    surfaceTemp: '-89 °C to 58 °C, average 15 °C',
    composition: '78% N2, 21% O2, 0.9% Ar, 0.04% CO2',
    atmosphere: { color: '#7fb6ff', heightKm: 120, rim: 0.9, pressure: '1.013 bar' },
    elements: {
      a: 1.00000261, e: 0.01671123, i: -0.00001531, L: 100.46457166,
      longPeri: 102.93768193, longNode: 0,
      rates: { a: 0.00000562, e: -0.00004392, i: -0.01294668, L: 35999.37244981, longPeri: 0.32327364, longNode: 0 },
    },
    summary:
      'The only world known to host life, and the only place with abundant liquid water on the surface. 71% ocean, wrapped in a nitrogen-oxygen atmosphere.',
    facts: [
      ['Year', '365.256 days'],
      ['Day', '23 h 56 m 4 s'],
      ['Axial tilt', '23.44° — this is why we have seasons'],
      ['Moons', '1 — the Moon'],
      ['Surface', '71% water, 29% land'],
      ['Life', 'The only known inhabited world'],
    ],
    visual: {
      surface: 'terra',
      palette: ['#1b4f8c', '#2e7d32', '#8d6e46', '#f2f2f2'],
      noise: { scale: 3.1, contrast: 0.6, ice: 0.76, seaLevel: 0.5 },
      roughness: 0.85, metalness: 0.02,
      cityLights: true,
      clouds: { color: '#ffffff', opacity: 0.38, scale: 2.2, speed: 0.012 },
    },
    terrain: { rock: '#6b6b63', dust: '#8a7f6d', dustAmount: 0.4, sky: ['#4a90e2', '#0b1d33'], metal: 0.1, vegetation: true, ocean: true },
  },

  /* --------------------------------------------------- EARTH'S MOON ------- */
  {
    id: 'luna', name: 'Moon', type: 'moon', parent: 'earth',
    radiusKm: 1737.4, mass: '7.342e22 kg', gravity: 1.62,
    rotationHours: 655.7, axialTilt: 6.68,
    surfaceTemp: '-173 °C to 127 °C',
    composition: 'Anorthositic crust over a small iron core',
    orbit: { distKm: 384_400, periodDays: 27.322, inclinationDeg: 5.145, phase: 218 },
    summary:
      "Earth's companion and the only other world humans have walked on. Tidally locked, so the same face always points at us. It stabilises Earth's axial tilt and drives the tides.",
    facts: [
      ['Distance', '384,400 km — light takes 1.3 s'],
      ['Orbit', '27.32 days, tidally locked'],
      ['Receding', '3.8 cm per year'],
      ['Visitors', '12 humans, Apollo 11-17, 1969-1972'],
      ['Formed', '~4.5 bn years ago from a Mars-sized impact'],
    ],
    visual: {
      surface: 'rocky',
      palette: ['#b8b3ac', '#8f8a83', '#d8d4cc', '#6b6660'],
      noise: { scale: 5, contrast: 0.8, craters: 140, maria: 0.35 },
      roughness: 0.96, metalness: 0.01,
    },
    terrain: { rock: '#8f8a83', dust: '#c2bdb5', dustAmount: 0.6, sky: ['#000000', '#010206'], metal: 0.12, meteorRate: 6, lowGravity: 1.62 },
  },

  /* --------------------------------------------------------------- MARS --- */
  {
    id: 'mars',
    name: 'Mars',
    type: 'planet',
    radiusKm: 3389.5,
    mass: '6.417e23 kg (0.107 Earths)',
    gravity: 3.721,
    rotationHours: 24.623,
    axialTilt: 25.19,
    surfaceTemp: '-153 °C to 20 °C',
    composition: '95% CO2, 2.6% N2, 1.9% Ar',
    atmosphere: { color: '#d98a6a', heightKm: 90, rim: 0.35, pressure: '0.006 bar' },
    elements: {
      a: 1.52371034, e: 0.0933941, i: 1.84969142, L: -4.55343205,
      longPeri: -23.94362959, longNode: 49.55953891,
      rates: { a: 0.00001847, e: 0.00007882, i: -0.00813131, L: 19140.30268499, longPeri: 0.44441088, longNode: -0.29257343 },
    },
    summary:
      'The rusty world. Mars hosts Olympus Mons, the tallest volcano in the solar system at 22 km, and Valles Marineris, a canyon 4,000 km long. Ancient riverbeds show water once flowed here.',
    facts: [
      ['Year', '686.98 Earth days'],
      ['Day', '24 h 37 m'],
      ['Moons', '2 — Phobos and Deimos'],
      ['Olympus Mons', '22 km tall, 2.5 x Everest'],
      ['Valles Marineris', '4,000 km long, 7 km deep'],
      ['Water', 'Polar ice caps and subsurface ice'],
    ],
    visual: {
      surface: 'rocky',
      palette: ['#b5562f', '#8a3d22', '#d97a4a', '#5e2a17'],
      noise: { scale: 3.8, contrast: 0.65, craters: 60, ice: 0.84 },
      roughness: 0.92, metalness: 0.02,
    },
    terrain: { rock: '#8a3d22', dust: '#c1653a', dustAmount: 1.0, sky: ['#d9a074', '#3a1d12'], metal: 0.04, dustStorms: true },
  },

  {
    id: 'phobos', name: 'Phobos', type: 'moon', parent: 'mars',
    radiusKm: 11.27, mass: '1.07e16 kg', gravity: 0.0057,
    rotationHours: 7.65, axialTilt: 0, surfaceTemp: '-40 °C',
    composition: 'Carbonaceous rock, very porous',
    orbit: { distKm: 9376, periodDays: 0.3189, inclinationDeg: 1.08, phase: 40 },
    summary:
      'A lumpy, cratered moonlet spiralling inwards. In about 50 million years it will crash into Mars or shatter into a ring. Gravity is so weak you could jump into orbit.',
    facts: [
      ['Orbit', '7 h 39 m — rises in the west, twice a Martian day'],
      ['Lifetime', '~50 million years before it is destroyed'],
      ['Gravity', '1/1500 of Earth'],
      ['Stickney crater', '9 km wide, half the moon itself'],
    ],
    visual: {
      surface: 'rocky',
      palette: ['#6f665c', '#544d45', '#8a8073', '#3e3831'],
      noise: { scale: 7, contrast: 0.85, craters: 90 },
      roughness: 0.97, metalness: 0.01,
    },
    terrain: { rock: '#544d45', dust: '#7a7166', dustAmount: 0.5, sky: ['#000000', '#0a0402'], metal: 0.08, lowGravity: 0.0057, parentSky: 'mars', meteorRate: 5 },
  },
  {
    id: 'deimos', name: 'Deimos', type: 'moon', parent: 'mars',
    radiusKm: 6.2, mass: '1.48e15 kg', gravity: 0.003,
    rotationHours: 30.3, axialTilt: 0, surfaceTemp: '-40 °C',
    composition: 'Carbonaceous rock',
    orbit: { distKm: 23_463, periodDays: 1.263, inclinationDeg: 1.79, phase: 200 },
    summary:
      'The smaller, smoother Martian moon. Regolith has filled in its craters, making it look younger than it is.',
    facts: [
      ['Orbit', '30.3 hours'],
      ['Size', '15 x 12 x 11 km'],
      ['Gravity', '1/2500 of Earth'],
    ],
    visual: {
      surface: 'rocky',
      palette: ['#756b60', '#5c534a', '#8f8578', '#463f38'],
      noise: { scale: 7, contrast: 0.7, craters: 60 },
      roughness: 0.97, metalness: 0.01,
    },
    terrain: { rock: '#5c534a', dust: '#80766a', dustAmount: 0.5, sky: ['#000000', '#0a0402'], metal: 0.08, lowGravity: 0.003, parentSky: 'mars' },
  },

  /* -------------------------------------------------------------- CERES --- */
  {
    id: 'ceres',
    name: 'Ceres',
    type: 'dwarf',
    radiusKm: 469.7,
    mass: '9.38e20 kg',
    gravity: 0.28,
    rotationHours: 9.074,
    axialTilt: 4,
    surfaceTemp: '-105 °C average',
    composition: 'Rock-ice mantle with subsurface brine',
    elements: {
      a: 2.7675, e: 0.0757, i: 10.593, L: 95.9891,
      longPeri: 73.5977, longNode: 80.3055,
      rates: { a: 0, e: 0.0000001, i: 0.0001, L: 78.19, longPeri: 0.0002, longNode: -0.0005 },
    },
    summary:
      "The largest object in the asteroid belt and the only dwarf planet in the inner solar system. Bright salt deposits at Occator crater hint at a briny ocean below.",
    facts: [
      ['Year', '4.6 Earth years'],
      ['Diameter', '939 km — a quarter of the belt\'s mass'],
      ['Discovered', '1801, by Giuseppe Piazzi'],
      ['Ocean', 'Possible subsurface brine reservoir'],
      ['Visited by', 'Dawn, in orbit 2015-2018'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#8c8c8c', '#6b6b6b', '#b0b0b0', '#4f4f4f'],
      noise: { scale: 6, contrast: 0.75, craters: 70 },
      roughness: 0.9, metalness: 0.05,
    },
    terrain: { rock: '#6b6b6b', dust: '#9a9a9a', dustAmount: 0.6, sky: ['#000000', '#02030a'], metal: 0.2, lowGravity: 0.28 },
  },

  /* ------------------------------------------------------------ JUPITER --- */
  {
    id: 'jupiter',
    name: 'Jupiter',
    type: 'planet',
    radiusKm: 69_911,
    mass: '1.898e27 kg (317.8 Earths)',
    gravity: 24.79,
    rotationHours: 9.925,
    axialTilt: 3.13,
    surfaceTemp: '-108 °C at the cloud tops',
    composition: '90% hydrogen, 10% helium, ammonia and water clouds',
    atmosphere: { color: '#e8c9a0', heightKm: 500, rim: 0.5, pressure: 'No surface; 1000 bar at depth' },
    rings: { inner: 1.4, outer: 1.81, color: '#8a7761', opacity: 0.12 },
    elements: {
      a: 5.202887, e: 0.04838624, i: 1.30439695, L: 34.39644051,
      longPeri: 14.72847983, longNode: 100.47390909,
      rates: { a: -0.00011607, e: -0.00013253, i: -0.00183714, L: 3034.74612775, longPeri: 0.21252668, longNode: 0.20469106 },
    },
    summary:
      "A failed star and the solar system's vacuum cleaner. Jupiter holds 2.5 times the mass of every other planet combined, shapes the asteroid belt and shields the inner worlds from comets. The Great Red Spot is a storm wider than Earth that has raged for centuries.",
    facts: [
      ['Year', '11.86 Earth years'],
      ['Day', '9 h 56 m — the fastest spinning planet'],
      ['Mass', '2.5 x all other planets combined'],
      ['Great Red Spot', 'Storm 1.3 x Earth wide, 350+ years old'],
      ['Moons', '95 confirmed'],
      ['Magnetic field', '20,000 x stronger than Earth\'s'],
      ['Visited by', 'Pioneer, Voyager, Galileo, Juno'],
    ],
    visual: {
      surface: 'gas',
      palette: ['#d8b98a', '#b8875c', '#f0dcc0', '#8a5c3b', '#e8cfae'],
      bands: 18, bandWarp: 0.9, spot: true,
      noise: { scale: 2.0, contrast: 0.4, speed: 0.09 },
      roughness: 0.85, metalness: 0,
    },
    terrain: { rock: '#8a5c3b', dust: '#d8b98a', dustAmount: 1.0, sky: ['#e0c092', '#3a2a18'], metal: 0, gasGiant: true, crushDepth: 500 },
  },

  /* ------------------------------------------------------------- SATURN --- */
  {
    id: 'saturn',
    name: 'Saturn',
    type: 'planet',
    radiusKm: 58_232,
    mass: '5.683e26 kg (95.2 Earths)',
    gravity: 10.44,
    rotationHours: 10.656,
    axialTilt: 26.73,
    surfaceTemp: '-139 °C',
    composition: '96% hydrogen, 3% helium',
    atmosphere: { color: '#f0e0b0', heightKm: 600, rim: 0.4, pressure: 'No solid surface' },
    rings: {
      inner: 1.24, outer: 2.35, color: '#e3d3ab', opacity: 0.85,
      detail: [
        { from: 1.24, to: 1.53, opacity: 0.35 },
        { from: 1.53, to: 1.95, opacity: 0.95 },
        { from: 1.95, to: 2.03, opacity: 0.15 },
        { from: 2.03, to: 2.27, opacity: 0.6 },
      ],
    },
    elements: {
      a: 9.53667594, e: 0.05386179, i: 2.48599187, L: 49.95424423,
      longPeri: 92.59887831, longNode: 113.66242448,
      rates: { a: -0.0012506, e: -0.00050991, i: 0.00193609, L: 1222.49362201, longPeri: -0.41897216, longNode: -0.28867794 },
    },
    summary:
      "The jewel of the solar system. Saturn's rings span 280,000 km but average only ten metres thick, made of countless chunks of nearly pure water ice. The planet's density is so low it would float in water.",
    facts: [
      ['Year', '29.46 Earth years'],
      ['Day', '10 h 39 m'],
      ['Density', '0.687 g/cm³ — less than water'],
      ['Rings', 'Span 280,000 km, only ~10 m thin'],
      ['Moons', '146 confirmed'],
      ['Hexagon', 'A 30,000 km hexagonal jet stream at the north pole'],
      ['Visited by', 'Pioneer 11, Voyagers 1 and 2, Cassini-Huygens'],
    ],
    visual: {
      surface: 'gas',
      palette: ['#f2e2b6', '#dcc48a', '#f7eecf', '#c9a86a'],
      bands: 14, bandWarp: 0.4,
      noise: { scale: 1.6, contrast: 0.3, speed: 0.07 },
      roughness: 0.88, metalness: 0,
    },
    terrain: { rock: '#dcc48a', dust: '#f2e2b6', dustAmount: 1.0, sky: ['#f0e0b0', '#4a3a20'], metal: 0, gasGiant: true, iceGrains: true },
  },

  /* ------------------------------------------------------------- URANUS --- */
  {
    id: 'uranus',
    name: 'Uranus',
    type: 'planet',
    radiusKm: 25_362,
    mass: '8.681e25 kg (14.5 Earths)',
    gravity: 8.69,
    rotationHours: -17.24,
    axialTilt: 97.77,
    surfaceTemp: '-197 °C',
    composition: '83% hydrogen, 15% helium, 2% methane — an ice giant',
    atmosphere: { color: '#a8e6ea', heightKm: 400, rim: 0.55, pressure: 'No solid surface' },
    rings: { inner: 1.64, outer: 1.95, color: '#5a6b70', opacity: 0.25 },
    elements: {
      a: 19.18916464, e: 0.04725744, i: 0.77263783, L: 313.23810451,
      longPeri: 170.9542763, longNode: 74.01692503,
      rates: { a: -0.00196176, e: -0.00004397, i: -0.00242939, L: 428.48202785, longPeri: 0.40805281, longNode: 0.04240589 },
    },
    summary:
      'The sideways planet. Uranus is tipped 98°, so it rolls around the Sun like a barrel, giving each pole 42 years of continuous sunlight and then 42 years of darkness. Methane in its atmosphere absorbs red light, which is why it looks cyan.',
    facts: [
      ['Year', '84 Earth years'],
      ['Day', '17 h 14 m, retrograde'],
      ['Axial tilt', '97.8° — it orbits on its side'],
      ['Coldest', '-224 °C, the coldest atmosphere measured'],
      ['Discovered', '1781, by William Herschel'],
      ['Moons', '28, named after Shakespeare and Pope characters'],
    ],
    visual: {
      surface: 'gas',
      palette: ['#bce8ec', '#9fd6dd', '#d6f2f4', '#86c2cc'],
      bands: 6, bandWarp: 0.12,
      noise: { scale: 1.4, contrast: 0.2, speed: 0.04 },
      roughness: 0.9, metalness: 0,
    },
    terrain: { rock: '#9fd6dd', dust: '#cbe9ec', dustAmount: 1.0, sky: ['#bce8ec', '#20444a'], metal: 0, gasGiant: true },
  },

  /* ------------------------------------------------------------ NEPTUNE --- */
  {
    id: 'neptune',
    name: 'Neptune',
    type: 'planet',
    radiusKm: 24_622,
    mass: '1.024e26 kg (17.1 Earths)',
    gravity: 11.15,
    rotationHours: 16.11,
    axialTilt: 28.32,
    surfaceTemp: '-201 °C',
    composition: '80% hydrogen, 19% helium, 1.5% methane',
    atmosphere: { color: '#5b7ff0', heightKm: 400, rim: 0.6, pressure: 'No solid surface' },
    rings: { inner: 1.7, outer: 2.5, color: '#4a5570', opacity: 0.15 },
    elements: {
      a: 30.06992276, e: 0.00859048, i: 1.77004347, L: -55.12002969,
      longPeri: 44.96476227, longNode: 131.78422574,
      rates: { a: 0.00026291, e: 0.00005105, i: 0.00035372, L: 218.45945325, longPeri: -0.32241464, longNode: -0.00508664 },
    },
    summary:
      'The windiest world. Neptune was found by mathematics before anyone saw it: Le Verrier predicted its position from wobbles in the orbit of Uranus. Supersonic winds reach 2,100 km/h.',
    facts: [
      ['Year', '164.8 Earth years'],
      ['Day', '16 h 6 m'],
      ['Winds', 'Up to 2,100 km/h, the fastest known'],
      ['Discovered', '1846, predicted mathematically first'],
      ['Moons', '16, the largest being Triton'],
      ['Only visit', 'Voyager 2, in 1989'],
      ['One orbit since discovery', 'Completed in 2011'],
    ],
    visual: {
      surface: 'gas',
      palette: ['#4f6ee0', '#3a55c4', '#7d9bff', '#2c3f9e'],
      bands: 8, bandWarp: 0.5, darkSpot: true,
      noise: { scale: 1.8, contrast: 0.28, speed: 0.11 },
      roughness: 0.88, metalness: 0,
    },
    terrain: { rock: '#3a55c4', dust: '#7d9bff', dustAmount: 1.0, sky: ['#5b7ff0', '#0a1030'], metal: 0, gasGiant: true, stormWinds: true },
  },

  /* -------------------------------------------------------------- PLUTO --- */
  {
    id: 'pluto',
    name: 'Pluto',
    type: 'dwarf',
    radiusKm: 1188.3,
    mass: '1.303e22 kg (0.0022 Earths)',
    gravity: 0.62,
    rotationHours: -153.3,
    axialTilt: 122.53,
    surfaceTemp: '-229 °C',
    composition: 'Nitrogen and methane ices over a rocky core',
    atmosphere: { color: '#cbb8a0', heightKm: 200, rim: 0.12, pressure: '1 Pa, seasonal' },
    elements: {
      a: 39.48211675, e: 0.2488273, i: 17.14001206, L: 238.92903833,
      longPeri: 224.06891629, longNode: 110.30393684,
      rates: { a: -0.00031596, e: 0.0000517, i: 0.00004818, L: 145.20780515, longPeri: -0.04062942, longNode: -0.01183482 },
    },
    summary:
      "The most famous dwarf planet. New Horizons revealed a heart-shaped nitrogen glacier, 3,500 m ice mountains and a hazy blue atmosphere. Pluto's orbit is so eccentric that it sometimes comes closer to the Sun than Neptune.",
    facts: [
      ['Year', '248 Earth years'],
      ['Day', '6.4 Earth days'],
      ['Moon', 'Charon — half the size of Pluto; they orbit a shared point'],
      ['Discovered', '1930, by Clyde Tombaugh'],
      ['Reclassified', '2006, as a dwarf planet'],
      ['Sputnik Planitia', 'Heart-shaped nitrogen glacier'],
      ['Visited', 'New Horizons flyby, 2015'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#c9b096', '#a8906f', '#e8dcc8', '#7a6650'],
      noise: { scale: 4, contrast: 0.55, craters: 30 },
      roughness: 0.9, metalness: 0.03,
    },
    terrain: { rock: '#a8906f', dust: '#d8c8ac', dustAmount: 0.8, sky: ['#6a7a9a', '#0a0a12'], metal: 0.05, lowGravity: 0.62 },
  },

  /* --------------------------------------------------------------- ERIS --- */
  {
    id: 'eris',
    name: 'Eris',
    type: 'dwarf',
    radiusKm: 1163,
    mass: '1.66e22 kg',
    gravity: 0.82,
    rotationHours: 378,
    axialTilt: 78,
    surfaceTemp: '-243 °C',
    composition: 'Methane ice over rock',
    elements: {
      a: 67.78, e: 0.44, i: 44.04, L: 205.98,
      longPeri: 151.6, longNode: 35.95,
      rates: { a: 0, e: 0, i: 0, L: 0.014, longPeri: 0, longNode: 0 },
    },
    summary:
      'The troublemaker. Eris is slightly more massive than Pluto, and its discovery in 2005 forced astronomers to define what "planet" means, which is how Pluto got demoted.',
    facts: [
      ['Year', '558 Earth years'],
      ['Diameter', '2,326 km — nearly Pluto-sized'],
      ['Distance', '3 x further out than Pluto at aphelion'],
      ['Moon', 'Dysnomia'],
      ['Consequence', 'Triggered the 2006 planet definition debate'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#dfe3e6', '#b8bec4', '#f2f5f7', '#8f979e'],
      noise: { scale: 5, contrast: 0.4, craters: 25 },
      roughness: 0.85, metalness: 0.02,
    },
    terrain: { rock: '#b8bec4', dust: '#e6eaee', dustAmount: 0.7, sky: ['#0b0f18', '#000000'], metal: 0.05, lowGravity: 0.82 },
  },

  /* ------------------------------------------------- JUPITER'S GALILEANS -- */
  {
    id: 'io', name: 'Io', type: 'moon', parent: 'jupiter',
    radiusKm: 1821.6, mass: '8.932e22 kg', gravity: 1.796,
    rotationHours: 42.46, axialTilt: 0, surfaceTemp: '-163 °C to 1,600 °C',
    composition: 'Sulfur and silicate rock over a molten interior',
    orbit: { distKm: 421_700, periodDays: 1.769, inclinationDeg: 0.05, phase: 120 },
    summary:
      "The most volcanically active body in the solar system. Tidal flexing from Jupiter and its sibling moons melts Io's interior, driving 400 volcanoes that fling sulfur 500 km into space.",
    facts: [
      ['Orbit', '1.77 days'],
      ['Volcanoes', '400+, with lava fountains 500 km high'],
      ['Surface', 'Constantly repaved by sulfur fall-out'],
      ['Tidal bulge', 'Rises and falls 100 m every orbit'],
      ['Discovered', '1610, by Galileo Galilei'],
    ],
    visual: {
      surface: 'volcanic',
      palette: ['#f5e04a', '#e07b28', '#b03a1a', '#f7f0a0'],
      noise: { scale: 4, contrast: 0.7, craters: 10, lava: true },
      roughness: 0.85, metalness: 0.02, emissive: 0.6,
    },
    terrain: { rock: '#e07b28', dust: '#f7e88a', dustAmount: 0.9, sky: ['#2a1a08', '#0a0502'], metal: 0.05, lava: true, parentSky: 'jupiter', lowGravity: 1.796 },
  },
  {
    id: 'europa', name: 'Europa', type: 'moon', parent: 'jupiter',
    radiusKm: 1560.8, mass: '4.8e22 kg', gravity: 1.315,
    rotationHours: 85.2, axialTilt: 0.1, surfaceTemp: '-160 °C',
    composition: 'Water-ice shell 15-25 km thick over a global saltwater ocean',
    orbit: { distKm: 671_034, periodDays: 3.551, inclinationDeg: 0.47, phase: 300 },
    summary:
      "The best place to look for life beyond Earth. Beneath a smooth ice shell lies a global saltwater ocean holding twice the water of all Earth's oceans, kept liquid by tidal heating.",
    facts: [
      ['Orbit', '3.55 days'],
      ['Ocean', '60-150 km deep, twice Earth\'s water'],
      ['Surface', 'Youngest in the solar system — essentially no craters'],
      ['Ice shell', '15-25 km thick'],
      ['Missions', 'Europa Clipper arrived 2030; ESA JUICE en route'],
    ],
    visual: {
      surface: 'ice',
      palette: ['#e8f1f7', '#c3d6e6', '#f7fbfe', '#9fb6c9'],
      noise: { scale: 4.5, contrast: 0.3, craters: 6, cracks: 0.9 },
      roughness: 0.35, metalness: 0.05,
    },
    terrain: { rock: '#c3d6e6', dust: '#eef5fa', dustAmount: 0.4, sky: ['#0a0a12', '#000000'], metal: 0.2, ice: true, parentSky: 'jupiter', lowGravity: 1.315 },
  },
  {
    id: 'ganymede', name: 'Ganymede', type: 'moon', parent: 'jupiter',
    radiusKm: 2634.1, mass: '1.481e23 kg', gravity: 1.428,
    rotationHours: 171.7, axialTilt: 0.33, surfaceTemp: '-163 °C',
    composition: 'Ice and silicate rock with a liquid iron core',
    orbit: { distKm: 1_070_412, periodDays: 7.155, inclinationDeg: 0.2, phase: 60 },
    summary:
      "The largest moon in the solar system, bigger than Mercury, and the only moon with its own magnetic field. A subsurface ocean may hold more water than all of Earth's surface.",
    facts: [
      ['Orbit', '7.15 days'],
      ['Size', 'Bigger than Mercury'],
      ['Magnetic field', 'The only moon with one'],
      ['Ocean', 'Buried about 150 km down'],
      ['Discovered', '1610, by Galileo Galilei'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#a8a49c', '#7d7972', '#c9c5bd', '#5e5a54'],
      noise: { scale: 5, contrast: 0.65, craters: 50, grooves: 0.7 },
      roughness: 0.8, metalness: 0.03,
    },
    terrain: { rock: '#7d7972', dust: '#b3afa7', dustAmount: 0.6, sky: ['#000000', '#05040a'], metal: 0.1, ice: true, parentSky: 'jupiter', lowGravity: 1.428 },
  },
  {
    id: 'callisto', name: 'Callisto', type: 'moon', parent: 'jupiter',
    radiusKm: 2410.3, mass: '1.076e23 kg', gravity: 1.235,
    rotationHours: 400.5, axialTilt: 0, surfaceTemp: '-139 °C',
    composition: 'Undifferentiated ice-rock mixture',
    orbit: { distKm: 1_882_709, periodDays: 16.689, inclinationDeg: 0.19, phase: 240 },
    summary:
      "The most heavily cratered object known: its surface is 4 billion years old and saturated with impacts. Sitting outside Jupiter's worst radiation belts, it is a leading candidate for a human outpost.",
    facts: [
      ['Orbit', '16.69 days'],
      ['Surface age', '~4 billion years'],
      ['Craters', 'Most cratered object known'],
      ['Radiation', 'Lowest of the Galilean moons'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#7a7268', '#5a5450', '#9a9186', '#413d39'],
      noise: { scale: 5.5, contrast: 0.8, craters: 120 },
      roughness: 0.9, metalness: 0.02,
    },
    terrain: { rock: '#5a5450', dust: '#857c71', dustAmount: 0.6, sky: ['#000000', '#04040a'], metal: 0.1, ice: true, parentSky: 'jupiter', lowGravity: 1.235 },
  },

  /* --------------------------------------------------------- SATURN'S ---- */
  {
    id: 'titan', name: 'Titan', type: 'moon', parent: 'saturn',
    radiusKm: 2574.7, mass: '1.345e23 kg', gravity: 1.352,
    rotationHours: 382.7, axialTilt: 0.35, surfaceTemp: '-179 °C',
    composition: '95% nitrogen, 5% methane atmosphere over water-ice bedrock',
    atmosphere: { color: '#e8a447', heightKm: 600, rim: 0.7, pressure: '1.45 bar' },
    orbit: { distKm: 1_221_870, periodDays: 15.945, inclinationDeg: 0.33, phase: 150 },
    summary:
      'The only moon with a thick atmosphere, and the only place besides Earth with liquid on its surface — but those seas and rivers are methane and ethane. Its orange haze hides dunes and cryovolcanoes.',
    facts: [
      ['Orbit', '15.95 days'],
      ['Atmosphere', '1.45 bar, thicker than Earth\'s'],
      ['Lakes', 'Liquid methane and ethane seas'],
      ['Landing', 'Huygens probe, 14 January 2005'],
      ['Mission planned', 'Dragonfly rotorcraft'],
    ],
    visual: {
      surface: 'hazy',
      palette: ['#e0a24c', '#c07f30', '#f0c070', '#8a5a1e'],
      noise: { scale: 2.2, contrast: 0.3, craters: 5 },
      roughness: 0.9, metalness: 0,
    },
    terrain: { rock: '#8a6a3a', dust: '#d9a45c', dustAmount: 0.7, sky: ['#e8a447', '#6a4413'], metal: 0.05, methaneLakes: true, parentSky: 'saturn' },
  },
  {
    id: 'enceladus', name: 'Enceladus', type: 'moon', parent: 'saturn',
    radiusKm: 252.1, mass: '1.08e20 kg', gravity: 0.113,
    rotationHours: 32.9, axialTilt: 0, surfaceTemp: '-198 °C',
    composition: 'Nearly pure water ice over a salty ocean',
    orbit: { distKm: 237_948, periodDays: 1.37, inclinationDeg: 0.009, phase: 20 },
    summary:
      "A tiny, brilliant ice moon that vents geysers of water vapour and organic molecules from its south pole, feeding Saturn's E ring. Cassini flew straight through the plumes and tasted an ocean.",
    facts: [
      ['Orbit', '1.37 days'],
      ['Albedo', '0.99 — the most reflective body known'],
      ['Geysers', '100+ plumes at the south pole'],
      ['Ocean', 'Confirmed by Cassini gravity data'],
      ['Key find', 'Hydrogen and organic molecules in the plumes'],
    ],
    visual: {
      surface: 'ice',
      palette: ['#f7fbff', '#dceaf5', '#ffffff', '#bcd2e2'],
      noise: { scale: 5, contrast: 0.3, craters: 40, tigerStripes: 0.8 },
      roughness: 0.3, metalness: 0.03,
    },
    terrain: { rock: '#cfe0ec', dust: '#f2f9ff', dustAmount: 0.3, sky: ['#000000', '#02030a'], metal: 0.15, ice: true, geysers: true, lowGravity: 0.113, parentSky: 'saturn' },
  },

  /* --------------------------------------------------------- URANUS ------ */
  {
    id: 'titania', name: 'Titania', type: 'moon', parent: 'uranus',
    radiusKm: 788.4, mass: '3.4e21 kg', gravity: 0.379,
    rotationHours: 208.9, axialTilt: 0, surfaceTemp: '-203 °C',
    composition: 'Roughly half ice, half rock',
    orbit: { distKm: 435_910, periodDays: 8.706, inclinationDeg: 0.34, phase: 90 },
    summary:
      'The largest Uranian moon, scarred by enormous canyons: Messina Chasmata runs 1,500 km. Voyager 2 is the only spacecraft ever to see it, so most of what we know comes from a few dozen photographs.',
    facts: [
      ['Orbit', '8.7 days'],
      ['Canyons', 'Messina Chasmata, 1,500 km long'],
      ['Visited', 'Voyager 2 only, in 1986'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#9a938e', '#75706c', '#b8b2ac', '#565250'],
      noise: { scale: 5, contrast: 0.6, craters: 60 },
      roughness: 0.85, metalness: 0.03,
    },
    terrain: { rock: '#75706c', dust: '#a8a29c', dustAmount: 0.6, sky: ['#000000', '#04040a'], metal: 0.1, ice: true, parentSky: 'uranus', lowGravity: 0.379 },
  },

  /* -------------------------------------------------------- NEPTUNE ------ */
  {
    id: 'triton', name: 'Triton', type: 'moon', parent: 'neptune',
    radiusKm: 1353.4, mass: '2.14e22 kg', gravity: 0.779,
    rotationHours: -141.0, axialTilt: 0, surfaceTemp: '-235 °C',
    composition: 'Nitrogen and methane ice over a water-ice crust',
    orbit: { distKm: 354_759, periodDays: -5.877, inclinationDeg: 156.9, phase: 10 },
    summary:
      'A captured Kuiper Belt object orbiting backwards. Triton is one of the few geologically active moons, with nitrogen geysers 8 km high and a strange cantaloupe-textured surface.',
    facts: [
      ['Orbit', '5.88 days, retrograde — it was captured'],
      ['Temperature', '-235 °C, among the coldest surfaces measured'],
      ['Geysers', 'Nitrogen plumes 8 km high'],
      ['Fate', 'Spiralling inwards; may one day form a ring'],
      ['Visited', 'Voyager 2, in 1989'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#d8cfc0', '#b0a695', '#f0e8da', '#8a8070'],
      noise: { scale: 5.5, contrast: 0.5, craters: 30, cantaloupe: 0.6 },
      roughness: 0.7, metalness: 0.04,
    },
    terrain: { rock: '#b0a695', dust: '#ddd4c6', dustAmount: 0.5, sky: ['#000000', '#02040a'], metal: 0.1, ice: true, geysers: true, parentSky: 'neptune', lowGravity: 0.779 },
  },

  /* ---------------------------------------------------------- PLUTO ------ */
  {
    id: 'charon', name: 'Charon', type: 'moon', parent: 'pluto',
    radiusKm: 606, mass: '1.586e21 kg', gravity: 0.288,
    rotationHours: 153.3, axialTilt: 0, surfaceTemp: '-220 °C',
    composition: 'Water ice with ammonia hydrates',
    orbit: { distKm: 19_591, periodDays: 6.387, inclinationDeg: 0.08, phase: 330 },
    summary:
      'So large relative to Pluto that the two orbit a point in empty space between them — effectively a double dwarf planet. Its dark red north pole, Mordor Macula, is stained by material escaping from Pluto.',
    facts: [
      ['Orbit', '6.39 days, tidally locked to Pluto'],
      ['Relationship', 'Mutual tidal lock — a true binary system'],
      ['Serenity Chasma', 'A canyon 4 x longer than the Grand Canyon'],
      ['Visited', 'New Horizons, 2015'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#9a948c', '#726d68', '#bfb8ae', '#544f4b'],
      noise: { scale: 5.5, contrast: 0.6, craters: 60, maria: 0.3 },
      roughness: 0.85, metalness: 0.03,
    },
    terrain: { rock: '#726d68', dust: '#a49d93', dustAmount: 0.6, sky: ['#000000', '#03030a'], metal: 0.1, ice: true, lowGravity: 0.288, parentSky: 'pluto' },
  },

  /* --------------------------------------------------------- THE COMET --- */
  {
    id: 'halley', name: "Halley's Comet", type: 'comet',
    radiusKm: 5.5, mass: '2.2e14 kg', gravity: 0.00004,
    rotationHours: 52.8, axialTilt: 0,
    surfaceTemp: '-70 °C',
    composition: 'Water ice, carbon monoxide and dioxide, dust',
    elements: {
      a: 17.834, e: 0.96714, i: 162.26, L: 38.4,
      longPeri: 111.33, longNode: 58.42,
      rates: { a: 0, e: 0, i: 0, L: 0, longPeri: 0, longNode: 0 },
    },
    summary:
      'The most famous comet, returning every 75-76 years. Edmond Halley worked out in 1705 that the comets of 1531, 1607 and 1682 were the same object and predicted its return, correctly, 16 years after his death.',
    facts: [
      ['Period', '75.3 years — next perihelion 2061'],
      ['Last seen', '1986, when Giotto flew through its coma'],
      ['Perihelion', '0.586 AU, inside the orbit of Venus'],
      ['Aphelion', '35 AU, beyond Neptune'],
      ['Tail', 'Up to 100 million km long'],
    ],
    visual: {
      surface: 'icy',
      palette: ['#5a5348', '#3e3832', '#7a7164', '#2a251f'],
      noise: { scale: 8, contrast: 0.9, craters: 20 },
      roughness: 0.98, metalness: 0,
    },
    comet: { tailKm: 40_000_000, comaColor: '#bff2ff', tailColor: '#9fd8ff' },
    terrain: { rock: '#3e3832', dust: '#6a6358', dustAmount: 0.8, sky: ['#000000', '#01010a'], metal: 0.05, lowGravity: 0.00004, comet: true },
  },
];

/** Procedural particulate belts — drawn as point clouds, never integrated. */
export const BELTS = [
  {
    id: 'asteroid-belt',
    name: 'Asteroid Belt',
    count: 16_000,
    innerKm: 2.06 * AU_KM,
    outerKm: 3.28 * AU_KM,
    thicknessKm: 0.35 * AU_KM,
    eccentricity: 0.12,
    inclinationDeg: 9,
    color: '#9a8f80',
    sizeRange: [0.35, 1.6],
    summary:
      "Millions of rocky bodies between Mars and Jupiter, totalling only about 4% of the Moon's mass. Despite what the films show, they sit on average a million km apart.",
    facts: [
      ['Location', '2.2 - 3.2 AU from the Sun'],
      ['Total mass', '~4% of the Moon'],
      ['Largest member', 'Ceres, 939 km'],
      ['Kirkwood gaps', 'Orbits cleared by resonance with Jupiter'],
    ],
  },
  {
    id: 'kuiper-belt',
    name: 'Kuiper Belt',
    count: 18_000,
    innerKm: 30 * AU_KM,
    outerKm: 49 * AU_KM,
    thicknessKm: 8 * AU_KM,
    eccentricity: 0.18,
    inclinationDeg: 14,
    color: '#8fa2c0',
    sizeRange: [0.3, 1.3],
    summary:
      "A vast ring of icy leftovers beyond Neptune, home to Pluto, Eris and countless comets. It is a frozen record of the solar system's formation 4.6 billion years ago.",
    facts: [
      ['Location', '30 - 50 AU'],
      ['Contents', 'Icy planetesimals and short-period comets'],
      ['Notable members', 'Pluto, Haumea, Makemake, Eris'],
      ['Discovered', '1992, after decades of searching'],
    ],
  },
];

export const COMET_TEMPLATE_NOTE =
  'Comets are just bodies with a steep, inclined orbit — add one to BODIES and the tail renders itself.';

/** Lookup tables built once at module load. */
export const ALL_BODIES = BODIES;

export const bodyById = new Map(ALL_BODIES.map((b) => [b.id, b]));

export const childrenOf = new Map();
for (const b of ALL_BODIES) {
  if (!b.parent) continue;
  if (!childrenOf.has(b.parent)) childrenOf.set(b.parent, []);
  childrenOf.get(b.parent).push(b);
}

/** Bodies you can land on (everything with a solid-enough surface). */
export const LANDABLE = ALL_BODIES.filter(
  (b) => !b.terrain?.gasGiant && !b.terrain?.star
);

export function bodyName(id) {
  return bodyById.get(id)?.name ?? id;
}
