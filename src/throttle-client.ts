import type { ThrottleQueue } from './throttle-queue.js';

export class ThrottledClient {
  private throttleQueue: ThrottleQueue;

  constructor(throttleQueue: ThrottleQueue) {
    this.throttleQueue = throttleQueue;
  }

  public createProxy<T extends object>(client: T): T {
    return this.proxify<T>(client);
  }

  private proxify<T extends object>(obj: T): T {
    const cache = new WeakMap();

    return new Proxy(obj, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);

        if (typeof value === 'function') {
          return (...args: unknown[]) => this.throttleQueue.throttle(() => value.apply(target, args));
        }

        if (typeof value === 'object' && value !== null) {
          if (!cache.has(value)) {
            cache.set(value, this.proxify(value));
          }
          return cache.get(value);
        }

        return value;
      },
    });
  }
}
