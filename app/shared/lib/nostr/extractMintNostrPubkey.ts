import * as nip19 from 'nostr-tools/nip19';

import { isNostrPubkeyHex } from '@/shared/lib/protocolIds';

type MintContactEntry = { method: string; info: string };
export type MintInfoForNostr = { contact?: readonly MintContactEntry[] } | null | undefined;

/**
 * Extract the operator's Nostr pubkey from a mint's NUT-06 `contact` array.
 *
 * NUT-06 doesn't fix a serialization for the `info` field of `method: "nostr"`,
 * so operators publish either canonical 64-char hex or bech32 `npub1…`. A
 * hostile or careless mint can also ship LN addresses, attacker-controlled
 * pubkeys, or arbitrary URLs — the resolved profile is rendered under the
 * mint operator's identity, so the extractor must double as a trust gate
 * against impersonation.
 *
 * Accepts:
 *   - canonical 64-char hex (returned lowercased)
 *   - `npub1…` decoded via `nip19.decode` with checksum validation
 *
 * Rejects everything else (LN addresses, URLs, malformed bech32, wrong-type
 * bech32 prefixes, mojibake / 64-char-but-non-hex).
 */
export function extractMintNostrPubkey(mintInfo: MintInfoForNostr): string | undefined {
  const contacts = mintInfo?.contact;
  if (!Array.isArray(contacts)) return undefined;
  for (const c of contacts) {
    if (typeof c?.method !== 'string' || c.method.toLowerCase() !== 'nostr') continue;
    if (typeof c.info !== 'string') continue;
    const value = c.info.trim();
    if (!value) continue;

    if (isNostrPubkeyHex(value)) {
      return value.toLowerCase();
    }

    if (nip19.NostrTypeGuard.isNPub(value)) {
      try {
        const decoded = nip19.decode(value);
        if (decoded.type === 'npub') {
          return decoded.data.toLowerCase();
        }
      } catch {
        // Fall through to next contact entry on bad checksum / wrong prefix.
      }
    }
  }
  return undefined;
}
