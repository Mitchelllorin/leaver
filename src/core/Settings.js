import { bus } from './EventBus.js';

/**
 * User-facing settings, persisted to localStorage. Every subsystem reads from
 * here and listens for 'settings:change' so nothing has to be wired directly.
 */
const KEY = 'orrery.settings.v1';

const DEFAULTS = {
  scaleBlend: 0,        // 0 = explore, 1 = true scale
  sizeBoost: 1,         // body size exaggeration (explore scale only)
  quality: 'high',      // 'low' | 'medium' | 'high'
  bloom: true,
  orbitLines: true,
  labels: true,
  belts: true,
  starfield: true,
  timeScale: 1,         // simulated days per real second
  paused: false,
  reducedMotion: null,  // null = follow OS preference
  highContrast: false,
  narration: true,      // screen-reader / caption announcements
  units: 'metric',
  fov: 65,
  invertY: false,
  mouseSensitivity: 1,
  pointerLock: true,
  arrowKeysLook: true,
  eventFeed: true,
  focusLanding: true,
  hudScale: 1,
  hudDetail: 'auto', // 'auto' | 'full' | 'compact'
  touchControls: true,
};

let state = { ...DEFAULTS };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable (private mode) — defaults are fine */
  }
  if (state.reducedMotion === null) {
    state.reducedMotion =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
}
load();

export const settings = {
  all: () => ({ ...state }),
  get: (key) => state[key],
  set(key, value) {
    if (state[key] === value) return;
    const previous = state[key];
    state[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    bus.emit('settings:change', { key, value, previous });
  },
  patch(obj) {
    for (const [k, v] of Object.entries(obj)) this.set(k, v);
  },
  reset() {
    state = { ...DEFAULTS };
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    bus.emit('settings:change', { key: '*', value: null, previous: null });
  },
};

// React to OS accessibility preference changes live.
if (typeof matchMedia === 'function') {
  try {
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      settings.set('reducedMotion', e.matches);
    });
  } catch {
    /* older browsers */
  }
}
