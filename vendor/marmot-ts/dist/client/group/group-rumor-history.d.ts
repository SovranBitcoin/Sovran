import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import type { Filter } from "applesauce-core/helpers/filter";
import { EventEmitter } from "eventemitter3";
import { BaseGroupHistory, GroupHistoryFactory } from "../index.js";
/** A rumor storage interface for the {@link GroupRumorHistory} class */
export interface GroupRumorHistoryBackend {
    /** Load rumor events from a specific time in history. Results are ordered by created_at descending (newest first). */
    queryRumors(filters: Filter | Filter[]): Promise<Rumor[]>;
    /** Save a new group rumor event */
    addRumor(message: Rumor): Promise<void>;
    /** Clear all rumor events from the backend */
    clear(): Promise<void>;
}
/** A map of events that can be emitted by a {@link GroupRumorHistory} */
type GroupRumorHistoryEvents = {
    rumor: (rumor: Rumor) => void;
    cleared: () => void;
};
/** A group.history implementation that stores the parsed rumor events for a group and provies methods for querying */
export declare class GroupRumorHistory extends EventEmitter<GroupRumorHistoryEvents> implements BaseGroupHistory {
    private backend;
    constructor(backend: GroupRumorHistoryBackend);
    /** Creates a new method that will create {@link GroupRumorHistory} instances for a group id */
    static makeFactory(backendFactory: (groupId: Uint8Array) => GroupRumorHistoryBackend): GroupHistoryFactory<GroupRumorHistory>;
    /** Parses an MLS message and saves it as a rumor event */
    saveMessage(message: Uint8Array): Promise<void>;
    /** Saves a new rumor event to the backend */
    saveRumor(rumor: Rumor): Promise<void>;
    /** Purge all rumor events from the backend */
    purgeMessages(): Promise<void>;
    /** Request stored rumors by filters */
    queryRumors(filters: Filter | Filter[]): Promise<Rumor[]>;
    /**
     * Async generator that yields the current timeline of {@link Rumor} events whenever a
     * new rumor is saved that matches `filters` or the history is cleared. The initial snapshot
     * is emitted immediately on subscription, then again after every matching `rumor` event or
     * `cleared` event.
     *
     * The generator runs until the caller breaks out of the loop or the consuming
     * iterator is garbage-collected (via the `finally` cleanup).
     */
    subscribe(filters?: Filter | Filter[]): AsyncGenerator<Rumor[]>;
    /**
     * Creates an async generator for paginated loading of historical rumor events.
     *
     * This method allows UI components to load historical messages in pages, enabling
     * infinite scroll or paginated UI patterns.
     *
     * @param filter - Optional filter to apply to the query
     * @yields Batches of Rumor events, with each batch containing up to `filter.limit` messages
     *
     * @example
     * ```ts
     * const generator = group.history.createPaginatedLoader(groupId, 50);
     * for await (const page of generator) {
     *   // Process page of messages
     *   console.log(`Loaded ${page.length} messages`);
     * }
     * ```
     */
    createPaginatedLoader(filter?: Filter): AsyncGenerator<Rumor[], void>;
}
export {};
