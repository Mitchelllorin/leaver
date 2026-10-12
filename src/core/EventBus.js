/**
 * Tiny synchronous pub/sub bus. Everything in the sim talks through this so
 * modules stay decoupled: add a new event/system/UI panel without touching
 * the others.
 */
export class EventBus {
  constructor() {
    this._handlers = new Map();
    this._any = new Set();
  }

  /** Subscribe. Returns an unsubscribe function. */
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  /** Subscribe to *every* event (used by the logger / debug overlay). */
  onAny(fn) {
    this._any.add(fn);
    return () => this._any.delete(fn);
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (set) {
      // copy so handlers may unsubscribe during dispatch
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[bus] handler for "${type}" threw:`, err);
        }
      }
    }
    for (const fn of [...this._any]) {
      try {
        fn(type, payload);
      } catch (err) {
        console.error('[bus] onAny handler threw:', err);
      }
    }
  }
}

export const bus = new EventBus();
