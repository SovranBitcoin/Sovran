/**
 * Own-property lookup for a plain-object table keyed by untrusted text: a mint
 * URL key, a feed pointer token, a mint-supplied method or NUT number. Without
 * it `constructor` or `__proto__` resolve through `Object.prototype` and return
 * a function or an object, which neither `??` nor `?.` catches.
 */
export function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * A copy of `table` keeping every own entry. Object spread is not enough: as
 * compiled for the app it drops an own `__proto__` entry.
 */
export function copyEntries<T>(table: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(table));
}

/** A copy of `table` with `key` set to `value`, as an own entry whatever the key. */
export function withOwnEntry<T>(
  table: Readonly<Record<string, T>>,
  key: string,
  value: NoInfer<T>
): Record<string, T> {
  return Object.fromEntries([...Object.entries(table), [key, value]]);
}

/** Set `key` on `table` in place, as an own entry whatever the key. */
export function setOwnEntry<T>(table: Record<string, T>, key: string, value: NoInfer<T>): void {
  Object.defineProperty(table, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
