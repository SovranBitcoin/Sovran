import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

import { initLog, initPhase } from '@/shared/lib/logger';
import { phraseDerivesAccount, verifyStoredAccount } from '@/shared/lib/nostr/accountIntegrity';
import { AccountIntegrityError, type IntegrityRow } from '@/shared/lib/nostr/derivationIntegrity';
import {
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
  deriveNostrKeys,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';
import {
  hashMnemonic,
  readAccountSecretsUnchanged,
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
 * Work out the Nostr keys and the wallet phrase for the active account, and
 * prove they are the account's before anything uses them.
 *
 * The order is the point:
 *
 * 1. **Read.** Everything secure storage holds for the account is read as it
 *    is. Nothing is deleted, even a cache that will not parse: in a mismatch it
 *    may be the only copy of a key.
 * 2. **Choose.** An imported profile takes its identity from its stored key
 *    and its wallet phrase from the root phrase and the key's account number.
 *    A derived profile uses its caches when they were made from this root
 *    phrase, and derives otherwise. A profile saved as imported whose key is
 *    missing is treated as derived only if the root phrase derives its saved
 *    public key; otherwise it needs a re-import.
 * 3. **Check.** Every invariant in `derivationIntegrity.ts` runs against the
 *    row, the stored secrets and what step 2 chose, with a root seed the check
 *    stretched for itself. A mismatch throws `AccountIntegrityError`; the
 *    provider stops on the critical screen, and the row, the caches and the
 *    phrase are exactly as they were.
 * 4. **Write.** Only now: the label of a row that turned out to be derived is
 *    corrected, and freshly derived values are cached (not awaited).
 *
 * Throws when the account cannot be loaded; the provider shows the recovery
 * screen. Returns null when `shouldContinue` says the caller has gone away,
 * which is asked before the check and again before anything is written.
 *
 * It never touches React state, the startup stage's outcome or the wallet
 * core: the provider applies the result, so a load that finishes late can be
 * dropped.
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
  const activeProfile = useProfileStore.getState().getActiveProfile();

  // ── 1. Read ──
  const stored = await initPhase('NostrKeys.cacheRead', () =>
    readAccountSecretsUnchanged(
      accountIndex,
      activeProfile?.source === 'imported' ? activeProfile.pubkey : null
    )
  );
  if (!shouldContinue()) return null;

  // ── 2. Choose ──
  // A row reads as imported when it is, and also when a newer build saved a
  // `source` this one does not know. With no stored key it can only be loaded
  // if it was derived all along.
  let relabel = false;
  if (activeProfile?.source === 'imported' && !stored.importedNsec) {
    const derived = await phraseDerivesAccount(
      mnemonic,
      activeProfile.accountIndex,
      activeProfile.pubkey
    );
    if (!derived) throw new Error('Saved account requires re-import');
    relabel = true;
  }
  const isImported = activeProfile?.source === 'imported' && !relabel;

  let keys: NostrKeys | null = null;
  let cashuMnemonic: string | null = null;
  const cacheWrites: (() => void)[] = [];

  if (isImported && activeProfile) {
    onProgress('Loading imported profile...');
    initLog('NostrKeys', 'imported profile — loading nsec from SecureStore');
    // A stored value that is not this account's key leaves `keys` empty; the
    // check below names it as a mismatch.
    const privateKey = secretKeyOfNsec(stored.importedNsec);
    const pubkeyHex = privateKey && publicKeyOf(privateKey);
    if (privateKey && pubkeyHex && stored.importedNsec) {
      keys = {
        npub: nip19.npubEncode(pubkeyHex),
        nsec: stored.importedNsec,
        pubkey: pubkeyHex,
        privateKey,
      };
    }
    if (stored.walletPhrase?.mnemonicHash === mHash) {
      cashuMnemonic = stored.walletPhrase.value;
    } else if (pubkeyHex === activeProfile.pubkey) {
      const derivedPhrase = deriveCashuMnemonicForImported(
        mnemonic,
        pubkeyToAccountNumber(pubkeyHex)
      );
      cashuMnemonic = derivedPhrase;
      cacheWrites.push(() => {
        storeCashuMnemonic(accountIndex, derivedPhrase, mHash).catch((e) =>
          initLog('NostrKeys', `imported cashu cache write failed: ${e}`)
        );
      });
    }
  } else {
    // With no saved row there is nothing to hold a cached key against, so the
    // key the row is about to be made from is derived afresh.
    const cachedKeys = activeProfile ? stored.derivedKeys : null;
    const cachedPhrase = stored.walletPhrase;
    if (cachedKeys?.mnemonicHash === mHash && cachedPhrase?.mnemonicHash === mHash) {
      onProgress('Loading cached keys...');
      initLog('NostrKeys', 'using cached keys (fast path)');
      keys = {
        npub: cachedKeys.npub,
        nsec: cachedKeys.nsec,
        pubkey: cachedKeys.pubkey,
        privateKey: hexToBytes(cachedKeys.privateKeyHex),
      };
      cashuMnemonic = cachedPhrase.value;
    } else {
      onProgress('Deriving keys...');
      const derivedKeys = await initPhase('NostrKeys.deriveNip06', async () =>
        deriveNostrKeys(mnemonic, accountIndex)
      );
      const derivedPhrase = await initPhase('NostrKeys.deriveCashuMnemonic', async () =>
        deriveCashuMnemonic(mnemonic, accountIndex)
      );
      keys = derivedKeys;
      cashuMnemonic = derivedPhrase;
      const cachePayload: CachedDerivedKeys = {
        npub: derivedKeys.npub,
        nsec: derivedKeys.nsec,
        pubkey: derivedKeys.pubkey,
        privateKeyHex: bytesToHex(derivedKeys.privateKey),
        mnemonicHash: mHash,
      };
      cacheWrites.push(() => {
        Promise.all([
          storeDerivedKeys(accountIndex, cachePayload),
          storeCashuMnemonic(accountIndex, derivedPhrase, mHash),
        ]).catch((e) => initLog('NostrKeys', `cache write failed: ${e}`));
      });
    }
  }

  // ── 3. Check ──
  // The row as it will be once this load has finished: the saved one, the
  // saved one with its label corrected, or the one about to be created.
  const row: IntegrityRow | null = activeProfile
    ? { ...activeProfile, source: isImported ? 'imported' : 'derived' }
    : keys
      ? { accountIndex, pubkey: keys.pubkey, source: 'derived' }
      : null;
  if (row) {
    const integrity = await initPhase('NostrKeys.integrity', () =>
      verifyStoredAccount(row, {
        phrase: mnemonic,
        stored,
        session: { signerKey: keys?.privateKey ?? null, walletPhrase: cashuMnemonic },
        thorough: true,
      })
    );
    // Nothing is repaired and nothing is written. 0.1.3 could leave a derived
    // row naming another key (a restored backup without the keychain) and ran
    // on regardless, opening a wallet database made under a seed this phrase
    // cannot make again. It stops here instead, and a person decides.
    if (integrity && !integrity.ok) throw new AccountIntegrityError(integrity);
  }
  if (!keys) throw new Error('Saved account requires re-import');
  if (!shouldContinue()) return null;

  // ── 4. Write ──
  // Only the label changes: the account has just been shown to be sound, so
  // its caches are its own and stay.
  if (
    relabel &&
    activeProfile &&
    !useProfileStore.getState().repairDerivedSource(activeProfile.accountIndex, keys.pubkey)
  ) {
    throw new Error('Saved account requires re-import');
  }
  for (const write of cacheWrites) write();

  return { keys, cashuMnemonic, isImported };
}

function secretKeyOfNsec(nsec: string | null): Uint8Array | null {
  if (!nsec) return null;
  try {
    const decoded = nip19.decode(nsec);
    return decoded.type === 'nsec' ? decoded.data : null;
  } catch {
    return null;
  }
}

/** Null for bytes that are not a usable key (a zero scalar, for one), instead of a throw. */
function publicKeyOf(secretKey: Uint8Array): string | null {
  try {
    return getPublicKey(secretKey);
  } catch {
    return null;
  }
}
