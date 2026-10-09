import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { persistRegistry, persistedStoreKeys } from '@/shared/lib/persist/persistConfig';
import { createSecureVault } from '@/shared/lib/persist/secureVault';
import { removeProfileData } from '@/shared/lib/profile/removeProfile';
import { profileRemovalPorts } from '@/shared/lib/profile/profileRemovalStorage';

const mockSecure = new Map<string, string>();
let mockProofStates: string[] = [];
let mockPending = false;
let mockQuoteState: string | null | undefined;
let mockCloseFailure = false;
let mockReusableQuote = false;
let mockUnreadable = false;
let mockMissingWallet = false;
let mockFileFailure = false;
let mockSecureFailure = false;
const mockDeleted = new Set<string>();
const mockTables = [
  'coco_cashu_proofs',
  'coco_cashu_mint_quotes',
  'coco_cashu_canonical_mint_quotes',
  'coco_cashu_melt_quotes',
  'coco_cashu_send_operations',
  'coco_cashu_receive_operations',
  'coco_cashu_melt_operations',
  'coco_cashu_mint_operations',
];
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecure.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    if (mockSecureFailure) throw new Error('locked');
    mockSecure.delete(key);
  }),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'fixture/',
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: !mockMissingWallet && path.endsWith('.db') && !mockDeleted.has(path),
  })),
  deleteAsync: jest.fn(async (path: string) => {
    if (mockFileFailure) throw new Error('file locked');
    mockDeleted.add(path);
  }),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => {
    if (mockUnreadable) throw new Error('cannot open');
    return {
      execAsync: jest.fn(async () => {}),
      closeAsync: jest.fn(async () => {
        if (mockCloseFailure) throw new Error('close failed');
      }),
      getFirstAsync: jest.fn(async () => ({ quick_check: 'ok' })),
      getAllAsync: jest.fn(async (sql: string) => {
        if (sql.includes('sqlite_master')) return mockTables.map((name) => ({ name }));
        if (sql.includes('SELECT state, reusable'))
          return mockReusableQuote
            ? [{ state: 'ISSUED', reusable: 1, amountPaid: '1', amountIssued: '1' }]
            : [];
        if (sql.includes('coco_cashu_proofs')) return mockProofStates.map((state) => ({ state }));
        if (mockQuoteState !== undefined && sql.includes('mint_quotes'))
          return [{ state: mockQuoteState }];
        if (mockPending && sql.includes('send_operations')) return [{ state: 'pending' }];
        return [];
      }),
    };
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { log, nostrLog: log, storeLog: log, redactError: () => 'redacted' };
});

let sequence = 1;
let target: string;
const other = 'a'.repeat(64);
beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.clear();
  mockDeleted.clear();
  mockReusableQuote = false;
  mockQuoteState = undefined;
  mockCloseFailure = false;
  mockProofStates = [];
  mockPending = false;
  mockUnreadable = false;
  mockMissingWallet = false;
  mockFileFailure = false;
  mockSecureFailure = false;
  target = (++sequence).toString(16).padStart(64, '0');
  await useProfileStore.persist.rehydrate();
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [
      { accountIndex: 0, pubkey: other, addedAt: 1 },
      { accountIndex: 1, pubkey: target, addedAt: 2 },
    ],
  });
});
const remove = (confirmed = false) => removeProfileData(1, confirmed, profileRemovalPorts);

