/**
 * @jest-environment node
 *
 * "Is this still the account that started" has two answers in the app. A
 * capture watches the account for the length of a job and stays false once it
 * has switched away, even if it switches back. A comparison of the active key
 * asks only about the moment it is made.
 */

import { getActiveProfilePubkey } from '@/shared/lib/cashu/profileScopedStorage';
import { captureProfile } from '@/shared/lib/nostr/ownReplaceableEvent';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const pubkey = (i: number) => `${i}`.padStart(64, '0');
const entry = (i: number): ProfileEntry => ({ accountIndex: i, pubkey: pubkey(i), addedAt: i });

beforeEach(() => useProfileStore.setState({ profiles: [entry(0), entry(1)], activeAccountIndex: 0 }));

describe('the active account key', () => {
  it('is the key of the profile the active index names, and nothing without one', () => {
    expect(getActiveProfilePubkey()).toBe(pubkey(0));
    useProfileStore.setState({ activeAccountIndex: 1 });
    expect(getActiveProfilePubkey()).toBe(pubkey(1));
    useProfileStore.setState({ activeAccountIndex: 7 });
    expect(getActiveProfilePubkey()).toBeUndefined();
  });

  it('matches again after switching away and back', () => {
    const owner = getActiveProfilePubkey();
    useProfileStore.setState({ activeAccountIndex: 1 });
    useProfileStore.setState({ activeAccountIndex: 0 });
    expect(getActiveProfilePubkey()).toBe(owner);
  });
});

describe('the account capture', () => {
  it('holds while the account stays active', () => {
    const scope = captureProfile(pubkey(0));
    useProfileStore.setState({ profiles: [entry(0), entry(1), entry(2)] });
    expect(() => scope.check()).not.toThrow();
    scope.dispose();
  });

  it('stays broken after switching away and back', () => {
    const scope = captureProfile(pubkey(0));
    useProfileStore.setState({ activeAccountIndex: 1 });
    useProfileStore.setState({ activeAccountIndex: 0 });
    expect(() => scope.check()).toThrow('Profile changed');
    scope.dispose();
  });

  it('is broken from the start for a key that is not the active one', () => {
    const scope = captureProfile(pubkey(1));
    expect(() => scope.check()).toThrow('Profile changed');
    scope.dispose();
  });

  it('breaks when the active index names a different key', () => {
    const scope = captureProfile(pubkey(0));
    useProfileStore.setState({ profiles: [{ ...entry(0), pubkey: pubkey(5) }, entry(1)] });
    expect(() => scope.check()).toThrow('Profile changed');
    scope.dispose();
  });
});
