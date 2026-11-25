/**
 * @fileoverview What Remote Login (NIP-46) left in secure and plain storage.
 *
 * The signer was removed (ADR 0035), but an install that used it still holds
 * these keys. They are named here, and only here, so that Delete account and
 * profile removal keep wiping them. Nothing reads or writes them any more.
 *
 * - `nip46_bunker_secrets_<pubkey>`: one-time pairing secrets per profile,
 *   written with raw SecureStore calls, so they never entered the secure key
 *   index that Delete account otherwise relies on.
 * - `nip46_pending_pairing`: the pairing link carried across a profile switch
 *   (SecureStore; it embeds the client's pairing secret).
 * - `nip46-pending-pairing`: where builds up to 0.1.4 kept that link, in
 *   AsyncStorage.
 *
 * The signer removed both pairing-link rows every time an account mounted;
 * `clearLegacyPairingIntent` keeps doing that once per run, so a link left by
 * an older build does not stay on the phone.
 *
 * Imports nothing from `secureStorage.ts`, which imports the key names from
 * here.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { nostrLog, redactError } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/protocolIds';

const BUNKER_SECRETS_PREFIX = 'nip46_bunker_secrets_';
const PAIRING_INTENT_KEY = 'nip46_pending_pairing';
const PAIRING_INTENT_ASYNC_KEY = 'nip46-pending-pairing';

// The options the signer wrote with, as every other Sovran secret uses.
const secureOptions = (): SecureStore.SecureStoreOptions =>
  Platform.OS === 'ios' ? { requireAuthentication: false } : {};

/** The SecureStore key holding one profile's bunker secrets, or null for a value that is not a pubkey. */
function legacyBunkerSecretsKey(pubkey: string): string | null {
  return isNostrPubkeyHex(pubkey) ? `${BUNKER_SECRETS_PREFIX}${pubkey}` : null;
}

/** Every SecureStore key Remote Login may have written for these profiles. */
export function legacyNip46SecureKeys(pubkeys: readonly string[]): string[] {
  const bunker = pubkeys.map(legacyBunkerSecretsKey).filter((key) => key !== null);
  return [PAIRING_INTENT_KEY, ...bunker];
}

/** Delete one profile's bunker secrets. Throws when the delete fails. */
export async function clearLegacyBunkerSecrets(pubkey: string): Promise<void> {
  const key = legacyBunkerSecretsKey(pubkey);
  if (key === null) throw new Error('Invalid pubkey');
  await SecureStore.deleteItemAsync(key, secureOptions());
}

/** Remove the pending pairing link from both places it was kept. Best effort: a failure is logged. */
export async function clearLegacyPairingIntent(): Promise<void> {
  const results = await Promise.allSettled([
    SecureStore.deleteItemAsync(PAIRING_INTENT_KEY, secureOptions()),
    AsyncStorage.removeItem(PAIRING_INTENT_ASYNC_KEY),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      nostrLog.warn('nostr.legacy_nip46.pairing_intent_clear_failed', {
        error: redactError(result.reason),
      });
    }
  }
}
