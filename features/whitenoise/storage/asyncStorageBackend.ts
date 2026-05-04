import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseWithBytes, stringifyWithBytes } from './serialization';

const WHITENOISE_STORAGE_VERSION = 1 as const;

type Envelope<T> = {
  v: typeof WHITENOISE_STORAGE_VERSION;
  d: T;
};

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    'd' in value &&
    (value as Envelope<T>).v === WHITENOISE_STORAGE_VERSION
  );
}

/**
 * Per-prefix key-value backend that wraps every value in a versioned
 * envelope (`{ v, d }`). The envelope discriminator gives a future
 * `WHITENOISE_STORAGE_VERSION` bump a uniform shape to migrate against —
 * any namespace that bypasses this backend would be invisible to that
 * migration, so callers should always go through here.
 *
 * The shape mirrors marmot-ts's internal `KeyValueStoreBackend<T>` so
 * the same instance can be handed straight to `KeyPackageStore`,
 * `KeyValueGroupStateBackend`, `InviteStore`, etc.
 */
export class AsyncStorageKVBackend<T> {
  constructor(private readonly prefix: string) {}

  private toStorageKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private toLogicalKey(storageKey: string): string {
    return storageKey.slice(this.prefix.length + 1);
  }

  async getItem(key: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(this.toStorageKey(key));
    if (raw === null) return null;
    return decodeEnvelope<T>(raw);
  }

  async setItem(key: string, value: T): Promise<T> {
    const envelope: Envelope<T> = { v: WHITENOISE_STORAGE_VERSION, d: value };
    await AsyncStorage.setItem(this.toStorageKey(key), stringifyWithBytes(envelope));
    return value;
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(this.toStorageKey(key));
  }

  async clear(): Promise<void> {
    const all = await AsyncStorage.getAllKeys();
    const prefixWithSep = `${this.prefix}:`;
    const matching = all.filter((k) => k.startsWith(prefixWithSep));
    if (matching.length === 0) return;
    await AsyncStorage.multiRemove(matching);
  }

  async keys(): Promise<string[]> {
    const all = await AsyncStorage.getAllKeys();
    const prefixWithSep = `${this.prefix}:`;
    return all.filter((k) => k.startsWith(prefixWithSep)).map((k) => this.toLogicalKey(k));
  }

  async entries(): Promise<[string, T][]> {
    const all = await AsyncStorage.getAllKeys();
    const prefixWithSep = `${this.prefix}:`;
    const matching = all.filter((k) => k.startsWith(prefixWithSep));
    if (matching.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(matching);
    const out: [string, T][] = [];
    for (const [storageKey, raw] of pairs) {
      if (raw === null) continue;
      const value = decodeEnvelope<T>(raw);
      if (value === null) continue;
      out.push([this.toLogicalKey(storageKey), value]);
    }
    return out;
  }
}

// Tolerates raw values that predate the envelope (an older dmIndex namespace
// stored bare strings before being routed through this backend) — they fail
// `parseWithBytes` or the version check and surface as a null read, which
// upstream callers already handle as "absent". Treats parse failure as
// equivalent to a missing key rather than letting the error bubble up.
function decodeEnvelope<T>(raw: string): T | null {
  let parsed: unknown;
  try {
    parsed = parseWithBytes<unknown>(raw);
  } catch {
    return null;
  }
  if (!isEnvelope<T>(parsed)) return null;
  return parsed.d;
}