test('registry-driven removal preserves every other profile blob byte for byte and the shared root', async () => {
  const names = [
    ...new Set(
      persistRegistry.definitions
        .filter(
          (entry) =>
            (entry.scope === 'profile' && entry.persisted) ||
            (entry.profileStorage && entry.queryCache)
        )
        .map((entry) => entry.name)
    ),
  ];
  expect(names.length).toBeGreaterThan(20);
  const kept = new Map<string, string>();
  for (const name of names) {
    const key = `${name}:profile:${other}`;
    const value = ` { "owner": "other", "store": "${name}" } `;
    kept.set(key, value);
    await AsyncStorage.setItem(key, value);
    await AsyncStorage.setItem(`${name}:profile:${target}`, '{"state":{},"owner":"removed"}');
  }
  mockSecure.set('user_mnemonic', 'fixture-root');
  mockSecure.set('derived_keys_0', 'fixture-other');
  mockSecure.set('derived_keys_1', 'fixture-target');
  mockSecure.set(`imported_nsec_${target}`, 'fixture-imported-key');
  mockSecure.set(`nip46_bunker_secrets_${target}`, 'fixture-secret');
  await AsyncStorage.setItem('whitenoise:1:history:fixture', 'removed');
  await AsyncStorage.setItem('whitenoise:0:history:fixture', 'keep');
  const result = await remove();
  expect(result.kind).toBe('removed');
  for (const name of names)
    expect(await AsyncStorage.getItem(`${name}:profile:${target}`)).toBeNull();
  for (const [key, value] of kept) expect(await AsyncStorage.getItem(key)).toBe(value);
  expect(mockSecure.get('user_mnemonic')).toBe('fixture-root');
  expect(mockSecure.get('derived_keys_0')).toBe('fixture-other');
  expect(mockSecure.has('derived_keys_1')).toBe(false);
  expect(mockSecure.has(`imported_nsec_${target}`)).toBe(false);
  expect(mockSecure.has(`nip46_bunker_secrets_${target}`)).toBe(false);
  expect(await AsyncStorage.getItem('whitenoise:1:history:fixture')).toBeNull();
  expect(await AsyncStorage.getItem('whitenoise:0:history:fixture')).toBe('keep');
  expect(useProfileStore.getState().profiles.map((p) => p.accountIndex)).toEqual([0]);
  expect(mockDeleted.has('fixture/SQLite/coco-1.db')).toBe(true);
  expect(mockDeleted.has('fixture/SQLite/nostr-1')).toBe(true);
  expect(mockDeleted.has('fixture/SQLite/coco.db')).toBe(false);
});

test.each(['balance', 'pending', 'unreadable', 'active', 'last'] as const)(
  'refuses %s before deleting anything',
  async (reason) => {
    if (reason === 'balance') mockProofStates = ['ready'];
    if (reason === 'pending') mockPending = true;
    if (reason === 'unreadable') mockUnreadable = true;
    if (reason === 'active') useProfileStore.setState({ activeAccountIndex: 1 });
    if (reason === 'last')
      useProfileStore.setState({ profiles: [useProfileStore.getState().profiles[1]] });
    expect(await remove()).toEqual({ kind: 'refused', reason });
    expect(mockDeleted.size).toBe(0);
    expect(useProfileStore.getState().profiles.some((p) => p.accountIndex === 1)).toBe(true);
  }
);

test('missing wallet refuses rather than creating an empty database', async () => {
  mockMissingWallet = true;
  expect(await remove()).toEqual({ kind: 'refused', reason: 'unreadable' });
});

test('imported identity needs a separate key confirmation', async () => {
  useProfileStore.setState((state) => ({
    profiles: state.profiles.map((p) => (p.accountIndex === 1 ? { ...p, source: 'imported' } : p)),
  }));
  expect(await remove()).toEqual({ kind: 'refused', reason: 'imported-confirmation' });
  expect(mockDeleted.size).toBe(0);
  expect((await remove(true)).kind).toBe('removed');
});

test.each(['file', 'secure', 'list'] as const)(
  'failed %s step retains the profile and a rerun completes',
  async (failure) => {
    mockFileFailure = failure === 'file';
    mockSecureFailure = failure === 'secure';
    if (failure === 'list')
      jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    const result = await remove();
    expect(result.kind).toBe('failed');
    expect(useProfileStore.getState().profiles.map((p) => p.accountIndex)).toEqual([0, 1]);
    mockFileFailure = false;
    mockSecureFailure = false;
    expect((await remove()).kind).toBe('removed');
    expect(useProfileStore.getState().profiles.map((p) => p.accountIndex)).toEqual([0]);
  }
);

