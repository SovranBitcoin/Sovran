/**
 * @fileoverview Constants for the Sovran application
 *
 * This module contains important constants used throughout the application,
 * including public keys for well-known Nostr profiles and other application-wide
 * configuration values.
 */

/**
 * Important public keys for well-known Nostr profiles
 *
 * This object contains public keys for official accounts so that users can
 * easily identify them.
 *
 * @constant {Object} PUBLIC_KEYS
 * @property {string} SUPPORT - Sovran Bitcoin support account public key
 *
 * @example
 * // Access the support public key
 * const supportPubkey = PUBLIC_KEYS.SUPPORT;
 *
 * // Use in Nostr queries
 * const filters = [{
 *   authors: [PUBLIC_KEYS.SUPPORT],
 *   kinds: [1], // text notes
 *   limit: 10
 * }];
 */
export const PUBLIC_KEYS = {
  /**
   * Sovran Bitcoin support account public key
   *
   * This is the official public key for Sovran's Bitcoin support account.
   * Used for customer support, official communications, and announcements
   * related to the Sovran Bitcoin wallet application.
   *
   * @constant {string} SUPPORT
   * @example
   * // Filter messages from support account
   * const supportMessages = events.filter(event =>
   *   event.pubkey === PUBLIC_KEYS.SUPPORT
   * );
   */
  SUPPORT: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
} as const;
