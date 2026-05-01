import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseWithBytes, stringifyWithBytes } from './serialization';

// Mirrors marmot-ts's `utils/key-value.ts` `KeyValueStoreBackend<T>`. Inlined
// because that module isn't re-exported from the main entry — and the contract
// is small enough to maintain locally.
export interface KeyValueStoreBackend<T> {
  getItem(key: string): Promise<T | null>;
  setItem(key: string, value: T): Promise<T>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export const WHITENOISE_STORAGE_VERSION = 1 as const;

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

export class AsyncStorageKVBackend<T> implements KeyValueStoreBackend<T> {
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
    const envelope = parseWithBytes<Envelope<T>>(raw);
    if (!isEnvelope<T>(envelope)) return null;
    return envelope.d;
  }

  async setItem(key: string, value: T): Promise<T> {
    const envelope: Envelope<T> = { v: WHITENOISE_STORAGE_VERSION, d: value };
    await AsyncStorage.setItem(
      this.toStorageKey(key),
      stringifyWithBytes(envelope)
    );
    return value;
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(this.toStorageKey(key));
  }

  async clear(): Promise<void> {
    const keys = await this.keys();
    if (keys.length === 0) return;
    await AsyncStorage.multiRemove(keys.map((k) => this.toStorageKey(k)));
  }

  async keys(): Promise<string[]> {
    const all = await AsyncStorage.getAllKeys();
    const prefixWithSep = `${this.prefix}:`;
    return all
      .filter((k) => k.startsWith(prefixWithSep))
      .map((k) => this.toLogicalKey(k));
  }
}
