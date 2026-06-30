import { Rumor } from "applesauce-common/helpers/gift-wrap";
import { GiftWrapOptions } from "applesauce-common/operations/gift-wrap";
import { EventSigner } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { PublishResponse } from "../client/nostr-interface.js";
/** Returns the value of a name / value tag */
export declare function getTagValue(event: NostrEvent, name: string): string | undefined;
/**
 * Options for creating a gift wrap event for a welcome message.
 */
export interface CreateGiftWrapOptions {
    /** The unsigned welcome event (kind 444) to wrap */
    rumor: Rumor;
    /** The recipient's public key (hex string) */
    recipient: string;
    /** The signer for creating the gift wrap */
    signer: EventSigner;
    /** Optional gift wrap options */
    opts?: GiftWrapOptions;
}
/**
 * Creates a gift wrap event (kind 1059) for a welcome message.
 *
 * Uses applesauce-factory's GiftWrapBlueprint to create the gift wrap event
 * for the recipient, providing privacy and unlinkability (NIP-59).
 *
 * @param options - Configuration for creating the gift wrap
 * @returns A signed gift wrap event ready for publishing
 */
export declare function createGiftWrap(options: CreateGiftWrapOptions): Promise<NostrEvent>;
/** Returns the current Unix timestamp in seconds */
export declare function unixNow(): number;
export declare const hasAck: (publishResult: Record<string, PublishResponse>) => boolean;
