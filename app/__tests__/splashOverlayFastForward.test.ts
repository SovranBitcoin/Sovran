import { act, renderHook } from '@testing-library/react-native';

import {
  getWalletTabFocused,
  setWalletTabFocused,
  shouldFastForwardBootOverlay,
  subscribeWalletTabFocused,
  type QRButtonAnchor,
} from '@/shared/lib/qrButtonAnchor';
import { useWalletTabFocusPublisher } from '@/features/wallet/hooks/useWalletTabFocusPublisher';

let mockIsFocused = true;

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    // Like the real navigator, the focus effect only fires for a focused
    // screen (and its cleanup on blur/unmount only if it fired).
    useFocusEffect: (effect: () => void | (() => void)) =>
      useEffect(() => {
        if (!mockIsFocused) return undefined;
        return effect();
      }, [effect]),
    useIsFocused: () => mockIsFocused,
  };
});

const ANCHOR: QRButtonAnchor = { x: 128, y: 465, width: 64, height: 64, borderRadius: 11.52 };

describe('shouldFastForwardBootOverlay', () => {
  it('fast-forwards only on a definitive blur with a live anchor', () => {
    expect(shouldFastForwardBootOverlay(false, ANCHOR)).toBe(true);
  });

  it('keeps the overlay through a profile-switch unmount echo (blur + nulled anchor)', () => {
    // On profile switch the navigator remounts: WalletScreen's blur cleanup
    // fires, but QRButton's child cleanup nulls the anchor first — that blur
    // must not cut the replayed morph.
    expect(shouldFastForwardBootOverlay(false, null)).toBe(false);
  });

  it('keeps the overlay while focus is unknown (wallet not mounted yet)', () => {
    expect(shouldFastForwardBootOverlay(null, ANCHOR)).toBe(false);
    expect(shouldFastForwardBootOverlay(null, null)).toBe(false);
  });

  it('keeps the overlay while the wallet tab is focused', () => {
    expect(shouldFastForwardBootOverlay(true, ANCHOR)).toBe(false);
  });
});

describe('walletTabFocused channel', () => {
  afterEach(() => setWalletTabFocused(null));

  it('dedupes identical publishes and notifies on change', () => {
    const listener = jest.fn();
    const unsub = subscribeWalletTabFocused(listener);

    setWalletTabFocused(true);
    setWalletTabFocused(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getWalletTabFocused()).toBe(true);

    setWalletTabFocused(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    setWalletTabFocused(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('useWalletTabFocusPublisher', () => {
  afterEach(() => setWalletTabFocused(null));

  it('publishes focus on a focused mount', () => {
    mockIsFocused = true;
    renderHook(() => useWalletTabFocusPublisher());
    expect(getWalletTabFocused()).toBe(true);
  });

  it('publishes blur on an unfocused mount (slow boot, user already on Feed)', () => {
    // Native tabs eagerly mount every tab screen; useFocusEffect never fires
    // for a screen that mounts blurred, so the useIsFocused mirror must
    // publish the initial false. (The mocked useFocusEffect here still runs
    // its effect on mount, so the mirror's ordering — mirror effect after the
    // focus effect — is what this asserts.)
    mockIsFocused = false;
    renderHook(() => useWalletTabFocusPublisher());
    expect(getWalletTabFocused()).toBe(false);
  });

  it('publishes blur on unmount, relying on the anchor guard to disambiguate', () => {
    mockIsFocused = true;
    const { unmount } = renderHook(() => useWalletTabFocusPublisher());
    expect(getWalletTabFocused()).toBe(true);
    act(() => unmount());
    // The unmount blur pairs with a nulled anchor in production, which is
    // why shouldFastForwardBootOverlay requires anchor !== null.
    expect(getWalletTabFocused()).toBe(false);
  });
});
