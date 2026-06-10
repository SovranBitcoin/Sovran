/**
 * @fileoverview Reset Remote Login — focused wipe of the signer's state for
 * the active profile
 *
 * Touches ONLY signer-owned storage: the three nip46 stores, the pending
 * pairing intent, and the profile's bunker pairing secrets. Nothing else
 * (wallet, feed, theme, …) is read or written. The engine keeps running —
 * with the connections store empty every sender is a stranger again, and the
 * requests-store wipe already dropped pending asks, session grants, and
 * throttle flags. In-memory rate-limiter windows are inert residue.
 */

import { ResultAsync } from 'neverthrow';

import { useNip46ActivityStore } from '@/features/nostrSigner/data/nip46ActivityStore';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { clearSecrets, type BunkerSecretsError } from '@/features/nostrSigner/lib/bunkerSecrets';
import {
  clearPairingIntent,
  type PairingIntentError,
} from '@/features/nostrSigner/lib/pairingIntentStorage';

type ClearSignerDataError = BunkerSecretsError | PairingIntentError;

/**
 * Wipes every connection, grant, pending request, activity entry, pairing
 * intent, and outstanding bunker secret. The store writes are synchronous;
 * the result settles when the storage-backed wipes (intent + secrets) land.
 * `activePubkey` may be undefined while keys are still deriving — the
 * SecureStore secrets are keyed per pubkey, so without one there is nothing
 * addressable to delete.
 */
export function clearAllSignerData(
  activePubkey: string | undefined
): ResultAsync<void, ClearSignerDataError> {
  useNip46RequestsStore.getState().clear();
  useNip46ConnectionsStore.getState().clearAll();
  useNip46ActivityStore.getState().clearAll();
  const wipes: ResultAsync<unknown, ClearSignerDataError>[] = [clearPairingIntent()];
  if (activePubkey !== undefined) wipes.push(clearSecrets(activePubkey));
  return ResultAsync.combine(wipes).map(() => undefined);
}
