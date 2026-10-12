/**
 * Generic plugin registry. Any part of the sim can be extended by registering
 * against a kind ('body', 'event', 'panel', 'tour-stop', ...) with a priority.
 */
export class Registry {
  constructor(kind) {
    this.kind = kind;
    this._items = new Map();
  }

  /**
   * @param {string} id unique id within this kind
   * @param {object} definition
   * @param {number} [priority=0] lower runs/renders first
   */
  register(id, definition, priority = 0) {
    if (this._items.has(id)) {
      console.warn(`[registry:${this.kind}] overwriting "${id}"`);
    }
    this._items.set(id, { id, definition, priority });
    return this;
  }

  unregister(id) {
    this._items.delete(id);
  }

  get(id) {
    return this._items.get(id)?.definition;
  }

  has(id) {
    return this._items.has(id);
  }

  /** All definitions, sorted by priority then registration order. */
  list() {
    return [...this._items.values()]
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => entry.definition);
  }

  entries() {
    return [...this._items.values()].sort((a, b) => a.priority - b.priority);
  }
}
