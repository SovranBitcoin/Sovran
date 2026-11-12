/**
 * @jest-environment node
 *
 * `useMintInfo` fetches the info of a mint the wallet has not loaded. What it
 * returns must belong to the URL it was asked about: after a switch to another
 * uncached mint, the first mint's info must not stand in until the second
 * one's fetch lands.
 */

import TestRenderer, { act } from 'react-test-renderer';
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { useMintInfo } from '@/shared/hooks/useMintInfo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pending = new Map<string, (info: GetInfoResponse) => void>();
const mockGetMintInfo = (url: string) =>
  new Promise<GetInfoResponse>((resolve) => {
    pending.set(url, resolve);
  });

jest.mock('@/features/mint/hooks/useMintManagement', () => ({
  useMintManagement: () => ({ mints: [], getMintInfo: mockGetMintInfo }),
}));

jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  mintUrlLogFields: () => ({}),
}));

const info = (name: string): GetInfoResponse => ({
  name,
  pubkey: '',
  version: '',
  contact: [],
  nuts: { '4': { methods: [], disabled: false }, '5': { methods: [], disabled: false } },
});

describe('useMintInfo', () => {
  it('returns nothing for a newly chosen uncached mint until its own info arrives', async () => {
    const MINT_A = 'https://a.example';
    const MINT_B = 'https://b.example';
    let seen: GetInfoResponse | null = null;
    function Probe({ url }: { url: string }) {
      seen = useMintInfo(url);
      return null;
    }

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Probe url={MINT_A} />);
    });
    await act(async () => pending.get(MINT_A)?.(info('Mint A')));
    expect(seen).toEqual(info('Mint A'));

    await act(async () => renderer.update(<Probe url={MINT_B} />));
    expect(seen).toBeNull();

    await act(async () => pending.get(MINT_B)?.(info('Mint B')));
    expect(seen).toEqual(info('Mint B'));
    act(() => renderer.unmount());
  });
});
