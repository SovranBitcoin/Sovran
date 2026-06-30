import { Rumor } from "applesauce-common/helpers/gift-wrap";
import { EventSigner } from "applesauce-core";
import { EventEmitter } from "eventemitter3";
import { Capabilities, ClientState, CryptoProvider, GroupInfo, Welcome } from "ts-mls";
import { CiphersuiteName } from "ts-mls/crypto/ciphersuite.js";
import { SimpleGroupOptions } from "../core/group.js";
import { GroupStateStore, GroupStateStoreBackend } from "../store/group-state-store.js";
import { KeyPackageStore } from "../store/key-package-store.js";
import { BaseGroupHistory, BaseGroupMedia, GroupHistoryFactory, GroupMediaFactory, MarmotGroup } from "./group/marmot-group.js";
import { KeyPackageManager } from "./key-package-manager.js";
import type { NostrNetworkInterface, PublishResponse } from "./nostr-interface.js";
export type MarmotClientOptions<THistory extends BaseGroupHistory | undefined = undefined, TMedia extends BaseGroupMedia | undefined = undefined> = {
    /** The signer used for the clients identity */
    signer: EventSigner;
    /** The capabilities to use for the client */
    capabilities?: Capabilities;
    /** The backend to store and load the groups from */
    groupStateBackend: GroupStateStoreBackend;
    /** The store for key package private material and publish tracking */
    keyPackageStore: KeyPackageStore;
    /** The crypto provider to use for cryptographic operations */
    cryptoProvider?: CryptoProvider;
    /** The nostr relay pool to use for the client. Should implement GroupNostrInterface for group operations. */
    network: NostrNetworkInterface;
} & (THistory extends undefined ? {} : {
    /** The group history interface to be passed to group instance */
    historyFactory: GroupHistoryFactory<THistory>;
}) & (TMedia extends undefined ? {} : {
    /** The group media interface to be passed to group instance */
    mediaFactory: GroupMediaFactory<TMedia>;
});
type MarmotClientEvents<THistory extends BaseGroupHistory | undefined = any, TMedia extends BaseGroupMedia | undefined = any> = {
    /** Emitted when the groups array is updated */
    groupsUpdated: (groups: MarmotGroup<THistory, TMedia>[]) => void;
    /** Emitted when a group is loaded from the store */
    groupLoaded: (group: MarmotGroup<THistory, TMedia>) => void;
    /** Emitted when a new group is created */
    groupCreated: (group: MarmotGroup<THistory, TMedia>) => void;
    /** Emitted when a group is imported from a ClientState object */
    groupImported: (group: MarmotGroup<THistory, TMedia>) => void;
    /** Emitted when a group is joined */
    groupJoined: (group: MarmotGroup<THistory, TMedia>) => void;
    /** Emitted when a group is unloaded */
    groupUnloaded: (groupId: Uint8Array) => void;
    /** Emitted when a group is destroyed */
    groupDestroyed: (groupId: Uint8Array) => void;
    /** Emitted when the client leaves a group via self-remove proposal events */
    groupLeft: (groupId: Uint8Array) => void;
};
export declare class MarmotClient<THistory extends BaseGroupHistory | undefined = any, TMedia extends BaseGroupMedia | undefined = any> extends EventEmitter<MarmotClientEvents<THistory, TMedia>> {
    #private;
    /** The signer used for the clients identity */
    readonly signer: EventSigner;
    /** The capabilities to use for the client */
    readonly capabilities: Capabilities;
    /** The store for group state (bytes-only) */
    readonly groupStateStore: GroupStateStore;
    /** The nostr relay pool to use for the client */
    readonly network: NostrNetworkInterface;
    /** Manages key package lifecycle: local storage, publishing, and rotation */
    readonly keyPackages: KeyPackageManager;
    /** Crypto provider for cryptographic operations */
    cryptoProvider: CryptoProvider;
    /** An array of all loaded groups */
    get groups(): MarmotGroup<THistory, TMedia>[];
    /** Group history interface to be passed to group instaces */
    private historyFactory;
    /** Group media interface to be passed to group instance */
    private mediaFactory;
    constructor(options: MarmotClientOptions<THistory, TMedia>);
    /** Get a ciphersuite implementation from a name */
    private getCiphersuiteImpl;
    /** Hydrates a SerializedClientState into a ClientState using this client's config */
    private hydrateState;
    /** Serializes a ClientState into bytes */
    private serializeState;
    /** Sets a group instance in the cache */
    private setGroupInstance;
    private clearGroupInstance;
    /** Loads a new group from the store */
    private loadGroup;
    /** Gets a group from cache or loads it from store */
    getGroup(groupId: Uint8Array | string): Promise<MarmotGroup<THistory, TMedia>>;
    /** Loads all groups from the store and returns them */
    loadAllGroups(): Promise<MarmotGroup<THistory, TMedia>[]>;
    /** Imports a new group from a ClientState object */
    importGroupFromClientState(state: ClientState): Promise<MarmotGroup<THistory, TMedia>>;
    /** Unloads a group from the client but does not remove it from the store */
    unloadGroup(groupId: Uint8Array | string): Promise<void>;
    /** Destroys a group and purges the group history */
    destroyGroup(groupId: Uint8Array | string): Promise<void>;
    /**
     * Leaves a group by publishing a self-remove proposal and purging all
     * local group data from storage.
     *
     * At least one relay must acknowledge the proposals before local state is
     * destroyed. If no relay acks, an error is thrown and local state is
     * preserved so the caller can retry.
     *
     * @param groupId - The group ID as a hex string or Uint8Array.
     * @returns The relay publish responses for the leave proposal event(s).
     */
    leaveGroup(groupId: Uint8Array | string): Promise<Record<string, PublishResponse>>;
    /** Creates a new simple group */
    createGroup(name: string, options?: SimpleGroupOptions & {
        ciphersuite?: CiphersuiteName;
    }): Promise<MarmotGroup<THistory, TMedia>>;
    /**
     * Reads the {@link GroupInfo} from a Welcome rumor without joining the group.
     *
     * Finds the local key package that matches one of the welcome's recipient slots,
     * then decrypts the group info using that key package. Useful for previewing
     * group metadata (name, relays, admins) before deciding to join.
     *
     * @param welcomeRumor - The decrypted kind 444 welcome rumor
     * @returns The decrypted GroupInfo, or null if no matching key package is found or decryption fails
     */
    readInviteGroupInfo(welcomeRumor: Rumor | Welcome): Promise<GroupInfo | null>;
    /**
     * Joins a group from a Welcome message received via NIP-59 gift wrap.
     *
     * This method:
     * 1. Decodes the Welcome message from the kind 444 event
     * 2. Finds the matching local KeyPackage private material from the store
     * 3. Calls ts-mls joinGroup() to create a new ClientState
     * 4. Persists the resulting ClientState
     * 5. Marks the consumed key package as used via `client.keyPackages.markUsed()`
     * 6. Returns a MarmotGroup instance
     *
     * After joining, callers can list used key packages with
     * `(await client.keyPackages.list()).filter(p => p.used)` and rotate them
     * via `client.keyPackages.rotate(ref)` to publish fresh ones to relays.
     *
     * @param options - Options for joining from a Welcome message
     * @param options.welcomeRumor - The unwrapped kind 444 rumor event containing the Welcome message
     * @returns Promise resolving to the joined group
     * @throws Error if no matching KeyPackage is found or if joining fails
     */
    joinGroupFromWelcome(options: {
        welcomeRumor: Rumor;
    }): Promise<{
        group: MarmotGroup<THistory, TMedia>;
    }>;
    /**
     * Watches for changes to the groups in the store.
     * Returns an async generator that yields the current list of groups
     * whenever the store changes.
     *
     * @example
     * ```ts
     * for await (const groups of client.watchGroups()) {
     *   console.log(`Groups updated: ${groups.length} groups`);
     * }
     * ```
     */
    watchGroups(): AsyncGenerator<MarmotGroup<THistory, TMedia>[]>;
}
export {};
