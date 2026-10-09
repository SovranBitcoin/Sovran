import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

import { initLog, initPhase, log } from '@/shared/lib/logger';
import {
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
  deriveNostrKeys,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';
import {
  clearAccountDerivedCache,
  hashMnemonic,
  retrieveCashuMnemonic,
  retrieveDerivedKeys,
  retrieveImportedNsec,
  storeCashuMnemonic,
  storeDerivedKeys,
  type CachedDerivedKeys,
} from '@/shared/lib/nostr/secureStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';

export interface NostrKeys {
  npub: string;
  nsec: string;
  pubkey: string;
  privateKey: Uint8Array;
}

interface LoadedAccountKeys {
  keys: NostrKeys | null;
  cashuMnemonic: string | null;
  /** False when a profile saved as imported was repaired back to derived. */
  isImported: boolean;
}

/**
 * Work out the Nostr keys and the wallet phrase for the active account.
 *
 * Three cases, in the order they are tried:
 *
 * 1. **Imported profile** with its nsec in secure storage: the identity is the
 *    stored key; the wallet phrase is derived from the root phrase and the
 *    key's account number.
 * 2. **Imported profile whose nsec is missing**: if the root phrase derives the
 *    same public key at that index, the profile was derived all along. Its row
 *    is repaired and it continues as case 3. Otherwise it needs a re-import.
 * 3. **Derived profile**: keys cached in secure storage are used when they were
 *    made from this root phrase; otherwise both are derived and cached.
 *
 * Throws when the account cannot be loaded; the provider shows the recovery
 * screen. Returns null when `shouldContinue` says the caller has gone away. That
 * is checked once, when an imported key turns out to be missing and before the
 * repair begins; a caller that goes away during the repair's own awaits is not
 * caught here.
 *
 * Side effects: it reads secure storage, writes the derived-key and wallet
 * phrase caches (not awaited), may repair the profile row as in case 2, and
 * reports progress through `onProgress`. It never touches React state, the
 * startup stage's outcome or the wallet core: the provider applies the result,
 * so a load that finishes late can be dropped.
 */
export async function loadAccountKeys({
  mnemonic,
  accountIndex,
  onProgress,
  shouldContinue,
}: {
  mnemonic: string;
  accountIndex: number;
  onProgress: (message: string) => void;
  shouldContinue: () => boolean;
}): Promise<LoadedAccountKeys | null> {
  const mHash = await initPhase('NostrKeys.hashMnemonic', async () => hashMnemonic(mnemonic));
  let keys: NostrKeys | null = null;
  let cashuMnemonic: string | null = null;

  // Check if the active profile is an imported nsec profile
  const activeProfile = useProfileStore.getState().getActiveProfile();
  let isImported = activeProfile?.source === 'imported';
  let repairedSource = false;
  let nsecValue: string | null = null;
  if (isImported && activeProfile) {
    nsecValue = await retrieveImportedNsec(activeProfile.pubkey);
    if (!nsecValue && !shouldContinue()) return null;
    if (!nsecValue) {
      const candidate = deriveNostrKeys(mnemonic, activeProfile.accountIndex);
      if (
        candidate.pubkey !== activeProfile.pubkey ||
        !(await clearAccountDerivedCache(activeProfile.accountIndex)) ||
        !useProfileStore
          .getState()
          .repairDerivedSource(activeProfile.accountIndex, candidate.pubkey)
      ) {
        throw new Error('Saved account requires re-import');
      }
      keys = candidate;
      repairedSource = true;
      isImported = false;
    }
  }

  if (isImported && activeProfile) {
    // ── Imported nsec profile: load identity from SecureStore ──
    onProgress('Loading imported profile...');
    initLog('NostrKeys', 'imported profile — loading nsec from SecureStore');

    if (!nsecValue) {
      throw new Error('Imported nsec not found in secure storage');
    }

    const decoded = nip19.decode(nsecValue);
    if (decoded.type !== 'nsec') {
      throw new Error('Stored imported key is not a valid nsec');
    }

    const privateKey = decoded.data;
    const pubkeyHex = getPublicKey(privateKey);
    if (pubkeyHex !== activeProfile.pubkey) throw new Error('Saved account requires re-import');

    keys = {
      npub: nip19.npubEncode(pubkeyHex),
      nsec: nsecValue,
      pubkey: pubkeyHex,
      privateKey,
    };

    const npubNumber = pubkeyToAccountNumber(pubkeyHex);
    initLog('NostrKeys', `imported npubNumber=${npubNumber}, deriving Cashu mnemonic (chain 1)...`);

    // Try cached Cashu mnemonic first
    const cachedCashu = await retrieveCashuMnemonic(accountIndex);
    if (cachedCashu?.mnemonicHash === mHash) {
      cashuMnemonic = cachedCashu.value;
    } else {
      cashuMnemonic = deriveCashuMnemonicForImported(mnemonic, npubNumber);
      storeCashuMnemonic(accountIndex, cashuMnemonic, mHash).catch((e) =>
        initLog('NostrKeys', `imported cashu cache write failed: ${e}`)
      );
    }
    initLog('NostrKeys', 'imported profile keys loaded');
  } else {
    // ── Derived profile: existing NIP-06 derivation path ──
    // Try loading cached keys from SecureStore (fast path)
    const [cachedDerived, cachedCashu] = await initPhase('NostrKeys.cacheRead', () =>
      Promise.all([retrieveDerivedKeys(accountIndex), retrieveCashuMnemonic(accountIndex)])
    );
    initLog('NostrKeys', `cache read done — derived=${!!cachedDerived} cashu=${!!cachedCashu}`);

    const cacheValid =
      !repairedSource &&
      cachedDerived?.mnemonicHash === mHash &&
      cachedCashu?.mnemonicHash === mHash;
    initLog('NostrKeys', `cache valid: ${cacheValid}`);

    if (cacheValid && cachedDerived && cachedCashu) {
      onProgress('Loading cached keys...');
      initLog('NostrKeys', 'using cached keys (fast path)');
      keys = {
        npub: cachedDerived.npub,
        nsec: cachedDerived.nsec,
        pubkey: cachedDerived.pubkey,
        privateKey: hexToBytes(cachedDerived.privateKeyHex),
      };
      cashuMnemonic = cachedCashu.value;
    } else {
      onProgress('Deriving keys...');
      keys ??= await initPhase('NostrKeys.deriveNip06', async () =>
        deriveNostrKeys(mnemonic, accountIndex)
      );

      cashuMnemonic = await initPhase('NostrKeys.deriveCashuMnemonic', async () =>
        deriveCashuMnemonic(mnemonic, accountIndex)
      );

      const cachePayload: CachedDerivedKeys = {
        npub: keys.npub,
        nsec: keys.nsec,
        pubkey: keys.pubkey,
        privateKeyHex: bytesToHex(keys.privateKey),
        mnemonicHash: mHash,
      };
      Promise.all([
        storeDerivedKeys(accountIndex, cachePayload),
        storeCashuMnemonic(accountIndex, cashuMnemonic, mHash),
      ]).catch((e) => initLog('NostrKeys', `cache write failed: ${e}`));
    }
  }

  if (activeProfile && keys?.pubkey !== activeProfile.pubkey) {
    if (isImported) throw new Error('Saved account requires re-import');
    // A derived account whose saved row names another key is a state
    // 0.1.3 produced and then ran in: an Android backup restored the
    // profile row and the wallet database without the keychain, a new
    // root was generated, and boot carried on with the keys derived from
    // it. Refusing here stops that user at a form asking for an nsec
    // they never held, with their funds behind it. The row is left as
    // it is, because the account's stored data is filed under its key.
    log.warn('nostr.keys.profile_pubkey_mismatch', { defaultAccountIndex: accountIndex });
  }

  return { keys, cashuMnemonic, isImported };
}
