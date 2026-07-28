/* eslint-disable import/first */

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

import { getBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import { PROFILE_SCOPED_STORE_KEYS } from '@/shared/lib/cashu/profileScopedStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';

describe('bitchat profile scope', () => {
  beforeEach(() => {
    useProfileStore.setState({
      activeAccountIndex: 0,
      profiles: [],
    });
  });

  it('uses the active profile pubkey as the native bitchat scope', () => {
    useProfileStore.setState({
      activeAccountIndex: 2,
      profiles: [
        { accountIndex: 0, pubkey: 'profile-a', addedAt: 1 },
        { accountIndex: 2, pubkey: 'profile-b', addedAt: 2 },
      ],
    });

    expect(getBitchatProfileScope()).toBe('profile-b');
  });

  it('keeps BLE DM thread persistence in the profile-scoped store set', () => {
    expect(PROFILE_SCOPED_STORE_KEYS).toContain('bitchat-dm-messages-store');
  });
});
