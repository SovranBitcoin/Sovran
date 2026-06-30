import { GiftWrapBlueprint } from "applesauce-common/blueprints/gift-wrap";
import { createEvent } from "applesauce-core/event-factory";
/** Returns the value of a name / value tag */
export function getTagValue(event, name) {
    return event.tags.find((t) => t[0] === name)?.[1];
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
export async function createGiftWrap(options) {
    const { rumor, recipient, signer, opts } = options;
    // Use the GiftWrapBlueprint to create the gift wrap
    return await createEvent({ signer }, GiftWrapBlueprint, recipient, rumor, opts);
}
/** Returns the current Unix timestamp in seconds */
export function unixNow() {
    return Math.floor(Date.now() / 1000);
}
export const hasAck = (publishResult) => Object.values(publishResult).some((res) => res.ok);
//# sourceMappingURL=nostr.js.map