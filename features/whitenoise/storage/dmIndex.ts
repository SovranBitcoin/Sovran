import AsyncStorage from '@react-native-async-storage/async-storage';

export type WhitenoiseDmIndexEntry = {
  /** Counterparty hex pubkey. */
  pubkey: string;
  /** Hex MLS group id for the 1:1 group with this counterparty. */
  groupIdHex: string;
};

/**
 * Maps counterparty pubkey (hex) → group id hex for 1:1 White Noise DMs.
 * Per-account namespaced. Stored separately from MLS group state because it
 * is just a lookup hint; the canonical state lives in the GroupStateStore.
 */
export class WhitenoiseDmIndex {
  private readonly prefix: string;

  constructor(accountIndex: number) {
    this.prefix = `whitenoise:${accountIndex}:dm-index`;
  }

  private key(counterpartyPubkey: string): string {
    return `${this.prefix}:${counterpartyPubkey}`;
  }

  async get(counterpartyPubkey: string): Promise<string | null> {
    return AsyncStorage.getItem(this.key(counterpartyPubkey));
  }

  async set(counterpartyPubkey: string, groupIdHex: string): Promise<void> {
    await AsyncStorage.setItem(this.key(counterpartyPubkey), groupIdHex);
  }

  async remove(counterpartyPubkey: string): Promise<void> {
    await AsyncStorage.removeItem(this.key(counterpartyPubkey));
  }

  /**
   * List every counterparty we've established a 1:1 group with on this
   * account. Used by the Contacts screen to surface accepted Marmot DMs in
   * the Recent / All pills (they don't show up via NIP-17/NIP-04 since
   * Marmot uses kind-445 group events, not kind-4/kind-14 DMs).
   */
  async list(): Promise<WhitenoiseDmIndexEntry[]> {
    const allKeys = await AsyncStorage.getAllKeys();
    const prefixWithSep = `${this.prefix}:`;
    const matching = allKeys.filter((k) => k.startsWith(prefixWithSep));
    if (matching.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(matching);
    const entries: WhitenoiseDmIndexEntry[] = [];
    for (const [storageKey, value] of pairs) {
      if (!value) continue;
      entries.push({
        pubkey: storageKey.slice(prefixWithSep.length),
        groupIdHex: value,
      });
    }
    return entries;
  }
}
