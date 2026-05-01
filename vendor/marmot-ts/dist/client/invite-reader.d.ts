import type { EventSigner } from "applesauce-core";
import { type NostrEvent } from "applesauce-core/helpers/event";
import { EventEmitter } from "eventemitter3";
import type { InviteStore, ReceivedGiftWrap, UnreadInvite } from "../store/invite-store.js";
/**
 * Events emitted by InviteReader
 */
type InviteReaderEvents = {
    /** Emitted when a gift wrap is received and added to received store */
    ReceivedGiftWrap: (invite: ReceivedGiftWrap) => void;
    /** Emitted when a new invite is successfully decrypted and added to unread */
    newInvite: (invite: UnreadInvite) => void;
    /** Emitted when an invite is marked as read and removed from unread */
    inviteRead: (inviteId: string) => void;
    /** Emitted when a received invite is removed (decrypted or failed) */
    receivedProcessed: (inviteId: string) => void;
    /** Emitted when an event fails to decrypt or parse */
    error: (error: Error, eventId: string) => void;
};
export interface InviteReaderOptions {
    /** Signer for decrypting gift wraps */
    signer: EventSigner;
    /** Storage backend for invite states */
    store: InviteStore;
}
/**
 * InviteReader orchestrates the lifecycle of reading Welcome invites.
 *
 * It takes gift-wrapped events from the app, handles decryption/parsing,
 * persists invites to storage, and provides interfaces for consumption.
 *
 * The app is responsible for:
 * - Syncing events from relays
 * - Passing gift wrap events (kind 1059) to ingestEvent()
 * - Calling decryptGiftWraps() to decrypt (triggers nip-44 decryption prompts)
 * - Reading unread invites via getUnread(), watchUnread(), or event listeners
 * - Marking invites as read after processing
 *
 * State lifecycle:
 * 1. RECEIVED: Gift wrap ingested, stored, awaiting decryption
 * 2. UNREAD: Decrypted and parsed, ready for app consumption
 * 3. SEEN: Event ID tracked to prevent re-processing
 * 4. (DELETED): Read invites are removed from storage
 *
 * @example
 * ```typescript
 * const inviteReader = new InviteReader({
 *   signer: mySigner,
 *   store: myInviteStore,
 * });
 *
 * // 1. Ingest gift wraps from relay sync
 * await inviteReader.ingestEvents(giftWraps);
 *
 * // 2. Process received invites (prompts user for decryption)
 * await inviteReader.decryptGiftWraps();
 *
 * // 3. Consume unread invites
 * const unread = await inviteReader.getUnread();
 * for (const invite of unread) {
 *   await client.joinGroupFromWelcome({ welcomeRumor: invite });
 *   await inviteReader.markAsRead(invite.id);
 * }
 * ```
 */
export declare class InviteReader extends EventEmitter<InviteReaderEvents> {
    #private;
    private signer;
    private store;
    constructor(options: InviteReaderOptions);
    /**
     * Ingest a gift wrap event (kind 1059).
     *
     * The event is checked against the 'seen' store for deduplication.
     * If new, it's stored in the 'received' state awaiting decryption.
     *
     * @param event - Gift wrap event (kind 1059)
     * @returns true if event was new and stored, false if already seen
     * @throws Error if event is not kind 1059
     */
    ingestEvent(event: NostrEvent): Promise<boolean>;
    /**
     * Ingest multiple gift wrap events in batch.
     *
     * @param events - Array of gift wrap events
     * @returns Count of new events stored
     */
    ingestEvents(events: NostrEvent[]): Promise<number>;
    /**
     * Process a single received (undecrypted) gift wrap by event ID.
     *
     * Attempts to decrypt and parse the specified event.
     * - On success: moves to 'unread' state and emits 'newInvite' event
     * - On failure: emits 'error' event (event remains in 'seen' to prevent retry)
     *
     * This method prompts the user via signer for decryption.
     * It can be used to decrypt individual invites in parallel with processReceived().
     *
     * @param eventId - The gift wrap event ID to decrypt
     * @returns The decrypted welcome rumor, or null if event not found or failed to decrypt
     * @throws Error if the event is not found in received store
     */
    decryptGiftWrap(eventId: string | ReceivedGiftWrap): Promise<UnreadInvite | null>;
    /**
     * Decrypts all received gift wraps.
     *
     * Attempts to decrypt and parse each received gift wrap.
     * - On success: moves to 'unread' state and emits 'newInvite' event
     * - On failure: emits 'error' event (event remains in 'seen' to prevent retry)
     *
     * This method prompts the user via signer for each decryption,
     * so it should be called deliberately by the app (not automatically).
     *
     * @returns Array of successfully decrypted welcome rumors
     */
    decryptGiftWraps(): Promise<UnreadInvite[]>;
    /**
     * Get all unread invites.
     *
     * @returns Array of unread welcome rumors
     */
    getUnread(): Promise<UnreadInvite[]>;
    /**
     * Get all received (encrypted) invites.
     *
     * @returns Array of received invites awaiting decryption
     */
    getReceived(): Promise<ReceivedGiftWrap[]>;
    /**
     * Mark an invite as read and remove it from storage.
     *
     * Emits 'inviteRead' event after removal.
     *
     * @param inviteId - The rumor ID (from the welcome rumor)
     */
    markAsRead(inviteId: string): Promise<void>;
    /**
     * Watch for unread invites.
     *
     * Yields the current array of unread invites, then yields again
     * whenever the unread list changes (via 'newInvite' or 'inviteRead' events).
     *
     * This does NOT automatically mark invites as read - the app must
     * call markAsRead() after processing each invite.
     *
     * @example
     * ```typescript
     * for await (const invites of inviteReader.watchUnread()) {
     *   for (const invite of invites) {
     *     await client.joinGroupFromWelcome({ welcomeRumor: invite });
     *     await inviteReader.markAsRead(invite.id);
     *   }
     * }
     * ```
     */
    watchUnread(): AsyncGenerator<UnreadInvite[]>;
    /**
     * Watch for received (undecrypted) invites.
     *
     * Yields the current list of received gift wraps, then yields again
     * whenever the received list changes (via 'ReceivedGiftWrap' or 'receivedProcessed' events).
     *
     * Useful for showing a list of pending invites that need to be decrypted.
     *
     * @example
     * ```typescript
     * for await (const received of inviteReader.watchReceived()) {
     *   console.log(`${received.length} gift wraps waiting to decrypt`);
     *   // Show "Decrypt Invites" button if received.length > 0
     * }
     * ```
     */
    watchReceived(): AsyncGenerator<ReceivedGiftWrap[]>;
    /**
     * Clear all stored invites.
     * Useful for testing or complete reset.
     *
     * Note: This does NOT clear the 'seen' store to maintain deduplication history.
     * If you need to clear seen events, use clearSeen() or create a fresh store.
     */
    clear(): Promise<void>;
    /**
     * Clear the seen event IDs.
     * Warning: This will allow previously processed events to be re-ingested.
     */
    clearSeen(): Promise<void>;
}
export {};
