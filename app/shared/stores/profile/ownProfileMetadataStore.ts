import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

export const OwnProfileSnapshotSchema = z.object({
  content: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
  eventId: z.string().length(64),
});
export type OwnProfileSnapshot = z.infer<typeof OwnProfileSnapshotSchema>;
/** `null` removes the key from the published kind-0; `undefined` leaves it. */
export interface OwnProfilePatch {
  name?: string;
  picture?: string | null;
  lud16?: string | null;
  nip05?: string | null;
  about?: string | null;
}

/** The kind-0 fields whose previous values the editor offers back as
 *  quick-select suggestions. */
export const PROFILE_HISTORY_FIELDS = ['name', 'picture', 'lud16', 'nip05', 'about'] as const;
export type ProfileHistoryField = (typeof PROFILE_HISTORY_FIELDS)[number];
/** Per field: newest first, bounded so the persisted blob has a ceiling. */
export const PROFILE_HISTORY_PER_FIELD = 5;
const HistoryEntrySchema = z.object({
  value: z.string().max(4096),
  /** `created_at` of the kind-0 that last carried this value. */
  createdAt: z.number().int().nonnegative(),
});
type ProfileHistoryEntry = z.infer<typeof HistoryEntrySchema>;
type ProfileHistory = Partial<Record<ProfileHistoryField, ProfileHistoryEntry[]>>;
const ProfileHistorySchema = z
  .partialRecord(
    z.enum(PROFILE_HISTORY_FIELDS),
    z.array(HistoryEntrySchema).max(PROFILE_HISTORY_PER_FIELD)
  )
  .default({})
  .catch({});

/** The value a kind-0 carries for a history field (`name` reads the display
 *  name first, the same precedence the editor uses). */
function profileHistoryValue(
  content: Record<string, unknown>,
  field: ProfileHistoryField
): string | undefined {
  const raw =
    field === 'name'
      ? typeof content.display_name === 'string' && content.display_name
        ? content.display_name
        : content.name
      : content[field];
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

/**
 * Every value the previous kind-0 carried that the next one no longer does
 * moves to the front of that field's history (newest first, deduplicated,
 * capped). The current value is never in its own history, so the editor can
 * offer the list verbatim as "previous" choices.
 */
export function historyAfterSnapshot(
  history: ProfileHistory,
  previous: OwnProfileSnapshot | null,
  next: OwnProfileSnapshot
): ProfileHistory {
  if (!previous) return history;
  let result = history;
  for (const field of PROFILE_HISTORY_FIELDS) {
    const before = profileHistoryValue(previous.content, field);
    const after = profileHistoryValue(next.content, field);
    if (before === after) continue;
    // Re-adopting an old value pulls it back out of the history.
    const kept = (result[field] ?? []).filter(
      (entry) => entry.value !== before && entry.value !== after
    );
    const entries =
      before === undefined ? kept : [{ value: before, createdAt: previous.createdAt }, ...kept];
    if (entries.length === 0 && result[field] === undefined) continue;
    result = { ...result, [field]: entries.slice(0, PROFILE_HISTORY_PER_FIELD) };
  }
  return result;
}

interface OwnProfileMetadataStore {
  latest: OwnProfileSnapshot | null;
  /** Previous values per field, recorded from confirmed kind-0s only. */
  history: ProfileHistory;
  optimistic: (OwnProfilePatch & { createdAt: number; eventId: string }) | null;
  setLatest: (snapshot: OwnProfileSnapshot) => void;
  setOptimistic: (snapshot: OwnProfileMetadataStore['optimistic']) => void;
  clearOptimistic: (eventId: string) => void;
}
export const useOwnProfileMetadataStore = create<OwnProfileMetadataStore>()(
  persist(
    (set) => ({
      latest: null,
      history: {},
      optimistic: null,
      setLatest: (latest) =>
        set((state) =>
          state.latest &&
          (latest.createdAt < state.latest.createdAt || latest.eventId === state.latest.eventId)
            ? state
            : { latest, history: historyAfterSnapshot(state.history, state.latest, latest) }
        ),
      setOptimistic: (optimistic) => set({ optimistic }),
      clearOptimistic: (eventId) =>
        set((state) => (state.optimistic?.eventId === eventId ? { optimistic: null } : state)),
    }),
    persistConfig({
      name: 'own-profile-metadata-store',
      storage: createProfileScopedStorage(),
      schema: z.object({
        latest: OwnProfileSnapshotSchema.nullable().default(null).catch(null),
        history: ProfileHistorySchema,
      }),
      partialize: (state) => ({ latest: state.latest, history: state.history }),
    })
  )
);
