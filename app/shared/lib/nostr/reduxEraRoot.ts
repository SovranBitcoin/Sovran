import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { z } from 'zod';

/**
 * Releases 0.0.1 to 0.0.40 kept everything in one redux-persist row. Its
 * top-level values are JSON strings, one per reducer, and the wallet phrase
 * sits in the nostr one, on each profile. 0.0.45 copied the phrase of profile
 * 0 into SecureStore and left the row as it was; that migration is gone, so a
 * phone that skipped those releases still has its only copy here.
 *
 * This module only reads. The row also holds the old ecash proofs. Those are
 * claimed by `cashu/legacyEcashClaim`, which removes the row once every proof
 * is in a wallet or spent and this phrase is the one in SecureStore (ADR 32).
 */
export const REDUX_ERA_ROW = 'persist:SOVRAN';

export type ReduxEraRoot =
  /** A phrase the old app could have been using. */
  | { kind: 'phrase'; mnemonic: string }
  /** No row, or the row of an install that never made a wallet. */
  | { kind: 'none' }
  /** A row that held, or may have held, a wallet whose phrase cannot be read. */
  | { kind: 'unreadable' };

const Row = z.object({ nostr: z.string() });
const NostrSlice = z.object({
  // `{ id: 0 }` until a profile was chosen, then the chosen profile's fields
  // with `id` set to its position in `profiles`.
  currentProfile: z.record(z.string(), z.unknown()).optional(),
  profiles: z.array(z.unknown()),
});

/**
 * The phrase exactly as stored, or null. It is not trimmed or re-spaced: the
 * old app derived its keys from this exact string, so a tidied copy could
 * name a different wallet.
 */
function phraseOf(profile: unknown): string | null {
  if (typeof profile !== 'object' || profile === null) return null;
  const mnemonic: unknown = Reflect.get(profile, 'mnemonic');
  if (typeof mnemonic !== 'string') return null;
  // The root is always 12 words; storeMnemonic refuses anything else.
  if (mnemonic.split(' ').length !== 12) return null;
  return bip39.validateMnemonic(mnemonic, wordlist) ? mnemonic : null;
}

export function readReduxEraRoot(raw: string | null): ReduxEraRoot {
  if (raw === null) return { kind: 'none' };

  let nostr: z.infer<typeof NostrSlice>;
  try {
    nostr = NostrSlice.parse(JSON.parse(Row.parse(JSON.parse(raw)).nostr));
  } catch {
    return { kind: 'unreadable' };
  }

  const { currentProfile: current, profiles } = nostr;
  // The profile the old app had open comes first, found by key and then by
  // position, then its own copy of the fields. Profiles added by public key
  // alone carry no phrase, so the rest are tried in order after it.
  const candidates: unknown[] = [
    profiles.find(
      (profile) =>
        typeof current?.pubkey === 'string' &&
        typeof profile === 'object' &&
        profile !== null &&
        Reflect.get(profile, 'pubkey') === current.pubkey
    ),
    typeof current?.id === 'number' ? profiles[current.id] : undefined,
    current,
    ...profiles,
  ];
  for (const candidate of candidates) {
    const mnemonic = phraseOf(candidate);
    if (mnemonic) return { kind: 'phrase', mnemonic };
  }

  // The old app wrote this row on first launch, before any wallet existed,
  // and wrote it again after a reset. Releases 0.0.45 to 0.1.1 still wrote
  // it, as redux's starting state: one profile whose identity and secrets are
  // all empty strings. Only a row that explicitly names no identity is
  // evidence that there was never a phrase to lose; a profile with a public
  // key and no phrase is not.
  const neverSetUp = profiles.every(isBlank) && isBlank(current);
  return neverSetUp ? { kind: 'none' } : { kind: 'unreadable' };
}

/** True for a profile whose identity, phrase and keys are all absent or empty. */
function isBlank(profile: unknown): boolean {
  if (profile === undefined) return true;
  if (typeof profile !== 'object' || profile === null) return false;
  const root: unknown = Reflect.get(profile, 'root');
  const fields: unknown[] = [
    Reflect.get(profile, 'pubkey'),
    Reflect.get(profile, 'npub'),
    Reflect.get(profile, 'mnemonic'),
    Reflect.get(profile, 'nsec'),
    Reflect.get(profile, 'nut13'),
    typeof root === 'object' && root !== null ? Reflect.get(root, 'xpriv') : root,
  ];
  return fields.every((field) => field === undefined || field === '');
}
