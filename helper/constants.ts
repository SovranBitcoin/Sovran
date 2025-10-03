export const EventKind = {
  Unknown: -1,
  Metadata: 0,
  TextNote: 1,
  RecommendServer: 2,
  ContactList: 3, // NIP-02
  DirectMessage: 4, // NIP-04
  Deletion: 5, // NIP-09
  Repost: 6, // NIP-18
  Reaction: 7, // NIP-25
  BadgeAward: 8, // NIP-58
  SnortSubscriptions: 1000, // NIP-XX
  Polls: 6969, // NIP-69
  FileHeader: 1063, // NIP-94
  Relays: 10002, // NIP-65 Relay List Metadata
  Ephemeral: 20_000,
  Auth: 22242, // NIP-42
  PubkeyLists: 30000, // NIP-51a
  NoteLists: 30001, // NIP-51b
  TagLists: 30002, // NIP-51c
  Badge: 30009, // NIP-58
  ProfileBadges: 30008, // NIP-58
  ZapRequest: 9734, // NIP 57
  ZapReceipt: 9735, // NIP 57
  HttpAuthentication: 27235, // NIP XX - HTTP Authentication
} as const;

/**
 * Important public keys for well-known Nostr profiles
 * These are public keys for official accounts, support, and other important entities
 */
export const PUBLIC_KEYS = {
  /**
   * Sovran Bitcoin support account
   * Used for customer support and official communications
   */
  SUPPORT: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',

  /**
   * Add other important public keys here as needed
   * Example:
   * OFFICIAL_ANNOUNCEMENTS: 'pubkey_here',
   * DEVELOPER_ACCOUNT: 'pubkey_here',
   */
} as const;
