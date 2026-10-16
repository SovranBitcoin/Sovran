import { getPublicKey } from 'nostr-tools/pure';
import { decode } from 'nostr-tools/nip19';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
import {
  hashMnemonic,
  readAccountSecretsUnchanged,
  retrieveImportedNsec,
  retrieveMnemonic,
} from '@/shared/lib/nostr/secureStorage';
import {
  deriveNostrKeys,
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';

export interface RecoveryInformation {
  mnemonic: string | null;
  nsec: string | null;
  cashuMnemonic: string | null;
  /**
   * A wallet phrase cached on this device, stamped as made from the current
   * recovery phrase, that is not the one the phrase derives. The wallet may
   * have been opened under it, so a person keeping a copy needs both.
   */
  storedCashuMnemonic?: string;
}

/** Only reads/derives existing keys. Never initializes, switches a profile, publishes, or accepts terms. */
export async function readRecoveryInformation(
  profile: ProfileEntry | null
): Promise<RecoveryInformation> {
  const mnemonic = await retrieveMnemonic();
  if (!profile) {
    if (!mnemonic) throw new Error('Root recovery phrase is unavailable.');
    return { mnemonic, nsec: null, cashuMnemonic: null };
  }
  const imported = profile.source === 'imported';
  // Read as it is: this page is where a mismatched account's keys are copied
  // from, so it must never be the thing that deletes one.
  const stored = await readAccountSecretsUnchanged(profile.accountIndex, null);
  let nsec: string;
  if (imported) {
    const importedNsec = await retrieveImportedNsec(profile.pubkey);
    if (!importedNsec) throw new Error('Imported private key is unavailable.');
    if (pubkeyOfNsec(importedNsec) !== profile.pubkey)
      throw new Error('Stored key does not match this profile.');
    nsec = importedNsec;
  } else {
    if (!mnemonic) throw new Error('Root recovery phrase is unavailable.');
    const keys = deriveNostrKeys(mnemonic, profile.accountIndex);
    if (keys.pubkey !== profile.pubkey) {
      // The phrase does not derive this profile. The key it was made with may
      // still be in the key cache; if so it is the only copy on this device,
      // and the critical screen sends people here to write it down.
      const kept = stored.keptDerivedNsec;
      if (!kept || pubkeyOfNsec(kept) !== profile.pubkey)
        throw new Error('Recovery phrase does not match this profile.');
      return {
        mnemonic,
        nsec: kept,
        // The wallet phrase cached beside it, if both came from one phrase.
        cashuMnemonic:
          stored.derivedKeys &&
          stored.walletPhrase?.mnemonicHash === stored.derivedKeys.mnemonicHash
            ? stored.walletPhrase.value
            : null,
      };
    }
    nsec = keys.nsec;
  }
  const cashu = !mnemonic
    ? null
    : imported
      ? deriveCashuMnemonicForImported(mnemonic, pubkeyToAccountNumber(profile.pubkey))
      : deriveCashuMnemonic(mnemonic, profile.accountIndex);
  const cached = stored.walletPhrase;
  const conflicting =
    mnemonic &&
    cashu &&
    cached &&
    cached.mnemonicHash === hashMnemonic(mnemonic) &&
    cached.value !== cashu;
  return {
    mnemonic,
    nsec,
    cashuMnemonic: cashu,
    ...(conflicting ? { storedCashuMnemonic: cached.value } : {}),
  };
}

function pubkeyOfNsec(nsec: string): string | null {
  try {
    const decoded = decode(nsec);
    return decoded.type === 'nsec' ? getPublicKey(decoded.data) : null;
  } catch {
    return null;
  }
}
