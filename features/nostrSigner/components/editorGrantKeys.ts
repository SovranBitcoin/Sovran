/**
 * @fileoverview Canonical per-key editor rows — shared by the per-app editor
 * and the Advanced permissions screen. EVERY bundle member key is listed so
 * sibling kinds (posts vs comments, reposts vs generic reposts) are always
 * distinct, stable rows — a key must never flicker in/out of the Advanced
 * page as its grant is written and cleared. An app's stored extras (odd
 * kinds) still union in at render time.
 */

import type { GrantKey } from '@/features/nostrSigner/lib/nip46Types';

export const BASE_EDITOR_GRANT_KEYS: readonly GrantKey[] = [
  // public posting — full bundle membership
  'sign_event:1',
  'sign_event:1111',
  'sign_event:6',
  'sign_event:16',
  'sign_event:7',
  'sign_event:30023',
  'sign_event:9734',
  // account & profile
  'sign_event:0',
  'sign_event:3',
  'sign_event:5',
  'sign_event:10002',
  'sign_event:30078',
  // sign-ins
  'sign_event:22242',
  'sign_event:27235',
  // private data — kinds 4 (legacy DM) and 13 (NIP-17 seal) are the legit
  // DM-sign representatives; 14/1059 are never-sign anomalies and absent.
  // Decrypt LAST so the per-person access list reads as its continuation.
  'sign_event:4',
  'sign_event:13',
  'nip04_encrypt',
  'nip44_encrypt',
  'nip04_decrypt',
  'nip44_decrypt',
  // wallet — every kind the catalog maps to the wallet row, so a denied
  // grant on any of them lands on a stable row instead of minting one.
  'sign_event:17375',
  'sign_event:7375',
  'sign_event:7374',
  'sign_event:7376',
  'sign_event:9321',
  'sign_event:10019',
];
