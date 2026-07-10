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
  log: { info: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createProfileScopedStorage,
  signalMigrationsComplete,
  withSkippedPersistWrites,
} from '@/shared/lib/cashu/profileScopedStorage';

const PUBKEY_P = 'a'.repeat(64);
const PUBKEY_Q = 'b'.repeat(64);

describe('createProfileScopedStorage', () => {
  beforeAll(() => {
    signalMigrationsComplete();
  });

  beforeEach(() => {
    mockStorage.clear();
    mockProfileState.activeAccountIndex = 0;
    mockProfileState.profiles = [];
    jest.clearAllMocks();
  });

  it('isolates the same store key by active profile pubkey', async () => {
    const storage = createProfileScopedStorage();
    mockProfileState.profiles = [
      { accountIndex: 0, pubkey: PUBKEY_P },
      { accountIndex: 1, pubkey: PUBKEY_Q },
    ];

    await storage.setItem('mint-store', 'profile-p');
    mockProfileState.activeAccountIndex = 1;
    await storage.setItem('mint-store', 'profile-q');

    expect(mockStorage.get(`mint-store:profile:${PUBKEY_P}`)).toBe('profile-p');
    expect(mockStorage.get(`mint-store:profile:${PUBKEY_Q}`)).toBe('profile-q');
    await expect(storage.getItem('mint-store')).resolves.toBe('profile-q');

    mockProfileState.activeAccountIndex = 0;
    await expect(storage.getItem('mint-store')).resolves.toBe('profile-p');
  });

  it('uses the bare key only during bootstrap with no profile', async () => {
    const storage = createProfileScopedStorage();

    await storage.setItem('theme-store', 'bootstrap');

    expect(mockStorage.get('theme-store')).toBe('bootstrap');
    await expect(storage.getItem('theme-store')).resolves.toBe('bootstrap');
  });

  it('suppresses runtime-only writes while the persist gate is raised', async () => {
    const storage = createProfileScopedStorage();
    mockProfileState.profiles = [{ accountIndex: 0, pubkey: PUBKEY_P }];

    await withSkippedPersistWrites(() => storage.setItem('mint-store', 'runtime-only'));

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(mockStorage.size).toBe(0);
  });
});
