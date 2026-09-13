import {
  PROFILE_HISTORY_PER_FIELD,
  historyAfterSnapshot,
  useOwnProfileMetadataStore,
} from '@/shared/stores/profile/ownProfileMetadataStore';
import { useOwnedMediaStore } from '@/shared/stores/profile/ownedMediaStore';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
const snapshot = {
  content: { name: 'Name', custom: { nested: true } },
  createdAt: 50,
  eventId: 'a'.repeat(64),
};
beforeEach(() =>
  useOwnProfileMetadataStore.setState({ latest: null, history: {}, optimistic: null })
);
it('rejects older snapshots and accepts equal or newer timestamps', () => {
  const store = useOwnProfileMetadataStore.getState();
  store.setLatest(snapshot);
  store.setLatest({ ...snapshot, createdAt: 49, eventId: 'b'.repeat(64) });
  expect(useOwnProfileMetadataStore.getState().latest).toBe(snapshot);
  const equal = { ...snapshot, eventId: 'c'.repeat(64) };
  store.setLatest(equal);
  expect(useOwnProfileMetadataStore.getState().latest).toBe(equal);
});
it('persists only the confirmed snapshot and retains unknown content', () => {
  const store = useOwnProfileMetadataStore.getState();
  store.setLatest(snapshot);
  store.setOptimistic({ name: 'Pending', createdAt: 51, eventId: 'b'.repeat(64) });
  const options = useOwnProfileMetadataStore.persist.getOptions();
  const stored = JSON.parse(
    JSON.stringify(options.partialize!(useOwnProfileMetadataStore.getState()))
  );
  expect(stored).toEqual({ latest: snapshot, history: {} });
  expect(options.merge!(stored, { ...store, optimistic: null })).toMatchObject({
    latest: snapshot,
    optimistic: null,
  });
});
it.each([{}, { latest: { content: [], eventId: 'bad', createdAt: -1 } }, { latest: null }])(
  'malformed or old storage defaults safely: %j',
  (stored) => {
    const options = useOwnProfileMetadataStore.persist.getOptions();
    expect(options.merge!(stored, useOwnProfileMetadataStore.getState()).latest).toBeNull();
  }
);
it('clears only the matching optimistic operation', () => {
  const store = useOwnProfileMetadataStore.getState();
  store.setOptimistic({ name: 'Pending', createdAt: 51, eventId: 'b'.repeat(64) });
  store.clearOptimistic('a'.repeat(64));
  expect(useOwnProfileMetadataStore.getState().optimistic).not.toBeNull();
  store.clearOptimistic('b'.repeat(64));
  expect(useOwnProfileMetadataStore.getState().optimistic).toBeNull();
});
it('avatar purpose is additive and unknown purposes preserve ownership rows', () => {
  useOwnedMediaStore.setState({ byBlob: {} });
  useOwnedMediaStore
    .getState()
    .recordBlobs(
      [{ sha256: 'a'.repeat(64), url: 'https://example.com/a', host: 'https://example.com' }],
      undefined,
      'avatar'
    );
  const entry = Object.values(useOwnedMediaStore.getState().byBlob)[0];
  expect(entry.purpose).toBe('avatar');
  const schema = persistRegistry.find((entry) => entry.name === 'owned-media-store')!.schema;
  for (const purpose of [undefined, 'future-purpose']) {
    const parsed = schema.parse({ byBlob: { blob: { ...entry, purpose } } });
    expect(parsed).toEqual({ byBlob: { blob: { ...entry, purpose: undefined } } });
  }
});

describe('field history', () => {
  const at = (createdAt: number, content: Record<string, unknown>) => ({
    content,
    createdAt,
    eventId: createdAt.toString(16).padStart(64, '0'),
  });
  it('records a replaced value once, newest first, never the current value', () => {
    const store = useOwnProfileMetadataStore.getState();
    store.setLatest(at(1, { name: 'One', lud16: 'a@ln.example' }));
    expect(useOwnProfileMetadataStore.getState().history).toEqual({});
    store.setLatest(at(2, { display_name: 'Two', lud16: 'a@ln.example' }));
    store.setLatest(at(3, { display_name: 'Three', lud16: 'b@ln.example', about: 'Bio' }));
    store.setLatest(at(4, { display_name: 'Two', lud16: 'b@ln.example' }));
    expect(useOwnProfileMetadataStore.getState().history).toEqual({
      name: [
        { value: 'Three', createdAt: 3 },
        { value: 'One', createdAt: 1 },
      ],
      lud16: [{ value: 'a@ln.example', createdAt: 2 }],
      about: [{ value: 'Bio', createdAt: 3 }],
    });
  });
  it('ignores stale snapshots and caps each field at the schema ceiling', () => {
    const store = useOwnProfileMetadataStore.getState();
    for (let i = 1; i <= PROFILE_HISTORY_PER_FIELD + 3; i += 1)
      store.setLatest(at(i, { nip05: `v${i}@id.example` }));
    store.setLatest(at(0, { nip05: 'stale@id.example' }));
    const history = useOwnProfileMetadataStore.getState().history.nip05!;
    expect(history).toHaveLength(PROFILE_HISTORY_PER_FIELD);
    expect(history[0]).toEqual({ value: 'v7@id.example', createdAt: 7 });
    expect(history.some((entry) => entry.value === 'stale@id.example')).toBe(false);
    const options = useOwnProfileMetadataStore.persist.getOptions();
    const stored = JSON.parse(
      JSON.stringify(options.partialize!(useOwnProfileMetadataStore.getState()))
    );
    const schema = persistRegistry.find((e) => e.name === 'own-profile-metadata-store')!.schema;
    expect(schema.safeParse(stored).success).toBe(true);
  });
  it('drops a malformed history without losing the snapshot', () => {
    const options = useOwnProfileMetadataStore.persist.getOptions();
    const merged = options.merge!(
      { latest: snapshot, history: { name: 'not-a-list' } },
      useOwnProfileMetadataStore.getState()
    );
    expect(merged.latest).toEqual(snapshot);
    expect(merged.history).toEqual({});
  });
  it('is a pure function of previous and next content', () => {
    expect(historyAfterSnapshot({}, null, at(1, { name: 'x' }))).toEqual({});
    expect(
      historyAfterSnapshot(
        { name: [{ value: 'z', createdAt: 0 }] },
        at(1, { name: 'y' }),
        at(2, {})
      )
    ).toEqual({
      name: [
        { value: 'y', createdAt: 1 },
        { value: 'z', createdAt: 0 },
      ],
    });
  });
});
