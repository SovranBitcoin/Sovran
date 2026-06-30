/**
 * Validates a relay URL to ensure it is a valid WebSocket URL.
 *
 * @param relay - Relay URL to validate
 * @returns True if the relay URL is valid, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = isValidRelayUrl("wss://valid.relay.com");
 * // Returns: true
 *
 * const isValid = isValidRelayUrl("invalid-url");
 * // Returns: false
 * ```
 */
export declare function isValidRelayUrl(relay: string): boolean;
/** Normalizes a relay URL */
export declare function normalizeRelayUrl(relay: string): string;
