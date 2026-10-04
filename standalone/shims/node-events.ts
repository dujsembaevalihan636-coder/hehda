// Минимальный EventEmitter для шины изменений локальной базы.

type Listener = (...args: never[]) => void;

export class EventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  setMaxListeners() {
    return this;
  }

  on(event: string, fn: Listener) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }

  addListener(event: string, fn: Listener) {
    return this.on(event, fn);
  }

  off(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  removeListener(event: string, fn: Listener) {
    return this.off(event, fn);
  }

  emit(event: string, ...args: unknown[]) {
    const set = this.listeners.get(event);
    if (!set?.size) return false;
    for (const fn of [...set]) (fn as (...a: unknown[]) => void)(...args);
    return true;
  }

  listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

const events = { EventEmitter };
export default events;
