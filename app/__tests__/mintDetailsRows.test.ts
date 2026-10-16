import * as nip19 from 'nostr-tools/nip19';
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { buildMintDetailsRows, supportedNutNames } from '@/features/mint/lib/mintDetailsRows';
import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';

// The date formatter reads the language setting; the real store would try to
// rehydrate from storage that does not exist here.
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ language: 'en' }) },
}));

const MINT = 'https://mint.example.com';
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const MINUTE = 60_000;
const PUBKEY = 'deadbeef'.repeat(8);

const info = {
  name: 'Example Mint',
  pubkey: '02' + 'ab'.repeat(32),
  version: 'Nutshell/0.17.0',
  description: 'A small mint.',
  description_long: 'A small mint run for testing, with a long description.',
  motd: 'Maintenance on Sunday.',
  contact: [
    { method: 'email', info: 'op@example.com' },
    { method: 'nostr', info: nip19.npubEncode(PUBKEY) },
  ],
  nuts: {
    '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
    '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
    '7': { supported: true },
    '9': { supported: false },
    '12': { supported: true },
  },
} as unknown as GetInfoResponse;

const cached: MintMetadataEntry = {
  info,
  supportedUnits: ['sat', 'usd'],
  identityAt: NOW - 5 * MINUTE,
  averageScore: 4.25,
  reviewCount: 12,
  favouriteCount: 3,
  reviewsAt: NOW - 10 * MINUTE,
  auditState: 'OK',
  nMints: 90,
  nMelts: 8,
  nErrors: 2,
  avgLatencyMs: 412.6,
  auditSource: 'ucash',
  uptime24h: 99.5,
  auditUpdatedAt: Math.floor((NOW - 2 * 60 * MINUTE) / 1000),
  auditAt: NOW - 20 * MINUTE,
  contactFollowers: 420,
  contactReputation: 71.6,
  operatorNpub: nip19.npubEncode(PUBKEY),
  vertexRank: 0.000123456,
  socialAt: NOW - 30 * MINUTE,
  liveness: 'online',
  livenessAt: NOW - MINUTE,
};

const byTitle = (rows: ReturnType<typeof buildMintDetailsRows>) =>
  Object.fromEntries(rows.map((row) => [row.title, row]));

