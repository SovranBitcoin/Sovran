/**
 * @fileoverview NPubCash constants, helpers, and a durable SinceStore.
 *
 * Single source of truth for the NPubCash host.
 *
 * `npub.cash` is the canonical host and speaks the v2 sync API. It did not
 * always: before the 2026-08-07 15:00 UTC cutover, `npub.cash` served the v1
 * API and the v2 service lived at `npubx.cash`, so this constant pointed there
 * and a comment here warned that `npub.cash` "does NOT speak the sync
 * protocol". That is no longer true — both hosts now answer
 * `/api/v2/wallet/quotes` identically, and `npubx.cash` is a compatibility
 * domain that upstream retires on 2026-12-31. Point at the canonical host.
 *
 * This also names the user-facing Lightning address domain (see
 * `getNpcAddress`). Addresses already handed out as `@npubx.cash` keep
 * resolving for the life of the compatibility domain.
 */

import { JWTAuthProvider, NPCClient } from 'npubcash-sdk';
import type { SigningFunc } from 'npubcash-sdk';

import AsyncStorage from '@react-native-async-storage/async-storage';

export const NPC_BASE_URL = 'https://npub.cash';
export const NPC_DOMAIN = new URL(NPC_BASE_URL).host;
export const NPC_SYNC_INTERVAL_MS = 25_000;

/**
 * Build an SDK client bound to the canonical host.
 *
 * Every caller must give `NPCClient` and `JWTAuthProvider` the SAME base URL —
 * the auth provider mints a NIP-98 event whose `u` tag is derived from its own
 * base, so a split pair signs for one host and calls another and every request
 * 401s. Constructing both here is the only way to keep that impossible.
 */
export function createNpcClient(signer: SigningFunc): NPCClient {
  return new NPCClient(NPC_BASE_URL, new JWTAuthProvider(NPC_BASE_URL, signer));
}

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
