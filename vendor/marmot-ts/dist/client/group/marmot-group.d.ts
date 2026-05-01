import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import type { EventSigner } from "applesauce-core/event-factory";
import { type NostrEvent } from "applesauce-core/helpers/event";
import { EventEmitter } from "eventemitter3";
import { CiphersuiteImpl, ClientState, CryptoProvider, MlsMessage, type ProcessMessageResult, Proposal } from "ts-mls";
import { type IncomingMessageCallback } from "ts-mls/incomingMessageAction.js";
import { type MediaAttachment } from "../../core/media.js";
import { MarmotGroupData } from "../../core/protocol.js";
import { GroupStateStore } from "../../store/group-state-store.js";
import { NostrNetworkInterface, PublishResponse } from "../nostr-interface.js";
/** An event whose MLS message was successfully processed */
export type ProcessedIngestResult = {
    kind: "processed";
    /** The result of processing the event */
    result: ProcessMessageResult;
    /** The event that was processed */
    event: NostrEvent;
    /** The MLS message that was processed */
    message: MlsMessage;
};
/** A commit that was rejected by the admin-verification callback */
export type RejectedIngestResult = {
    kind: "rejected";
    /** The result returned by processMessage (actionTaken === "reject") */
    result: ProcessMessageResult;
    /** The event that was rejected */
    event: NostrEvent;
    /** The MLS message that was rejected */
    message: MlsMessage;
};
/** An event that was skipped without processing */
export type SkippedIngestResult = {
    kind: "skipped";
    /** The event that was skipped */
    event: NostrEvent;
    /** The decoded MLS message */
    message: MlsMessage;
    /**
     * Why the event was skipped:
     * - `"past-epoch"` – commit belongs to an epoch we have already advanced past
     * - `"wrong-wireformat"` – the MLS wireformat is unexpected for a group message
     * - `"self-echo"` – this event was sent by us; state was already advanced at send time
     */
    reason: "past-epoch" | "wrong-wireformat" | "self-echo";
};
/** An event that could not be decrypted or processed after all retry attempts */
export type UnreadableIngestResult = {
    kind: "unreadable";
    /** The event that could not be processed */
    event: NostrEvent;
    /** All errors captured across every retry attempt, in chronological order */
    errors: unknown[];
};
/** Result from ingesting a group event */
export type IngestResult = ProcessedIngestResult | RejectedIngestResult | SkippedIngestResult | UnreadableIngestResult;
/**
 * The minimum interface for a group to store them MLS messages
 * Implementations should extend this with methods for querying and loading stored messages
 */
