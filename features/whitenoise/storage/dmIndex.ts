import { AsyncStorageKVBackend } from './asyncStorageBackend';
import { WhitenoiseNamespace, whitenoisePrefix } from './namespaces';

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
 *
 * Routed through `AsyncStorageKVBackend` so values share the same
 * `WHITENOISE_STORAGE_VERSION` envelope as every other Whitenoise namespace
 * — a future schema bump can migrate every namespace through one
 * discriminator instead of special-casing this one.
 */
export class WhitenoiseDmIndex {
  private readonly backend: AsyncStorageKVBackend<string>;

  constructor(accountIndex: number) {
    this.backend = new AsyncStorageKVBackend<string>(
      whitenoisePrefix(accountIndex, WhitenoiseNamespace.DmIndex)
    );
  }

  async get(counterpartyPubkey: string): Promise<string | null> {
    return this.backend.getItem(counterpartyPubkey);
  }

  async set(counterpartyPubkey: string, groupIdHex: string): Promise<void> {
    await this.backend.setItem(counterpartyPubkey, groupIdHex);
  }

  /**
   * List every counterparty we've established a 1:1 group with on this
   * account. Used by the Contacts screen to surface accepted Marmot DMs in
   * the Recent / All pills (they don't show up via NIP-17/NIP-04 since
   * Marmot uses kind-445 group events, not kind-4/kind-14 DMs).
   */
  async list(): Promise<WhitenoiseDmIndexEntry[]> {
    const pairs = await this.backend.entries();
    return pairs.map(([pubkey, groupIdHex]) => ({ pubkey, groupIdHex }));
  }
}
