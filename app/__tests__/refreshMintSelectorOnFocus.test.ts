import { act, renderHook } from '@testing-library/react-native';

import {
  mintSelectorCandidateSetIsStale,
  useRefreshMintSelectorOnFocus,
} from '@/features/mint/hooks/useRefreshMintSelectorOnFocus';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});

describe('mintSelectorCandidateSetIsStale', () => {
  it('accepts the same normalized set in any order', () => {
    expect(
      mintSelectorCandidateSetIsStale(
        ['https://MINT.one:443/./path/', 'https://MINT.two/'],
        ['https://mint.two', 'https://mint.one/path']
      )
    ).toBe(false);
  });

  it('keeps HTTP, HTTPS, and www hosts as different mint identities', () => {
    expect(mintSelectorCandidateSetIsStale(['https://mint.one'], ['http://mint.one'])).toBe(true);
    expect(mintSelectorCandidateSetIsStale(['https://mint.one'], ['https://www.mint.one'])).toBe(
      true
    );
  });

  it('detects a newly trusted mint', () => {
    expect(
      mintSelectorCandidateSetIsStale(
        ['https://mint.one', 'https://mint.two'],
        ['https://mint.one']
      )
    ).toBe(true);
  });

  it('detects a removed trusted mint', () => {
    expect(
      mintSelectorCandidateSetIsStale(
        ['https://mint.one'],
        ['https://mint.one', 'https://mint.two']
      )
    ).toBe(true);
  });

  it('ignores duplicate normalized URLs', () => {
    expect(
      mintSelectorCandidateSetIsStale(
        ['https://mint.one', 'https://MINT.one:443/'],
        ['https://mint.one/']
      )
    ).toBe(false);
  });

  it('fails closed when either set contains an invalid URL', () => {
    expect(mintSelectorCandidateSetIsStale(['not a URL'], ['not a URL'])).toBe(true);
  });

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
