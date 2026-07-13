declare global {
  interface PromiseConstructor {
    withResolvers?<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
    try?<T>(callback: (...args: unknown[]) => T | PromiseLike<T>, ...args: unknown[]): Promise<T>;
  }
  interface Map<K, V> {
    getOrInsertComputed?(key: K, callback: (key: K) => V): V;
  }
  interface Uint8ArrayConstructor {
    fromBase64?(value: string): Uint8Array;
  }
}

if (typeof Promise.try !== "function") {
  Promise.try = function promiseTry<T>(callback: (...args: unknown[]) => T | PromiseLike<T>, ...args: unknown[]) {
    return new Promise<T>((resolve) => resolve(callback(...args)));
  };
}

if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Map.prototype.getOrInsertComputed = function getOrInsertComputed<K, V>(
    this: Map<K, V>,
    key: K,
    callback: (key: K) => V,
  ) {
    if (this.has(key)) return this.get(key)!;
    const value = callback(key);
    this.set(key, value);
    return value;
  };
}

if (typeof Uint8Array.fromBase64 !== "function") {
  Uint8Array.fromBase64 = function fromBase64(value: string) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };
}

if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any !== "function") {
  AbortSignal.any = function any(signals: AbortSignal[]) {
    const controller = new AbortController();
    const abort = (signal: AbortSignal) => controller.abort(signal.reason);
    for (const signal of signals) {
      if (signal.aborted) {
        abort(signal);
        break;
      }
      signal.addEventListener("abort", () => abort(signal), { once: true });
    }
    return controller.signal;
  };
}

if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
