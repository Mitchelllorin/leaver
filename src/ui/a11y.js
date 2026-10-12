import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';

/**
 * Accessibility plumbing.
 *
 * The canvas is decorative. Everything worth knowing is mirrored into the DOM,
 * and the two live regions below are how changes get spoken. Polite
 * announcements queue (they must not interrupt a screen reader mid-sentence);
 * assertive ones cut in, and are reserved for things that actually need
 * immediate attention.
 */

export function createAnnouncer(root) {
  const polite = document.createElement('div');
  polite.className = 'visually-hidden';
  polite.setAttribute('role', 'status');
  polite.setAttribute('aria-live', 'polite');
  polite.setAttribute('aria-atomic', 'true');

  const assertive = document.createElement('div');
  assertive.className = 'visually-hidden';
  assertive.setAttribute('role', 'alert');
  assertive.setAttribute('aria-live', 'assertive');
  assertive.setAttribute('aria-atomic', 'true');

  root.append(polite, assertive);

  let politeTimer = null;
  return {
    politely(text) {
      if (!settings.get('narration')) return;
      // Clear first so repeating the same string is still announced.
      polite.textContent = '';
      clearTimeout(politeTimer);
      politeTimer = setTimeout(() => {
        polite.textContent = text;
      }, 60);
    },
    urgently(text) {
      if (!settings.get('narration')) return;
      assertive.textContent = '';
      setTimeout(() => {
        assertive.textContent = text;
      }, 60);
    },
    regions: { polite, assertive },
  };
}

/** Keep Tab inside an open dialog, and restore focus when it closes. */
export function trapFocus(container, onEscape) {
  const previous = document.activeElement;
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onEscape?.();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(selector)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKeyDown);
  // Focus the first sensible control.
  const first = container.querySelector(selector);
  first?.focus?.();

  return () => {
    container.removeEventListener('keydown', onKeyDown);
    previous?.focus?.();
  };
}

/**
 * Apply the user's motion and contrast preferences to the document.
 *
 * The subscription lives here, at module scope, rather than in the entry point.
 * Accessibility settings must take effect wherever the interface is used, not
 * only in the one file that happens to boot the app.
 */
export function applyDisplayPreferences() {
  const reduced = settings.get('reducedMotion');
  document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  document.documentElement.dataset.contrast = settings.get('highContrast') ? 'high' : 'normal';
}

bus.on('settings:change', () => applyDisplayPreferences());

/** A short, human sentence describing a body, used as its accessible label. */
export function describeBody(def) {
  const type = def.type === 'moon' ? 'moon of ' + (def.parent ?? '') : def.type;
  return `${def.name}, ${type}. ${def.summary}`;
}