export interface BaseGroupHistory {
    /** Saves a new application message to the group history */
    saveMessage(message: Uint8Array): Promise<void>;
    /** Purge the group history, called when group is destroyed */
    purgeMessages(): Promise<void>;
}
/** Shape of the stored media in a {@link BaseGroupMedia} implementation */
export type StoredMedia = {
    /** Plaintext (decrypted) file bytes. */
    data: Uint8Array;
    /** The full MIP-04 attachment metadata associated with this blob. */
    attachment: MediaAttachment;
};
/** A factory function that creates a {@link BaseGroupHistory} instance for a group id */
export type GroupHistoryFactory<THistory extends BaseGroupHistory | undefined = undefined> = (groupId: Uint8Array) => THistory;
/** The minimal implementation of a group media store */
export interface BaseGroupMedia {
    /** Adds a new media entry to the group media store */
    addMedia(sha256: string, entry: StoredMedia): Promise<void>;
    /** Retrieves a media entry from the group media store */
    getMedia(sha256: string): Promise<StoredMedia | null>;
    /** Removes a media entry from the group media store */
    removeMedia(sha256: string): Promise<void>;
    /** Lists all media entries in the group media store */
    listMedia(): Promise<MediaAttachment[]>;
    /** Clears all media entries from the group media store */
    clearMedia(): Promise<void>;
}
/** A factory function that creates a {@link BaseGroupHistory} instance for a group id */
export type GroupMediaFactory<TMedia extends BaseGroupMedia | undefined = undefined> = (groupId: Uint8Array) => TMedia;
export type ProposalContext = {
    state: ClientState;
    ciphersuite: CiphersuiteImpl;
    groupData: MarmotGroupData;
};
/** A function that builds an MLS Proposal from group context */
export type ProposalAction<T extends Proposal | Proposal[]> = (context: ProposalContext) => Promise<T>;
/** A method that creates a {@link ProposalAction} from a set of arguments */
export type ProposalBuilder<Args extends unknown[], T extends Proposal | Proposal[]> = (...args: Args) => ProposalAction<T>;
export type MarmotGroupOptions<THistory extends BaseGroupHistory | undefined = undefined, TMedia extends BaseGroupMedia | undefined = undefined> = {
    /** The state store to store and load group state from */
    stateStore: GroupStateStore;
    /** The signer used for the clients identity */
    signer: EventSigner;
    /** The ciphersuite implementation to use for the group */
    ciphersuite: CiphersuiteImpl;
    /** The nostr relay pool to use for the group. Should implement GroupNostrInterface for group operations. */
    network: NostrNetworkInterface;
    /** The storage interface for the groups application message history (optional) */
    history?: THistory | GroupHistoryFactory<THistory>;
    /**
     * Backend (or pre-wrapped store) for the plaintext blob cache used by
     * {@link MarmotGroup.decryptMedia}. Defaults to an in-memory cache when
     * not provided.
     */
    media?: TMedia | GroupMediaFactory<TMedia>;
};
/** Information about a welcome recipient */
export type WelcomeRecipient = {
    /** The recipient's Nostr public key */
    pubkey: string;
    /** The ID of KeyPackage event (kind 443) used for add operation */
    keyPackageEventId: string;
    /** The KeyPackage event (kind 443) used for add operation */
    keyPackageEvent: NostrEvent;
};
/**
 * Build an incoming-message callback that enforces MIP-03 "admin-only commits".
 *
 * Kept as a pure helper for test ergonomics and clearer policy control.
 */
export declare function createAdminCommitPolicyCallback(args: {
    ratchetTree: ClientState["ratchetTree"];
    adminPubkeys: string[];
    onUnverifiableCommit?: "reject" | "retry";
}): IncomingMessageCallback;
/** Map of events that can be emitted by a MarmotGroup */
type MarmotGroupEvents<THistory extends BaseGroupHistory | undefined = any, TMedia extends BaseGroupMedia | undefined = any> = {
    /** Emitted when the group state is updated */
    stateChanged: (state: ClientState) => void;
    /** Emitted when a new application message is received */
    applicationMessage: (message: Uint8Array) => void;
    /** Emitted when the group state is saved */
    stateSaved: (group: MarmotGroup<THistory, TMedia>) => void;
    /** Emitted when the group is destroyed */
    destroyed: (group: MarmotGroup<THistory, TMedia>) => void;
    /** Emitted when history persistence fails (best-effort, non-blocking) */
    historyError: (error: Error) => void;
};
/**
 * The main class for interacting with a MLS group
 * @template THistory - The type of the history store to use for the group, must implement the {@link BaseGroupHistory} interface. (Default is no history store)
 */
