import { EventSigner } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { EventEmitter } from "eventemitter3";
import { CiphersuiteName } from "ts-mls/crypto/ciphersuite.js";
import { PrivateKeyPackage } from "ts-mls/keyPackage.js";
import { KeyPackageStore, ListedKeyPackage, StoredKeyPackage } from "../store/key-package-store.js";
import { NostrNetworkInterface } from "./nostr-interface.js";
/**
 * Thrown by {@link KeyPackageManager.create} when no relay URLs are provided.
 * Callers can catch this specifically to prompt the user for relay configuration.
 */
export declare class MissingRelayError extends Error {
    constructor();
}
/**
 * Thrown by {@link KeyPackageManager.rotate} when the given key package
 * reference is not found in the local store.
 */
export declare class KeyPackageNotFoundError extends Error {
    constructor(refHex: string);
}
/**
 * Thrown by {@link KeyPackageManager.rotate} when no relay URLs can be
 * determined for the replacement key package — neither passed explicitly
 * nor recoverable from the old package's publish records.
 */
export declare class KeyPackageRotatePreconditionError extends Error {
    constructor();
}
/**
 * A key package entry as returned by {@link KeyPackageManager.list}
 * and {@link KeyPackageManager.watchKeyPackages}.
 *
 * Merges the locally stored key package with its published Nostr events,
 * giving a unified view of both private storage state and relay publish
 * state in a single object.
 */
export type KeyPackageEntry = ListedKeyPackage & {
    published: NostrEvent[];
};
/** Options for creating a new key package */
export type CreateKeyPackageOptions = {
    /** Relay URLs where the key package event will be published (required) */
    relays: string[];
    /** Ciphersuite to use (default: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519) */
    ciphersuite?: CiphersuiteName;
    /** Whether to mark the key package with the MLS last_resort extension (default: true) */
    isLastResort?: boolean;
    /** Client identifier string to include in the key package event */
    client?: string;
    /** Whether to include the NIP-70 protected tag on the event */
    protected?: boolean;
};
/** Options for rotating a key package */
export type RotateKeyPackageOptions = {
    /**
     * Relay URLs for the new key package event.
     * If omitted, the relays from the most recent publish of the old key package are reused.
     */
    relays?: string[];
    /** Ciphersuite to use for the new key package */
    ciphersuite?: CiphersuiteName;
    /** Whether to mark the new key package with the MLS last_resort extension (default: true) */
    isLastResort?: boolean;
    /** Client identifier string to include in the new key package event */
    client?: string;
    /** Whether to include the NIP-70 protected tag on the new event */
    protected?: boolean;
};
type KeyPackageManagerEvents = {
    /** Emitted when a key package is stored locally */
    keyPackageAdded: (keyPackage: StoredKeyPackage) => void;
    /** Emitted when a key package is removed from local storage */
    keyPackageRemoved: (keyPackageRef: Uint8Array) => void;
    /** Emitted when a key package is updated */
    keyPackageUpdated: (keyPackage: StoredKeyPackage) => void;
    /** Emitted when a key package publish is recorded (own publish or observed relay event) */
    keyPackagePublished: (refHex: string, eventId: string, relays: string[]) => void;
};
/**
 * Manages the full lifecycle of MLS key packages — local private material and
 * the Nostr kind-443 events that advertise this client to potential inviters.
 *
 * @example
 * ```typescript
 * // Create and publish a key package
 * const pkg = await client.keyPackages.create({ relays: ["wss://relay.example.com"] });
 *
 * // Feed observed relay events — any kind 443 with an `i` tag is recorded
 * await client.keyPackages.track(nostrEvent);
 *
 * // Rotate: delete old from relays, publish new
 * const newPkg = await client.keyPackages.rotate(pkg.keyPackageRef);
 *
 * // List all key packages, filtering to those with published events
 * const published = (await client.keyPackages.list())
 *   .filter(p => p.published.length > 0);
 * ```
 */
