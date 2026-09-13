import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
it('round trips populated dismissals, omits runtime state, and retains unknown future IDs', () => {
  const store = useCtaStore;
  store.getState().dismiss('backup-recovery-phrase', true);
  store.getState().dismiss('backup-recovery-phrase', false);
  store.getState().preview('update-required');
  store.getState().setActive('update-required');
  store.getState().closeActive();
  store.getState().startBackup();
  const options = store.persist.getOptions();
  const projection = JSON.parse(JSON.stringify(options.partialize!(store.getState())));
  expect(Object.keys(projection)).toEqual(['dismissed']);
  const schema = persistRegistry.find((s) => s.name === 'cta-store')!.schema;
  expect(schema.parse(projection)).toEqual(projection);
  expect(schema.parse({ dismissed: { future: { at: 123, version: '2.0.0' } } })).toEqual({
    dismissed: { future: { at: 123, version: '2.0.0' } },
  });
  expect(schema.parse({})).toEqual({ dismissed: {} });
  expect(schema.parse({ dismissed: { future: { at: -1 } } })).toEqual({ dismissed: {} });
});
it('hydrates old and malformed verification values without losing seed or restore markers', () => {
  const schema = persistRegistry.find((s) => s.name === 'wallet-lifecycle')!.schema;
  const old = {
    seedCreatedAt: 123,
    restoreStatus: 'complete',
    lastRestoreAt: 456,
    lastRestoreError: null,
  };
  expect(schema.parse(old)).toEqual({
    ...old,
    recoveryPhraseVerifiedAt: null,
    recoveryPhraseVerifiedRevision: null,
  });
  expect(schema.parse({ ...old, recoveryPhraseVerifiedAt: 'bad' })).toEqual({
    ...old,
    recoveryPhraseVerifiedAt: null,
    recoveryPhraseVerifiedRevision: null,
  });
  useWalletLifecycleStore.getState().markRecoveryPhraseVerified();
  const options = useWalletLifecycleStore.persist.getOptions();
  const projected = options.partialize!(useWalletLifecycleStore.getState());
  expect(schema.parse(JSON.parse(JSON.stringify(projected)))).toMatchObject({
    recoveryPhraseVerifiedAt: expect.any(Number),
    recoveryPhraseVerifiedRevision: 2,
  });
});
it('retains unrelated lifecycle data when the new verification revision is absent or invalid', () => {
  const schema = persistRegistry.find((entry) => entry.name === 'wallet-lifecycle')!.schema;
  for (const revision of [undefined, null, '2', 1.5, {}, NaN]) {
    expect(
      schema.parse({
        seedCreatedAt: 123,
        restoreStatus: 'complete',
        recoveryPhraseVerifiedAt: 456,
        recoveryPhraseVerifiedRevision: revision,
      })
    ).toMatchObject({
      seedCreatedAt: 123,
      restoreStatus: 'complete',
      recoveryPhraseVerifiedAt: 456,
      recoveryPhraseVerifiedRevision: null,
    });
  }
});
it('records revision 2 and preserves old dismissal entries when its additive revision is malformed', () => {
  useCtaStore.getState().dismiss('backup-recovery-phrase', true);
  expect(useCtaStore.getState().dismissed['backup-recovery-phrase'].revision).toBe(2);
  const schema = persistRegistry.find((entry) => entry.name === 'cta-store')!.schema;
  expect(schema.parse({ dismissed: { future: { at: 123, revision: 'bad' } } })).toMatchObject({
    dismissed: { future: { at: 123 } },
  });
});
