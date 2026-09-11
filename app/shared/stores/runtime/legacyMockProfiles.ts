/** Content fingerprints of fixtures injected by older builds. A public key
 * alone is never sufficient: these historical fixtures reused real identities. */
const LEGACY_PROFILES: Record<string, { name: string; about: string }> = {
  '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2': {
    name: 'satoshi',
    about: 'Just a guy who likes peer-to-peer cash.',
  },
  '50d94fc2d8580c682b071a542f8b1e31a200b0508bab95a33bef0855df281d63': {
    name: 'alice',
    about: 'mint operator. occasionally pays for coffee in sats.',
  },
  '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2': {
    name: 'bob',
    about: 'split bills with me, not with banks.',
  },
  '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d': {
    name: 'carol',
    about: 'nostr, NFC, and overpriced espresso.',
  },
};
export function isLegacyMockProfile(
  pubkey: string,
  metadata: { name?: string; about?: string }
): boolean {
  const fixture = LEGACY_PROFILES[pubkey];
  return !!fixture && metadata.name === fixture.name && metadata.about === fixture.about;
}