export declare class KeyPackageManager extends EventEmitter<KeyPackageManagerEvents> {
    #private;
    /** The underlying private key material store */
    readonly store: KeyPackageStore;
    private readonly signer;
    private readonly network;
    constructor(options: {
        keyPackageStore: KeyPackageStore;
        signer: EventSigner;
        network: NostrNetworkInterface;
    });
    /**
     * Creates a new key package, stores the private material locally, signs and
     * publishes a kind 443 event to the specified relays, and records the event.
     *
     * @param options - Creation options, including required relay URLs
     * @returns The stored key package (without private material)
     * @throws {MissingRelayError} if relays is empty
     */
    create(options: CreateKeyPackageOptions): Promise<ListedKeyPackage>;
    /**
     * Rotates a key package: publishes a kind 5 deletion for all known relay event
     * IDs of the old key package, then creates and publishes a new one, and removes
     * the old private key material and publish records.
     *
     * If the old key package has no recorded published events, the deletion step is
     * skipped. If no relays are passed in options, the relays from the most recent
     * published event of the old key package are reused (via its `relays` tag).
     *
     * @param ref - The key package reference of the key package to rotate
     * @param options - Options for the new key package
     * @returns The new stored key package (without private material)
     * @throws {KeyPackageNotFoundError} if the key package ref is not found in the local store
     * @throws {KeyPackageRotatePreconditionError} if no relay URLs can be determined for the new key package
     */
    rotate(ref: Uint8Array | string, options?: RotateKeyPackageOptions): Promise<ListedKeyPackage>;
    /**
     * Removes a key package from local private key storage only.
     *
     * Does not publish a relay deletion and does not touch publish records.
     * Use when the key package was never published, or when relay cleanup has
     * already been handled separately.
     *
     * @param ref - The key package reference to remove
     */
    remove(ref: Uint8Array | string): Promise<void>;
    /**
     * Completely purges one or more key packages: publishes a kind 5 (NIP-09)
     * deletion for all known relay event IDs, removes local private key material,
     * and clears the publish records.
     *
     * Accepts a single ref or an array of refs so callers can bulk-purge in one
     * shot (e.g. "nuke everything and start fresh"). Refs with no recorded
     * published events are silently skipped for the network step — no kind 5 is
     * published for them — but their local private key material is still removed.
     *
     * @param refs - One or more key package references (hex string or Uint8Array)
     */
    purge(refs: Uint8Array | string | Array<Uint8Array | string>): Promise<void>;
    /**
     * Observes a Nostr event and, if it is a kind 443 key package event with a
     * valid `i` tag (MIP-00 keyPackageRef), records it in the store.
     *
     * This is the primary way for apps to populate publish records from relay
     * subscriptions. Records all observed kind 443 events regardless of whether
     * private key material is held locally — enabling deletion of key packages
     * published by other devices.
     *
     * @param event - Any Nostr event; non-443 events are silently ignored
     * @returns `true` if the event was recorded, `false` if ignored
     */
    track(event: NostrEvent): Promise<boolean>;
    /**
     * Lists all locally stored key packages, each enriched with their published
     * Nostr events.
     *
     * Returns the same shape as {@link watchKeyPackages} snapshots so apps can
     * use identical rendering logic for both the initial load and live updates.
     */
    list(): Promise<KeyPackageEntry[]>;
    /** Returns the number of locally stored key packages. */
    count(): Promise<number>;
    /** Checks whether a key package exists in local private key storage. */
    has(ref: Uint8Array | string): Promise<boolean>;
    /** Retrieves the full key package from the store. */
    get(ref: Uint8Array | string): Promise<StoredKeyPackage | null>;
    /**
     * Retrieves the private key material for a key package.
     * Used internally by {@link MarmotClient} when processing Welcome messages.
     *
     * @param ref - The key package reference
     * @returns The private key package, or null if not found
     */
    getPrivateKey(ref: Uint8Array | string): Promise<PrivateKeyPackage | null>;
    /**
     * Marks a key package as used by setting `used = true` on the stored entry.
     *
     * This flag signals that the key package has been consumed (e.g. used to join
     * a group). Applications can use this to periodically list and rotate used
     * key packages to maintain a fresh supply on relays.
     *
     * Does nothing if no entry is found for the given ref.
     *
     * @param ref - The key package reference
     */
    markUsed(ref: Uint8Array | string): Promise<void>;
    /**
     * Watches for any change to key packages or their published events.
     *
     * Yields the current snapshot on subscription (after listeners are installed),
     * then re-yields on every subsequent change. Each snapshot is a list of all
     * locally stored key packages merged with their published Nostr events.
     *
     * Listens to both `keyPackageAdded`/`keyPackageRemoved` (private store changes)
     * and `keyPackagePublished` (publish record changes) to ensure the snapshot
     * stays up to date regardless of what changed.
     *
     * @example
     * ```ts
     * for await (const packages of client.keyPackages.watchKeyPackages()) {
     *   console.log(`${packages.length} key packages, ` +
     *     `${packages.filter(p => p.published.length > 0).length} published`);
     * }
     * ```
     */
    watchKeyPackages(): AsyncGenerator<KeyPackageEntry[]>;
}
export {};