describe('mint details rows', () => {
  it('groups every known fact under a human label', () => {
    const rows = buildMintDetailsRows({
      mintUrl: MINT,
      entry: { mintUrl: MINT, displayName: 'Example Mint' },
      cached,
      operator: { pubkey: PUBKEY, name: 'Operator Olga' },
      now: NOW,
    });
    const groups = Object.fromEntries(
      ['Mint', 'Reliability', 'Reviews', 'Operator', 'Last updated'].map((group) => [
        group,
        rows.filter((row) => row.group === group).map((row) => row.title),
      ])
    );

    expect(rows.every((row) => row.group !== undefined)).toBe(true);
    expect(new Set(rows.map((row) => row.title)).size).toBe(rows.length);
    expect(groups).toEqual({
      Mint: [
        'Address',
        'Name',
        'Software',
        'Mint public key',
        'Units',
        'Supported features',
        'Message from the mint',
        'Summary',
        'Full description',
        'Nostr contact',
        'Email contact',
      ],
      Reliability: [
        'Status',
        'Audit result',
        'Success rate',
        'Average time',
        'Total mints',
        'Total melts',
        'Failed operations',
        'Auditor',
        'Uptime, last 24 hours',
        'Last audited',
      ],
      Reviews: ['Average score', 'Number of reviews', 'Favourites'],
      Operator: ['Nostr name', 'Nostr key', 'Followers', 'Reputation', 'Vertex rank'],
      'Last updated': ['Mint info', 'Audit', 'Reviews', 'Operator', 'Status check'],
    });

    const row = byTitle(rows);
    expect(row['Address'].value).toBe(MINT);
    expect(row['Units'].value).toBe('sat, usd');
    expect(row['Status'].value).toBe('Online');
    expect(row['Audit result'].value).toBe('Working');
    expect(row['Success rate'].value).toBe('98%');
    expect(row['Average time'].value).toBe('413 ms');
    expect(row['Total mints'].value).toBe('90');
    expect(row['Total melts'].value).toBe('8');
    expect(row['Failed operations'].value).toBe('2');
    expect(row['Auditor'].value).toBe('ucash');
    expect(row['Uptime, last 24 hours'].value).toBe('99.5%');
    expect(row['Average score'].value).toBe('4.3 out of 5');
    expect(row['Number of reviews'].value).toBe('12');
    expect(row['Favourites'].value).toBe('3');
    expect(row['Nostr name'].value).toBe('Operator Olga');
    expect(row['Nostr key'].value).toBe(nip19.npubEncode(PUBKEY));
    expect(row['Followers'].value).toBe('420');
    expect(row['Reputation'].value).toBe('72 out of 100');
    expect(row['Vertex rank'].value).toBe('0.000123');
  });

  it('omits rows whose value is unknown', () => {
    const rows = buildMintDetailsRows({
      mintUrl: MINT,
      entry: { mintUrl: MINT, displayName: '', motd: '   ', kymScore: Number.NaN },
      cached: {
        averageScore: null,
        contactReputation: null,
        uptime24h: Number.NaN,
        avgLatencyMs: undefined,
        contactFollowers: 0,
        vertexRank: 0,
        auditUpdatedAt: '',
        identityAt: Number.NaN,
        supportedUnits: [],
        nuts: {},
      },
      operator: { pubkey: 'not-a-key', name: '  ' },
      now: NOW,
    });

    // Only the address is known for certain; everything else stays off.
    expect(rows).toEqual([{ group: 'Mint', title: 'Address', value: MINT }]);
  });

  it('formats NUT support and timestamps for people', () => {
    expect(
      supportedNutNames({
        '17': { supported: [] },
        '4': { methods: [], disabled: true },
        '5': { methods: [], disabled: false },
        '31': { supported: true },
        '12': { supported: true },
        '9': { supported: false },
        '7': 'yes',
        constructor: { supported: true },
      })
    ).toEqual(['Melting tokens (NUT-5)', 'DLEQ proofs (NUT-12)', 'NUT-31', 'NUT-constructor']);

    const row = byTitle(buildMintDetailsRows({ mintUrl: MINT, cached, now: NOW }));
    expect(row['Supported features'].value).toBe(
      [
        'Minting tokens (NUT-4)',
        'Melting tokens (NUT-5)',
        'Token state check (NUT-7)',
        'DLEQ proofs (NUT-12)',
      ].join('\n')
    );
    // Epoch milliseconds from the store, Unix seconds from the auditor.
    expect(row['Mint info'].value).toBe('5 minutes ago');
    expect(row['Status check'].value).toBe('1 minute ago');
    expect(row['Last audited'].value).toBe('2 hours ago');

    // A date string from the auditor reads the same way.
    const fromString = byTitle(
      buildMintDetailsRows({
        mintUrl: MINT,
        cached: { auditUpdatedAt: new Date(NOW - 3 * 24 * 60 * MINUTE).toISOString() },
        now: NOW,
      })
    );
    expect(fromString['Last audited'].value).toBe('3 days ago');
  });

  it('writes large counts with separators and drops a name that is only the address', () => {
    const rows = byTitle(
      buildMintDetailsRows({
        mintUrl: MINT,
        entry: { mintUrl: MINT, displayName: MINT },
        cached: {
          nMints: 12345,
          nMelts: 0,
          nErrors: 0,
          reviewCount: 1500,
          contactFollowers: 98765,
        },
        now: NOW,
      })
    );

    expect(rows['Name']).toBeUndefined();
    expect(rows['Total mints'].value).toBe('12,345');
    expect(rows['Number of reviews'].value).toBe('1,500');
    expect(rows['Followers'].value).toBe('98,765');
  });
});
