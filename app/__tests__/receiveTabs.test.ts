/**
 * @jest-environment node
 */

import { deriveMintMethodCapabilityMapFromTrustedMints } from 'wallet';
import { computeReceiveTabs } from '@/features/receive/lib/receiveTabs';

const MINT_A = 'https://a.mint';
const MINT_B = 'https://b.mint';

function mintInfo(methods: { method: string; unit: string }[]) {
  return { nuts: { '4': { methods } } };
}

function ctx(mints: { mintUrl: string; mintInfo?: unknown }[], unit = 'sat') {
  return {
    trustedMintUrls: mints.map((m) => m.mintUrl),
    mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints(mints, unit),
  };
}

describe('computeReceiveTabs', () => {
  it('is Lightning-only for bolt11-only mints with P2PK off', () => {
    const c = ctx([{ mintUrl: MINT_A, mintInfo: mintInfo([{ method: 'bolt11', unit: 'sat' }]) }]);
    expect(computeReceiveTabs(c, 'sat', false)).toEqual(['Lightning']);
  });

  it('adds Bolt12 and Onchain when any trusted mint advertises them', () => {
    const c = ctx([
      { mintUrl: MINT_A, mintInfo: mintInfo([{ method: 'bolt11', unit: 'sat' }]) },
      {
        mintUrl: MINT_B,
        mintInfo: mintInfo([
          { method: 'bolt11', unit: 'sat' },
          { method: 'bolt12', unit: 'sat' },
          { method: 'onchain', unit: 'sat' },
        ]),
      },
    ]);
    expect(computeReceiveTabs(c, 'sat', true)).toEqual(['Lightning', 'Bolt12', 'Onchain', 'P2PK']);
  });

  it('gates method tabs on the active unit', () => {
    const c = ctx(
      [
        {
          mintUrl: MINT_A,
          mintInfo: mintInfo([
            { method: 'bolt11', unit: 'usd' },
            { method: 'bolt12', unit: 'sat' },
          ]),
        },
      ],
      'usd'
    );
    // bolt12 is only advertised for sat, so the usd view hides the tab.
    expect(computeReceiveTabs(c, 'usd', false)).toEqual(['Lightning']);
  });

  it('keeps the P2PK setting gate', () => {
    const c = ctx([{ mintUrl: MINT_A, mintInfo: mintInfo([{ method: 'bolt11', unit: 'sat' }]) }]);
    expect(computeReceiveTabs(c, 'sat', true)).toEqual(['Lightning', 'P2PK']);
  });
});
