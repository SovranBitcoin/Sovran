/**
 * JSON serialization of arbitrary zustand store state for the e2e state mirror.
 *
 * Store state is not plain data: it holds action functions, Map/Set, BigInt,
 * Error instances and occasionally circular references. The output is always
 * valid JSON — functions are dropped, Map/Set are tagged with reconstructible
 * payloads, BigInt is stringified, Error is flattened and a cycle becomes
 * `'[Circular]'`. A store whose JSON exceeds the cap serializes to a
 * `Truncated` marker that keeps its top-level key list, and a store that throws
 * while serializing becomes an `Error` marker, so one bad store can never break
 * a snapshot.
 */

/** Giant cache stores (e.g. the BTC Map merchant dataset, ~5 MB) would make
 * every flush a multi-MB JS-thread stringify + disk write and distort the app
 * under test; past this cap a store serializes to a Truncated marker. */
const MAX_STORE_BYTES = 256 * 1024;

/** A fresh replacer per serialization: its seen-set breaks circular references. */
function createSafeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'function') return undefined;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Map) return { __type: 'Map', entries: Array.from(value.entries()) };
    if (value instanceof Set) return { __type: 'Set', values: Array.from(value.values()) };
    if (value instanceof Error) return { __type: 'Error', message: value.message };
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/** Serialize one store's state to a JSON fragment, capped at `MAX_STORE_BYTES`. */
export function serializeStoreState(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value, createSafeReplacer()) ?? 'null';
  } catch (error) {
    return JSON.stringify({ __type: 'Error', message: (error as Error).message });
  }
  if (json.length <= MAX_STORE_BYTES) return json;
  const keys =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value as object)
      : [];
  return JSON.stringify({
    __type: 'Truncated',
    bytes: json.length,
    note: `store serialization exceeds the ${MAX_STORE_BYTES / 1024}KB mirror cap`,
    keys,
  });
}
