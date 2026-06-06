import { resolveStickyMintSelectorItems } from '@/features/mint/hooks/useStickyMintSelectorItems';
import type { MintListItem } from '@sovranbitcoin/colada';

function mintItem(mintUrl: string, displayName: string, iconUrl?: string): MintListItem {
  return {
    mintUrl,
    displayName,
    iconUrl,
    balance: 0,
    unit: 'sat',
    status: 'available',
    reason: null,
    isPreferred: false,
  };
}

describe('resolveStickyMintSelectorItems', () => {
  it('keeps the last live enriched rows when the machine leaves selectMint', () => {
    const fallback = [mintItem('https://mint.example', 'https://mint.example')];
    const enriched = [
      mintItem('https://mint.example', 'Sovran Mint', 'https://mint.example/icon.png'),
    ];

    expect(
      resolveStickyMintSelectorItems({
        liveItems: null,
        entryItems: fallback,
        previousLiveItems: enriched,
      })
    ).toBe(enriched);
  });

  it('uses route-param fallback rows before live machine rows arrive', () => {
    const fallback = [mintItem('https://mint.example', 'https://mint.example')];

    expect(
      resolveStickyMintSelectorItems({
        liveItems: null,
        entryItems: fallback,
        previousLiveItems: null,
      })
    ).toBe(fallback);
  });

  it('prefers current live rows over older live rows', () => {
    const previous = [mintItem('https://old.example', 'Old Mint')];
    const current = [mintItem('https://new.example', 'New Mint')];

    expect(
      resolveStickyMintSelectorItems({
        liveItems: current,
        entryItems: previous,
        previousLiveItems: previous,
      })
    ).toBe(current);
  });
});
