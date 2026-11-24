/**
 * The Search tab's sections: order, de-duplication, caps and empty sections.
 */
import type { DestinationDescriptor } from 'wallet';

import { BLUETOOTH_TIER_ENTRY, type TierEntry } from '@/features/bitchat/hooks/useLocationTiers';
import {
  buildSearchSections,
  DISCOVERED_MINTS_LIMIT,
  REMOTE_PEOPLE_LIMIT,
  type SearchSectionsInput,
} from '@/features/search/lib/searchSections';
import type { MintSearchResult } from '@/shared/lib/apiClient';

const pk = (n: number) => n.toString(16).padStart(64, '0');
const EMPTY: SearchSectionsInput = {
  action: null,
  localPeople: [],
  remotePeople: [],
  ownMints: [],
  discoveredMints: [],
  geohash: null,
  tiers: [],
};
const discovered = (url: string): MintSearchResult =>
  ({
    url,
    info: { name: `Mint ${url}` },
    review_score: 4,
    review_count: 2,
  }) as unknown as MintSearchResult;
const CITY: TierEntry = {
  key: 'city',
  label: 'City',
  precision: 5,
  geohash: 'gcpvj',
  transport: 'nostr',
  icon: 'mdi:map',
};

describe('buildSearchSections', () => {
  it('shows nothing, and no headers, for zero results', () => {
    expect(buildSearchSections(EMPTY)).toEqual({
      items: [],
      counts: { people: 0, mints: 0, nearby: 0 },
    });
  });

  it('orders action, People, Mints, Nearby', () => {
    const action: DestinationDescriptor = {
      kind: 'mint',
      label: 'Open mint',
      amount: null,
      icon: 'mint',
      action: 'openMint',
      hasAlternatives: false,
      raw: 'https://m.example',
    };
    const { items } = buildSearchSections({
      ...EMPTY,
      action,
      localPeople: [{ pubkey: pk(1), source: 'recent', displayName: 'Al' }],
      ownMints: [{ mintUrl: 'https://own.example' }],
      tiers: [BLUETOOTH_TIER_ENTRY],
    });
    expect(items.map((item) => item.id)).toEqual([
      'action',
      'header:people',
      `person:${pk(1)}`,
      'header:mints',
      'mint:own.example',
      'header:nearby',
      'tier:bluetooth',
    ]);
  });

  it('streams remote people under local ones, without repeating a person', () => {
    const { items, counts } = buildSearchSections({
      ...EMPTY,
      localPeople: [{ pubkey: pk(1), source: 'following', displayName: 'Al' }],
      remotePeople: [
        { pubkey: pk(1), isLoadingProfile: false },
        { pubkey: pk(2), isLoadingProfile: true },
      ],
    });
    const people = items.filter((item) => item.type === 'person');
    expect(people.map((item) => item.id)).toEqual([`person:${pk(1)}`, `person:${pk(2)}`]);
    expect(people.map((item) => item.type === 'person' && item.source)).toEqual([
      'following',
      'search',
    ]);
    expect(counts.people).toBe(2);
  });

  it('lists the account mints first and drops a discovered copy of one', () => {
    const { items } = buildSearchSections({
      ...EMPTY,
      ownMints: [{ mintUrl: 'https://Own.example/', displayName: 'Own' }],
      discoveredMints: [discovered('https://own.example'), discovered('https://other.example')],
    });
    const mints = items.filter((item) => item.type === 'mint');
    expect(mints.map((m) => m.type === 'mint' && [m.mintUrl, m.owned])).toEqual([
      ['https://Own.example/', true],
      ['https://other.example', false],
    ]);
  });

  it('caps remote people and discovered mints for huge answers', () => {
    const { counts } = buildSearchSections({
      ...EMPTY,
      remotePeople: Array.from({ length: 500 }, (_, i) => ({
        pubkey: pk(i),
        isLoadingProfile: false,
      })),
      discoveredMints: Array.from({ length: 1000 }, (_, i) => discovered(`https://m${i}.example`)),
    });
    expect(counts.people).toBe(REMOTE_PEOPLE_LIMIT);
    expect(counts.mints).toBe(DISCOVERED_MINTS_LIMIT);
  });

  it('puts Bluetooth first in Nearby, then places, then the geohash jump', () => {
    const { items } = buildSearchSections({
      ...EMPTY,
      tiers: [CITY, BLUETOOTH_TIER_ENTRY, BLUETOOTH_TIER_ENTRY],
      geohash: 'gcpv',
    });
    expect(items.map((item) => item.id)).toEqual([
      'header:nearby',
      'tier:bluetooth',
      'tier:city',
      'geohash:gcpv',
    ]);
  });
});
