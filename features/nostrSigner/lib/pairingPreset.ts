/**
 * @fileoverview "Common social actions" pairing preset
 *
 * Clients like Primal Web request ZERO permissions in their nostrconnect URI,
 * so without standing grants every action prompts — the post-login prompt
 * storm. The connect sheet offers this curated bundle (default ON, every item
 * individually uncheckable) so a fresh pairing behaves like other signers'
 * "basic actions" presets (Amber / nsec.app / Alby intersection, adapted).
 *
 * Inclusion reasoning:
 * - Public-content kinds (0, 1, 3, 6, 7, 16, 1111, 10002, 30023, 30078) — the
 *   everyday social loop plus settings persistence.
 * - Auth kinds (22242, 27235) — background relay/HTTP auth; prompt-storms
 *   otherwise and prove identity without publishing content.
 * - 9734 zap requests — a 9734 signature only authorizes FETCHING an invoice;
 *   payment happens in the user's own lightning wallet. Excluding it makes
 *   every zap prompt.
 * - Encrypt methods — write-only: they transform app-supplied plaintext into
 *   ciphertext and reveal nothing; sending still needs a sign_event the
 *   bundle does not grant. The dangerous mirror (decrypt) is excluded.
 *
 * Deliberately excluded — NEVER add without a security review:
 * - All decrypt methods (per-peer grant flow owns those).
 * - All NIP-60/61 wallet kinds (critical class; store rejects always-grants).
 * - kind 5 deletions (paramless classification fails closed to critical; the
 *   store would drop the grant — presenting it would be a lie).
 * - DM kinds 4/13/14/1059 (silent private speech as the user).
 */

import { isGrantKey, type GrantKey } from './nip46Types';

export const PAIRING_PRESET_GRANT_KEYS: readonly GrantKey[] = [
  'sign_event:0',
  'sign_event:1',
  'sign_event:3',
  'sign_event:6',
  'sign_event:7',
  'sign_event:16',
  'sign_event:1111',
  'sign_event:9734',
  'sign_event:10002',
  'sign_event:22242',
  'sign_event:27235',
  'sign_event:30023',
  'sign_event:30078',
  'nip04_encrypt',
  'nip44_encrypt',
];

/**
 * Preset keys not already covered by the URI's own perm rows (URI rows keep
 * their presentation and defaults; the preset only adds what's missing).
 */
export function presetGrantKeysExcluding(covered: ReadonlySet<string>): GrantKey[] {
  return PAIRING_PRESET_GRANT_KEYS.filter(
    (grantKey) => isGrantKey(grantKey) && !covered.has(grantKey)
  );
}
