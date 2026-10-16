import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import type { Mint } from '@cashu/coco-core';
import { useMintContacts } from '@/features/payments/hooks/useMintContacts';

jest.mock('@/shared/lib/imageCache', () => ({ prefetchImages: jest.fn(async () => {}) }));
jest.mock('@/shared/lib/nostr/client', () => ({
  npubToPubkey: (npub: string) => `hex:${npub}`,
}));

// Only the fields the hook reads; the rest of each type is irrelevant here.
const mint = (name: string): Mint => {
  const fields: Partial<Mint> = { mintUrl: `https://${name}.example` };
  return fields as Mint;
};
const infoFor = (url: string, withNostr = true): GetInfoResponse => {
  const fields: Partial<GetInfoResponse> = {
    name: url,
    contact: withNostr
      ? [{ method: 'nostr', info: `npub1${url}` }]
      : [{ method: 'email', info: 'a@b.c' }],
  };
  return fields as GetInfoResponse;
};

type Props = { mints: Mint[]; getMintInfo: (url: string) => Promise<GetInfoResponse> };
const render = (initialProps: Props) =>
  renderHook((props: Props) => useMintContacts(null, props.mints, props.getMintInfo), {
    initialProps,
  });

it('returns nostr-contact mints in mint order and drops failed or contactless ones', async () => {
  const mints = [mint('a'), mint('plain'), mint('down'), mint('b')];
  const getMintInfo = jest.fn(async (url: string) => {
    if (url.includes('down')) throw new Error('offline');
    return infoFor(url, !url.includes('plain'));
  });
  const { result } = render({ mints, getMintInfo });
  await waitFor(() => expect(result.current.displayMints).toHaveLength(2));

  expect(result.current.displayMints.map((m) => m.mint)).toEqual([mints[0], mints[3]]);
  expect(result.current.mintPubkeys).toEqual([
    'hex:npub1https://a.example',
    'hex:npub1https://b.example',
  ]);
  expect(result.current.displayMints[0]).toEqual({
    type: 'mint',
    pubkey: 'hex:npub1https://a.example',
    mint: mints[0],
    mintInfo: infoFor('https://a.example'),
    dmEvent: undefined,
    timestamp: 0,
  });
  expect(result.current.mintInfoLoading).toBe(false);
});

it('never has more than four mint info requests in flight', async () => {
  const mints = Array.from({ length: 11 }, (_, index) => mint(`m${index}`));
  const release: (() => void)[] = [];
  let inFlight = 0;
  let peak = 0;
  const getMintInfo = jest.fn(
    (url: string) =>
      new Promise<GetInfoResponse>((resolve) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        release.push(() => {
          inFlight -= 1;
          resolve(infoFor(url));
        });
      })
  );
  const { result } = render({ mints, getMintInfo });
  await waitFor(() => expect(getMintInfo).toHaveBeenCalledTimes(4));
  expect(result.current.mintInfoLoading).toBe(true);

  while (release.length > 0) {
    await act(async () => release.shift()!());
  }
  await waitFor(() => expect(result.current.displayMints).toHaveLength(11));
  expect(peak).toBe(4);
  expect(getMintInfo).toHaveBeenCalledTimes(11);
  expect(result.current.displayMints.map((m) => m.mint)).toEqual(mints);
});

it('asks only for mints it has not loaded when the mint set changes', async () => {
  let downIsUp = false;
  const getMintInfo = jest.fn(async (url: string) => {
    if (url.includes('down') && !downIsUp) throw new Error('offline');
    return infoFor(url);
  });
  const first = [mint('a'), mint('down')];
  const { result, rerender } = render({ mints: first, getMintInfo });
  await waitFor(() => expect(result.current.displayMints).toHaveLength(1));
  expect(getMintInfo).toHaveBeenCalledTimes(2);

  // Coco replaces the array and the Mint objects on every mint:* event.
  downIsUp = true;
  const second = [mint('a'), mint('down'), mint('c')];
  getMintInfo.mockClear();
  rerender({ mints: second, getMintInfo });
  await waitFor(() => expect(result.current.displayMints).toHaveLength(3));
  // `a` is already loaded; `down` failed last time, so it is asked again.
  expect(getMintInfo.mock.calls.map(([url]) => url)).toEqual([
    'https://down.example',
    'https://c.example',
  ]);
  expect(result.current.displayMints.map((m) => m.mint)).toEqual(second);
});

it('loads every mint again when the wallet hands over a new getMintInfo', async () => {
  const mints = [mint('a'), mint('b')];
  const before = jest.fn(async (url: string) => infoFor(url));
  const { result, rerender } = render({ mints, getMintInfo: before });
  await waitFor(() => expect(result.current.displayMints).toHaveLength(2));

  const after = jest.fn(async (url: string) => ({ ...infoFor(url), name: 'other wallet' }));
  rerender({ mints, getMintInfo: after });
  await waitFor(() => expect(result.current.displayMints[0].mintInfo.name).toBe('other wallet'));
  expect(after).toHaveBeenCalledTimes(2);
});
