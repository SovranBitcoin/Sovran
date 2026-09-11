import { getPublicKey } from 'nostr-tools/pure';
import { decode } from 'nostr-tools/nip19';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
import { retrieveMnemonic, retrieveImportedNsec } from '@/shared/lib/nostr/secureStorage';
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
  let nsec: string;
  if (profile.source === 'imported') {
    const imported = await retrieveImportedNsec(profile.pubkey);
    if (!imported) throw new Error('Imported private key is unavailable.');
    const decoded = decode(imported);
    if (decoded.type !== 'nsec' || getPublicKey(decoded.data) !== profile.pubkey)
      throw new Error('Stored key does not match this profile.');
    nsec = imported;
  } else {
    if (!mnemonic) throw new Error('Root recovery phrase is unavailable.');
    const keys = deriveNostrKeys(mnemonic, profile.accountIndex);
    if (keys.pubkey !== profile.pubkey)
      throw new Error('Recovery phrase does not match this profile.');
    nsec = keys.nsec;
  }
  const cashu = !mnemonic
    ? null
    : profile.source === 'imported'
      ? deriveCashuMnemonicForImported(mnemonic, pubkeyToAccountNumber(profile.pubkey))
      : deriveCashuMnemonic(mnemonic, profile.accountIndex);
  return { mnemonic, nsec, cashuMnemonic: cashu };
}
