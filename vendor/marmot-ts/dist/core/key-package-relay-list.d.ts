import { NostrEvent, UnsignedEvent } from "applesauce-core/helpers/event";
/**
 * Gets the relay URLs from a kind 10051 event.
 * These relays indicate where a user publishes their KeyPackages.
 *
 * @param event - The kind 10051 event containing relay information
 * @returns Array of relay URLs, or empty array if none found
 *
 * @example
 * ```typescript
 * const event = {
 *   kind: 10051,
 *   tags: [
 *     ["relay", "wss://inbox.nostr.wine"],
 *     ["relay", "wss://myrelay.nostr1.com"]
 *   ],
 *   // ... other fields
 * };
 * const relays = getKeyPackageRelayList(event);
 * // Returns: ["wss://inbox.nostr.wine", "wss://myrelay.nostr1.com"]
 * ```
 */
export declare function getKeyPackageRelayList(event: NostrEvent): string[];
/**
 * Validates a kind 10051 relay list event.
 *
 * @param event - The event to validate
 * @returns True if the event is a valid kind 10051 relay list event
 *
 * @example
 * ```typescript
 * const isValid = isValidKeyPackageRelayListEvent(event);
 * if (isValid) {
 *   const relays = getKeyPackageRelayList(event);
 * }
 * ```
 */
export declare function isValidKeyPackageRelayListEvent(event: NostrEvent): boolean;
/**
 * Options for creating a key package relay list event
 */
export type CreateKeyPackageRelayListEventOptions = {
    /** The pubkey of the event author */
    pubkey: string;
    /** The relays where key packages should be published */
    relays: string[];
    /** Optional client identifier */
    client?: string;
};
/**
 * Creates an unsigned Nostr event (kind 10051) for a key package relay list.
 * The event specifies where a user publishes their key packages.
 *
 * @param options - Configuration for creating the relay list event
 * @returns An unsigned Nostr event ready to be signed and published
 *
 * @example
 * ```typescript
 * const event = createKeyPackageRelayListEvent({
 *   pubkey: "02a1633cafe37eeebe2b39b4ec5f3d74c35e61fa7e7e6b7b8c5f7c4f3b2a1b2c3d",
 *   relays: ["wss://inbox.nostr.wine", "wss://myrelay.nostr1.com"],
 *   client: "marmot-examples"
 * });
 * ```
 */
export declare function createKeyPackageRelayListEvent(options: CreateKeyPackageRelayListEventOptions): UnsignedEvent;
