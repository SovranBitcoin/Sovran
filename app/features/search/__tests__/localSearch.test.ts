/**
 * Tier-0 search: people and mints already on the phone match from the first
 * character, in a bounded scan, with worst-case data.
 */
import {
  LOCAL_PEOPLE_LIMIT,
  LOCAL_SCAN_LIMIT,
  matchLocalMints,
  matchLocalPeople,
  type LocalPersonCandidate,
} from '@/features/search/lib/localSearch';
import { matchTiers } from '@/features/search/lib/matchTiers';
import { BLUETOOTH_TIER_ENTRY, type TierEntry } from '@/features/bitchat/hooks/useLocationTiers';

const pk = (n: number) => n.toString(16).padStart(64, '0');
const person = (n: number, fields: Partial<LocalPersonCandidate>): LocalPersonCandidate => ({
  pubkey: pk(n),
  source: 'following',
  ...fields,
});

describe('matchLocalPeople', () => {
  it('matches from one character', () => {
    const people = [person(1, { displayName: 'Alice' }), person(2, { displayName: 'Bob' })];
    expect(matchLocalPeople(people, 'a').map((p) => p.pubkey)).toEqual([pk(1)]);
    expect(matchLocalPeople(people, 'B').map((p) => p.pubkey)).toEqual([pk(2)]);
  });

  it('ranks a name prefix above a later word above anywhere inside', () => {
    const people = [
      person(1, { displayName: 'Carla Danvers' }),
      person(2, { displayName: 'Dan' }),
      person(3, { displayName: 'Jordan' }),
    ];
    expect(matchLocalPeople(people, 'dan').map((p) => p.pubkey)).toEqual([pk(2), pk(1), pk(3)]);
  });

  it('puts a recent payee before a follow of equal match', () => {
    const people = [
      person(1, { displayName: 'Sam', source: 'following' }),
      person(2, { displayName: 'Sam', source: 'recent' }),
    ];
    expect(matchLocalPeople(people, 'sam').map((p) => p.pubkey)).toEqual([pk(2), pk(1)]);
  });

  it('matches NIP-05 and Lightning addresses, accents and emoji names', () => {
    const people = [
      person(1, { nip05: 'zoe@example.com' }),
      person(2, { lud16: 'tips@walletofsatoshi.com' }),
      person(3, { displayName: 'Zoë 🌸' }),
      person(4, { displayName: '🌸🌸🌸' }),
    ];
    expect(matchLocalPeople(people, 'wallet').map((p) => p.pubkey)).toEqual([pk(2)]);
    expect(matchLocalPeople(people, 'zoe').map((p) => p.pubkey)).toEqual([pk(1), pk(3)]);
    expect(matchLocalPeople(people, '🌸').map((p) => p.pubkey)).toEqual([pk(4), pk(3)]);
  });

  it('keeps a person once, as the earlier source', () => {
    const people = [
      person(1, { displayName: 'Alice', source: 'recent' }),
      person(1, { displayName: 'Alice', source: 'following' }),
    ];
    expect(matchLocalPeople(people, 'al')).toEqual([people[0]]);
  });

  it('returns nothing for an empty query, missing fields or no candidates', () => {
    expect(matchLocalPeople([person(1, { displayName: 'Alice' })], '  ')).toEqual([]);
    expect(matchLocalPeople([person(1, {})], 'a')).toEqual([]);
    expect(matchLocalPeople([], 'a')).toEqual([]);
  });

  it('caps the rows and the scan for a follow list in the thousands', () => {
    const many = Array.from({ length: LOCAL_SCAN_LIMIT + 2000 }, (_, i) =>
      person(i, {
        displayName: i === LOCAL_SCAN_LIMIT + 1 ? 'Needle' : `Anon ${'x'.repeat(200)} ${i}`,
      })
    );
    const started = Date.now();
    expect(matchLocalPeople(many, 'a')).toHaveLength(LOCAL_PEOPLE_LIMIT);
    // Past the scan limit: not reached, by design.
    expect(matchLocalPeople(many, 'needle')).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('matchLocalMints', () => {
  it('matches the account mints by name or address from one character', () => {
    const mints = [
      { mintUrl: 'https://mint.minibits.cash/Bitcoin', displayName: 'Minibits' },
      { mintUrl: 'https://testnut.cashu.space', displayName: null },
      { mintUrl: `https://${'very-long-subdomain.'.repeat(30)}example.com` },
    ];
    // A name prefix outranks a letter inside an address.
    expect(matchLocalMints(mints, 'm').map((m) => m.mintUrl)).toEqual([
      mints[0].mintUrl,
      mints[2].mintUrl,
    ]);
    expect(matchLocalMints(mints, 'testnut').map((m) => m.mintUrl)).toEqual([mints[1].mintUrl]);
    expect(matchLocalMints(mints, 'example').map((m) => m.mintUrl)).toEqual([mints[2].mintUrl]);
    expect(matchLocalMints(mints, 'zzz')).toEqual([]);
  });
});

describe('matchTiers: the Bluetooth row', () => {
  const cityTier: TierEntry = {
    key: 'city',
    label: 'City',
    precision: 5,
    geohash: 'gcpvj',
    transport: 'nostr',
    icon: 'mdi:map',
    displayName: 'London',
  };

  it.each(['bluetooth', 'blu', 'mesh', 'nearby', 'bitchat', 'BITCH'.toLowerCase()])(
    'is found by "%s"',
    (query) => {
      expect(matchTiers([BLUETOOTH_TIER_ENTRY], query)).toEqual([BLUETOOTH_TIER_ENTRY]);
    }
  );

  it('needs three characters', () => {
    expect(matchTiers([BLUETOOTH_TIER_ENTRY], 'bl')).toEqual([]);
    expect(matchTiers([BLUETOOTH_TIER_ENTRY], 'me')).toEqual([]);
  });

  it('still matches places by label and name', () => {
    expect(matchTiers([BLUETOOTH_TIER_ENTRY, cityTier], 'lond')).toEqual([cityTier]);
    expect(matchTiers([BLUETOOTH_TIER_ENTRY, cityTier], 'ci')).toEqual([cityTier]);
  });
});
