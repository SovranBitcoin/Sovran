/**
 * @jest-environment node
 *
 * Gating "Add mint" on the bridge's async `isTrusted` made an already-installed
 * mint show the button and then lose it, because `!entry?.isTrusted` reads
 * UNKNOWN as UNTRUSTED for the round-trip's duration. These lock the two things
 * that remove the flash: the answer is available on the FIRST render, and the
 * two sides are compared through the URL normaliser.
 */

import TestRenderer, { act } from 'react-test-renderer';

import { useIsMintTrusted } from '@/features/mint/hooks/useIsMintTrusted';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockTrackedUrls: readonly string[] | null = null;
let mockContextUrls: readonly string[] = [];

jest.mock('wallet/react', () => ({
  useColadaTrustedMintUrls: () => mockTrackedUrls,
}));

jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContext: () => ({ trustedMintUrls: mockContextUrls }),
}));

function firstRenderAnswer(mintUrl: string | null | undefined): boolean {
  const seen: boolean[] = [];
  function Probe() {
    seen.push(useIsMintTrusted(mintUrl));
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Probe />);
  });
  act(() => {
    renderer!.unmount();
  });
  // The FIRST value is the point: anything later is already a flash.
  return seen[0];
}

beforeEach(() => {
  mockTrackedUrls = null;
  mockContextUrls = [];
});

describe('useIsMintTrusted', () => {
  it('answers true on the first render for an installed mint', () => {
    mockTrackedUrls = ['https://mint.minibits.cash/Bitcoin'];
    expect(firstRenderAnswer('https://mint.minibits.cash/Bitcoin')).toBe(true);
  });

  it('answers false for a mint the wallet does not have', () => {
    mockTrackedUrls = ['https://mint.minibits.cash/Bitcoin'];
    expect(firstRenderAnswer('https://ldk.thesimplekid.dev')).toBe(false);
  });

  it('matches across scheme case and trailing slash, which the two sources differ on', () => {
    mockTrackedUrls = ['https://mint.minibits.cash/Bitcoin/'];
    expect(firstRenderAnswer('HTTPS://mint.minibits.cash/Bitcoin')).toBe(true);
  });

  it('falls back to the wallet context when colada has no tracker snapshot', () => {
    mockTrackedUrls = null;
    mockContextUrls = ['https://ldk.thesimplekid.dev'];
    expect(firstRenderAnswer('https://ldk.thesimplekid.dev')).toBe(true);
  });

  it('prefers the tracker snapshot over the bound context once it exists', () => {
    // A mint removed in this session is gone from the tracker but may linger in
    // a stale bound context; the tracker is the live answer.
    mockTrackedUrls = [];
    mockContextUrls = ['https://ldk.thesimplekid.dev'];
    expect(firstRenderAnswer('https://ldk.thesimplekid.dev')).toBe(false);
  });

  it('is false for a missing mint url rather than throwing', () => {
    mockTrackedUrls = ['https://mint.minibits.cash/Bitcoin'];
    expect(firstRenderAnswer(undefined)).toBe(false);
    expect(firstRenderAnswer('')).toBe(false);
  });
});
