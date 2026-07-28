/**
 * Grouping per mint (what the detail screen walks) and the flattening back out
 * into one row per update (what the Mints tab lists).
 */
import { decodeFeed, type RawChange } from '@/features/mint/lib/mintChanges/decode';
import {
  buildMintChangeListItems,
  flattenMintChangeUpdates,
} from '@/features/mint/lib/mintChanges/groupEntries';

const change = (
  over: Partial<RawChange> & Pick<RawChange, 'mintUrl' | 'at' | 'hash'>
): RawChange => ({ name: 'A mint', ...over });

const items = (changes: RawChange[], nutsFor?: (mintUrl: string) => Record<string, unknown>) =>
  buildMintChangeListItems(
    decodeFeed({ trackedMints: 0, reachableMints: 0, totalChanges: changes.length, changes })
      .entries,
    nutsFor
  );

const railAdd = (nut: '4' | '5', method: string) => ({
  op: 'add',
  path: `/nuts/${nut}/methods/-`,
  value: { method, unit: 'sat' },
});

describe('buildMintChangeListItems', () => {
  it("groups a mint's revisions under one item, newest first", () => {
    const rows = items([
      change({
        mintUrl: 'https://a.example',
        at: 10,
        hash: 'h1',
        patch: [{ op: 'add', path: '/motd', value: 'hi' }],
      }),
      change({
        mintUrl: 'https://a.example',
        at: 20,
        hash: 'h2',
        patch: [railAdd('4', 'onchain'), railAdd('5', 'onchain')],
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.revisions.map((r) => r.entry.hash)).toEqual(['h2', 'h1']);
    expect(rows[0]!.latestAt).toBe(20);
    expect(flattenMintChangeUpdates(rows).map((u) => u.phrase.text)).toEqual([
      'added Onchain sending & receiving',
      'posted a notice: “hi”',
    ]);
  });

  it('shows both sides when a later revision reverses an earlier one', () => {
    const rows = items([
      change({
        mintUrl: 'https://a.example',
        at: 10,
        hash: 'h1',
        patch: [railAdd('4', 'onchain')],
      }),
      change({
        mintUrl: 'https://a.example',
        at: 20,
        hash: 'h2',
        patch: [
          { op: 'test', path: '/nuts/4/methods/1', value: { method: 'onchain', unit: 'sat' } },
          { op: 'remove', path: '/nuts/4/methods/1' },
        ],
      }),
    ]);

    // Both happened, so both are listed — newest first, each with its own date.
    expect(flattenMintChangeUpdates(rows).map((u) => [u.at, u.phrase.text])).toEqual([
      [20, 'dropped Onchain receiving'],
      [10, 'added Onchain receiving'],
    ]);
  });

  it('phrases each revision on its own for the detail screen', () => {
    const rows = items([
      change({
        mintUrl: 'https://a.example',
        at: 10,
        hash: 'h1',
        patch: [
          { op: 'test', path: '/version', value: 'Nutshell/0.20.0' },
          { op: 'replace', path: '/version', value: 'Nutshell/0.20.3' },
        ],
      }),
      change({
        mintUrl: 'https://a.example',
        at: 20,
        hash: 'h2',
        patch: [{ op: 'add', path: '/nuts/29', value: { methods: ['bolt11'] } }],
      }),
    ]);

    expect(rows[0]!.revisions.map((r) => r.phrases.map((p) => p.text))).toEqual([
      ['added batched deposits'],
      ['updated its software'],
    ]);
  });

  it("resolves a limit's unit from the mint's current capability map", () => {
    const rows = items(
      [
        change({
          mintUrl: 'https://a.example',
          at: 10,
          hash: 'h1',
          patch: [
            { op: 'test', path: '/nuts/4/methods/0/max_amount', value: 1000 },
            { op: 'replace', path: '/nuts/4/methods/0/max_amount', value: 5000 },
          ],
        }),
      ],
      () => ({ '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } })
    );

    expect(rows[0]!.revisions[0]!.phrases[0]!.text).toBe(
      'raised its receiving limit to 5,000 sats'
    );
  });

  it('sorts mints by their newest revision', () => {
    const rows = items([
      change({
        mintUrl: 'https://old.example',
        at: 10,
        hash: 'h1',
        patch: [{ op: 'add', path: '/motd', value: 'old' }],
      }),
      change({
        mintUrl: 'https://new.example',
        at: 99,
        hash: 'h2',
        patch: [{ op: 'add', path: '/motd', value: 'new' }],
      }),
    ]);

    expect(rows.map((r) => r.mintUrl)).toEqual(['https://new.example', 'https://old.example']);
  });
});
