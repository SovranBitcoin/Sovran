/**
 * @jest-environment node
 *
 * Delete account must wipe what Remote Login (NIP-46) left in secure storage.
 * Bunker pairing secrets (`nip46_bunker_secrets_<pubkey>`) were written with
 * raw SecureStore calls and never entered the secure key index, so the
 * index-driven wipe missed them; on iOS the keychain outlives an uninstall.
 */

/* eslint-disable import/first */

const mockSecureBacking = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  multiRemove: jest.fn(),
  clear: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureBacking.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureBacking.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureBacking.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

import { prepareSecureDataReset } from '@/shared/lib/nostr/secureStorage';
import { clearLegacyPairingIntent } from '@/shared/lib/profile/legacyNip46Cleanup';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { nostrLog } from '@/shared/lib/logger';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

beforeEach(() => {
  mockSecureBacking.clear();
  jest.clearAllMocks();
});

it('wipes every profile’s bunker secrets and the pending pairing, though the index never named them', async () => {
  mockSecureBacking.set('user_mnemonic', 'phrase');
  mockSecureBacking.set(`nip46_bunker_secrets_${A}`, '[{"secret":"x"}]');
  mockSecureBacking.set(`nip46_bunker_secrets_${B}`, '[{"secret":"y"}]');
  mockSecureBacking.set('nip46_pending_pairing', '{"uri":"nostrconnect://secret"}');
  // An index from an install that used Remote Login: the secrets are not in it.
  mockSecureBacking.set('secure_key_index', JSON.stringify(['user_mnemonic']));

  const clear = await prepareSecureDataReset([0, 1], [], [A, B]);
  await expect(clear()).resolves.toBe(true);

  expect(mockSecureBacking.has(`nip46_bunker_secrets_${A}`)).toBe(false);
  expect(mockSecureBacking.has(`nip46_bunker_secrets_${B}`)).toBe(false);
  expect(mockSecureBacking.has('nip46_pending_pairing')).toBe(false);
  expect(mockSecureBacking.size).toBe(0);
});

it('names no bunker key for a value that is not a pubkey', async () => {
  const clear = await prepareSecureDataReset([0], [], ['not-a-pubkey']);
  await expect(clear()).resolves.toBe(true);
  const deleted = jest.mocked(SecureStore.deleteItemAsync).mock.calls.map(([key]) => key as string);
  expect(deleted.filter((key) => key.startsWith('nip46_bunker_secrets_'))).toEqual([]);
  expect(deleted).toContain('nip46_pending_pairing');
});

it('removes a pairing link an older build left, in both places it was kept', async () => {
  mockSecureBacking.set('nip46_pending_pairing', '{"uri":"nostrconnect://secret"}');

  await clearLegacyPairingIntent();

  expect(mockSecureBacking.has('nip46_pending_pairing')).toBe(false);
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith('nip46-pending-pairing');
});

it('logs, and does not throw, when a pairing link cannot be removed', async () => {
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('keychain locked'));

  await expect(clearLegacyPairingIntent()).resolves.toBeUndefined();
  expect(nostrLog.warn).toHaveBeenCalledWith(
    'nostr.legacy_nip46.pairing_intent_clear_failed',
    expect.anything()
  );
});
