/**
 * @jest-environment node
 *
 * Characterization of `useProfileBalanceSync`: which profile's saved
 * `cachedBalanceSats` (shown in the profile switcher) the live wallet balance
 * is written to, and when. The real profile, settings and mock-data stores
 * run; only the wallet balance read (`useColadaBalance`) and storage are
 * replaced.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useProfileBalanceSync } from '@/features/wallet/hooks/useProfileBalanceSync';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

let mockTotal = 0;
jest.mock('wallet/react', () => ({
  useColadaBalance: () => ({ total: mockTotal, spendable: mockTotal, reserved: 0 }),
}));

const profile = (accountIndex: number, cachedBalanceSats?: number) => ({
  accountIndex,
  pubkey: `${accountIndex}`.repeat(64).slice(0, 64),
  addedAt: 1,
  ...(cachedBalanceSats === undefined ? {} : { cachedBalanceSats }),
});

function cached(accountIndex: number) {
  return useProfileStore.getState().profiles.find((p) => p.accountIndex === accountIndex)
    ?.cachedBalanceSats;
}

beforeEach(() => {
  mockTotal = 0;
  useSettingsStore.setState({ mockMode: false });
  useMockDataStore.setState({ mockBalance: 0 });
  useProfileStore.setState({
    activeAccountIndex: 1,
    profiles: [profile(0, 11), profile(1, 22), profile(2, 33)],
  });
});

test('the live balance is saved on the active profile only', () => {
  mockTotal = 5_000;
  renderHook(() => useProfileBalanceSync());

  expect(cached(1)).toBe(5_000);
  expect(cached(0)).toBe(11);
  expect(cached(2)).toBe(33);
});

test('a new balance is saved again on the same profile', () => {
  mockTotal = 100;
  const { rerender } = renderHook(() => useProfileBalanceSync());
  expect(cached(1)).toBe(100);

  mockTotal = 250;
  rerender({});
  expect(cached(1)).toBe(250);
});

test('a zero balance overwrites the saved one', () => {
  mockTotal = 0;
  renderHook(() => useProfileBalanceSync());

  expect(cached(1)).toBe(0);
});

test('switching profile saves the balance read at that moment on the newly active profile', () => {
  mockTotal = 700;
  renderHook(() => useProfileBalanceSync());
  expect(cached(1)).toBe(700);

  act(() => {
    useProfileStore.getState().switchProfile(2);
  });

  // QUIRK: the effect runs on the index change with whatever balance the hook
  // last read, which can still be the previous profile's total until the
  // new wallet's balance arrives.
  expect(cached(2)).toBe(700);
  expect(cached(1)).toBe(700);
});

test('an active index with no profile behind it writes nothing', () => {
  useProfileStore.setState({ activeAccountIndex: 9 });
  mockTotal = 900;
  renderHook(() => useProfileBalanceSync());

  expect(useProfileStore.getState().profiles.map((p) => p.cachedBalanceSats)).toEqual([11, 22, 33]);
});

test('in mock mode the mock balance is saved on the real active profile', () => {
  mockTotal = 1_234;
  useMockDataStore.setState({ mockBalance: 42_000 });
  useSettingsStore.setState({ mockMode: true });
  renderHook(() => useProfileBalanceSync());

  // QUIRK (D6): mock mode writes the demo total into the real profile's saved
  // balance, which the profile switcher then shows. A later fix should skip
  // the sync in mock mode and change this assertion on purpose.
  expect(cached(1)).toBe(42_000);
});

test('turning mock mode off saves the live balance again', () => {
  mockTotal = 1_234;
  useMockDataStore.setState({ mockBalance: 42_000 });
  useSettingsStore.setState({ mockMode: true });
  renderHook(() => useProfileBalanceSync());
  expect(cached(1)).toBe(42_000);

  act(() => {
    useSettingsStore.setState({ mockMode: false });
  });
  expect(cached(1)).toBe(1_234);
});