test('profile registry includes persisted profile stores used by deletion', () => {
  expect(persistedStoreKeys('profile')).toContain('routstr-store');
});

test.each(['ready', 'inflight'])(
  'refuses %s proofs in any unit without querying a mint',
  async (state) => {
    mockProofStates = [state];
    expect(await remove()).toEqual({ kind: 'refused', reason: 'balance' });
    expect(mockDeleted.size).toBe(0);
  }
);

test.each(['UNPAID', 'PAID'])('refuses non-issued %s mint quotes', async (state) => {
  mockQuoteState = state;
  expect(await remove()).toEqual({ kind: 'refused', reason: 'pending' });
  expect(mockDeleted.size).toBe(0);
});

test('a failed close refuses before deleting data', async () => {
  mockCloseFailure = true;
  expect(await remove()).toEqual({ kind: 'refused', reason: 'unreadable' });
  expect(mockDeleted.size).toBe(0);
});

test('legacy plaintext Routstr payment records refuse before deleting anything', async () => {
  await AsyncStorage.setItem(
    `routstr-store:profile:${target}`,
    JSON.stringify({
      state: {
        pendingPayments: {
          fixture: { encoded: 'fixture-token', nodeBaseUrl: 'fixture', operationId: 'fixture' },
        },
      },
    })
  );
  expect(await remove()).toEqual({ kind: 'refused', reason: 'unreadable' });
  expect(mockDeleted.size).toBe(0);
});

test('empty account vault cleanup leaves every other account secure value byte-identical', async () => {
  await createSecureVault(target, 'routstr-sdk:xcashu_tokens').write('{}');
  await createSecureVault(other, 'routstr-sdk:xcashu_tokens').write('"fixture-other-record"');
  const keep = [...mockSecure].filter(([key]) => key.startsWith(`routstr_v1_${other}_`));
  expect((await remove()).kind).toBe('removed');
  expect([...mockSecure.keys()].filter((key) => key.startsWith(`routstr_v1_${target}_`))).toEqual(
    []
  );
  for (const [key, value] of keep) expect(mockSecure.get(key)).toBe(value);
});

test('a retained vault token generation refuses even when its latest generation is empty', async () => {
  const vault = createSecureVault(target, 'routstr-sdk:xcashu_tokens');
  await vault.write('"fixture-token"');
  await vault.write('{}');
  expect(await remove()).toEqual({ kind: 'refused', reason: 'unreadable' });
  expect(mockDeleted.size).toBe(0);
});

test('activation after a failed removal invalidates the prior secure deletion plan', async () => {
  mockFileFailure = true;
  expect((await remove()).kind).toBe('failed');
  mockFileFailure = false;
  useProfileStore.getState().switchProfile(1);
  await createSecureVault(target, 'routstr-sdk:xcashu_tokens').write('"fixture-new-token"');
  useProfileStore.getState().switchProfile(0);
  expect(await remove()).toEqual({ kind: 'refused', reason: 'unreadable' });
  expect(useProfileStore.getState().profiles.map((p) => p.accountIndex)).toEqual([0, 1]);
});

test('a lost secure index entry cannot hide a known SDK payment vault', async () => {
  await createSecureVault(target, 'routstr-sdk:xcashu_tokens').write('"fixture-token"');
  mockSecure.set('secure_key_index', '[]');
  expect(await remove()).toEqual({ kind: 'refused', reason: 'unreadable' });
  expect(mockDeleted.size).toBe(0);
});

test('issued reusable quotes still refuse because later payments cannot be determined offline', async () => {
  mockReusableQuote = true;
  expect(await remove()).toEqual({ kind: 'refused', reason: 'pending' });
  expect(mockDeleted.size).toBe(0);
});