export declare class MarmotGroup<THistory extends BaseGroupHistory | undefined = undefined, TMedia extends BaseGroupMedia | undefined = undefined> extends EventEmitter<MarmotGroupEvents<THistory, TMedia>> {
    #private;
    /** The state store to store and load group state from */
    readonly stateStore: GroupStateStore;
    /** The signer used for the clients identity */
    readonly signer: EventSigner;
    /** The ciphersuite implementation to use for the group */
    readonly ciphersuite: CiphersuiteImpl;
    /** The nostr relay pool to use for the group */
    readonly network: NostrNetworkInterface;
    /** The storage interface for the groups application message history */
    readonly history: THistory;
    /** The storage interface for the groups media */
    readonly media: TMedia;
    /** Whether group state has been modified */
    dirty: boolean;
    get id(): Uint8Array<ArrayBufferLike>;
    /** The group id as a hex string */
    idStr: string;
    /** Read the current group state */
    get state(): ClientState;
    get groupData(): MarmotGroupData | null;
    get unappliedProposals(): import("ts-mls").UnappliedProposals;
    /**
     * Overrides the current group state
     * @warning It is not recommended to use this
     */
    set state(newState: ClientState);
    get relays(): string[] | undefined;
    private log;
    constructor(state: ClientState, options: MarmotGroupOptions<THistory, TMedia>);
    /** Creates a new {@link MarmotGroup} instance from a {@link ClientState} object */
    static fromClientState<THistory extends BaseGroupHistory | undefined = undefined, TMedia extends BaseGroupMedia | undefined = undefined>(state: ClientState, options: Omit<MarmotGroupOptions<THistory, TMedia>, "ciphersuite"> & {
        cryptoProvider?: CryptoProvider;
    }): Promise<MarmotGroup<THistory, TMedia>>;
    /** Persists any pending changes to the group state in the store */
    save(): Promise<void>;
    /**
     * Performs a self-update commit (no proposals) to rotate this member's leaf key material.
     *
     * This is required by MIP-02 for forward secrecy after joining from a Welcome.
     *
     * Unlike {@link commit}, this operation is allowed for non-admin members.
     */
    selfUpdate(): Promise<Record<string, PublishResponse>>;
    /**
     * Leaves the group by publishing a self-remove proposal for each of the
     * caller's leaf nodes, then purging all local group data from storage.
     *
     * Per RFC 9420 §12.4 a member cannot commit a Remove targeting their own
     * leaf. Instead, a Remove *proposal* is sent so that the next committer
     * (e.g. an admin calling {@link commit}) can include it and finalise the
     * departure. At least one relay must acknowledge the proposals before local
     * state is destroyed; if no relay acks, an error is thrown and local state
     * is preserved so the caller can retry.
     *
     * Unlike {@link commit}, this operation is allowed for non-admin members.
     *
     * @returns The relay publish responses for the leave proposal event(s).
     */
    leave(): Promise<Record<string, PublishResponse>>;
    /**
     * Creates and publishes a proposal as a private MLS message.
     * @returns Promise resolving to the publish response from the relays
     */
    propose<Args extends unknown[], T extends Proposal | Proposal[]>(action: ProposalBuilder<Args, T>, ...args: Args): Promise<Record<string, PublishResponse>>;
    propose<Args extends unknown[], T extends Proposal | Proposal[]>(action: ProposalAction<T>): Promise<Record<string, PublishResponse>>;
    /** Sends a proposal to the group relays */
    sendProposal(proposal: Proposal): Promise<Record<string, PublishResponse>>;
    /**
     * Creates and sends an application message to the group.
     *
     * Application messages contain actual content shared within the group (e.g., chat messages,
     * reactions, etc.). The inner Nostr event (rumor) must be unsigned and will be serialized
     * according to the Marmot spec.
     *
     * @param rumor - The unsigned Nostr event (rumor) to send as an application message
     * @returns Promise resolving to the publish response from the relays
     */
    sendApplicationRumor(rumor: Rumor): Promise<Record<string, PublishResponse>>;
    /**
     * Creates and sends a kind 9 chat message to the group.
     *
     * This is a convenience wrapper around {@link sendApplicationRumor} that constructs
     * the rumor for you. The message is encrypted via MLS and published as a kind 445
     * group event to the group's relays.
     *
     * @param content - The text content of the chat message
     * @param tags - Optional Nostr tags to include on the rumor
     * @returns Promise resolving to the publish response from the relays
     *
     * @example
     * ```ts
     * await group.sendChatMessage("Hello, group!");
     * await group.sendChatMessage("Reply", [["e", replyToId]]);
     * ```
     */
    sendChatMessage(content: string, tags?: string[][]): Promise<Record<string, PublishResponse>>;
    /**
     * Creates a commit from proposals and sends it to the group.
     *
     * You can provide proposals in two ways:
     * 1. Pass extraProposals to include new proposals inline
     * 2. Pass proposalRefs to select specific proposals from unappliedProposals
     * 3. Pass both to combine new proposals with selected ones
     *
     * If no extraProposals or proposalRefs are provided, createCommit will use ALL proposals
     * from state.unappliedProposals automatically.
     *
     * @param options - Options for creating the commit
     * @param options.extraProposals - New proposals to include in the commit (inline)
     * @param options.proposalRefs - Proposal references (hex strings) to select from unappliedProposals
     * @param options.welcomeRecipients - Explicit list of users to send Welcome messages to (for Add operations)
     */
    commit(options?: {
        extraProposals?: (Proposal | ProposalAction<Proposal> | (Proposal | ProposalAction<Proposal>)[])[];
        proposalRefs?: string[];
        welcomeRecipients?: WelcomeRecipient[];
    }): Promise<Record<string, PublishResponse>>;
    /**
     * Invites a user to the group using their KeyPackage event (kind 443).
     *
     * This method:
     * 1. Validates the KeyPackage event (kind 443)
     * 2. Validates that the credential identity matches the event pubkey
     * 3. Builds an Add proposal using the KeyPackage
     * 4. Commits the proposal
     * 5. After commit ack, sends a Welcome message to the invitee via NIP-59 gift wrap
     *
     * @param keyPackageEvent - The KeyPackage event (kind 443) for the user to invite
     * @returns Promise resolving to the publish response from the relays
     * @throws Error if the event is not kind 443 or if the credential identity doesn't match
     */
    inviteByKeyPackageEvent(keyPackageEvent: NostrEvent): Promise<Record<string, PublishResponse>>;
    /**
     * Creates an incoming message callback that enforces admin-only commits.
     *
     * Per MIP-03, only admins can send commits. This callback:
     * - Accepts all proposals (they don't require admin privileges)
     * - For commits, verifies that the sender is in the group's admin list
     * - Rejects commits from non-admin senders
     *
     * @returns An IncomingMessageCallback that enforces admin verification
     */
    private createAdminVerificationCallback;
    /**
     * ingests an array of group messages and applies commits to the group state.
     *
     * Processing happens in two stages:
     * 1. Process all non-commit messages (proposals, application messages)
     *    - If a message fails to process, it's added to unreadable for retry
     * 2. Process commits according to MIP-03 (sorted by epoch, timestamp, event id)
     *    - Commits advance the epoch and update the group state
     *
     * After both stages, recursively retry unreadable messages until no more can be read.
     * Events that can never be processed are yielded as {@link UnreadableIngestResult}.
     *
     * @param events - Array of Nostr events containing encrypted MLS messages
     * @param options - Options for controlling retry behavior
     * @param options.retryCount - Current retry attempt count (internal use)
     * @param options.maxRetries - Maximum number of retry attempts (default: 5)
     * @yields IngestResult - The result of processing the event
     */
    ingest(events: NostrEvent[], options?: {
        retryCount?: number;
        maxRetries?: number;
        /**
         * @internal Flat list of `{ eventId, error }` entries accumulated across
         * all retry rounds.  Passed by reference so every recursive call appends
         * to the same array, giving the final unreadable yield the full history.
         */
        _errors?: Array<{
            eventId: string;
            error: unknown;
        }>;
    }): AsyncGenerator<IngestResult>;
    /**
     * Encrypts a media file for sharing in a group message (MIP-04 v2).
     *
     * Derives the per-file key from the current MLS epoch, encrypts with
     * ChaCha20-Poly1305, and returns the ciphertext alongside a fully
     * populated {@link MediaAttachment} ready to be serialised into an
     * `imeta` tag via `createImetaTagForAttachment` from applesauce.
     *
     * **Caller responsibilities:**
     * 1. Upload `encrypted` to Blossom (or any content-addressed store).
     * 2. Set `attachment.url` to the resulting upload URL.
     * 3. Pass `attachment` (with `url`) to `createImetaTagForAttachment` and
     *    include the resulting tag on the group message rumor.
     */
    encryptMedia(blob: Blob, metadata: {
        filename: string;
        type?: string;
        dimensions?: string;
        blurhash?: string;
        alt?: string;
        size?: number;
    }): Promise<{
        encrypted: Uint8Array;
        attachment: MediaAttachment;
    }>;
    /**
     * Decrypts a MIP-04 v2 media attachment downloaded from Blossom.
     *
     * On the first call for a given file the plaintext bytes are derived via
     * key-derivation + ChaCha20-Poly1305 decryption and stored in
     * {`@link` media}. Subsequent calls for the same `attachment.sha256`
     * are served directly from the cache, skipping key-derivation entirely.
     */
    decryptMedia(encrypted: Uint8Array, attachment: MediaAttachment): Promise<StoredMedia>;
    /** Destroys the group and purges the group history */
    destroy(): Promise<void>;
}
export {};
