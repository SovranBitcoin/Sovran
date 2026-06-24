import type { NostrTier } from '@sovranbitcoin/schemas';
import { create } from 'zustand';

/**
 * Dev-only map of note id → the facade tier that served it (nagg / primal / relay).
 *
 * The nagg-ts waterfall resolves a tier per *page* fetch, not per item, but the
 * feed/thread stores accumulate notes from many fetches — so the only accurate
 * per-post answer is to stamp each item with its page's tier at ingest. This keeps
 * the source attached to the note id (surviving merge/dedup/reorder) without
 * polluting the wire `FeedEvent` type or threading a prop through every call site.
 *
 * Entirely a debug aid: recording is a no-op outside `__DEV__`, the badge that
 * reads it renders null in production, and the state is ephemeral (never persisted).
 */
type DebugTierStore = {
  tiers: Map<string, NostrTier>;
  recordTiers: (eventIds: readonly string[], tier: NostrTier) => void;
};

const useDebugTierStore = create<DebugTierStore>((set, get) => ({
  tiers: new Map(),
  recordTiers: (eventIds, tier) => {
    if (!__DEV__ || eventIds.length === 0) return;
    const next = new Map(get().tiers);
    for (const id of eventIds) next.set(id, tier);
    set({ tiers: next });
  },
}));

/** Record the serving tier for every note id in a freshly-ingested page/thread. */
export function recordDebugTiers(eventIds: readonly string[], tier: NostrTier): void {
  useDebugTierStore.getState().recordTiers(eventIds, tier);
}

/** Subscribe to the serving tier for a single note (undefined until recorded). */
export function useDebugTier(eventId: string): NostrTier | undefined {
  return useDebugTierStore((state) => state.tiers.get(eventId));
}
