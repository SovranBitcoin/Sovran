/**
 * @jest-environment node
 */

/* eslint-disable import/first */

const mockStorage = new Map<string, string>();
const mockProfileState: {
  activeAccountIndex: number;
  profiles: { accountIndex: number; pubkey: string }[];
} = {
  activeAccountIndex: 0,
  profiles: [],
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      mockStorage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockStorage.delete(key);
      return Promise.resolve();
    }),
  },
}));

jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => mockProfileState,
    persist: {
      hasHydrated: () => true,
      onFinishHydration: jest.fn(),
    },
  },
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: jest.fn(),
}));

import { signalMigrationsComplete } from '@/shared/lib/cashu/profileScopedStorage';
import {
  DEFAULT_BLOSSOM_SERVER,
  getMediaServer,
  isValidHttpsUrl,
  normalizeMediaServer,
  useMediaServerStore,
} from '@/shared/lib/nostr/media/mediaServerStore';

const storageKey = (pubkey: string) => `nostr-media-server-store:profile:${pubkey}`;
const flushWrites = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeAll(async () => {
  signalMigrationsComplete();
  await useMediaServerStore.persist.rehydrate();
});

beforeEach(async () => {
  mockStorage.clear();
  mockProfileState.activeAccountIndex = 0;
  mockProfileState.profiles = [
    { accountIndex: 0, pubkey: 'a'.repeat(64) },
    { accountIndex: 1, pubkey: 'b'.repeat(64) },
  ];
  useMediaServerStore.getState().restoreDefault();
  await flushWrites();
});

it.each([
  ['  https://media.example.com///  ', 'https://media.example.com'],
  ['media.example.com/', 'https://media.example.com'],
  ['media.example.com:8443/', 'https://media.example.com:8443'],
  ['https://media.example.com:443/', 'https://media.example.com:443'],
])('normalizes %s and saves the HTTPS origin', (input, expected) => {
  expect(normalizeMediaServer(input)).toBe(expected);
  expect(isValidHttpsUrl(expected)).toBe(true);
  useMediaServerStore.getState().setServer(input);
  expect(getMediaServer()).toBe(expected);
});

it.each([
  '',
  ' ',
  'http://media.example.com',
  'ftp://media.example.com',
  'javascript:alert(1)',
  'https://',
  'https://media.example.com/path',
  'https://media.example.com?query=1',
  'https://media.example.com#fragment',
  'https://user:password@media.example.com',
  'https://media.example.com/../',
  'https://media.example.com?',
  'https://media.example.com#',
])('rejects non-HTTPS origins and suffixes: %s', (input) => {
  expect(isValidHttpsUrl(normalizeMediaServer(input))).toBe(false);
  useMediaServerStore.getState().setServer(input);
  expect(getMediaServer()).toBe(DEFAULT_BLOSSOM_SERVER);
});

it('restores the default and persists only data', async () => {
  useMediaServerStore.getState().setServer('https://custom.example.com');
  useMediaServerStore.getState().restoreDefault();
  await flushWrites();
  expect(getMediaServer()).toBe(DEFAULT_BLOSSOM_SERVER);
  expect(JSON.parse(mockStorage.get(storageKey('a'.repeat(64)))!)).toEqual({
    state: { server: DEFAULT_BLOSSOM_SERVER },
    version: 1,
  });
});

it('writes and rehydrates the upload server independently for each profile', async () => {
  useMediaServerStore.getState().setServer('https://first.example.com');
  await flushWrites();
  mockProfileState.activeAccountIndex = 1;
  useMediaServerStore.getState().setServer('https://second.example.com');
  await flushWrites();
  await useMediaServerStore.persist.rehydrate();
  expect(getMediaServer()).toBe('https://second.example.com');

  mockProfileState.activeAccountIndex = 0;
  await useMediaServerStore.persist.rehydrate();
  expect(getMediaServer()).toBe('https://first.example.com');
});

it('preserves legacy persisted URLs without tightening the hydration schema', async () => {
  mockStorage.set(
    storageKey('a'.repeat(64)),
    JSON.stringify({
      state: { server: 'http://legacy.example.com' },
      version: 1,
    })
  );
  await useMediaServerStore.persist.rehydrate();
  expect(getMediaServer()).toBe('http://legacy.example.com');
  useMediaServerStore.getState().setServer('http://other.example.com');
  expect(getMediaServer()).toBe('http://legacy.example.com');
});
