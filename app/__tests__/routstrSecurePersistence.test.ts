const mockPlain = new Map<string, string>();
const mockSecure = new Map<string, string>();
let mockOwner = 'a'.repeat(64);
let mockFailWrite = false;
let mockFailRead = false;
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => mockOwner,
  createProfileScopedStorage: (owner: string) => ({
    getItem: async (key: string) => mockPlain.get(`${key}:profile:${owner}`) ?? null,
    setItem: async (key: string, value: string) => {
      mockPlain.set(`${key}:profile:${owner}`, value);
    },
    removeItem: async (key: string) => {
      mockPlain.delete(`${key}:profile:${owner}`);
    },
  }),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => {
    if (mockFailRead) throw new Error('locked');
    return mockSecure.get(key) ?? null;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockFailWrite) throw new Error('full');
    mockSecure.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecure.delete(key);
  }),
}));
jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

import { createRoutstrPersistence } from '@/shared/lib/routstr/securePersistence';
import { createSdkStorageDriver } from '@/shared/lib/routstr/sdk/driver';
import { createSecureVault } from '@/shared/lib/routstr/secureVault';
import { clearAllSecureData } from '@/shared/lib/nostr/secureStorage';
import * as SecureStore from 'expo-secure-store';

const legacy = JSON.stringify({
  version: 1,
  state: {
    apiKey: 'sk-fixture',
    sessions: [{ id: 'chat' }],
    legacyAccounts: { 'https://old.example': { apiKey: 'sk-old-fixture', archivedAt: 1 } },
    pendingPayments: {
      payment: {
        encoded: 'cashuB-fixture',
        operationId: 'op',
        nodeBaseUrl: 'https://old.example',
        startedAt: 1,
      },
    },
  },
});
const plainKey = () => `routstr-store:profile:${mockOwner}`;

describe('Routstr secure migration', () => {
  beforeEach(() => {
    mockOwner = 'a'.repeat(64);
    mockPlain.clear();
    mockSecure.clear();
    mockFailRead = false;
    mockFailWrite = false;
    jest.clearAllMocks();
  });

  it('verifies the secure copy before stripping plaintext and restores the complete old state', async () => {
    mockPlain.set(plainKey(), legacy);
    const storage = createRoutstrPersistence();
    expect(JSON.parse((await storage.getItem('routstr-store'))!)).toEqual(JSON.parse(legacy));
    expect(mockPlain.get(plainKey())).not.toContain('sk-fixture');
    expect(mockPlain.get(plainKey())).not.toContain('cashuB-fixture');
    expect(JSON.parse((await createRoutstrPersistence().getItem('routstr-store'))!)).toEqual(
      JSON.parse(legacy)
    );
  });

  it.each(['read', 'write'])(
    'preserves the plaintext source and rejects writes after a secure %s failure',
    async (operation) => {
      mockPlain.set(plainKey(), legacy);
      mockFailRead = operation === 'read';
      mockFailWrite = operation === 'write';
      const storage = createRoutstrPersistence();
      await expect(storage.getItem('routstr-store')).rejects.toThrow();
      await expect(
        storage.setItem('routstr-store', JSON.stringify({ version: 1, state: {} }))
      ).rejects.toThrow();
      expect(mockPlain.get(plainKey())).toBe(legacy);
    }
  );

  it('does not write secrets again for a chat-only update', async () => {
    mockPlain.set(plainKey(), legacy);
    const storage = createRoutstrPersistence();
    await storage.getItem('routstr-store');
    const writes = jest.mocked(SecureStore.setItemAsync).mock.calls.length;
    const next = JSON.parse(legacy);
    next.state.sessions = [{ id: 'new-chat' }];
    await storage.setItem('routstr-store', JSON.stringify(next));
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(writes);
  });

  it('keeps SDK recovery writes bound to their captured owner', async () => {
    const owner = mockOwner;
    const driver = createSdkStorageDriver(owner);
    mockOwner = 'b'.repeat(64);
    await driver.setItem('xcashu_tokens', { node: [{ token: 'cashuB-fixture' }] });
    await driver.flush();
    expect(await createSdkStorageDriver(owner).getItem('xcashu_tokens', {})).toEqual({
      node: [{ token: 'cashuB-fixture' }],
    });
    expect(await createSdkStorageDriver(mockOwner).getItem('xcashu_tokens', {})).toEqual({});
    expect([...mockPlain.values()].join('')).not.toContain('cashuB-fixture');
  });

  it('surfaces voided SDK write failures at the awaited payment boundary', async () => {
    const driver = createSdkStorageDriver(mockOwner);
    mockFailWrite = true;
    void driver.setItem('xcashu_tokens', { node: [{ token: 'cashuB-fixture' }] });
    await expect(driver.flush()).rejects.toThrow('Payment recovery could not be saved');
  });

  it('indexes only the manifest and Delete All removes every large-token chunk', async () => {
    await createSecureVault(mockOwner, 'large').write('😀'.repeat(12_000));
    expect(JSON.parse(mockSecure.get('secure_key_index')!)).toHaveLength(1);
    expect(await clearAllSecureData([])).toBe(true);
    expect(mockSecure.size).toBe(0);
  });

  it('never reports a successful wipe when the index cannot be read', async () => {
    await createSecureVault(mockOwner, 'keep').write('cashuB-fixture');
    mockFailRead = true;
    await expect(clearAllSecureData([])).rejects.toThrow();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mockSecure.has('secure_key_index')).toBe(true);
  });
});
