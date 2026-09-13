import { useOwnProfileMetadataStore } from '@/shared/stores/profile/ownProfileMetadataStore';
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
beforeEach(() => useOwnProfileMetadataStore.setState({ latest: null, optimistic: null }));
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
  expect(stored).toEqual({ latest: snapshot });
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
