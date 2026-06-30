/**
 * @fileoverview NPubCash constants, helpers, and a durable SinceStore.
 *
 * Single source of truth for the NPubCash host. The host that serves the
 * NPC sync API is `npubx.cash`; `npub.cash` is the marketing redirect and
 * does NOT speak the sync protocol — pointing the plugin at it silently
 * breaks receive. Mirrors eNuts `src/services/NpcService.ts`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const NPC_BASE_URL = 'https://npubx.cash';
export const NPC_DOMAIN = new URL(NPC_BASE_URL).host;
export const NPC_SYNC_INTERVAL_MS = 25_000;

/** Build the user-facing Lightning address for the active account. */
export function getNpcAddress(username: string | undefined, npub: string): string {
  const localPart = username?.trim() || npub;
  return `${localPart}@${NPC_DOMAIN}`;
}

/**
 * SinceStore implementation backed by AsyncStorage.
 *
 * The plugin uses this to persist the last processed timestamp across app
 * restarts. Without it, the plugin defaults to in-memory and re-fetches
 * every quote since 0 on every cold start.
 */
export class AsyncStorageSinceStore {
  constructor(private readonly key: string) {}

  async get(): Promise<number> {
    const raw = await AsyncStorage.getItem(this.key);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async set(since: number): Promise<void> {
    await AsyncStorage.setItem(this.key, String(since));
  }

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(this.key);
  }
}

/**
 * Build the AsyncStorage key for a profile's NPC sync cursor.
 *
 * Keyed by pubkey (not accountIndex) because accountIndex isn't a stable
 * per-profile identifier across all profile sources: derived profiles use a
 * monotonic BIP39 index, imported profiles use a separate npub-derived scheme,
 * and custom-added profiles may not have a meaningful index at all. Pubkey is
 * the one identifier every profile has and that uniquely names the account
 * the cursor belongs to.
 */
export function getNpcSinceStoreKey(pubkey: string): string {
  return `npc_since:profile:${pubkey}`;
}
