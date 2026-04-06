/** Well-known Nostr public keys for the Sovran app. */
export const PUBLIC_KEYS = {
  /** Official Sovran Bitcoin support account */
  SUPPORT: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
} as const;

/**
 * Sentinel pubkey that switches the userMessages screen to
 * Routstr AI chat mode instead of Nostr DM mode.
 */
export const ROUTSTR_PUBKEY =
  '8bf629b3d519a0f8a8390137a445c0eb2f5f2b4a8ed71151de898051e8006f13' as const;

