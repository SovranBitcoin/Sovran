import { act, renderHook } from '@testing-library/react-native';

import { useRefreshMintSelectorOnFocus } from '@/features/mint/hooks/useRefreshMintSelectorOnFocus';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});

describe('useRefreshMintSelectorOnFocus', () => {
  it('refreshes exactly once after the authoritative tracker catches up', async () => {
    const mintOne = 'https://mint.one';
    const mintTwo = 'https://mint.two';
    const refresh = jest.fn().mockResolvedValue(undefined);
    const initialProps = {
      enabled: true,
      flow: 'send' as const,
      // The app UI may already know about mintTwo, but the hook deliberately
      // receives the machine tracker's still-authoritative snapshot here.
      trustedMintUrls: [mintOne],
      candidateMintUrls: [mintOne],
      refresh,
    };
    const { rerender, unmount } = renderHook(
      (props: typeof initialProps) => useRefreshMintSelectorOnFocus(props),
      { initialProps }
    );

    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      // Models subscribeWalletContext emitting after its async refresh.
      rerender({ ...initialProps, trustedMintUrls: [mintOne, mintTwo] });
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({
        ...initialProps,
        trustedMintUrls: [mintOne, mintTwo],
        candidateMintUrls: [mintOne, mintTwo],
      });
      rerender({
        ...initialProps,
        trustedMintUrls: [mintOne, mintTwo],
        candidateMintUrls: [mintOne, mintTwo],
      });
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();
  });
});
